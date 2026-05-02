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

export type Shop = {
  id: string | number;
  mall_id: string | number;
  name: string;
  floor: string | null;
  unit_number: string | null;
  category: string | null;
  opening_hours: string | null;
};

export type Product = {
  id: string | number;
  shop_id: string | number;
  name: string;
  category: string | null;
  price: number;
  special_price: number | null;
  is_on_special: boolean;
  shops?: Shop;
};

export type Profile = {
  id: string;
  username: string | null;
  full_name: string | null;
  xp: number;
  level: number;
  subscription_status: string;
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
  id: string | number;
  product_name: string;
  shop_name: string;
  price: number;
  discount_percentage: number;
};
