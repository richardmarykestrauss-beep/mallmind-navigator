import { describe, it, expect } from "vitest";
/* eslint-disable @typescript-eslint/no-explicit-any */
// @ts-expect-error ESM .mjs
import { isHostedTarget, isLocalTarget, assertLocalDatabaseTarget, HOSTED_PROJECT_REFS } from "./hostedGuard.mjs";

describe("Sprint 2L-B hosted-environment guard", () => {
  const HOSTED = [
    "postgresql://postgres:pw@db.iivmrlgntspbkpfqoboi.supabase.co:5432/postgres",
    "postgresql://postgres:pw@db.qspsouemjtcdcfnivpnt.supabase.co:5432/postgres",
    "db.abcdefghijklmnop.supabase.co",
    "aws-0-eu-west-1.pooler.supabase.com",
    "https://iivmrlgntspbkpfqoboi.supabase.co",
    "iivmrlgntspbkpfqoboi",
  ];
  const LOCAL = [
    "localhost",
    "127.0.0.1",
    "postgresql://postgres:postgres@127.0.0.1:54322/postgres",
    "postgresql://postgres:postgres@localhost:54322/postgres",
    "supabase_db_mallmind-navigator",
    "host.docker.internal",
    "::1",
  ];

  it("flags every known hosted target as hosted, not local", () => {
    for (const t of HOSTED) {
      expect(isHostedTarget(t), t).toBe(true);
      expect(isLocalTarget(t), t).toBe(false);
    }
  });

  it("accepts recognised local disposable targets as local, not hosted", () => {
    for (const t of LOCAL) {
      expect(isHostedTarget(t), t).toBe(false);
      expect(isLocalTarget(t), t).toBe(true);
    }
  });

  it("assertLocalDatabaseTarget throws on hosted URLs and refs", () => {
    for (const t of HOSTED) {
      expect(() => assertLocalDatabaseTarget(t), t).toThrow(/HOSTED|not a recognised LOCAL/i);
    }
  });

  it("assertLocalDatabaseTarget returns the host for local targets", () => {
    expect(assertLocalDatabaseTarget("postgresql://postgres:postgres@127.0.0.1:54322/postgres")).toBe("127.0.0.1");
    expect(assertLocalDatabaseTarget("localhost")).toBe("localhost");
  });

  it("rejects unrecognised non-local hosts even when they are not Supabase", () => {
    expect(() => assertLocalDatabaseTarget("db.example.com")).toThrow(/not a recognised LOCAL/i);
    expect(() => assertLocalDatabaseTarget("10.20.30.40")).toThrow(/not a recognised LOCAL/i);
  });

  it("both production and dev hosted refs are covered", () => {
    expect(HOSTED_PROJECT_REFS).toContain("qspsouemjtcdcfnivpnt");
    expect(HOSTED_PROJECT_REFS).toContain("iivmrlgntspbkpfqoboi");
  });

  it("never leaks a password in the thrown message", () => {
    try {
      assertLocalDatabaseTarget("postgresql://postgres:SUPERSECRET@db.iivmrlgntspbkpfqoboi.supabase.co:5432/postgres");
    } catch (err: any) {
      expect(err.message).not.toContain("SUPERSECRET");
    }
  });
});
