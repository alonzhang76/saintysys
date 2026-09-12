/* ===== CloudBase 统一数据存储层 cloudbase-store.js =====
 *
 * 替代 App.store 的 localStorage 实现，所有业务数据存到 CloudBase 云数据库
 * 使用方式：与 App.store 完全兼容
 *   CloudbaseStore.get(key, defaultVal)   → 获取数据
 *   CloudbaseStore.set(key, value)        → 保存数据
 *   CloudbaseStore.remove(key)            → 删除数据
 *
 * 初始化：每个页面加载时调用 CloudbaseStore.init()
 * 首次初始化时自动将 localStorage 中已有数据迁移到云端
 *
 * 数据集合：app_data_store（存储各模块 key-value 数据）
 * - _id（= store_key，以数据键名作为文档 ID，天然防重复）
 * - user_id（记录写入者，仅溯源用，不用于数据隔离）
 * - store_key text（数据键名）
 * - payload（数据内容，任意 JSON）
 * - updated_at（ISO 时间字符串）
 *
 * 注意：已去除原 Supabase REST 回退通道 —— window.supabase 兼容层
 * （js/cloudbase.js）加载即就绪，统一走 CloudBase JS SDK。
 */

// ===== 调试标记（用于确认脚本是否成功加载）=====
window._CLOUDBASE_STORE_LOADED = true;
window._SUPABASE_STORE_LOADED = true; // 兼容别名（localstorage-patch.js 检查此标志）
console.log('[CloudbaseStore] 📦 脚本文件已加载 (LS=' + window._CLOUDBASE_STORE_LOADED + ')');

// 从全局获取 supabase 兼容客户端（底层 CloudBase）
// 不缓存：每次都检查 window.supabase（Safari 模块加载时序兼容）
function getSupabase() {
  return window.supabase || null;
}

/**
 * 等待 window.supabase 兼容层就绪
 * cloudbase.js 是 ES module，可能晚于本脚本执行
 */
function waitForClient(timeout) {
  timeout = timeout || 10000;
  var start = Date.now();
  var checkCount = 0;
  return new Promise(function (resolve) {
    function check() {
      checkCount++;
      if (window.supabase && window.supabase.from) {
        console.log('[CloudbaseStore] ✅ window.supabase 兼容层已就绪 (等待', checkCount * 100, 'ms)');
        resolve(true);
        return;
      }
      if (Date.now() - start > timeout) {
        console.error('[CloudbaseStore] ❌ waitForClient 超时（', timeout, 'ms）');
        resolve(false);
      } else {
        setTimeout(check, 100);
      }
    }
    check();
  });
}

/**
 * 验证并规范化 payload 数据
 * 确保数据是数组或对象，避免 .filter 等方法报错
 * 深度提取嵌套 data 结构
 */
function normalizePayload(payload) {
  if (payload === null || payload === undefined) return null;
  if (typeof payload === 'object' && !Array.isArray(payload) && payload.data !== undefined) {
    return normalizePayload(payload.data);
  }
  return payload;
}

/**
 * 根据默认值类型规范化返回值
 */
function coerceType(value, defaultVal) {
  if (value === undefined || value === null) return defaultVal;
  if (Array.isArray(defaultVal) && !Array.isArray(value)) {
    if (typeof value === 'object' && !Array.isArray(value) && value.data !== undefined) {
      const extracted = normalizePayload(value);
      if (Array.isArray(extracted)) return extracted;
    }
    return defaultVal;
  }
  return value;
}

// 本地缓存（避免每次读写都请求云端）
const _cache = {};
const _cacheTimestamps = {};
let _initialized = false;
let _initPromise = null;
let _lastRefreshDebugTs = 0;

// 需要迁移的 localStorage 键 → 云端 store_key 映射
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

const LOCAL_KEYS = MIGRATION_KEYS;

async function getCurrentUser() {
  var sb = getSupabase();
  if (!sb || !sb.auth) return null;
  const { data, error } = await sb.auth.getUser();
  if (error || !data || !data.user) return null;
  return data.user;
}

/**
 * 初始化：加载所有数据到内存缓存（共享模式）
 * 不因用户验证失败中断读取 — 数据是共享的，不依赖用户身份
 */
async function init() {
  if (_initialized) return true;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    console.log('[CloudbaseStore] 🔄 开始初始化...');

    // 等待 cloudbase.js 兼容层加载完成
    const sbReady = await waitForClient(10000);
    if (!sbReady) {
      console.error('[CloudbaseStore] ❌ window.supabase 兼容层未加载（请检查 js/cloudbase.js）');
      return false;
    }

    console.log('[CloudbaseStore] ✅ CloudBase 兼容层已就绪，开始加载数据...');

    try {
      // 用户验证（仅用于写入溯源，不阻塞读取）
      var user = null;
      try {
        user = await getCurrentUser();
        if (user) {
          console.log('[CloudbaseStore] ✅ 用户已登录:', user.email || user.id);
        } else {
          console.warn('[CloudbaseStore] ⚠️ 未检测到登录用户，将以匿名模式加载共享数据');
        }
      } catch (e) {
        console.warn('[CloudbaseStore] ⚠️ 用户验证异常，继续以匿名模式加载:', e && e.message ? e.message : e);
      }

      // 1) 迁移 localStorage 数据到云端（仅在有用户时）
      if (user) {
        try {
          await migrateFromLocalStorage();
        } catch (e) {
          console.warn('[CloudbaseStore] 迁移 localStorage 数据失败（可忽略）:', e && e.message ? e.message : e);
        }
      }

      // 2) 从云端加载所有数据到缓存（共享模式）
      var sbClient = getSupabase();
      var queryOk = false;
      if (sbClient && sbClient.from) {
        try {
          const { data, error } = await sbClient
            .from('app_data_store')
            .select('store_key, payload, updated_at');

          if (error) {
            console.warn('[CloudbaseStore] 初始查询失败:', error.message || error);
          } else if (data) {
            data.forEach(function (row) {
              if (_cache[row.store_key] === undefined) {
                _cache[row.store_key] = normalizePayload(row.payload);
                _cacheTimestamps[row.store_key] = row.updated_at || new Date().toISOString();
              }
            });
            queryOk = true;
          }
        } catch (e) {
          console.warn('[CloudbaseStore] 初始查询异常:', e && e.message ? e.message : e);
        }
      }

      if (!queryOk) {
        console.error('[CloudbaseStore] ❌ 初始数据加载失败');
        return false;
      }

      _initialized = true;
      _recentWrites = {};
      console.log('[CloudbaseStore] ✅ 初始化完成，已加载', Object.keys(_cache).length, '个数据集（共享模式）');
      console.log('[CloudbaseStore] 缓存中的 keys:', Object.keys(_cache).join(', '));

      // 初始化完成后立即强制刷新一次云端数据
      console.log('[CloudbaseStore] 🔄 立即执行首次云端同步...');
      setTimeout(function () {
        forceRefreshFromCloud().then(function (changed) {
          if (changed && changed.length > 0) {
            console.log('[CloudbaseStore] ✅ 首次同步获取到', changed.length, '个数据变更:', changed.join(', '));
          } else {
            console.log('[CloudbaseStore] ✅ 首次同步完成，无新变更');
          }
        }).catch(function (e) {
          console.warn('[CloudbaseStore] 首次同步出错:', e && e.message ? e.message : e);
        });
      }, 200);

      return true;
    } catch (e) {
      console.error('[CloudbaseStore] 初始化异常:', e && e.message ? e.message : e);
      return false;
    }
  })();

  return _initPromise;
}

/**
 * 将 localStorage 中存在但云端没有的数据迁移过来
 * 共享模式：不按 user_id 区分，所有数据共享一行（doc id = store_key）
 */
async function migrateFromLocalStorage() {
  const origGetItem = (window._origLocalStorage && window._origLocalStorage.getItem) || localStorage.getItem.bind(localStorage);

  // 1. 一次性获取云端所有已存在的 store_key
  let existingKeys = new Set();
  try {
    const { data, error } = await getSupabase().from('app_data_store').select('store_key');
    if (!error && data) {
      data.forEach(row => existingKeys.add(row.store_key));
    }
  } catch (e) {
    console.warn('[CloudbaseStore] 迁移：查询已有 keys 失败:', e);
  }

  // 2. 遍历 localStorage，只迁移云端不存在的 key
  let migratedCount = 0;
  const user = await getCurrentUser();

  for (const key of LOCAL_KEYS) {
    if (['isLoggedIn', 'username', 'userRole', 'currentUserId', 'refDPR'].includes(key)) continue;
    if (existingKeys.has(key)) continue;

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

      // 共享模式：doc id = store_key，set 即 upsert；云端已有则跳过（已在 existingKeys 中过滤）
      const { error } = await getSupabase()
        .from('app_data_store')
        .upsert({
          user_id: user ? user.id : null,
          store_key: key,
          payload: payload,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'store_key' });

      if (error) {
        console.warn('[CloudbaseStore] 迁移失败:', key, error);
      } else {
        migratedCount++;
        console.log('[CloudbaseStore] 已迁移:', key);
      }
    } catch (e) {
      console.warn('[CloudbaseStore] 迁移解析失败:', key, e);
    }
  }

  if (migratedCount > 0) {
    console.log('[CloudbaseStore] 共迁移', migratedCount, '个数据集');
  }
}

/**
 * 强制重新同步 localStorage → 云端
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

    const { error } = await getSupabase()
      .from('app_data_store')
      .upsert({
        user_id: user.id,
        store_key: key,
        payload: payload,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'store_key' });

    if (!error) {
      _cache[key] = payload;
      synced++;
    } else {
      console.warn('[CloudbaseStore] forceSync 失败:', key, error);
    }
  }

  console.log('[CloudbaseStore] forceSync 完成: 同步', synced, '个, 跳过', skipped, '个(本地无数据)');
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

  try {
    const { data, error } = await getSupabase()
      .from('app_data_store')
      .select('payload')
      .eq('store_key', key)
      .limit(1);

    if (error) return defaultVal;
    if (data && data.length > 0) {
      const payload = normalizePayload(data[0].payload);
      _cache[key] = payload;
      return JSON.parse(JSON.stringify(payload));
    }
    return defaultVal;
  } catch (e) {
    console.warn('[CloudbaseStore] get 失败:', key, e);
    return defaultVal;
  }
}

/**
 * 保存数据（共享模式：onConflict 用 store_key → doc id = store_key）
 */
async function set(key, value) {
  if (!_initialized) await init();

  const user = await getCurrentUser();

  _cache[key] = JSON.parse(JSON.stringify(value));
  _recentWrites[key] = Date.now();

  try {
    const { error } = await getSupabase()
      .from('app_data_store')
      .upsert({
        user_id: user ? user.id : null,
        store_key: key,
        payload: value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'store_key' });

    if (error) {
      console.error('[CloudbaseStore] set 失败:', key, error);
      return false;
    }
    return true;
  } catch (e) {
    console.error('[CloudbaseStore] set 异常:', key, e);
    return false;
  }
}

/**
 * 删除数据（共享模式：按 store_key 删除 → doc id = store_key）
 */
async function remove(key) {
  if (!_initialized) await init();

  delete _cache[key];
  delete _cacheTimestamps[key];
  _recentWrites[key] = Date.now();

  try {
    const { error } = await getSupabase()
      .from('app_data_store')
      .delete()
      .eq('store_key', key);

    if (error) return false;
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * 清除所有数据（清空数据功能）
 * 共享模式：清空整个集合（所有用户的数据）
 */
async function clearAll() {
  Object.keys(_cache).forEach(k => delete _cache[k]);
  Object.keys(_cacheTimestamps).forEach(k => delete _cacheTimestamps[k]);

  try {
    const { error } = await getSupabase()
      .from('app_data_store')
      .delete()
      .neq('store_key', '__never_exists__'); // 删除所有行

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
  _asyncWrite(key, value, 0);
}

// 异步写入（支持重试）— 共享模式
async function _asyncWrite(key, value, retryCount) {
  try {
    var sb = getSupabase();
    if (!sb) {
      if (retryCount < 3) {
        setTimeout(() => _asyncWrite(key, value, retryCount + 1), 1000 * (retryCount + 1));
      } else {
        _addToPending(key, value);
      }
      return;
    }
    const user = await getCurrentUser();
    const { error } = await sb
      .from('app_data_store')
      .upsert({
        user_id: user ? user.id : null,
        store_key: key,
        payload: value,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'store_key' });
    if (error) {
      console.warn('[CloudbaseStore] setSync 写入失败，加入重试队列:', key, error);
      _addToPending(key, value);
    } else {
      const ts = new Date().toISOString();
      _cacheTimestamps[key] = ts;
      const count = Array.isArray(value) ? value.length + ' 条' : typeof value;
      console.log('[CloudbaseStore] ✅ 已同步到云端:', key, count);
    }
  } catch (e) {
    console.warn('[CloudbaseStore] setSync 异常，加入重试队列:', key, e);
    _addToPending(key, value);
  }
}

// 加入待处理队列
function _addToPending(key, value) {
  const existing = _pendingWrites.find(w => w.key === key);
  if (existing) {
    existing.value = value;
    existing.timestamp = Date.now();
  } else {
    _pendingWrites.push({ key, value, timestamp: Date.now() });
  }
  if (!_retryTimer) {
    _retryTimer = setInterval(_retryPending, 5000);
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
  for (const item of batch) {
    try {
      const { error } = await getSupabase()
        .from('app_data_store')
        .upsert({
          user_id: null,
          store_key: item.key,
          payload: item.value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'store_key' });
      if (error) {
        console.warn('[CloudbaseStore] 重试仍失败:', item.key, error);
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
      await getSupabase()
        .from('app_data_store')
        .upsert({
          user_id: null,
          store_key: item.key,
          payload: item.value,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'store_key' });
    } catch (e) {
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
  if (!sb) { console.warn('[CloudbaseStore] refreshFromCloud: 兼容层未就绪'); return []; }

  try {
    const { data, error } = await sb
      .from('app_data_store')
      .select('store_key, payload, updated_at');

    if (error) { console.warn('[CloudbaseStore] refreshFromCloud 查询错误:', error); return []; }
    if (!data) return [];

    const now = Date.now();
    const SKIP_WINDOW = 10000; // 10秒内自己写入的 key 跳过
    const changedKeys = [];
    let skippedCount = 0;
    let detailLogs = [];

    if (!_lastRefreshDebugTs || now - _lastRefreshDebugTs > 60000) {
      _lastRefreshDebugTs = now;
      const sample = data.slice(0, 3);
      console.log('[CloudbaseStore] 刷新调试: 共', data.length, '条, 示例:',
        sample.map(r => r.store_key + '@' + r.updated_at).join(', '));
      const localSample = [];
      for (const r of sample) {
        localSample.push(r.store_key + ':cacheTs=' + (_cacheTimestamps[r.store_key] || '无'));
      }
      console.log('[CloudbaseStore] 刷新调试: 本地缓存时间戳:', localSample.join('; '));
    }

    for (const row of data) {
      const key = row.store_key;

      const lastWrite = _recentWrites[key] || 0;
      if (now - lastWrite < SKIP_WINDOW) {
        skippedCount++;
        continue;
      }

      // 检查持久化的本地保存时间戳（_recentWrites 刷新后丢失）
      try {
        var origLS_rc = window._origLocalStorage || localStorage;
        var localSaveTsStr_rc = origLS_rc.getItem('_lastLocalSave_' + key);
        if (localSaveTsStr_rc) {
          var localSaveTs_rc = parseInt(localSaveTsStr_rc, 10) || 0;
          var cloudUpdatedAt_rc = 0;
          try { cloudUpdatedAt_rc = new Date(row.updated_at).getTime() || 0; } catch (_) {}
          if (localSaveTs_rc && cloudUpdatedAt_rc && localSaveTs_rc > cloudUpdatedAt_rc) {
            skippedCount++;
            continue;
          }
        }
      } catch (_) {}

      let isChanged = false;
      const remoteTs = row.updated_at || '';
      const localTs = _cacheTimestamps[key] || '';

      if (_cache[key] === undefined) {
        isChanged = true;
        detailLogs.push(key + ': 新key');
      } else if (remoteTs !== localTs) {
        isChanged = true;
        detailLogs.push(key + ': 时间戳 ' + (localTs || 'null') + ' → ' + (remoteTs || 'null'));
      } else {
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
      console.log('[CloudbaseStore] 🔄 云端数据变更:', changedKeys.join(', '), '|', detailLogs.join('; '));
      window.dispatchEvent(new CustomEvent('cloud-data-updated', {
        detail: { keys: changedKeys }
      }));
    } else {
      console.log('[CloudbaseStore] 云端检查: 无变化（跳过', skippedCount, '个本地写入key，共', data.length, '个key）');
    }

    return changedKeys;
  } catch (e) {
    console.warn('[CloudbaseStore] refreshFromCloud 异常:', e && e.message ? e.message : e);
    return [];
  }
}

/**
 * 强制全量刷新 — 绕过所有对比逻辑
 * 直接用云端数据覆盖本地缓存（保留最近写入的 key）
 */
async function forceRefreshFromCloud() {
  var sb = getSupabase();
  if (!sb || !sb.from) {
    console.log('[CloudbaseStore] forceRefresh: 兼容层不可用');
    return [];
  }

  try {
    const { data, error } = await sb
      .from('app_data_store')
      .select('store_key, payload, updated_at');

    if (error) { console.warn('[CloudbaseStore] forceRefresh 查询错误:', error); return []; }
    if (!data) return [];

    const changedKeys = [];
    let updatedCount = 0;

    for (const row of data) {
      const key = row.store_key;

      // 尊重持久化的本地保存时间戳（防止云端旧数据覆盖本地新保存的数据）
      try {
        var origLS_fr = window._origLocalStorage || localStorage;
        var localSaveTsStr_fr = origLS_fr.getItem('_lastLocalSave_' + key);
        if (localSaveTsStr_fr) {
          var localSaveTs_fr = parseInt(localSaveTsStr_fr, 10) || 0;
          var cloudUpdatedAt_fr = 0;
          try { cloudUpdatedAt_fr = new Date(row.updated_at).getTime() || 0; } catch (_) {}
          if (localSaveTs_fr && cloudUpdatedAt_fr && localSaveTs_fr > cloudUpdatedAt_fr) {
            continue;
          }
        }
      } catch (_) {}

      const newVal = normalizePayload(row.payload);

      // 先判断是否需要触发更新，再更新缓存
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
        needsEvent = true;
      }

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

    console.log('[CloudbaseStore] 🔄 强制刷新完成:', updatedCount, '个key已同步,', changedKeys.length, '个key触发更新');

    if (changedKeys.length > 0) {
      window.dispatchEvent(new CustomEvent('cloud-data-updated', {
        detail: { keys: changedKeys }
      }));
    }

    return changedKeys;
  } catch (e) {
    console.warn('[CloudbaseStore] forceRefresh 异常:', e && e.message ? e.message : e);
    return [];
  }
}

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
          // 异步保存到云端（共享模式）
          getSupabase()
            .from('app_data_store')
            .upsert({
              user_id: null,
              store_key: key,
              payload: parsed,
              updated_at: new Date().toISOString(),
            }, { onConflict: 'store_key' })
            .catch(e => console.warn('[CloudbaseStore] 恢复保存失败:', key, e));
          recovered++;
        }
      }
    } catch (e) {
      // 忽略解析错误
    }
  });

  if (recovered > 0) {
    console.log('[CloudbaseStore] 🔄 已从 localStorage 恢复', recovered, '个数据集');
    setTimeout(() => {
      if (window.App && window.App._onDataChanged) {
        window.App._onDataChanged();
      }
    }, 500);
  }
}

// 暴露到全局（非模块方式，兼容所有浏览器）
// 同时保留 window.SupabaseStore 别名，兼容页面内联脚本的既有引用
var storePublicApi = {
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
  _isInitialized: function () { return _initialized; },
  _getCache: function () { return _cache; },
  get _recentWrites() { return _recentWrites; },
  LOCAL_KEYS: LOCAL_KEYS,
};
window.CloudbaseStore = storePublicApi;
window.SupabaseStore = storePublicApi; // 兼容别名

// 就绪标志：页面可以 await window.CloudbaseReady（兼容别名 SupabaseReady）
var readyPromise = init();
window.CloudbaseReady = readyPromise;
window.SupabaseReady = readyPromise; // 兼容别名

// 自动初始化完成后标记（含失败重试机制）
readyPromise.then(function (ok) {
  if (ok) {
    console.log('[CloudbaseStore] ✅ 已连接到云端存储');
    recoverFromLocalStorage();
  } else {
    console.log('[CloudbaseStore] ⚠️ 初始连接失败，启动后台重试机制...');
    var retryCount = 0;
    var maxRetries = 12;
    var retryTimer = setInterval(function () {
      retryCount++;
      if (_initialized) {
        clearInterval(retryTimer);
        console.log('[CloudbaseStore] ✅ 重试成功（第', retryCount, '次）');
        recoverFromLocalStorage();
        forceRefreshFromCloud();
        return;
      }
      if (retryCount > maxRetries) {
        clearInterval(retryTimer);
        console.warn('[CloudbaseStore] ❌ 重试次数耗尽，停止自动重试');
        return;
      }
      console.log('[CloudbaseStore] 🔄 重试初始化（第', retryCount, '/', maxRetries, '次）...');
      _initialized = false;
      _initPromise = null;
      init().then(function (ok2) {
        if (ok2) {
          clearInterval(retryTimer);
        }
      });
    }, 5000);
  }
});
