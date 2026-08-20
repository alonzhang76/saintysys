/* ===== Supabase 统一数据存储层 supabase-store.js =====
 *
 * 替代 App.store 的 localStorage 实现，所有业务数据存到 Supabase
 * 使用方式：与 App.store 完全兼容
 *   SupabaseStore.get(key, defaultVal)   → 获取数据
 *   SupabaseStore.set(key, value)        → 保存数据
 *   SupabaseStore.remove(key)            → 删除数据
 *
 * 初始化：每个页面加载时调用 SupabaseStore.init()
 * 首次初始化时自动将 localStorage 中已有数据迁移到 Supabase
 *
 * 数据表：app_data_store（存储各模块 key-value 数据）
 * - id uuid primary key
 * - user_id uuid references auth.users(id)
 * - store_key text（数据键名）
 * - payload jsonb（数据内容）
 * - updated_at timestamptz
 */

import { supabase } from "./supabase.js";

// 本地缓存（避免每次读写都请求 Supabase）
const _cache = {};
let _initialized = false;
let _initPromise = null;

// 需要迁移的 localStorage 键 → Supabase store_key 映射
const MIGRATION_KEYS = [
  'styles', 'orders', 'fabrics', 'accessories', 'samples',
  'feedbacks', 'productions', 'invoices', 'payments', 'collections',
  'contacts', 'customers', 'suppliers', 'favoriteContacts',
  'washes', 'shippings', 'users', 'permissions',
  'maintFabrics', 'maintAccessories',
  'express_delivery_data_v2',
  'pl_records_v1', 'pl_draft_v1',
  'sht_sample_data_v2', 'sht_size_tables_v2',
  'sizeSheets',
  'dataVersion',
];

// 模块中使用的 localStorage 键（完整列表）
const LOCAL_KEYS = MIGRATION_KEYS;

async function getCurrentUser() {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data || !data.user) return null;
  return data.user;
}

/**
 * 初始化：加载当前用户的所有数据到内存缓存
 * 同时执行 localStorage → Supabase 迁移
 */
async function init() {
  if (_initialized) return true;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const user = await getCurrentUser();
    if (!user) {
      console.warn('[SupabaseStore] 未登录，数据存储不可用');
      return false;
    }

    // 1) 迁移 localStorage 数据到 Supabase
    await migrateFromLocalStorage(user.id);

    // 2) 从 Supabase 加载所有数据到缓存
    try {
      const { data, error } = await supabase
        .from('app_data_store')
        .select('store_key, payload')
        .eq('user_id', user.id);

      if (error) {
        console.error('[SupabaseStore] 加载数据失败:', error);
        return false;
      }

      if (data) {
        data.forEach(row => {
          // 不要覆盖 init 完成前由 setSync 写入的缓存
          // （setSync 写入的是最新数据，init 可能因网络延迟加载到旧数据）
          if (_cache[row.store_key] === undefined) {
            _cache[row.store_key] = row.payload;
          }
        });
      }

      _initialized = true;
      console.log('[SupabaseStore] 初始化完成，已加载', Object.keys(_cache).length, '个数据集');
      return true;
    } catch (e) {
      console.error('[SupabaseStore] 初始化异常:', e);
      return false;
    }
  })();

  return _initPromise;
}

/**
 * 将 localStorage 中存在但 Supabase 中没有的数据迁移过来
 */
async function migrateFromLocalStorage(userId) {
  let migratedCount = 0;

  for (const key of LOCAL_KEYS) {
    // 跳过临时会话数据
    if (['isLoggedIn', 'username', 'userRole', 'currentUserId', 'refDPR'].includes(key)) continue;

    const raw = localStorage.getItem(key);
    if (!raw) continue;

    // 检查 Supabase 中是否已有此 key
    const { data: existing, error: checkErr } = await supabase
      .from('app_data_store')
      .select('id')
      .eq('user_id', userId)
      .eq('store_key', key)
      .limit(1);

    if (checkErr) {
      console.warn('[SupabaseStore] 检查迁移状态失败:', key, checkErr);
      continue;
    }

    if (existing && existing.length > 0) {
      // Supabase 已有此 key，跳过（不覆盖云端数据）
      continue;
    }

    // 迁移到 Supabase
    try {
      const { data: parsed } = JSON.parse(raw);
      const payload = typeof parsed !== 'undefined' ? parsed : raw;
      const { error } = await supabase
        .from('app_data_store')
        .insert({
          user_id: userId,
          store_key: key,
          payload: payload,
          updated_at: new Date().toISOString(),
        });

      if (error) {
        console.warn('[SupabaseStore] 迁移失败:', key, error);
      } else {
        migratedCount++;
        _cache[key] = payload;
        console.log('[SupabaseStore] 已迁移:', key);
      }
    } catch (e) {
      console.warn('[SupabaseStore] 迁移解析失败:', key, e);
    }
  }

  if (migratedCount > 0) {
    console.log('[SupabaseStore] 共迁移', migratedCount, '个数据集');
  }
}

/**
 * 强制重新同步 localStorage → Supabase
 * 用于用户手动触发数据同步
 */
async function forceSync() {
  const user = await getCurrentUser();
  if (!user) return { success: false, message: '未登录' };

  let synced = 0;
  for (const key of LOCAL_KEYS) {
    if (['isLoggedIn', 'username', 'userRole', 'currentUserId', 'refDPR'].includes(key)) continue;
    const raw = localStorage.getItem(key);
    if (!raw) continue;

    let payload;
    try {
      ({ data: payload } = JSON.parse(raw));
    } catch (e) {
      payload = raw;
    }

    // upsert：如果 Supabase 已有则更新，没有则插入
    const { error } = await supabase
      .from('app_data_store')
      .upsert({
        user_id: user.id,
        store_key: key,
        payload: payload,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id, store_key' });

    if (!error) {
      _cache[key] = payload;
      synced++;
    }
  }

  return { success: true, synced: synced };
}

/**
 * 获取数据
 */
async function get(key, defaultVal) {
  if (!_initialized) await init();

  if (_cache[key] !== undefined) {
    // 深拷贝返回，避免外部修改影响缓存
    return JSON.parse(JSON.stringify(_cache[key]));
  }

  // 缓存未命中，从 Supabase 读取
  const user = await getCurrentUser();
  if (!user) return defaultVal;

  try {
    const { data, error } = await supabase
      .from('app_data_store')
      .select('payload')
      .eq('user_id', user.id)
      .eq('store_key', key)
      .limit(1);

    if (error) return defaultVal;
    if (data && data.length > 0) {
      _cache[key] = data[0].payload;
      return JSON.parse(JSON.stringify(data[0].payload));
    }
    return defaultVal;
  } catch (e) {
    console.warn('[SupabaseStore] get 失败:', key, e);
    return defaultVal;
  }
}

/**
 * 保存数据
 */
async function set(key, value) {
  if (!_initialized) await init();

  const user = await getCurrentUser();
  if (!user) {
    console.warn('[SupabaseStore] 未登录，无法保存:', key);
    return false;
  }

  // 更新内存缓存
  _cache[key] = JSON.parse(JSON.stringify(value));

  // 异步写入 Supabase（不阻塞 UI）
  try {
    const { error } = await supabase
      .from('app_data_store')
      .upsert({
        user_id: user.id,
        store_key: key,
        payload: value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id, store_key' });

    if (error) {
      console.error('[SupabaseStore] set 失败:', key, error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[SupabaseStore] set 异常:', key, e);
    return false;
  }
}

/**
 * 删除数据
 */
async function remove(key) {
  if (!_initialized) await init();

  const user = await getCurrentUser();
  if (!user) return false;

  delete _cache[key];

  try {
    const { error } = await supabase
      .from('app_data_store')
      .delete()
      .eq('user_id', user.id)
      .eq('store_key', key);

    if (error) return false;
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 清除当前用户的所有数据（清空数据功能）
 */
async function clearAll() {
  const user = await getCurrentUser();
  if (!user) return false;

  Object.keys(_cache).forEach(k => delete _cache[k]);

  try {
    const { error } = await supabase
      .from('app_data_store')
      .delete()
      .eq('user_id', user.id);

    return !error;
  } catch (e) {
    return false;
  }
}

/**
 * 重置（登出时调用）
 */
function reset() {
  Object.keys(_cache).forEach(k => delete _cache[k]);
  _initialized = false;
  _initPromise = null;
}

// 同步版本：用于代码中已有同步 get/set 调用的场景
// 这些方法操作内存缓存，适合同步代码路径
function getSync(key, defaultVal) {
  if (_cache[key] !== undefined) {
    return JSON.parse(JSON.stringify(_cache[key]));
  }
  return defaultVal;
}

function setSync(key, value) {
  _cache[key] = JSON.parse(JSON.stringify(value));
  // 异步写入 Supabase
  getCurrentUser().then(user => {
    if (!user) return;
    supabase
      .from('app_data_store')
      .upsert({
        user_id: user.id,
        store_key: key,
        payload: value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'user_id, store_key' })
      .catch(e => console.error('[SupabaseStore] setSync 写入失败:', key, e));
  });
}

// 导出 API
export const SupabaseStore = {
  init,
  get,
  set,
  remove,
  clearAll,
  reset,
  forceSync,
  getSync,
  setSync,
  LOCAL_KEYS,
};

// 暴露到全局
window.SupabaseStore = SupabaseStore;

// 就绪标志：页面可以 await window.SupabaseReady
window.SupabaseReady = init();

// 自动初始化完成后标记
window.SupabaseReady.then(ok => {
  if (ok) console.log('[SupabaseStore] ✅ 已连接到云端存储');
  else console.log('[SupabaseStore] ⚠️ 云端存储未就绪，使用本地缓存');
});
