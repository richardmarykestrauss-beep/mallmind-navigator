/**
 * SmartFetcher — production-grade HTTP client for retail scraping.
 *
 * Features:
 *   - Per-domain cookie jar (session continuity)
 *   - Per-domain request queue (never concurrent hits to same host)
 *   - Gaussian-jittered delays (looks human, not robotic)
 *   - Exponential backoff on 429 / 5xx
 *   - Realistic browser headers that vary per request
 *   - Referer chaining (each request references the previous URL)
 *   - Warm-up: visits homepage first to acquire session cookies
 *   - Transparent retry with detailed logging
 */

import { randomUA, isMobileUA } from "./userAgents.js";

// ── Types ────────────────────────────────────────────────────────────────────

export interface FetchOptions {
  method?: "GET" | "POST";
  body?: string;
  extraHeaders?: Record<string, string>;
  referer?: string;
  /** Skip the per-domain queue — use only for parallel warm-ups */
  noQueue?: boolean;
}

export interface FetchResult {
  ok: boolean;
  status: number;
  text: string;
  json<T = unknown>(): T | null;
  url: string;
}

// ── Timing helpers ───────────────────────────────────────────────────────────

/** Gaussian-distributed delay: mean ± std, clamped to [min, max] ms */
function gaussianDelay(meanMs: number, stdMs: number, minMs = 800, maxMs = 8000): number {
  // Box-Muller transform
  const u1 = Math.random(), u2 = Math.random();
  const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  return Math.max(minMs, Math.min(maxMs, Math.round(meanMs + z * stdMs)));
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms));
}

// ── Cookie jar ───────────────────────────────────────────────────────────────

class CookieJar {
  private store = new Map<string, Map<string, string>>();

  set(domain: string, setCookieHeaders: string[]) {
    if (!this.store.has(domain)) this.store.set(domain, new Map());
    const jar = this.store.get(domain)!;
    for (const header of setCookieHeaders) {
      const [pair] = header.split(";");
      const eqIdx = pair.indexOf("=");
      if (eqIdx === -1) continue;
      const name = pair.slice(0, eqIdx).trim();
      const value = pair.slice(eqIdx + 1).trim();
      if (name) jar.set(name, value);
    }
  }

  get(domain: string): string {
    const jar = this.store.get(domain);
    if (!jar?.size) return "";
    return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
  }

  has(domain: string): boolean {
    return (this.store.get(domain)?.size ?? 0) > 0;
  }
}

// ── Domain queue ─────────────────────────────────────────────────────────────

class DomainQueue {
  private queues = new Map<string, Promise<void>>();

  enqueue(domain: string, task: () => Promise<void>): Promise<void> {
    const prev = this.queues.get(domain) ?? Promise.resolve();
    const next = prev.then(() => task());
    this.queues.set(domain, next.catch(() => {}));
    return next;
  }
}

// ── SmartFetcher ─────────────────────────────────────────────────────────────

export class SmartFetcher {
  private cookies = new CookieJar();
  private queue = new DomainQueue();
  private warmedUp = new Set<string>();

  /** Mean delay between requests to the same domain (ms) */
  private meanDelay: number;
  private stdDelay: number;

  constructor(opts: { meanDelay?: number; stdDelay?: number } = {}) {
    this.meanDelay = opts.meanDelay ?? 2800;
    this.stdDelay  = opts.stdDelay  ?? 900;
  }

  private getDomain(url: string): string {
    try { return new URL(url).hostname; } catch { return url; }
  }

  private buildHeaders(url: string, opts: FetchOptions): Record<string, string> {
    const ua = randomUA();
    const isMobile = isMobileUA(ua);
    const domain = this.getDomain(url);
    const cookies = this.cookies.get(domain);

    const base: Record<string, string> = {
      "User-Agent": ua,
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
      "Accept-Language": "en-ZA,en-GB;q=0.9,en-US;q=0.8,en;q=0.7,af;q=0.6",
      "Accept-Encoding": "gzip, deflate, br",
      "Cache-Control": "max-age=0",
      "Connection": "keep-alive",
      "DNT": "1",
      "Upgrade-Insecure-Requests": "1",
    };

    if (!isMobile) {
      base["Sec-Ch-Ua"] = '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"';
      base["Sec-Ch-Ua-Mobile"] = "?0";
      base["Sec-Ch-Ua-Platform"] = '"Windows"';
      base["Sec-Fetch-Dest"] = "document";
      base["Sec-Fetch-Mode"] = "navigate";
      base["Sec-Fetch-Site"] = opts.referer ? "same-origin" : "none";
      base["Sec-Fetch-User"] = "?1";
    }

    if (opts.referer) base["Referer"] = opts.referer;
    if (cookies) base["Cookie"] = cookies;
    if (opts.method === "POST") {
      base["Content-Type"] = "application/json";
      base["Sec-Fetch-Mode"] = "cors";
      base["X-Requested-With"] = "XMLHttpRequest";
    }

    return { ...base, ...(opts.extraHeaders ?? {}) };
  }

  private async doFetch(url: string, opts: FetchOptions, attempt: number): Promise<FetchResult> {
    const headers = this.buildHeaders(url, opts);
    const domain  = this.getDomain(url);

    const res = await fetch(url, {
      method: opts.method ?? "GET",
      headers,
      body: opts.body,
      redirect: "follow",
    });

    // Capture cookies
    const setCookie = res.headers.getSetCookie?.() ?? [];
    if (setCookie.length) this.cookies.set(domain, setCookie);

    const text = await res.text();

    // 429 / 503 — back off and retry
    if ((res.status === 429 || res.status === 503) && attempt < 4) {
      const waitMs = [10_000, 30_000, 60_000, 120_000][attempt - 1] ?? 120_000;
      console.warn(`  [${domain}] ${res.status} — waiting ${waitMs / 1000}s before retry ${attempt + 1}`);
      await sleep(waitMs);
      return this.doFetch(url, opts, attempt + 1);
    }

    // 5xx transient errors — shorter retry
    if (res.status >= 500 && attempt < 3) {
      const waitMs = attempt * 5_000;
      console.warn(`  [${domain}] ${res.status} — retrying in ${waitMs / 1000}s`);
      await sleep(waitMs);
      return this.doFetch(url, opts, attempt + 1);
    }

    return {
      ok: res.ok,
      status: res.status,
      text,
      url: res.url,
      json<T>(): T | null {
        try { return JSON.parse(text) as T; } catch { return null; }
      },
    };
  }

  /** Fetch with queueing and human-timing delays */
  async fetch(url: string, opts: FetchOptions = {}): Promise<FetchResult> {
    const domain = this.getDomain(url);

    const run = async (): Promise<FetchResult> => {
      const result = await this.doFetch(url, opts, 1);
      // Inter-request delay *after* the request (next queued item waits this long)
      await sleep(gaussianDelay(this.meanDelay, this.stdDelay));
      return result;
    };

    if (opts.noQueue) return run();
    return this.queue.enqueue(domain, () => run().then(() => {}))
      .then(() => this.doFetch(url, opts, 1)); // Return value workaround

    // Note: the queue ensures serialization; we still need the return value.
    // Use the direct approach below instead:
  }

  /** Preferred fetch method — serializes per domain, adds jitter delay */
  async get(url: string, opts: Omit<FetchOptions, "method"> = {}): Promise<FetchResult> {
    const domain = this.getDomain(url);
    return new Promise<FetchResult>((resolve, reject) => {
      this.queue.enqueue(domain, async () => {
        try {
          const result = await this.doFetch(url, { ...opts, method: "GET" }, 1);
          await sleep(gaussianDelay(this.meanDelay, this.stdDelay));
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  async post(url: string, body: unknown, opts: Omit<FetchOptions, "method" | "body"> = {}): Promise<FetchResult> {
    const domain = this.getDomain(url);
    return new Promise<FetchResult>((resolve, reject) => {
      this.queue.enqueue(domain, async () => {
        try {
          const result = await this.doFetch(url, {
            ...opts,
            method: "POST",
            body: JSON.stringify(body),
          }, 1);
          await sleep(gaussianDelay(this.meanDelay, this.stdDelay));
          resolve(result);
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  /**
   * Warm up a domain: visit the homepage first so the server sees a natural
   * browsing session (landing → search) rather than a cold search hit.
   */
  async warmUp(homeUrl: string): Promise<void> {
    const domain = this.getDomain(homeUrl);
    if (this.warmedUp.has(domain)) return;
    this.warmedUp.add(domain);

    console.log(`  [${domain}] Warming up session…`);
    try {
      await this.get(homeUrl, { noQueue: true } as FetchOptions);
    } catch {
      // Non-fatal — if warmup fails, proceed anyway
    }
  }

  hasCookies(domain: string): boolean {
    return this.cookies.has(domain);
  }
}

// ── JSON extraction helpers ───────────────────────────────────────────────────

/**
 * Extract JSON embedded in HTML (Next.js, Nuxt, window.__INITIAL_STATE__, etc.)
 * Tries multiple patterns common across SA retail sites.
 */
export function extractEmbeddedJson(html: string): unknown[] {
  const results: unknown[] = [];

  const patterns = [
    // Next.js
    /<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i,
    // Nuxt / window state
    /window\.__NUXT__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i,
    /window\.__INITIAL_STATE__\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i,
    // Adobe/Hybris digitalData
    /var\s+digitalData\s*=\s*(\{[\s\S]*?\});\s*(?:\/\/|<\/script>)/i,
    // Generic window.data
    /window\.pageData\s*=\s*(\{[\s\S]*?\});\s*<\/script>/i,
  ];

  for (const pattern of patterns) {
    const m = html.match(pattern);
    if (m?.[1]) {
      try {
        results.push(JSON.parse(m[1]));
      } catch { /* skip malformed */ }
    }
  }

  return results;
}

/**
 * Extract all JSON-LD blocks from HTML.
 * Many SA retail sites embed structured product data this way.
 */
export function extractJsonLd(html: string): unknown[] {
  const results: unknown[] = [];
  const re = /<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    try { results.push(JSON.parse(m[1])); } catch { /* skip */ }
  }
  return results;
}

/** Safely dig into a nested object by dot-separated path */
export function dig(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc == null || typeof acc !== "object") return undefined;
    return (acc as Record<string, unknown>)[key];
  }, obj);
}
