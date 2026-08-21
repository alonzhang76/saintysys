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

// 从全局获取 supabase 客户端（由 supabase.js 模块设置到 window.supabase）
// 使用 getter 确保即使 supabase-store.js 先于 supabase.js 加载，也能在运行时获取到
var supabase;
function getSupabase() {
  if (!supabase) supabase = window.supabase;
  return supabase;
}

/**
 * 安全的 Supabase 查询包装器
 * 处理 Supabase v2 builder 的 thenable 问题
 * Safari 兼容：显式检查 then 方法
 */
function safeQuery(builder) {
  if (builder && typeof builder.then === 'function') {
    return builder; // Supabase v2 builder 已经是 thenable
  }
  if (builder && typeof builder.execute === 'function') {
    return builder.execute(); // 某些版本需要显式调用 execute()
  }
  return Promise.resolve(builder); // 普通对象直接返回
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
const _cacheTimestamps = {};  // 每个 key 的最后更新时间
let _initialized = false;
let _initPromise = null;
let _lastRefreshDebugTs = 0;

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
  const sb = getSupabase();
  if (!sb) return null;
  const { data, error } = await sb.auth.getUser();
  if (error || !data || !data.user) return null;
  return data.user;
}

/**
 * 等待 window.supabase 加载完成（最多 10 秒）
 */
function waitForSupabase(timeout) {
  timeout = timeout || 10000;
  var start = Date.now();
  return new Promise(function(resolve) {
    function check() {
      if (window.supabase) {
        supabase = window.supabase;
        resolve(true);
      } else if (Date.now() - start > timeout) {
        resolve(false);
      } else {
        setTimeout(check, 100);
      }
    }
    check();
  });
}

/**
 * 初始化：加载当前用户的所有数据到内存缓存
 * 同时执行 localStorage → Supabase 迁移
 */
async function init() {
  if (_initialized) return true;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    // 等待 supabase.js 模块加载完成
    const sbReady = await waitForSupabase(10000);
    if (!sbReady) {
      console.error('[SupabaseStore] ❌ window.supabase 未加载（supabase.js 模块加载失败）');
      return false;
    }

    const user = await getCurrentUser();
    if (!user) {
      console.warn('[SupabaseStore] 未登录，数据存储不可用');
      return false;
    }

    // 1) 迁移 localStorage 数据到 Supabase（共享模式：不传 userId）
    await migrateFromLocalStorage();

    // 2) 从 Supabase 加载所有数据到缓存（共享模式：不按 user_id 过滤）
    try {
      const { data, error } = await safeQuery(
        getSupabase()
          .from('app_data_store')
          .select('store_key, payload, updated_at')
      );

      if (error) {
        console.error('[SupabaseStore] 加载数据失败:', error);
        return false;
      }

      if (data) {
        data.forEach(row => {
          if (_cache[row.store_key] === undefined) {
            _cache[row.store_key] = normalizePayload(row.payload);
            _cacheTimestamps[row.store_key] = row.updated_at || new Date().toISOString();
          }
        });
      }

      _initialized = true;
      // 重置最近写入记录，让初始化期间的写入不影响后续刷新
      _recentWrites = {};
      console.log('[SupabaseStore] 初始化完成，已加载', Object.keys(_cache).length, '个数据集（共享模式）');
      console.log('[SupabaseStore] 缓存中的 keys:', Object.keys(_cache).join(', '));

      // 关键修复：初始化完成后立即强制刷新一次云端数据
      // 确保在 Safari/iOS 等浏览器中，能立刻获取到其他设备的最新数据
      console.log('[SupabaseStore] 🔄 立即执行首次云端同步...');
      setTimeout(function() {
        forceRefreshFromCloud().then(function(changed) {
          if (changed && changed.length > 0) {
            console.log('[SupabaseStore] ✅ 首次同步获取到', changed.length, '个数据变更:', changed.join(', '));
          } else {
            console.log('[SupabaseStore] ✅ 首次同步完成，无新变更');
          }
        }).catch(function(e) {
          console.warn('[SupabaseStore] 首次同步出错:', e && e.message ? e.message : e);
        });
      }, 100); // 延迟100ms等待所有初始化写入完成

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
 * 共享模式：不按 user_id 区分，所有数据共享一行
 * 优化：一次查询获取所有已存在的 keys，避免逐个查询
 */
async function migrateFromLocalStorage() {
  const origGetItem = (window._origLocalStorage && window._origLocalStorage.getItem) || localStorage.getItem.bind(localStorage);

  // 1. 一次性获取 Supabase 中所有已存在的 store_key
  let existingKeys = new Set();
  try {
    const { data, error } = await safeQuery(
      getSupabase().from('app_data_store').select('store_key')
    );
    if (!error && data) {
      data.forEach(row => existingKeys.add(row.store_key));
    }
  } catch (e) {
    console.warn('[SupabaseStore] 迁移：查询已有 keys 失败:', e);
  }

  // 2. 遍历 localStorage，只迁移 Supabase 中不存在的 key
  let migratedCount = 0;
  const user = await getCurrentUser();

  for (const key of LOCAL_KEYS) {
    if (['isLoggedIn', 'username', 'userRole', 'currentUserId', 'refDPR'].includes(key)) continue;
    if (existingKeys.has(key)) continue; // Supabase 已有，跳过

    const raw = origGetItem(key);
    if (!raw) continue;

    try {
      let payload;
      try {
        payload = JSON.parse(raw);
      } catch (e) {
        payload = raw;
      }
      payload = normalizePayload(payload);

      const { error } = await safeQuery(
        getSupabase()
          .from('app_data_store')
          .insert({
            user_id: user ? user.id : null,
            store_key: key,
            payload: payload,
            updated_at: new Date().toISOString(),
          })
      );

      if (error) {
        console.warn('[SupabaseStore] 迁移失败:', key, error);
      } else {
        migratedCount++;
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
  let skipped = 0;
  for (const key of LOCAL_KEYS) {
    if (['isLoggedIn', 'username', 'userRole', 'currentUserId', 'refDPR'].includes(key)) continue;
    const raw = origLS.getItem(key);
    if (!raw) { skipped++; continue; }

    let payload;
    try {
      payload = JSON.parse(raw);
    } catch (e) {
      payload = raw;
    }
    payload = normalizePayload(payload);

    // 共享模式：onConflict 用 store_key，user_id 仅记录
    const { error } = await safeQuery(
      getSupabase()
        .from('app_data_store')
        .upsert({
          user_id: user.id,
          store_key: key,
          payload: payload,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'store_key' })
    );

    if (!error) {
      _cache[key] = payload;
      synced++;
    } else {
      console.warn('[SupabaseStore] forceSync 失败:', key, error);
    }
  }

  console.log('[SupabaseStore] forceSync 完成: 同步', synced, '个, 跳过', skipped, '个(本地无数据)');
  return { success: true, synced: synced };
}

/**
 * 获取数据（共享模式：不按 user_id 过滤）
 */
async function get(key, defaultVal) {
  if (!_initialized) await init();

  if (_cache[key] !== undefined) {
    return JSON.parse(JSON.stringify(_cache[key]));
  }

  // 缓存未命中，从 Supabase 读取（共享模式：只按 store_key 查询）
  try {
    const { data, error } = await safeQuery(
      getSupabase()
        .from('app_data_store')
        .select('payload')
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
 * 保存数据（共享模式：onConflict 用 store_key）
 */
async function set(key, value) {
  if (!_initialized) await init();

  const user = await getCurrentUser();

  // 更新内存缓存
  _cache[key] = JSON.parse(JSON.stringify(value));

  // 异步写入 Supabase
  try {
    const { error } = await safeQuery(
      getSupabase()
        .from('app_data_store')
        .upsert({
          user_id: user ? user.id : null,
          store_key: key,
          payload: value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'store_key' })
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
 * 删除数据（共享模式：按 store_key 删除）
 */
async function remove(key) {
  if (!_initialized) await init();

  delete _cache[key];
  delete _cacheTimestamps[key];

  try {
    const { error } = await safeQuery(
      getSupabase()
        .from('app_data_store')
        .delete()
        .eq('store_key', key)
    );

    if (error) return false;
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 清除所有数据（清空数据功能）
 * 共享模式：清空整个表（所有用户的数据）
 */
async function clearAll() {
  Object.keys(_cache).forEach(k => delete _cache[k]);
  Object.keys(_cacheTimestamps).forEach(k => delete _cacheTimestamps[k]);

  try {
    const { error } = await getSupabase()
      .from('app_data_store')
      .delete()
      .neq('id', '00000000-0000-0000-0000-000000000000'); // 删除所有行

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
  Object.keys(_cacheTimestamps).forEach(k => delete _cacheTimestamps[k]);
  _recentWrites = {};
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

// 最近写入记录（避免自己写入的数据触发刷新）
var _recentWrites = {};

function setSync(key, value) {
  _cache[key] = JSON.parse(JSON.stringify(value));
  _cacheTimestamps[key] = new Date().toISOString();
  _recentWrites[key] = Date.now();
  // 异步写入 Supabase（带重试）
  _asyncWrite(key, value, 0);
}

// 异步写入（支持重试）— 共享模式
async function _asyncWrite(key, value, retryCount) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      if (retryCount < 3) {
        setTimeout(() => _asyncWrite(key, value, retryCount + 1), 1000 * (retryCount + 1));
      } else {
        _addToPending(key, value);
      }
      return;
    }
    var sb = getSupabase();
    if (!sb) { _addToPending(key, value); return; }
    const { error } = await safeQuery(
      sb
        .from('app_data_store')
        .upsert({
          user_id: user.id,
          store_key: key,
          payload: value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'store_key' })
    );
    if (error) {
      console.warn('[SupabaseStore] setSync 写入失败，加入重试队列:', key, error);
      _addToPending(key, value);
    } else {
      const ts = new Date().toISOString();
      _cacheTimestamps[key] = ts;
      const count = Array.isArray(value) ? value.length + ' 条' : typeof value;
      console.log('[SupabaseStore] ✅ 已同步到云端:', key, count);
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

// 重试待处理队列 — 共享模式
async function _retryPending() {
  if (_pendingWrites.length === 0) {
    clearInterval(_retryTimer);
    _retryTimer = null;
    return;
  }
  const batch = [..._pendingWrites];
  _pendingWrites.length = 0;
  const user = await getCurrentUser();
  if (!user) {
    batch.forEach(w => _pendingWrites.push(w));
    return;
  }
  for (const item of batch) {
    try {
      const { error } = await safeQuery(
        getSupabase()
          .from('app_data_store')
          .upsert({
            user_id: user.id,
            store_key: item.key,
            payload: item.value,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'store_key' })
      );
      if (error) {
        console.warn('[SupabaseStore] 重试仍失败:', item.key, error);
        _pendingWrites.push(item);
      }
    } catch (e) {
      _pendingWrites.push(item);
    }
  }
}

// 立即刷新所有待处理写入（用于页面关闭前）— 共享模式
async function _flushSync() {
  if (_pendingWrites.length === 0) return;
  const batch = [..._pendingWrites];
  _pendingWrites.length = 0;
  for (const item of batch) {
    try {
      const user = await getCurrentUser();
      if (!user) { _pendingWrites.push(item); continue; }
      await safeQuery(
        getSupabase()
          .from('app_data_store')
          .upsert({
            user_id: user.id,
            store_key: item.key,
            payload: item.value,
            updated_at: new Date().toISOString(),
          }, { onConflict: 'store_key' })
      );
    } catch(e) {
      _pendingWrites.push(item);
    }
  }
}

/**
 * 从云端刷新数据（定时调用，检测其他用户的更新）
 * 多重对比策略：时间戳字符串 + JSON 内容，确保 Safari 兼容
 * 返回已变更的 key 列表
 */
async function refreshFromCloud() {
  if (!_initialized) return [];

  var sb = getSupabase();
  if (!sb) { console.warn('[SupabaseStore] refreshFromCloud: supabase 未就绪'); return []; }

  try {
    const { data, error } = await safeQuery(
      sb
        .from('app_data_store')
        .select('store_key, payload, updated_at')
    );

    if (error) { console.warn('[SupabaseStore] refreshFromCloud 查询错误:', error); return []; }
    if (!data) return [];

    const now = Date.now();
    const SKIP_WINDOW = 1000; // 1秒内自己写入的 key 跳过
    const changedKeys = [];
    let skippedCount = 0;
    let detailLogs = [];

    // 输出前3个key的时间戳用于调试（只输出一次）
    if (!_lastRefreshDebugTs || now - _lastRefreshDebugTs > 60000) {
      _lastRefreshDebugTs = now;
      const sample = data.slice(0, 3);
      console.log('[SupabaseStore] 刷新调试: 共', data.length, '条, 示例:', 
        sample.map(r => r.store_key + '@' + r.updated_at).join(', '));
      const localSample = [];
      for (const r of sample) {
        localSample.push(r.store_key + ':cacheTs=' + (_cacheTimestamps[r.store_key] || '无'));
      }
      console.log('[SupabaseStore] 刷新调试: 本地缓存时间戳:', localSample.join('; '));
    }

    for (const row of data) {
      const key = row.store_key;

      // 跳过自己最近写入的 key
      const lastWrite = _recentWrites[key] || 0;
      if (now - lastWrite < SKIP_WINDOW) {
        skippedCount++;
        continue;
      }

      let isChanged = false;
      const remoteTs = row.updated_at || '';
      const localTs = _cacheTimestamps[key] || '';

      if (_cache[key] === undefined) {
        // 新 key
        isChanged = true;
        detailLogs.push(key + ': 新key');
      } else if (remoteTs !== localTs) {
        // 时间戳字符串不同 — 一定变了
        isChanged = true;
        detailLogs.push(key + ': 时间戳 ' + (localTs || 'null') + ' → ' + (remoteTs || 'null'));
      } else {
        // 时间戳相同，用 JSON 内容对比
        const newVal = normalizePayload(row.payload);
        let oldStr = '', newStr = '';
        try {
          oldStr = JSON.stringify(_cache[key]);
          newStr = JSON.stringify(newVal);
        } catch (e) {
          isChanged = true;
          detailLogs.push(key + ': JSON异常');
        }
        if (!isChanged && oldStr !== newStr) {
          isChanged = true;
          detailLogs.push(key + ': 内容变化');
        }
      }

      if (isChanged) {
        _cache[key] = normalizePayload(row.payload);
        _cacheTimestamps[key] = remoteTs || new Date().toISOString();
        changedKeys.push(key);
      }
    }

    // 检查已删除的 key
    const remoteKeys = new Set(data.map(r => r.store_key));
    for (const localKey of Object.keys(_cache)) {
      if (!remoteKeys.has(localKey) && !_recentWrites[localKey]) {
        delete _cache[localKey];
        delete _cacheTimestamps[localKey];
        changedKeys.push(localKey);
        detailLogs.push(localKey + ': 已删除');
      }
    }

    if (changedKeys.length > 0) {
      console.log('[SupabaseStore] 🔄 云端数据变更:', changedKeys.join(', '), '|', detailLogs.join('; '));
      window.dispatchEvent(new CustomEvent('cloud-data-updated', {
        detail: { keys: changedKeys }
      }));
    } else {
      console.log('[SupabaseStore] 云端检查: 无变化（跳过', skippedCount, '个本地写入key，共', data.length, '个key）');
    }

    return changedKeys;
  } catch (e) {
    console.warn('[SupabaseStore] refreshFromCloud 异常:', e && e.message ? e.message : e);
    return [];
  }
}

/**
 * 强制全量刷新 — 绕过所有对比逻辑
 * 直接用云端数据覆盖本地缓存（保留最近写入的 key）
 * 事件通知只针对实际变化的 key（用 JSON 对比做过滤）
 */
async function forceRefreshFromCloud() {
  if (!_initialized) return [];

  var sb = getSupabase();
  if (!sb) return [];

  try {
    const { data, error } = await safeQuery(
      sb
        .from('app_data_store')
        .select('store_key, payload, updated_at')
    );

    if (error) { console.warn('[SupabaseStore] forceRefresh 查询错误:', error); return []; }
    if (!data) return [];

    const changedKeys = [];
    let updatedCount = 0;

    // 强制刷新：不跳过任何 key（包括自己刚写入的），全部用云端数据覆盖
    for (const row of data) {
      const key = row.store_key;

      const newVal = normalizePayload(row.payload);

      // 关键修复：先判断是否需要触发更新，再更新缓存
      // 避免先更新缓存导致对比永远相等的 Bug
      var needsEvent = false;
      if (_cache[key] !== undefined) {
        try {
          const oldStr = JSON.stringify(_cache[key]);
          const newStr = JSON.stringify(newVal);
          if (oldStr !== newStr) needsEvent = true;
        } catch (e) {
          needsEvent = true;
        }
      } else {
        needsEvent = true; // 新 key，需要触发
      }

      // 然后再更新缓存
      _cache[key] = newVal;
      _cacheTimestamps[key] = row.updated_at || new Date().toISOString();
      updatedCount++;

      if (needsEvent) {
        changedKeys.push(key);
      }
    }

    // 清理云端已删除的 key
    const remoteKeys = new Set(data.map(r => r.store_key));
    for (const localKey of Object.keys(_cache)) {
      if (!remoteKeys.has(localKey)) {
        delete _cache[localKey];
        delete _cacheTimestamps[localKey];
        changedKeys.push(localKey);
      }
    }

    console.log('[SupabaseStore] 🔄 强制刷新完成:', updatedCount, '个key已同步,', changedKeys.length, '个key触发更新');

    if (changedKeys.length > 0) {
      window.dispatchEvent(new CustomEvent('cloud-data-updated', {
        detail: { keys: changedKeys }
      }));
    }

    return changedKeys;
  } catch (e) {
    console.warn('[SupabaseStore] forceRefresh 异常:', e && e.message ? e.message : e);
    return [];
  }
}

// 辅助：检查缓存中是否有这个 key（用旧缓存做对比）
function oldCacheHas(key) {
  return _cache[key] !== undefined;
}
// 辅助：把旧缓存序列化成字符串（用于对比）
function _oldStringify(key) {
  return JSON.stringify(_cache[key]);
}

// 暴露到全局（非模块方式，兼容所有浏览器）
window.SupabaseStore = {
  init,
  get,
  set,
  remove,
  clearAll,
  reset,
  forceSync,
  getSync,
  setSync,
  refreshFromCloud,
  forceRefreshFromCloud,
  _flushSync,
  _isInitialized: () => _initialized,
  LOCAL_KEYS,
};

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
 * 从原始 localStorage 恢复数据（共享模式）
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
      return;
    }
    try {
      const origLS = window._origLocalStorage || window.localStorage;
      const raw = origLS.getItem(key);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed) && parsed.length > 0) {
          _cache[key] = parsed;
          // 异步保存到 Supabase（共享模式）
          getCurrentUser().then(user => {
            safeQuery(
              getSupabase()
                .from('app_data_store')
                .upsert({
                  user_id: user ? user.id : null,
                  store_key: key,
                  payload: parsed,
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'store_key' })
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
    setTimeout(() => {
      if (window.App && window.App._onDataChanged) {
        window.App._onDataChanged();
      }
    }, 500);
  }
}
