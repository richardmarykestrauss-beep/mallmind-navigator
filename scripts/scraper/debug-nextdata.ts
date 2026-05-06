/**
 * Dump window.__NEXT_DATA__ structure from Checkers Sixty60 search.
 * Run: npx tsx debug-nextdata.ts
 */

import { getBrowser, newStealthPage, goto, closeBrowser } from "./framework/browser.js";

function printKeys(obj: unknown, path = "", depth = 0): void {
  if (depth > 5) return;
  if (!obj || typeof obj !== "object") return;
  if (Array.isArray(obj)) {
    if (obj.length === 0) return;
    console.log(`${" ".repeat(depth * 2)}${path}[] (${obj.length} items)`);
    // Print first item's keys
    printKeys(obj[0], `${path}[0]`, depth + 1);
    return;
  }
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const fullPath = path ? `${path}.${k}` : k;
    if (Array.isArray(v)) {
      console.log(`${" ".repeat(depth * 2)}${fullPath}[] (${v.length} items)`);
      if (v.length > 0) printKeys(v[0], `${fullPath}[0]`, depth + 1);
    } else if (v && typeof v === "object") {
      console.log(`${" ".repeat(depth * 2)}${fullPath} {}`);
      printKeys(v, fullPath, depth + 1);
    } else {
      const display = String(v).slice(0, 80);
      console.log(`${" ".repeat(depth * 2)}${fullPath} = ${display}`);
    }
  }
}

async function main() {
  const browser = await getBrowser();
  const { page, context } = await newStealthPage(browser);

  console.log("▶ Warming up…");
  await goto(page, "https://www.checkers.co.za");
  await page.waitForTimeout(2000);

  console.log("▶ Loading search page…");
  await goto(page, "https://www.checkers.co.za/search?q=bread");

  // Wait until product images start loading (proxy for products being rendered)
  try {
    await page.waitForResponse(
      (r) => r.url().includes("catalog.sixty60.co.za"),
      { timeout: 12_000 }
    );
  } catch { /* continue anyway */ }
  await page.waitForTimeout(2000);

  // ── 1. Dump __NEXT_DATA__ keys ────────────────────────────────────────────
  const nextData = await page.evaluate(() => (window as Record<string, unknown>)["__NEXT_DATA__"]);
  if (!nextData) {
    console.log("❌ __NEXT_DATA__ not found");
  } else {
    console.log("\n── __NEXT_DATA__ key tree ─────────────────────────────────");
    printKeys(nextData);
  }

  // ── 2. Look for product-like arrays deep in the structure ─────────────────
  const found = await page.evaluate(() => {
    const nd = (window as Record<string, unknown>)["__NEXT_DATA__"] as Record<string, unknown>;
    if (!nd) return null;

    const results: Array<{ path: string; sample: unknown }> = [];

    function search(obj: unknown, path: string, depth: number) {
      if (depth > 8 || !obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        if (obj.length > 0) {
          const first = obj[0] as Record<string, unknown>;
          if (first && typeof first === "object" && ("name" in first || "title" in first || "price" in first)) {
            results.push({ path, sample: first });
          }
        }
        obj.slice(0, 2).forEach((item, i) => search(item, `${path}[${i}]`, depth + 1));
        return;
      }
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        search(v, path ? `${path}.${k}` : k, depth + 1);
      }
    }

    search(nd, "", 0);
    return results.slice(0, 10);
  });

  console.log("\n── Product-like arrays found ─────────────────────────────");
  if (found?.length) {
    for (const f of found) {
      console.log(`\nPath: ${f.path}`);
      console.log("Sample:", JSON.stringify(f.sample, null, 2).slice(0, 500));
    }
  } else {
    console.log("None found via __NEXT_DATA__");
  }

  // ── 3. Try DOM — look for any element containing "R " price pattern ────────
  const domProducts = await page.evaluate(() => {
    const pricePattern = /R\s*\d+[,.]?\d*/;
    const results: Array<{ tag: string; classes: string; text: string }> = [];
    document.querySelectorAll("*").forEach((el) => {
      const text = el.textContent?.trim() ?? "";
      if (pricePattern.test(text) && text.length < 200 && el.children.length < 5) {
        results.push({
          tag: el.tagName,
          classes: el.className?.toString().slice(0, 80) ?? "",
          text: text.slice(0, 100),
        });
      }
    });
    return results.slice(0, 20);
  });

  console.log("\n── DOM elements with price pattern ──────────────────────");
  for (const d of domProducts) {
    console.log(`  <${d.tag} class="${d.classes}">\n    ${d.text}`);
  }

  await context.close();
  await closeBrowser();
}

main().catch(console.error);
