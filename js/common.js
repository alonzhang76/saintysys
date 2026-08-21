/* ===== 舜天汉唐服装外贸系统 - 共享JS ===== */

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
  if (adminEmails.indexOf(email) < 0 && window.App) {
    try {
      var localUsers = App.store.get('users', []);
      var emailLower = (email || '').toLowerCase().trim();
      if (emailLower) {
        var localUser = localUsers.find(function(u) {
          return u.email && u.email.toLowerCase().trim() === emailLower;
        });
        if (localUser && localUser.role) {
          role = localUser.role;
          console.log('[common] 本地用户匹配成功: username=' + localUser.username + ', email=' + localUser.email + ', role=' + role);
        } else {
          console.log('[common] 本地用户未匹配: email=' + emailLower + ', 本地用户数=' + localUsers.length);
        }
      }
    } catch(e) {
      console.warn('[common] 读取本地 users 失败:', e);
    }
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
/* 原理：以登录时的devicePixelRatio为基准，对比当前DPR，若差异超过5%则用CSS zoom反向校正 */
(function() {
  var currentDPR = window.devicePixelRatio;
  var refDPR = localStorage.getItem('refDPR');

  if (!refDPR) {
    localStorage.setItem('refDPR', currentDPR.toString());
  } else {
    refDPR = parseFloat(refDPR);
    if (refDPR > 0) {
      var zoomRatio = currentDPR / refDPR;
      if (Math.abs(zoomRatio - 1) > 0.05) {
        document.documentElement.style.zoom = (1 / zoomRatio).toString();
      } else {
        document.documentElement.style.zoom = '';
      }
    }
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
    { key: 'fabric', text: '面里衬管理', icon: '🧵', url: 'fabric.html' },
    { key: 'accessory', text: '辅料管理', icon: '🔩', url: 'accessory.html' },
    { group: '样衣与意见' },
    { key: 'wash', text: '水洗管理', icon: '🌊', url: 'wash.html' },
    { key: 'sample', text: '样衣管理', icon: '✂️', url: 'sample.html' },
    { key: 'feedback', text: '客户意见', icon: '💬', url: 'feedback.html' },
    { group: '生产与财务' },
    { key: 'production', text: '生产管理', icon: '🏭', url: 'production.html' },
    { key: 'shipping', text: '出运管理', icon: '🚢', url: 'shipping.html' },
    { key: 'express', text: '寄件管理', icon: '📦', url: 'express.html' },
    { key: 'finance', text: '财务管理', icon: '💰', url: 'finance.html' },
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
    let menuHtml = '<div class="sidebar-logo"><span class="logo-icon">👔</span><span class="logo-text">舜天汉唐服装外贸系统</span></div>';
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
    }
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
    const keys = ['styles', 'orders', 'fabrics', 'accessories', 'samples', 'feedbacks', 'productions', 'invoices', 'payments', 'collections', 'contacts', 'customers', 'suppliers', 'favoriteContacts', 'washes', 'shippings', 'express_delivery_data_v2', 'pl_records_v1'];
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
    admin:       { name: '系统管理员', isAdmin: true },
    merchandiser:{ name: '业务跟单员', isAdmin: false },
    purchaser:   { name: '面辅料采购员', isAdmin: false },
    designer:    { name: '样衣师', isAdmin: false },
    qc:          { name: '品控员', isAdmin: false },
    finance:     { name: '财务专员', isAdmin: false },
    documentary: { name: '单证员', isAdmin: false },
    manager:     { name: '管理层', isAdmin: false },
    user:        { name: '普通用户', isAdmin: false },
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
    fabric:       '面里衬管理',
    accessory:    '辅料管理',
    wash:         '水洗管理',
    sample:       '样衣管理',
    feedback:     '客户意见',
    production:   '生产管理',
    shipping:     '出运管理',
    express:      '寄件管理',
    finance:      '财务管理',
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
      const rolePerm = modulePerm[roleKey];
      if (rolePerm === 'write' || rolePerm === 'read' || rolePerm === 'none' || rolePerm === 'hidden') {
        console.log('[权限] module=' + moduleKey + ', role=' + roleKey + ', user=' + user.email + ' → ' + rolePerm + ' (来自permissions矩阵)');
        return rolePerm;
      }
    }

    // 兜底：如果 permissions key 中无此模块配置，再检查 _userModulePerms
    const userPerms = this._userModulePerms || {};
    if (userPerms[moduleKey]) {
      const p = userPerms[moduleKey];
      if (p === 'write' || p === 'read' || p === 'none' || p === 'hidden') {
        console.log('[权限] module=' + moduleKey + ', role=' + roleKey + ', user=' + user.email + ' → ' + p + ' (来自_userModulePerms兜底)');
        return p;
      }
    }

    // 无配置默认为读写
    if (!modulePerm) {
      console.log('[权限] module=' + moduleKey + ', role=' + roleKey + ', user=' + user.email + ' → write (无配置默认)');
      return 'write';
    }
    const rolePerm = modulePerm[roleKey];
    if (!rolePerm) {
      console.log('[权限] module=' + moduleKey + ', role=' + roleKey + ', user=' + user.email + ' → write (角色无配置默认)');
      return 'write';
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

// ===== 初始化数据结构 =====
App.initSampleData = function() {
  const DATA_VERSION = '9'; // v9: 重置用户列表为5个新用户
  const currentVersion = localStorage.getItem('dataVersion');
  const isVersionChanged = currentVersion !== DATA_VERSION;

  // 版本变更：清理旧用户和权限数据
  if (isVersionChanged) {
    if (window.SupabaseStore) {
      window.SupabaseStore.remove('permissions');
      window.SupabaseStore.remove('users');
    }
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

  // 初始化模块权限配置（各角色默认对各模块的权限）
  const existingPerms = App.store.get('permissions', null);
  if (!existingPerms || Object.keys(existingPerms).length === 0) {
    const defaultPerms = {
      // 角色对各模块的默认权限：write=读写, read=只读, none=无权限
      // 注：admin 角色在 getPermission 中直接返回 write，不需要在表中配置
      order:        { merchandiser: 'write', purchaser: 'read', designer: 'read', qc: 'read', finance: 'read', documentary: 'write', manager: 'write', user: 'write' },
      fabric:       { merchandiser: 'read', purchaser: 'write', designer: 'read', qc: 'read', finance: 'read', documentary: 'read', manager: 'write', user: 'write' },
      accessory:    { merchandiser: 'read', purchaser: 'write', designer: 'read', qc: 'read', finance: 'read', documentary: 'read', manager: 'write', user: 'write' },
      wash:         { merchandiser: 'write', purchaser: 'read', designer: 'write', qc: 'read', finance: 'none', documentary: 'read', manager: 'write', user: 'write' },
      sample:       { merchandiser: 'write', purchaser: 'read', designer: 'write', qc: 'read', finance: 'none', documentary: 'read', manager: 'write', user: 'write' },
      feedback:     { merchandiser: 'write', purchaser: 'read', designer: 'read', qc: 'read', finance: 'none', documentary: 'read', manager: 'write', user: 'write' },
      production:   { merchandiser: 'read', purchaser: 'read', designer: 'read', qc: 'write', finance: 'read', documentary: 'read', manager: 'write', user: 'write' },
      shipping:     { merchandiser: 'write', purchaser: 'read', designer: 'none', qc: 'read', finance: 'read', documentary: 'write', manager: 'write', user: 'write' },
      express:      { merchandiser: 'write', purchaser: 'write', designer: 'read', qc: 'read', finance: 'read', documentary: 'write', manager: 'write', user: 'write' },
      finance:      { merchandiser: 'read', purchaser: 'read', designer: 'none', qc: 'none', finance: 'write', documentary: 'read', manager: 'write', user: 'write' },
      contacts:     { merchandiser: 'write', purchaser: 'write', designer: 'read', qc: 'read', finance: 'read', documentary: 'write', manager: 'write', user: 'write' },
      maintenance:  { merchandiser: 'read', purchaser: 'write', designer: 'read', qc: 'read', finance: 'read', documentary: 'read', manager: 'write', user: 'write' },
      settings:     { merchandiser: 'none', purchaser: 'none', designer: 'none', qc: 'none', finance: 'none', documentary: 'none', manager: 'read', user: 'write' },
    };
    App.store.set('permissions', defaultPerms);
  }

  // 迁移：为已有权限配置补充新模块权限（不重置已有数据）
  const perms = App.store.get('permissions', {});
  const newModulePerms = {
    express: { merchandiser: 'write', purchaser: 'write', designer: 'read', qc: 'read', finance: 'read', documentary: 'write', manager: 'write', user: 'read' },
  };
  let permChanged = false;
  Object.keys(newModulePerms).forEach(key => {
    if (!perms[key]) { perms[key] = newModulePerms[key]; permChanged = true; }
  });
  if (permChanged) App.store.set('permissions', perms);
};
