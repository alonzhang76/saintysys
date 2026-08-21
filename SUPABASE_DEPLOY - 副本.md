# Supabase 云端存储接入 - 部署指南

## 一、需要执行的 SQL

在 Supabase → SQL Editor 中执行 **`setup_supabase_full.sql`**（只需执行一次）

该脚本包含：
- `app_submissions` 表（表单提交记录）
- `submission_files` 表（文件上传记录）
- `app_data_store` 表（统一数据存储，替代 localStorage）
- 3 张表的 RLS 策略
- `app-photos` 私有 Storage Bucket
- Storage 的 RLS 策略（insert/select/update/delete）
- 索引优化

## 二、新增文件

| 文件 | 作用 |
|---|---|
| `js/supabase-store.js` | 统一数据存储层：内存缓存 + Supabase 云端读写 + localStorage 自动迁移 |
| `js/localstorage-patch.js` | 全局替换 localStorage.getItem/setItem，使现有代码自动走 Supabase |
| `js/supabase-bridge.js` | 桥接 App.store 到 SupabaseStore |
| `setup_supabase_full.sql` | 完整数据库初始化脚本 |

## 三、修改的 7 个页面

| 页面 | 修改内容 |
|---|---|
| `sample.html` | 添加 4 个 Supabase 存储模块 + 内联脚本等待 SupabaseReady |
| `contacts.html` | 同上 |
| `express.html` | 同上 |
| `shipping.html` | 同上 |
| `order.html` | 同上 |
| `maintenance.html` | 同上 |
| `settings.html` | 同上 + 清空数据同步 + 新增「☁️ 同步到云端」按钮 |

## 四、工作原理

### 数据流

```
页面代码
  ↓ App.store.get(key) / localStorage.getItem(key)
  ↓
SupabaseStore.getSync(key) → 内存缓存
  ↓
SupabaseStore.setSync(key, value) → 内存缓存 + 异步写入 Supabase
```

### 初始化流程

```
1. 页面加载 → 经典脚本（common.js, auth-guard.js）
2. Module 脚本加载（supabase.js, supabase-store.js, localstorage-patch.js, supabase-bridge.js）
   - supabase-store.js 自动调用 init()：
     a. 检查登录状态
     b. 迁移 localStorage 数据到 Supabase（仅首次）
     c. 从 Supabase 加载所有数据到内存缓存
   - localstorage-patch.js 替换 localStorage 方法
   - supabase-bridge.js 替换 App.store
3. window.SupabaseReady resolve
4. 内联脚本执行：App.init() → App.initSampleData() → 业务代码
   - 所有数据操作通过补丁自动走 Supabase
```

### 数据迁移

首次登录时，`supabase-store.js` 自动将 localStorage 中的数据迁移到 Supabase：
- 仅迁移 Supabase 中不存在的 key（不覆盖云端数据）
- 迁移后数据同时存在于 localStorage（备份）和 Supabase

### 跨设备访问

用户在任意设备登录后：
1. `supabase-store.js` 自动从 Supabase 加载该用户的所有数据
2. 数据缓存在内存中，所有页面操作实时同步到 Supabase
3. 另一台设备登录时可看到相同的数据

## 五、使用说明

### 同步到云端

在「设置」页面点击 **☁️ 同步到云端** 按钮，强制将当前 localStorage 中的所有数据写入 Supabase。

### 查看/编辑/删除

- 所有页面的列表、编辑、删除操作自动走 Supabase
- 删除记录时同时删除 Supabase Storage 中的图片文件
- 清空数据时同时清空 Supabase 中的数据

### 安全说明

- 所有数据按 `user_id` 隔离，用户只能看到自己的数据
- 图片存储在私有 Bucket，通过 signed URL 访问
- 前端仅使用 anon key，RLS 策略保证数据安全
- 管理员权限需要在 Supabase 用户 metadata 中设置 `{"role":"admin"}`

## 六、部署步骤

```bash
# 1. 提交所有文件
git add -A
git commit -m "接入 Supabase 云端存储"

# 2. 推送到 GitHub
git push origin main

# 3. 等待 Vercel 自动部署完成

# 4. 访问 https://www.lori.net.cn/login.html 测试
```

## 七、验证清单

- [ ] Supabase SQL Editor 已执行 `setup_supabase_full.sql`
- [ ] 登录后能正常看到数据
- [ ] 在一台电脑添加数据后，另一台电脑登录能看到
- [ ] 样衣计划的图片能上传到 Supabase Storage
- [ ] 设置页的「同步到云端」按钮可用
- [ ] 控制台无错误信息（除了初始化时的迁移日志）
