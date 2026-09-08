/**
 * Supabase service-role adapter for `PostgresGateway`.
 *
 * This is the ONLY place the durable intake path touches @supabase/supabase-js.
 * `PostgresDurableIntakeStore` stays a pure module behind this port, which is why
 * it can be unit-tested with no database and why the service-role key never leaks
 * into the fabric library (and can never reach the browser bundle).
 *
 * The key is read from the environment, which on Cloud Run is populated from Secret
 * Manager. It is never logged, never returned in a response, and never embedded.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { PostgresGateway, DbFilter, DbSelectOptions } from "@/lib/fabric/intake/durable/postgresStore";

/**
 * Tables the durable worker is allowed to read directly. Anything else must go
 * through an RPC, so a bug (or a crafted table name) cannot turn this gateway into
 * a general-purpose service-role read primitive over the whole database.
 */
const READABLE_TABLES = new Set([
  "retail_intake_jobs",
  "retail_intake_worker_leases",
  "retail_intake_job_chunks",
  "retail_intake_checkpoints",
  "retail_intake_quarantine",
  "retail_intake_events",
  "retail_intake_dedup_keys",
  "retail_intake_product_index",
  "retail_intake_job_drafts",
]);

/** RPCs the durable worker is allowed to call (migrations 033 + 034). */
const CALLABLE_RPCS = new Set([
  "create_intake_job",
  "claim_next_intake_job",
  "claim_intake_job",
  "renew_intake_lease",
  "commit_intake_chunk",
  "set_intake_job_control",
  "finalize_intake_job",
  "fail_intake_job",
  "intake_job_reconciliation",
]);

/** Hard ceiling on any single page, mirroring the store's own page size. */
const MAX_LIMIT = 1000;

export class SupabaseIntakeGateway implements PostgresGateway {
  constructor(private readonly client: SupabaseClient) {}

  async rpc(fn: string, args: Record<string, unknown>): Promise<unknown> {
    if (!CALLABLE_RPCS.has(fn)) throw new Error(`rpc not allowed: ${fn}`);
    const { data, error } = await this.client.rpc(fn, args);
    // Rethrow the raw driver error: PostgresDurableIntakeStore classifies and
    // sanitizes it. Nothing between here and there logs it.
    if (error) throw error;
    return data;
  }

  async selectRows(table: string, filter: DbFilter, options?: DbSelectOptions): Promise<Record<string, unknown>[]> {
    if (!READABLE_TABLES.has(table)) throw new Error(`table not readable: ${table}`);

    let query = this.client.from(table).select("*");
    for (const [column, value] of Object.entries(filter)) {
      query = value === null ? query.is(column, null) : query.eq(column, value);
    }
    if (options?.orderBy) query = query.order(options.orderBy, { ascending: options.ascending ?? true });

    const limit = Math.min(options?.limit ?? MAX_LIMIT, MAX_LIMIT);
    const offset = options?.offset ?? 0;
    query = query.range(offset, offset + limit - 1);

    const { data, error } = await query;
    if (error) throw error;
    return (data ?? []) as Record<string, unknown>[];
  }
}
