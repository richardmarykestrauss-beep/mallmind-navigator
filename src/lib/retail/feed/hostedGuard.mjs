/**
 * hostedGuard.mjs — Sprint 2L-B hosted-environment safeguard.
 *
 * Refuses to let a disposable-DB workflow point at a HOSTED database. It rejects the known
 * hosted MallMind project refs, any *.supabase.co/.in/pooler host, and any non-local host;
 * it accepts only recognised LOCAL disposable targets (localhost / 127.0.0.1 / ::1 /
 * supabase_db_* container / *.local). Pure + deterministic; prints only hosts, never secrets.
 */

const HOSTED_REFS = Object.freeze(["iivmrlgntspbkpfqoboi", "qspsouemjtcdcfnivpnt"]);
const HOSTED_PATTERNS = Object.freeze([/\.supabase\.co\b/i, /\.supabase\.in\b/i, /pooler\.supabase\.com/i, /db\.[a-z0-9]+\.supabase\.co/i]);
const LOCAL_HOST_PATTERNS = Object.freeze([/^localhost$/i, /^127\.0\.0\.1$/, /^0\.0\.0\.0$/, /^::1$/, /^\[::1\]$/, /^supabase_db_/i, /\.local$/i, /^host\.docker\.internal$/i]);

function hostOf(target) {
  const s = String(target ?? "").trim();
  if (/:\/\//.test(s)) { try { return new URL(s).hostname; } catch { /* fall through */ } }
  return s;
}

/** True when the target references a hosted project ref or a Supabase-hosted host. */
export function isHostedTarget(target) {
  const s = String(target ?? "");
  if (HOSTED_REFS.some((r) => s.includes(r))) return true;
  return HOSTED_PATTERNS.some((p) => p.test(s));
}

/** True when the target host is a recognised LOCAL disposable database. */
export function isLocalTarget(target) {
  if (isHostedTarget(target)) return false;
  const host = hostOf(target);
  return LOCAL_HOST_PATTERNS.some((p) => p.test(host));
}

/** Throws unless the target is a recognised LOCAL disposable database. */
export function assertLocalDatabaseTarget(target) {
  const host = hostOf(target);
  if (isHostedTarget(target)) throw new Error(`REFUSED: target host '${host}' is HOSTED — this workflow is disposable-local only`);
  if (!isLocalTarget(target)) throw new Error(`REFUSED: target host '${host}' is not a recognised LOCAL disposable database`);
  return host;
}

export const HOSTED_PROJECT_REFS = HOSTED_REFS;
