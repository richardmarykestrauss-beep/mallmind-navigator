import { Router, Request, Response } from "express";
import { getSupabaseClient } from "../lib/supabase.js";

const router = Router();

const ALLOWED_METHODS = [
  "phone",
  "website",
  "flyer",
  "receipt",
  "store_visit",
  "retailer_confirmation",
  "scraper",
  "retailer_api",
  "user_submission",
] as const;

type VerificationMethod = typeof ALLOWED_METHODS[number];

function getBearerToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length).trim();
}

router.post("/verify-product-price", async (req: Request, res: Response) => {
  try {
    const supabase = getSupabaseClient();
    const token = getBearerToken(req);

    if (!token) {
      return res.status(401).json({ error: "Missing Authorization bearer token" });
    }

    const { data: userData, error: userError } = await supabase.auth.getUser(token);

    if (userError || !userData.user) {
      return res.status(401).json({ error: "Invalid or expired auth token" });
    }

    const user = userData.user;

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, username, full_name, is_admin")
      .eq("id", user.id)
      .maybeSingle();

    if (profileError) {
      return res.status(500).json({ error: `Failed to check admin profile: ${profileError.message}` });
    }

    if (!profile?.is_admin) {
      return res.status(403).json({ error: "Not authorized. Admin access required." });
    }

    const {
      product_id,
      price_verification_method,
      data_source,
      verified_by,
    } = req.body as {
      product_id?: string;
      price_verification_method?: VerificationMethod;
      data_source?: string;
      verified_by?: string;
    };

    if (!product_id) {
      return res.status(400).json({ error: "product_id is required" });
    }

    if (!price_verification_method || !ALLOWED_METHODS.includes(price_verification_method)) {
      return res.status(400).json({
        error: "Invalid price_verification_method",
        allowed_methods: ALLOWED_METHODS,
      });
    }

    const verifiedAt = new Date().toISOString();
    const verifiedBy =
      verified_by?.trim() ||
      profile.full_name ||
      profile.username ||
      user.email ||
      user.id;

    const { data: beforeRows } = await supabase
      .from("products")
      .select("*")
      .eq("id", product_id)
      .limit(1);

    const before = beforeRows?.[0] ?? null;

    const { data: product, error: updateError } = await supabase
      .from("products")
      .update({
        data_quality_status: "manually_verified",
        price_verified_at: verifiedAt,
        price_verification_method,
        data_source: data_source?.trim() || null,
        verified_by: verifiedBy,
      })
      .eq("id", product_id)
      .select(
        "id, name, price, data_quality_status, price_verified_at, price_verification_method, data_source, verified_by"
      )
      .single();

    if (updateError) {
      return res.status(500).json({ error: `Failed to verify product price: ${updateError.message}` });
    }

    await supabase.from("admin_audit_log").insert({
      admin_id: user.id,
      action: "verify_product_price",
      table_name: "products",
      row_id: product_id,
      old_values: before,
      new_values: product,
    });

    return res.json({
      verified: true,
      product,
    });
  } catch (error) {
    console.error("[admin verify product]", error);
    return res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
