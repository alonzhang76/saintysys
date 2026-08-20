-- ============================================================
-- 舜天汉唐服装外贸系统 Supabase 初始化脚本
-- 在 Supabase → SQL Editor 中执行（只需执行一次）
-- ============================================================

-- ===== 一、数据表 =====

-- 1) app_submissions（表单提交记录）
create table if not exists public.app_submissions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  form_type text,
  payload jsonb,
  status text default 'submitted',
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- 2) submission_files（上传文件记录）
create table if not exists public.submission_files (
  id uuid primary key default gen_random_uuid(),
  submission_id uuid references public.app_submissions(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  bucket_name text,
  file_path text,
  file_name text,
  mime_type text,
  file_size bigint,
  created_at timestamptz default now()
);

-- 3) app_data_store（统一数据存储，替代 localStorage）
create table if not exists public.app_data_store (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  store_key text not null,
  payload jsonb default '{}'::jsonb,
  updated_at timestamptz default now(),
  unique(user_id, store_key)
);

-- ===== 二、数据表 RLS =====

alter table public.app_submissions enable row level security;
alter table public.submission_files enable row level security;
alter table public.app_data_store enable row level security;

-- app_submissions：用户只能读写自己的提交
drop policy if exists "own_submissions" on public.app_submissions;
create policy "own_submissions"
  on public.app_submissions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- submission_files：用户只能读写自己的文件记录
drop policy if exists "own_submission_files" on public.submission_files;
create policy "own_submission_files"
  on public.submission_files
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- app_data_store：用户只能读写自己的数据
drop policy if exists "own_data_store" on public.app_data_store;
create policy "own_data_store"
  on public.app_data_store
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== 三、索引 =====

create index if not exists idx_app_data_store_user_id
  on public.app_data_store (user_id);

create index if not exists idx_app_data_store_key
  on public.app_data_store (store_key);

create index if not exists idx_app_submissions_user_id
  on public.app_submissions (user_id);

create index if not exists idx_app_submissions_form_type
  on public.app_submissions (form_type);

create index if not exists idx_submission_files_user_id
  on public.submission_files (user_id);

-- ===== 四、Storage Bucket =====

insert into storage.buckets (id, name, public)
values ('app-photos', 'app-photos', false)
on conflict (id) do nothing;

-- ===== 五、Storage RLS 策略 =====
-- 路径约定：{userId}/{subFolder}/{randomUUID}-{fileName}
-- storage.foldername(name) 提取路径第一段作为 userId

drop policy if exists "users can upload own files" on storage.objects;
create policy "users can upload own files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'app-photos'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

drop policy if exists "users can read own files" on storage.objects;
create policy "users can read own files"
  on storage.objects
  for select
  using (
    bucket_id = 'app-photos'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

drop policy if exists "users can delete own files" on storage.objects;
create policy "users can delete own files"
  on storage.objects
  for delete
  using (
    bucket_id = 'app-photos'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

drop policy if exists "users can update own files" on storage.objects;
create policy "users can update own files"
  on storage.objects
  for update
  using (
    bucket_id = 'app-photos'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

-- ============================================================
-- ✅ 完成！
-- 验证方法：
-- 1. Table Editor 应看到 app_submissions、submission_files、app_data_store
-- 2. Storage → Buckets 应看到 app-photos（Private）
-- 3. 登录后在设置页点击「同步到云端」测试迁移
-- ============================================================
