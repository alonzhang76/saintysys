-- ============================================================
-- Supabase 初始化脚本
-- 包含：数据表 + Storage Bucket + RLS 策略
-- 在 Supabase → SQL Editor 中执行
-- ============================================================

-- ===== 一、创建数据表 =====

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

-- ===== 二、数据表 RLS =====

alter table public.app_submissions enable row level security;
alter table public.submission_files enable row level security;

-- 用户只能读写自己的提交
drop policy if exists "own_submissions" on public.app_submissions;
create policy "own_submissions"
  on public.app_submissions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- 用户只能读写自己的文件记录
drop policy if exists "own_submission_files" on public.submission_files;
create policy "own_submission_files"
  on public.submission_files
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ===== 三、Storage Bucket =====

-- 创建 app-photos 私有 Bucket（如果不存在）
insert into storage.buckets (id, name, public)
values ('app-photos', 'app-photos', false)
on conflict (id) do nothing;

-- ===== 四、Storage RLS 策略 =====
-- 路径约定：{userId}/{subFolder}/{randomUUID}-{fileName}
-- storage.foldername(name) 提取路径第一段作为 userId

-- 4.1 用户可上传自己的文件
drop policy if exists "users can upload own files" on storage.objects;
create policy "users can upload own files"
  on storage.objects
  for insert
  with check (
    bucket_id = 'app-photos'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

-- 4.2 用户可读取自己的文件
drop policy if exists "users can read own files" on storage.objects;
create policy "users can read own files"
  on storage.objects
  for select
  using (
    bucket_id = 'app-photos'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

-- 4.3 用户可删除自己的文件
drop policy if exists "users can delete own files" on storage.objects;
create policy "users can delete own files"
  on storage.objects
  for delete
  using (
    bucket_id = 'app-photos'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

-- 4.4 用户可更新自己的文件（覆盖上传）
drop policy if exists "users can update own files" on storage.objects;
create policy "users can update own files"
  on storage.objects
  for update
  using (
    bucket_id = 'app-photos'
    and auth.uid() = (storage.foldername(name))[1]::uuid
  );

-- ============================================================
-- 完成！验证方法：
-- 1. 在 Storage → Buckets 页面应看到 app-photos（Private）
-- 2. 在 Table Editor 应看到 app_submissions 和 submission_files
-- 3. 用管理员账号登录后上传图片测试
-- ============================================================
