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

    // 关键修复：即使 SupabaseStore 已初始化，如果缓存中没有此 key，
    // 也应该回退到原始 localStorage（因为独立轮询等机制可能直接写入了原始 localStorage）
    // 之前的逻辑在 _isInitialized 为 true 时直接返回 null，导致数据丢失
    const origVal = _origGetItem(key);
    if (origVal !== null && origVal !== undefined) {
      // 原始 localStorage 有数据，同步到 SupabaseStore 缓存
      try {
        const parsed = JSON.parse(origVal);
        if (window.SupabaseStore.setSync) {
          window.SupabaseStore.setSync(key, parsed);
        }
      } catch(e) {}
      console.log('[LS-Patch] getItem(' + key + ') → 本地回退(有数据), ' + origVal.length + ' 字符');
      return origVal;
    }

    // SupabaseStore 已初始化且原始 localStorage 也没有此 key → 确实无数据
    if (window.SupabaseStore._isInitialized && window.SupabaseStore._isInitialized()) {
      return null;
    }

    // SupabaseStore 尚未初始化完成，原始 localStorage 也没有 → 返回 null
    return null;
  }
  return _origGetItem(key);
};

localStorage.setItem = function(key, value) {
  if (!shouldUseSupabase(key)) return _origSetItem(key, value);

  // 走 Supabase
  if (window.SupabaseStore) {
    try {
      const parsed = JSON.parse(value);
      window.SupabaseStore.setSync(key, parsed);
    } catch (e) {
      window.SupabaseStore.setSync(key, value);
    }
    // 同时写入 localStorage 作为备份
    _origSetItem(key, value);
  } else {
    _origSetItem(key, value);
  }
};

localStorage.removeItem = function(key) {
  if (!shouldUseSupabase(key)) return _origRemoveItem(key);

  if (window.SupabaseStore) {
    window.SupabaseStore.remove(key);
  }
  return _origRemoveItem(key);
};

console.log('[LocalStoragePatch] ✅ localStorage 已桥接到 Supabase');
