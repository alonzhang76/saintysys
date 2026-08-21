-- ============================================================
-- Supabase 统一数据存储表
-- 存储各模块 key-value 数据，替代 localStorage
-- 在 Supabase → SQL Editor 中执行
-- ============================================================

-- app_data_store：每个用户的各模块数据
create table if not exists public.app_data_store (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  store_key text not null,
  payload jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique(user_id, store_key)
);

-- RLS
alter table public.app_data_store enable row level security;

drop policy if exists "own_data_store" on public.app_data_store;
create policy "own_data_store"
  on public.app_data_store
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 索引（加速查询）
create index if not exists idx_app_data_store_user_id
  on public.app_data_store (user_id);

create index if not exists idx_app_data_store_key
  on public.app_data_store (store_key);
