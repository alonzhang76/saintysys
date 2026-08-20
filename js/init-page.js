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
      // 如果已经初始化，直接执行
      runInit(fn);
    } else {
      // 加入队列，等待 Supabase 就绪后执行
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
      // 没有 Supabase，直接执行
      tryRunAll();
    }
  }

  // 如果 DOM 已就绪，立即开始等待
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', waitAndRun);
  } else {
    waitAndRun();
  }

  // 超时兜底：15 秒后强制执行初始化（防止 SupabaseReady 永远不 resolve）
  setTimeout(function() {
    if (!initialized) {
      console.warn('[init-page] 超时（15s），强制执行初始化');
      tryRunAll();
    }
  }, 15000);

  // ===== 15 秒定时刷新云端数据 =====
  var _cloudRefreshTimer = null;
  function startCloudRefresh() {
    if (_cloudRefreshTimer) return;
    _cloudRefreshTimer = setInterval(function() {
      if (window.SupabaseStore && window.SupabaseStore._isInitialized()) {
        window.SupabaseStore.refreshFromCloud().catch(function(e) {});
      }
    }, 15000); // 15 秒
    // 页面隐藏时暂停，可见时立即刷新
    document.addEventListener('visibilitychange', function() {
      if (!document.hidden && window.SupabaseStore && window.SupabaseStore._isInitialized()) {
        window.SupabaseStore.refreshFromCloud().catch(function(e) {});
      }
    });
  }

  // SupabaseReady 后启动定时刷新
  if (window.SupabaseReady) {
    window.SupabaseReady.then(function() { startCloudRefresh(); }).catch(function() {});
  } else {
    startCloudRefresh();
  }

})(window);
