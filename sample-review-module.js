// ===== SampleReview Module (integrated from comments.html) =====
(function(ns){
'use strict';

// ===== Safe Storage =====
var safeStorage = (function() {
  var mem = {};
  try { var t = '__sr_test__'; localStorage.setItem(t, '1'); localStorage.removeItem(t); return localStorage; }
  catch(e) { return { getItem: function(k) { return mem[k] || null; }, setItem: function(k, v) { mem[k] = v; }, removeItem: function(k) { delete mem[k]; } }; }
})();

// ===== State =====
var records = [];
var comments = [];
var materials = [];
var currentFilter = 'all';
var commentCounter = 0;
var editingRecordId = null;
var sizeTableData = null;
var container = null;
var annotState = null;

var CAT_NAMES = {
  design:'设计', dim:'尺寸', work:'做工', fabric:'面料',
  acc:'辅料', pack:'包装', wash:'水洗', test:'测试要求', other:'其他'
};
var CAT_COLORS = {design:'#3b82f6',dim:'#10b981',work:'#f59e0b',fabric:'#8b5cf6',acc:'#78350f',pack:'#475569',wash:'#0891b2',test:'#db2777',other:'#9ca3af'};
var CAT_LOC_LABELS = {pack:'内包装/外包装',wash:'面料/成衣'};

function getLocLabel(cat) { return CAT_LOC_LABELS[cat] || '部位/位置'; }

// ===== Utility Functions =====
function esc(s) {
  if (window.App && window.App.utils && window.App.utils.escapeHtml) {
    return window.App.utils.escapeHtml(s);
  }
  return (s || '').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escBR(s) { return esc(s).replace(/\n/g,'<br>'); }

function formatDate(d) {
  try {
    var dt = new Date(d);
    return dt.getFullYear() + '-' + String(dt.getMonth()+1).padStart(2,'0') + '-' + String(dt.getDate()).padStart(2,'0');
  } catch(e) { return d; }
}

function imgSrc(img) { return typeof img === 'string' ? img : img.src; }
function imgPrintSize(img) { return typeof img === 'object' && img.printSize ? img.printSize : 'full'; }

// ===== Container-Scoped Helpers =====
function $(id) {
  return container ? container.querySelector('#' + id) : document.getElementById(id);
}

function $$(sel) {
  return container ? container.querySelectorAll(sel) : document.querySelectorAll(sel);
}

// ===== Toast =====
function showToast(msg, type) {
  var toast = $('sr-toast');
  if (!toast) return;
  toast.textContent = msg;
  toast.className = type || 'info';
  toast.classList.add('show');
  setTimeout(function() { toast.classList.remove('show'); }, 2500);
}

// ===== Tab Switching =====
function switchTab(name) {
  var tabs = ['entry','size','info'];
  $$('.sr-tab-btn').forEach(function(b, i) {
    b.classList.toggle('active', i === tabs.indexOf(name));
  });
  $$('.sr-tab-content').forEach(function(t) { t.classList.remove('active'); });
  var tabEl = $('sr-tab-' + name);
  if (tabEl) tabEl.classList.add('active');
  if (name === 'info') renderRecords();
}

// ===== Material Table =====
function renderMatTable() {
  var tbody = $('sr-matBody');
  if (!tbody) return;
  tbody.innerHTML = materials.map(function(m, i) {
    return '<tr>' +
      '<td><input value="' + esc(m['材料']||'') + '" data-sr-mat="' + i + '" data-field="材料"></td>' +
      '<td><select data-sr-mat="' + i + '" data-field="大货标准">' +
        '<option value=""></option>' +
        '<option value="大货标准"' + (m['大货标准']==='大货标准'?' selected':'') + '>大货标准</option>' +
        '<option value="代用"' + (m['大货标准']==='代用'?' selected':'') + '>代用</option>' +
      '</select></td>' +
      '<td><input value="' + esc(m['规格']||'') + '" data-sr-mat="' + i + '" data-field="规格"></td>' +
      '<td><input value="' + esc(m['颜色']||'') + '" data-sr-mat="' + i + '" data-field="颜色"></td>' +
      '<td><input value="' + esc(m['单耗']||'') + '" data-sr-mat="' + i + '" data-field="单耗"></td>' +
      '<td><input value="' + esc(m['数量']||'') + '" data-sr-mat="' + i + '" data-field="数量"></td>' +
      '<td><input value="' + esc(m['备用数']||'') + '" data-sr-mat="' + i + '" data-field="备用数"></td>' +
      '<td><input value="' + esc(m['备注']||'') + '" data-sr-mat="' + i + '" data-field="备注"></td>' +
      '<td style="text-align:center;"><button class="sr-mat-del" data-sr-mat-del="' + i + '">×</button></td>' +
    '</tr>';
  }).join('');
}

function addMatRow() {
  materials.push({'材料':'','大货标准':'','规格':'','颜色':'','单耗':'','数量':'','备用数':'','备注':''});
  renderMatTable();
}

function deleteMatRow(idx) {
  materials.splice(idx, 1);
  renderMatTable();
}

function updateMat(idx, field, val) {
  if (materials[idx]) materials[idx][field] = val;
}

function collectMaterials() {
  return materials.filter(function(m) { return Object.values(m).some(function(v) { return v && v.trim(); }); });
}

// ===== Comments =====
function addComment() {
  var c = {
    id: 'c' + (++commentCounter),
    category: currentFilter !== 'all' ? currentFilter : 'work',
    location: '',
    severity: 'medium',
    description: '',
    suggestion: '',
    images: []
  };
  comments.unshift(c);
  renderComments();
}

function deleteComment(id) {
  comments = comments.filter(function(c) { return c.id !== id; });
  renderComments();
}

function updateComment(id, field, val) {
  var c = comments.find(function(c) { return c.id === id; });
  if (c) c[field] = val;
}

function deleteImage(cid, idx) {
  var c = comments.find(function(c) { return c.id === cid; });
  if (c) { c.images.splice(idx, 1); renderComments(); }
}

function setImagePrintSize(cid, idx, size) {
  var c = comments.find(function(c) { return c.id === cid; });
  if (!c || !c.images[idx]) return;
  var img = c.images[idx];
  if (typeof img === 'string') c.images[idx] = { src: img, printSize: size };
  else img.printSize = size;
}

function filterCategory(cat, el) {
  currentFilter = cat;
  $$('.sr-cat-tab').forEach(function(t) { t.classList.remove('active'); });
  if (el) el.classList.add('active');
  renderComments();
}

function renderComments() {
  var list = $('sr-commentList');
  if (!list) return;
  var filtered = currentFilter === 'all' ? comments : comments.filter(function(c) { return c.category === currentFilter; });
  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);"><div style="font-size:36px;margin-bottom:8px;">📝</div><p>暂无意见，点击"新增意见"添加</p></div>';
    return;
  }
  list.innerHTML = filtered.map(function(c) {
    var isSimple = (c.category === 'test' || c.category === 'other');
    var html = '<div class="comment-card" data-id="' + c.id + '">';
    html += '<span class="cat-badge" data-cat="' + c.category + '">' + CAT_NAMES[c.category] + '</span>';
    html += '<div class="comment-grid"' + (isSimple ? ' style="grid-template-columns:1fr;"' : '') + '>';
    if (!isSimple) {
      html += '<div class="comment-field">';
      html += '<label>' + getLocLabel(c.category) + '</label>';
      html += '<input value="' + esc(c.location) + '" data-sr-cmt="' + c.id + '" data-field="location">';
      html += '</div>';
    }
    html += '<div class="comment-field">';
    html += '<label>严重程度</label>';
    html += '<select data-sr-cmt="' + c.id + '" data-field="severity">';
    html += '<option value="high"' + (c.severity==='high'?' selected':'') + '>高 — 必须修改</option>';
    html += '<option value="medium"' + (c.severity==='medium'?' selected':'') + '>中 — 建议修改</option>';
    html += '<option value="low"' + (c.severity==='low'?' selected':'') + '>低 — 可选修改</option>';
    html += '</select>';
    html += '</div>';
    if (!isSimple) {
      html += '<div class="comment-field full">';
      html += '<label>问题描述</label>';
      html += '<textarea data-sr-cmt="' + c.id + '" data-field="description">' + esc(c.description) + '</textarea>';
      html += '</div>';
    }
    html += '<div class="comment-field full">';
    html += '<label>' + (isSimple ? '说明' : '意见') + '</label>';
    html += '<textarea data-sr-cmt="' + c.id + '" data-field="suggestion">' + esc(c.suggestion) + '</textarea>';
    html += '</div>';
    html += '</div>';
    html += '<div class="comment-images" id="sr-imgs-' + c.id + '">';
    html += c.images.map(function(img, i) {
      var src = imgSrc(img);
      var psize = imgPrintSize(img);
      return '<div class="comment-img-wrap">' +
        '<img src="' + src + '" data-sr-img-cid="' + c.id + '" data-sr-img-idx="' + i + '">' +
        '<button class="img-del" data-sr-img-del-cid="' + c.id + '" data-sr-img-del-idx="' + i + '">×</button>' +
        '<button class="img-edit" data-sr-img-edit-cid="' + c.id + '" data-sr-img-edit-idx="' + i + '">标注</button>' +
        '<select class="img-print-size" data-sr-img-size-cid="' + c.id + '" data-sr-img-size-idx="' + i + '">' +
          '<option value="full"' + (psize==='full'?' selected':'') + '>铺满</option>' +
          '<option value="half"' + (psize==='half'?' selected':'') + '>半宽</option>' +
          '<option value="third"' + (psize==='third'?' selected':'') + '>三分之一</option>' +
          '<option value="quarter"' + (psize==='quarter'?' selected':'') + '>四分之一</option>' +
        '</select>' +
      '</div>';
    }).join('');
    html += '</div>';
    html += '<div class="comment-actions">';
    html += '<button class="btn btn-outline btn-sm" data-sr-add-img="' + c.id + '">📷 添加图片</button>';
    html += '<button class="btn btn-danger btn-sm" data-sr-del-cmt="' + c.id + '">🗑 删除</button>';
    html += '</div>';
    html += '</div>';
    return html;
  }).join('');
}

// ===== Image Annotation =====
function openAnnotModal(cid, imgIdx) {
  annotState.editingCommentId = cid;
  annotState.editingImageIdx = imgIdx;
  annotState.shapes = [];
  annotState.img = null;
  var wrap = $('sr-annotCanvasWrap');
  if (wrap) wrap.innerHTML = '<div class="annot-upload-prompt">请先上传图片，然后在图片上添加标注</div>';
  annotState.canvas = null;
  annotState.ctx = null;
  if (imgIdx >= 0) {
    var c = comments.find(function(c) { return c.id === cid; });
    if (c && c.images[imgIdx]) {
      var img = new Image();
      img.onload = function() {
        var maxW = wrap.clientWidth;
        var maxH = wrap.clientHeight;
        var ratio = Math.min(maxW / img.width, maxH / img.height, 1);
        var w = Math.round(img.width * ratio), h = Math.round(img.height * ratio);
        wrap.innerHTML = '';
        var canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.style.maxWidth = '100%';
        wrap.appendChild(canvas);
        annotState.canvas = canvas;
        annotState.ctx = canvas.getContext('2d');
        annotState.shapes = [{type:'image', img: img, x: 0, y: 0, w: w, h: h}];
        drawCanvas();
        canvas.onmousedown = onAnnotMouseDown;
        canvas.onmousemove = onAnnotMouseMove;
        canvas.onmouseup = onAnnotMouseUp;
        canvas.onmouseleave = onAnnotMouseUp;
        canvas.onwheel = onAnnotWheel;
      };
      img.src = imgSrc(c.images[imgIdx]);
    }
  }
  var modal = $('sr-annotModal');
  if (modal) modal.classList.add('show');
}

function closeAnnotModal() {
  var modal = $('sr-annotModal');
  if (modal) modal.classList.remove('show');
}

function setAnnotTool(tool, el) {
  annotState.tool = tool;
  annotState.movingShapeIdx = -1;
  $$('.annot-tool[data-tool]').forEach(function(t) { t.classList.remove('active'); });
  if (el) el.classList.add('active');
  if (annotState.canvas) annotState.canvas.style.cursor = tool === 'move' ? 'move' : 'crosshair';
  drawCanvas();
}

function autoSwitchToMove() {
  var moveBtn = $$('.annot-tool[data-tool="move"]');
  if (moveBtn.length > 0) setAnnotTool('move', moveBtn[0]);
}

function loadAnnotImage(event) {
  var files = Array.from(event.target.files);
  if (!files.length) return;
  var wrap = $('sr-annotCanvasWrap');
  var maxW = wrap.clientWidth;
  var maxH = wrap.clientHeight;
  var gap = 10;
  var imgs = [];
  var loaded = 0;
  files.forEach(function(file, fi) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload = function() {
        imgs[fi] = img;
        loaded++;
        if (loaded === files.length) {
          var targetH = Math.min.apply(null, imgs.map(function(im) { return im.height; }));
          var scaled = imgs.map(function(im) {
            var ratio = targetH / im.height;
            return { img: im, w: Math.round(im.width * ratio), h: Math.round(targetH) };
          });
          var totalW = scaled.reduce(function(s, im) { return s + im.w; }, 0) + gap * (scaled.length - 1);
          if (totalW > maxW && scaled.length > 1) {
            var sf = maxW / totalW;
            scaled.forEach(function(im) { im.w = Math.round(im.w * sf); im.h = Math.round(im.h * sf); });
            totalW = scaled.reduce(function(s, im) { return s + im.w; }, 0) + gap * (scaled.length - 1);
          }
          var cw = Math.max(totalW, scaled[0].w);
          var ch = scaled[0].h;
          wrap.innerHTML = '';
          var canvas = document.createElement('canvas');
          canvas.width = cw; canvas.height = ch;
          canvas.style.maxWidth = '100%';
          wrap.appendChild(canvas);
          annotState.canvas = canvas;
          annotState.ctx = canvas.getContext('2d');
          annotState.img = null;
          annotState.shapes = [];
          var xPos = 0;
          scaled.forEach(function(im) {
            annotState.shapes.push({type:'image', img: im.img, x: xPos, y: 0, w: im.w, h: im.h});
            xPos += im.w + gap;
          });
          drawCanvas();
          canvas.onmousedown = onAnnotMouseDown;
          canvas.onmousemove = onAnnotMouseMove;
          canvas.onmouseup = onAnnotMouseUp;
          canvas.onmouseleave = onAnnotMouseUp;
          canvas.onwheel = onAnnotWheel;
          if (files.length > 1) {
            showToast('已加载 ' + files.length + ' 张图片，可使用移动工具拖动换位', 'success');
          }
        }
      };
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
  event.target.value = '';
}

function setupAnnotCanvas(img) {
  var wrap = $('sr-annotCanvasWrap');
  wrap.innerHTML = '';
  var maxW = wrap.clientWidth;
  var maxH = wrap.clientHeight;
  var w = img.width, h = img.height;
  var ratio = Math.min(maxW / w, maxH / h, 1);
  w = Math.round(w * ratio); h = Math.round(h * ratio);
  var canvas = document.createElement('canvas');
  canvas.width = w; canvas.height = h;
  wrap.appendChild(canvas);
  annotState.canvas = canvas;
  annotState.ctx = canvas.getContext('2d');
  drawCanvas();
  canvas.onmousedown = onAnnotMouseDown;
  canvas.onmousemove = onAnnotMouseMove;
  canvas.onmouseup = onAnnotMouseUp;
  canvas.onmouseleave = onAnnotMouseUp;
  canvas.onwheel = onAnnotWheel;
}

function getCanvasPos(e) {
  var rect = annotState.canvas.getBoundingClientRect();
  var scaleX = annotState.canvas.width / rect.width;
  var scaleY = annotState.canvas.height / rect.height;
  return { x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY };
}

function hitTestShape(s, px, py) {
  var tol = 8;
  var rot = s.rotation || 0;
  if (rot !== 0) {
    var c = getShapeCenter(s);
    var rad = -rot * Math.PI / 180;
    var dx = px - c.x, dy = py - c.y;
    px = c.x + dx * Math.cos(rad) - dy * Math.sin(rad);
    py = c.y + dx * Math.sin(rad) + dy * Math.cos(rad);
  }
  if (['arrow','dashSingle','dashDouble','doubleSolid','solidLine','xLine','dimLine'].indexOf(s.type) >= 0) {
    return distToSeg(px, py, s.x1, s.y1, s.x2, s.y2) < tol + (s.lineWidth || 2);
  }
  if (s.type === 'curve' || s.type === 'curveDashed' || s.type === 'curveSolid') {
    var steps = 20;
    for (var i = 0; i <= steps; i++) {
      var t = i / steps;
      var mt = 1 - t;
      var bx = mt * mt * s.x1 + 2 * mt * t * s.cx + t * t * s.x2;
      var by = mt * mt * s.y1 + 2 * mt * t * s.cy + t * t * s.y2;
      if (Math.hypot(px - bx, py - by) < tol + (s.lineWidth || 2)) return true;
    }
    return false;
  }
  if (['rect','fillRect','dashRect','mosaic','image','textBox','text','strikeText','callout'].indexOf(s.type) >= 0) {
    var x = Math.min(s.x, s.x + (s.w||0)), y = Math.min(s.y, s.y + (s.h||0));
    var w = Math.abs(s.w||0), h = Math.abs(s.h||0);
    return px >= x - tol && px <= x + w + tol && py >= y - tol && py <= y + h + tol;
  }
  if (s.type === 'circle') {
    return Math.abs(Math.hypot(px - s.x, py - s.y) - s.r) < tol;
  }
  return false;
}

function distToSeg(px, py, x1, y1, x2, y2) {
  var dx = x2 - x1, dy = y2 - y1;
  var len2 = dx * dx + dy * dy;
  if (len2 === 0) return Math.hypot(px - x1, py - y1);
  var t = ((px - x1) * dx + (py - y1) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

function moveShape(s, dx, dy) {
  if (s.x1 !== undefined) { s.x1 += dx; s.y1 += dy; s.x2 += dx; s.y2 += dy; }
  if (s.cx !== undefined) { s.cx += dx; s.cy += dy; }
  else if (s.x !== undefined && s.x1 === undefined) { s.x += dx; s.y += dy; }
  if (s.tipX !== undefined) { s.tipX += dx; s.tipY += dy; }
}

function scaleShape(s, factor) {
  if (s.x1 !== undefined) {
    var cx = (s.x1 + s.x2) / 2, cy = (s.y1 + s.y2) / 2;
    s.x1 = cx + (s.x1 - cx) * factor;
    s.y1 = cy + (s.y1 - cy) * factor;
    s.x2 = cx + (s.x2 - cx) * factor;
    s.y2 = cy + (s.y2 - cy) * factor;
    if (s.cx !== undefined) {
      s.cx = cx + (s.cx - cx) * factor;
      s.cy = cy + (s.cy - cy) * factor;
    }
  } else if (s.w !== undefined) {
    var cx2 = s.x + s.w / 2, cy2 = s.y + s.h / 2;
    s.w *= factor; s.h *= factor;
    s.x = cx2 - s.w / 2; s.y = cy2 - s.h / 2;
    if (s.tipX !== undefined) {
      s.tipX = cx2 + (s.tipX - cx2) * factor;
      s.tipY = cy2 + (s.tipY - cy2) * factor;
    }
  } else if (s.r !== undefined) {
    s.r = Math.max(2, s.r * factor);
  }
  if (s.lineWidth !== undefined && s.type !== 'mosaic') {
    s.lineWidth = Math.max(1, Math.min(20, s.lineWidth * factor));
  }
  if (s.fontSize !== undefined) {
    s.fontSize = Math.max(8, Math.min(72, s.fontSize * factor));
  }
}

function onAnnotWheel(e) {
  if (annotState.tool !== 'move' || annotState.movingShapeIdx < 0) return;
  e.preventDefault();
  var factor = e.deltaY < 0 ? 1.1 : 0.9;
  scaleShape(annotState.shapes[annotState.movingShapeIdx], factor);
  drawCanvas();
}

function getShapeCenter(s) {
  if (s.x1 !== undefined) return { x: (s.x1 + s.x2) / 2, y: (s.y1 + s.y2) / 2 };
  if (s.w !== undefined) return { x: s.x + s.w / 2, y: s.y + s.h / 2 };
  if (s.r !== undefined) return { x: s.x, y: s.y };
  if (s.x !== undefined) return { x: s.x, y: s.y };
  return { x: 0, y: 0 };
}

function rotateShape(s, deltaDeg) {
  s.rotation = (s.rotation || 0) + deltaDeg;
}

function rotateSelected(deltaDeg) {
  if (annotState.tool !== 'move' || annotState.movingShapeIdx < 0) {
    showToast('请先用移动工具选中标注', 'info');
    return;
  }
  var s = annotState.shapes[annotState.movingShapeIdx];
  if (s.type === 'mosaic') {
    showToast('马赛克不支持旋转', 'info');
    return;
  }
  rotateShape(s, deltaDeg);
  drawCanvas();
  var deg = ((s.rotation % 360) + 360) % 360;
  showToast('已旋转至 ' + Math.round(deg) + '°', 'success');
}

function insertImage(event) {
  var file = event.target.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var img = new Image();
    img.onload = function() {
      var cw = annotState.canvas.width, ch = annotState.canvas.height;
      var w = img.width, h = img.height;
      var maxDim = Math.min(cw, ch) * 0.4;
      var ratio = Math.min(maxDim / w, maxDim / h, 1);
      w = Math.round(w * ratio); h = Math.round(h * ratio);
      annotState.shapes.push({type:'image', img: img, x:(cw-w)/2, y:(ch-h)/2, w: w, h: h});
      drawCanvas();
      showToast('图片已插入，切换到移动工具后可拖动、滚轮缩放、方向键旋转', 'success');
    };
    img.src = e.target.result;
  };
  reader.readAsDataURL(file);
  event.target.value = '';
}

function getShapeBounds(s) {
  if (s.type === 'curve' || s.type === 'curveDashed' || s.type === 'curveSolid') {
    var minX = Math.min(s.x1, s.x2, s.cx) - 4;
    var minY = Math.min(s.y1, s.y2, s.cy) - 4;
    var maxX = Math.max(s.x1, s.x2, s.cx) + 4;
    var maxY = Math.max(s.y1, s.y2, s.cy) + 4;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  if (s.x1 !== undefined) {
    return { x: Math.min(s.x1, s.x2) - 4, y: Math.min(s.y1, s.y2) - 4, w: Math.abs(s.x2 - s.x1) + 8, h: Math.abs(s.y2 - s.y1) + 8 };
  }
  if (s.w !== undefined) {
    return { x: Math.min(s.x, s.x + s.w) - 4, y: Math.min(s.y, s.y + s.h) - 4, w: Math.abs(s.w) + 8, h: Math.abs(s.h) + 8 };
  }
  if (s.r !== undefined) {
    return { x: s.x - s.r - 4, y: s.y - s.r - 4, w: s.r * 2 + 8, h: s.r * 2 + 8 };
  }
  return null;
}

function onAnnotMouseDown(e) {
  if (!annotState.canvas) return;
  var pos = getCanvasPos(e);
  if (annotState.tool === 'move') {
    if (annotState.movingShapeIdx >= 0) {
      var sel = annotState.shapes[annotState.movingShapeIdx];
      if (sel && (sel.type === 'curve' || sel.type === 'curveDashed' || sel.type === 'curveSolid')) {
        var d = Math.hypot(pos.x - sel.cx, pos.y - sel.cy);
        if (d <= 10) {
          annotState.isAdjustingCurve = true;
          drawCanvas();
          return;
        }
      }
    }
    for (var i = annotState.shapes.length - 1; i >= 0; i--) {
      if (hitTestShape(annotState.shapes[i], pos.x, pos.y)) {
        var s = annotState.shapes[i];
        if ((s.type === 'textBox' || s.type === 'text' || s.type === 'strikeText' || s.type === 'callout') && annotState.lastClickInfo) {
          var info = annotState.lastClickInfo;
          var now = Date.now();
          if (info.idx === i && (now - info.time) < 400) {
            annotState.lastClickInfo = null;
            annotState.movingShapeIdx = i;
            annotState.isMoving = false;
            startTextEdit(s);
            return;
          }
        }
        annotState.lastClickInfo = { idx: i, time: Date.now() };
        annotState.movingShapeIdx = i;
        annotState.isMoving = true;
        annotState.moveLastX = pos.x;
        annotState.moveLastY = pos.y;
        drawCanvas();
        return;
      }
    }
    annotState.movingShapeIdx = -1;
    annotState.lastClickInfo = null;
    drawCanvas();
    return;
  }
  if (annotState.tool === 'callout') {
    annotState.isDrawing = true;
    annotState.startX = pos.x;
    annotState.startY = pos.y;
    return;
  }
  annotState.isDrawing = true;
  annotState.startX = pos.x;
  annotState.startY = pos.y;
}

function startTextEdit(s) {
  var wrap = $('sr-annotCanvasWrap');
  var canvas = annotState.canvas;
  var wrapRect = wrap.getBoundingClientRect();
  var canvasRect = canvas.getBoundingClientRect();
  var offsetX = canvasRect.left - wrapRect.left;
  var offsetY = canvasRect.top - wrapRect.top;
  var x = Math.min(s.x, s.x + s.w), y = Math.min(s.y, s.y + s.h);
  var w = Math.abs(s.w), h = Math.abs(s.h);
  var oldTa = document.getElementById('sr-annotEditText');
  if (oldTa) oldTa.remove();
  var ta = document.createElement('textarea');
  ta.id = 'sr-annotEditText';
  ta.style.position = 'absolute';
  ta.style.left = (offsetX + x) + 'px';
  ta.style.top = (offsetY + y) + 'px';
  ta.style.width = Math.max(w, 40) + 'px';
  ta.style.height = Math.max(h, 24) + 'px';
  ta.style.border = '2px solid #1a56db';
  ta.style.background = '#fff';
  ta.style.color = '#000';
  ta.style.fontSize = '13px';
  ta.style.textAlign = 'center';
  ta.style.resize = 'none';
  ta.style.padding = '4px';
  ta.style.zIndex = '100';
  ta.style.outline = 'none';
  ta.style.boxSizing = 'border-box';
  ta.style.cursor = 'text';
  ta.value = s.text || '';
  wrap.appendChild(ta);
  setTimeout(function() { ta.focus(); ta.select(); }, 50);
  var closed = false;
  var close = function(save) {
    if (closed) return;
    closed = true;
    if (save) s.text = ta.value;
    ta.remove();
    drawCanvas();
  };
  setTimeout(function() {
    if (!closed) ta.addEventListener('blur', function() { close(true); });
  }, 150);
  ta.addEventListener('keydown', function(ev) {
    if (ev.key === 'Escape') { ev.preventDefault(); close(false); }
    if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); close(true); }
  });
  ta.addEventListener('mousedown', function(ev) { ev.stopPropagation(); });
}

function onAnnotDoubleClick(e) {
  if (annotState.tool !== 'move') return;
  if (document.getElementById('sr-annotEditText')) return;
  var pos = getCanvasPos(e);
  for (var i = annotState.shapes.length - 1; i >= 0; i--) {
    var s = annotState.shapes[i];
    if ((s.type === 'textBox' || s.type === 'text' || s.type === 'strikeText' || s.type === 'callout') && hitTestShape(s, pos.x, pos.y)) {
      annotState.movingShapeIdx = i;
      annotState.isMoving = false;
      startTextEdit(s);
      return;
    }
  }
}

function onAnnotMouseMove(e) {
  if (!annotState.canvas) return;
  var pos = getCanvasPos(e);
  if (annotState.tool === 'move' && annotState.isAdjustingCurve && annotState.movingShapeIdx >= 0) {
    var s = annotState.shapes[annotState.movingShapeIdx];
    s.cx = pos.x;
    s.cy = pos.y;
    drawCanvas();
    return;
  }
  if (annotState.tool === 'move' && annotState.isMoving && annotState.movingShapeIdx >= 0) {
    var dx = pos.x - annotState.moveLastX;
    var dy = pos.y - annotState.moveLastY;
    moveShape(annotState.shapes[annotState.movingShapeIdx], dx, dy);
    annotState.moveLastX = pos.x;
    annotState.moveLastY = pos.y;
    drawCanvas();
    return;
  }
  if (!annotState.isDrawing) return;
  drawCanvas();
  var ctx = annotState.ctx;
  ctx.strokeStyle = annotState.color;
  ctx.fillStyle = annotState.color;
  ctx.lineWidth = annotState.lineWidth;
  if (annotState.tool === 'arrow') drawArrow(ctx, annotState.startX, annotState.startY, pos.x, pos.y);
  else if (annotState.tool === 'dashSingle') drawDashedLine(ctx, annotState.startX, annotState.startY, pos.x, pos.y);
  else if (annotState.tool === 'dashDouble') drawDoubleDashedLine(ctx, annotState.startX, annotState.startY, pos.x, pos.y);
  else if (annotState.tool === 'doubleSolid') drawDoubleSolidLine(ctx, annotState.startX, annotState.startY, pos.x, pos.y);
  else if (annotState.tool === 'solidLine') drawSingleSolidLine(ctx, annotState.startX, annotState.startY, pos.x, pos.y);
  else if (annotState.tool === 'xLine') drawXLine(ctx, annotState.startX, annotState.startY, pos.x, pos.y);
  else if (annotState.tool === 'curve') {
    var cp = getDefaultCurveCP(annotState.startX, annotState.startY, pos.x, pos.y);
    drawCurveLine(ctx, annotState.startX, annotState.startY, cp.cx, cp.cy, pos.x, pos.y);
  }
  else if (annotState.tool === 'curveDashed') {
    var cp2 = getDefaultCurveCP(annotState.startX, annotState.startY, pos.x, pos.y);
    drawCurveSimple(ctx, annotState.startX, annotState.startY, cp2.cx, cp2.cy, pos.x, pos.y, true);
  }
  else if (annotState.tool === 'curveSolid') {
    var cp3 = getDefaultCurveCP(annotState.startX, annotState.startY, pos.x, pos.y);
    drawCurveSimple(ctx, annotState.startX, annotState.startY, cp3.cx, cp3.cy, pos.x, pos.y, false);
  }
  else if (annotState.tool === 'fillRect') drawFillRect(ctx, annotState.startX, annotState.startY, pos.x - annotState.startX, pos.y - annotState.startY, annotState.color, annotState.lineWidth);
  else if (annotState.tool === 'dashRect') drawDashedRect(ctx, annotState.startX, annotState.startY, pos.x - annotState.startX, pos.y - annotState.startY);
  else if (annotState.tool === 'dimLine') drawDimLine(ctx, annotState.startX, annotState.startY, pos.x, pos.y);
  else if (annotState.tool === 'rect') ctx.strokeRect(annotState.startX, annotState.startY, pos.x - annotState.startX, pos.y - annotState.startY);
  else if (annotState.tool === 'circle') {
    var r = Math.hypot(pos.x - annotState.startX, pos.y - annotState.startY);
    ctx.beginPath(); ctx.arc(annotState.startX, annotState.startY, r, 0, Math.PI * 2); ctx.stroke();
  }
  else if (annotState.tool === 'mosaic') {
    ctx.save(); ctx.strokeStyle = '#666'; ctx.setLineDash([5, 3]); ctx.lineWidth = 1;
    ctx.strokeRect(annotState.startX, annotState.startY, pos.x - annotState.startX, pos.y - annotState.startY);
    ctx.restore();
  }
  else if (annotState.tool === 'textBox') {
    ctx.save();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(annotState.startX, annotState.startY, pos.x - annotState.startX, pos.y - annotState.startY);
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = annotState.lineWidth;
    ctx.strokeRect(annotState.startX, annotState.startY, pos.x - annotState.startX, pos.y - annotState.startY);
    ctx.restore();
  }
  else if (annotState.tool === 'text' || annotState.tool === 'strikeText') {
    ctx.save();
    ctx.strokeStyle = '#999';
    ctx.setLineDash([5, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(annotState.startX, annotState.startY, pos.x - annotState.startX, pos.y - annotState.startY);
    ctx.restore();
  }
  else if (annotState.tool === 'callout') {
    var bw = 120, bh = 50;
    drawCallout(ctx, {
      type: 'callout', tipX: annotState.startX, tipY: annotState.startY,
      x: pos.x - bw / 2, y: pos.y - bh / 2, w: bw, h: bh,
      text: '', color: annotState.color, lineWidth: annotState.lineWidth, fontSize: 13
    });
  }
}

function onAnnotMouseUp(e) {
  if (annotState.tool === 'move') {
    annotState.isMoving = false;
    annotState.isAdjustingCurve = false;
    return;
  }
  if (!annotState.isDrawing) return;
  annotState.isDrawing = false;
  var pos = getCanvasPos(e);
  if (annotState.tool === 'arrow') {
    annotState.shapes.push({type:'arrow', x1:annotState.startX, y1:annotState.startY, x2:pos.x, y2:pos.y, color:annotState.color, lineWidth:annotState.lineWidth});
  } else if (annotState.tool === 'dashSingle') {
    annotState.shapes.push({type:'dashSingle', x1:annotState.startX, y1:annotState.startY, x2:pos.x, y2:pos.y, color:annotState.color, lineWidth:annotState.lineWidth});
  } else if (annotState.tool === 'dashDouble') {
    annotState.shapes.push({type:'dashDouble', x1:annotState.startX, y1:annotState.startY, x2:pos.x, y2:pos.y, color:annotState.color, lineWidth:annotState.lineWidth});
  } else if (annotState.tool === 'doubleSolid') {
    annotState.shapes.push({type:'doubleSolid', x1:annotState.startX, y1:annotState.startY, x2:pos.x, y2:pos.y, color:annotState.color, lineWidth:annotState.lineWidth});
  } else if (annotState.tool === 'solidLine') {
    annotState.shapes.push({type:'solidLine', x1:annotState.startX, y1:annotState.startY, x2:pos.x, y2:pos.y, color:annotState.color, lineWidth:annotState.lineWidth});
  } else if (annotState.tool === 'xLine') {
    annotState.shapes.push({type:'xLine', x1:annotState.startX, y1:annotState.startY, x2:pos.x, y2:pos.y, color:annotState.color, lineWidth:annotState.lineWidth});
  } else if (annotState.tool === 'curve') {
    var cp4 = getDefaultCurveCP(annotState.startX, annotState.startY, pos.x, pos.y);
    annotState.shapes.push({type:'curve', x1:annotState.startX, y1:annotState.startY, x2:pos.x, y2:pos.y, cx:cp4.cx, cy:cp4.cy, color:annotState.color, lineWidth:annotState.lineWidth});
    showToast('弧长已绘制，拖动蓝色圆点可调整弧度', 'success');
    autoSwitchToMove();
  } else if (annotState.tool === 'curveDashed') {
    var cp5 = getDefaultCurveCP(annotState.startX, annotState.startY, pos.x, pos.y);
    annotState.shapes.push({type:'curveDashed', x1:annotState.startX, y1:annotState.startY, x2:pos.x, y2:pos.y, cx:cp5.cx, cy:cp5.cy, color:annotState.color, lineWidth:annotState.lineWidth});
    showToast('弯曲虚线已绘制，拖动蓝色圆点可调整弧度', 'success');
    autoSwitchToMove();
  } else if (annotState.tool === 'curveSolid') {
    var cp6 = getDefaultCurveCP(annotState.startX, annotState.startY, pos.x, pos.y);
    annotState.shapes.push({type:'curveSolid', x1:annotState.startX, y1:annotState.startY, x2:pos.x, y2:pos.y, cx:cp6.cx, cy:cp6.cy, color:annotState.color, lineWidth:annotState.lineWidth});
    showToast('弯曲实线已绘制，拖动蓝色圆点可调整弧度', 'success');
    autoSwitchToMove();
  } else if (annotState.tool === 'fillRect') {
    annotState.shapes.push({type:'fillRect', x:annotState.startX, y:annotState.startY, w:pos.x-annotState.startX, h:pos.y-annotState.startY, color:annotState.color, lineWidth:annotState.lineWidth});
  } else if (annotState.tool === 'dashRect') {
    annotState.shapes.push({type:'dashRect', x:annotState.startX, y:annotState.startY, w:pos.x-annotState.startX, h:pos.y-annotState.startY, color:annotState.color, lineWidth:annotState.lineWidth});
  } else if (annotState.tool === 'dimLine') {
    annotState.shapes.push({type:'dimLine', x1:annotState.startX, y1:annotState.startY, x2:pos.x, y2:pos.y, color:annotState.color, lineWidth:annotState.lineWidth});
  } else if (annotState.tool === 'rect') {
    annotState.shapes.push({type:'rect', x:annotState.startX, y:annotState.startY, w:pos.x-annotState.startX, h:pos.y-annotState.startY, color:annotState.color, lineWidth:annotState.lineWidth});
  } else if (annotState.tool === 'circle') {
    var r2 = Math.hypot(pos.x - annotState.startX, pos.y - annotState.startY);
    annotState.shapes.push({type:'circle', x:annotState.startX, y:annotState.startY, r: r2, color:annotState.color, lineWidth:annotState.lineWidth});
  } else if (annotState.tool === 'mosaic') {
    var bs = Math.max(4, annotState.lineWidth * 3);
    annotState.shapes.push({type:'mosaic', x:annotState.startX, y:annotState.startY, w:pos.x-annotState.startX, h:pos.y-annotState.startY, blockSize: bs});
  } else if (annotState.tool === 'textBox') {
    var w = pos.x - annotState.startX, h = pos.y - annotState.startY;
    if (Math.abs(w) > 10 && Math.abs(h) > 10) {
      annotState.shapes.push({type:'textBox', x:annotState.startX, y:annotState.startY, w: w, h: h, text:'', color:'#000', lineWidth:annotState.lineWidth, fontSize:13});
      showToast('文本框已创建，已切换至移动工具，双击框内可输入文字', 'success');
      autoSwitchToMove();
    }
  } else if (annotState.tool === 'text') {
    var w2 = pos.x - annotState.startX, h2 = pos.y - annotState.startY;
    if (Math.abs(w2) > 10 && Math.abs(h2) > 10) {
      annotState.shapes.push({type:'text', x:annotState.startX, y:annotState.startY, w: w2, h: h2, text:'', color:annotState.color, lineWidth:annotState.lineWidth, fontSize:13});
      showToast('文字框已创建，已切换至移动工具，双击框内可输入文字', 'success');
      autoSwitchToMove();
    }
  } else if (annotState.tool === 'strikeText') {
    var w3 = pos.x - annotState.startX, h3 = pos.y - annotState.startY;
    if (Math.abs(w3) > 10 && Math.abs(h3) > 10) {
      annotState.shapes.push({type:'strikeText', x:annotState.startX, y:annotState.startY, w: w3, h: h3, text:'', color:annotState.color, lineWidth:annotState.lineWidth, fontSize:13});
      showToast('划线文字已创建，已切换至移动工具，双击框内可输入文字', 'success');
      autoSwitchToMove();
    }
  } else if (annotState.tool === 'callout') {
    var bw2 = 120, bh2 = 50;
    annotState.shapes.push({
      type: 'callout', tipX: annotState.startX, tipY: annotState.startY,
      x: pos.x - bw2 / 2, y: pos.y - bh2 / 2, w: bw2, h: bh2,
      text: '', color: annotState.color, lineWidth: annotState.lineWidth, fontSize: 13
    });
    showToast('标注气泡已创建，双击气泡内可输入文字', 'success');
    autoSwitchToMove();
  }
  drawCanvas();
}

function drawArrow(ctx, x1, y1, x2, y2) {
  var headLen = 12 + annotState.lineWidth * 2;
  var angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI/6), y2 - headLen * Math.sin(angle - Math.PI/6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI/6), y2 - headLen * Math.sin(angle + Math.PI/6));
  ctx.closePath(); ctx.fill();
}

function drawDashedLine(ctx, x1, y1, x2, y2) {
  ctx.save();
  ctx.setLineDash([8, 4]);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.restore();
}

function drawDoubleDashedLine(ctx, x1, y1, x2, y2) {
  var dx = x2 - x1, dy = y2 - y1;
  var len = Math.hypot(dx, dy);
  if (len < 1) return;
  var offset = 2 + annotState.lineWidth * 0.5;
  var nx = -dy / len * offset;
  var ny = dx / len * offset;
  ctx.save();
  ctx.setLineDash([8, 4]);
  ctx.beginPath(); ctx.moveTo(x1 + nx, y1 + ny); ctx.lineTo(x2 + nx, y2 + ny); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1 - nx, y1 - ny); ctx.lineTo(x2 - nx, y2 - ny); ctx.stroke();
  ctx.restore();
}

function drawFillRect(ctx, x, y, w, h, color, lineWidth) {
  var rx = Math.min(x, x + w), ry = Math.min(y, y + h);
  var rw = Math.abs(w), rh = Math.abs(h);
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = color || '#000';
  ctx.fillRect(rx, ry, rw, rh);
  ctx.globalAlpha = 1;
  ctx.strokeStyle = color || '#000';
  ctx.lineWidth = lineWidth || 2;
  ctx.strokeRect(rx, ry, rw, rh);
  ctx.restore();
}

function drawCallout(ctx, s) {
  var bx = Math.min(s.x, s.x + s.w), by = Math.min(s.y, s.y + s.h);
  var bw = Math.abs(s.w), bh = Math.abs(s.h);
  var r = Math.min(10, bw / 4, bh / 4);
  var cx = bx + bw / 2, cy = by + bh / 2;
  var dx = s.tipX - cx, dy = s.tipY - cy;
  var adx = Math.abs(dx), ady = Math.abs(dy);
  var connX, connY, connSide;
  if (adx > ady) {
    if (dx > 0) { connX = bx + bw; connY = cy; connSide = 'right'; }
    else { connX = bx; connY = cy; connSide = 'left'; }
  } else {
    if (dy > 0) { connX = cx; connY = by + bh; connSide = 'bottom'; }
    else { connX = cx; connY = by; connSide = 'top'; }
  }
  var baseW = Math.min(20, bw * 0.3, bh * 0.3);
  var col = s.color || '#ff0000';
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(bx + r, by);
  if (connSide === 'top') {
    ctx.lineTo(connX - baseW / 2, by);
    ctx.lineTo(s.tipX, s.tipY);
    ctx.lineTo(connX + baseW / 2, by);
  }
  ctx.lineTo(bx + bw - r, by);
  ctx.arcTo(bx + bw, by, bx + bw, by + r, r);
  if (connSide === 'right') {
    ctx.lineTo(bx + bw, connY - baseW / 2);
    ctx.lineTo(s.tipX, s.tipY);
    ctx.lineTo(bx + bw, connY + baseW / 2);
  }
  ctx.lineTo(bx + bw, by + bh - r);
  ctx.arcTo(bx + bw, by + bh, bx + bw - r, by + bh, r);
  if (connSide === 'bottom') {
    ctx.lineTo(connX + baseW / 2, by + bh);
    ctx.lineTo(s.tipX, s.tipY);
    ctx.lineTo(connX - baseW / 2, by + bh);
  }
  ctx.lineTo(bx + r, by + bh);
  ctx.arcTo(bx, by + bh, bx, by + bh - r, r);
  if (connSide === 'left') {
    ctx.lineTo(bx, connY + baseW / 2);
    ctx.lineTo(s.tipX, s.tipY);
    ctx.lineTo(bx, connY - baseW / 2);
  }
  ctx.lineTo(bx, by + r);
  ctx.arcTo(bx, by, bx + r, by, r);
  ctx.closePath();
  ctx.fillStyle = '#ffffff';
  ctx.fill();
  ctx.strokeStyle = col;
  ctx.lineWidth = s.lineWidth || 2;
  ctx.stroke();
  if (s.text) {
    var fontSize = s.fontSize || 13;
    ctx.font = fontSize + 'px Arial';
    ctx.fillStyle = '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var lines = s.text.split('\n');
    var lineHeight = fontSize * 1.3;
    var startY = cy - (lines.length - 1) * lineHeight / 2;
    lines.forEach(function(line, i) { ctx.fillText(line, cx, startY + i * lineHeight); });
  } else {
    ctx.fillStyle = '#ccc';
    ctx.font = '12px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('双击输入文字', cx, cy);
  }
  ctx.restore();
}

function drawCurveSimple(ctx, x1, y1, cx, cy, x2, y2, dashed) {
  ctx.save();
  if (dashed) ctx.setLineDash([8, 4]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cx, cy, x2, y2);
  ctx.stroke();
  ctx.restore();
}

function drawTextInBox(ctx, s) {
  var x = Math.min(s.x, s.x + s.w), y = Math.min(s.y, s.y + s.h);
  var w = Math.abs(s.w), h = Math.abs(s.h);
  ctx.save();
  if (s.text) {
    var fontSize = s.fontSize || 13;
    ctx.fillStyle = s.color || '#000';
    ctx.font = fontSize + 'px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var lines = s.text.split('\n');
    var lineHeight = fontSize * 1.3;
    var startY = y + h / 2 - (lines.length - 1) * lineHeight / 2;
    lines.forEach(function(line, i) {
      ctx.fillText(line, x + w / 2, startY + i * lineHeight);
    });
  } else {
    ctx.strokeStyle = '#ccc';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

function drawTextBox(ctx, s) {
  var x = Math.min(s.x, s.x + s.w), y = Math.min(s.y, s.y + s.h);
  var w = Math.abs(s.w), h = Math.abs(s.h);
  ctx.save();
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = s.lineWidth || 2;
  ctx.strokeRect(x, y, w, h);
  if (s.text) {
    var fontSize = s.fontSize || 13;
    ctx.fillStyle = '#000000';
    ctx.font = fontSize + 'px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var lines = s.text.split('\n');
    var lineHeight = fontSize * 1.3;
    var startY = y + h / 2 - (lines.length - 1) * lineHeight / 2;
    lines.forEach(function(line, i) {
      ctx.fillText(line, x + w / 2, startY + i * lineHeight);
    });
  }
  ctx.restore();
}

function drawDashedRect(ctx, x, y, w, h) {
  ctx.save();
  ctx.setLineDash([8, 4]);
  ctx.strokeRect(x, y, w, h);
  ctx.restore();
}

function drawDimLine(ctx, x1, y1, x2, y2) {
  var headLen = 10 + annotState.lineWidth * 2;
  var tickLen = 8 + annotState.lineWidth;
  var angle = Math.atan2(y2 - y1, x2 - x1);
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 - headLen * Math.cos(angle - Math.PI/6), y2 - headLen * Math.sin(angle - Math.PI/6));
  ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI/6), y2 - headLen * Math.sin(angle + Math.PI/6));
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + headLen * Math.cos(angle - Math.PI/6), y1 + headLen * Math.sin(angle - Math.PI/6));
  ctx.lineTo(x1 + headLen * Math.cos(angle + Math.PI/6), y1 + headLen * Math.sin(angle + Math.PI/6));
  ctx.closePath(); ctx.fill();
  var perpAngle = angle + Math.PI / 2;
  var tx = Math.cos(perpAngle) * tickLen;
  var ty = Math.sin(perpAngle) * tickLen;
  ctx.beginPath();
  ctx.moveTo(x1 - tx, y1 - ty); ctx.lineTo(x1 + tx, y1 + ty);
  ctx.moveTo(x2 - tx, y2 - ty); ctx.lineTo(x2 + tx, y2 + ty);
  ctx.stroke();
}

function drawDoubleSolidLine(ctx, x1, y1, x2, y2) {
  var dx = x2 - x1, dy = y2 - y1;
  var len = Math.hypot(dx, dy);
  if (len < 1) return;
  var offset = 2 + annotState.lineWidth * 0.5;
  var nx = -dy / len * offset;
  var ny = dx / len * offset;
  ctx.beginPath(); ctx.moveTo(x1 + nx, y1 + ny); ctx.lineTo(x2 + nx, y2 + ny); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(x1 - nx, y1 - ny); ctx.lineTo(x2 - nx, y2 - ny); ctx.stroke();
}

function drawSingleSolidLine(ctx, x1, y1, x2, y2) {
  ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
}

function drawXLine(ctx, x1, y1, x2, y2) {
  var minX = Math.min(x1, x2), maxX = Math.max(x1, x2);
  var minY = Math.min(y1, y2), maxY = Math.max(y1, y2);
  ctx.beginPath(); ctx.moveTo(minX, minY); ctx.lineTo(maxX, maxY); ctx.stroke();
  ctx.beginPath(); ctx.moveTo(minX, maxY); ctx.lineTo(maxX, minY); ctx.stroke();
}

function getDefaultCurveCP(x1, y1, x2, y2) {
  var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
  var dx = x2 - x1, dy = y2 - y1;
  var len = Math.hypot(dx, dy);
  if (len < 1) return { cx: mx, cy: my };
  var offset = len * 0.25;
  return { cx: mx - dy / len * offset, cy: my + dx / len * offset };
}

function drawCurveLine(ctx, x1, y1, cx, cy, x2, y2) {
  var headLen = 10 + annotState.lineWidth * 2;
  var tickLen = 8 + annotState.lineWidth;
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.quadraticCurveTo(cx, cy, x2, y2);
  ctx.stroke();
  var ang1 = Math.atan2(cy - y1, cx - x1);
  var ang2 = Math.atan2(cy - y2, cx - x2);
  ctx.beginPath(); ctx.moveTo(x1, y1);
  ctx.lineTo(x1 + headLen * Math.cos(ang1 - Math.PI/6), y1 + headLen * Math.sin(ang1 - Math.PI/6));
  ctx.lineTo(x1 + headLen * Math.cos(ang1 + Math.PI/6), y1 + headLen * Math.sin(ang1 + Math.PI/6));
  ctx.closePath(); ctx.fill();
  ctx.beginPath(); ctx.moveTo(x2, y2);
  ctx.lineTo(x2 + headLen * Math.cos(ang2 - Math.PI/6), y2 + headLen * Math.sin(ang2 - Math.PI/6));
  ctx.lineTo(x2 + headLen * Math.cos(ang2 + Math.PI/6), y2 + headLen * Math.sin(ang2 + Math.PI/6));
  ctx.closePath(); ctx.fill();
  var perp1 = ang1 + Math.PI / 2;
  var t1x = Math.cos(perp1) * tickLen, t1y = Math.sin(perp1) * tickLen;
  ctx.beginPath();
  ctx.moveTo(x1 - t1x, y1 - t1y); ctx.lineTo(x1 + t1x, y1 + t1y);
  var perp2 = ang2 + Math.PI / 2;
  var t2x = Math.cos(perp2) * tickLen, t2y = Math.sin(perp2) * tickLen;
  ctx.moveTo(x2 - t2x, y2 - t2y); ctx.lineTo(x2 + t2x, y2 + t2y);
  ctx.stroke();
}

function drawStrikeText(ctx, s) {
  var x = Math.min(s.x, s.x + s.w), y = Math.min(s.y, s.y + s.h);
  var w = Math.abs(s.w), h = Math.abs(s.h);
  ctx.save();
  if (s.text) {
    var fontSize = s.fontSize || 13;
    ctx.font = fontSize + 'px Arial';
    ctx.fillStyle = s.color || '#000';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    var lines = s.text.split('\n');
    var lineHeight = fontSize * 1.3;
    var startY = y + h / 2 - (lines.length - 1) * lineHeight / 2;
    lines.forEach(function(line, i) {
      var ly = startY + i * lineHeight;
      ctx.fillText(line, x + w / 2, ly);
      var metrics = ctx.measureText(line);
      ctx.strokeStyle = s.color || '#000';
      ctx.lineWidth = Math.max(1, fontSize / 6);
      ctx.beginPath();
      ctx.moveTo(x + w / 2 - metrics.width / 2, ly);
      ctx.lineTo(x + w / 2 + metrics.width / 2, ly);
      ctx.stroke();
    });
  } else {
    ctx.strokeStyle = '#ccc';
    ctx.setLineDash([4, 3]);
    ctx.lineWidth = 1;
    ctx.strokeRect(x, y, w, h);
  }
  ctx.restore();
}

function drawMosaic(ctx, x, y, w, h, blockSize) {
  if (w < 0) { x += w; w = -w; }
  if (h < 0) { y += h; h = -h; }
  x = Math.max(0, Math.floor(x));
  y = Math.max(0, Math.floor(y));
  w = Math.min(annotState.canvas.width - x, Math.floor(w));
  h = Math.min(annotState.canvas.height - y, Math.floor(h));
  if (w <= 0 || h <= 0) return;
  var bs = Math.max(2, blockSize);
  for (var by = 0; by < h; by += bs) {
    for (var bx = 0; bx < w; bx += bs) {
      var bw = Math.min(bs, w - bx);
      var bh = Math.min(bs, h - by);
      var data = ctx.getImageData(x + bx, y + by, bw, bh).data;
      var r = 0, g = 0, b = 0, count = 0;
      for (var i = 0; i < data.length; i += 4) { r += data[i]; g += data[i+1]; b += data[i+2]; count++; }
      ctx.fillStyle = 'rgb(' + Math.round(r/count) + ',' + Math.round(g/count) + ',' + Math.round(b/count) + ')';
      ctx.fillRect(x + bx, y + by, bw, bh);
    }
  }
}

function drawCanvas() {
  if (!annotState.ctx || !annotState.canvas) return;
  var ctx = annotState.ctx;
  ctx.clearRect(0, 0, annotState.canvas.width, annotState.canvas.height);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, annotState.canvas.width, annotState.canvas.height);
  annotState.shapes.forEach(function(s) {
    ctx.save();
    var rot = s.rotation || 0;
    if (rot !== 0 && s.type !== 'mosaic') {
      var c = getShapeCenter(s);
      ctx.translate(c.x, c.y);
      ctx.rotate(rot * Math.PI / 180);
      ctx.translate(-c.x, -c.y);
    }
    ctx.strokeStyle = s.color; ctx.fillStyle = s.color; ctx.lineWidth = s.lineWidth;
    if (s.type === 'arrow') drawArrow(ctx, s.x1, s.y1, s.x2, s.y2);
    else if (s.type === 'dashSingle') drawDashedLine(ctx, s.x1, s.y1, s.x2, s.y2);
    else if (s.type === 'dashDouble') drawDoubleDashedLine(ctx, s.x1, s.y1, s.x2, s.y2);
    else if (s.type === 'doubleSolid') drawDoubleSolidLine(ctx, s.x1, s.y1, s.x2, s.y2);
    else if (s.type === 'solidLine') drawSingleSolidLine(ctx, s.x1, s.y1, s.x2, s.y2);
    else if (s.type === 'xLine') drawXLine(ctx, s.x1, s.y1, s.x2, s.y2);
    else if (s.type === 'curve') drawCurveLine(ctx, s.x1, s.y1, s.cx, s.cy, s.x2, s.y2);
    else if (s.type === 'curveDashed') drawCurveSimple(ctx, s.x1, s.y1, s.cx, s.cy, s.x2, s.y2, true);
    else if (s.type === 'curveSolid') drawCurveSimple(ctx, s.x1, s.y1, s.cx, s.cy, s.x2, s.y2, false);
    else if (s.type === 'fillRect') drawFillRect(ctx, s.x, s.y, s.w, s.h, s.color, s.lineWidth);
    else if (s.type === 'dashRect') drawDashedRect(ctx, s.x, s.y, s.w, s.h);
    else if (s.type === 'dimLine') drawDimLine(ctx, s.x1, s.y1, s.x2, s.y2);
    else if (s.type === 'text') drawTextInBox(ctx, s);
    else if (s.type === 'strikeText') drawStrikeText(ctx, s);
    else if (s.type === 'textBox') drawTextBox(ctx, s);
    else if (s.type === 'callout') drawCallout(ctx, s);
    else if (s.type === 'rect') ctx.strokeRect(s.x, s.y, s.w, s.h);
    else if (s.type === 'circle') { ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.stroke(); }
    else if (s.type === 'mosaic') drawMosaic(ctx, s.x, s.y, s.w, s.h, s.blockSize);
    else if (s.type === 'image' && s.img) ctx.drawImage(s.img, s.x, s.y, s.w, s.h);
    ctx.restore();
  });
  if (annotState.tool === 'move' && annotState.movingShapeIdx >= 0) {
    var sel = annotState.shapes[annotState.movingShapeIdx];
    var b = getShapeBounds(sel);
    if (b) {
      ctx.save();
      var rot2 = sel.rotation || 0;
      if (rot2 !== 0 && sel.type !== 'mosaic') {
        var c2 = getShapeCenter(sel);
        ctx.translate(c2.x, c2.y);
        ctx.rotate(rot2 * Math.PI / 180);
        ctx.translate(-c2.x, -c2.y);
      }
      ctx.strokeStyle = '#1a56db';
      ctx.setLineDash([5, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(b.x, b.y, b.w, b.h);
      ctx.restore();
      if (sel.type === 'curve' || sel.type === 'curveDashed' || sel.type === 'curveSolid') {
        ctx.save();
        var mx = (sel.x1 + sel.x2) / 2, my = (sel.y1 + sel.y2) / 2;
        ctx.strokeStyle = '#1a56db';
        ctx.setLineDash([3, 3]);
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(sel.cx, sel.cy); ctx.stroke();
        ctx.setLineDash([]);
        ctx.fillStyle = '#fff';
        ctx.strokeStyle = '#1a56db';
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(sel.cx, sel.cy, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
    }
  }
}

function undoAnnot() {
  if (annotState.shapes.length === 0) { showToast('没有可撤销的标注', 'info'); return; }
  annotState.shapes.pop();
  drawCanvas();
  showToast('已撤销', 'info');
}

function clearAnnot() {
  if (annotState.shapes.length === 0) { showToast('没有可清除的标注', 'info'); return; }
  annotState.shapes = [];
  drawCanvas();
  showToast('已清除所有标注', 'info');
}

function saveAnnotImage() {
  if (!annotState.canvas) { showToast('请先上传图片', 'error'); return; }
  var dataUrl = annotState.canvas.toDataURL('image/png');
  var cid = annotState.editingCommentId;
  var idx = annotState.editingImageIdx;
  var c = comments.find(function(c) { return c.id === cid; });
  if (c) {
    if (idx >= 0) {
      var existing = c.images[idx];
      var psize = imgPrintSize(existing);
      c.images[idx] = { src: dataUrl, printSize: psize };
    } else {
      c.images.push({ src: dataUrl, printSize: 'full' });
    }
    renderComments();
  }
  closeAnnotModal();
  showToast('图片标注已保存', 'success');
}

// ===== Storage =====
function getRecords() {
  try {
    if (window.App && window.App.store && typeof window.App.store.get === 'function') {
      var val = window.App.store.get('sampleReviewRecords', null);
      if (val !== null && val !== undefined) return val;
    }
  } catch(e) {}
  try {
    var raw = safeStorage.getItem('sampleReviewRecords');
    if (raw) return JSON.parse(raw);
  } catch(e) {}
  return [];
}

function setRecords(recs) {
  try {
    if (window.App && window.App.store && typeof window.App.store.set === 'function') {
      window.App.store.set('sampleReviewRecords', recs);
      return;
    }
  } catch(e) {}
  try {
    safeStorage.setItem('sampleReviewRecords', JSON.stringify(recs));
  } catch(e) {}
}

// ===== Records =====
function saveRecord() {
  var isEditing = !!editingRecordId;
  var record = {
    id: editingRecordId || ('r' + Date.now()),
    date: $('sr-h-date').value,
    deadline: $('sr-h-deadline').value,
    style: $('sr-h-style').value,
    order: $('sr-h-order').value,
    product: $('sr-h-product').value,
    size: $('sr-h-size').value,
    qty: $('sr-h-qty').value,
    factory: $('sr-h-factory').value,
    type: $('sr-h-type').value,
    materials: collectMaterials(),
    comments: JSON.parse(JSON.stringify(comments)),
    sizeTable: sizeTableData ? JSON.parse(JSON.stringify(sizeTableData)) : null
  };
  if (isEditing) {
    var idx = records.findIndex(function(r) { return r.id === editingRecordId; });
    if (idx >= 0) records[idx] = record;
    editingRecordId = null;
  } else {
    records.push(record);
  }
  setRecords(records);
  clearForm();
  switchTab('info');
  showToast(isEditing ? '记录已更新' : '记录已保存', 'success');
}

function editRecord(id) {
  var r = records.find(function(r) { return r.id === id; });
  if (!r) return;
  editingRecordId = id;
  $('sr-h-date').value = r.date || '';
  $('sr-h-deadline').value = r.deadline || '';
  $('sr-h-type').value = r.type || '';
  $('sr-h-style').value = r.style || '';
  $('sr-h-order').value = r.order || '';
  $('sr-h-product').value = r.product || '';
  $('sr-h-size').value = r.size || '';
  $('sr-h-qty').value = r.qty || '';
  $('sr-h-factory').value = r.factory || '';
  materials = r.materials ? JSON.parse(JSON.stringify(r.materials)) : [];
  if (materials.length === 0) addMatRow(); else renderMatTable();
  comments = r.comments ? JSON.parse(JSON.stringify(r.comments)) : [];
  commentCounter = comments.length;
  sizeTableData = r.sizeTable ? JSON.parse(JSON.stringify(r.sizeTable)) : null;
  if (sizeTableData) renderSizeTable(sizeTableData);
  else {
    var c = $('sr-sizeTableContainer');
    if (c) c.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);"><div style="font-size:36px;margin-bottom:8px;">📊</div><p>请导入Excel文件以显示尺寸表</p></div>';
  }
  currentFilter = 'all';
  $$('.sr-cat-tab').forEach(function(t) { t.classList.remove('active'); });
  var allTab = container ? container.querySelector('.sr-cat-tab[data-cat="all"]') : document.querySelector('.sr-cat-tab[data-cat="all"]');
  if (allTab) allTab.classList.add('active');
  renderComments();
  switchTab('entry');
  showToast('已加载记录，可编辑后保存', 'info');
}

function deleteRecord(id) {
  if (!confirm('确认删除此记录？')) return;
  records = records.filter(function(r) { return r.id !== id; });
  setRecords(records);
  renderRecords();
  showToast('记录已删除', 'success');
}

function renderRecords() {
  var list = $('sr-recordList');
  if (!list) return;
  var searchEl = $('sr-searchInput');
  var searchTerm = (searchEl && searchEl.value ? searchEl.value : '').toLowerCase().trim();
  var filtered = searchTerm ? records.filter(function(r) {
    return [r.style, r.order, r.product, r.size, r.factory, r.date, r.type].some(function(v) {
      return (v || '').toLowerCase().indexOf(searchTerm) >= 0;
    });
  }) : records;
  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);"><div style="font-size:36px;margin-bottom:8px;">📋</div><p>' + (searchTerm ? '未找到匹配的记录' : '暂无保存的记录') + '</p></div>';
    return;
  }
  list.innerHTML = filtered.map(function(r) {
    return '<div class="record-card" data-sr-rec="' + r.id + '">' +
      '<div class="rec-header">' +
        '<span class="rec-title">' + esc(r.style) + ' | ' + esc(r.product) + '</span>' +
        '<span class="rec-date">' + (r.date||'—') + '</span>' +
      '</div>' +
      '<div class="rec-info">' +
        '<span>款号: <b>' + esc(r.style) + '</b></span>' +
        '<span>品名: <b>' + esc(r.product) + '</b></span>' +
        '<span>类型: <b>' + esc(r.type) + '</b></span>' +
        '<span>订单号: <b>' + esc(r.order) + '</b></span>' +
        '<span>尺码: <b>' + esc(r.size) + '</b></span>' +
        '<span>样衣数量: <b>' + esc(r.qty) + '</b></span>' +
        '<span>服装厂: <b>' + esc(r.factory) + '</b></span>' +
      '</div>' +
      '<div class="rec-footer">' +
        '<span>材料: ' + (r.materials ? r.materials.length : 0) + '项 | 意见: ' + (r.comments ? r.comments.length : 0) + '条</span>' +
        '<button class="btn btn-danger btn-sm" data-sr-del-rec="' + r.id + '">删除</button>' +
      '</div>' +
    '</div>';
  }).join('');
}

function clearForm() {
  var today = new Date().toISOString().split('T')[0];
  var dateEl = $('sr-h-date');
  if (dateEl) dateEl.value = today;
  ['sr-h-style','sr-h-order','sr-h-product','sr-h-size','sr-h-qty','sr-h-factory','sr-h-type','sr-h-deadline'].forEach(function(id) {
    var el = $(id); if (el) el.value = '';
  });
  materials = [];
  addMatRow();
  comments = [];
  commentCounter = 0;
  sizeTableData = null;
  var stc = $('sr-sizeTableContainer');
  if (stc) stc.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);"><div style="font-size:36px;margin-bottom:8px;">📊</div><p>请导入Excel文件以显示尺寸表</p></div>';
  currentFilter = 'all';
  $$('.sr-cat-tab').forEach(function(t) { t.classList.remove('active'); });
  var allTab2 = container ? container.querySelector('.sr-cat-tab[data-cat="all"]') : document.querySelector('.sr-cat-tab[data-cat="all"]');
  if (allTab2) allTab2.classList.add('active');
  renderComments();
}

// ===== Excel Import =====
function roundNum(v) {
  if (v === null || v === undefined || v === '') return v;
  var s = v.toString().trim();
  if (/^-?\d+\.?\d*$/.test(s) && s !== '-' && !isNaN(parseFloat(s))) {
    return parseFloat(s).toFixed(1);
  }
  return v;
}

function colNameToIdx(name) {
  var idx = 0;
  for (var i = 0; i < name.length; i++) idx = idx * 26 + (name.charCodeAt(i) - 64);
  return idx - 1;
}

function parseCSV(text) {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);
  var rows = [];
  var row = [], cell = '', inQ = false;
  for (var i = 0; i < text.length; i++) {
    var ch = text[i];
    if (inQ) {
      if (ch === '"') {
        if (text[i+1] === '"') { cell += '"'; i++; }
        else inQ = false;
      } else cell += ch;
    } else {
      if (ch === '"') inQ = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (ch === '\r') {}
      else cell += ch;
    }
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(function(r) { return r.some(function(c) { return c.trim(); }); });
}

async function parseXLSX(file) {
  var buffer = await file.arrayBuffer();
  var bytes = new Uint8Array(buffer);
  var view = new DataView(buffer);
  var eocd = -1;
  for (var i = bytes.length - 22; i >= 0; i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('无效的XLSX文件');
  var cdCount = view.getUint16(eocd + 10, true);
  var cdOffset = view.getUint32(eocd + 16, true);
  var files = {};
  var off = cdOffset;
  for (var i = 0; i < cdCount; i++) {
    if (view.getUint32(off, true) !== 0x02014b50) break;
    var method = view.getUint16(off + 10, true);
    var compSize = view.getUint32(off + 20, true);
    var nameLen = view.getUint16(off + 28, true);
    var extraLen = view.getUint16(off + 30, true);
    var commentLen = view.getUint16(off + 32, true);
    var localOff = view.getUint32(off + 42, true);
    var name = new TextDecoder().decode(bytes.slice(off + 46, off + 46 + nameLen));
    files[name] = { method: method, compSize: compSize, localOff: localOff };
    off += 46 + nameLen + extraLen + commentLen;
  }
  async function extract(name) {
    var f = files[name];
    if (!f) return null;
    var localNameLen = view.getUint16(f.localOff + 26, true);
    var localExtraLen = view.getUint16(f.localOff + 28, true);
    var dataOff = f.localOff + 30 + localNameLen + localExtraLen;
    var compressed = bytes.slice(dataOff, dataOff + f.compSize);
    if (f.method === 0) return compressed;
    if (f.method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('浏览器不支持XLSX解析，请使用CSV格式');
      var ds = new DecompressionStream('deflate-raw');
      var stream = new Blob([compressed]).stream().pipeThrough(ds);
      return new Uint8Array(await new Response(stream).arrayBuffer());
    }
    return null;
  }
  var sharedStrings = [];
  var ssXml = await extract('xl/sharedStrings.xml');
  if (ssXml) {
    var ssText = new TextDecoder().decode(ssXml);
    var re = /<si>([\s\S]*?)<\/si>/g;
    var m;
    while (m = re.exec(ssText)) {
      var texts = [];
      var tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      var tm;
      while (tm = tRe.exec(m[1])) texts.push(tm[1]);
      sharedStrings.push(texts.join(''));
    }
  }
  var relsXml = await extract('xl/_rels/workbook.xml.rels');
  var relsMap = {};
  if (relsXml) {
    var relsText = new TextDecoder().decode(relsXml);
    var relRe = /<Relationship[^>]*Id="([^"]*)"[^>]*Target="([^"]*)"/g;
    var rm;
    while (rm = relRe.exec(relsText)) relsMap[rm[1]] = rm[2];
  }
  var wbXml = await extract('xl/workbook.xml');
  var sheetTarget = 'xl/worksheets/sheet1.xml';
  if (wbXml) {
    var wbText = new TextDecoder().decode(wbXml);
    var sm = wbText.match(/<sheet[^>]*r:id="([^"]*)"/);
    if (sm && relsMap[sm[1]]) {
      var t = relsMap[sm[1]];
      sheetTarget = t.startsWith('/') ? t.slice(1) : 'xl/' + t;
    }
  }
  var sheetXml = await extract(sheetTarget);
  if (!sheetXml) throw new Error('无法读取工作表');
  var sheetText = new TextDecoder().decode(sheetXml);
  var rows = [];
  var rowRe = /<row[^>]*>([\s\S]*?)<\/row>/g;
  var rowMatch;
  while (rowMatch = rowRe.exec(sheetText)) {
    var cells = [];
    var cellRe = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*?)\/>/g;
    var cm;
    while (cm = cellRe.exec(rowMatch[1])) {
      var attrs = (cm[1] !== undefined ? cm[1] : cm[3] || '');
      var content = cm[2] || '';
      var rMatch2 = attrs.match(/r="([A-Z]+)\d+"/);
      if (!rMatch2) continue;
      var col = rMatch2[1];
      var tMatch = attrs.match(/t="(\w+)"/);
      var type = tMatch ? tMatch[1] : '';
      var vMatch = content.match(/<v>([\s\S]*?)<\/v>/);
      var isMatch = content.match(/<is><t>([\s\S]*?)<\/t><\/is>/);
      var cellVal = '';
      if (isMatch) cellVal = isMatch[1];
      else if (type === 's' && vMatch) cellVal = sharedStrings[parseInt(vMatch[1])] || '';
      else if (type === 'str' && vMatch) cellVal = vMatch[1];
      else if (vMatch) cellVal = vMatch[1];
      cells.push({ col: col, val: cellVal });
    }
    if (cells.length > 0) {
      var maxIdx = cells.reduce(function(mx, c) { return Math.max(mx, colNameToIdx(c.col)); }, 0);
      var rowArr = new Array(maxIdx + 1).fill('');
      cells.forEach(function(c) { rowArr[colNameToIdx(c.col)] = c.val; });
      rows.push(rowArr);
    }
  }
  return rows;
}

async function importSizeExcel(event) {
  var file = event.target.files[0];
  if (!file) return;
  try {
    var rows = [];
    if (file.name.toLowerCase().endsWith('.csv')) {
      var text = await file.text();
      rows = parseCSV(text);
    } else if (file.name.toLowerCase().endsWith('.xlsx')) {
      rows = await parseXLSX(file);
    } else {
      showToast('请使用 .xlsx 或 .csv 格式', 'error');
      return;
    }
    if (rows.length === 0) { showToast('文件中未找到数据', 'error'); return; }
    var firstCell = (rows[0][0] || '').toString().trim();
    var isNewFormat = ['款号','日期','类型','PO号'].indexOf(firstCell) >= 0;
    if (isNewFormat) {
      var meta = {};
      var headerRowIdx = -1;
      for (var i = 0; i < Math.min(rows.length, 10); i++) {
        var key = (rows[i][0] || '').toString().trim();
        var val = (rows[i][1] || '').toString().trim();
        if (['款号','日期','类型','PO号'].indexOf(key) >= 0) {
          meta[key] = val;
        } else if (key === '部位编号' || key === '部位' || (rows[i].length >= 4 && rows[i].slice(0,4).some(function(c) { return ['部位编号','测量部位','中文名称','公差'].indexOf((c||'').toString().trim()) >= 0; }))) {
          headerRowIdx = i;
          break;
        }
      }
      if (headerRowIdx === -1) {
        for (var i2 = 0; i2 < rows.length; i2++) {
          if ((rows[i2][0] || '').toString().trim() === '部位编号') { headerRowIdx = i2; break; }
        }
      }
      if (headerRowIdx === -1) { showToast('未找到尺寸表表头（部位编号）', 'error'); return; }
      var header = rows[headerRowIdx];
      var dataRows = rows.slice(headerRowIdx + 1).filter(function(r) { return r.some(function(c) { return c && c.toString().trim(); }); }).map(function(r) { return r.map(function(c) { return roundNum(c); }); });
      sizeTableData = { meta: meta, header: header, dataRows: dataRows };
    } else {
      sizeTableData = { meta: {}, header: rows[0], dataRows: rows.slice(1).filter(function(r) { return r.some(function(c) { return c && c.toString().trim(); }); }).map(function(r) { return r.map(function(c) { return roundNum(c); }); }) };
      if (rows.length > 1) {
        var header2 = rows[0];
        var r0 = rows[1];
        var colMap = {};
        header2.forEach(function(h, i) { colMap[(h||'').toString().trim()] = i; });
        if (colMap['款号'] !== undefined && r0[colMap['款号']]) sizeTableData.meta['款号'] = r0[colMap['款号']].trim();
        if (colMap['日期'] !== undefined && r0[colMap['日期']]) sizeTableData.meta['日期'] = r0[colMap['日期']].trim();
        if (colMap['类型'] !== undefined && r0[colMap['类型']]) sizeTableData.meta['类型'] = r0[colMap['类型']].trim();
        if (colMap['PO号'] !== undefined && r0[colMap['PO号']]) sizeTableData.meta['PO号'] = r0[colMap['PO号']].trim();
      }
    }
    renderSizeTable(sizeTableData);
    var meta2 = sizeTableData.meta || {};
    if (meta2['款号']) { var el = $('sr-h-style'); if (el) el.value = meta2['款号']; }
    if (meta2['PO号']) { var el2 = $('sr-h-order'); if (el2) el2.value = meta2['PO号']; }
    if (meta2['日期']) {
      var dateVal = meta2['日期'].toString().trim();
      if (/^\d+$/.test(dateVal) && parseInt(dateVal) > 20000 && parseInt(dateVal) < 80000) {
        var serial = parseInt(dateVal);
        var dt = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
        dateVal = dt.getUTCFullYear() + '/' + String(dt.getUTCMonth()+1).padStart(2,'0') + '/' + String(dt.getUTCDate()).padStart(2,'0');
      }
      var dateStr = dateVal.replace(/\//g, '-');
      var parts = dateStr.split('-');
      if (parts.length === 3) {
        var yyyy = parts[0].padStart(4, '0');
        var mm = parts[1].padStart(2, '0');
        var dd = parts[2].padStart(2, '0');
        var el3 = $('sr-h-date'); if (el3) el3.value = yyyy + '-' + mm + '-' + dd;
      }
    }
    if (meta2['类型']) {
      var typeVal = meta2['类型'].trim();
      var sel = $('sr-h-type');
      if (sel) {
        var opt = null;
        for (var oi = 0; oi < sel.options.length; oi++) {
          if (sel.options[oi].value === typeVal) { opt = sel.options[oi]; break; }
        }
        if (opt) sel.value = typeVal;
      }
    }
    showToast('尺寸表导入成功', 'success');
  } catch(e) {
    showToast('导入失败: ' + e.message, 'error');
  }
  event.target.value = '';
}

function renderSizeTable(data) {
  var container2 = $('sr-sizeTableContainer');
  if (!container2) return;
  if (!data) {
    container2.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);"><div style="font-size:36px;margin-bottom:8px;">📊</div><p>请导入Excel文件以显示尺寸表</p></div>';
    return;
  }
  var meta, header, dataRows;
  if (Array.isArray(data)) {
    header = data[0];
    dataRows = data.slice(1);
    meta = {};
  } else {
    meta = data.meta || {};
    header = data.header || [];
    dataRows = data.dataRows || [];
  }
  if (!header || header.length === 0 || dataRows.length === 0) {
    container2.innerHTML = '<div style="text-align:center;padding:40px;color:var(--text-light);"><div style="font-size:36px;margin-bottom:8px;">📊</div><p>请导入Excel文件以显示尺寸表</p></div>';
    return;
  }
  var colMap = {};
  header.forEach(function(h, i) { colMap[(h||'').toString().trim()] = i; });
  var enCol = colMap['测量部位'] !== undefined ? colMap['测量部位'] : colMap['英文名称'];
  var known = ['PO号','款号','类型','日期','部位编号','测量部位','英文名称','中文名称','公差'];
  var sizeColIdx = [];
  header.forEach(function(h, i) { if (h && known.indexOf(h.toString().trim()) < 0) sizeColIdx.push(i); });
  var html = '<div class="size-info-bar">';
  ['款号','日期','类型','PO号'].forEach(function(name) {
    if (meta[name]) html += '<span><b>' + name + '：</b>' + esc(meta[name]) + '</span>';
  });
  if (html === '<div class="size-info-bar">') html += '<span style="color:var(--text-light);">无元数据</span>';
  html += '</div>';
  html += '<div style="overflow-x:auto;"><table class="size-table"><thead><tr>';
  html += '<th>部位编号</th><th style="min-width:120px;">测量部位</th><th>中文名称</th><th>公差</th>';
  sizeColIdx.forEach(function(i) { html += '<th>' + esc(header[i]) + '</th>'; });
  html += '</tr></thead><tbody>';
  dataRows.forEach(function(row) {
    html += '<tr>';
    html += '<td>' + esc(row[colMap['部位编号']]||'') + '</td>';
    html += '<td style="text-align:left;white-space:normal;">' + esc(row[enCol]||'') + '</td>';
    html += '<td style="text-align:left;">' + esc(row[colMap['中文名称']]||'') + '</td>';
    html += '<td>' + esc(row[colMap['公差']]||'') + '</td>';
    sizeColIdx.forEach(function(i) { html += '<td>' + esc(row[i]||'') + '</td>'; });
    html += '</tr>';
  });
  html += '</tbody></table></div>';
  container2.innerHTML = html;
}

// ===== Print =====
function printReport() {
  var d = {
    date: $('sr-h-date').value,
    deadline: $('sr-h-deadline').value,
    style: $('sr-h-style').value,
    order: $('sr-h-order').value,
    product: $('sr-h-product').value,
    size: $('sr-h-size').value,
    qty: $('sr-h-qty').value,
    factory: $('sr-h-factory').value,
    type: $('sr-h-type').value
  };
  var dateStr = d.date ? formatDate(d.date) : '';
  var deadlineStr = d.deadline ? formatDate(d.deadline) : '';
  var origTitle = document.title;
  document.title = (d.style||'') + '_样衣安排及意见_' + (d.date||'').replace(/-/g,'');
  var html = '';
  html += '<table class="print-lh"><tr>' +
    '<td class="lh-side"></td>' +
    '<td style="text-align:center;">' +
      '<div class="lh-cn">江苏舜天汉唐贸易有限公司</div>' +
      '<div class="lh-en">JIANGSU SAINTY HANTANG TRADING CO., LTD</div>' +
    '</td>' +
    '<td class="lh-side"></td>' +
  '</tr></table>';
  html += '<div class="lh-double-line"><div class="lh-line-blue"></div><div class="lh-line-gold"></div></div>';
  html += '<div class="print-title-deco">' +
    '<div class="deco-line"></div><div class="deco-diamond"></div>' +
    '<div class="print-report-title" style="margin:0;">样衣安排及意见</div>' +
    '<div class="deco-diamond"></div><div class="deco-line-r"></div>' +
  '</div>';
  html += '<div style="margin-bottom:3mm;border-left:4px solid #c9a84c;background:linear-gradient(90deg,#fdf8ed,#fff);padding:6px 12px;border-radius:0 4px 4px 0;">' +
    '<div style="text-align:left;font-size:16pt;font-weight:700;color:#1a3a6b;">服装厂：' + esc(d.factory) + '—</div>' +
  '</div>';
  var fieldSpan = function(label, val) {
    return label + '：<span style="display:inline-block;border:1.5pt solid #1a3a6b;border-radius:4px;padding:2px 6px;min-width:24px;font-weight:600;color:#1a3a6b;background:#f8faff;">' + esc(val) + '—</span>';
  };
  html += '<table style="width:100%;border-collapse:collapse;margin-bottom:2mm;"><tr>';
  html += '<td style="text-align:left;font-size:10pt;padding:4px 8px;white-space:nowrap;">' + fieldSpan('寄样日期', dateStr) + '</td>';
  html += '<td style="text-align:left;font-size:10pt;padding:4px 8px;white-space:nowrap;">' + fieldSpan('要求收到样衣日期', deadlineStr) + '</td>';
  html += '<td style="text-align:left;font-size:10pt;padding:4px 8px;white-space:nowrap;">' + fieldSpan('样衣类型', d.type) + '</td>';
  html += '</tr></table>';
  var otherFields = [
    ['款号', d.style], ['订单号', d.order], ['品名', d.product], ['尺码', d.size], ['件数', d.qty]
  ];
  var fieldTd = function(item) {
    return '<td style="text-align:left;font-size:10pt;padding:4px 8px;white-space:nowrap;">' + fieldSpan(item[0], item[1]) + '</td>';
  };
  html += '<table style="width:100%;border-collapse:collapse;margin-bottom:5mm;"><tr>';
  html += otherFields.map(fieldTd).join('');
  html += '</tr></table>';
  var mats = collectMaterials();
  if (mats.length > 0) {
    html += '<div class="print-section-header"><div class="sh-bar"></div><div class="sh-title">材料清单</div><div class="sh-line"></div></div>';
    html += '<table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:4mm;">';
    html += '<thead><tr style="background:#1a3a6b;color:#fff;">';
    ['材料','大货标准','规格','颜色','单耗','数量','备用数','备注'].forEach(function(k) {
      html += '<th style="border:1px solid #1a3a6b;padding:4px 3px;text-align:center;font-weight:600;">' + k + '</th>';
    });
    html += '</tr></thead><tbody>';
    mats.forEach(function(m, idx) {
      var rowBg = idx % 2 === 0 ? '#fff' : '#f5f7fb';
      html += '<tr style="background:' + rowBg + ';">' +
        ['材料','大货标准','规格','颜色','单耗','数量','备用数','备注'].map(function(k) {
          return '<td style="border:1px solid #c9a84c;padding:3px;">' + esc(m[k]||'') + '</td>';
        }).join('') +
      '</tr>';
    });
    html += '</tbody></table>';
  }
  var cats = ['design','dim','work','fabric','acc','pack','wash','test','other'];
  var hasComments = false;
  cats.forEach(function(cat) {
    var catComments = comments.filter(function(c) { return c.category === cat; });
    if (catComments.length === 0) return;
    hasComments = true;
    html += '<div style="page-break-inside:avoid;">';
    html += '<div style="margin:5mm 0 3mm;">' +
      '<div style="display:flex;align-items:center;gap:8px;">' +
        '<div style="width:5px;height:24px;background:linear-gradient(180deg,#1a3a6b,#c9a84c);border-radius:2px;"></div>' +
        '<div style="background:#dc2626;color:#fff;padding:5px 18px;font-size:13pt;font-weight:700;border-radius:8px;letter-spacing:2px;">' + CAT_NAMES[cat] + '</div>' +
        '<div style="flex:1;height:1.5px;background:linear-gradient(90deg,#c9a84c,transparent);"></div>' +
        '<div style="font-size:11pt;color:#c9a84c;font-weight:700;white-space:nowrap;">' + catComments.length + ' 条</div>' +
      '</div>' +
    '</div>';
    catComments.forEach(function(c, i) {
      var sevText = {high:'高',medium:'中',low:'低'}[c.severity] || '中';
      var sevColor = {high:'#dc2626',medium:'#d97706',low:'#16a34a'}[c.severity] || '#d97706';
      var isSimple = (cat === 'test' || cat === 'other');
      html += '<div style="border-left:3px solid #c9a84c;border-top:1px solid #e8eef5;border-bottom:1px solid #e8eef5;background:linear-gradient(135deg,#fafbfd,#f5f7fb);border-radius:0 6px 6px 0;padding:10px 14px;margin-bottom:10px;page-break-inside:avoid;">' +
        '<div style="font-size:12pt;margin-bottom:6px;display:flex;justify-content:space-between;align-items:center;">' +
          '<span style="color:#1a3a6b;"><b>' + (i+1) + '.</b>' + (isSimple ? '' : ' ' + getLocLabel(cat) + '：<b>' + escBR(c.location) + '—</b>') + '</span>' +
          '<span style="font-size:11pt;background:' + sevColor + ';color:#fff;padding:2px 12px;border-radius:12px;font-weight:600;">严重程度：' + sevText + '</span>' +
        '</div>';
      if (!isSimple && c.description && c.description.trim()) {
        html += '<div style="font-size:12pt;margin-bottom:6px;line-height:1.6;white-space:pre-wrap;"><b style="color:#1a3a6b;">问题描述：</b>' + escBR(c.description) + '</div>';
      }
      if (c.suggestion && c.suggestion.trim()) {
        html += '<div style="font-size:12pt;margin-bottom:6px;line-height:1.6;white-space:pre-wrap;"><b style="color:#1a3a6b;">' + (isSimple ? '说明' : '意见') + '：</b>' + escBR(c.suggestion) + '</div>';
      }
      if (c.images.length > 0) {
        html += '<div style="margin-top:6px;">';
        c.images.forEach(function(img) {
          var psize = imgPrintSize(img);
          var widths = {full:'100%',half:'50%',third:'33%',quarter:'25%'};
          var w = widths[psize] || '100%';
          html += '<img src="' + imgSrc(img) + '" class="print-comment-img" style="width:' + w + ';height:auto;border:1px solid #c9a84c;border-radius:4px;margin-bottom:6px;display:block;">';
        });
        html += '</div>';
      }
      html += '</div>';
    });
    html += '</div>';
  });
  if (!hasComments) html += '<div style="text-align:center;padding:20px;color:#64748b;">暂无修改意见</div>';
  if (sizeTableData) {
    var stMeta, stHeader, stDataRows;
    if (Array.isArray(sizeTableData)) {
      stHeader = sizeTableData[0];
      stDataRows = sizeTableData.slice(1);
      stMeta = {};
    } else {
      stMeta = sizeTableData.meta || {};
      stHeader = sizeTableData.header || [];
      stDataRows = sizeTableData.dataRows || [];
    }
    if (stHeader && stHeader.length > 0 && stDataRows.length > 0) {
      var colMap2 = {};
      stHeader.forEach(function(h, i) { colMap2[(h||'').toString().trim()] = i; });
      var enCol2 = colMap2['测量部位'] !== undefined ? colMap2['测量部位'] : colMap2['英文名称'];
      var known2 = ['PO号','款号','类型','日期','部位编号','测量部位','英文名称','中文名称','公差'];
      var sizeColIdx2 = [];
      stHeader.forEach(function(h, i) { if (h && known2.indexOf(h.toString().trim()) < 0) sizeColIdx2.push(i); });
      html += '<div class="page-break"></div>';
      html += '<div class="print-section-header"><div class="sh-bar"></div><div class="sh-title">尺寸表</div><div class="sh-line"></div></div>';
      html += '<table style="width:100%;border-collapse:collapse;margin-bottom:4mm;font-size:10pt;border-left:3px solid #c9a84c;background:#fdf8ed;"><tr>';
      ['款号','日期','类型','PO号'].forEach(function(name) {
        if (stMeta[name]) html += '<td style="padding:4px 10px;"><b style="color:#1a3a6b;">' + name + '：</b>' + esc(stMeta[name]) + '</td>';
      });
      html += '</tr></table>';
      html += '<table style="width:100%;border-collapse:collapse;font-size:9px;">';
      html += '<thead><tr style="background:#1a3a6b;color:#fff;">';
      html += '<th style="border:1px solid #1a3a6b;padding:3px 3px;text-align:center;">部位编号</th>';
      html += '<th style="border:1px solid #1a3a6b;padding:3px 3px;min-width:100px;text-align:center;">测量部位</th>';
      html += '<th style="border:1px solid #1a3a6b;padding:3px 3px;text-align:center;">中文名称</th>';
      html += '<th style="border:1px solid #1a3a6b;padding:3px 3px;text-align:center;">公差</th>';
      sizeColIdx2.forEach(function(i) { html += '<th style="border:1px solid #1a3a6b;padding:3px 3px;text-align:center;">' + esc(stHeader[i]) + '</th>'; });
      html += '</tr></thead><tbody>';
      stDataRows.forEach(function(row, ri) {
        var rowBg = ri % 2 === 1 ? '#fff' : '#f5f7fb';
        html += '<tr style="background:' + rowBg + ';">';
        html += '<td style="border:1px solid #c9a84c;padding:2px 3px;text-align:center;">' + esc(row[colMap2['部位编号']]||'') + '</td>';
        html += '<td style="border:1px solid #c9a84c;padding:2px 3px;text-align:left;">' + esc(row[enCol2]||'') + '</td>';
        html += '<td style="border:1px solid #c9a84c;padding:2px 3px;text-align:left;">' + esc(row[colMap2['中文名称']]||'') + '</td>';
        html += '<td style="border:1px solid #c9a84c;padding:2px 3px;text-align:center;">' + esc(row[colMap2['公差']]||'') + '</td>';
        sizeColIdx2.forEach(function(i) { html += '<td style="border:1px solid #c9a84c;padding:2px 3px;text-align:center;">' + esc(row[i]||'') + '</td>'; });
        html += '</tr>';
      });
      html += '</tbody></table>';
    }
  }
  var printArea = $('sr-printArea');
  var today = new Date();
  var printDate = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
  var dynStyle = $('sr-dynamicPrintStyle');
  if (!dynStyle) { dynStyle = document.createElement('style'); dynStyle.id = 'sr-dynamicPrintStyle'; document.head.appendChild(dynStyle); }
  dynStyle.textContent = '@page{margin:15mm 15mm 18mm 15mm;@bottom-left{content:"打印日期：' + printDate + '";font-size:9pt;color:#1a3a6b;}@bottom-center{content:"第 " counter(page) " 页 / 共 " counter(pages) " 页";font-size:9pt;color:#1a3a6b;}@bottom-right{content:"联系人：陈娟";font-size:9pt;color:#c9a84c;font-weight:600;}}';
  if (printArea) {
    printArea.innerHTML = html;
    printArea.style.display = 'block';
  }
  var toastEl = $('sr-toast');
  if (toastEl) toastEl.classList.remove('show');
  var cleanup = function() {
    dynStyle.remove();
    document.title = origTitle;
    if (printArea) { printArea.style.display = 'none'; printArea.innerHTML = ''; }
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  window.print();
  setTimeout(cleanup, 1000);
}

// ===== Init =====
function init(containerId) {
  container = document.getElementById(containerId || 'sampleReviewContainer');
  if (!container) {
    console.error('[SampleReview] Container not found:', containerId);
    return;
  }
  ns.container = container;
  annotState = {
    tool: 'arrow', color: '#ff0000', lineWidth: 3, shapes: [],
    isDrawing: false, startX: 0, startY: 0,
    canvas: null, ctx: null, img: null,
    editingCommentId: null, editingImageIdx: -1,
    isMoving: false, movingShapeIdx: -1, moveLastX: 0, moveLastY: 0,
    isAdjustingCurve: false, lastClickInfo: null
  };

  // Render HTML structure
  container.innerHTML = getTemplate();

  // Load records from storage
  records = getRecords();

  // Initialize form
  var today = new Date().toISOString().split('T')[0];
  var dateEl = $('sr-h-date');
  if (dateEl) dateEl.value = today;
  addMatRow();
  renderComments();

  // Set up event listeners
  setupEventListeners();

  // Expose public API
  ns.switchTab = switchTab;
  ns.addComment = addComment;
  ns.deleteComment = deleteComment;
  ns.updateComment = updateComment;
  ns.deleteImage = deleteImage;
  ns.setImagePrintSize = setImagePrintSize;
  ns.filterCategory = filterCategory;
  ns.renderComments = renderComments;
  ns.openAnnotModal = openAnnotModal;
  ns.closeAnnotModal = closeAnnotModal;
  ns.setAnnotTool = setAnnotTool;
  ns.loadAnnotImage = loadAnnotImage;
  ns.saveAnnotImage = saveAnnotImage;
  ns.saveRecord = saveRecord;
  ns.editRecord = editRecord;
  ns.deleteRecord = deleteRecord;
  ns.renderRecords = renderRecords;
  ns.clearForm = clearForm;
  ns.importSizeExcel = importSizeExcel;
  ns.parseCSV = parseCSV;
  ns.parseXLSX = parseXLSX;
  ns.renderSizeTable = renderSizeTable;
  ns.printReport = printReport;
  ns.formatDate = formatDate;
  ns.showToast = showToast;
  ns.undoAnnot = undoAnnot;
  ns.clearAnnot = clearAnnot;
  ns.getRecords = getRecords;
  ns.setRecords = setRecords;
}

function getTemplate() {
  return '' +
  '<style>' +
  '.sr-app-banner{background:linear-gradient(135deg,#0f2950 0%,#1a3a6b 50%,#2a4a7a 100%);padding:14px 24px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;border-bottom:3px solid #c9a84c;}' +
  '.sr-app-banner::before{content:"";position:absolute;top:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,#c9a84c,transparent);}' +
  '.sr-app-banner::after{content:"";position:absolute;bottom:0;left:0;right:0;height:1px;background:linear-gradient(90deg,transparent,rgba(201,168,76,.4),transparent);}' +
  '.sr-banner-content{display:flex;align-items:center;gap:14px;position:relative;z-index:1;}' +
  '.sr-banner-icon{font-size:28px;color:#c9a84c;text-shadow:0 0 10px rgba(201,168,76,.5);line-height:1;}' +
  '.sr-banner-text{text-align:center;}' +
  '.sr-banner-title-cn{font-size:20px;font-weight:700;color:#fff;letter-spacing:4px;text-shadow:0 1px 2px rgba(0,0,0,.3);}' +
  '.sr-banner-title-en{font-size:9px;color:#c9a84c;letter-spacing:3px;margin-top:2px;opacity:.85;}' +
  '.sr-banner-deco-left,.sr-banner-deco-right{width:60px;height:2px;background:linear-gradient(90deg,transparent,#c9a84c);}' +
  '.sr-banner-deco-right{background:linear-gradient(90deg,#c9a84c,transparent);}' +
  '.sr-tab-bar{display:flex;background:#fff;border-bottom:2px solid var(--border);position:sticky;top:0;z-index:100;box-shadow:0 1px 3px rgba(0,0,0,.08);}' +
  '.sr-tab-btn{flex:1;padding:10px 16px;border:none;background:#f1f5f9;font-size:13px;font-weight:600;color:var(--text-light);cursor:pointer;border-bottom:3px solid transparent;transition:all .2s;display:flex;align-items:center;justify-content:center;gap:6px;}' +
  '.sr-tab-btn:hover{background:#e2e8f0;color:var(--text);}' +
  '.sr-tab-btn.active{color:#1a3a6b;border-bottom-color:#c9a84c;background:#fff;font-weight:700;}' +
  '.sr-tab-content{display:none;padding:16px 24px;}' +
  '.sr-tab-content.active{display:block;}' +
  '.sr-report-header{background:#fff;border-radius:8px;padding:16px 20px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.06);}' +
  '.sr-report-header h1{font-size:20px;font-weight:700;margin-bottom:12px;color:var(--primary);}' +
  '.sr-header-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:10px;}' +
  '.sr-header-grid.header-row{grid-template-columns:1.1fr 1fr 1.1fr 1fr 1.2fr 0.9fr 0.6fr 0.7fr 1.4fr;gap:8px;}' +
  '.sr-header-field{display:flex;flex-direction:column;gap:3px;}' +
  '.sr-header-field label{font-size:11px;font-weight:600;color:var(--text-light);}' +
  '.sr-header-field input,.sr-header-field select{padding:5px 8px;border:1px solid var(--border);border-radius:4px;font-size:12px;font-family:inherit;}' +
  '.sr-header-field input:focus{outline:none;border-color:var(--primary);}' +
  '.sr-section{background:var(--card-bg,#fff);border-radius:8px;padding:14px;margin-bottom:12px;box-shadow:0 1px 3px rgba(0,0,0,.05);}' +
  '.sr-section-title{font-size:14px;font-weight:700;margin-bottom:10px;padding-bottom:6px;border-bottom:2px solid var(--border);display:flex;align-items:center;gap:6px;}' +
  '.sr-cat-tabs{display:flex;gap:4px;margin-bottom:12px;flex-wrap:wrap;}' +
  '.sr-cat-tab{padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600;cursor:pointer;transition:all .2s;border:2px solid transparent;background:#fff;color:var(--text-light);}' +
  '.sr-cat-tab:hover{background:#f8fafc;}' +
  '.sr-cat-tab.active{color:#fff;border-color:transparent;}' +
  '.sr-cat-tab[data-cat="design"].active{background:#3b82f6;}' +
  '.sr-cat-tab[data-cat="dim"].active{background:#10b981;}' +
  '.sr-cat-tab[data-cat="work"].active{background:#f59e0b;}' +
  '.sr-cat-tab[data-cat="fabric"].active{background:#8b5cf6;}' +
  '.sr-cat-tab[data-cat="acc"].active{background:#78350f;}' +
  '.sr-cat-tab[data-cat="pack"].active{background:#475569;}' +
  '.sr-cat-tab[data-cat="wash"].active{background:#0891b2;}' +
  '.sr-cat-tab[data-cat="test"].active{background:#db2777;}' +
  '.sr-cat-tab[data-cat="other"].active{background:#9ca3af;}' +
  '.sr-cat-tab[data-cat="all"].active{background:#dc2626;color:#fff;border-color:transparent;}' +
  '.sr-comment-images{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}' +
  '.sr-search-bar{margin-bottom:12px;}' +
  '.sr-search-bar input{width:100%;padding:8px 12px;border:1px solid var(--border);border-radius:4px;font-size:13px;font-family:inherit;}' +
  '.sr-search-bar input:focus{outline:none;border-color:var(--primary);}' +
  '.sr-size-info-bar{display:flex;gap:20px;padding:10px 16px;background:#f1f5f9;border-radius:6px;margin-bottom:10px;font-size:12px;flex-wrap:wrap;}' +
  '.sr-size-info-bar b{color:var(--text);}' +
  '.sr-modal-overlay{display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);z-index:300;align-items:center;justify-content:center;}' +
  '.sr-modal-overlay.show{display:flex;}' +
  '.sr-annot-modal{background:#fff;border-radius:0;padding:12px 16px;width:100%;height:100%;overflow:hidden;box-shadow:none;display:flex;flex-direction:column;}' +
  '.sr-annot-modal h3{font-size:15px;margin-bottom:10px;}' +
  '.sr-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:10px 20px;border-radius:6px;font-size:13px;color:#fff;z-index:400;opacity:0;transition:opacity .3s;pointer-events:none;}' +
  '.sr-toast.show{opacity:1;}' +
  '.sr-toast.success{background:#16a34a;}' +
  '.sr-toast.error{background:#dc2626;}' +
  '.sr-toast.info{background:#1a56db;}' +
  '.toolbar{display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;align-items:center;}' +
  '.btn{padding:6px 14px;border:none;border-radius:4px;font-size:12px;font-weight:600;cursor:pointer;transition:all .15s;display:inline-flex;align-items:center;gap:4px;font-family:inherit;}' +
  '.btn-primary{background:#1a3a6b;color:#fff;} .btn-primary:hover{background:#0f2950;}' +
  '.btn-success{background:#16a34a;color:#fff;} .btn-success:hover{background:#15803d;}' +
  '.btn-danger{background:#dc2626;color:#fff;} .btn-danger:hover{background:#b91c1c;}' +
  '.btn-outline{background:#fff;border:1px solid var(--border,#e5e7eb);color:var(--ink,#1a1a1a);} .btn-outline:hover{background:#f8fafc;border-color:#1a3a6b;}' +
  '.btn-sm{padding:3px 8px;font-size:11px;}' +
  '.sr-section .toolbar{margin-bottom:0;}' +
  '.mat-table{width:100%;border-collapse:collapse;font-size:12px;}' +
  '.mat-table th{background:#f1f5f9;padding:5px 8px;border:1px solid var(--border,#e5e7eb);text-align:center;font-weight:600;white-space:nowrap;}' +
  '.mat-table td{padding:2px;border:1px solid var(--border,#e5e7eb);}' +
  '.mat-table td input,.mat-table td select{width:100%;border:1px solid transparent;font-size:12px;padding:4px 5px;background:transparent;font-family:inherit;}' +
  '.mat-table td input:focus{outline:none;border-color:#1a3a6b;background:#fff;}' +
  '.comment-card{background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:12px;margin-bottom:10px;position:relative;transition:box-shadow .2s;}' +
  '.comment-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.08);}' +
  '.cat-badge{display:inline-block;padding:2px 10px;border-radius:10px;font-size:10px;font-weight:700;color:#fff;margin-bottom:8px;}' +
  '.cat-badge[data-cat="design"]{background:#3b82f6;}' +
  '.cat-badge[data-cat="dim"]{background:#10b981;}' +
  '.cat-badge[data-cat="work"]{background:#f59e0b;}' +
  '.cat-badge[data-cat="fabric"]{background:#8b5cf6;}' +
  '.cat-badge[data-cat="acc"]{background:#78350f;}' +
  '.cat-badge[data-cat="pack"]{background:#475569;}' +
  '.cat-badge[data-cat="wash"]{background:#0891b2;}' +
  '.cat-badge[data-cat="test"]{background:#db2777;}' +
  '.cat-badge[data-cat="other"]{background:#9ca3af;}' +
  '.comment-grid{display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px;}' +
  '.comment-field{display:flex;flex-direction:column;gap:3px;}' +
  '.comment-field label{font-size:10px;font-weight:600;color:var(--text-light,#64748b);}' +
  '.comment-field input,.comment-field select,.comment-field textarea{padding:5px 8px;border:1px solid var(--border,#e5e7eb);border-radius:4px;font-size:12px;font-family:inherit;}' +
  '.comment-field textarea{resize:vertical;min-height:40px;}' +
  '.comment-field input:focus,.comment-field textarea:focus,.comment-field select:focus{outline:none;border-color:#1a3a6b;}' +
  '.comment-field.full{grid-column:1/-1;}' +
  '.severity-high{color:#dc2626;font-weight:700;}' +
  '.severity-medium{color:#d97706;font-weight:700;}' +
  '.severity-low{color:#16a34a;font-weight:700;}' +
  '.comment-images{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px;}' +
  '.comment-img-wrap{position:relative;width:120px;border:1px solid var(--border,#e5e7eb);border-radius:4px;overflow:visible;background:#fff;}' +
  '.comment-img-wrap img{width:100%;height:120px;object-fit:cover;cursor:pointer;display:block;border-radius:4px 4px 0 0;}' +
  '.img-del{position:absolute;top:2px;right:2px;background:rgba(220,38,38,.9);color:#fff;border:none;border-radius:50%;width:18px;height:18px;font-size:11px;cursor:pointer;line-height:1;z-index:2;}' +
  '.img-edit{position:absolute;bottom:24px;right:2px;background:rgba(37,99,235,.9);color:#fff;border:none;border-radius:3px;padding:2px 6px;font-size:10px;cursor:pointer;z-index:2;}' +
  '.img-print-size{display:block;width:100%;border:none;border-top:1px solid var(--border,#e5e7eb);font-size:10px;padding:2px 4px;cursor:pointer;background:#f8fafc;color:#1a3a6b;border-radius:0 0 4px 4px;outline:none;}' +
  '.comment-actions{display:flex;gap:6px;margin-top:8px;}' +
  '.record-card{background:#fff;border:1px solid var(--border,#e5e7eb);border-radius:8px;padding:12px;margin-bottom:10px;box-shadow:0 1px 3px rgba(0,0,0,.05);}' +
  '.rec-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;padding-bottom:6px;border-bottom:1px solid var(--border,#e5e7eb);}' +
  '.rec-title{font-weight:700;color:#1a3a6b;font-size:14px;}' +
  '.rec-date{font-size:11px;color:var(--text-light,#64748b);}' +
  '.rec-info{display:flex;flex-wrap:wrap;gap:6px;font-size:11px;color:var(--text,#1a1a1a);margin-bottom:8px;}' +
  '.rec-info span{background:#f1f5f9;padding:2px 6px;border-radius:3px;}' +
  '.rec-info b{color:#1a3a6b;}' +
  '.rec-footer{display:flex;justify-content:space-between;align-items:center;padding-top:6px;border-top:1px solid var(--border,#e5e7eb);font-size:11px;color:var(--text-light,#64748b);}' +
  '.size-table{width:100%;border-collapse:collapse;font-size:12px;}' +
  '.size-table th{background:#f1f5f9;padding:6px 8px;border:1px solid var(--border,#e5e7eb);text-align:center;font-weight:600;white-space:nowrap;color:var(--ink,#1a1a1a);}' +
  '.size-table td{padding:4px 6px;border:1px solid var(--border,#e5e7eb);text-align:center;}' +
  '.size-info-bar{display:flex;gap:20px;padding:10px 16px;background:#f1f5f9;border-radius:6px;margin-bottom:10px;font-size:12px;flex-wrap:wrap;}' +
  '.size-info-bar b{color:var(--ink,#1a1a1a);}' +
  '.annot-toolbar{display:flex;gap:6px;margin-bottom:10px;flex-wrap:wrap;align-items:center;}' +
  '.annot-tool{padding:5px 10px;border:1px solid var(--border,#e5e7eb);border-radius:4px;font-size:12px;cursor:pointer;background:#fff;font-family:inherit;}' +
  '.annot-tool.active{background:#1a3a6b;color:#fff;border-color:#1a3a6b;}' +
  '.annot-tool:hover:not(.active){background:#f8fafc;}' +
  '.annot-color{width:28px;height:28px;border:2px solid var(--border,#e5e7eb);border-radius:4px;cursor:pointer;padding:0;}' +
  '.annot-canvas-wrap{border:2px dashed var(--border,#e5e7eb);border-radius:4px;min-height:200px;display:flex;align-items:center;justify-content:center;overflow:auto;flex:1;position:relative;}' +
  '.annot-canvas-wrap canvas{max-width:100%;cursor:crosshair;}' +
  '.annot-upload-prompt{text-align:center;color:var(--text-light,#64748b);padding:40px;}' +
  '@media print{.sr-tab-bar,.sr-tab-content,.toolbar,.sr-cat-tabs,.sr-search-bar,.sr-modal-overlay{display:none!important;}.sr-print-area{display:block!important;max-width:180mm;overflow:hidden;padding:0;margin:0;}body{background:#fff;font-size:11px;margin:0;padding:0;}html{margin:15mm 15mm 18mm 15mm;}.sr-app-banner{display:none;}}' +
  '</style>' +

  '<div class="sr-app-banner">' +
    '<div class="sr-banner-deco-left"></div>' +
    '<div class="sr-banner-content">' +
      '<div class="sr-banner-icon">✂</div>' +
      '<div class="sr-banner-text">' +
        '<div class="sr-banner-title-cn">样衣意见制作程序</div>' +
        '<div class="sr-banner-title-en">SAMPLE REVIEW & COMMENT SYSTEM</div>' +
      '</div>' +
      '<div class="sr-banner-deco-right"></div>' +
    '</div>' +
  '</div>' +

  '<div class="sr-tab-bar">' +
    '<button class="sr-tab-btn active" data-sr-tab="entry">✏ 信息录入</button>' +
    '<button class="sr-tab-btn" data-sr-tab="size">📏 尺寸表</button>' +
    '<button class="sr-tab-btn" data-sr-tab="info">📋 样衣记录</button>' +
  '</div>' +

  '<div id="sr-tab-entry" class="sr-tab-content active">' +
    '<div class="sr-report-header">' +
      '<h1>样衣安排及意见</h1>' +
      '<div class="sr-header-grid" style="grid-template-columns:1fr;margin-bottom:8px;">' +
        '<div class="sr-header-field"><label>服装厂</label><input id="sr-h-factory" style="border:none;font-size:18px;font-weight:600;background:#fef3c7;padding:4px 8px;border-radius:4px;"></div>' +
      '</div>' +
      '<div class="sr-header-grid header-row" style="grid-template-columns:auto auto;margin-bottom:8px;gap:24px;">' +
        '<div class="sr-header-field"><label>寄样日期</label><input id="sr-h-date" type="date" style="width:auto;min-width:150px;"></div>' +
        '<div class="sr-header-field"><label>要求收到样衣日期</label><input id="sr-h-deadline" type="date" style="width:auto;min-width:150px;"></div>' +
      '</div>' +
      '<div class="sr-header-grid header-row" style="grid-template-columns:0.8fr 1fr 1.1fr 1fr 1fr 0.7fr 0.8fr;">' +
        '<div class="sr-header-field"><label>样衣类型</label><select id="sr-h-type"><option value="">请选择</option><option value="头样">头样</option><option value="尺码样">尺码样</option><option value="产前样">产前样</option><option value="船期">船期</option><option value="照片样">照片样</option><option value="封样">封样</option></select></div>' +
        '<div class="sr-header-field"><label>款号</label><input id="sr-h-style"></div>' +
        '<div class="sr-header-field"><label>订单号</label><input id="sr-h-order"></div>' +
        '<div class="sr-header-field"><label>品名</label><input id="sr-h-product"></div>' +
        '<div class="sr-header-field"><label>尺码</label><input id="sr-h-size"></div>' +
        '<div class="sr-header-field"><label>样衣数量</label><input id="sr-h-qty" type="number"></div>' +
      '</div>' +
    '</div>' +

    '<div class="sr-section">' +
      '<div class="sr-section-title">📦 材料清单</div>' +
      '<div style="overflow-x:auto;">' +
        '<table class="mat-table">' +
          '<thead><tr>' +
            '<th>材料</th><th style="width:55px;">大货标准</th><th>规格</th><th>颜色</th><th>单耗</th><th>数量</th><th>备用数</th><th style="min-width:160px;">备注</th><th style="width:40px;">操作</th>' +
          '</tr></thead>' +
          '<tbody id="sr-matBody"></tbody>' +
        '</table>' +
      '</div>' +
      '<button class="btn btn-outline btn-sm" style="margin-top:8px;" data-sr-add-mat>＋ 插入行</button>' +
    '</div>' +

    '<div class="toolbar">' +
      '<button class="btn btn-primary" data-sr-add-cmt>＋ 新增意见</button>' +
      '<button class="btn btn-success" data-sr-save>💾 保存</button>' +
      '<button class="btn btn-primary" data-sr-print>🖨 打印PDF</button>' +
    '</div>' +

    '<div class="sr-cat-tabs" id="sr-catTabs">' +
      '<div class="sr-cat-tab active" data-cat="all">全部</div>' +
      '<div class="sr-cat-tab" data-cat="design">设计</div>' +
      '<div class="sr-cat-tab" data-cat="dim">尺寸</div>' +
      '<div class="sr-cat-tab" data-cat="work">做工</div>' +
      '<div class="sr-cat-tab" data-cat="fabric">面料</div>' +
      '<div class="sr-cat-tab" data-cat="acc">辅料</div>' +
      '<div class="sr-cat-tab" data-cat="pack">包装</div>' +
      '<div class="sr-cat-tab" data-cat="wash">水洗</div>' +
      '<div class="sr-cat-tab" data-cat="test">测试要求</div>' +
      '<div class="sr-cat-tab" data-cat="other">其他</div>' +
    '</div>' +

    '<div id="sr-commentList"></div>' +
  '</div>' +

  '<div id="sr-tab-size" class="sr-tab-content">' +
    '<div class="sr-section">' +
      '<div class="sr-section-title">📏 尺寸表</div>' +
      '<div class="toolbar">' +
        '<button class="btn btn-primary" data-sr-import-size>📁 导入Excel</button>' +
        '<input type="file" id="sr-sizeFile" accept=".xlsx,.csv" style="display:none">' +
        '<span style="font-size:11px;color:var(--text-light);">支持 .xlsx 和 .csv 格式</span>' +
      '</div>' +
      '<div id="sr-sizeTableContainer">' +
        '<div style="text-align:center;padding:40px;color:var(--text-light);">' +
          '<div style="font-size:36px;margin-bottom:8px;">📊</div>' +
          '<p>请导入Excel文件以显示尺寸表</p>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</div>' +

  '<div id="sr-tab-info" class="sr-tab-content">' +
    '<div class="sr-section">' +
      '<div class="sr-section-title">📋 样衣记录</div>' +
      '<div class="sr-search-bar">' +
        '<input type="text" id="sr-searchInput" placeholder="搜索款号、订单号、品名、服装厂...">' +
      '</div>' +
      '<div id="sr-recordList"></div>' +
    '</div>' +
  '</div>' +

  '<div id="sr-printArea" style="display:none;"></div>' +

  '<div id="sr-toast"></div>' +

  '<div class="sr-modal-overlay" id="sr-annotModal">' +
    '<div class="sr-annot-modal">' +
      '<h3>图片标注</h3>' +
      '<div class="annot-toolbar">' +
        '<button class="annot-tool" data-sr-upload-annot>📁 上传图片</button>' +
        '<input type="file" id="sr-annotFile" accept="image/*" multiple style="display:none">' +
        '<span style="width:1px;height:20px;background:var(--border);margin:0 4px;"></span>' +
        '<button class="annot-tool active" data-tool="arrow" data-sr-tool="arrow">➤ 箭头</button>' +
        '<button class="annot-tool" data-tool="dashSingle" data-sr-tool="dashSingle">┄ 单虚线</button>' +
        '<button class="annot-tool" data-tool="curveDashed" data-sr-tool="curveDashed">∿ 弯曲虚线</button>' +
        '<button class="annot-tool" data-tool="curveSolid" data-sr-tool="curveSolid">〜 弯曲实线</button>' +
        '<button class="annot-tool" data-tool="dashDouble" data-sr-tool="dashDouble">═ 双虚线</button>' +
        '<button class="annot-tool" data-tool="doubleSolid" data-sr-tool="doubleSolid">≡ 双实线</button>' +
        '<button class="annot-tool" data-tool="solidLine" data-sr-tool="solidLine">─ 单实线</button>' +
        '<button class="annot-tool" data-tool="xLine" data-sr-tool="xLine">✕ X实线</button>' +
        '<button class="annot-tool" data-tool="fillRect" data-sr-tool="fillRect">▣ 实心框</button>' +
        '<button class="annot-tool" data-tool="dashRect" data-sr-tool="dashRect">▭ 虚线框</button>' +
        '<button class="annot-tool" data-tool="curve" data-sr-tool="curve">〜 弧长</button>' +
        '<button class="annot-tool" data-tool="dimLine" data-sr-tool="dimLine">↔ 直线长</button>' +
        '<button class="annot-tool" data-tool="text" data-sr-tool="text">📝 文字</button>' +
        '<button class="annot-tool" data-tool="strikeText" data-sr-tool="strikeText">S̶ 划线文字</button>' +
        '<button class="annot-tool" data-tool="textBox" data-sr-tool="textBox">▭ 文本框</button>' +
        '<button class="annot-tool" data-tool="callout" data-sr-tool="callout">💬 标注气泡</button>' +
        '<button class="annot-tool" data-tool="rect" data-sr-tool="rect">⬜ 矩形</button>' +
        '<button class="annot-tool" data-tool="circle" data-sr-tool="circle">⭕ 圆形</button>' +
        '<button class="annot-tool" data-tool="mosaic" data-sr-tool="mosaic">🔳 马赛克</button>' +
        '<span style="width:1px;height:20px;background:var(--border);margin:0 4px;"></span>' +
        '<button class="annot-tool" data-sr-rotate="-15">↺ -15°</button>' +
        '<button class="annot-tool" data-sr-rotate="15">↻ +15°</button>' +
        '<button class="annot-tool" data-sr-insert-img>🖼 插入图片</button>' +
        '<input type="file" id="sr-insertImgFile" accept="image/*" style="display:none">' +
        '<input type="color" class="annot-color" id="sr-annotColor" value="#ff0000" title="标注颜色">' +
        '<input type="range" id="sr-annotLineWidth" min="1" max="6" value="3" style="width:60px;" title="线宽">' +
      '</div>' +
      '<div class="annot-toolbar">' +
        '<button class="annot-tool" data-tool="move" data-sr-tool="move">✥ 移动</button>' +
        '<span style="width:1px;height:20px;background:var(--border);margin:0 4px;"></span>' +
        '<button class="annot-tool" data-sr-undo>↶ 撤销</button>' +
        '<button class="annot-tool" data-sr-clear>🗑 清除</button>' +
      '</div>' +
      '<div class="annot-canvas-wrap" id="sr-annotCanvasWrap">' +
        '<div class="annot-upload-prompt">请先上传图片，然后在图片上添加标注</div>' +
      '</div>' +
      '<div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px;">' +
        '<button class="btn btn-outline" data-sr-close-annot>取消</button>' +
        '<button class="btn btn-primary" data-sr-save-annot>保存标注图片</button>' +
      '</div>' +
    '</div>' +
  '</div>';
}

function setupEventListeners() {
  // Tab switching
  container.querySelectorAll('[data-sr-tab]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      switchTab(btn.getAttribute('data-sr-tab'));
    });
  });

  // Add material row
  container.querySelectorAll('[data-sr-add-mat]').forEach(function(btn) {
    btn.addEventListener('click', addMatRow);
  });

  // Material table delegation
  container.addEventListener('input', function(e) {
    var del = e.target.getAttribute('data-sr-mat');
    if (del !== null) {
      var field = e.target.getAttribute('data-field');
      updateMat(parseInt(del), field, e.target.value);
    }
  });
  container.addEventListener('change', function(e) {
    var del = e.target.getAttribute('data-sr-mat');
    if (del !== null) {
      var field = e.target.getAttribute('data-field');
      updateMat(parseInt(del), field, e.target.value);
    }
  });
  container.addEventListener('click', function(e) {
    var matDel = e.target.getAttribute('data-sr-mat-del');
    if (matDel !== null) {
      deleteMatRow(parseInt(matDel));
      return;
    }
  });

  // Comment buttons
  var addCmtBtn = container.querySelector('[data-sr-add-cmt]');
  if (addCmtBtn) addCmtBtn.addEventListener('click', addComment);

  var saveBtn = container.querySelector('[data-sr-save]');
  if (saveBtn) saveBtn.addEventListener('click', saveRecord);

  var printBtn = container.querySelector('[data-sr-print]');
  if (printBtn) printBtn.addEventListener('click', printReport);

  // Comment delegation
  container.addEventListener('input', function(e) {
    var cmtId = e.target.getAttribute('data-sr-cmt');
    if (cmtId) {
      var field = e.target.getAttribute('data-field');
      updateComment(cmtId, field, e.target.value);
    }
  });
  container.addEventListener('change', function(e) {
    var cmtId = e.target.getAttribute('data-sr-cmt');
    if (cmtId) {
      var field = e.target.getAttribute('data-field');
      updateComment(cmtId, field, e.target.value);
    }
  });
  container.addEventListener('click', function(e) {
    var delCmt = e.target.getAttribute('data-sr-del-cmt');
    if (delCmt) { deleteComment(delCmt); return; }
    var addImg = e.target.getAttribute('data-sr-add-img');
    if (addImg) { openAnnotModal(addImg, -1); return; }
    var imgDel = e.target.getAttribute('data-sr-img-del-cid');
    if (imgDel) { deleteImage(imgDel, parseInt(e.target.getAttribute('data-sr-img-del-idx'))); return; }
    var imgEdit = e.target.getAttribute('data-sr-img-edit-cid');
    if (imgEdit) { openAnnotModal(imgEdit, parseInt(e.target.getAttribute('data-sr-img-edit-idx'))); return; }
    var recEdit = e.target.getAttribute('data-sr-rec');
    if (recEdit) { editRecord(recEdit); return; }
    var recDel = e.target.getAttribute('data-sr-del-rec');
    if (recDel) { deleteRecord(recDel); return; }
  });
  container.addEventListener('change', function(e) {
    var imgSizeCid = e.target.getAttribute('data-sr-img-size-cid');
    if (imgSizeCid) {
      setImagePrintSize(imgSizeCid, parseInt(e.target.getAttribute('data-sr-img-size-idx')), e.target.value);
      return;
    }
  });

  // Category tabs
  container.querySelectorAll('.sr-cat-tab').forEach(function(tab) {
    tab.addEventListener('click', function() {
      filterCategory(tab.getAttribute('data-cat'), tab);
    });
  });

  // Search input
  var searchEl = $('sr-searchInput');
  if (searchEl) {
    searchEl.addEventListener('input', function() { renderRecords(); });
  }

  // Size import
  var importSizeBtn = container.querySelector('[data-sr-import-size]');
  if (importSizeBtn) {
    importSizeBtn.addEventListener('click', function() {
      var fileEl = $('sr-sizeFile');
      if (fileEl) fileEl.click();
    });
  }
  var sizeFileEl = $('sr-sizeFile');
  if (sizeFileEl) {
    sizeFileEl.addEventListener('change', function(e) {
      importSizeExcel(e);
    });
  }

  // Annot toolbar
  container.querySelectorAll('[data-sr-tool]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var tool = btn.getAttribute('data-sr-tool');
      setAnnotTool(tool, btn);
    });
  });

  var uploadAnnotBtn = container.querySelector('[data-sr-upload-annot]');
  if (uploadAnnotBtn) {
    uploadAnnotBtn.addEventListener('click', function() {
      var fileEl = $('sr-annotFile');
      if (fileEl) fileEl.click();
    });
  }
  var annotFileEl = $('sr-annotFile');
  if (annotFileEl) {
    annotFileEl.addEventListener('change', function(e) { loadAnnotImage(e); });
  }

  var insertImgBtn = container.querySelector('[data-sr-insert-img]');
  if (insertImgBtn) {
    insertImgBtn.addEventListener('click', function() {
      var fileEl = $('sr-insertImgFile');
      if (fileEl) fileEl.click();
    });
  }
  var insertImgFileEl = $('sr-insertImgFile');
  if (insertImgFileEl) {
    insertImgFileEl.addEventListener('change', function(e) { insertImage(e); });
  }

  var annotColorEl = $('sr-annotColor');
  if (annotColorEl) {
    annotColorEl.addEventListener('input', function(e) { annotState.color = e.target.value; });
  }
  var annotLineWidthEl = $('sr-annotLineWidth');
  if (annotLineWidthEl) {
    annotLineWidthEl.addEventListener('input', function(e) { annotState.lineWidth = parseInt(e.target.value); });
  }

  container.querySelectorAll('[data-sr-rotate]').forEach(function(btn) {
    btn.addEventListener('click', function() {
      rotateSelected(parseInt(btn.getAttribute('data-sr-rotate')));
    });
  });

  var undoBtn = container.querySelector('[data-sr-undo]');
  if (undoBtn) undoBtn.addEventListener('click', undoAnnot);
  var clearBtn = container.querySelector('[data-sr-clear]');
  if (clearBtn) clearBtn.addEventListener('click', clearAnnot);
  var closeAnnotBtn = container.querySelector('[data-sr-close-annot]');
  if (closeAnnotBtn) closeAnnotBtn.addEventListener('click', closeAnnotModal);
  var saveAnnotBtn = container.querySelector('[data-sr-save-annot]');
  if (saveAnnotBtn) saveAnnotBtn.addEventListener('click', saveAnnotImage);

  // Global keyboard for annot modal
  document.addEventListener('keydown', function(e) {
    var modal = $('sr-annotModal');
    if (!modal || !modal.classList.contains('show')) return;
    if (document.getElementById('sr-annotEditText')) return;
    if (annotState.tool !== 'move' || annotState.movingShapeIdx < 0) return;
    var sel = annotState.shapes[annotState.movingShapeIdx];
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      annotState.shapes.splice(annotState.movingShapeIdx, 1);
      annotState.movingShapeIdx = -1;
      drawCanvas();
      showToast('已删除选中标注', 'success');
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault();
      scaleShape(sel, 1.15);
      drawCanvas();
    } else if (e.key === '-' || e.key === '_') {
      e.preventDefault();
      scaleShape(sel, 0.85);
      drawCanvas();
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      rotateSelected(e.shiftKey ? -1 : -15);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      rotateSelected(e.shiftKey ? 1 : 15);
    } else if (e.key === '[' && sel.fontSize !== undefined) {
      e.preventDefault();
      sel.fontSize = Math.max(8, sel.fontSize - 1);
      drawCanvas();
      showToast('字号: ' + sel.fontSize + 'px', 'info');
    } else if (e.key === ']' && sel.fontSize !== undefined) {
      e.preventDefault();
      sel.fontSize = Math.min(72, sel.fontSize + 1);
      drawCanvas();
      showToast('字号: ' + sel.fontSize + 'px', 'info');
    }
  });
}

// Public init call
ns.init = init;

// Auto-init on DOM ready if container exists
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', function() { init('sampleReviewContainer'); });
} else {
  init('sampleReviewContainer');
}

})(window.SampleReview = window.SampleReview || {});