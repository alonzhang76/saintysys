/* ===== 云函数 tcb-file-list =====
 *
 * 功能：列出 CloudBase 云存储中指定目录下的文件和子目录。
 * 为什么需要：CloudBase 前端 JS SDK 没有直接的"列目录" API，
 *            因此前端通过调用本云函数来获取文件列表，
 *            兼容层 js/cloudbase.js 的 storage.from().list() 底层即调用本函数。
 *
 * 入参（event）：
 *   - bucket  {string}  桶名（CloudBase 默认只有一个环境桶，可传空串）
 *   - prefix  {string}  目录前缀，如 "sample/" 或 ""（桶根）
 *   - limit   {number}  单次返回最大条数，默认 1000，最大 1000
 *
 * 返回：
 *   { data: [ { name, type: 'file'|'folder', ... }, ... ] }
 *   失败返回 { error: string }
 *
 * 部署：
 *   1. 在项目根目录执行：tcb fn deploy tcb-file-list --envId <你的环境ID>
 *   2. 或在 CloudBase 控制台 → 云函数 → 新建函数 → 上传本目录代码
 *   3. 部署后在"函数配置"中确认运行环境为 Node.js 16+
 */

const cloudbase = require("@cloudbase/node-sdk");

// 云函数运行时会自动注入环境 ID，无需手动配置
const app = cloudbase.init({
  env: process.env.TCB_ENV || cloudbase.SYMBOL_CURRENT_ENV,
});

exports.main = async function (event, context) {
  try {
    const prefix = (event && event.prefix) || "";
    const limit = Math.min(Math.max((event && event.limit) || 1000, 1), 1000);

    const storage = app.storage();

    // 列出指定前缀下的文件和目录
    // listFolderFiles 返回 { files: [...], folders: [...] }
    const listRes = await storage.listFolderFiles({
      prefix: prefix,
      maxFiles: limit,
    });

    const files = (listRes && listRes.files) || [];
    const folders = (listRes && listRes.folders) || [];

    const data = [];

    // 目录
    for (let i = 0; i < folders.length; i++) {
      const f = folders[i] || {};
      data.push({
        name: f.name || "",
        type: "folder",
        path: f.path || f.name || "",
      });
    }

    // 文件
    for (let i = 0; i < files.length; i++) {
      const f = files[i] || {};
      data.push({
        name: f.name || "",
        type: "file",
        path: f.path || f.Key || f.name || "",
        size: f.size || f.Size || 0,
        lastModified: f.lastModified || f.LastModified || "",
        fileID: f.fileID || f.FileID || "",
      });
    }

    return { data: data };
  } catch (err) {
    console.error("[tcb-file-list] 异常:", err);
    return {
      error: (err && err.message) || String(err || "unknown error"),
      data: [],
    };
  }
};
