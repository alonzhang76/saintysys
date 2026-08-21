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
        fetch(FALLBACK_URL + '?select=store_key,payload,updated_at&apikey=' + encodeURIComponent(FALLBACK_KEY), {cache: 'no-store'})
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
  var _independentLastHashes = {}; // 每个 key 的内容哈希，用于检测变化
  var _independentRunning = false;

  function independentPoll() {
    if (_independentRunning) return;
    _independentRunning = true;

    var url = INDEPENDENT_REST_URL + '?select=store_key,payload,updated_at&apikey=' + encodeURIComponent(INDEPENDENT_API_KEY);
    
    fetch(url, {
      // 不使用自定义头（避免 CORS 预检请求被 Safari file:// 阻止）
      // API key 通过 URL 查询参数传递
      cache: 'no-store'
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

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i];
        var key = row.store_key;
        var payload = row.payload;
        
        // 计算内容哈希用于变化检测
        var hash = '';
        try {
          hash = JSON.stringify(payload) + '|' + (row.updated_at || '');
        } catch(e) {
          hash = String(payload) + '|' + (row.updated_at || '');
        }
        newHashes[key] = hash;

        // 检测是否变化
        if (_independentLastHashes[key] !== hash) {
          changedKeys.push(key);
          
          // 直接更新 localStorage（使用原始方法，绕过 patch）
          try {
            var origLS = window._origLocalStorage || localStorage;
            origLS.setItem(key, JSON.stringify(payload));
          } catch(e) {
            // localStorage 可能已满或其他问题
          }
        }
      }

      // 检查已删除的 key
      var remoteKeys = {};
      for (var j = 0; j < rows.length; j++) {
        remoteKeys[rows[j].store_key] = true;
      }
      for (var localKey in _independentLastHashes) {
        if (!remoteKeys[localKey]) {
          changedKeys.push(localKey);
          try {
            var origLS2 = window._origLocalStorage || localStorage;
            origLS2.removeItem(localKey);
          } catch(e) {}
        }
      }

      _independentLastHashes = newHashes;

      if (changedKeys.length > 0) {
        console.log('[init-page] 独立轮询检测到变更:', changedKeys.join(', '));
        // 触发云数据更新事件（供各页面刷新 UI）
        window.dispatchEvent(new CustomEvent('cloud-data-updated', {
          detail: { keys: changedKeys }
        }));
        // 同时触发独立事件（供调试）
        window.dispatchEvent(new CustomEvent('direct-cloud-sync', {
          detail: { keys: changedKeys, count: rows.length }
        }));
      }
    })
    .catch(function(err) {
      // 静默失败（可能是网络问题或 Safari file:// 限制）
      // 但仍然重试
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

  // 启动独立轮询（延迟5秒开始，避免与初始化竞争）
  setTimeout(function() {
    console.log('[init-page] 🛡️ 启动独立云端轮询（Safari 兼容模式）');
    independentPoll();
  }, 5000);

  // 立即执行一次（在启动后3秒）
  setTimeout(function() {
    independentPoll();
  }, 3000);

})(window);
