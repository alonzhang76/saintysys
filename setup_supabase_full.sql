-- ============================================================
-- 舜天汉唐服装外贸系统 Supabase 初始化脚本（共享数据模式）
-- 在 Supabase → SQL Editor 中执行（只需执行一次）
-- 
-- 更新说明：
-- - app_data_store 改为共享模式：所有用户共享同一份数据
-- - RLS 策略改为允许所有已认证用户读写
-- - Storage 读取策略改为允许所有已认证用户读取所有图片
-- ============================================================

-- ===== 一、数据表 =====

-- 1) app_submissions（表单提交记录，按用户隔离）
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

-- 3) app_data_store（统一数据存储 — 共享模式）
--    所有用户共享同一份数据，不再按 user_id 隔离
create table if not exists public.app_data_store (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,  -- 仅记录最后修改者，不再有外键约束
  store_key text not null,
  payload jsonb default '{}'::jsonb,
  updated_at timestamptz default now()
);

-- ===== 一.五、迁移：从旧版 per-user 模式升级到共享模式 =====

-- 步骤1：合并重复数据（同一 store_key 多个 user_id 的行，只保留最新一条）
-- 注意：如果表是新建的，此步骤无影响
delete from public.app_data_store
where id not in (
  select distinct on (store_key) id
  from public.app_data_store
  order by store_key, updated_at desc
);

-- 步骤2：删除旧的 unique(user_id, store_key) 约束（名称可能不固定，逐一尝试）
do $$
declare
  conname_record record;
begin
  for conname_record in
    select conname from pg_constraint
    where conrelid = 'public.app_data_store'::regclass
    and contype = 'u'
  loop
    execute 'alter table public.app_data_store drop constraint if exists ' || conname_record.conname;
  end loop;
end $$;

-- 步骤3：添加新的 unique(store_key) 约束
alter table public.app_data_store
  drop constraint if exists app_data_store_store_key_key;
alter table public.app_data_store
  add constraint app_data_store_store_key_key unique (store_key);

-- 步骤4：user_id 改为可空（仅用于记录最后修改者）
alter table public.app_data_store alter column user_id drop not null;

-- ===== 二、数据表 RLS =====

alter table public.app_submissions enable row level security;
alter table public.submission_files enable row level security;
alter table public.app_data_store enable row level security;

-- app_submissions：用户只能读写自己的提交（保持不变）
drop policy if exists "own_submissions" on public.app_submissions;
create policy "own_submissions"
  on public.app_submissions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- submission_files：用户只能读写自己的文件记录（保持不变）
drop policy if exists "own_submission_files" on public.submission_files;
create policy "own_submission_files"
  on public.submission_files
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- app_data_store：所有已认证用户共享读写（新模式）
drop policy if exists "own_data_store" on public.app_data_store;
drop policy if exists "shared_data_store" on public.app_data_store;
create policy "shared_data_store"
  on public.app_data_store
  for all
  using (auth.role() = 'authenticated')
  with check (auth.role() = 'authenticated');

-- ===== 三、索引 =====

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

-- 上传：用户只能上传到自己 {userId}/ 目录下
drop policy if exists "users can upload own files" on storage.objects;
create policy "users can upload own files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'app-photos'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

-- 读取：所有已认证用户都可以读取所有图片（共享模式）
drop policy if exists "users can read own files" on storage.objects;
drop policy if exists "authenticated can read all files" on storage.objects;
create policy "authenticated can read all files"
  on storage.objects
  for select
  using (
    bucket_id = 'app-photos'
    and auth.role() = 'authenticated'
  );

-- 删除：用户只能删除自己 {userId}/ 目录下的文件
drop policy if exists "users can delete own files" on storage.objects;
create policy "users can delete own files"
  on storage.objects
  for delete
  using (
    bucket_id = 'app-photos'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

-- 更新：用户只能更新自己 {userId}/ 目录下的文件
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
-- 4. 换一台电脑登录，应能看到相同的数据
-- ============================================================
