import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL, SUPABASE_ANON_KEY } from "./env";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type Mall = {
  id: string | number;
  name: string;
  city: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
  deleted_at: string | null;
};

export type Shop = {
  id: string | number;
  mall_id: string | number;
  name: string;
  floor: string | null;
  unit_number: string | null;
  category: string | null;
  opening_time: string | null;
  closing_time: string | null;
  opening_hours: string | null;
  deleted_at: string | null;
};

export type Product = {
  id: string | number;
  shop_id: string | number;
  mall_id: string | number | null;
  name: string;
  category: string | null;
  brand: string | null;
  model: string | null;
  price: number;
  original_price: number | null;
  is_on_special: boolean;
  special_description: string | null;
  image_url: string | null;
  in_stock: boolean;
  verified: boolean;
  data_quality_status?: string | null;
  price_verified_at?: string | null;
  price_verification_method?: string | null;
  data_source?: string | null;
  verified_by?: string | null;
  deleted_at: string | null;
  shops?: Shop;
};

export type Profile = {
  id: string;
  username: string | null;
  full_name: string | null;
  xp: number;
  level: number;
  subscription_status: string;
  is_admin: boolean;
};

export type ParkingSpot = {
  id?: string | number;
  user_id: string;
  mall_id?: string | number | null;
  latitude: number;
  longitude: number;
  zone: string | null;
  floor: string | null;
  notes: string | null;
  created_at?: string;
};

export type ShoppingListItem = {
  id?: string | number;
  name: string;
  created_at?: string;
};

export type BestDeal = {
  // best_deals is a view — no id column; use row index as UI key
  product_name: string;
  brand: string | null;
  category: string | null;
  shop_name: string;
  mall_name: string | null;
  price: number;
  original_price: number | null;
  is_on_special: boolean;
  discount_percent: number;
  floor: string | null;
  unit_number: string | null;
  price_rank: number | null;
};


export type ImportJob = {
  id: string;
  created_at: string;
  started_by: string | null;
  mall_id: string | number | null;
  shop_id: string | number | null;
  status: "pending" | "processing" | "done" | "failed";
  total_rows: number | null;
  imported_rows: number | null;
  skipped_rows: number | null;
  error_summary: string | null;
  source_file: string | null;
  data_source: string | null;
};

export type AdminAuditLog = {
  id: string;
  created_at: string;
  admin_id: string | null;
  action: string;
  table_name: string | null;
  row_id: string | null;
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
};
