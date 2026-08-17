/* ===== 舜天汉唐服装外贸系统 - 共享JS ===== */

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
  },

  // 注入侧边栏
  injectSidebar(currentPage) {
    let menuHtml = '<div class="sidebar-logo"><span class="logo-icon">👔</span><span class="logo-text">舜天汉唐服装外贸系统</span></div>';
    menuHtml += '<div class="sidebar-menu">';
    this.menuItems.forEach(item => {
      if (item.group) {
        menuHtml += `<div class="sidebar-menu-group-title">${item.group}</div>`;
      } else {
        const active = item.key === currentPage ? ' active' : '';
        menuHtml += `<a href="${item.url}" class="sidebar-menu-item${active}"><span class="menu-icon">${item.icon}</span><span class="menu-text">${item.text}</span></a>`;
      }
    });
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
        document.querySelector('.sidebar')?.classList.toggle('collapsed');
        document.querySelector('.main-area')?.classList.toggle('expanded');
      });
    }
  },

  // 加载用户信息
  loadUserInfo() {
    const username = localStorage.getItem('username') || sessionStorage.getItem('username') || '管理员';
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

  // ===== 登录检查 =====
  checkLogin() {
    // localStorage 与 sessionStorage 双重检查（file:// 下某些浏览器会锁 localStorage）
    const isLoggedIn =
      localStorage.getItem('isLoggedIn') === 'true' ||
      sessionStorage.getItem('isLoggedIn') === 'true';
    const uid =
      localStorage.getItem('currentUserId') ||
      sessionStorage.getItem('currentUserId');
    if (!isLoggedIn || !uid) {
      // 清除残留后跳登录
      localStorage.removeItem('isLoggedIn');
      localStorage.removeItem('currentUserId');
      localStorage.removeItem('username');
      localStorage.removeItem('userRole');
      sessionStorage.removeItem('isLoggedIn');
      sessionStorage.removeItem('currentUserId');
      sessionStorage.removeItem('username');
      sessionStorage.removeItem('userRole');
      window.location.replace('login.html');
      return false;
    }
    // 会话级的 sessionStorage 同步到 localStorage（如果可用）
    if (sessionStorage.getItem('isLoggedIn') && !localStorage.getItem('isLoggedIn')) {
      try {
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('currentUserId', sessionStorage.getItem('currentUserId'));
        localStorage.setItem('username', sessionStorage.getItem('username'));
        localStorage.setItem('userRole', sessionStorage.getItem('userRole'));
      } catch (e) { /* ignore */ }
    }
    return true;
  },

  // ===== 退出登录 =====
  logout() {
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('username');
    localStorage.removeItem('userRole');
    localStorage.removeItem('currentUserId');
    sessionStorage.removeItem('isLoggedIn');
    sessionStorage.removeItem('username');
    sessionStorage.removeItem('userRole');
    sessionStorage.removeItem('currentUserId');
    window.location.replace('login.html');
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

  // ===== 获取当前登录用户 =====
  getCurrentUser() {
    const userId =
      localStorage.getItem('currentUserId') ||
      sessionStorage.getItem('currentUserId');
    if (!userId) return null;
    const users = this.store.get('users', []);
    return users.find(u => u.id === userId) || null;
  },

  // ===== 检查当前用户对某模块的权限 =====
  // 返回: 'write' | 'read' | 'none'
  getPermission(moduleKey) {
    const user = this.getCurrentUser();
    if (!user) return 'none';
    const roleKey = user.role || 'user';
    const roleDef = this.roles[roleKey];
    if (!roleDef) return 'none';
    // 管理员拥有全部读写权限
    if (roleDef.isAdmin) return 'write';
    // 检查模块级权限
    const perms = this.store.get('permissions', {});
    const modulePerm = perms[moduleKey];
    if (!modulePerm) return 'read'; // 无配置默认为只读
    const rolePerm = modulePerm[roleKey];
    if (!rolePerm) return 'read';
    return rolePerm; // 'write' | 'read' | 'none'
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
  enforcePagePermission(moduleKey) {
    const perm = this.getPermission(moduleKey);
    if (perm === 'none') {
      // 无权限：隐藏主内容，显示无权限提示
      const content = document.querySelector('.app-content');
      if (content) {
        content.innerHTML = `
          <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:60vh;color:#6b7280;">
            <div style="font-size:64px;margin-bottom:16px;">🔒</div>
            <div style="font-size:20px;font-weight:600;margin-bottom:8px;">无访问权限</div>
            <div style="font-size:14px;">您当前的角色无权访问此模块，请联系管理员开通权限</div>
          </div>`;
      }
      return false;
    }
    if (perm === 'read') {
      // 只读模式：隐藏所有操作按钮
      setTimeout(() => {
        document.querySelectorAll('.btn-primary, .btn-danger').forEach(btn => {
          if (btn.closest('.table-toolbar-right') || btn.onclick?.toString().includes('delete') || btn.onclick?.toString().includes('openModal')) {
            // 保留新增/编辑/删除按钮但禁用它们
          }
        });
        // 全局标记只读模式
        document.body.classList.add('readonly-mode');
      }, 100);
      this.toast('当前为只读模式，如需修改请联系管理员', 'info', 3000);
    }
    return true;
  }
};

// ===== 初始化数据结构 =====
App.initSampleData = function() {
  const DATA_VERSION = '5'; // 版本号变更时强制重置数据
  const currentVersion = localStorage.getItem('dataVersion');

  // 版本变更或首次运行：重置业务样本数据
  if (currentVersion !== DATA_VERSION) {
    App.store.set('customers', []);
    App.store.set('styles', []);
    App.store.set('orders', []);
    App.store.set('fabrics', []);
    App.store.set('accessories', []);
    App.store.set('samples', []);
    App.store.set('feedbacks', []);
    App.store.set('productions', []);
    App.store.set('washes', []);
    App.store.set('shippings', []);
    App.store.set('invoices', []);
    App.store.set('payments', []);
    App.store.set('collections', []);
    App.store.set('contacts', []);
    localStorage.removeItem('favoriteContacts');
    localStorage.setItem('dataVersion', DATA_VERSION);
  }

  // 以下无论版本号都确保存在（修复"版本已更新但用户未写入"导致无法登录的问题）
  // 初始化用户系统
  const existingUsers = App.store.get('users', null);
  if (!existingUsers || existingUsers.length === 0) {
    App.store.set('users', [
      { id: 'U-0001', username: 'admin', password: '123456', role: 'admin', description: '系统管理员', status: 'active', createDate: new Date().toISOString().slice(0,10) },
      { id: 'U-0002', username: 'merchandiser', password: '123456', role: 'merchandiser', description: '业务跟单员', status: 'active', createDate: new Date().toISOString().slice(0,10) },
      { id: 'U-0003', username: 'purchaser', password: '123456', role: 'purchaser', description: '面辅料采购员', status: 'active', createDate: new Date().toISOString().slice(0,10) },
      { id: 'U-0004', username: 'designer', password: '123456', role: 'designer', description: '样衣师', status: 'active', createDate: new Date().toISOString().slice(0,10) },
      { id: 'U-0005', username: 'qc', password: '123456', role: 'qc', description: '品控员', status: 'active', createDate: new Date().toISOString().slice(0,10) },
      { id: 'U-0006', username: 'finance', password: '123456', role: 'finance', description: '财务专员', status: 'active', createDate: new Date().toISOString().slice(0,10) },
      { id: 'U-0007', username: 'documentary', password: '123456', role: 'documentary', description: '单证员', status: 'active', createDate: new Date().toISOString().slice(0,10) },
      { id: 'U-0008', username: 'manager', password: '123456', role: 'manager', description: '管理层', status: 'active', createDate: new Date().toISOString().slice(0,10) },
      { id: 'U-0009', username: 'user', password: '123456', role: 'user', description: '普通用户', status: 'active', createDate: new Date().toISOString().slice(0,10) },
    ]);
  }

  // 初始化模块权限配置（各角色默认对各模块的权限）
  const existingPerms = App.store.get('permissions', null);
  if (!existingPerms || Object.keys(existingPerms).length === 0) {
    const defaultPerms = {
      // 角色对各模块的默认权限：write=读写, read=只读, none=无权限
      order:        { merchandiser: 'write', purchaser: 'read', designer: 'read', qc: 'read', finance: 'read', documentary: 'write', manager: 'write', user: 'read' },
      fabric:       { merchandiser: 'read', purchaser: 'write', designer: 'read', qc: 'read', finance: 'read', documentary: 'read', manager: 'write', user: 'read' },
      accessory:    { merchandiser: 'read', purchaser: 'write', designer: 'read', qc: 'read', finance: 'read', documentary: 'read', manager: 'write', user: 'read' },
      wash:         { merchandiser: 'write', purchaser: 'read', designer: 'write', qc: 'read', finance: 'none', documentary: 'read', manager: 'write', user: 'read' },
      sample:       { merchandiser: 'write', purchaser: 'read', designer: 'write', qc: 'read', finance: 'none', documentary: 'read', manager: 'write', user: 'read' },
      feedback:     { merchandiser: 'write', purchaser: 'read', designer: 'read', qc: 'read', finance: 'none', documentary: 'read', manager: 'write', user: 'read' },
      production:   { merchandiser: 'read', purchaser: 'read', designer: 'read', qc: 'write', finance: 'read', documentary: 'read', manager: 'write', user: 'read' },
      shipping:     { merchandiser: 'write', purchaser: 'read', designer: 'none', qc: 'read', finance: 'read', documentary: 'write', manager: 'write', user: 'read' },
      express:      { merchandiser: 'write', purchaser: 'write', designer: 'read', qc: 'read', finance: 'read', documentary: 'write', manager: 'write', user: 'read' },
      finance:      { merchandiser: 'read', purchaser: 'read', designer: 'none', qc: 'none', finance: 'write', documentary: 'read', manager: 'write', user: 'read' },
      contacts:     { merchandiser: 'write', purchaser: 'write', designer: 'read', qc: 'read', finance: 'read', documentary: 'write', manager: 'write', user: 'read' },
      maintenance:  { merchandiser: 'read', purchaser: 'write', designer: 'read', qc: 'read', finance: 'read', documentary: 'read', manager: 'write', user: 'read' },
      settings:     { merchandiser: 'none', purchaser: 'none', designer: 'none', qc: 'none', finance: 'none', documentary: 'none', manager: 'read', user: 'none' },
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
