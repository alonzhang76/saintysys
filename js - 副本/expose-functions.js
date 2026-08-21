/* ===== 全局函数暴露工具 =====
 *
 * 解决 inline 脚本因包装在 .then() 回调中导致 onclick 找不到函数的问题
 * 在每个页面的 <script> 开头引用此文件
 * 然后在 .then() 回调开头调用 window._exposeFunctions(this)
 * 回调内所有 function 声明会被自动暴露到 window
 *
 * 使用方法：
 *   <script src="js/expose-functions.js"></script>
 *   <script>
 *   (window.SupabaseReady || Promise.resolve()).then(function() {
 *     window._exposeFunctions(this);  // 暴露本回调内所有函数到 window
 *     // ... 原有代码不变
 *   });
 *   </script>
 */

(function() {
  // 在脚本执行前保存一个全局引用
  // 当页面脚本调用 window._exposeFunctions(this) 时
  // 我们遍历 this（即回调的局部作用域）中的所有函数
  // 并将它们赋值到 window
  window._exposeFunctions = function(scope) {
    if (!scope) return;
    var excluded = ['arguments', 'require', 'import', 'export'];
    var names = Object.getOwnPropertyNames(scope);
    for (var i = 0; i < names.length; i++) {
      var name = names[i];
      if (excluded.indexOf(name) >= 0) continue;
      try {
        var val = scope[name];
        if (typeof val === 'function') {
          window[name] = val;
        }
      } catch (e) {
        // 某些属性可能无法访问
      }
    }
  };
})();
