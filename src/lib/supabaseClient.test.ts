import { describe, it, expect } from "vitest";
import { supabase, SUPABASE_CONFIGURED } from "./supabaseClient";

describe("supabaseClient — a build without backend config must still boot", () => {
  it("creates a client without throwing when VITE_SUPABASE_* are absent, and says so", () => {
    // vitest runs without VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY (only .env is loaded, which holds public config).
    expect(SUPABASE_CONFIGURED).toBe(false);
    expect(supabase).toBeTruthy();
    expect(typeof supabase.from).toBe("function");
  });
});
