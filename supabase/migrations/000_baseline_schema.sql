-- =============================================================================
-- MallMind compatibility baseline
--
-- Reconstructs the foundational Supabase schema that existed before migration
-- 001 entered source control.
--
-- Build OS rule:
--   - Required for disposable local database reconstruction.
--   - Never push this baseline to the existing linked production project.
--   - Production already contains these objects and records migrations 001–032.
-- =============================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Core catalogue
-- ---------------------------------------------------------------------------

create table if not exists public.malls (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  province text not null,
  address text,
  latitude numeric(10,8),
  longitude numeric(11,8),
  total_floors integer default 1,
  total_shops integer default 0,
  image_url text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.shops (
  id uuid primary key default gen_random_uuid(),
  mall_id uuid references public.malls(id) on delete cascade,
  name text not null,
  category text not null,
  floor text default 'G',
  unit_number text,
  description text,
  logo_url text,
  opening_time time default '09:00',
  closing_time time default '21:00',
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.products (
  id uuid primary key default gen_random_uuid(),
  shop_id uuid references public.shops(id) on delete cascade,
  mall_id uuid references public.malls(id) on delete cascade,
  name text not null,
  category text not null,
  brand text,
  model text,
  price numeric(10,2) not null,
  original_price numeric(10,2),
  is_on_special boolean default false,
  special_description text,
  image_url text,
  in_stock boolean default true,
  submitted_by uuid,
  verified boolean default false,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- User profile and rewards
-- ---------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique,
  full_name text,
  avatar_url text,
  subscription_status text default 'free',
  subscription_expires_at timestamptz,
  favourite_mall_id uuid references public.malls(id),
  total_saved numeric(10,2) default 0,
  xp_points integer default 0,
  level integer default 1,
  created_at timestamptz default now()
);

create table if not exists public.achievements (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  description text,
  icon text,
  xp_reward integer default 100,
  condition_type text,
  condition_value integer
);

create table if not exists public.user_achievements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  achievement_id uuid references public.achievements(id),
  unlocked_at timestamptz default now(),
  unique (user_id, achievement_id)
);

-- ---------------------------------------------------------------------------
-- Shopper utility tables
-- ---------------------------------------------------------------------------

create table if not exists public.parking_spots (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  mall_id uuid references public.malls(id),
  zone text,
  entrance text,
  floor text,
  latitude numeric(10,8),
  longitude numeric(11,8),
  notes text,
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.shopping_lists (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id) on delete cascade,
  name text default 'My Shopping List',
  mall_id uuid references public.malls(id),
  is_active boolean default true,
  created_at timestamptz default now()
);

create table if not exists public.shopping_list_items (
  id uuid primary key default gen_random_uuid(),
  list_id uuid references public.shopping_lists(id) on delete cascade,
  item_name text not null,
  category text,
  quantity integer default 1,
  target_price numeric(10,2),
  best_price numeric(10,2),
  best_shop_id uuid references public.shops(id),
  status text default 'searching',
  is_checked boolean default false,
  created_at timestamptz default now()
);

create table if not exists public.price_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(id),
  shop_id uuid references public.shops(id),
  mall_id uuid references public.malls(id),
  product_name text not null,
  brand text,
  price numeric(10,2) not null,
  is_on_special boolean default false,
  image_url text,
  verified boolean default false,
  upvotes integer default 0,
  created_at timestamptz default now()
);

-- ---------------------------------------------------------------------------
-- Foundational views
-- ---------------------------------------------------------------------------

create or replace view public.best_deals as
select
  p.id,
  p.name as product_name,
  p.brand,
  p.category,
  p.price,
  p.original_price,
  p.is_on_special,
  case
    when p.original_price is not null and p.original_price > 0
      then round(((p.original_price - p.price) / p.original_price) * 100, 0)
    else 0
  end as discount_percentage,
  s.name as shop_name,
  s.floor,
  s.unit_number,
  m.name as mall_name
from public.products p
join public.shops s on s.id = p.shop_id
join public.malls m on m.id = p.mall_id
where p.in_stock = true;

create or replace view public.mall_summary as
select
  m.*,
  count(distinct s.id) as shop_count,
  count(distinct p.id) filter (where p.is_on_special = true) as active_deals
from public.malls m
left join public.shops s on s.mall_id = m.id
left join public.products p on p.mall_id = m.id
group by m.id;

-- ---------------------------------------------------------------------------
-- Auth profile provisioning
-- ---------------------------------------------------------------------------

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id,
    full_name,
    avatar_url
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Foundational RLS
-- ---------------------------------------------------------------------------

alter table public.malls enable row level security;
alter table public.shops enable row level security;
alter table public.products enable row level security;
alter table public.profiles enable row level security;
alter table public.parking_spots enable row level security;
alter table public.shopping_lists enable row level security;
alter table public.shopping_list_items enable row level security;
alter table public.price_submissions enable row level security;

create policy "Anyone can view malls"
  on public.malls for select
  using (true);

create policy "Anyone can view shops"
  on public.shops for select
  using (true);

create policy "Anyone can view products"
  on public.products for select
  using (true);

create policy "Users can view own profile"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Users can manage own parking"
  on public.parking_spots
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own lists"
  on public.shopping_lists
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users can manage own list items"
  on public.shopping_list_items
  using (
    auth.uid() = (
      select sl.user_id
      from public.shopping_lists sl
      where sl.id = shopping_list_items.list_id
    )
  )
  with check (
    auth.uid() = (
      select sl.user_id
      from public.shopping_lists sl
      where sl.id = shopping_list_items.list_id
    )
  );

create policy "Anyone can view price submissions"
  on public.price_submissions for select
  using (true);

create policy "Users can insert own submissions"
  on public.price_submissions for insert
  with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------------
-- Foundational grants
-- ---------------------------------------------------------------------------

grant usage on schema public to anon, authenticated, service_role;
grant select on public.malls, public.shops, public.products to anon, authenticated;
grant select on public.best_deals, public.mall_summary to anon, authenticated;
grant all on all tables in schema public to service_role;
grant execute on function public.handle_new_user() to anon, authenticated, service_role;
