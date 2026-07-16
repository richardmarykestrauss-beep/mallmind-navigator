/**
 * Service-to-service auth for the durable worker's /internal/* endpoints.
 *
 * Cloud Run IAM (`--no-allow-unauthenticated`) is the first gate: an unauthenticated
 * request never reaches this process. This module is the second, in-process gate,
 * so the worker is not defenceless if that binding is ever loosened by mistake.
 *
 * It verifies a Google-signed ID token against Google's public keys, checks the
 * audience is THIS service, and checks the caller's service account is explicitly
 * allow-listed. CORS is NOT part of this: CORS is a browser convention, not an
 * authentication mechanism, and the worker deliberately serves no CORS headers.
 *
 * The authenticated service-account email becomes the caller identity used to
 * ground `requested_by` — job attribution never comes from request JSON.
 */

import { OAuth2Client } from "google-auth-library";

export class InternalAuthError extends Error {
  constructor(message: string) { super(message); this.name = "InternalAuthError"; }
}

export interface InternalAuthOptions {
  expectedAudience: string;
  allowedInvokers: string[];
  /** Injectable for tests; defaults to a real Google token verifier. */
  verifier?: OAuth2Client;
}

export interface InternalCaller { email: string; subject: string; }

/** Extract a Bearer token without leaking its value into any error. */
export function bearerFrom(headers: Record<string, unknown>): string {
  const raw = headers["authorization"] ?? headers["Authorization"];
  const value = typeof raw === "string" ? raw : "";
  const m = /^Bearer\s+(\S+)$/.exec(value);
  if (!m) throw new InternalAuthError("Missing bearer token.");
  return m[1];
}

export class InternalAuthenticator {
  private readonly client: OAuth2Client;
  private readonly allowed: Set<string>;

  constructor(private readonly opts: InternalAuthOptions) {
    this.client = opts.verifier ?? new OAuth2Client();
    this.allowed = new Set(opts.allowedInvokers.map((e) => e.toLowerCase()));
  }

  /**
   * Verify an inbound identity token. Throws InternalAuthError on ANY doubt —
   * bad signature, wrong audience, unverified email, or an unlisted caller.
   */
  async authenticate(headers: Record<string, unknown>): Promise<InternalCaller> {
    const token = bearerFrom(headers);

    let payload: { email?: string; email_verified?: boolean; sub?: string } | undefined;
    try {
      const ticket = await this.client.verifyIdToken({ idToken: token, audience: this.opts.expectedAudience });
      payload = ticket.getPayload() as typeof payload;
    } catch {
      // Never echo the verifier's message: it can quote the token.
      throw new InternalAuthError("Identity token verification failed.");
    }

    const email = (payload?.email ?? "").toLowerCase();
    if (!email || payload?.email_verified !== true) throw new InternalAuthError("Identity token has no verified service identity.");
    if (!this.allowed.has(email)) throw new InternalAuthError("Caller is not an allow-listed invoker.");

    return { email, subject: String(payload?.sub ?? "") };
  }
}
