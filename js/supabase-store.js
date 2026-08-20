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

/**
 * 安全的 Supabase 查询包装器
 * 处理 Supabase v2 builder 的 thenable 问题
 */
function safeQuery(builder) {
  // Supabase v2 的 builder 是 thenable，用 Promise.resolve 包装
  return Promise.resolve(builder);
}

/**
 * 验证并规范化 payload 数据
 * 确保数据是数组或对象，避免 .filter 等方法报错
 * 深度提取嵌套 data 结构
 */
function normalizePayload(payload) {
  if (payload === null || payload === undefined) return null;
  // 如果是对象且有 data 属性（Supabase 查询结果或二次包装），提取 data
  if (typeof payload === 'object' && !Array.isArray(payload) && payload.data !== undefined) {
    return normalizePayload(payload.data);  // 递归，防止多层嵌套
  }
  // 如果是数组，检查每个元素是否需要进一步展开（一般不需要）
  return payload;
}

/**
 * 根据默认值类型规范化返回值
 * 如果默认值是数组但返回值不是数组，返回默认值
 */
function coerceType(value, defaultVal) {
  if (value === undefined || value === null) return defaultVal;
  if (Array.isArray(defaultVal) && !Array.isArray(value)) {
    // 尝试将对象包装为数组或返回默认值
    if (typeof value === 'object' && !Array.isArray(value) && value.data !== undefined) {
      const extracted = normalizePayload(value);
      if (Array.isArray(extracted)) return extracted;
    }
    return defaultVal;
  }
  return value;
}

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
      const { data, error } = await safeQuery(
        supabase
          .from('app_data_store')
          .select('store_key, payload')
          .eq('user_id', user.id)
      );

      if (error) {
        console.error('[SupabaseStore] 加载数据失败:', error);
        return false;
      }

      if (data) {
        data.forEach(row => {
          // 不要覆盖 init 完成前由 setSync 写入的缓存
          // （setSync 写入的是最新数据，init 可能因网络延迟加载到旧数据）
          if (_cache[row.store_key] === undefined) {
            _cache[row.store_key] = normalizePayload(row.payload);
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
    const { data: existing, error: checkErr } = await safeQuery(
      supabase
        .from('app_data_store')
        .select('id')
        .eq('user_id', userId)
        .eq('store_key', key)
        .limit(1)
    );

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
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        payload = raw;
      }
      payload = normalizePayload(payload);
      const { error } = await safeQuery(
        supabase
          .from('app_data_store')
          .insert({
            user_id: userId,
            store_key: key,
            payload: payload,
            updated_at: new Date().toISOString(),
          })
      );

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

  const origLS = window._origLocalStorage || window.localStorage;
  let synced = 0;
  for (const key of LOCAL_KEYS) {
    if (['isLoggedIn', 'username', 'userRole', 'currentUserId', 'refDPR'].includes(key)) continue;
    // 使用原始 localStorage 读取（绕过 patch，避免返回空缓存）
    const raw = origLS.getItem(key);
    if (!raw) continue;

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      payload = raw;
    }
    payload = normalizePayload(payload);

    // upsert：如果 Supabase 已有则更新，没有则插入
    const { error } = await safeQuery(
      supabase
        .from('app_data_store')
        .upsert({
          user_id: user.id,
          store_key: key,
          payload: payload,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id, store_key' })
    );

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
    const { data, error } = await safeQuery(
      supabase
        .from('app_data_store')
        .select('payload')
        .eq('user_id', user.id)
        .eq('store_key', key)
        .limit(1)
    );

    if (error) return defaultVal;
    if (data && data.length > 0) {
      const payload = normalizePayload(data[0].payload);
      _cache[key] = payload;
      return JSON.parse(JSON.stringify(payload));
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
    const { error } = await safeQuery(
      supabase
        .from('app_data_store')
        .upsert({
          user_id: user.id,
          store_key: key,
          payload: value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id, store_key' })
    );

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
    const { error } = await safeQuery(
      supabase
        .from('app_data_store')
        .delete()
        .eq('user_id', user.id)
        .eq('store_key', key)
    );

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

// 待写入队列：setSync 失败时重试
const _pendingWrites = [];
let _retryTimer = null;

// 同步版本：用于代码中已有同步 get/set 调用的场景
// 这些方法操作内存缓存，适合同步代码路径
function getSync(key, defaultVal) {
  if (_cache[key] !== undefined) {
    const val = coerceType(_cache[key], defaultVal);
    return JSON.parse(JSON.stringify(val));
  }
  return defaultVal;
}

function setSync(key, value) {
  _cache[key] = JSON.parse(JSON.stringify(value));
  // 异步写入 Supabase（带重试）
  _asyncWrite(key, value, 0);
}

// 异步写入（支持重试）
async function _asyncWrite(key, value, retryCount) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      // 用户未登录，稍后重试（最多 3 次）
      if (retryCount < 3) {
        setTimeout(() => _asyncWrite(key, value, retryCount + 1), 1000 * (retryCount + 1));
      } else {
        // 加入待处理队列
        _addToPending(key, value);
      }
      return;
    }
    const { error } = await safeQuery(
      supabase
        .from('app_data_store')
        .upsert({
          user_id: user.id,
          store_key: key,
          payload: value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'user_id, store_key' })
    );
    if (error) {
      console.warn('[SupabaseStore] setSync 写入失败，加入重试队列:', key, error);
      _addToPending(key, value);
    }
  } catch (e) {
    console.warn('[SupabaseStore] setSync 异常，加入重试队列:', key, e);
    _addToPending(key, value);
  }
}

// 加入待处理队列
function _addToPending(key, value) {
  // 更新或添加到队列
  const existing = _pendingWrites.find(w => w.key === key);
  if (existing) {
    existing.value = value;
    existing.timestamp = Date.now();
  } else {
    _pendingWrites.push({ key, value, timestamp: Date.now() });
  }
  // 启动定时重试
  if (!_retryTimer) {
    _retryTimer = setInterval(_retryPending, 5000); // 每 5 秒重试
  }
}

// 重试待处理队列
async function _retryPending() {
  if (_pendingWrites.length === 0) {
    clearInterval(_retryTimer);
    _retryTimer = null;
    return;
  }
  // 复制当前队列并清空
  const batch = [..._pendingWrites];
  _pendingWrites.length = 0;
  const user = await getCurrentUser();
  if (!user) {
    // 用户仍未登录，放回队列
    batch.forEach(w => _pendingWrites.push(w));
    return;
  }
  for (const item of batch) {
    try {
      const { error } = await safeQuery(
        supabase
          .from('app_data_store')
          .upsert({
            user_id: user.id,
            store_key: item.key,
            payload: item.value,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id, store_key' })
      );
      if (error) {
        console.warn('[SupabaseStore] 重试仍失败:', item.key, error);
        _pendingWrites.push(item); // 放回继续重试
      }
    } catch (e) {
      _pendingWrites.push(item);
    }
  }
}

// 立即刷新所有待处理写入（用于页面关闭前）
async function _flushSync() {
  if (_pendingWrites.length === 0) return;
  const batch = [..._pendingWrites];
  _pendingWrites.length = 0;
  for (const item of batch) {
    // 使用 fetch with keepalive 确保请求在页面关闭后仍能完成
    try {
      const user = await getCurrentUser();
      if (!user) { _pendingWrites.push(item); continue; }
      await safeQuery(
        supabase
          .from('app_data_store')
          .upsert({
            user_id: user.id,
            store_key: item.key,
            payload: item.value,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'user_id, store_key' })
      );
    } catch(e) {
      _pendingWrites.push(item);
    }
  }
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
  _flushSync,
  LOCAL_KEYS,
};

// 暴露到全局
window.SupabaseStore = SupabaseStore;

// 就绪标志：页面可以 await window.SupabaseReady
window.SupabaseReady = init();

// 自动初始化完成后标记
window.SupabaseReady.then(ok => {
  if (ok) {
    console.log('[SupabaseStore] ✅ 已连接到云端存储');
    // 自动恢复：检查是否有业务数据丢失但 localStorage 还保留
    // 这处理了版本变更时误清空数据的情况
    recoverFromLocalStorage();
  } else {
    console.log('[SupabaseStore] ⚠️ 云端存储未就绪，使用本地缓存');
  }
});

/**
 * 从原始 localStorage 恢复数据
 * 当 Supabase 中的数据被清空但 localStorage 还保留时，自动恢复
 */
function recoverFromLocalStorage() {
  const recoveryKeys = ['orders', 'samples', 'contacts', 'shippings',
    'express_delivery_data_v2', 'sht_sample_data_v2', 'sht_size_tables_v2',
    'sizeSheets', 'maintFabrics', 'maintAccessories', 'favoriteContacts',
    'customers', 'styles', 'feedbacks', 'productions', 'washes',
    'invoices', 'payments', 'collections', 'fabrics', 'accessories'];

  let recovered = 0;
  recoveryKeys.forEach(key => {
    if (_cache[key] !== undefined && _cache[key] !== null &&
        Array.isArray(_cache[key]) && _cache[key].length > 0) {
      return; // 已有数据，跳过
    }
    // 从原始 localStorage 读取（绕过 patch）
    try {
      const origLS = window._origLocalStorage || window.localStorage;
      const raw = origLS.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          _cache[key] = parsed;
          // 异步保存到 Supabase
          getCurrentUser().then(user => {
            if (!user) return;
            safeQuery(
              supabase
                .from('app_data_store')
                .upsert({
                  user_id: user.id,
                  store_key: key,
                  payload: parsed,
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'user_id, store_key' })
            ).catch(e => console.warn('[SupabaseStore] 恢复保存失败:', key, e));
          });
          recovered++;
        }
      }
    } catch (e) {
      // 忽略解析错误
    }
  });

  if (recovered > 0) {
    console.log('[SupabaseStore] 🔄 已从 localStorage 恢复', recovered, '个数据集');
    // 刷新页面显示
    setTimeout(() => {
      if (window.App && window.App._onDataChanged) {
        window.App._onDataChanged();
      }
    }, 500);
  }
}
