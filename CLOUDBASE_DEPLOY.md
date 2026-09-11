# CloudBase 部署与迁移指南

本项目已从 **GitHub + Vercel + Supabase** 迁移到 **GitHub + 腾讯云开发 CloudBase**。

## 一、整体架构

```
GitHub (代码仓库)
   │
   └── GitHub Actions (自动部署)
         │
         ├── 静态托管 (CloudBase Hosting)  ← HTML/CSS/JS 前端
         ├── 云数据库 (CloudBase Database)  ← app_data_store / app_submissions / submission_files
         ├── 云存储 (CloudBase Storage)      ← 图片/文件（私有桶，签名 URL 访问）
         ├── 云函数 (tcb-file-list)          ← 列目录（前端 SDK 无此能力）
         └── 云认证 (CloudBase Auth)          ← 邮箱密码登录
```

## 二、迁移前准备

### 2.1 创建 CloudBase 环境

1. 登录 [腾讯云开发控制台](https://console.cloud.tencent.com/tcb)
2. 点击「新建环境」，选择「按量计费」或「包年包月」
3. 记录 **环境 ID**（如 `aiot-xxxxxxxx`），后续配置需要

### 2.2 开启匿名登录（共享数据读取需要）

1. 进入环境 → 「身份认证」→「登录方式」
2. 开启「匿名登录」
3. 开启「邮箱登录」（用于用户账号体系）

### 2.3 配置安全域名

1. 进入环境 → 「环境配置」→「安全配置」
2. 添加前端访问域名（本地开发加 `http://localhost` 和 `file://`）
3. 添加静态托管域名（部署后获取）

### 2.4 创建数据库集合

在「云数据库」中创建以下集合（权限先设为「所有用户可读，仅创建者可写」，后续按需收紧）：

| 集合名 | 用途 | 权限建议 |
|--------|------|----------|
| `app_data_store` | 各模块键值数据（订单、款式、通讯录等） | 所有用户可读，登录用户可写 |
| `app_submissions` | 表单提交记录 | 仅创建者可读写 |
| `submission_files` | 上传文件元数据 | 仅创建者可读写 |

> 注意：CloudBase 数据库是文档型（类似 MongoDB），不是关系型。`app_data_store` 以 `store_key` 作为文档 `_id`，实现天然防重。

## 三、配置前端

### 3.1 填写 CloudBase 配置

编辑 `js/cloudbase.js`，修改顶部配置：

```javascript
export const CLOUDBASE_ENV = "你的环境ID";      // 如 "aiot-xxxxxxxx"
export const CLOUDBASE_REGION = "ap-shanghai";   // 环境所属地域
export const CLOUDBASE_ACCESS_KEY = "";           // 可选，Publishable Key
```

### 3.2 配置管理员邮箱

编辑 `js/admin-config.js`，将管理员邮箱加入白名单。

## 四、数据迁移（Supabase → CloudBase）

### 4.1 安装迁移依赖

```bash
cd /path/to/project
npm install @cloudbase/node-sdk node-fetch@2
```

### 4.2 设置环境变量

```bash
export SUPABASE_URL="https://ugoyacuagslqhqguxyqe.supabase.co"
export SUPABASE_SERVICE_KEY="你的-supabase-service-role-key"
export TCB_ENV_ID="你的-cloudbase-环境ID"
export TCB_SECRET_ID="你的-腾讯云-SecretId"
export TCB_SECRET_KEY="你的-腾讯云-SecretKey"
```

> ⚠️ `SUPABASE_SERVICE_KEY` 是 **service_role** 密钥，不是 anon key。可在 Supabase 控制台 → Settings → API 中找到。

### 4.3 执行迁移

```bash
node scripts/migrate-supabase-to-cloudbase.mjs
```

迁移内容：
- `app_data_store` 表数据
- `app_submissions` 表数据
- `submission_files` 表数据
- 云存储文件（从 Supabase Storage 下载 → 上传到 CloudBase Storage）

### 4.4 验证数据

登录 CloudBase 控制台 → 云数据库，确认三个集合均有数据。

## 五、部署云函数

### 5.1 安装 CloudBase CLI

```bash
npm install -g @cloudbase/cli
```

### 5.2 登录

```bash
tcb login
```

### 5.3 部署 tcb-file-list 云函数

```bash
cd cloudfunctions/tcb-file-list
npm install --production
cd ../..
tcb fn deploy tcb-file-list -e 你的环境ID
```

> 此云函数用于列出云存储目录内容，前端 `storage.from().list()` 底层调用它。

## 六、配置 GitHub Actions 自动部署

### 6.1 在 GitHub 仓库添加 Secrets

进入仓库 → Settings → Secrets and variables → Actions，添加：

| Secret 名称 | 值 |
|-------------|-----|
| `TCB_ENV_ID` | CloudBase 环境 ID |
| `TCB_SECRET_ID` | 腾讯云 SecretId |
| `TCB_SECRET_KEY` | 腾讯云 SecretKey |

### 6.2 推送代码触发部署

```bash
git add .
git commit -m "migrate to CloudBase"
git push origin main
```

GitHub Actions 会自动：
1. 部署静态文件到 CloudBase 静态托管
2. 部署 `tcb-file-list` 云函数

### 6.3 获取访问域名

部署完成后，在 CloudBase 控制台 → 静态网站托管 → 查看默认域名。

## 七、验证清单

- [ ] 填写 `js/cloudbase.js` 中的 `CLOUDBASE_ENV`
- [ ] CloudBase 控制台开启匿名登录 + 邮箱登录
- [ ] 创建三个集合：`app_data_store`、`app_submissions`、`submission_files`
- [ ] 执行数据迁移脚本
- [ ] 部署 `tcb-file-list` 云函数
- [ ] 配置 GitHub Secrets (`TCB_ENV_ID` / `TCB_SECRET_ID` / `TCB_SECRET_KEY`)
- [ ] 推送代码，确认 Actions 部署成功
- [ ] 访问静态托管域名，登录测试
- [ ] 测试数据同步（多端编辑同一数据）
- [ ] 测试图片上传与预览

## 八、常见问题

### Q1: 登录失败，提示网络错误
- 检查 CloudBase 安全域名是否已添加当前访问域名
- 检查邮箱登录是否已开启

### Q2: 图片不显示
- 确认 `tcb-file-list` 云函数已部署
- 云存储为私有桶，必须通过 `createSignedUrl` 获取临时签名 URL
- 检查浏览器控制台是否有签名 URL 报错

### Q3: 数据不同步
- 确认 `app_data_store` 集合权限允许登录用户读写
- 检查浏览器控制台是否有 CloudBase SDK 报错
- 确认匿名登录已开启（共享数据读取需要）

### Q4: GitHub Actions 部署失败
- 确认三个 Secrets 已正确配置
- 确认 `@cloudbase/cli` 版本兼容
- 查看 Actions 日志中的具体错误
