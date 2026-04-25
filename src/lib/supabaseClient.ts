import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://qspsouemjtcdcfnivpnt.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_46teArH5kq3ndUUBHwLsjw_NnFRGCsI";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type Mall = {
  id: string | number;
  name: string;
  city: string | null;
  province: string | null;
};

export type ShoppingListItem = {
  id?: string | number;
  name: string;
  created_at?: string;
};

export type BestDeal = {
  id: string | number;
  product_name: string;
  shop_name: string;
  price: number;
  discount_percentage: number;
};
