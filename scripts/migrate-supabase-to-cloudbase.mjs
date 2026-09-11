/* ===== 数据迁移脚本：Supabase → CloudBase =====
 *
 * 用法：
 *   1. 安装依赖：npm install @cloudbase/node-sdk node-fetch@2
 *   2. 设置环境变量（或直接修改下方 CONFIG 对象）：
 *        SUPABASE_URL        Supabase 项目 URL
 *        SUPABASE_SERVICE_KEY Supabase service_role 密钥（有全部权限，非 anon key）
 *        TCB_ENV_ID          CloudBase 环境 ID
 *        TCB_SECRET_ID       腾讯云 SecretId
 *        TCB_SECRET_KEY      腾讯云 SecretKey
 *   3. 执行：node scripts/migrate-supabase-to-cloudbase.mjs
 *
 * 迁移内容：
 *   - 数据库表：app_data_store, app_submissions, submission_files
 *   - 云存储文件：从 Supabase Storage 下载后上传到 CloudBase Storage
 *
 * 注意：
 *   - 本脚本为一次性迁移工具，执行前请务必备份 Supabase 数据
 *   - 建议先在 CloudBase 控制台创建好对应集合（app_data_store / app_submissions / submission_files）
 *   - 大文件迁移可能耗时较长，可分批执行
 */

import fetch from "node-fetch";
import cloudbase from "@cloudbase/node-sdk";
import fs from "fs";
import path from "path";

/* ============ 配置 ============ */
const CONFIG = {
  SUPABASE_URL: process.env.SUPABASE_URL || "https://ugoyacuagslqhqguxyqe.supabase.co",
  SUPABASE_SERVICE_KEY: process.env.SUPABASE_SERVICE_KEY || "",
  TCB_ENV_ID: process.env.TCB_ENV_ID || "your-env-id",
  TCB_SECRET_ID: process.env.TCB_SECRET_ID || "",
  TCB_SECRET_KEY: process.env.TCB_SECRET_KEY || "",
  // 是否迁移存储文件（设为 false 只迁移数据库）
  MIGRATE_STORAGE: process.env.MIGRATE_STORAGE !== "false",
  // 存储桶名
  SUPABASE_BUCKET: process.env.SUPABASE_BUCKET || "app-photos",
};

/* ============ 初始化 ============ */
if (!CONFIG.SUPABASE_SERVICE_KEY) {
  console.error("❌ 请设置 SUPABASE_SERVICE_KEY 环境变量（service_role 密钥）");
  process.exit(1);
}
if (!CONFIG.TCB_SECRET_ID || !CONFIG.TCB_SECRET_KEY) {
  console.error("❌ 请设置 TCB_SECRET_ID 和 TCB_SECRET_KEY 环境变量");
  process.exit(1);
}
if (CONFIG.TCB_ENV_ID === "your-env-id") {
  console.error("❌ 请设置 TCB_ENV_ID 为真实的 CloudBase 环境 ID");
  process.exit(1);
}

const tcbApp = cloudbase.init({
  env: CONFIG.TCB_ENV_ID,
  secretId: CONFIG.TCB_SECRET_ID,
  secretKey: CONFIG.TCB_SECRET_KEY,
});

const db = tcbApp.database();
const storage = tcbApp.storage();

/* ============ 工具函数 ============ */
async function supabaseQuery(table, select = "*", filters = {}) {
  let url = `${CONFIG.SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(select)}`;
  for (const [k, v] of Object.entries(filters)) {
    url += `&${encodeURIComponent(k)}=${encodeURIComponent(v)}`;
  }
  const resp = await fetch(url, {
    headers: {
      apikey: CONFIG.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_SERVICE_KEY}`,
    },
  });
  if (!resp.ok) {
    throw new Error(`Supabase query ${table} failed: HTTP ${resp.status}`);
  }
  return resp.json();
}

async function supabaseInsert(table, rows) {
  if (!rows || rows.length === 0) return;
  const resp = await fetch(`${CONFIG.SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: CONFIG.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${CONFIG.SUPABASE_SERVICE_KEY}`,
      Prefer: "return=minimal",
    },
    body: JSON.stringify(rows),
  });
  if (!resp.ok) {
    throw new Error(`Supabase insert ${table} failed: HTTP ${resp.status}`);
  }
}

// 将 Supabase 行转换为 CloudBase 文档（id → _id）
function toCloudbaseDoc(row, idField = "id") {
  const doc = { ...row };
  if (doc[idField] !== undefined) {
    doc._id = String(doc[idField]);
    delete doc[idField];
  }
  return doc;
}

async function tcbUpsert(collection, docs, idField = "id") {
  if (!docs || docs.length === 0) return 0;
  let success = 0;
  for (const row of docs) {
    try {
      const doc = toCloudbaseDoc(row, idField);
      const _id = doc._id;
      if (_id) {
        // 以 id 为文档 ID，set 实现 upsert
        await db.collection(collection).doc(_id).set(doc);
      } else {
        await db.collection(collection).add(doc);
      }
      success++;
    } catch (e) {
      console.warn(`  ⚠️ ${collection} 写入失败:`, e.message);
    }
  }
  return success;
}

/* ============ 迁移数据库 ============ */
async function migrateDataStore() {
  console.log("\n📦 迁移 app_data_store ...");
  const rows = await supabaseQuery("app_data_store", "*");
  console.log(`  共 ${rows.length} 条记录`);
  const count = await tcbUpsert("app_data_store", rows, "store_key");
  console.log(`  ✅ 成功写入 ${count} 条`);
}

async function migrateSubmissions() {
  console.log("\n📦 迁移 app_submissions ...");
  const rows = await supabaseQuery("app_submissions", "*");
  console.log(`  共 ${rows.length} 条记录`);
  const count = await tcbUpsert("app_submissions", rows, "id");
  console.log(`  ✅ 成功写入 ${count} 条`);
}

async function migrateSubmissionFiles() {
  console.log("\n📦 迁移 submission_files ...");
  const rows = await supabaseQuery("submission_files", "*");
  console.log(`  共 ${rows.length} 条记录`);
  const count = await tcbUpsert("submission_files", rows, "id");
  console.log(`  ✅ 成功写入 ${count} 条`);
}

/* ============ 迁移存储文件 ============ */
async function migrateStorage() {
  if (!CONFIG.MIGRATE_STORAGE) {
    console.log("\n⏭️  跳过存储迁移（MIGRATE_STORAGE=false）");
    return;
  }
  console.log(`\n📁 迁移存储桶 ${CONFIG.SUPABASE_BUCKET} ...`);

  // 1) 列出 Supabase 存储桶中所有文件
  const listResp = await fetch(
    `${CONFIG.SUPABASE_URL}/storage/v1/object/list/${CONFIG.SUPABASE_BUCKET}`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: CONFIG.SUPABASE_SERVICE_KEY,
        Authorization: `Bearer ${CONFIG.SUPABASE_SERVICE_KEY}`,
      },
      body: JSON.stringify({ prefix: "", limit: 1000, offset: 0 }),
    }
  );
  if (!listResp.ok) {
    console.warn(`  ⚠️ 无法列出 Supabase 存储文件: HTTP ${listResp.status}`);
    return;
  }
  const fileList = await listResp.json();
  if (!Array.isArray(fileList)) {
    console.warn("  ⚠️ Supabase 返回的文件列表不是数组");
    return;
  }
  console.log(`  共 ${fileList.length} 个文件`);

  let success = 0;
  let failed = 0;
  for (const item of fileList) {
    if (!item || item.type === "folder") continue;
    const filePath = item.name;
    try {
      // 2) 从 Supabase 下载文件
      const dlResp = await fetch(
        `${CONFIG.SUPABASE_URL}/storage/v1/object/${CONFIG.SUPABASE_BUCKET}/${encodeURIComponent(filePath)}`,
        {
          headers: {
            apikey: CONFIG.SUPABASE_SERVICE_KEY,
            Authorization: `Bearer ${CONFIG.SUPABASE_SERVICE_KEY}`,
          },
        }
      );
      if (!dlResp.ok) throw new Error(`download HTTP ${dlResp.status}`);
      const buffer = Buffer.from(await dlResp.arrayBuffer());

      // 3) 上传到 CloudBase
      await storage.uploadFile({
        cloudPath: filePath,
        fileContent: buffer,
      });
      success++;
      if (success % 20 === 0) {
        console.log(`  ... 已迁移 ${success}/${fileList.length}`);
      }
    } catch (e) {
      failed++;
      console.warn(`  ⚠️ 文件迁移失败: ${filePath} - ${e.message}`);
    }
  }
  console.log(`  ✅ 存储迁移完成：成功 ${success}，失败 ${failed}`);
}

/* ============ 主流程 ============ */
async function main() {
  console.log("========================================");
  console.log("Supabase → CloudBase 数据迁移");
  console.log(`Supabase: ${CONFIG.SUPABASE_URL}`);
  console.log(`CloudBase: ${CONFIG.TCB_ENV_ID}`);
  console.log("========================================");

  try {
    await migrateDataStore();
    await migrateSubmissions();
    await migrateSubmissionFiles();
    await migrateStorage();

    console.log("\n🎉 全部迁移完成！");
    console.log("\n⚠️  后续步骤：");
    console.log("  1. 在 CloudBase 控制台确认数据已写入对应集合");
    console.log("  2. 配置集合权限（app_data_store 建议设为 所有用户可读、仅创建者可写 或更严格）");
    console.log("  3. 验证登录和数据同步功能正常");
  } catch (e) {
    console.error("\n❌ 迁移过程出错:", e);
    process.exit(1);
  }
}

main();
