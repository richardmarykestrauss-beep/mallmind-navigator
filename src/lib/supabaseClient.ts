import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://qspsouemjtcdcfnivpnt.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFzcHNvdWVtanRjZGNmbml2cG50Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzcxMTIzNTAsImV4cCI6MjA5MjY4ODM1MH0.f94Lbzo-EgmcMsklgYiWW6tNhM4hvGm2Z8_37Xp8nkg";

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

export type Mall = {
  id: string | number;
  name: string;
  city: string | null;
  province: string | null;
  lat: number | null;
  lng: number | null;
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
