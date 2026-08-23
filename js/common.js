/* ===== AA服装外贸系统 - 共享JS ===== */

/* ===== Supabase 会话读取（同步，从 localStorage 读取，不伪造登录态）=====
 * Supabase v2 客户端默认把会话写入 localStorage，键名形如 sb-<ref>-auth-token
 * 真正的会话有效性校验由 js/auth-guard.js 调用 supabase.auth.getUser() 完成
 * 这里仅做"是否存在会话令牌"的同步判断，供 App.checkLogin 同步使用
 * 注意：不保存任何密码到 localStorage
 */
function _readSupabaseSessionSync() {
  try {
    var keys = Object.keys(localStorage);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k && k.indexOf('sb-') === 0 && k.indexOf('-auth-token') >= 0) {
        var raw = localStorage.getItem(k);
        if (!raw) continue;
        try {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.user) return parsed;
        } catch (e) { /* 忽略解析失败 */ }
      }
    }
  } catch (e) {}
  return null;
}

// 清理所有 Supabase 会话存储 + 旧本地登录态
function _clearAllAuthState() {
  try {
    var keys = Object.keys(localStorage);
    keys.forEach(function (k) {
      if (k && k.indexOf('sb-') === 0 && k.indexOf('-auth-token') >= 0) {
        localStorage.removeItem(k);
      }
    });
  } catch (e) {}
  try {
    ['isLoggedIn', 'currentUserId', 'username', 'userRole', 'refDPR'].forEach(function (k) {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
  } catch (e) {}
  // 防残留：清除当前用户缓存，防止内存中还保留旧用户对象
  try {
    if (window.App) window.App._currentUser = null;
  } catch(_) {}
  window.currentSupabaseUser = null;
}

// 把 Supabase user 映射为系统原有用户结构（保持 App.* 方法兼容）
function _mapSupabaseUser(user) {
  if (!user) return null;
  var email = user.email || '';
  var meta = user.user_metadata || {};
  var role = meta.role || 'user';
  var adminEmails = window.ADMIN_EMAILS || [];
  if (adminEmails.indexOf(email) >= 0) {
    role = 'admin';
  }
  // 关键修复：从本地 users 列表按邮箱匹配角色（不区分大小写）
  // 设置页面的用户列表（users key）是管理员配置的权威角色来源，
  // 优先于 Supabase user_metadata.role 和 SQL user_roles 表
  // 重要：不依赖 window.App，直接用 _origLocalStorage.getItem 读原始数据（绕过 patch 和 SupabaseStore）
  if (adminEmails.indexOf(email) < 0) {
    try {
      // 使用 _origLocalStorage 直接读原始 localStorage，完全绕过 patch/SupabaseStore
      var usersRaw = null;
      if (window._origLocalStorage && typeof window._origLocalStorage.getItem === 'function') {
        usersRaw = window._origLocalStorage.getItem('users');
      } else {
        // 兜底：直接用 localStorage（可能被 patch 覆盖）
        usersRaw = localStorage.getItem('users');
      }
      var localUsers = [];
      if (usersRaw) {
        try { localUsers = JSON.parse(usersRaw); } catch(_) {}
      }
      var emailLower = (email || '').toLowerCase().trim();
      if (emailLower && localUsers && localUsers.length > 0) {
        var localUser = null;
        for (var i = 0; i < localUsers.length; i++) {
          var u = localUsers[i];
          if (u && u.email && u.email.toLowerCase().trim() === emailLower) {
            localUser = u;
            break;
          }
        }
        if (localUser && localUser.role) {
          role = localUser.role;
          console.log('[common] 本地用户匹配成功: username=' + localUser.username + ', email=' + localUser.email + ', role=' + role);
        } else {
          console.log('[common] 本地用户未匹配: email=' + emailLower + ', 本地用户数=' + localUsers.length + ', 匹配结果=' + (localUser ? '找到但无role(role=' + localUser.role + ')' : '未找到'));
        }
      } else {
        console.log('[common] 本地用户列表为空或邮箱为空: email=' + emailLower + ', users长度=' + (localUsers ? localUsers.length : 0));
      }
    } catch(e) {
      console.warn('[common] 读取本地 users 失败:', e);
    }
  } else {
    console.log('[common] _mapSupabaseUser: admin邮箱，role=admin');
  }
  return {
    id: user.id,
    username: meta.username || (email ? email.split('@')[0] : '用户'),
    email: email,
    role: role,
    description: meta.description || '',
    status: 'active',
    createDate: user.created_at ? String(user.created_at).slice(0, 10) : ''
  };
}

/* ===== 浏览器缩放归一化 ===== */
/* 解决Chrome/Edge为不同URL记住不同缩放级别导致页面大小不一致的问题 */
/* 原理：以首次使用时的devicePixelRatio为基准，若当前DPR与基准差异过大（>35%），
   判定为"跨机器/跨屏幕",直接丢弃旧基准并重新采集；仅在合理区间(±5%~±35%)内才应用CSS zoom校正 */
(function() {
  var htmlEl = document.documentElement;
  var currentDPR = window.devicePixelRatio;

  function writeRefDPR(val) {
    try { localStorage.setItem('refDPR', String(val)); } catch(e) {}
  }
  function readRefDPR() {
    try {
      var v = parseFloat(localStorage.getItem('refDPR'));
      return isFinite(v) && v > 0 ? v : 0;
    } catch(e) { return 0; }
  }
  function clearZoom() {
    try { htmlEl.style.zoom = ''; htmlEl.style.transform = ''; } catch(e) {}
  }

  // 全局重置方法(快捷键/设置页调用)
  window.ResetDprBaseline = function() {
    clearZoom();
    writeRefDPR(currentDPR);
    try { App.toast && App.toast('已重置缩放基线(DPR=' + currentDPR + ')', 'success', 2200); } catch(e) {}
  };

  // ===== 快捷键 Ctrl/Cmd + Shift + 0 =====
  document.addEventListener('keydown', function(e) {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === '0' || e.code === 'Digit0')) {
      e.preventDefault();
      window.ResetDprBaseline();
    }
  }, true);

  // ===== 读取基线并决定是否应用 zoom =====
  if (!currentDPR || !isFinite(currentDPR) || currentDPR <= 0) {
    clearZoom();
    return;
  }

  var refDPR = readRefDPR();
  if (!refDPR) {
    writeRefDPR(currentDPR);
    clearZoom();
    return;
  }

  var zoomRatio = currentDPR / refDPR;
  var diff = Math.abs(zoomRatio - 1);

  // 极端差值 > 35%：判定为"跨设备/跨屏幕配置"(如从视网膜 Mac 切到 Windows、
  // 或开启过 DevTools 设备模拟伪造 DPR)，直接丢弃旧基线，不再强行校正缩放。
  if (diff > 0.35) {
    console.warn('[DPR-Normalize] refDPR=' + refDPR + ', currentDPR=' + currentDPR +
      ', 差异=' + Math.round(diff * 100) + '% > 35% → 判定为跨设备, 丢弃旧基线 (Ctrl+Shift+0 可手动重置)');
    clearZoom();
    writeRefDPR(currentDPR);   // 用当前机器的真实 DPR 重新建立基线
    return;
  }

  // 合理范围(5%~35%)：应用 CSS zoom 反向校正浏览器的站点记忆缩放
  if (diff > 0.05) {
    var z = 1 / zoomRatio;
    // 再次夹紧最终 zoom 到 0.7 ~ 1.43,防止任何边界异常导致页面不可读
    if (z < 0.7) { z = 0.7; }
    if (z > 1.43) { z = 1.43; }
    htmlEl.style.zoom = z.toString();
    console.log('[DPR-Normalize] refDPR=' + refDPR + ', currentDPR=' + currentDPR +
      ', zoom=' + Math.round(z * 100) + '% (Ctrl+Shift+0 重置)');
  } else {
    clearZoom();
  }
})();

// ===== 管理员邮箱配置 =====
// 这些邮箱登录后拥有系统全部权限（包括修改角色权限）
const ADMIN_EMAILS = ['alonzhang76@outlook.com'];
window.ADMIN_EMAILS = ADMIN_EMAILS;

const App = {
  // ===== 菜单配置 =====
  menuItems: [
    { group: '核心业务' },
    { key: 'index', text: '首页', icon: '🏠', url: 'index.html' },
    { key: 'order', text: '订单管理', icon: '📋', url: 'order.html' },
    { group: '物料管理' },
    { key: 'fabric', text: '面里衬采购', icon: '🧵', url: 'fabric.html' },
    { key: 'accessory', text: '辅料采购', icon: '🔩', url: 'accessory.html' },
    { group: '样衣与技术' },
    { key: 'wash', text: '水洗管理', icon: '🌊', url: 'wash.html' },
    { key: 'sample', text: '样衣管理', icon: '✂️', url: 'sample.html' },
    { key: 'consumption', text: '用料及纸板', icon: '📐', url: 'consumption.html' },
    { group: '生产与财务' },
    { key: 'qcField', text: '外勤QC', icon: '🔍', url: 'qc-field.html' },
    { key: 'production', text: '生产管理', icon: '🏭', url: 'production.html' },
    { key: 'shipping', text: '出运管理', icon: '🚢', url: 'shipping.html' },
    { key: 'express', text: '寄件管理', icon: '📦', url: 'express.html' },
    { key: 'finance', text: '财务管理', icon: '💰', url: 'finance.html' },
    { group: '数据存储' },
    { key: 'nasDrive', text: '云盘 NAS', icon: '☁️', url: 'nas.html' },
    { group: '基础数据' },
    { key: 'contacts', text: '通讯录', icon: '📞', url: 'contacts.html' },
    { key: 'maintenance', text: '维护资料', icon: '📚', url: 'maintenance.html' },
    { key: 'settings', text: '设置', icon: '⚙️', url: 'settings.html' },
  ],

  // ===== 初始化布局 =====
  init(currentPage) {
    this.injectSidebar(currentPage);
    this.injectToast();
    this.bindSidebarToggle();
    this.loadUserInfo();
    // 关键修复：users 列表从云端同步后刷新顶栏用户名
    // 因为 init 时 SupabaseStore 可能还没同步，loadUserInfo 读不到本地 users 列表的显示名
    window.addEventListener('cloud-data-updated', function(e) {
      const keys = (e && e.detail && e.detail.keys) || [];
      if (keys.indexOf('users') >= 0) {
        try { if (window.App) App.loadUserInfo(); } catch(_) {}
      }
    });
    // auth-guard 异步守卫角色确定后也刷新一次（角色更新可能伴随显示名更新）
    window.addEventListener('auth-role-updated', function() {
      try { if (window.App) App.loadUserInfo(); } catch(_) {}
    });
    // 额外设置一个2秒/5秒兜底刷新（防止 cloud-data-updated 因各种原因未触发）
    setTimeout(function(){ try { if (window.App) App.loadUserInfo(); } catch(_){} }, 2000);
    setTimeout(function(){ try { if (window.App) App.loadUserInfo(); } catch(_){} }, 5000);
  },

  // 注入侧边栏（根据当前用户权限过滤"不显示"的模块）
  injectSidebar(currentPage) {
    this._currentPageKey = currentPage; // 保存当前页key，供 auth-role-updated 事件重新注入
    let menuHtml = '<div class="sidebar-logo"><span class="logo-icon">👔</span><span class="logo-text">AA服装外贸系统</span></div>';
    menuHtml += '<div class="sidebar-menu">';

    // 按分组累积可见菜单项，若整组都被隐藏则不显示分组标题
    let currentGroupTitle = null;
    let currentGroupItems = [];

    const flushGroup = () => {
      if (currentGroupTitle && currentGroupItems.length > 0) {
        menuHtml += `<div class="sidebar-menu-group-title">${currentGroupTitle}</div>`;
        menuHtml += currentGroupItems.join('');
      }
      currentGroupTitle = null;
      currentGroupItems = [];
    };

    this.menuItems.forEach(item => {
      if (item.group) {
        flushGroup();
        currentGroupTitle = item.group;
      } else {
        // 权限为 'hidden' 的模块不在侧边栏显示
        if (this.getPermission(item.key) === 'hidden') return;
        const active = item.key === currentPage ? ' active' : '';
        currentGroupItems.push(`<a href="${item.url}" class="sidebar-menu-item${active}"><span class="menu-icon">${item.icon}</span><span class="menu-text">${item.text}</span></a>`);
      }
    });
    flushGroup();

    menuHtml += '</div>';

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.innerHTML = menuHtml;
  },

  // 注入Toast容器
  injectToast() {
    if (!document.querySelector('.toast-container')) {
      const div = document.createElement('div');
      div.className = 'toast-container';
      document.body.appendChild(div);
    }
  },

  // 侧边栏折叠
  bindSidebarToggle() {
    const toggle = document.querySelector('.header-toggle');
    if (toggle) {
      toggle.addEventListener('click', () => {
        var s = document.querySelector('.sidebar'); if (s) s.classList.toggle('collapsed');
        var m = document.querySelector('.main-area'); if (m) m.classList.toggle('expanded');
      });
    }
  },

  // 加载用户信息（Supabase 适配）
  loadUserInfo() {
    let username = '';
    let userEmail = '';
    try {
      const cu = window.currentSupabaseUser;
      const u = cu || (_readSupabaseSessionSync() || {}).user;
      if (u) {
        userEmail = u.email || '';
        username = (u.user_metadata && u.user_metadata.username) || '';
      }
      // 关键修复：优先从本地 users 列表（管理员在设置页配置的）读取显示名
      // 因为 Supabase user_metadata.username 通常为空（注册时未填），而管理员在 users 列表中填的"用户名"才是真正的显示名
      if (userEmail && window.App) {
        try {
          const localUsers = App.store.get('users', []);
          const emailLower = userEmail.toLowerCase().trim();
          const localUser = localUsers.find(x => x.email && x.email.toLowerCase().trim() === emailLower);
          if (localUser && localUser.username) {
            username = localUser.username;
          }
        } catch(e) {}
      }
      // 兜底：显示名 优先本地users匹配的 → user_metadata.username → 邮箱前缀
      if (!username) {
        username = userEmail ? userEmail.split('@')[0] : '用户';
      }
    } catch (e) {}
    const userEl = document.querySelector('.header-user .user-name');
    if (userEl) userEl.textContent = username;
  },

  // ===== 数据存储 =====
  store: {
    get(key, defaultVal = []) {
      try {
        const data = localStorage.getItem(key);
        return data ? JSON.parse(data) : defaultVal;
      } catch (e) {
        console.error('存储读取失败:', key, e);
        return defaultVal;
      }
    },
    set(key, value) {
      localStorage.setItem(key, JSON.stringify(value));
    },
    remove(key) {
      localStorage.removeItem(key);
    }
  },

  // ===== Toast 通知 =====
  toast(message, type = 'info', duration = 2500) {
    const container = document.querySelector('.toast-container');
    if (!container) return;
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    const icons = { success: '✅', error: '❌', warning: '⚠️', info: 'ℹ️' };
    toast.innerHTML = `<span>${icons[type] || 'ℹ️'}</span><span>${message}</span>`;
    container.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateX(20px)';
      toast.style.transition = 'all 0.3s';
      setTimeout(() => toast.remove(), 300);
    }, duration);
  },

  // ===== 模态框 =====
  modal: {
    open({ title, body, footer, size = '', closeOnOverlay = true }) {
      this.close();
      const overlay = document.createElement('div');
      overlay.className = 'modal-overlay show';
      overlay.id = 'app-modal';
      const sizeClass = size ? ` modal-${size}` : '';
      overlay.innerHTML = `
        <div class="modal${sizeClass}">
          <div class="modal-header">
            <span class="modal-title">${title}</span>
            <button class="modal-close" onclick="App.modal.close()">✕</button>
          </div>
          <div class="modal-body">${body}</div>
          ${footer ? `<div class="modal-footer">${footer}</div>` : ''}
        </div>
      `;
      if (closeOnOverlay) {
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) this.close();
        });
      }
      document.body.appendChild(overlay);
      return overlay;
    },
    close() {
      const existing = document.getElementById('app-modal');
      if (existing) existing.remove();
    }
  },

  // ===== 确认对话框 =====
  confirm(message, onConfirm) {
    const overlay = this.modal.open({
      title: '确认操作',
      body: `<p style="font-size:14px;">${message}</p>`,
      footer: `<button class="btn" onclick="App.modal.close()">取消</button><button class="btn btn-danger" id="confirm-ok">确定</button>`,
      size: 'sm'
    });
    document.getElementById('confirm-ok').addEventListener('click', () => {
      this.modal.close();
      onConfirm();
    });
  },

  // ===== 工具函数 =====
  utils: {
    // 生成ID
    genId(prefix = 'ID') {
      return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10000)}`;
    },

    // 格式化日期
    formatDate(date, fmt = 'YYYY-MM-DD') {
      if (!date) return '';
      const d = new Date(date);
      if (isNaN(d)) return date;
      const map = {
        YYYY: d.getFullYear(),
        MM: String(d.getMonth() + 1).padStart(2, '0'),
        DD: String(d.getDate()).padStart(2, '0'),
        HH: String(d.getHours()).padStart(2, '0'),
        mm: String(d.getMinutes()).padStart(2, '0'),
      };
      return fmt.replace(/YYYY|MM|DD|HH|mm/g, m => map[m]);
    },

    // 获取今天日期
    today() {
      return this.formatDate(new Date());
    },

    // 格式化金额
    formatMoney(num) {
      if (num === null || num === undefined || num === '') return '-';
      return Number(num).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    },

    // 转义HTML
    escapeHtml(str) {
      if (!str) return '';
      const div = document.createElement('div');
      div.textContent = str;
      return div.innerHTML;
    },

    // 获取URL参数
    getQueryParam(name) {
      const params = new URLSearchParams(window.location.search);
      return params.get(name);
    },

    // 生成款号
    genStyleNo(customer, season) {
      const seq = String(Math.floor(Math.random() * 9999) + 1).padStart(4, '0');
      return `${season}-${customer}-${seq}-V1`;
    },

    // 按日期倒序排序（getDate 返回日期字符串，空值排末尾，稳定排序）
    // 支持传入单个键或取值函数；也可传入多个键数组，取其中的最大值作为排序依据
    sortByDateDesc(arr, getDate) {
      const getVal = (item) => {
        let v;
        if (typeof getDate === 'function') {
          v = getDate(item);
        } else if (Array.isArray(getDate)) {
          v = getDate.map(k => item[k]).filter(Boolean).sort().pop() || '';
        } else {
          v = item[getDate];
        }
        return v || '';
      };
      return arr.slice().sort((a, b) => {
        const da = getVal(a);
        const db = getVal(b);
        if (!da && !db) return 0;
        if (!da) return 1;
        if (!db) return -1;
        return db.localeCompare(da);
      });
    },

    // ===== NAS 通用工具 =====
    getNasConfig() {
      const d = {
        serverUrl: '', webdavPath: '/webdav', rootFolder: '/saintydoc',
        username: '', password: '', verifySsl: true, uploadMaxMb: 500, mode: 'lan'
      };
      try {
        if (App.store && typeof App.store.get === 'function') {
          const o = App.store.get('nas_config', null);
          if (o) Object.assign(d, o || {});
        } else {
          const raw = localStorage.getItem('nas_config');
          if (raw) Object.assign(d, JSON.parse(raw) || {});
        }
      } catch(e) {}
      return d;
    },
    _normNasAbsUrlEncoded(cfg, logicPath) {
      if (!cfg || !cfg.serverUrl) return null;
      const base = (cfg.serverUrl || '').replace(/\/+$/, '');
      let wd = cfg.webdavPath || '/'; if (!wd.startsWith('/')) wd = '/' + wd;
      let root = cfg.rootFolder || '/'; if (!root.startsWith('/')) root = '/' + root;
      root = root.replace(/\/+$/g, '');
      let lp = logicPath || '/'; if (!lp.startsWith('/')) lp = '/' + lp;
      if (lp === '/') lp = '';
      const raw = (wd + root + lp).replace(/\/+/g, '/');
      const cleanRaw = raw.length > 1 && raw.charAt(raw.length - 1) === '/' ? raw.slice(0, -1) : raw;
      const enc = cleanRaw.split('/').map(encodeURIComponent).join('/');
      return base + enc;
    },
    _basicAuthHeader(cfg) {
      if (!cfg || !cfg.username) return {};
      const cred = cfg.username + ':' + (cfg.password || '');
      try { return { 'Authorization': 'Basic ' + btoa(unescape(encodeURIComponent(cred))) }; }
      catch(e) { return {}; }
    },
    /**
     * 通过 NAS WebDAV 将逻辑路径对应的文件下载为浏览器 File 对象（可直接传给 Supabase 上传）
     * @param {string} logicPath 例如 /款式图/春夏2025.jpg
     * @param {object} [customCfg] 可选，自定义 NAS 配置（不传则从 store 读取）
     * @returns {Promise<{file: File, blob: Blob, absUrlEncoded: string}>}
     */
    async nasFetchAsFile(logicPath, customCfg) {
      const cfg = customCfg || this.getNasConfig();
      if (!cfg.serverUrl) throw new Error('NAS 尚未配置，请到设置页填写');
      const absUrl = this._normNasAbsUrlEncoded(cfg, logicPath);
      const headers = this._basicAuthHeader(cfg);
      const resp = await fetch(absUrl, { method: 'GET', headers, credentials: 'omit' });
      if (!resp.ok) throw new Error('读取 NAS 文件失败 HTTP ' + resp.status);
      const blob = await resp.blob();
      const fileName = (logicPath || '').split('/').filter(Boolean).pop() || 'nas-file';
      let mime = blob.type || 'application/octet-stream';
      if (!mime || mime === 'application/octet-stream') {
        const idx = fileName.lastIndexOf('.');
        if (idx >= 0) {
          const ext = fileName.substring(idx + 1).toLowerCase();
          const m = { png:'image/png', jpg:'image/jpeg', jpeg:'image/jpeg', gif:'image/gif', bmp:'image/bmp',
                      webp:'image/webp', svg:'image/svg+xml', ico:'image/x-icon', avif:'image/avif', pdf:'application/pdf' };
          if (m[ext]) mime = m[ext];
        }
      }
      const lastMs = (function(){ try { return new Date().getTime(); } catch(e){ return Date.now(); } })();
      const file = new File([blob], fileName, { type: mime, lastModified: lastMs });
      file._nasLogicPath = logicPath;
      return { file, blob, absUrlEncoded: absUrl };
    },
    /**
     * 将文件（Blob/File）转成 Base64 DataURL（供 cc.html 等直接嵌入使用）
     */
    fileToDataUrl(fileOrBlob) {
      return new Promise((resolve, reject) => {
        if (!fileOrBlob) { reject(new Error('空文件')); return; }
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error || new Error('FileReader error'));
        fr.readAsDataURL(fileOrBlob);
      });
    }
  },

  // ===== NAS 选择器：打开 nas-picker.html，等待用户勾选回传 =====
  /**
   * @param {object} opts
   * @param {boolean} [opts.multi=false] 是否多选
   * @param {'images'|'all'} [opts.filter='images'] 文件类型过滤
   * @param {'large'|'small'|'details'} [opts.view='large'] 默认视图
   * @param {string} [opts.title] 弹窗标题（可选，用于无障碍）
   * @returns {Promise<Array<{logicPath,name,size,mime,lastModified}>>} 用户勾选的文件数组
   */
  pickFromNas(opts) {
    const self = this;
    opts = opts || {};
    const cfg = self.utils.getNasConfig();
    if (!cfg.serverUrl) {
      return Promise.reject(new Error('NAS 尚未配置，请先到「设置 → 云盘 NAS」填写服务器地址并保存'));
    }
    return new Promise((resolve, reject) => {
      // 一次性 token
      const token = 'NT' + Date.now() + '_' + Math.floor(Math.random() * 1e9);
      const q = new URLSearchParams();
      q.set('token', token);
      q.set('origin', location.origin || '');
      q.set('multi', opts.multi ? '1' : '0');
      q.set('filter', (opts.filter && opts.filter === 'all') ? 'all' : 'images');
      if (['large','small','details'].indexOf(opts.view) >= 0) q.set('view', opts.view);
      const url = 'nas-picker.html?' + q.toString();
      const winW = 1000, winH = 680;
      const left = Math.max(10, Math.round((window.outerWidth || screen.width || 1280) - winW) / 2);
      const top  = Math.max(10, Math.round((window.outerHeight || screen.height || 800) - winH) / 3);
      const win = window.open(url, 'NasPicker_' + token,
        'width=' + winW + ',height=' + winH + ',left=' + left + ',top=' + top +
        ',resizable=yes,scrollbars=yes,menubar=no,toolbar=no,location=no,status=no');
      if (!win) {
        reject(new Error('浏览器阻止了弹出窗口，请允许本页弹出 NAS 选择器'));
        return;
      }
      let done = false;
      let timeoutTimer = setTimeout(function(){
        if (!done) { done = true;
          try { window.removeEventListener('message', onMsg); } catch(e) {}
          reject(new Error('NAS 选择器超时或已关闭（未选择任何文件）'));
        }
      }, 10 * 60 * 1000); // 10 分钟超时
      let closePollTimer = setInterval(function(){
        try {
          if (win.closed) {
            clearInterval(closePollTimer);
            if (!done) { done = true;
              try { window.removeEventListener('message', onMsg); } catch(e) {}
              clearTimeout(timeoutTimer);
              resolve([]); // 关闭 = 取消（给空数组方便调用方判断）
            }
          }
        } catch(e) { /* cross-origin 时访问 closed 可能抛错，继续轮询就行 */ }
      }, 500);
      function onMsg(e) {
        try {
          const d = e.data;
          if (!d || d.source !== 'nas-picker' || d.token !== token) return;
          if (!done) {
            done = true;
            clearTimeout(timeoutTimer);
            clearInterval(closePollTimer);
            try { window.removeEventListener('message', onMsg); } catch(_) {}
            const picks = Array.isArray(d.picks) ? d.picks : [];
            // 校验一下 picks 是否为有效文件
            const cleaned = picks.filter(function(p){ return p && typeof p.logicPath === 'string' && p.logicPath; });
            resolve(cleaned);
          }
        } catch(err) {
          if (!done) { done = true; reject(err); }
        }
      }
      window.addEventListener('message', onMsg, false);
      try { win.focus(); } catch(_) {}
    });
  },

  // ===== 表格渲染器 =====
  renderTable(containerId, { columns, data, rowKey = 'id', actions = null }) {
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!data || data.length === 0) {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <div class="empty-text">暂无数据</div>
        </div>`;
      return;
    }

    let html = '<div class="table-scroll"><table class="data-table"><thead><tr>';
    columns.forEach(col => {
      html += `<th style="${col.width ? 'width:' + col.width : ''}">${col.title}</th>`;
    });
    if (actions) html += '<th style="width:140px;">操作</th>';
    html += '</tr></thead><tbody>';

    data.forEach(row => {
      html += '<tr>';
      columns.forEach(col => {
        let val = row[col.key];
        if (col.render) val = col.render(row[col.key], row);
        if (val === null || val === undefined || val === '') val = '<span class="text-muted">-</span>';
        html += `<td>${val}</td>`;
      });
      if (actions) {
        html += `<td class="flex gap-8" style="white-space:nowrap;">${actions(row)}</td>`;
      }
      html += '</tr>';
    });

    html += '</tbody></table></div>';
    container.innerHTML = html;
  },

  // ===== 状态标签渲染 =====
  statusTag(status, statusMap) {
    const map = statusMap || {
      '草稿': 'tag-gray',
      '打样中': 'tag-blue',
      '待确认': 'tag-orange',
      '生产中': 'tag-blue',
      '已完成': 'tag-green',
      '已取消': 'tag-red',
      '待排产': 'tag-gray',
      '已发货': 'tag-teal',
      '待检': 'tag-orange',
      '合格': 'tag-green',
      '不合格': 'tag-red',
      '返工': 'tag-red',
      '异常': 'tag-red',
      '询价': 'tag-gray',
      '已下单': 'tag-blue',
      '已到货': 'tag-green',
      '打样中': 'tag-blue',
      '待审': 'tag-orange',
      '已确认': 'tag-green',
      '需修改': 'tag-red',
      '待打样': 'tag-gray',
      '寄样中': 'tag-blue',
      '采购合同': 'tag-teal',
      '发货中': 'tag-orange',
      '头样': 'tag-gray',
      '尺码样': 'tag-blue',
      '产前样': 'tag-teal',
      '船样': 'tag-orange',
      '照片样': 'tag-purple',
      '未解决': 'tag-red',
      '已解决': 'tag-green',
      '高': 'tag-red',
      '中': 'tag-orange',
      '低': 'tag-gray',
    };
    const cls = map[status] || 'tag-gray';
    return `<span class="tag ${cls}">${status || '-'}</span>`;
  },

  // ===== 备份数据 =====
  backupData() {
    const keys = ['styles', 'orders', 'fabrics', 'accessories', 'samples', 'feedbacks', 'consumptions', 'consumption_categories', 'productions', 'invoices', 'payments', 'collections', 'contacts', 'customers', 'suppliers', 'favoriteContacts', 'washes', 'shippings', 'express_delivery_data_v2', 'pl_records_v1', 'nas_config', 'nas_folder_perms'];
    const backup = { backupTime: new Date().toISOString() };
    keys.forEach(key => {
      const data = localStorage.getItem(key);
      if (data) backup[key] = data;
    });
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sainty-hantang-backup-${App.utils.formatDate(new Date())}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    this.toast('数据备份成功', 'success');
  },

  // ===== 登录检查（Supabase 适配）=====
  // 同步读取 localStorage 中的 Supabase 会话令牌
  // 真正的会话有效性由 js/auth-guard.js 的 supabase.auth.getUser() 校验
  // 这里只判断"是否存在会话"，不自行伪造登录状态
  checkLogin() {
    const session = _readSupabaseSessionSync();
    if (!session || !session.user) {
      _clearAllAuthState();
      try {
        window.location.replace('login.html');
      } catch (e) {
        window.location.href = 'login.html';
      }
      return false;
    }
    return true;
  },

  // ===== 退出登录（Supabase 适配）=====
  // 乐观更新：先清本地 + 立即跳登录页，再异步调用 signOut
  // 任何一步失败都不阻塞跳转，保证"点击退出一定生效"
  // 若 js/auth-guard.js 已加载，会以 auth-guard 的更完整版本覆盖此方法
  logout() {
    // 1. 立即清本地所有认证状态
    _clearAllAuthState();
    // 2. 强制跳登录页（设置双保险：立即 + 50ms 兜底 + 500ms 最终兜底）
    const goLogin = function() {
      try { window.location.replace('login.html'); }
      catch (e) { window.location.href = 'login.html'; }
    };
    goLogin();
    setTimeout(goLogin, 50);
    setTimeout(goLogin, 500);
    // 3. 后台异步调用 signOut，失败静默吞掉（不影响跳转）
    try {
      if (window.supabase && window.supabase.auth && typeof window.supabase.auth.signOut === 'function') {
        window.supabase.auth.signOut().catch(function(){});
      } else {
        import('./supabase.js').then(function(mod){
          if (mod && mod.supabase) mod.supabase.auth.signOut().catch(function(){});
        }).catch(function(){});
      }
    } catch(e) {}
  },

  // ===== 角色定义 =====
  roles: {
    admin:        { name: '系统管理员', isAdmin: true },
    merchandiser: { name: '业务跟单员', isAdmin: false },
    purchaser:    { name: '面辅料采购员', isAdmin: false },
    designer:     { name: '样衣师', isAdmin: false },
    qc:           { name: '品控员', isAdmin: false },
    qcInspector:  { name: 'QC检验员', isAdmin: false },
    finance:      { name: '财务专员', isAdmin: false },
    documentary:  { name: '单证员', isAdmin: false },
    manager:      { name: '管理层', isAdmin: false },
    user:         { name: '普通用户', isAdmin: false },
  },

  // ===== 价格可见角色（只有这些角色可以看到订单的单价和金额）=====
  priceVisibleRoles: ['admin', 'manager', 'finance', 'documentary'],

  // ===== 判断当前用户是否可以查看价格 =====
  canSeePrice() {
    const user = this.getCurrentUser();
    if (!user) return false;
    return this.priceVisibleRoles.includes(user.role);
  },

  // ===== 模块权限映射 =====
  // 每个模块对应一个权限key，用于权限检查
  modulePermissions: {
    index:        '首页',
    order:        '订单管理',
    fabric:       '面里衬采购',
    accessory:    '辅料采购',
    wash:         '水洗管理',
    sample:       '样衣管理',
    consumption:  '用料及纸板',
    qcField:      '外勤QC',
    production:   '生产管理',
    shipping:     '出运管理',
    express:      '寄件管理',
    finance:      '财务管理',
    nasDrive:     '云盘 NAS',
    contacts:     '通讯录',
    maintenance:  '维护资料',
    settings:     '设置',
  },

  // ===== 获取当前登录用户（Supabase 适配）=====
  // 优先使用 auth-guard 已校验的 window.currentSupabaseUser
  // 否则同步从 localStorage 中的 Supabase 会话读取并映射为系统用户结构
  getCurrentUser() {
    try {
      if (window.currentSupabaseUser) {
        return _mapSupabaseUser(window.currentSupabaseUser);
      }
      const session = _readSupabaseSessionSync();
      if (session && session.user) {
        return _mapSupabaseUser(session.user);
      }
    } catch (e) {}
    return null;
  },

  // ===== 检查当前用户对某模块的权限 =====
  // 返回: 'write' | 'read' | 'none' | 'hidden'
  getPermission(moduleKey) {
    const user = this.getCurrentUser();
    if (!user) return 'none';

    // 管理员邮箱用户始终拥有全部读写权限
    const adminEmails = window.ADMIN_EMAILS || [];
    if (adminEmails.indexOf(user.email) >= 0) return 'write';

    const roleKey = user.role || 'user';
    // 关键调试：打印当前用户的完整角色信息
    console.log('[权限调试] getPermission: module=' + moduleKey + ', email=' + user.email + ', role=' + roleKey + ', username=' + user.username + ', roles[role]=' + (this.roles[roleKey] ? JSON.stringify(this.roles[roleKey]) : 'undefined'));
    const roleDef = this.roles[roleKey];

    // 如果角色不存在于定义中，给管理员权限
    if (!roleDef) {
      return 'write';
    }
    // 管理员拥有全部读写权限
    if (roleDef.isAdmin) return 'write';

    // 关键修复：优先使用 settings 页面保存的权限矩阵（app_data_store 的 permissions key）
    const perms = this.store.get('permissions', {});
    const modulePerm = perms[moduleKey];
    if (modulePerm) {
      // 调试日志：打印该模块所有角色的权限值，便于排查
      console.log('[权限调试] module=' + moduleKey + ', 所有角色权限:', JSON.stringify(modulePerm));
      const rolePerm = modulePerm[roleKey];
      console.log('[权限调试] 角色匹配: role=' + roleKey + ', value=' + JSON.stringify(rolePerm));
      if (rolePerm === 'write' || rolePerm === 'read' || rolePerm === 'none' || rolePerm === 'hidden') {
        console.log('[权限] module=' + moduleKey + ', role=' + roleKey + ', user=' + user.email + ' → ' + rolePerm + ' (来自permissions矩阵)');
        return rolePerm;
      }
    } else {
      console.log('[权限调试] module=' + moduleKey + ' 无配置 (permissions[' + moduleKey + '] 为 undefined)');
    }

    // 兜底1：如果 permissions key 中无此模块配置，再检查 _userModulePerms
    const userPerms = this._userModulePerms || {};
    if (userPerms[moduleKey]) {
      const p = userPerms[moduleKey];
      if (p === 'write' || p === 'read' || p === 'none' || p === 'hidden') {
        console.log('[权限] module=' + moduleKey + ', role=' + roleKey + ', user=' + user.email + ' → ' + p + ' (来自_userModulePerms兜底)');
        return p;
      }
    }

    // 兜底2：严格从截图默认矩阵取（SCREENSHOT_DEFAULT_PERMISSIONS）—— 不再无脑给 write，
    // 这是防止"加载空白时立刻显示读写"并偶然写回成错误默认的关键修复。
    const base = (typeof App.SCREENSHOT_DEFAULT_PERMISSIONS === 'object' && App.SCREENSHOT_DEFAULT_PERMISSIONS) ? App.SCREENSHOT_DEFAULT_PERMISSIONS : null;
    if (!modulePerm) {
      const fallback = (base && base[moduleKey] && base[moduleKey][roleKey]) || 'read';
      console.log('[权限] module=' + moduleKey + ', role=' + roleKey + ', user=' + user.email + ' → ' + fallback + ' (无配置默认，取自截图默认矩阵)');
      return fallback;
    }
    const rolePerm = modulePerm[roleKey];
    if (!rolePerm) {
      const fallback = (base && base[moduleKey] && base[moduleKey][roleKey]) || 'read';
      console.log('[权限] module=' + moduleKey + ', role=' + roleKey + ', user=' + user.email + ' → ' + fallback + ' (角色无配置默认，取自截图默认矩阵)');
      return fallback;
    }
    console.log('[权限] module=' + moduleKey + ', role=' + roleKey + ', user=' + user.email + ' → ' + rolePerm + ' (最终)');
    return rolePerm;
  },

  // ===== 判断当前用户对某模块是否有写权限 =====
  canWrite(moduleKey) {
    return this.getPermission(moduleKey) === 'write';
  },

  // ===== 判断当前用户对某模块是否只读 =====
  isReadOnly(moduleKey) {
    return this.getPermission(moduleKey) === 'read';
  },

  // ===== 页面权限守卫 =====
  // 在每个模块页面调用，根据权限显示只读模式提示
  enforcePagePermission: function(moduleKey) {
    // 记录当前页面模块，供后续异步事件重新检查
    window._currentPageModule = moduleKey;
    var self = this;
    // 应用权限到 DOM（幂等）
    var applyPermToDom = function(perm, showToast) {
      var content = document.querySelector('.app-content');
      if (perm === 'none' || perm === 'hidden') {
        document.body.classList.remove('readonly-mode');
        if (content) {
          content.innerHTML =
            '<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;color:#6b7280;">' +
              '<div style="font-size:64px;margin-bottom:16px;">🔒</div>' +
              '<div style="font-size:20px;font-weight:600;margin-bottom:8px;">无访问权限</div>' +
              '<div style="font-size:14px;">您当前的角色无权访问此模块，请联系管理员开通权限</div>' +
            '</div>';
        }
        return false;
      }
      if (perm === 'read') {
        document.body.classList.add('readonly-mode');
        if (showToast) self.toast('当前为只读模式，如需修改请联系管理员', 'info', 3000);
      } else if (perm === 'write') {
        document.body.classList.remove('readonly-mode');
      }
      return true;
    };

    var initPerm = this.getPermission(moduleKey);
    applyPermToDom(initPerm, true);

    // 重查权限（每次都重新读 users 列表映射最新角色）
    var recheck = function() {
      var realPerm = self.getPermission(moduleKey);
      console.log('[权限] 异步重查 module=' + moduleKey + ', 最终权限=' + realPerm);
      applyPermToDom(realPerm, false);
      if (App._currentPageKey) {
        try { App.injectSidebar(App._currentPageKey); } catch(e) {}
      }
    };

    // 等待3条异步渠道任一完成后重查
    if (!window.__permWaitPromise) {
      window.__permWaitPromise = new Promise(function(resolve) {
        var done = false;
        var finish = function() { if (!done) { done = true; resolve(); } };
        setTimeout(finish, 10000); // 超时 10 秒兜底
        // 轮询 auth-guard 的 _userModulePerms
        var elapsed = 0;
        var poll = function() {
          if (done) return;
          if (window.App && window.App._userModulePerms) { finish(); return; }
          elapsed += 200;
          if (elapsed >= 10000) return;
          setTimeout(poll, 200);
        };
        setTimeout(poll, 200);
        // 云端同步 users/permissions
        var onCloudUpdate = function(e) {
          if (done) return;
          var keys = (e && e.detail && e.detail.keys) || [];
          if (keys.indexOf('users') >= 0 || keys.indexOf('permissions') >= 0) {
            console.log('[权限] 收到云端同步:' + keys.join(','));
            finish();
          }
        };
        window.addEventListener('cloud-data-updated', onCloudUpdate, false);
        setTimeout(function() { window.removeEventListener('cloud-data-updated', onCloudUpdate); }, 10500);
      });
    }

    window.__permWaitPromise.then(recheck);
    window.addEventListener('auth-role-updated', recheck);
    window.addEventListener('cloud-data-updated', function(e) {
      var keys = (e && e.detail && e.detail.keys) || [];
      if (keys.indexOf('users') >= 0 || keys.indexOf('permissions') >= 0) {
        recheck();
      }
    });

    return initPerm !== 'none' && initPerm !== 'hidden';
  }
};

// ===== 异步权限加载完成后重新注入侧边栏（过滤"不显示"模块）=====
window.addEventListener('auth-role-updated', function() {
  if (window.App && App._currentPageKey) {
    try { App.injectSidebar(App._currentPageKey); } catch(e) {}
  }
});

// ===== 截图级模块权限默认值（唯一事实来源）=====
// 严格对齐 settings.html 用户组页面的 9 个非管理员角色 × 16 个模块。
// 角色顺序（非 admin）：merchandiser 业务跟单员 / purchaser 面辅料采购员 / designer 样衣师 / qc 品控员 / qcInspector QC检验员 / finance 财务专员 / documentary 单证员 / manager 管理层 / user 普通用户
// 注：admin 角色在 getPermission 中直接返回 write，不需要在矩阵中配置
App.SCREENSHOT_DEFAULT_PERMISSIONS = {
  index:       { merchandiser: 'read',  purchaser: 'read',  designer: 'read',  qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'read',  user: 'read'  }, // 首页：全只读
  order:       { merchandiser: 'read',  purchaser: 'read',  designer: 'read',  qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'write', user: 'read'  }, // 订单管理：仅管理层读写
  fabric:      { merchandiser: 'read',  purchaser: 'read',  designer: 'read',  qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'write', user: 'read'  }, // 面里衬采购：仅管理层读写
  accessory:   { merchandiser: 'read',  purchaser: 'write', designer: 'read',  qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'read',  user: 'read'  }, // 辅料采购：采购读写
  wash:        { merchandiser: 'write', purchaser: 'read',  designer: 'read',  qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'read',  user: 'read'  }, // 水洗管理：跟单读写
  sample:      { merchandiser: 'read',  purchaser: 'read',  designer: 'write', qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'read',  user: 'read'  }, // 样衣管理：设计读写
  consumption: { merchandiser: 'read',  purchaser: 'read',  designer: 'write', qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'read',  user: 'read'  }, // 用料及纸板：设计读写
  qcField:     { merchandiser: 'read',  purchaser: 'read',  designer: 'read',  qc: 'read',  qcInspector: 'write', finance: 'read',  documentary: 'read',  manager: 'write', user: 'read'  }, // 外勤QC：QC检验员/管理层读写
  production:  { merchandiser: 'write', purchaser: 'read',  designer: 'read',  qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'write', user: 'read'  }, // 生产管理：跟单/管理层读写
  shipping:    { merchandiser: 'write', purchaser: 'read',  designer: 'read',  qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'read',  user: 'read'  }, // 出运管理：跟单读写
  express:     { merchandiser: 'write', purchaser: 'write', designer: 'write', qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'write', user: 'read'  }, // 寄件管理：跟单/采购/设计/经理读写
  finance:     { merchandiser: 'read',  purchaser: 'read',  designer: 'read',  qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'write', user: 'read'  }, // 财务管理：管理层读写
  nasDrive:    { merchandiser: 'write', purchaser: 'write', designer: 'write', qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'write', user: 'read'  }, // 云盘NAS：跟单/采购/设计/经理读写
  contacts:    { merchandiser: 'write', purchaser: 'write', designer: 'write', qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'write', user: 'read'  }, // 通讯录：跟单/采购/设计/经理读写
  maintenance: { merchandiser: 'write', purchaser: 'write', designer: 'read',  qc: 'read',  qcInspector: 'read',  finance: 'read',  documentary: 'read',  manager: 'write', user: 'read'  }, // 维护资料：跟单/采购/经理读写
  settings:    { merchandiser: 'hidden',purchaser: 'hidden',designer: 'hidden',qc: 'hidden',qcInspector: 'hidden',finance: 'hidden',documentary: 'hidden',manager: 'hidden',user: 'hidden'}, // 设置：全不显示（仅管理员可见）
};

// ===== 初始化数据结构 =====
App.initSampleData = function() {
  const DATA_VERSION = '11'; // v11: 新增"外勤QC"模块与"QC检验员"角色，跨所有电脑强制重置一次默认权限
  const currentVersion = localStorage.getItem('dataVersion');
  const isVersionChanged = currentVersion !== DATA_VERSION;

  // 版本变更：清理旧用户和权限数据（本地 + 远端），确保所有电脑都以截图默认值为基线
  if (isVersionChanged) {
    if (window.SupabaseStore) {
      try { window.SupabaseStore.remove('permissions'); } catch(_) {}
      try { window.SupabaseStore.remove('users'); } catch(_) {}
    }
    // 走独立删除通道：确保远端 app_data_store 中的旧 permissions 行被真正清掉
    try {
      window.dispatchEvent(new CustomEvent('cloud-delete-request', { detail: { key: 'permissions' } }));
      window.dispatchEvent(new CustomEvent('cloud-delete-request', { detail: { key: 'users' } }));
    } catch(_) {}
    // 同时清理本地 localStorage 缓存，确保完全重置
    try {
      localStorage.removeItem('users');
      localStorage.removeItem('permissions');
    } catch(e) {}
    localStorage.setItem('dataVersion', DATA_VERSION);
  }

  // 初始化用户系统（5个用户）
  const existingUsers = App.store.get('users', null);
  if (!existingUsers || existingUsers.length === 0) {
    const today = new Date().toISOString().slice(0,10);
    App.store.set('users', [
      { id: 'U-0001', username: 'CaryZhang',   email: '15161515245@163.com',    password: '123456', role: 'merchandiser', description: '业务跟单员', status: 'active', createDate: today },
      { id: 'U-0002', username: 'IvyQian',     email: '13621500379@163.com',     password: '123456', role: 'merchandiser', description: '业务跟单员', status: 'active', createDate: today },
      { id: 'U-0003', username: 'CandyChen',   email: 'candychen0006@163.com',   password: '123456', role: 'designer',     description: '样衣师',    status: 'active', createDate: today },
      { id: 'U-0004', username: 'AdamXu',     email: 'adamstig@163.com',         password: '123456', role: 'merchandiser', description: '业务跟单员', status: 'active', createDate: today },
      { id: 'U-0005', username: 'AlonZhang',   email: 'alonzhang76@outlook.com',  password: '123456', role: 'admin',        description: '系统管理员', status: 'active', createDate: today },
    ]);
  }

  // 初始化模块权限配置（各角色默认对各模块的权限）—— 使用截图默认矩阵
  const existingPerms = App.store.get('permissions', null);
  if (!existingPerms || Object.keys(existingPerms).length === 0) {
    App.store.set('permissions', App.SCREENSHOT_DEFAULT_PERMISSIONS);
  }

  // 迁移：为已有权限配置补充缺失的模块权限（严格以截图默认值补齐，不重置已有数据）
  const perms = App.store.get('permissions', {});
  const base = App.SCREENSHOT_DEFAULT_PERMISSIONS;
  let permChanged = false;
  Object.keys(base).forEach(key => {
    if (!perms[key]) { perms[key] = base[key]; permChanged = true; }
    // 若模块存在但角色缺失 → 补齐截图默认的该角色权限
    const baseMod = base[key] || {};
    Object.keys(baseMod).forEach(roleKey => {
      if (!perms[key] || typeof perms[key][roleKey] !== 'string') {
        if (!perms[key]) perms[key] = {};
        perms[key][roleKey] = baseMod[roleKey];
        permChanged = true;
      }
    });
  });
  if (permChanged) App.store.set('permissions', perms);
};

// ===== 款式图片共享缓存 =====
// 以款号(styleNo)为键，跨模块共享图片。任何模块上传的图片，其他模块均可复用。
const StyleImgCache = {
  KEY: 'styleImages',

  _load() {
    try { return JSON.parse(localStorage.getItem(this.KEY) || '{}'); }
    catch(_) { return {}; }
  },
  _save(obj) {
    localStorage.setItem(this.KEY, JSON.stringify(obj));
    // 触发云端同步
    try {
      window.dispatchEvent(new CustomEvent('cloud-write-request', {
        detail: { key: this.KEY, value: obj, ts: Date.now() }
      }));
    } catch(_) {}
  },

  // 获取指定款号的图片
  get(styleNo) {
    if (!styleNo) return null;
    var all = this._load();
    return all[String(styleNo)] || null;
  },

  // 检查指定款号是否有图片
  has(styleNo) {
    if (!styleNo) return false;
    var entry = this.get(styleNo);
    return !!(entry && (entry.styleImg_path || entry.fullImg_path));
  },

  // 设置指定款号的图片
  // images: { styleImg_path, styleImg_name, fullImg_path, fullImg_name }
  set(styleNo, images) {
    if (!styleNo) return;
    // base64 data URL 不缓存（避免 localStorage 膨胀）
    var sanitized = {};
    if (images.styleImg_path && !images.styleImg_path.startsWith('data:image')) {
      sanitized.styleImg_path = images.styleImg_path;
      sanitized.styleImg_name = images.styleImg_name || '';
    }
    if (images.fullImg_path && !images.fullImg_path.startsWith('data:image')) {
      sanitized.fullImg_path = images.fullImg_path;
      sanitized.fullImg_name = images.fullImg_name || '';
    }
    // 如果没有可缓存内容，跳过
    if (!sanitized.styleImg_path && !sanitized.fullImg_path) return;
    var all = this._load();
    var existing = all[String(styleNo)] || {};
    // 合并：新值覆盖，旧值保留
    all[String(styleNo)] = Object.assign({}, existing, sanitized, { updatedAt: Date.now() });
    this._save(all);
  },

  // 仅当传入的新图片路径与缓存不同时才更新（避免无效写入）
  updateIfChanged(styleNo, images) {
    if (!styleNo) return;
    var existing = this.get(styleNo) || {};
    var changed = false;
    if (images.styleImg_path && images.styleImg_path !== existing.styleImg_path) changed = true;
    if (images.fullImg_path && images.fullImg_path !== existing.fullImg_path) changed = true;
    if (changed) this.set(styleNo, images);
  },

  // 删除指定款号的图片缓存
  remove(styleNo) {
    if (!styleNo) return;
    var all = this._load();
    delete all[String(styleNo)];
    this._save(all);
  },

  // 检查某个 Supabase 路径是否被其他款号共享引用
  isShared(path, excludeStyleNo) {
    if (!path) return false;
    var all = this._load();
    var keys = Object.keys(all);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      if (k === String(excludeStyleNo)) continue;
      var entry = all[k];
      if (!entry) continue;
      if (entry.styleImg_path === path || entry.fullImg_path === path) return true;
    }
    return false;
  },

  // 获取指定款号的图片（先查缓存，再回查各业务表）
  resolve(styleNo) {
    if (!styleNo) return null;
    // 1) 先查本地缓存
    var cached = this.get(styleNo);
    if (cached && (cached.styleImg_path || cached.fullImg_path)) return cached;
    // 2) 回查各业务表
    var result = null;
    try {
      // 查 orders
      var orders = App.store.get('orders', []);
      var o = orders.find(function(x){ return x.styleNo === styleNo; });
      if (o && (o.styleImg_path || o.fullImg_path)) {
        result = { styleImg_path: o.styleImg_path || '', styleImg_name: o.styleImg_name || '', fullImg_path: o.fullImg_path || '', fullImg_name: o.fullImg_name || '' };
      }
      // 查 consumptions
      if (!result) {
        var cons = App.store.get('consumptions', []);
        var c = cons.find(function(x){ return x.styleNo === styleNo || x.itemNo === styleNo; });
        if (c && (c.styleImg_path || c.fullImg_path)) {
          result = { styleImg_path: c.styleImg_path || '', styleImg_name: c.styleImg_name || '', fullImg_path: c.fullImg_path || '', fullImg_name: c.fullImg_name || '' };
        }
      }
      // 查 samples
      if (!result) {
        var samples = App.store.get('samples', []);
        var s = samples.find(function(x){ return x.styleNo === styleNo; });
        if (s && (s.styleImg_path || s.fullImg_path)) {
          result = { styleImg_path: s.styleImg_path || '', styleImg_name: s.styleImg_name || '', fullImg_path: s.fullImg_path || '', fullImg_name: s.fullImg_name || '' };
        }
      }
    } catch(_e) {}
    // 3) 找到后回填缓存
    if (result) this.set(styleNo, result);
    return result;
  }
};

// 暴露到全局
window.StyleImgCache = StyleImgCache;

/**
 * 从存储路径里提取款号提示，用于"找不到原路径时自动回退"
 * 支持输入：
 *   - GW27-003.png  → GW27-003
 *   - {userId}/consumption/uuid-GW27-003.png  → GW27-003
 *   - 9932fa8d/order/...-3011043.jpeg → 3011043
 *   - styleNo/uuid-orig.jpg → styleNo（第一段）
 * 返回：候选 styleNo 字符串数组（按优先级高→低）
 */
function _extractStyleCandidatesFromPath(path) {
  if (!path) return [];
  var out = [];
  try {
    // 1) 最后一段文件名去掉扩展名
    var last = String(path).split(/[\\/]/).pop() || '';
    var nameNoExt = last.replace(/\.[^.]+$/, '');
    // 去掉 UUID 前缀：{uuid}-xxx → xxx
    var m = nameNoExt.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(.+)$/i);
    if (m) nameNoExt = m[1];
    else {
      var m2 = nameNoExt.match(/^[0-9a-f]{8,}-(.+)$/i);  // 短 UUID
      if (m2) nameNoExt = m2[1];
    }
    if (nameNoExt) out.push(nameNoExt);

    // 2) 如果整个路径第一段是 styleNo 样式（非 UUID 目录名），也是一个候选
    var firstSeg = String(path).split(/[\\/]/)[0] || '';
    if (firstSeg && !/^[0-9a-f]{8}-/i.test(firstSeg) && firstSeg.length <= 40) {
      if (out.indexOf(firstSeg) < 0) out.push(firstSeg);
    }
  } catch(_) {}
  return out;
}

/**
 * 跨模块通用：把 Supabase Storage 存储路径解析为可跨浏览器显示的 URL
 * 策略：1) data:image 直出；2) JS client signed URL；3) REST API sign；4) 自动按款号回退到
 *       桶根 {style}.{png|jpg|jpeg|webp} 或 {style}/ 目录下同名文件（解决手动上传/旧版本路径找不到）；
 *       5) public 直读路径
 * @param {string} path  存储路径（如 {userId}/consumption/uuid-GW27-003.png），也接受已完整 URL
 * @param {Object} [opts]
 * @param {number} [opts.ttlSec=7200] signed URL 有效期（秒）
 * @returns {Promise<string>} 可直接赋给 img.src 的 URL，失败返回空串
 */
window.resolveImageUrl = async function resolveImageUrl(path, opts) {
  opts = opts || {};
  var ttl = opts.ttlSec || 7200;
  if (!path) return '';
  if (path.startsWith('data:image')) return path;
  if (/^https?:\/\//i.test(path)) return path; // 已经是完整 URL

  var bucket = window.STORAGE_BUCKET || 'app-photos';
  var sb = window.supabase;
  var sbUrl = (window.SUPABASE_URL || '').replace(/\/$/, '');
  var anon = window.SUPABASE_ANON_KEY || '';
  var cb = '_t=' + Date.now() + '-' + Math.floor(Math.random() * 1e6); // Safari 强缓存绕过

  // 预取 auth header（REST sign 要用，避免后面重复算）
  var restAuth = null;
  if (sbUrl && anon) {
    restAuth = 'Bearer ' + anon;
    try {
      if (sb && sb.auth && typeof sb.auth.getSession === 'function') {
        var { data } = await sb.auth.getSession();
        if (data && data.session && data.session.access_token) restAuth = 'Bearer ' + data.session.access_token;
      }
    } catch(_) {}
    if (restAuth === 'Bearer ' + anon) {
      try {
        var lkeys = Object.keys(localStorage);
        for (var li = 0; li < lkeys.length; li++) {
          if (lkeys[li].indexOf('sb-') === 0 && lkeys[li].indexOf('-auth-token') >= 0) {
            var raw = localStorage.getItem(lkeys[li]);
            if (raw) { var parsed = JSON.parse(raw); if (parsed && parsed.access_token) { restAuth = 'Bearer ' + parsed.access_token; break; } }
          }
        }
      } catch(_) {}
    }
  }

  /** 对单个路径生成 signed URL：先 JS client 再 REST sign；成功返回 {ok:true, url:string}，否则 {ok:false} */
  async function trySignOnce(candidatePath) {
    if (!candidatePath) return { ok: false };
    // 1) JS client
    if (sb && sb.storage && sb.storage.from) {
      try {
        var r = await sb.storage.from(bucket).createSignedUrl(candidatePath, ttl);
        if (r && !r.error && r.data && r.data.signedUrl) {
          var u = r.data.signedUrl;
          u += (u.indexOf('?') >= 0 ? '&' : '?') + cb;
          return { ok: true, url: u };
        }
      } catch(_e1) {}
    }
    // 2) REST sign
    if (sbUrl && anon) {
      try {
        var signUrl = sbUrl + '/storage/v1/object/sign/' + encodeURIComponent(bucket) + '/' + encodeURIComponent(candidatePath);
        var resp = await fetch(signUrl, {
          method: 'POST',
          headers: { 'apikey': anon, 'Authorization': restAuth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ expiresIn: ttl })
        });
        if (resp.ok) {
          var j = await resp.json();
          var signed = null;
          if (j && j.signedURL) signed = sbUrl + j.signedURL;
          else if (j && j.signedUrl) signed = (j.signedUrl.indexOf('http') === 0) ? j.signedUrl : (sbUrl + j.signedUrl);
          if (signed) {
            signed += (signed.indexOf('?') >= 0 ? '&' : '?') + cb;
            return { ok: true, url: signed };
          }
        }
      } catch(_e2) {}
    }
    return { ok: false };
  }

  // —— 第一轮：先试原路径（最理想情况）
  var first = await trySignOnce(path);
  if (first.ok) {
    console.log('[resolveImageUrl] 原路径命中:', path);
    return first.url;
  }

  // —— 第二轮：按款号生成候选路径，解决手动上传到桶根、或用 {styleNo}/ 文件夹组织的老路径
  // 候选来源：
  //   a. 从 path 的文件名提取出来的 styleNo（最高优先级，因为最贴合这条记录）
  //   b. opts.hintStyleNo 调用方直接传进来（如果调用方本来就知道款号，最准）
  var styleCands = [];
  try { styleCands = _extractStyleCandidatesFromPath(path); } catch(_) {}
  if (opts.hintStyleNo) {
    var hint = String(opts.hintStyleNo).trim();
    if (hint && styleCands.indexOf(hint) < 0) styleCands.unshift(hint);
  }
  var exts = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
  var fallbackPaths = [];
  for (var i = 0; i < styleCands.length; i++) {
    var sn = styleCands[i];
    // 桶根：{styleNo}.png 这类（用户截图里的 GW27-003.png、3011043.png）
    for (var ei = 0; ei < exts.length; ei++) fallbackPaths.push(sn + '.' + exts[ei]);
    // 款号文件夹：{styleNo}/ 下任意文件（只试候选文件，不做列目录开销）
    var last = (path.split(/[\\/]/).pop() || '');
    if (last) fallbackPaths.push(sn + '/' + last);
    var lastNameNoExt = last.replace(/\.[^.]+$/, '');
    var lastExt = last.match(/\.([^.]+)$/);
    var ext = (lastExt && lastExt[1]) ? lastExt[1].toLowerCase() : '';
    // 去掉 uuid 前缀后的纯文件名（如果 path 末尾是 uuid-款号.png → 款号.png）
    var stripped = lastNameNoExt.replace(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-/i, '').replace(/^[0-9a-f]{8,}-/i, '');
    if (stripped !== lastNameNoExt && ext) {
      fallbackPaths.push(sn + '/' + stripped + '.' + ext);
    }
  }
  // 去重
  var seenFb = {};
  var uniqueFb = [];
  for (var k = 0; k < fallbackPaths.length; k++) {
    if (!seenFb[fallbackPaths[k]]) { seenFb[fallbackPaths[k]] = 1; uniqueFb.push(fallbackPaths[k]); }
  }
  for (var fi = 0; fi < uniqueFb.length; fi++) {
    var cand = uniqueFb[fi];
    if (!cand || cand === path) continue;
    var r2 = await trySignOnce(cand);
    if (r2.ok) {
      console.log('[resolveImageUrl] 原路径失败 → 按款号回退命中: ' + path + ' → ' + cand);
      // 顺手把 styleImages 缓存回写到正确路径，下次再访问就不会走 fallback
      try {
        if (window.StyleImgCache && opts.hintStyleNo && typeof StyleImgCache.put === 'function') {
          var isFullHint = (String(path).toLowerCase().indexOf('full') >= 0 || String(path).toLowerCase().indexOf('大图') >= 0
            || String(path).toLowerCase().indexOf('big') >= 0 || String(path).toLowerCase().indexOf('large') >= 0);
          StyleImgCache.put(opts.hintStyleNo, {
            styleImg_path: !isFullHint ? cand : (window.StyleImgCache.resolve && StyleImgCache.resolve(opts.hintStyleNo) && StyleImgCache.resolve(opts.hintStyleNo).styleImg_path) || '',
            fullImg_path:   isFullHint ? cand : (window.StyleImgCache.resolve && StyleImgCache.resolve(opts.hintStyleNo) && StyleImgCache.resolve(opts.hintStyleNo).fullImg_path) || '',
          });
        }
      } catch(_eCache) {}
      return r2.url;
    }
  }

  // —— 第三轮（最后兜底）：public 直读原路径 + 款号回退挨个试
  if (sbUrl) {
    var public1 = sbUrl + '/storage/v1/object/public/' + encodeURIComponent(bucket) + '/' + encodeURIComponent(path) + '?' + cb;
    console.warn('[resolveImageUrl] signed URL 全部失败，回退 public 直读(原路径): ' + path.substring(0, 50));
    return public1;
  }
  return '';
};

/**
 * 跨模块：按款号获取款式图/大图（先本地缓存→再 Supabase Storage 文件名搜索）
 * 返回的对象中 *_path 是存储相对路径，*_signed 是已生成的临时 signed URL（可直接赋给 img.src，没有则为 null）
 * @param {string} styleNo
 * @returns {Promise<{styleImg_path:string, fullImg_path:string, styleImg_name:string, fullImg_name:string, styleImg_signed:string|null, fullImg_signed:string|null}|null>}
 */
window.getStyleImagesForStyleNo = async function getStyleImagesForStyleNo(styleNo) {
  if (!styleNo) return null;
  var sn = String(styleNo).trim();
  if (!sn) return null;
  console.log('[getStyleImagesForStyleNo] 🟢 开始查找款号图: sn=' + sn);

  // 1) 本地缓存优先
  if (window.StyleImgCache) {
    var c = null;
    try { c = StyleImgCache.resolve(sn); } catch(_e) {}
    if (c && (c.styleImg_path || c.fullImg_path)) {
      console.log('[getStyleImagesForStyleNo] ① 命中 StyleImgCache 本地缓存: styleImg_path=' + (c.styleImg_path || '') + ' fullImg_path=' + (c.fullImg_path || ''));
      var s1 = c.styleImg_path ? await resolveImageUrl(c.styleImg_path, { hintStyleNo: sn }) : null;
      var f1 = c.fullImg_path  ? await resolveImageUrl(c.fullImg_path,  { hintStyleNo: sn }) : null;
      return {
        styleImg_path: c.styleImg_path || '',
        fullImg_path:  c.fullImg_path  || '',
        styleImg_name: c.styleImg_name || '',
        fullImg_name:  c.fullImg_name  || '',
        styleImg_signed: s1,
        fullImg_signed:  f1
      };
    }
    console.log('[getStyleImagesForStyleNo] ① StyleImgCache 无缓存（空路径），继续…');
  } else {
    console.log('[getStyleImagesForStyleNo] ① 未定义 StyleImgCache，跳过本地缓存');
  }

  // 2) 去 Supabase 按文件名搜索
  if (window.SupabaseSubmit && typeof SupabaseSubmit.findStyleImages === 'function') {
    try {
      console.log('[getStyleImagesForStyleNo] ② 进入 findStyleImages(LIST 路径)...');
      var r = await SupabaseSubmit.findStyleImages(sn);
      if (r && (r.styleImg_path || r.fullImg_path)) {
        console.log('[getStyleImagesForStyleNo] ② LIST 命中: ' + JSON.stringify(r).slice(0, 200));
        // 写回缓存，下次秒开（只写路径，不写 base64，避免 localStorage 膨胀）
        if (window.StyleImgCache) {
          try {
            StyleImgCache.set(sn, {
              styleImg_path: r.styleImg_path || '',
              styleImg_name: r.styleImg_name || '',
              fullImg_path:  r.fullImg_path  || '',
              fullImg_name:  r.fullImg_name  || ''
            });
          } catch(_ec) {}
        }
        // 已经在 findStyleImages 里生成了 signedUrl，没有则再次 resolve
        var s2 = r.styleImg_signed || (r.styleImg_path ? await resolveImageUrl(r.styleImg_path, { hintStyleNo: sn }) : null);
        var f2 = r.fullImg_signed  || (r.fullImg_path  ? await resolveImageUrl(r.fullImg_path,  { hintStyleNo: sn }) : null);
        return {
          styleImg_path: r.styleImg_path || '',
          fullImg_path:  r.fullImg_path  || '',
          styleImg_name: r.styleImg_name || '',
          fullImg_name:  r.fullImg_name  || '',
          styleImg_signed: s2,
          fullImg_signed:  f2
        };
      }
      console.log('[getStyleImagesForStyleNo] ② LIST 未命中，兜底进入"候选路径直试"');
    } catch(_ee) {
      console.warn('[getStyleImagesForStyleNo] ② findStyleImages 抛异常:', _ee && _ee.message ? _ee.message : _ee);
    }
  } else {
    console.log('[getStyleImagesForStyleNo] ② 没有 SupabaseSubmit.findStyleImages，跳过 LIST 搜索');
  }

  // 3) 兜底：Storage LIST 被 RLS 阻止时，直接"猜"常用路径并逐个 createSignedUrl 试
  //    ——只要有一条命中（signed 成功且浏览器可加载），就等同于找到了。
  //    这种方式完全不依赖 LIST 权限（只需 sign 权限，即 storage.objects SELECT）。
  try {
    console.log('[getStyleImagesForStyleNo] ③ 候选路径直试兜底：sn=' + sn);
    var exts = ['png', 'jpg', 'jpeg', 'webp', 'gif'];
    var names = [];
    // 纯款号文件名（桶根手动上传的：GW27-003.png、3011043.png…）
    for (var ie = 0; ie < exts.length; ie++) names.push(sn + '.' + exts[ie]);
    for (var ie2 = 0; ie2 < exts.length; ie2++) names.push(sn.toUpperCase() + '.' + exts[ie2]);
    for (var ie3 = 0; ie3 < exts.length; ie3++) names.push(sn.toLowerCase() + '.' + exts[ie3]);
    // 桶根常见前缀 + 款号（手动上传用的：ss-3011043.png、IMG_3011043.jpg、style-GW27-003.png、3011043-款式图.png …）
    var namePrefixes = ['ss-', 'SS-', 'st-', 'ST-', 'sk-', 'SK-', 'img-', 'IMG-', 'image-', 'IMAGE-',
      'photo-', 'PHOTO-', 'preview-', 'PREVIEW-', 'style-', 'STYLE-', 'main-', 'MAIN-',
      'front-', 'FRONT-', '款式图-', '样式-', '图片-', '照片-', '大图-'];
    var nameSuffixes = ['-款式图', '-样式', '-图片', '-照片', '-style', '-main', '-front', '-preview', '-st', '-ss'];
    var nameCases = [sn, sn.toUpperCase(), sn.toLowerCase()];
    for (var np = 0; np < namePrefixes.length; np++) {
      for (var nci = 0; nci < nameCases.length; nci++) {
        for (var nep = 0; nep < exts.length; nep++) names.push(namePrefixes[np] + nameCases[nci] + '.' + exts[nep]);
      }
    }
    for (var ns = 0; ns < nameSuffixes.length; ns++) {
      for (var ncj = 0; ncj < nameCases.length; ncj++) {
        for (var nes = 0; nes < exts.length; nes++) names.push(nameCases[ncj] + nameSuffixes[ns] + '.' + exts[nes]);
      }
    }
    // 常见带 uuid 前缀：uuid-款号.ext（旧模块上传路径，在 userId/order/ 等下）
    // 这里不试 userId，因为跨机不一样；改试款号文件夹下任意标准命名
    var subfolderHints = [
      sn + '/',
      sn.toUpperCase() + '/',
      sn.toLowerCase() + '/'
    ];
    var styleLikeNames = ['款式图', 'style', 'styleImg', 'main', 'front', 'preview', 'image', 'photo'];
    var fullLikeNames  = ['大图', 'full', 'big', 'large', 'back'];
    var candidates = [];
    // 桶根裸图
    for (var ni = 0; ni < names.length; ni++) candidates.push({ path: names[ni], hint: 'style' });
    // 款号文件夹 + 常见名字
    for (var si = 0; si < subfolderHints.length; si++) {
      var sf = subfolderHints[si];
      // 款号文件夹内：款号.ext（最常见）
      for (var ne = 0; ne < exts.length; ne++) {
        candidates.push({ path: sf + sn + '.' + exts[ne], hint: 'style' });
        candidates.push({ path: sf + sn.toUpperCase() + '.' + exts[ne], hint: 'style' });
      }
      // 款号文件夹内：命名关键字
      for (var k = 0; k < styleLikeNames.length; k++) {
        for (var ee = 0; ee < exts.length; ee++) {
          candidates.push({ path: sf + styleLikeNames[k] + '.' + exts[ee], hint: 'style' });
        }
      }
      for (var k2 = 0; k2 < fullLikeNames.length; k2++) {
        for (var ee2 = 0; ee2 < exts.length; ee2++) {
          candidates.push({ path: sf + fullLikeNames[k2] + '.' + exts[ee2], hint: 'full' });
        }
      }
      // ===== 新增：款号文件夹内"任意一张已上传的文件"兜底（因为 uploadPicture 的标准存法是 {styleNo}/{uuid}-{origName}）
      //   用 REST list 直查款号文件夹，不依赖 JS client。如果 RLS 是 SELECT=authenticated 就能通。
      try {
        var sbUrl2 = (window.SUPABASE_URL || '').replace(/\/$/, '');
        var anon2 = window.SUPABASE_ANON_KEY || '';
        var bucket2 = window.STORAGE_BUCKET || 'app-photos';
        if (sbUrl2 && anon2) {
          var userTok = null;
          try {
            if (window.supabase && window.supabase.auth && typeof window.supabase.auth.getSession === 'function') {
              var _sd = await window.supabase.auth.getSession();
              if (_sd && _sd.data && _sd.data.session && _sd.data.session.access_token) userTok = _sd.data.session.access_token;
            }
          } catch(_ee2) {}
          var restAuth2 = 'Bearer ' + (userTok || anon2);
          var listUrl = sbUrl2 + '/storage/v1/object/list/' + encodeURIComponent(bucket2);
          var lr = await fetch(listUrl, {
            method: 'POST', cache: 'no-store',
            headers: { 'apikey': anon2, 'Authorization': restAuth2, 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefix: sf.replace(/\/$/, ''), limit: 200, offset: 0 })
          });
          if (lr.ok) {
            var lj = await lr.json();
            if (Array.isArray(lj)) {
              for (var li = 0; li < lj.length; li++) {
                var entry = lj[li];
                if (!entry || entry.type === 'folder') continue;
                var name = String(entry.name || '');
                if (!/\.(png|jpe?g|webp|gif|bmp|svg)$/i.test(name)) continue;
                var lower2 = name.toLowerCase();
                var isFullHint2 = (lower2.indexOf('full') >= 0 || lower2.indexOf('big') >= 0 || lower2.indexOf('large') >= 0 || lower2.indexOf('大图') >= 0);
                candidates.push({ path: sf + name, hint: isFullHint2 ? 'full' : 'style' });
              }
              console.log('[getStyleImagesForStyleNo] ③-extra REST list 子目录 ' + sf + ' 返回 ' + lj.length + ' 条，其中图片候选已追加');
            }
          } else {
            console.warn('[getStyleImagesForStyleNo] ③-extra REST list 子目录 ' + sf + ' 失败: HTTP ' + lr.status);
          }
        }
      } catch(_eList) {
        console.warn('[getStyleImagesForStyleNo] ③-extra REST list 款号文件夹异常:', _eList && _eList.message ? _eList.message : _eList);
      }
    }
    // 去重
    var seenCand = {};
    var uniqueCand = [];
    for (var ci = 0; ci < candidates.length; ci++) {
      if (!seenCand[candidates[ci].path]) {
        seenCand[candidates[ci].path] = 1;
        uniqueCand.push(candidates[ci]);
      }
    }
    console.log('[getStyleImagesForStyleNo] ③ 候选路径总数=' + uniqueCand.length + '，开始逐个 createSignedUrl…');
    var stylePath = '', styleSigned = null;
    var fullPath  = '', fullSigned  = null;
    // 批量试 sign：每个都通过 resolveImageUrl 走（含 sign 缓存、REST 回退）
    for (var cj = 0; cj < uniqueCand.length; cj++) {
      var cand = uniqueCand[cj];
      // 小节流，避免瞬间 100+ sign 请求
      if (cj > 0 && (cj % 8 === 0)) {
        await new Promise(function(res){ setTimeout(res, 25); });
      }
      var tryUrl = await resolveImageUrl(cand.path, { hintStyleNo: sn });
      if (!tryUrl) continue;
      // 为了防止"sign 成功但实际路径不存在 / 404"，这里多一层校验：
      //   用 fetch HEAD 预请求检测，如果 4xx 就跳过该候选
      try {
        var probe = await fetch(tryUrl.split('#')[0], { method: 'HEAD', cache: 'no-store', mode: 'cors' });
        if (!probe.ok) {
          console.log('[getStyleImagesForStyleNo] ③ sign 后 HEAD=' + probe.status + '，跳过假命中: ' + cand.path);
          continue;
        }
      } catch(_hp) {
        // CORS 不允许 HEAD 的情况，保守认为成功
      }
      if (cand.hint === 'full' && !fullPath) {
        fullPath = cand.path; fullSigned = tryUrl;
      } else if (!stylePath) {
        stylePath = cand.path; styleSigned = tryUrl;
      }
      if (stylePath && fullPath) break;
    }
    // 至少有一条命中就返回
    if (stylePath || fullPath) {
      if (window.StyleImgCache) {
        try {
          StyleImgCache.put(sn, {
            styleImg_path: stylePath,
            styleImg_name: (stylePath ? stylePath.split('/').pop() : ''),
            fullImg_path: fullPath,
            fullImg_name: (fullPath ? fullPath.split('/').pop() : '')
          });
        } catch(_eCache) {}
      }
      console.log('[getStyleImagesForStyleNo] ③✅ LIST 未命中，按候选路径直试成功：style=' + stylePath + '  full=' + fullPath);
      return {
        styleImg_path: stylePath,
        fullImg_path:  fullPath,
        styleImg_name: stylePath ? stylePath.split('/').pop() : '',
        fullImg_name:  fullPath  ? fullPath.split('/').pop()  : '',
        styleImg_signed: styleSigned,
        fullImg_signed:  fullSigned
      };
    }
    console.log('[getStyleImagesForStyleNo] ③❌ 候选路径直试未命中，将返回 null（说明桶里真的没有匹配图片）');
  } catch(_eFallback) {
    console.warn('[getStyleImagesForStyleNo] 直试候选路径兜底异常:', _eFallback);
  }

  return null;
};
