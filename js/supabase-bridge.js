/* ===== Supabase Bridge =====
 *
 * 桥接 App.store 到 SupabaseStore
 * 所有通过 App.store.get/set 的调用会自动走 Supabase
 * 同步 get 返回内存缓存中的数据，set 同时更新缓存和云端
 *
 * 在需要 Supabase 存储的页面中引用：
 *   <script type="module" src="js/supabase-bridge.js"></script>
 *
 * 必须在 common.js 之后、业务脚本之前引用
 */

import { SupabaseStore } from "./supabase-store.js";

// 保存原始 App.store
const origStore = window.App ? window.App.store : null;

// 创建新的 store 对象
const bridgedStore = {
  // 同步 get：从内存缓存读取
  get(key, defaultVal) {
    if (!window.SupabaseStore) return origStore ? origStore.get(key, defaultVal) : defaultVal;
    const val = window.SupabaseStore.getSync(key);
    // 规范化：确保返回值类型正确
    if (val === undefined || val === null) return defaultVal !== undefined ? defaultVal : [];
    // 如果默认值是数组但返回值不是数组，返回默认值
    if (Array.isArray(defaultVal) && !Array.isArray(val)) return defaultVal;
    return val;
  },

  // 同步 set：更新内存缓存 + 异步写入云端
  set(key, value) {
    if (!window.SupabaseStore) {
      origStore && origStore.set(key, value);
      return;
    }
    window.SupabaseStore.setSync(key, value);
  },

  // 同步 remove
  remove(key) {
    if (!window.SupabaseStore) {
      origStore && origStore.remove(key);
      return;
    }
    window.SupabaseStore.remove(key);
  },
};

// 替换 App.store
if (window.App) {
  window.App.store = bridgedStore;
}

// 为直接使用 localStorage 的模块提供包装函数
window.LocalSupabase = {
  /**
   * 读取数据（兼容 localStorage.getItem）
   * @param {string} key 存储键
   * @param {*} defaultVal 默认值
   * @returns {string} JSON 字符串
   */
  getItem(key) {
    if (!window.SupabaseStore) return localStorage.getItem(key);
    const val = window.SupabaseStore.getSync(key);
    if (val === undefined || val === null) return null;
    return JSON.stringify(val);
  },

  /**
   * 保存数据（兼容 localStorage.setItem）
   * @param {string} key 存储键
   * @param {string} value JSON 字符串
   */
  setItem(key, value) {
    if (!window.SupabaseStore) {
      localStorage.setItem(key, value);
      return;
    }
    try {
      const parsed = JSON.parse(value);
      window.SupabaseStore.setSync(key, parsed);
    } catch (e) {
      // 非 JSON 字符串，直接存储
      window.SupabaseStore.setSync(key, value);
    }
  },

  /**
   * 删除数据
   */
  removeItem(key) {
    if (!window.SupabaseStore) return localStorage.removeItem(key);
    window.SupabaseStore.remove(key);
  },
};

// 暴露到全局
window.SupabaseBridge = {
  store: bridgedStore,
  forceSync: () => window.SupabaseStore ? window.SupabaseStore.forceSync() : Promise.resolve({}),
  init: () => window.SupabaseStore ? window.SupabaseStore.init() : Promise.resolve(false),
};

console.log('[SupabaseBridge] ✅ App.store 已桥接到云端存储');
