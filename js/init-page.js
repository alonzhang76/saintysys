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
      if (window.SupabaseStore && window.SupabaseStore._isInitialized()) {
        console.log('[init-page] 🔄 触发云端刷新...');
        // 使用 forceRefreshFromCloud 确保 Safari 等浏览器也能正确同步
        var fn = window.SupabaseStore.forceRefreshFromCloud || window.SupabaseStore.refreshFromCloud;
        fn.call(window.SupabaseStore)
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
      } else {
        console.log('[init-page] ⏭️ 跳过刷新：存储未就绪', !!window.SupabaseStore);
      }
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

})(window);
