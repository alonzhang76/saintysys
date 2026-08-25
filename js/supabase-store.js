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

// ===== 调试标记（用于确认脚本是否成功加载）=====
// 如果此脚本加载成功，window._SUPABASE_STORE_LOADED === true
// 配合 localStorage-patch.js 中的检查使用
window._SUPABASE_STORE_LOADED = true;
console.log('[SupabaseStore] 📦 脚本文件已加载 (LS=' + window._SUPABASE_STORE_LOADED + ')');

// 从全局获取 supabase 客户端
// 关键修复：不缓存，每次都检查 window.supabase（Safari 兼容）
// 因为 Safari 中模块加载可能延迟或失败，需要动态获取
function getSupabase() {
  return window.supabase || null;
}

// UMD 回退加载器：当 ES Module 加载失败时（Safari 常见问题），
// 通过动态插入 <script> 标签加载 Supabase UMD 版本
var _umdLoading = false;
var _umdLoadPromise = null;

function loadSupabaseUMD() {
  if (window.supabase && window.supabase.auth) {
    return Promise.resolve(window.supabase);
  }
  if (_umdLoadPromise) return _umdLoadPromise;

  _umdLoadPromise = new Promise(function(resolve, reject) {
    if (_umdLoading) {
      // 已经在加载中，等待
      setTimeout(function() {
        if (window.supabase && window.supabase.auth) resolve(window.supabase);
        else reject(new Error('UMD loading timeout'));
      }, 5000);
      return;
    }
    _umdLoading = true;

    // Supabase 项目配置
    var SUPABASE_URL = "https://ugoyacuagslqhqguxyqe.supabase.co";
    var SUPABASE_PUBLISHABLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnb3lhY3VhZ3NscWhxZ3V4eXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MzI5NTUsImV4cCI6MjEwMjUwODk1NX0._GdWOGWblSpOYm3y8f_d3aVQszfn2YbRjHN0FqZiLtI";

    // 回退 CDN 列表（按优先级尝试）
    var cdnList = [
      'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.8/dist/umd/supabase.min.js',
      'https://unpkg.com/@supabase/supabase-js@2.49.8/dist/umd/supabase.min.js',
    ];
    var cdnIndex = 0;

    function tryLoadCDN() {
      if (cdnIndex >= cdnList.length) {
        _umdLoading = false;
        _umdLoadPromise = null;
        reject(new Error('所有 CDN 均加载失败，请检查网络连接'));
        return;
      }

      console.log('[SupabaseStore] 🔄 尝试加载 CDN:', cdnList[cdnIndex]);

      var script = document.createElement('script');
      script.src = cdnList[cdnIndex];
      script.async = true;
      script.onload = function() {
        // 等待 UMD 初始化完成，再检查结果
        setTimeout(function() {
          console.log('[SupabaseStore] 🔍 检查 UMD 加载结果...');
          console.log('[SupabaseStore] window.supabase =', typeof window.supabase, window.supabase ? Object.keys(window.supabase).slice(0,5) : 'null');
          console.log('[SupabaseStore] window.createClient =', typeof window.createClient);

          // 场景1: 已存在客户端实例（有 .auth 属性）
          if (window.supabase && window.supabase.auth) {
            console.log('[SupabaseStore] ✅ UMD 加载成功：已有客户端实例');
            _umdLoading = false;
            resolve(window.supabase);
            return;
          }

          // 场景2: window.supabase 是命名空间（有 .createClient 但无 .auth）
          if (window.supabase && typeof window.supabase.createClient === 'function') {
            try {
              var client = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
              });
              window.supabase = client;
              console.log('[SupabaseStore] ✅ UMD 加载成功：从命名空间创建客户端');
              _umdLoading = false;
              resolve(window.supabase);
              return;
            } catch(e) {
              console.warn('[SupabaseStore] createClient 失败:', e.message);
            }
          }

          // 场景3: window.createClient 存在（某些 UMD 版本）
          if (typeof window.createClient === 'function') {
            try {
              window.supabase = window.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
                auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
              });
              console.log('[SupabaseStore] ✅ UMD 加载成功：使用 window.createClient');
              _umdLoading = false;
              resolve(window.supabase);
              return;
            } catch(e) {
              console.warn('[SupabaseStore] window.createClient 失败:', e.message);
            }
          }

          // 都不满足，尝试下一个 CDN
          console.warn('[SupabaseStore] ⚠️ UMD 加载成功但无法初始化客户端，尝试下一个 CDN...');
          cdnIndex++;
          tryLoadCDN();
        }, 800);
      };
      script.onerror = function() {
        console.warn('[SupabaseStore] ❌ CDN 加载失败:', cdnList[cdnIndex]);
        cdnIndex++;
        tryLoadCDN();
      };
      document.head.appendChild(script);
    }

    tryLoadCDN();
  });

  return _umdLoadPromise;
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
 * 等待 window.supabase 加载完成
 * Safari 兼容：3秒内 ES Module 未加载则启动 UMD 回退
 */
function waitForSupabase(timeout) {
  timeout = timeout || 10000;
  var start = Date.now();
  var umdTriggered = false;
  var checkCount = 0;

  return new Promise(function(resolve) {
    function check() {
      checkCount++;
      if (window.supabase) {
        console.log('[SupabaseStore] ✅ window.supabase 已就绪 (等待', checkCount * 100, 'ms)');
        resolve(true);
        return;
      }

      // 关键修复：3秒后如果还没有 ES Module 加载，启动 UMD 回退
      if (!umdTriggered && Date.now() - start > 3000) {
        umdTriggered = true;
        console.warn('[SupabaseStore] ⚠️ ES Module 加载超时，启动 UMD 回退...');
        loadSupabaseUMD().then(function() {
          if (window.supabase) {
            console.log('[SupabaseStore] ✅ UMD 回退成功');
            resolve(true);
          }
        }).catch(function(err) {
          console.warn('[SupabaseStore] UMD 回退也失败:', err && err.message ? err.message : err);
        });
      }

      if (Date.now() - start > timeout) {
        console.error('[SupabaseStore] ❌ waitForSupabase 超时（', timeout, 'ms）');
        resolve(false);
      } else {
        setTimeout(check, 100);
      }
    }
    check();
  });
}

/**
 * 初始化：加载所有数据到内存缓存（共享模式）
 * 修复：不因用户验证失败中断读取 — 数据是共享的，不依赖用户身份
 */
async function init() {
  if (_initialized) return true;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    console.log('[SupabaseStore] 🔄 开始初始化...');

    // 等待 supabase.js 加载完成（带 UMD 回退）
    const sbReady = await waitForSupabase(10000);
    if (!sbReady) {
      console.error('[SupabaseStore] ❌ window.supabase 未加载（ES Module + UMD 均失败）');
      console.error('[SupabaseStore] ❌ 请检查网络连接或 Supabase CDN 访问权限');
      // 即使 Supabase 未就绪也设置 _initialized，避免无限等待
      // 后续 getSupabase() 就绪后可通过 forceRefreshFromCloud 重新加载
      return false;
    }

    console.log('[SupabaseStore] ✅ Supabase 已就绪，开始加载数据...');

    // 外层 try/catch：捕获整个初始化阶段的未处理异常
    try {

    // 用户验证（仅用于写入权限，不阻塞读取）
    var user = null;
    try {
      user = await getCurrentUser();
      if (user) {
        console.log('[SupabaseStore] ✅ 用户已登录:', user.email || user.id);
      } else {
        console.warn('[SupabaseStore] ⚠️ 未检测到登录用户，将以匿名模式加载共享数据');
      }
    } catch (e) {
      console.warn('[SupabaseStore] ⚠️ 用户验证异常，继续以匿名模式加载:', e && e.message ? e.message : e);
    }

    // 1) 迁移 localStorage 数据到 Supabase（仅在有用户时）
    if (user) {
      try {
        await migrateFromLocalStorage();
      } catch (e) {
        console.warn('[SupabaseStore] 迁移 localStorage 数据失败（可忽略）:', e && e.message ? e.message : e);
      }
    }

    // 2) 从 Supabase 加载所有数据到缓存（共享模式）
    var loadError = null;
    var queryOk = false;

    // 先尝试使用 Supabase JS 客户端查询
    var sbClient = getSupabase();
    if (sbClient && sbClient.from) {
      try {
        const { data, error } = await safeQuery(
          sbClient
            .from('app_data_store')
            .select('store_key, payload, updated_at')
        );

        if (error) {
          loadError = error;
          console.warn('[SupabaseStore] JS客户端查询失败，尝试 REST API 回退:', error.message || error);
        } else if (data) {
          data.forEach(function(row) {
            if (_cache[row.store_key] === undefined) {
              _cache[row.store_key] = normalizePayload(row.payload);
              _cacheTimestamps[row.store_key] = row.updated_at || new Date().toISOString();
            }
          });
          queryOk = true;
        }
      } catch (e) {
        loadError = e;
        console.warn('[SupabaseStore] JS客户端查询异常，尝试 REST API 回退:', e && e.message ? e.message : e);
      }
    }

    // REST API 回退：当 JS 客户端不可用时，直接用 fetch 调用 Supabase REST API
    // 双路径：先尝试标准头，失败后使用 URL 参数（Safari file:// 兼容）
    if (!queryOk) {
      console.log('[SupabaseStore] 🔄 尝试 REST API 直接查询...');
      var REST_URL = "https://ugoyacuagslqhqguxyqe.supabase.co";
      var REST_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnb3lhY3VhZ3NscWhxZ3V4eXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MzI5NTUsImV4cCI6MjEwMjUwODk1NX0._GdWOGWblSpOYm3y8f_d3aVQszfn2YbRjHN0FqZiLtI";
      var restSuccess = false;

      // 路径1: 自定义头
      try {
        var resp1 = await fetch(REST_URL + '/rest/v1/app_data_store?select=store_key,payload,updated_at', {
          headers: {
            'apikey': REST_KEY,
            'Authorization': 'Bearer ' + REST_KEY,
            'Prefer': 'return=representation'
          }
        });
        if (resp1.ok) {
          var data1 = await resp1.json();
          if (Array.isArray(data1)) {
            data1.forEach(function(row) {
              if (_cache[row.store_key] === undefined) {
                _cache[row.store_key] = normalizePayload(row.payload);
                _cacheTimestamps[row.store_key] = row.updated_at || new Date().toISOString();
              }
            });
            queryOk = true;
            restSuccess = true;
            console.log('[SupabaseStore] ✅ REST API(头) 回退成功，获取到', data1.length, '条数据');
          }
        }
      } catch (e1) {
        console.warn('[SupabaseStore] REST API(头) 失败:', e1 && e1.message ? e1.message : e1);
      }

      // 路径2: URL 参数（Safari file:// 兼容）
      if (!restSuccess) {
        try {
          var resp2 = await fetch(REST_URL + '/rest/v1/app_data_store?select=store_key,payload,updated_at&apikey=' + encodeURIComponent(REST_KEY), {
            cache: 'no-store'
          });
          if (!resp2.ok) throw new Error('HTTP ' + resp2.status);
          var data2 = await resp2.json();
          if (Array.isArray(data2)) {
            data2.forEach(function(row) {
              if (_cache[row.store_key] === undefined) {
                _cache[row.store_key] = normalizePayload(row.payload);
                _cacheTimestamps[row.store_key] = row.updated_at || new Date().toISOString();
              }
            });
            queryOk = true;
            console.log('[SupabaseStore] ✅ REST API(URL参数) 回退成功，获取到', data2.length, '条数据');
          }
        } catch (e2) {
          console.error('[SupabaseStore] REST API(URL参数) 也失败:', e2 && e2.message ? e2.message : e2);
        }
      }
    }

    if (!queryOk && loadError) {
      console.error('[SupabaseStore] ❌ 所有数据加载方式均失败:', loadError);
      return false;
    }

      _initialized = true;
      // 重置最近写入记录
      _recentWrites = {};
      console.log('[SupabaseStore] ✅ 初始化完成，已加载', Object.keys(_cache).length, '个数据集（共享模式）');
      console.log('[SupabaseStore] 缓存中的 keys:', Object.keys(_cache).join(', '));

      // 关键修复：初始化完成后立即强制刷新一次云端数据
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
      }, 200);

      return true;
    } catch (e) {
      console.error('[SupabaseStore] 初始化异常:', e && e.message ? e.message : e);
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

      // 共享模式：如果云端已经有这一行（store_key unique 冲突=409），说明 init-page.js 的独立写入
      // 通道已经先一步写成功了，直接忽略冲突即可，不要打红色的"迁移失败"误导用户。
      // 这里故意用 insert，若冲突再走 update，避免 upsert 时 accidentally 覆盖管理员刚更新的 newer 值。
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
        const isDup = error && (
          error.code === '23505' ||
          (String(error.message || '').indexOf('duplicate key') >= 0) ||
          (String(error.details || '').indexOf('store_key_key') >= 0) ||
          (String(error.message || '').indexOf('app_data_store_store_key_key') >= 0)
        );
        if (isDup) {
          console.log('[SupabaseStore] 迁移键已存在(云端优先)，跳过: ' + key);
        } else {
          console.warn('[SupabaseStore] 迁移失败:', key, error);
        }
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
  // 关键修复：设置近期写入记录，防止 init-page.js 轮询将云端旧数据覆盖本地新数据
  _recentWrites[key] = Date.now();

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
  // 关键修复：设置近期写入记录，防止 init-page.js 轮询将旧数据回灌
  _recentWrites[key] = Date.now();

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
    const SKIP_WINDOW = 10000; // 10秒内自己写入的 key 跳过（防止异步写入完成前被云端旧数据覆盖）
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

      // 关键修复：检查持久化的本地保存时间戳（_recentWrites 刷新后丢失）
      try {
        var origLS_rc = window._origLocalStorage || localStorage;
        var localSaveTsStr_rc = origLS_rc.getItem('_lastLocalSave_' + key);
        if (localSaveTsStr_rc) {
          var localSaveTs_rc = parseInt(localSaveTsStr_rc, 10) || 0;
          var cloudUpdatedAt_rc = 0;
          try { cloudUpdatedAt_rc = new Date(row.updated_at).getTime() || 0; } catch(_) {}
          if (localSaveTs_rc && cloudUpdatedAt_rc && localSaveTs_rc > cloudUpdatedAt_rc) {
            skippedCount++;
            continue;
          }
        }
      } catch(_) {}

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
  // 关键修复：即使未初始化也能使用 REST API 回退
  // 这样在 Safari 中即使 JS 客户端加载失败，也能通过 REST API 获取数据
  if (!_initialized) {
    // 未初始化状态：始终使用 REST API（不依赖 JS 客户端）
    // 修复之前的 Bug：当 window.supabase.from 存在但 _initialized 为 false 时
    // 之前直接返回 [] 而不走 REST，导致 Safari 无法获取数据
    console.log('[SupabaseStore] forceRefresh: 未初始化，使用 REST API');
    return refreshViaREST();
  }

  var sb = getSupabase();
  
  // 关键修复：如果 JS 客户端不可用，使用 REST API 回退
  if (!sb || !sb.from) {
    console.log('[SupabaseStore] forceRefresh: JS客户端不可用，使用 REST API 回退');
    return refreshViaREST();
  }

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
    // 关键修复：但仍需尊重持久化的本地保存时间戳（防止云端旧数据覆盖本地新保存的数据）
    for (const row of data) {
      const key = row.store_key;

      // 检查持久化的本地保存时间戳：如果本地保存时间晚于云端 updated_at，跳过覆盖
      try {
        var origLS_fr = window._origLocalStorage || localStorage;
        var localSaveTsStr_fr = origLS_fr.getItem('_lastLocalSave_' + key);
        if (localSaveTsStr_fr) {
          var localSaveTs_fr = parseInt(localSaveTsStr_fr, 10) || 0;
          var cloudUpdatedAt_fr = 0;
          try { cloudUpdatedAt_fr = new Date(row.updated_at).getTime() || 0; } catch(_) {}
          if (localSaveTs_fr && cloudUpdatedAt_fr && localSaveTs_fr > cloudUpdatedAt_fr) {
            continue;
          }
        }
      } catch(_) {}

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

// 辅助：检查缓存中是否有这个 key
function oldCacheHas(key) {
  return _cache[key] !== undefined;
}
// 辅助：把旧缓存序列化成字符串（用于对比）
function _oldStringify(key) {
  return JSON.stringify(_cache[key]);
}

// REST API 回退刷新（不依赖 Supabase JS 客户端）
var _REST_URL = "https://ugoyacuagslqhqguxyqe.supabase.co";
var _REST_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnb3lhY3VhZ3NscWhxZ3V4eXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MzI5NTUsImV4cCI6MjEwMjUwODk1NX0._GdWOGWblSpOYm3y8f_d3aVQszfn2YbRjHN0FqZiLtI";

async function refreshViaREST() {
  // 双路径策略：先尝试标准头方式，失败后使用 URL 参数方式（Safari file:// 兼容）
  var lastError = null;

  // 路径1: 使用自定义头（标准方式，但 Safari file:// 可能触发 CORS 预检）
  try {
    var resp1 = await fetch(_REST_URL + '/rest/v1/app_data_store?select=store_key,payload,updated_at', {
      headers: {
        'apikey': _REST_KEY,
        'Authorization': 'Bearer ' + _REST_KEY,
        'Prefer': 'return=representation'
      }
    });
    if (resp1.ok) {
      var rows1 = await resp1.json();
      if (Array.isArray(rows1)) {
        return _processRestRows(rows1, 'headers');
      }
    }
    lastError = new Error('路径1失败: HTTP ' + resp1.status);
  } catch (e1) {
    lastError = e1;
  }

  // 路径2: 使用 URL 查询参数（避免 CORS 预检，Safari file:// 兼容）
  try {
    var resp2 = await fetch(_REST_URL + '/rest/v1/app_data_store?select=store_key,payload,updated_at&apikey=' + encodeURIComponent(_REST_KEY), {
      cache: 'no-store'
    });
    if (!resp2.ok) throw new Error('HTTP ' + resp2.status);
    var rows2 = await resp2.json();
    if (!Array.isArray(rows2)) return [];
    return _processRestRows(rows2, 'url-param');
  } catch (e2) {
    console.warn('[SupabaseStore] REST 刷新两条路径均失败:', 
      '路径1:', lastError && lastError.message ? lastError.message : lastError,
      '路径2:', e2 && e2.message ? e2.message : e2);
    return [];
  }
}

// 内部方法：处理 REST 返回的数据行
function _processRestRows(rows, source) {
  var changedKeys = [];
  var updatedCount = 0;
  var syncToLocal = []; // 需要同步到原始 localStorage 的 key
  var now = Date.now();
  var SKIP_WINDOW = 10000; // 10秒内本地刚写入的 key 跳过（与 refreshFromCloud 一致）

  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var key = row.store_key;

    // 关键修复：检查 _recentWrites，跳过本地刚写入的 key（防止云端旧数据覆盖本地新数据）
    var lastWrite = _recentWrites[key] || 0;
    if (now - lastWrite < SKIP_WINDOW) continue;

    // 关键修复：检查持久化的本地保存时间戳（_recentWrites 刷新后丢失）
    try {
      var origLS_pr = window._origLocalStorage || localStorage;
      var localSaveTsStr_pr = origLS_pr.getItem('_lastLocalSave_' + key);
      if (localSaveTsStr_pr) {
        var localSaveTs_pr = parseInt(localSaveTsStr_pr, 10) || 0;
        var cloudUpdatedAt_pr = 0;
        try { cloudUpdatedAt_pr = new Date(row.updated_at).getTime() || 0; } catch(_) {}
        if (localSaveTs_pr && cloudUpdatedAt_pr && localSaveTs_pr > cloudUpdatedAt_pr) continue;
      }
    } catch(_) {}

    var newVal = normalizePayload(row.payload);

    // 先对比再更新
    var needsEvent = false;
    if (_cache[key] !== undefined) {
      try {
        if (JSON.stringify(_cache[key]) !== JSON.stringify(newVal)) needsEvent = true;
      } catch(e) { needsEvent = true; }
    } else {
      needsEvent = true;
    }

    _cache[key] = newVal;
    _cacheTimestamps[key] = row.updated_at || new Date().toISOString();
    updatedCount++;

    if (needsEvent) changedKeys.push(key);

    // 同时写入原始 localStorage（仅 SUPERSET_KEYS，跳过 dataVersion 等本地专属键）
    if (typeof SUPERSET_KEYS === 'undefined' || SUPERSET_KEYS.indexOf(key) >= 0) {
      syncToLocal.push({key: key, val: JSON.stringify(newVal)});
    }
  }

  // 批量写入原始 localStorage
  if (syncToLocal.length > 0) {
    try {
      var origLS = window._origLocalStorage || localStorage;
      for (var j = 0; j < syncToLocal.length; j++) {
        origLS.setItem(syncToLocal[j].key, syncToLocal[j].val);
      }
      console.log('[SupabaseStore] REST 同步:', syncToLocal.length, '个key写入原始localStorage');
    } catch(e) {
      console.warn('[SupabaseStore] 写入原始localStorage失败:', e && e.message ? e.message : e);
    }
  }

  console.log('[SupabaseStore] 🔄 REST 刷新完成(' + source + '):', updatedCount, '个key,', changedKeys.length, '个变更');
  if (changedKeys.length > 0) {
    window.dispatchEvent(new CustomEvent('cloud-data-updated', {
      detail: { keys: changedKeys }
    }));
  }
  return changedKeys;
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
  refreshViaREST,
  loadSupabaseUMD,
  _flushSync,
  _isInitialized: function() { return _initialized; },
  _getCache: function() { return _cache; },
  get _recentWrites() { return _recentWrites; },
  LOCAL_KEYS: LOCAL_KEYS,
};

// 就绪标志：页面可以 await window.SupabaseReady
window.SupabaseReady = init();

// 自动初始化完成后标记（含失败重试机制）
window.SupabaseReady.then(function(ok) {
  if (ok) {
    console.log('[SupabaseStore] ✅ 已连接到云端存储');
    recoverFromLocalStorage();
  } else {
    console.log('[SupabaseStore] ⚠️ 初始连接失败，启动后台重试机制...');
    // 关键修复：初始化失败后，每 5 秒重试一次
    var retryCount = 0;
    var maxRetries = 12; // 最多重试 1 分钟
    var retryTimer = setInterval(function() {
      retryCount++;
      if (_initialized) {
        clearInterval(retryTimer);
        console.log('[SupabaseStore] ✅ 重试成功（第', retryCount, '次）');
        recoverFromLocalStorage();
        // 触发一次强制刷新
        forceRefreshFromCloud();
        return;
      }
      if (retryCount > maxRetries) {
        clearInterval(retryTimer);
        console.warn('[SupabaseStore] ❌ 重试次数耗尽，停止自动重试');
        return;
      }
      console.log('[SupabaseStore] 🔄 重试初始化（第', retryCount, '/', maxRetries, '次）...');
      // 重置 init 状态以允许重新初始化
      _initialized = false;
      _initPromise = null;
      init().then(function(ok2) {
        if (ok2) {
          clearInterval(retryTimer);
        }
      });
    }, 5000);
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
