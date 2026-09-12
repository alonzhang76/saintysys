/* ===== CloudBase Bridge =====
 *
 * 桥接 App.store 到 CloudbaseStore
 * 所有通过 App.store.get/set 的调用会自动走 CloudBase 云端
 * 同步 get 返回内存缓存中的数据，set 同时更新缓存和云端
 *
 * 注意：不直接 import cloudbase-store.js（避免模块重复加载）
 * 而是使用 window.CloudbaseStore（由 cloudbase-store.js 设置）
 *
 * 在需要云端存储的页面中引用：
 *   <script src="js/cloudbase-bridge.js"></script>
 *
 * 必须在 common.js 之后、业务脚本之前引用
 */

// 保存原始 App.store
const origStore = window.App ? window.App.store : null;

// 创建新的 store 对象
const bridgedStore = {
  // 同步 get：从内存缓存读取
  get(key, defaultVal) {
    if (!window.CloudbaseStore) return origStore ? origStore.get(key, defaultVal) : defaultVal;
    const val = window.CloudbaseStore.getSync(key, defaultVal);
    // getSync 内部已做 coerceType，这里做兜底
    if (val === undefined || val === null) return defaultVal !== undefined ? defaultVal : [];
    if (Array.isArray(defaultVal) && !Array.isArray(val)) return defaultVal;
    return val;
  },

  // 同步 set：更新内存缓存 + 异步写入云端
  set(key, value) {
    if (!window.CloudbaseStore) {
      origStore && origStore.set(key, value);
      return;
    }
    window.CloudbaseStore.setSync(key, value);
  },

  // 同步 remove
  remove(key) {
    if (!window.CloudbaseStore) {
      origStore && origStore.remove(key);
      return;
    }
    window.CloudbaseStore.remove(key);
  },
};

// 替换 App.store
if (window.App) {
  window.App.store = bridgedStore;
}

// 为直接使用 localStorage 的模块提供包装函数
window.CloudStorage = {
  /**
   * 读取数据（兼容 localStorage.getItem）
   * @param {string} key 存储键
   * @param {*} defaultVal 默认值
   * @returns {string} JSON 字符串
   */
  getItem(key) {
    if (!window.CloudbaseStore) return localStorage.getItem(key);
    const val = window.CloudbaseStore.getSync(key);
    if (val === undefined || val === null) return null;
    return JSON.stringify(val);
  },

  /**
   * 保存数据（兼容 localStorage.setItem）
   * @param {string} key 存储键
   * @param {string} value JSON 字符串
   */
  setItem(key, value) {
    if (!window.CloudbaseStore) {
      localStorage.setItem(key, value);
      return;
    }
    try {
      const parsed = JSON.parse(value);
      window.CloudbaseStore.setSync(key, parsed);
    } catch (e) {
      // 非 JSON 字符串，直接存储
      window.CloudbaseStore.setSync(key, value);
    }
  },

  /**
   * 删除数据
   */
  removeItem(key) {
    if (!window.CloudbaseStore) return localStorage.removeItem(key);
    window.CloudbaseStore.remove(key);
  },
};

// 暴露到全局（保留 SupabaseBridge 兼容别名，兼容页面内联脚本的既有引用）
window.CloudbaseBridge = {
  store: bridgedStore,
  forceSync: () => window.CloudbaseStore ? window.CloudbaseStore.forceSync() : Promise.resolve({}),
  init: () => window.CloudbaseStore ? window.CloudbaseStore.init() : Promise.resolve(false),
};
window.SupabaseBridge = window.CloudbaseBridge; // 兼容别名

console.log('[CloudbaseBridge] ✅ App.store 已桥接到 CloudBase 云端存储');
