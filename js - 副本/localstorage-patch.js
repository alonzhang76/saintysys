/* ===== localStorage Global Patch =====
 *
 * 全局替换 localStorage.getItem / setItem / removeItem
 * 使现有代码无需修改即可走 Supabase
 *
 * 在需要的页面中引用（放在 common.js 之后、业务脚本之前）：
 *   <script src="js/localstorage-patch.js"></script>
 */

// 需要走 Supabase 的键（其他键仍使用 localStorage）
const SUPERSET_KEYS = [
  'styles', 'orders', 'fabrics', 'accessories', 'samples',
  'feedbacks', 'productions', 'invoices', 'payments', 'collections',
  'contacts', 'customers', 'suppliers', 'favoriteContacts',
  'washes', 'shippings', 'users', 'permissions',
  'maintFabrics', 'maintAccessories',
  'express_delivery_data_v2',
  'pl_records_v1', 'pl_draft_v1',
  'sht_sample_data_v2', 'sht_size_tables_v2',
  'sizeSheets',
];

// 安全相关键（不走 Supabase）
const SAFE_KEYS = ['isLoggedIn', 'username', 'userRole', 'currentUserId', 'refDPR', 'dataVersion'];

// 保存原始方法
const _origGetItem = localStorage.getItem.bind(localStorage);
const _origSetItem = localStorage.setItem.bind(localStorage);
const _origRemoveItem = localStorage.removeItem.bind(localStorage);

// 暴露原始方法，供数据恢复等场景使用
window._origLocalStorage = {
  getItem: _origGetItem,
  setItem: _origSetItem,
  removeItem: _origRemoveItem,
};

// 检查键是否需要走 Supabase
function shouldUseSupabase(key) {
  return SUPERSET_KEYS.indexOf(key) >= 0 && SAFE_KEYS.indexOf(key) < 0;
}

// 打补丁
localStorage.getItem = function(key) {
  if (!shouldUseSupabase(key)) return _origGetItem(key);

  // 走 Supabase 缓存
  if (window.SupabaseStore) {
    const val = window.SupabaseStore.getSync(key);
    if (val !== undefined && val !== null) {
      if (Array.isArray(val)) {
        console.log('[LS-Patch] getItem(' + key + ') → Supabase缓存, ' + val.length + ' 条');
      }
      return JSON.stringify(val);
    }

    // 关键修复：
    // 1. 永远不要从 getItem 内部写回 Supabase（会把本地旧数据覆盖云端新数据！）
    // 2. 只做读取：缓存未命中时尝试原始 localStorage 作为兜底
    // 3. 缓存更新由 SupabaseStore.init() / refreshFromCloud() 负责
    const origVal = _origGetItem(key);
    const isInit = window.SupabaseStore._isInitialized && window.SupabaseStore._isInitialized();

    if (origVal !== null && origVal !== undefined) {
      // 只返回原始数据，绝不触发写回 Supabase！
      // 如果需要补充缓存（只读，不更新时间戳不写入云端），直接读 _getCache
      try {
        var cache = window.SupabaseStore._getCache && window.SupabaseStore._getCache();
        var parsed = JSON.parse(origVal);
        if (cache && cache[key] === undefined) {
          // 仅补充 _cache（用于后续 getSync），不更新时间戳也不标记 recentWrites
          // 这样下次 refreshFromCloud 仍能对比云端与本地内容
          cache[key] = JSON.parse(JSON.stringify(parsed));
        }
      } catch(e) {}
      if (!isInit) {
        console.log('[LS-Patch] getItem(' + key + ') → 本地回退(未初始化), ' + origVal.length + ' 字符');
      } else {
        console.log('[LS-Patch] getItem(' + key + ') → 本地回退(缓存无数据), ' + origVal.length + ' 字符');
      }
      return origVal;
    }

    // SupabaseStore 已初始化且原始 localStorage 也没有此 key → 确实无数据
    if (isInit) {
      console.log('[LS-Patch] getItem(' + key + ') → null (云端和本地均无此数据)');
      return null;
    }

    // 未初始化且 localStorage 也没有 → 返回 null
    return null;
  }
  return _origGetItem(key);
};

localStorage.setItem = function(key, value) {
  if (!shouldUseSupabase(key)) return _origSetItem(key, value);

  // 先写入 localStorage 备份（绝对不能丢）
  _origSetItem(key, value);

  // 走 SupabaseStore
  if (window.SupabaseStore && typeof window.SupabaseStore.setSync === 'function') {
    try {
      const parsed = JSON.parse(value);
      window.SupabaseStore.setSync(key, parsed);
    } catch (e) {
      try { window.SupabaseStore.setSync(key, value); } catch(e2) {}
    }
  }

  // ===== 关键兜底：无论 SupabaseStore 是否存在，都触发独立写入事件 =====
  // 供 init-page.js 的独立 REST 通道接收并上传到云端
  // 这是数据最终一定能到达 Supabase 的最后一道保险
  try {
    var payload = value;
    try {
      // 如果 value 是 JSON 字符串，解析一次（避免二次引号嵌套）
      if (typeof value === 'string' && (value.charAt(0) === '{' || value.charAt(0) === '[')) {
        payload = JSON.parse(value);
      }
    } catch(e) {}
    window.dispatchEvent(new CustomEvent('cloud-write-request', {
      detail: {
        key: key,
        value: payload,
        ts: Date.now()
      }
    }));
  } catch(e) {}
};

localStorage.removeItem = function(key) {
  if (!shouldUseSupabase(key)) return _origRemoveItem(key);

  if (window.SupabaseStore && typeof window.SupabaseStore.remove === 'function') {
    try { window.SupabaseStore.remove(key); } catch(e) {}
  }

  // 同样触发独立删除事件（兜底）
  try {
    window.dispatchEvent(new CustomEvent('cloud-delete-request', {
      detail: { key: key, ts: Date.now() }
    }));
  } catch(e) {}

  return _origRemoveItem(key);
};

// 打印启动日志，并提示 SupabaseStore 是否可用
(function checkStore() {
  var hasStore = !!(window.SupabaseStore && window.SupabaseStore.setSync);
  var loadedFlag = !!window._SUPABASE_STORE_LOADED;
  console.log('[LocalStoragePatch] ✅ localStorage 已桥接. ' + 
    'SupabaseStore脚本加载=' + loadedFlag + 
    ', setSync可用=' + hasStore);
})();
