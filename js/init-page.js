/**
 * 页面初始化助手
 * 
 * 用法：
 * 1. 所有函数定义放在全局作用域（直接在 <script> 内，不在任何回调中）
 * 2. 需要等待 Supabase 的初始化代码放在 _init(function() { ... }) 中
 * 
 * 这样 HTML 的 onclick 属性可以找到全局函数，
 * 同时初始化代码仍然等待 Supabase 就绪。
 */
(function(global) {
  var initQueue = [];
  var initialized = false;

  function runInit(fn) {
    try {
      fn();
    } catch (e) {
      console.error('[init-page] 初始化出错:', e);
    }
  }

  function tryRunAll() {
    if (initialized) return;
    var queue = initQueue.slice();
    initQueue = [];
    initialized = true;
    queue.forEach(runInit);
  }

  // 暴露到全局
  global._init = function(fn) {
    if (typeof fn !== 'function') {
      console.warn('[init-page] _init 需要传入函数');
      return;
    }
    if (initialized) {
      runInit(fn);
    } else {
      initQueue.push(fn);
    }
  };

  // 等待 Supabase 就绪后执行所有初始化
  function waitAndRun() {
    if (window.SupabaseReady) {
      window.SupabaseReady.then(function() {
        tryRunAll();
      }).catch(function() {
        console.warn('[init-page] Supabase 连接失败，仍然执行初始化');
        tryRunAll();
      });
    } else {
      tryRunAll();
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndRun);
  } else {
    waitAndRun();
  }

  // 超时兜底
  setTimeout(function() {
    if (!initialized) {
      console.warn('[init-page] 超时（15s），强制执行初始化');
      tryRunAll();
    }
  }, 15000);

  // ===== 15 秒定时刷新云端数据 =====
  // 使用 Web Worker 实现定时器（完全不受 Safari/iOS 标签页节流限制）
  var _cloudRefreshActive = false;

  function startCloudRefresh() {
    if (_cloudRefreshActive) return;
    _cloudRefreshActive = true;

    function doRefresh() {
      var store = window.SupabaseStore;

      // 兜底：即使 SupabaseStore 完全不可用，也通过独立轮询获取数据
      if (!store) {
        console.log('[init-page] ⚠️ SupabaseStore 未加载，使用独立 fetch 兜底...');
        // 直接使用 fetch 获取数据（与 independentPoll 类似但更简单）
        var FALLBACK_URL = 'https://ugoyacuagslqhqguxyqe.supabase.co/rest/v1/app_data_store';
        var FALLBACK_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnb3lhY3VhZ3NscWhxZ3V4eXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MzI5NTUsImV4cCI6MjEwMjUwODk1NX0._GdWOGWblSpOYm3y8f_d3aVQszfn2YbRjHN0FqZiLtI';
        var userToken = null;
        try { userToken = (typeof getUserAccessToken === 'function') ? getUserAccessToken() : null; } catch(_e) {}
        var fbHeaders = {};
        if (userToken) fbHeaders['Authorization'] = 'Bearer ' + userToken;
        fetch(FALLBACK_URL + '?select=store_key,payload,updated_at&apikey=' + encodeURIComponent(FALLBACK_KEY), {cache: 'no-store', headers: fbHeaders})
          .then(function(resp) { return resp.ok ? resp.json() : Promise.reject(resp.status); })
          .then(function(rows) {
            if (!Array.isArray(rows)) return;
            var changedKeys = [];
            var origLS = window._origLocalStorage || localStorage;
            for (var i = 0; i < rows.length; i++) {
              var row = rows[i];
              origLS.setItem(row.store_key, JSON.stringify(row.payload));
              changedKeys.push(row.store_key);
            }
            console.log('[init-page] ✅ 兜底刷新完成:', changedKeys.length, '个key');
            if (changedKeys.length > 0) {
              window.dispatchEvent(new CustomEvent('cloud-data-updated', {
                detail: { keys: changedKeys }
              }));
            }
          })
          .catch(function(e) {
            if (Date.now() % 30000 < 15000) {
              console.warn('[init-page] 兜底刷新失败:', e && e.message ? e.message : e);
            }
          });
        return;
      }

      // 关键修复：即使未初始化也尝试刷新（forceRefreshFromCloud 内部会使用 REST API 回退）
      var isInit = store._isInitialized && store._isInitialized();
      if (!isInit) {
        // 未初始化状态下，直接尝试 REST API 刷新
        console.log('[init-page] 🔄 未初始化状态，尝试 REST API 刷新...');
        if (store.refreshViaREST) {
          store.refreshViaREST()
            .then(function(changed) {
              if (changed && changed.length > 0) {
                console.log('[init-page] ✅ REST 刷新完成:', changed.length, '个 key 变更');
                // 数据加载成功后，尝试重新初始化
                if (!isInit) {
                  console.log('[init-page] 🔄 数据已获取，尝试重新初始化...');
                  store.init && store.init();
                }
              } else {
                console.log('[init-page] ⏱️ REST 刷新完成，无新数据');
              }
            })
            .catch(function(e) {
              console.warn('[init-page] REST 刷新出错:', e && e.message ? e.message : e);
            });
        }
        return;
      }

      console.log('[init-page] 🔄 触发云端刷新...');
      // 使用 forceRefreshFromCloud 确保 Safari 等浏览器也能正确同步
      var fn = store.forceRefreshFromCloud || store.refreshFromCloud;
      fn.call(store)
        .then(function(changed) {
          if (changed && changed.length > 0) {
            console.log('[init-page] ✅ 云端刷新完成:', changed.length, '个 key 变更');
          } else {
            console.log('[init-page] ⏱️ 刷新完成，无新数据');
          }
        })
        .catch(function(e) {
          console.warn('[init-page] 云端刷新出错:', e && e.message ? e.message : e);
        });
    }

    // 方案 1: 使用 Web Worker（最可靠，完全不受节流影响）
    var lastWorkerTick = Date.now();
    try {
      var workerCode = [
        'var timer = setInterval(function() {',
        '  self.postMessage("tick");',
        '}, 15000);',
        'self.addEventListener("message", function(e) {',
        '  if (e.data === "stop") { clearInterval(timer); timer = null; }',
        '});'
      ].join('\n');
      var workerBlob = new Blob([workerCode], { type: 'application/javascript' });
      var workerUrl = URL.createObjectURL(workerBlob);
      var worker = new Worker(workerUrl);
      worker.addEventListener('message', function() {
        lastWorkerTick = Date.now();
        doRefresh();
      });
      worker.onerror = function(err) {
        console.warn('[init-page] Web Worker 错误:', err && err.message ? err.message : err);
      };
      console.log('[init-page] 🔄 Web Worker 定时器已启动（15秒轮询）');

      // 看门狗：如果 Worker 超过 35 秒没发消息，重新启动
      setInterval(function() {
        if (Date.now() - lastWorkerTick > 35000) {
          console.warn('[init-page] Worker 长时间无响应，重启');
          try {
            worker.terminate();
            var w2 = new Worker(workerUrl);
            w2.addEventListener('message', function() {
              lastWorkerTick = Date.now();
              doRefresh();
            });
            worker = w2;
            lastWorkerTick = Date.now();
          } catch (e) {
            console.warn('[init-page] Worker 重启失败:', e.message);
          }
        }
      }, 10000);
    } catch (e) {
      // 方案 2: Web Worker 不可用时，用递归 setTimeout（有节流风险）
      console.warn('[init-page] Web Worker 不可用，降级为 setTimeout:', e.message);
      function scheduleNext() {
        setTimeout(function() {
          doRefresh();
          scheduleNext();
        }, 15000);
      }
      scheduleNext();
    }

    // 立即执行一次（不等 15 秒）
    setTimeout(doRefresh, 3000);

    // 额外保障：即使 Worker 正常，也同时启动 setTimeout 轮询
    // Safari 某些版本 Worker 消息可能延迟或丢失
    function scheduleNext() {
      setTimeout(function() {
        doRefresh();
        scheduleNext();
      }, 15000);
    }
    scheduleNext();

    // 页面从后台切回时立即刷新（兼顾 visibilitychange 事件）
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden) {
        console.log('[init-page] 页面切回前台，立即刷新');
        doRefresh();
      }
    });

    // Safari 特有的 pageshow 事件（从 bfcache 恢复时触发）
    window.addEventListener('pageshow', function(e) {
      if (e.persisted) {
        console.log('[init-page] 从缓存恢复，立即刷新');
        doRefresh();
      }
    });

    // Safari 特定：mouseover / focus 事件也触发一次刷新
    // （某些 Safari 版本 visibilitychange 不可靠）
    var lastRefresh = 0;
    document.addEventListener('mouseover', function() {
      var now = Date.now();
      if (now - lastRefresh > 5000) { // 至少间隔 5 秒
        lastRefresh = now;
        doRefresh();
      }
    });
    window.addEventListener('focus', function() {
      var now = Date.now();
      if (now - lastRefresh > 5000) {
        lastRefresh = now;
        doRefresh();
      }
    });
  }

  // SupabaseReady 后启动定时刷新
  if (window.SupabaseReady) {
    window.SupabaseReady.then(function() { startCloudRefresh(); }).catch(function() {});
  } else {
    startCloudRefresh();
  }

  // 暴露手动刷新接口到全局
  global.CloudRefresh = {
    manualRefresh: function() {
      if (!window.SupabaseStore || !window.SupabaseStore._isInitialized()) {
        console.warn('[CloudRefresh] 存储未初始化');
        return;
      }
      console.log('[CloudRefresh] 手动强制刷新中...');
      // 使用 forceRefreshFromCloud 绕过所有对比逻辑
      var fn = window.SupabaseStore.forceRefreshFromCloud || window.SupabaseStore.refreshFromCloud;
      fn.call(window.SupabaseStore)
        .then(function(changed) {
          var msg = changed && changed.length > 0
            ? '刷新完成，' + changed.length + ' 个数据已更新'
            : '刷新完成，暂无新数据';
          if (window.App && window.App.toast) {
            window.App.toast(msg, changed && changed.length > 0 ? 'success' : 'info');
          } else {
            console.log('[CloudRefresh]', msg);
          }
        })
        .catch(function(e) {
          if (window.App && window.App.toast) {
            window.App.toast('刷新失败: ' + (e && e.message ? e.message : e), 'error');
          }
        });
    }
  };

  // 自动注入刷新按钮到 header-actions
  function injectRefreshButton() {
    var headers = document.querySelectorAll('.header-actions');
    headers.forEach(function(header) {
      if (header.querySelector('[data-cloud-refresh]')) return; // 已注入
      var btn = document.createElement('button');
      btn.className = 'btn btn-sm';
      btn.setAttribute('data-cloud-refresh', '1');
      btn.setAttribute('title', '刷新云端数据');
      btn.style.cursor = 'pointer';
      btn.textContent = '🔄';
      btn.onclick = function() { global.CloudRefresh.manualRefresh(); };
      header.appendChild(btn);
    });
  }

  // DOM ready 后注入
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', injectRefreshButton);
  } else {
    injectRefreshButton();
  }

  // ===== 独立云数据轮询（Safari 兼容兜底）=====
  // 当所有其他机制（Web Worker、SupabaseStore、UMD）都失败时，
  // 此机制直接通过 fetch + URL 参数方式同步数据，不依赖任何中间层
  // 解决 Safari 从 file:// 加载时的 ES Module 阻塞、CDN 跨域、CORS 预检等问题
  
  var INDEPENDENT_REST_URL = 'https://ugoyacuagslqhqguxyqe.supabase.co/rest/v1/app_data_store';
  var INDEPENDENT_API_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnb3lhY3VhZ3NscWhxZ3V4eXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MzI5NTUsImV4cCI6MjEwMjUwODk1NX0._GdWOGWblSpOYm3y8f_d3aVQszfn2YbRjHN0FqZiLtI';
  var _independentLastHashes = null; // null 表示首次运行（还没建基线）
  var _independentRunning = false;

  function independentPoll() {
    if (_independentRunning) return;
    _independentRunning = true;

    var isFirstRun = (_independentLastHashes === null);
    var url = INDEPENDENT_REST_URL + '?select=store_key,payload,updated_at&apikey=' + encodeURIComponent(INDEPENDENT_API_KEY);

    // 关键修复：带上当前登录用户的 JWT，否则 RLS 会把 app_data_store 过滤成空表
    // （绝大多数表级策略写的是 auth.uid() = user_id 或 owner_id，匿名 apikey 查不到任何行）
    var headers = {};
    var userToken = null;
    try { userToken = getUserAccessToken(); } catch(_e) {}
    if (userToken) headers['Authorization'] = 'Bearer ' + userToken;

    fetch(url, {
      // Authorization 自定义头会触发 CORS 预检，但 Supabase REST/Storage 端点默认对预检放行
      // （Safari file:// 下万一预检失败，catch 分支会打印诊断，不会卡死轮询）
      cache: 'no-store',
      headers: headers
    })
    .then(function(resp) {
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      return resp.json();
    })
    .then(function(rows) {
      if (!Array.isArray(rows)) {
        console.warn('[init-page] 独立轮询：返回数据不是数组');
        return;
      }

      var changedKeys = [];
      var newHashes = {};
      var prevHashes = _independentLastHashes || {};
      var nowMs = Date.now();
      // 保护期：10秒内本地刚写入的 key 不被云端数据覆盖（防止删除后被旧数据复活）
      var RECENT_WRITE_WINDOW = 10000;

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var key = row.store_key;
        var payload = row.payload;

        // 关键修复：检查 SupabaseStore._recentWrites，跳过本地刚写入的 key
        // 防止删除/编辑操作后，云端旧数据覆盖本地新数据
        try {
          var store = window.SupabaseStore;
          if (store && store._recentWrites) {
            var lastWrite = store._recentWrites[key] || 0;
            if (lastWrite && (nowMs - lastWrite < RECENT_WRITE_WINDOW)) {
              // 本地刚写入此 key，跳过云端覆盖，但仍记录哈希用于下次对比
              try {
                var hashSkip = JSON.stringify(payload) + '|' + (row.updated_at || '');
                newHashes[key] = hashSkip;
              } catch(_) {}
              continue;
            }
          }
        } catch(_) {}

        // 计算内容哈希用于变化检测
        var hash = '';
        try {
          hash = JSON.stringify(payload) + '|' + (row.updated_at || '');
        } catch(e) {
          hash = String(payload) + '|' + (row.updated_at || '');
        }
        newHashes[key] = hash;

        // 变化检测：首次运行时，任何非空数组/对象的 key 都触发一次更新
        // （因为页面的初始渲染可能用的是旧 localStorage 数据）
        var changed = false;
        if (prevHashes[key] !== hash) {
          changed = true;
        }
        // 首次运行且此 key 有真实数据（非空数组/非null对象）→ 视为有变化，通知UI重新加载
        if (isFirstRun && !changed) {
          try {
            if (Array.isArray(payload) && payload.length > 0) changed = true;
            else if (payload !== null && typeof payload === 'object') {
              var hasKeys = false;
              for (var pk in payload) { hasKeys = true; break; }
              if (hasKeys) changed = true;
            }
          } catch(e) {}
        }

        if (changed) {
          changedKeys.push(key);
          // 直接更新 原始 localStorage（绕过 patch，确保不会反向写回云端）
          try {
            var origLS = window._origLocalStorage || localStorage;
            origLS.setItem(key, JSON.stringify(payload));
          } catch(e) {}
          // 同时也更新 SupabaseStore._cache（使后续 getSync 读到最新）
          try {
            var store = window.SupabaseStore;
            if (store && store._getCache) {
              var cache = store._getCache();
              if (cache) {
                cache[key] = JSON.parse(JSON.stringify(payload));
                // 不更新 _cacheTimestamps，让后续 refreshFromCloud 有机会再对比
              }
            }
          } catch(e) {}
        }
      }

      // 检查已删除的 key
      var remoteKeys = {};
      for (var j = 0; j < rows.length; j++) {
        remoteKeys[rows[j].store_key] = true;
      }
      for (var localKey in prevHashes) {
        if (!remoteKeys[localKey]) {
          changedKeys.push(localKey);
          try {
            var origLS2 = window._origLocalStorage || localStorage;
            origLS2.removeItem(localKey);
          } catch(e) {}
        }
      }

      _independentLastHashes = newHashes;

      // ===== 首次拉取成功（不论是否有变更）= 打开 runAutoBackup 的安全锁 =====
      // 只有首次 REST 请求 HTTP 200 且 rows 是数组，才算"基线已建"，后续才允许本地备份上传。
      // 这样 A 电脑新写的订单不会被 B 电脑的本地旧值覆盖。
      if (isFirstRun && !_firstPollDone) {
        _firstPollDone = true;
        console.log('[init-page] 🔓 首次云端基线建立完成，自动备份解锁（当前云端行数=' + rows.length + '）');
        // 解锁后立即触发一次 runAutoBackup（否则还要等 visibilitychange 或下次 60s）
        try { setTimeout(runAutoBackup, 300); } catch(_) {}
      }

      if (changedKeys.length > 0) {
        console.log('[init-page] 🛡️ 独立轮询' + (isFirstRun ? '(首次基线+触发)' : '检测到变更') + ':', 
          changedKeys.join(', '), '(共' + changedKeys.length + '个)');
        // 触发云数据更新事件（供各页面刷新 UI）
        window.dispatchEvent(new CustomEvent('cloud-data-updated', {
          detail: { keys: changedKeys }
        }));
      } else {
        if (isFirstRun) {
          console.log('[init-page] 🛡️ 独立轮询(首次基线): 无需要更新的key(云端均为空数据或本地已是最新)');
          // 首次运行云端为空 → 可能数据正在通过独立写入通道上传中
          // 5 秒后立即再执行一次轮询（不等15秒），快速捕获刚上传完成的数据
          setTimeout(function() { independentPoll(); }, 5000);
          // 同时再安排 12 秒后的第二次"快速轮询"，覆盖写入较慢的情况
          setTimeout(function() { independentPoll(); }, 12000);
        }
      }
    })
    .catch(function(err) {
      if (Date.now() % 30000 < 15000) { // 每30秒只打印一次错误
        console.warn('[init-page] 独立轮询失败:', err && err.message ? err.message : err);
      }
    })
    .then(function() {
      _independentRunning = false;
      // 下次轮询：15秒后
      setTimeout(independentPoll, 15000);
    });
  }

  // 关键：尽早启动独立轮询（不要与 SupabaseStore 初始化竞争）
  // 对于 Safari/file:// 场景，这通常是数据进入页面的唯一通道
  setTimeout(function() {
    console.log('[init-page] 🛡️ 启动独立云端轮询（Safari 兼容模式）');
    independentPoll();
  }, 800);

  // 页面回到前台时强制立即执行一次独立轮询（绕过所有缓存和节流）
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      setTimeout(independentPoll, 200);
    }
  });
  window.addEventListener('pageshow', function() {
    setTimeout(independentPoll, 200);
  });

  // ===== 独立写入通道（绝对兜底，保证数据一定上传到云端）=====
  // 接收 localstorage-patch.js 发出的 cloud-write-request 事件
  // 通过 REST API 直接 upsert 到 Supabase，不依赖任何中间层
  // 即使 SupabaseStore、setSync、UMD、ES Module 全部失败也能工作
  var WRITE_URL = 'https://ugoyacuagslqhqguxyqe.supabase.co/rest/v1/app_data_store';
  var WRITE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVnb3lhY3VhZ3NscWhxZ3V4eXFlIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY5MzI5NTUsImV4cCI6MjEwMjUwODk1NX0._GdWOGWblSpOYm3y8f_d3aVQszfn2YbRjHN0FqZiLtI';
  var WRITE_AUTH_KEY_NAME = 'sb-ugoyacuagslqhqguxyqe-auth-token'; // Supabase 默认的存储 key
  var _writeQueue = [];    // 待写入队列（key + value + ts）
  var _writeRunning = false;
  var _writeLastTs = {};   // 每个 key 的最后上传时间戳（用于去抖），避免频繁上传
  var _writeLastHash = {}; // 每个 key 的最后上传内容 hash（严格去重，相同内容直接跳过）

  // 计算内容的快速 hash（用于判断是否真的变化了需要上传）
  function hashValue(val) {
    try {
      var s = (val === null || val === undefined) ? '' : JSON.stringify(val);
      // DJB2 简单 hash，32 位整数
      var h = 5381;
      for (var i = 0; i < s.length; i++) {
        h = ((h << 5) + h) + s.charCodeAt(i);
        h |= 0;
      }
      return s.length.toString(36) + '_' + h.toString(36);
    } catch(e) {
      return 'x_' + Date.now();
    }
  }

  // 获取当前登录用户的 access_token（从 Supabase Auth 本地存储）
  // 写入必须带这个 token（RLS 允许登录用户写，不允许匿名写）
  function getUserAccessToken() {
    try {
      var raw = localStorage.getItem(WRITE_AUTH_KEY_NAME);
      // 注意：必须从 _origLocalStorage 读（绕过我们的 patch），否则会无限递归
      if (!raw) {
        try {
          if (window._origLocalStorage) {
            raw = window._origLocalStorage.getItem(WRITE_AUTH_KEY_NAME);
          } else if (window.sessionStorage) {
            raw = sessionStorage.getItem(WRITE_AUTH_KEY_NAME);
          }
        } catch(e) {}
      }
      if (!raw) return null;
      var parsed = JSON.parse(raw);
      if (parsed && parsed.access_token) {
        return parsed.access_token;
      }
    } catch(e) {}
    return null;
  }

  // 处理一个写入请求
  function executeWrite(req) {
    var userToken = getUserAccessToken();
    var body = JSON.stringify({
      store_key: req.key,
      payload: req.value,
      updated_at: new Date().toISOString()
    });

    // ===== 方案 A：使用 Authorization Bearer 用户 token + apikey 头 =====
    // 这是标准方式，也是能通过 RLS 写入策略的唯一方式（匿名没有写权限）
    function tryStandard() {
      var headers = {
        'Content-Type': 'application/json',
        'apikey': WRITE_ANON_KEY,
        'Prefer': 'return=minimal, resolution=merge-duplicates'
      };
      if (userToken) {
        headers['Authorization'] = 'Bearer ' + userToken;
      }
      var url = WRITE_URL + '?on_conflict=store_key';
      return fetch(url, {
        method: 'POST',
        cache: 'no-store',
        headers: headers,
        body: body
      }).then(function(resp) {
        if (!resp.ok) {
          return { ok: false, status: resp.status, resp: resp };
        }
        return { ok: true };
      });
    }

    // ===== 方案 B：Safari file:// CORS 预检失败兜底 =====
    // 如果方案 A 失败是因为 CORS/network 问题（status=0 或 fetch 抛出 CORS error），
    // 尝试使用 "简单请求"（simple request）——避免 OPTIONS 预检：
    // Content-Type 改为 application/x-www-form-urlencoded（允许简单请求列表中的类型之一）
    // 但是 body 必须转成 URL-encoded 形式，而且 Supabase 不接收 URL-encoded body 作为 JSON payload
    // 所以这个方案不行。真正的兜底是让 SupabaseStore 正常工作。
    // 如果方案 A 返回 401，那是 RLS 策略问题，不能通过 "简单请求" 绕过。
    // 这里只打印更明确的错误信息给用户排查。

    return tryStandard().then(function(r) {
      if (r.ok) return true;

      // 方案 A 失败，给出明确诊断
      var msg = '';
      switch(r.status) {
        case 401:
          msg = '401 未授权(R LS拒绝写入) → 用户JWT无效或已登出. 当前userToken=' + (userToken ? '有('+ userToken.slice(0,20)+'...)' : '无');
          break;
        case 403:
          msg = '403 禁止(RLS policy 拒绝)';
          break;
        case 409:
          msg = '409 on_conflict 参数冲突（检查列名）';
          break;
        case 400:
          msg = '400 请求格式错误（JSON 或参数）';
          break;
        default:
          msg = 'HTTP ' + r.status;
      }
      throw new Error(msg);
    });
  }

  // 处理一个删除请求（URL 参数 delete）—— DELETE 也必须带用户 JWT
  function executeDelete(key) {
    var userToken = getUserAccessToken();
    var url = WRITE_URL + '?store_key=eq.' + encodeURIComponent(key);
    var headers = {
      'apikey': WRITE_ANON_KEY
    };
    if (userToken) {
      headers['Authorization'] = 'Bearer ' + userToken;
    }
    return fetch(url, {
      method: 'DELETE',
      cache: 'no-store',
      headers: headers
    }).then(function(resp) {
      if (!resp.ok) throw new Error('DELETE HTTP ' + resp.status + (resp.status === 401 ? ' (需要用户JWT)' : ''));
      return true;
    });
  }

  // 队列处理器（串行，避免并发上传）
  function flushWriteQueue() {
    if (_writeRunning || _writeQueue.length === 0) return;
    _writeRunning = true;

    var req = _writeQueue.shift();
    var p;
    if (req.type === 'delete') {
      p = executeDelete(req.key);
    } else {
      p = executeWrite(req);
    }
    p.then(function(ok) {
      var count = Array.isArray(req.value) ? req.value.length + ' 条' : typeof req.value;
      // 精简日志：数组长度为 0 的不打印（防止刷新时刷屏）
      if (!(Array.isArray(req.value) && req.value.length === 0)) {
        console.log('[init-page] ✨ 独立写入成功:', req.key, count);
      }
      // 上传成功后，更新 SupabaseStore._cache（如果存在）
      try {
        var st = window.SupabaseStore;
        if (st && st._getCache && req.type !== 'delete') {
          var cache = st._getCache();
          cache[req.key] = JSON.parse(JSON.stringify(req.value));
        }
      } catch(e) {}
      // ===== 关键修复 1：成功后把本次内容 hash 记录下来 =====
      // 下次同样内容再来 cloud-write-request 时，会被去重拦截，不入队
      if (req.hash) {
        _writeLastHash[req.key] = req.hash;
      } else if (req.type !== 'delete') {
        _writeLastHash[req.key] = hashValue(req.value);
      }
      // ===== 关键修复 2：绝对不要在这里广播 cloud-data-updated！ =====
    }).catch(function(err) {
      console.warn('[init-page] ✨ 独立写入失败，重新入队:', req.key, err && err.message ? err.message : err);
      // 失败则放回队列尾部（最多保留 50 条去重）
      if (_writeQueue.length < 50) _writeQueue.push(req);
    }).then(function() {
      _writeRunning = false;
      if (_writeQueue.length > 0) {
        setTimeout(flushWriteQueue, 200);
      }
    });
  }

  // 判断当前登录用户是否管理员（用于 ADMIN_ONLY_WRITE_KEYS 的写入守卫）
  // 注意：此处只做最保守的判断：role = 'admin' 直接放行；其它角色一律视为非管理员。
  // 这样不会影响普通业务键的上传，只用于保护全局共享的 NAS 配置类键不被误覆盖。
  function _currentUserIsAdmin() {
    try {
      var ls = window._origLocalStorage || window.localStorage;
      var roleKey = ls ? (ls.getItem('userRole') || '') : '';
      if (!roleKey) roleKey = (window.localStorage.getItem && window.localStorage.getItem('userRole')) || '';
      if (roleKey === 'admin') return true;
      // 兜底：isLoggedIn 用户信息里如果有 isAdmin=true
      var info = null;
      try { info = ls.getItem('currentUserInfo'); } catch(_) {}
      if (info) { try { var p = JSON.parse(info); if (p && p.isAdmin) return true; } catch(_) {} }
    } catch(_) {}
    return false;
  }

  // 监听写入事件（来自 localStorage-patch）
  window.addEventListener('cloud-write-request', function(e) {
    var key = e.detail.key;
    var value = e.detail.value;
    var ts = e.detail.ts || Date.now();

    // ==== 全局共享键（NAS 配置/权限）仅管理员可写 ====
    // 非管理员上传这些键会静默丢弃，避免覆盖管理员发布的全局设置。
    var ADMIN_KEYS = (typeof window.ADMIN_ONLY_WRITE_KEYS !== 'undefined')
      ? window.ADMIN_ONLY_WRITE_KEYS
      : ['nas_config', 'nas_folder_perms'];
    if (ADMIN_KEYS.indexOf(key) >= 0) {
      if (!_currentUserIsAdmin()) {
        console.warn('[init-page] 🛡️ 非管理员尝试上传全局共享键 ' + key + ' → 已跳过（请由管理员统一修改）。');
        return;
      }
    }

    // ==== 第一层去重：严格内容 hash 比对 ====
    // 如果新内容和最近一次成功上传的内容 hash 一样 → 直接跳过（根本不需要入队）
    var newHash = hashValue(value);
    if (_writeLastHash[key] && _writeLastHash[key] === newHash) {
      // 绝对相同内容，跳过不打日志
      return;
    }

    // ==== 第二层去抖：1.5 秒内同 key 多次写入只保留最后一次 ====
    if (_writeLastTs[key] && ts - _writeLastTs[key] < 1500) {
      for (var i = _writeQueue.length - 1; i >= 0; i--) {
        if (_writeQueue[i].type !== 'delete' && _writeQueue[i].key === key) {
          _writeQueue.splice(i, 1);
        }
      }
    }
    _writeLastTs[key] = ts;
    // 把 hash 存到请求对象里，成功后再更新 _writeLastHash
    _writeQueue.push({ type: 'write', key: key, value: value, ts: ts, hash: newHash });

    // 日志精简（非数组空数据场景省略，防止刷屏）
    var isEmptyArr = Array.isArray(value) && value.length === 0;
    if (!isEmptyArr) {
      console.log('[init-page] ✨ 独立写入入队:', key, 
        Array.isArray(value) ? ('[' + value.length + ' 条]') : '',
        '| 队列长度=' + _writeQueue.length);
    }

    // 立即启动处理器
    setTimeout(flushWriteQueue, 100);
  });

  // 监听删除事件
  window.addEventListener('cloud-delete-request', function(e) {
    var key = e.detail.key;
    _writeQueue.push({ type: 'delete', key: key, ts: Date.now() });
    console.log('[init-page] ✨ 独立删除入队:', key);
    setTimeout(flushWriteQueue, 100);
  });

  // 启动后：把当前所有 SUPERSET_KEYS 的本地数据一次性"检查并上传"
  // 用于在 Supabase 表为空（前一版 Bug 清空）时把 localStorage 中的已有数据补到云端
  var _lastBackupTs = 0;
  var _firstPollDone = false;   // 首次 independentPoll 拉云端成功后，才允许 runAutoBackup 上传，避免用本机旧值覆盖云端新值
  function runAutoBackup() {
    // 60 秒冷却，避免频繁切前台重复触发
    if (Date.now() - _lastBackupTs < 60000) return;
    // 关键安全锁：必须先跑通一次 independentPoll（把云端最新值拉下来），才允许本地"备份"上传。
    // 如果这个锁没开，直接返回；doRefresh 的首次成功会自动再调用本函数一次。
    if (!_firstPollDone) {
      console.log('[init-page] ⏳ 自动备份延迟执行：尚未完成首次云端拉取，避免用旧值覆盖云端。首次拉取成功后会自动触发。');
      return;
    }
    _lastBackupTs = Date.now();

    var ALL_KEYS = [
      'styles', 'orders', 'fabrics', 'accessories', 'samples',
      'feedbacks', 'productions', 'invoices', 'payments', 'collections',
      'consumptions', 'consumption_categories',
      'contacts', 'customers', 'suppliers', 'favoriteContacts',
      'washes', 'shippings', 'users', 'permissions',
      'maintFabrics', 'maintAccessories',
      'express_delivery_data_v2',
      'pl_records_v1', 'pl_draft_v1',
      'sht_sample_data_v2', 'sht_size_tables_v2',
      'sizeSheets', 'styleImages',
      // NAS 云盘：全局共享配置和文件夹权限（按用户筛选，非管理员上传会被守卫跳过）
      'nas_config', 'nas_folder_perms',
    ];
    var origLS = window._origLocalStorage || window.localStorage;
    var needBackup = 0;
    ALL_KEYS.forEach(function(k) {
      try {
        var raw = origLS.getItem(k);
        if (raw && raw !== '[]' && raw !== 'null') {
          window.dispatchEvent(new CustomEvent('cloud-write-request', {
            detail: { key: k, value: JSON.parse(raw), ts: Date.now() }
          }));
          needBackup++;
        }
      } catch(e) {}
    });
    if (needBackup > 0) {
      console.log('[init-page] 🔎 自动备份：检测到', needBackup, '个本地数据集有内容，已加入独立上传队列');
    } else {
      console.log('[init-page] 🔎 自动备份：本地无待补的数据集');
    }
  }
  setTimeout(runAutoBackup, 10000);

  // 页面切回前台时强制立即执行一次独立轮询 + 自动备份（带冷却）
  // 典型场景：
  //   - 在 Windows 编辑了其他模块（寄样/订单/通讯录...），切到 Mac Safari 前台立即拉取
  //   - 在 Mac 编辑了数据，切回 Windows 前台时发现仍有漏网的本地数据 → 立即补上传
  document.addEventListener('visibilitychange', function() {
    if (!document.hidden) {
      setTimeout(independentPoll, 200);
      setTimeout(runAutoBackup, 500);
    }
  });
  window.addEventListener('pageshow', function() {
    setTimeout(independentPoll, 200);
    setTimeout(runAutoBackup, 500);
  });

})(window);
