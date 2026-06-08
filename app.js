/* ─── app.js – 0xForge V2.0.0 ─── */

/* â”€â”€â”€ API Layer â”€â”€â”€ */
const API_BASE = window.location.origin + '/api';

/* â”€â”€â”€ Toast notification system â”€â”€â”€ */
function showToast(message, type = 'error', duration = 4000) {
  try {
    const existing = document.getElementById('toast-container');
    let container = existing;
    if (!container) {
      container = document.createElement('div');
      container.id = 'toast-container';
      container.style.cssText = 'position:fixed;top:56px;right:16px;z-index:99999;pointer-events:none;display:flex;flex-direction:column;gap:8px;max-width:380px';
      document.body.appendChild(container);
    }
    const bg = type === 'error' ? '#ef4444' : type === 'success' ? '#22c55e' : type === 'warn' ? '#f59e0b' : '#3b82f6';
    const toast = document.createElement('div');
    toast.style.cssText = `pointer-events:auto;background:${bg};color:#fff;padding:10px 16px;border-radius:6px;font-size:12px;box-shadow:0 4px 12px rgba(0,0,0,0.3);animation:slideIn 0.3s ease;cursor:pointer;word-break:break-word`;
    toast.textContent = message;
    toast.onclick = () => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); };
    container.appendChild(toast);
    setTimeout(() => { toast.style.opacity = '0'; setTimeout(() => toast.remove(), 300); }, duration);
  } catch (_) {}
}

let latestQueueData = null;
let queueListeners = [];
let currentProjectId = null;

function onQueueChange(fn) {
  queueListeners.push(fn);
  return () => {
    queueListeners = queueListeners.filter(listener => listener !== fn);
  };
}

class QueueSSEManager {
  constructor() {
    this.eventSource = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000;
    this.reconnectTimer = null;
  }

  connect() {
    this.disconnect(false);
    try {
      this.eventSource = new EventSource(API_BASE + '/queue/events');
      this.eventSource.onopen = () => {
        this.reconnectAttempts = 0;
      };
      this.eventSource.onmessage = (e) => {
        try {
          const msg = JSON.parse(e.data);
          this.handleMessage(msg);
        } catch (err) {
          addClientLog('error', 'SSE parse error', err.message || String(err));
        }
      };
      this.eventSource.onerror = () => {
        this.scheduleReconnect();
      };
    } catch (err) {
      addClientLog('error', 'SSE connection error', err.message || String(err));
      this.scheduleReconnect();
    }
  }

  handleMessage(msg) {
    if (msg.type === 'queue_changed') {
      latestQueueData = msg.data || [];
      queueListeners.forEach(fn => {
        try { fn(latestQueueData); } catch (err) { console.error(err); }
      });
      return;
    }

    if (msg.type === 'timeline_updated') {
      const projectId = msg.data?.project_id;
      if (!projectId || !currentProjectId || Number(projectId) === Number(currentProjectId)) {
        loadTimeline(currentProjectId || projectId).catch(() => {});
      }
      return;
    }

    if (msg.type === 'subtitle_updated') {
      const projectId = msg.data?.project_id;
      if (!projectId || !currentProjectId || Number(projectId) === Number(currentProjectId)) {
        if (msg.data?.path) {
          const srtInput = document.getElementById('inp-srt-path');
          if (srtInput) srtInput.value = msg.data.path;
        }
        loadTimeline(currentProjectId || projectId).catch(() => {});
        showToast('Phu de da cap nhat', 'success', 2500);
      }
      return;
    }

    if (msg.type === 'download_updated') {
      updateDownloadProgressUI(msg.data || {});
    }
  }

  scheduleReconnect() {
    this.disconnect(false);
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      addClientLog('error', 'SSE max reconnect attempts reached', '');
      showToast('Mat ket noi realtime. Hay tai lai tool neu tien trinh khong cap nhat.', 'warn', 6000);
      return;
    }
    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  disconnect(clearListeners = true) {
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    if (this.eventSource) {
      try { this.eventSource.close(); } catch (_) {}
      this.eventSource = null;
    }
    if (clearListeners) queueListeners = [];
  }
}

const queueSSEManager = new QueueSSEManager();
window.queueSSEManager = queueSSEManager;
queueSSEManager.connect();
window.addEventListener('beforeunload', () => queueSSEManager.disconnect());

/* â”€â”€â”€ Client-side error log â”€â”€â”€ */
const clientLogs = [];
const MAX_CLIENT_LOGS = 200;

function addClientLog(level, message, detail) {
  clientLogs.unshift({
    timestamp: new Date().toISOString(),
    level: level || 'info',
    message: message || '',
    detail: detail || '',
    source: 'client',
  });
  if (clientLogs.length > MAX_CLIENT_LOGS) clientLogs.length = MAX_CLIENT_LOGS;
  // Also try to send to backend for persistence
  try {
    fetch(API_BASE + '/queue/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, message: message + (detail ? ' | ' + detail : '') }),
    }).catch(() => {});
  } catch (_) {}
}

// Capture global errors
window.onerror = function(msg, source, lineno, colno, err) {
  const detail = err ? err.stack : `${source}:${lineno}:${colno}`;
  addClientLog('error', `[GLOBAL] ${msg}`, detail);
};
window.addEventListener('unhandledrejection', function(e) {
  const msg = e.reason?.message || e.reason || 'Unknown';
  addClientLog('error', `[PROMISE] ${msg}`, e.reason?.stack || '');
});

async function api(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(API_BASE + path, opts);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      throw new Error(`${res.status}${errBody ? ': ' + errBody.slice(0, 200) : ''}`);
    }
    return await res.json();
  } catch (e) {
    const msg = `API ${method} ${path} failed: ${e.message}`;
    console.warn(msg);
    addClientLog('error', msg, e.stack);
    showToast(msg, 'error', 5000);
    return null;
  }
}

function apiGet(path) { return api('GET', path); }
function apiPost(path, body) { return api('POST', path, body); }
function apiPut(path, body) { return api('PUT', path, body); }
function apiDel(path) { return api('DELETE', path); }

const API_ERROR_MESSAGES = {
  400: 'Yeu cau khong hop le',
  401: 'Can dang nhap lai',
  403: 'Khong co quyen truy cap',
  404: 'Khong tim thay tai nguyen',
  429: 'Qua nhieu yeu cau, hay thu lai sau',
  500: 'Loi server, hay thu lai sau',
  503: 'Server dang ban, hay thu lai sau',
};

function getErrorMessage(status, defaultMsg) {
  return API_ERROR_MESSAGES[status] || defaultMsg || 'Loi khong xac dinh';
}

async function apiWithErrorHandling(method, path, body = null) {
  const opts = { method, headers: { 'Content-Type': 'application/json' } };
  if (body !== null && body !== undefined) opts.body = JSON.stringify(body);
  try {
    const res = await fetch(API_BASE + path, opts);
    if (!res.ok) {
      const errBody = await res.text().catch(() => '');
      const error = new Error(getErrorMessage(res.status, errBody.slice(0, 120)));
      error.status = res.status;
      error.body = errBody;
      throw error;
    }
    return await res.json();
  } catch (e) {
    const msg = `API ${method} ${path} failed: ${e.message}`;
    console.warn(msg);
    addClientLog('error', msg, e.stack || '');
    showToast(e.message || msg, 'error', 5000);
    return null;
  }
}

class ValidationError extends Error {
  constructor(message, rule, value) {
    super(message);
    this.name = 'ValidationError';
    this.rule = rule;
    this.value = value;
  }
}

const ValidationRules = {
  filePath: {
    validate(value) {
      if (!value || typeof value !== 'string') return false;
      const trimmed = value.trim();
      if (!trimmed) return false;
      const pathWithoutDrive = trimmed.replace(/^[a-zA-Z]:[\\/]/, '');
      return !/[<>"|?*\n\r\t]/.test(pathWithoutDrive);
    },
    message: 'Duong dan file khong hop le',
  },
  videoFile: {
    validate(path) {
      if (!ValidationRules.filePath.validate(path)) return false;
      return /\.(mp4|avi|mov|mkv|flv|webm|m4v|mpg|mpeg)$/i.test(path);
    },
    message: 'File phai la video hop le',
  },
  timestamp: {
    validate(value, maxDuration = 86400) {
      const num = Number(value);
      return Number.isFinite(num) && num >= 0 && num <= maxDuration;
    },
    message: 'Thoi gian khong hop le',
  },
  timeRange: {
    validate(value, endValue, maxDuration = 86400) {
      const start = Array.isArray(value) ? value[0] : value;
      const end = Array.isArray(value) ? value[1] : endValue;
      const s = Number(start);
      const e = Number(end);
      return Number.isFinite(s) && Number.isFinite(e) && s >= 0 && e > s && e <= maxDuration;
    },
    message: 'Thoi gian bat dau phai nho hon thoi gian ket thuc',
  },
  language: {
    validate(lang) {
      return ['vi', 'en', 'zh', 'es', 'fr', 'de', 'ja', 'ko', 'ar', 'pt', 'ru'].includes(lang);
    },
    message: 'Ngon ngu khong duoc ho tro',
  },
  projectName: {
    validate(name) {
      return typeof name === 'string' && /^[a-zA-Z0-9_\- ]{1,100}$/.test(name.trim());
    },
    message: 'Ten du an phai tu 1-100 ky tu',
  },
  pathArray: {
    validate(paths) {
      return Array.isArray(paths) && paths.length >= 2 && paths.every(p => ValidationRules.filePath.validate(p));
    },
    message: 'Can it nhat 2 duong dan file hop le',
  },
};

function validate(value, rule, customMessage, ...args) {
  const ruleObj = ValidationRules[rule];
  if (!ruleObj) throw new Error(`Unknown validation rule: ${rule}`);
  if (!ruleObj.validate(value, ...args)) {
    throw new ValidationError(customMessage || ruleObj.message, rule, value);
  }
  return true;
}

/* â”€â”€â”€ Health check & Stats â”€â”€â”€ */
async function loadDashboard() {
  const health = await apiGet('/health');
  const stats = await apiGet('/stats');
  if (stats) {
    const q = stats.queue || {};
    document.querySelectorAll('.queue-stat').forEach(el => {
      const key = el.dataset.stat;
      if (key in q) el.textContent = q[key];
    });
    const u = stats.api_usage || {};
    document.querySelectorAll('.api-stat').forEach(el => {
      const key = el.dataset.stat;
      if (key in u) el.textContent = u[key];
    });
  }
  /* Load real asset counts */
  const counts = await apiGet('/assets/counts');
  if (counts) {
    document.querySelectorAll('.asset-item').forEach(item => {
      const label = item.querySelector('span')?.textContent?.toLowerCase();
      if (label && counts[label] !== undefined) {
        const countEl = item.querySelector('.asset-count');
        if (countEl) countEl.textContent = counts[label];
      } else if (label === 'watermark' && counts['branding'] !== undefined) {
        const countEl = item.querySelector('.asset-count');
        if (countEl) countEl.textContent = counts['branding'];
      }
    });
  }
  /* Load real preset list */
  const presets = await apiGet('/presets');
  if (presets && typeof presets === 'object') {
    const names = Object.keys(presets).filter(k => presets[k] && presets[k].name);
    if (names.length) {
      const presetSelects = document.querySelectorAll('#sel-project-preset, #sel-export-preset');
      presetSelects.forEach(sel => {
        const currentVal = sel.value;
        sel.innerHTML = names.map(n => `<option>${presets[n].name || n}</option>`).join('');
        if ([...sel.options].some(o => o.value === currentVal)) sel.value = currentVal;
    });
  };
  }
}

/* Tab switching â€“ Processing Panel */
(function() {
  var tabs = document.querySelectorAll('#processing-tabs .tab');
  var contents = document.querySelectorAll('.tab-content');
  function switchTab(btn) {
    try {
      tabs.forEach(function(t) { t.classList.remove('active'); });
      contents.forEach(function(c) { c.classList.remove('active'); });
      btn.classList.add('active');
      var target = btn.dataset.target;
      if (target) {
        var el = document.getElementById(target);
        if (el) el.classList.add('active');
      }
    } catch (e) { console.warn('Tab switch error:', e); }
  }
  tabs.forEach(function(btn) {
    btn.addEventListener('click', function() { switchTab(btn); });
  });
  // Expose for nav click simulation
  window._switchTab = switchTab;
})();



/* Sidebar feature flyout - Full Tree */
const sidebarTree = {
  home: {
    title: 'Trang chá»§',
    tree: [
      { icon: 'ri-dashboard-2-line', label: 'Báº£ng Ä‘iá»u khiá»ƒn' },
      { icon: 'ri-history-line', label: 'Dá»± Ã¡n gáº§n Ä‘Ã¢y' },
      { icon: 'ri-bar-chart-2-line', label: 'Thá»‘ng kÃª' },
      { label: 'TÃ i nguyÃªn', icon: 'ri-archive-stack-line', children: [
        { label: 'Videos', children: [
          { label: 'Gá»‘c' },
          { label: 'ÄÃ£ sá»­a' },
          { label: 'ÄÃ£ xuáº¥t' }
        ]},
        { label: 'Ã‚m thanh', children: [
          { label: 'Nháº¡c ná»n' },
          { label: 'Giá»ng Ä‘á»c' },
          { label: 'Hiá»‡u á»©ng' }
        ]},
        { label: 'Phá»¥ Ä‘á»', children: [
          { label: 'Nguá»“n' },
          { label: 'Dá»‹ch thuáº­t' }
        ]},
        { label: 'NhÃ£n hiá»‡u', children: [
          { label: 'Logo' },
          { label: 'HÃ¬nh má»' },
          { label: 'QR' }
        ]},
        { label: 'Máº«u sáºµn (Template)' }
      ]}
    ]
  },
  project: {
    title: 'Dá»± Ã¡n',
    tree: [
      { icon: 'ri-add-box-line', label: 'Táº¡o má»›i' },
      { icon: 'ri-folder-open-line', label: 'Má»Ÿ' },
      { icon: 'ri-save-3-line', label: 'LÆ°u' },
      { icon: 'ri-history-line', label: 'Lá»‹ch sá»­ phiÃªn báº£n' },
      { icon: 'ri-cloud-line', label: 'Sao lÆ°u tá»± Ä‘á»™ng' },
      { icon: 'ri-layout-grid-line', label: 'Template' },
      { icon: 'ri-stack-line', label: 'Dá»± Ã¡n hÃ ng loáº¡t' }
    ]
  },
  download: {
    title: 'Táº£i vá»',
    tree: [
      { icon: 'ri-youtube-line', label: 'YouTube' },
      { icon: 'ri-tiktok-line', label: 'TikTok' },
      { icon: 'ri-video-line', label: 'Douyin' },
      { icon: 'ri-facebook-line', label: 'Facebook' },
      { icon: 'ri-instagram-line', label: 'Instagram' },
      { icon: 'ri-play-list-line', label: 'Danh sÃ¡ch phÃ¡t' },
      { icon: 'ri-cookie-line', label: 'Quáº£n lÃ½ Cookie' },
      { icon: 'ri-global-line', label: 'Quáº£n lÃ½ Proxy' },
      { icon: 'ri-link-m', label: 'URL hÃ ng loáº¡t' }
    ]
  },
  subtitle: {
    title: 'Phá»¥ Ä‘á»',
    tree: [
      { label: 'Nháº­p phá»¥ Ä‘á»', icon: 'ri-upload-cloud-2-line', children: [
        { label: 'SRT' },
        { label: 'ASS' },
        { label: 'GhÃ©p phá»¥ Ä‘á»' }
      ]},
      { label: 'Dá»‹ch thuáº­t', icon: 'ri-translate-2', children: [
        { label: 'GPT' },
        { label: 'Gemini' },
        { label: 'Dá»‹ch hÃ ng loáº¡t' }
      ]},
      { label: 'Kiá»ƒu dÃ¡ng', icon: 'ri-font-size', children: [
        { label: 'Font chá»¯' },
        { label: 'MÃ u sáº¯c' },
        { label: 'Äá»• bÃ³ng' }
      ]},
      { label: 'Xuáº¥t phá»¥ Ä‘á»', icon: 'ri-download-2-line', children: [
        { label: 'Gáº¯n cá»©ng' },
        { label: 'SRT' },
        { label: 'ASS' }
      ]}
    ]
  },
  voice: {
    title: 'Giá»ng Ä‘á»c',
    tree: [
      { label: 'TTS', icon: 'ri-mic-2-line', children: [
        { label: 'Google' },
        { label: 'Azure' },
        { label: 'ElevenLabs' },
        { label: 'EdgeTTS' }
      ]},
      { label: 'NhÃ¢n báº£n giá»ng nÃ³i', icon: 'ri-user-voice-line', children: [
        { label: 'Táº£i lÃªn máº«u' },
        { label: 'Huáº¥n luyá»‡n' },
        { label: 'Xuáº¥t giá»ng nÃ³i' }
      ]},
      { label: 'Äa giá»ng Ä‘á»c', icon: 'ri-team-line', children: [
        { label: 'Ãnh xáº¡ giá»ng Ä‘á»c' },
        { label: 'Tá»± Ä‘á»™ng nháº­n diá»‡n' }
      ]},
      { label: 'ThÆ° viá»‡n giá»ng Ä‘á»c', icon: 'ri-voiceprint-line' }
    ]
  },
  ai: {
    title: 'TrÃ­ tuá»‡ nhÃ¢n táº¡o (AI)',
    tree: [
      { icon: 'ri-scissors-cut-line', label: 'TÃ¡ch phÃ¢n cáº£nh' },
      { icon: 'ri-file-text-line', label: 'TÃ³m táº¯t tá»± Ä‘á»™ng' },
      { icon: 'ri-film-line', label: 'Review phim tá»± Ä‘á»™ng' },
      { icon: 'ri-user-smile-line', label: 'Nháº­n diá»‡n nhÃ¢n váº­t' },
      { icon: 'ri-voiceprint-line', label: 'Nháº­n diá»‡n ngÆ°á»i nÃ³i' },
      // { icon: 'ri-image-line', label: 'Táº¡o áº£nh bÃ¬a' },
      { icon: 'ri-font-size', label: 'Táº¡o tiÃªu Ä‘á»' },
      { icon: 'ri-hashtag-line', label: 'Táº¡o Hashtag' },
      { icon: 'ri-bubble-chart-line', label: 'ThÆ° viá»‡n cÃ¢u lá»‡nh' }
    ]
  },
  export: {
    title: 'Xuáº¥t báº£n',
    tree: [
      { icon: 'ri-movie-2-line', label: 'Káº¿t xuáº¥t' },
      { icon: 'ri-list-check-3', label: 'HÃ ng chá»' },
      { icon: 'ri-equalizer-line', label: 'Máº«u thiáº¿t láº­p' },
      { icon: 'ri-upload-cloud-2-line', label: 'Táº£i lÃªn' },
      { label: 'Video', icon: 'ri-video-line', children: [
        { label: 'MP4' },
        { label: 'MKV' },
        { label: 'MOV' }
      ]},
      { label: 'MÃ£ hÃ³a (Codec)', icon: 'ri-cpu-line', children: [
        { label: 'H264' },
        { label: 'H265' },
        { label: 'AV1' }
      ]},
      { label: 'GPU', icon: 'ri-server-line', children: [
        { label: 'NVENC' },
        { label: 'AMD' },
        { label: 'CPU' }
      ]},
      { label: 'ÄÄƒng táº£i', icon: 'ri-share-line', children: [
        { label: 'YouTube' },
        { label: 'TikTok' },
        { label: 'Facebook' }
      ]}
    ]
  },
  queue: {
    title: 'HÃ ng chá»',
    tree: [
      { icon: 'ri-play-circle-line', label: 'Äang cháº¡y' },
      { icon: 'ri-time-line', label: 'Äang chá»' },
      { icon: 'ri-checkbox-circle-line', label: 'ÄÃ£ hoÃ n thÃ nh' },
      { icon: 'ri-close-circle-line', label: 'Tháº¥t báº¡i' },
      { icon: 'ri-refresh-line', label: 'Thá»­ láº¡i tá»‡p lá»—i' },
      { icon: 'ri-pause-line', label: 'Táº¡m dá»«ng táº¥t cáº£' },
      { icon: 'ri-play-line', label: 'Tiáº¿p tá»¥c táº¥t cáº£' },
      { icon: 'ri-arrow-up-line', label: 'Äá»™ Æ°u tiÃªn' }
    ]
  },
  settings: {
    title: 'CÃ i Ä‘áº·t',
    tree: [
      { icon: 'ri-settings-4-line', label: 'Chung' },
      { icon: 'ri-key-2-line', label: 'API Keys' },
      { icon: 'ri-sparkling-line', label: 'MÃ´ hÃ¬nh AI' },
      { icon: 'ri-cpu-line', label: 'GPU' },
      { icon: 'ri-terminal-box-line', label: 'FFmpeg' },
      { icon: 'ri-global-line', label: 'Proxy' },
      { icon: 'ri-refresh-line', label: 'Cáº­p nháº­t' },
      { icon: 'ri-information-line', label: 'Giá»›i thiá»‡u' }
    ]
  }
};

const sidebarFlyout = document.getElementById('sidebar-flyout');

function renderTreeItems(items, depth = 0) {
  let html = '';
  const pad = depth * 14;
  for (const item of items) {
    if (item.children) {
      const branchId = 'fb-' + Math.random().toString(36).slice(2, 6);
      html += `
        <div class="f-branch" data-branch="${branchId}" style="padding-left:${pad}px">
          <span class="f-branch-toggle"><i class="ri-arrow-down-s-line"></i></span>
          ${item.icon ? `<i class="${item.icon} f-branch-icon"></i>` : ''}
          <span class="f-branch-label">${item.label}</span>
        </div>
        <div class="f-children" id="${branchId}">
          ${renderTreeItems(item.children, depth + 1)}
        </div>
      `;
    } else {
      html += `
        <a href="#" class="f-item" style="padding-left:${pad + 20}px">
          ${item.icon ? `<i class="${item.icon}"></i>` : ''}
          <span>${item.label}</span>
        </a>
      `;
    }
  }
  return html;
}

function renderSidebarFlyout(item) {
  if (!sidebarFlyout) return;
  const data = sidebarTree[item.dataset.tab];
  if (!data) return;
  const rect = item.getBoundingClientRect();

  const treeHtml = renderTreeItems(data.tree || []);

  sidebarFlyout.innerHTML = `
    <div class="flyout-title">${data.title}</div>
    <div class="flyout-tree">
      ${treeHtml}
    </div>
  `;

  sidebarFlyout.style.top = `${Math.max(48, rect.top - 6)}px`;
  sidebarFlyout.classList.add('visible');
  sidebarFlyout.setAttribute('aria-hidden', 'false');
}

function hideSidebarFlyout() {
  if (!sidebarFlyout) return;
  sidebarFlyout.classList.remove('visible');
  sidebarFlyout.setAttribute('aria-hidden', 'true');
}

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('mouseenter', () => renderSidebarFlyout(item));
  item.addEventListener('focus', () => renderSidebarFlyout(item));
});

const leftSidebar = document.getElementById('left-sidebar');
leftSidebar.addEventListener('mouseleave', () => {
  setTimeout(() => {
    if (!sidebarFlyout.matches(':hover')) hideSidebarFlyout();
  }, 120);
});

sidebarFlyout?.addEventListener('mouseleave', hideSidebarFlyout);

/* Flyout tree: branch toggle via delegation */
sidebarFlyout?.addEventListener('click', (e) => {
  const toggle = e.target.closest('.f-branch-toggle');
  if (!toggle) return;
  const branch = toggle.closest('.f-branch');
  if (!branch) return;
  const branchId = branch.dataset.branch;
  const children = document.getElementById(branchId);
  if (children) {
    children.classList.toggle('collapsed');
    toggle.classList.toggle('collapsed');
  }
});

/* Sub-tabs inside feature panels */
document.querySelectorAll('.sub-tab-bar').forEach(bar => {
  bar.querySelectorAll('.sub-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const contentRoot = bar.parentElement;
      contentRoot.querySelectorAll('.sub-tab').forEach(t => t.classList.remove('active'));
      contentRoot.querySelectorAll('.sub-content').forEach(c => c.classList.remove('active'));
      btn.classList.add('active');
      const target = document.getElementById(btn.dataset.subtarget);
      if (target) target.classList.add('active');
    });
  });
});

/* Live range values */
document.querySelectorAll('.live-range').forEach(range => {
  const valueEl = range.nextElementSibling;
  const hasPercent = valueEl && valueEl.textContent.includes('%');
  range.addEventListener('input', () => {
    if (valueEl) valueEl.textContent = `${range.value}${hasPercent ? '%' : ''}`;
  });
});

/* â”€â”€â”€ Load button (API) â”€â”€â”€ */
document.getElementById('btn-browse-video')?.addEventListener('click', async () => {
  console.log('[Browse] btn-browse-video clicked');
  const res = await apiGet('/system/browse?type=file&ext=video');
  console.log('[Browse] response:', res);
  if (res && res.path) {
    document.getElementById('inp-video-path').value = res.path;
    loadVideoPreview();
  }
});

document.getElementById('btn-browse-srt')?.addEventListener('click', async () => {
  console.log('[Browse] btn-browse-srt clicked');
  const res = await apiGet('/system/browse?type=file&ext=srt');
  console.log('[Browse] response:', res);
  if (res && res.path) {
    document.getElementById('inp-srt-path').value = res.path;
  }
});

document.getElementById('btn-browse-output')?.addEventListener('click', async () => {
  console.log('[Browse] btn-browse-output clicked');
  const res = await apiGet('/system/browse?type=folder');
  console.log('[Browse] response:', res);
  if (res && res.path) {
    document.getElementById('inp-output-path').value = res.path;
  }
});

document.getElementById('btn-load')?.addEventListener('click', async () => {
  const srtPath = document.getElementById('inp-srt-path')?.value;
  const videoPath = document.getElementById('inp-video-path')?.value;
  const preset = document.getElementById('sel-project-preset')?.value || 'Movie Review';

  const loadProgress = document.getElementById('load-progress');
  const loadPct = document.getElementById('load-pct');
  if (loadProgress) loadProgress.style.width = '10%';
  if (loadPct) loadPct.textContent = '10%';

  try {
    // 1. Create project
    const project = await apiPost('/projects', {
      name: 'project_' + Date.now(),
      preset: preset,
    });
    if (!project) throw new Error('KhÃ´ng thá»ƒ táº¡o dá»± Ã¡n');
    currentProjectId = project.id;
    
    if (loadProgress) loadProgress.style.width = '35%';
    if (loadPct) loadPct.textContent = '35%';

    // 2. Sync video if exists
    if (videoPath) {
      await apiPost(`/timeline/${currentProjectId}/video`, { path: videoPath });
    }
    
    if (loadProgress) loadProgress.style.width = '65%';
    if (loadPct) loadPct.textContent = '65%';

    // 3. Import subtitle if exists
    if (srtPath) {
      await apiPost('/subtitle/import-path', { path: srtPath, project_id: currentProjectId });
    }

    if (loadProgress) loadProgress.style.width = '100%';
    if (loadPct) loadPct.textContent = '100%';

    // 4. Load the populated timeline
    await loadTimeline(currentProjectId);
  } catch (e) {
    console.error('[Load] Error loading project data:', e);
    if (loadProgress) loadProgress.style.width = '0%';
    if (loadPct) loadPct.textContent = '0%';
    alert('Lá»—i khi load dá»¯ liá»‡u: ' + (e.message || e));
  }
});

/* â”€â”€â”€ Execute button (API) â”€â”€â”€ */
const executeBtn = document.getElementById('btn-execute');
const executeCountMax = 5;
let executeCount = executeCountMax;

const LANG_MAP_EXEC = {'Tiáº¿ng Anh':'en','Tiáº¿ng Trung':'zh','Tiáº¿ng Nháº­t':'ja','Tiáº¿ng HÃ n':'ko','Tiáº¿ng Viá»‡t':'vi'};

executeBtn.addEventListener('click', async () => {
  if (isRunning) return;

  const inputPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  if (!inputPath) {
    alert('Vui lÃ²ng chá»n file video hoáº·c subtitle trÆ°á»›c!');
    return;
  }

  isRunning = true;
  executeCount--;
  if (executeCount <= 0) executeCount = executeCountMax;
  executeBtn.textContent = `â–¶ ÄANG Xá»¬ LÃ...`;
  executeBtn.style.background = '#f59e0b';

  const inputName = inputPath.split(/[\\/]/).pop().replace(/\.[^.]+$/, '') || 'output';
  const selFrom = document.getElementById('sel-lang-from')?.value;
  const selTo = document.getElementById('sel-lang-to')?.value;

  const region = getSubBoxRegion();
  const params = {
    source_lang: LANG_MAP_EXEC[selFrom] || 'en',
    target_lang: LANG_MAP_EXEC[selTo] || 'vi',
    translate_engine: 'nllb',
    tts_provider: document.getElementById('sel-tts-provider')?.value === 'FPT.AI TTS' ? 'fpt' : (document.getElementById('sel-tts-provider')?.value?.toLowerCase().replace(' tts', '').replace(' (free)', '') || 'edge'),
    tts_voice: document.getElementById('sel-voice-type')?.value || 'vi-VN-HoaiMyNeural',
    tts_align: document.getElementById('chk-tts-align')?.checked ?? true,
    fpt_api_key: document.getElementById('inp-fpt-key')?.value || undefined,
    burn_subtitle: document.querySelector('#tab-subtitle .custom-checkbox input')?.checked ?? true,
    output_name: inputName,
    output_dir: document.getElementById('inp-output-path')?.value || undefined,
    preset: document.getElementById('sel-project-preset')?.value || 'Movie Review',
    subtitle_region: region,
    subtitle_font: 'Arial',
    subtitle_size: 42,
    subtitle_color: '#FFFFFF',
    subtitle_shadow: 'soft',
    remove_hardsub: subBlurEnabled,
  };

  const item = await apiPost('/pipeline/start', {
    project_id: currentProjectId || 1,
    input_path: inputPath,
    type: 'pipeline',
    params,
  });

  startCountdown(600);
  addTaskRow();

  if (!item || !item.id) {
    addClientLog('error', 'Backend khÃ´ng táº¡o Ä‘Æ°á»£c job. Kiá»ƒm tra API key vÃ  file input.');
    isRunning = false;
    executeBtn.textContent = `â–¶ THá»°C HIá»†N (${executeCount})`;
    executeBtn.style.background = '#ef4444';
    updateLastRow(0, 'failed');
    return;
  }


  function onTrackUpdate(data) {
    const running = data.find(r => r.id === item.id);
    if (running) {
      progressVal = running.progress || 0;
      queueFill.style.height = progressVal + '%';
      updateLastRow(progressVal);
      if (running.status === 'completed' || running.status === 'failed') {
        stopTracking();
        finishExecute();
        if (running.status === 'completed' && currentProjectId) {
          loadTimeline(currentProjectId);
        }
      }
    }
  }

  function stopTracking() {
    var idx = queueListeners.indexOf(onTrackUpdate);
    if (idx !== -1) queueListeners.splice(idx, 1);
  }

  onQueueChange(onTrackUpdate);

  if (latestQueueData) onTrackUpdate(latestQueueData);
  pollQueueUntilDone(item.id, onTrackUpdate, stopTracking);
});

function pollQueueUntilDone(jobId, onTrackUpdate, stopTracking) {
  const started = Date.now();
  const interval = setInterval(async () => {
    const jobs = await apiGet('/queue');
    if (jobs && Array.isArray(jobs)) {
      onTrackUpdate(jobs);
      const job = jobs.find(j => j.id === jobId);
      if (!job || job.status === 'completed' || job.status === 'failed') {
        clearInterval(interval);
      }
    }
    if (Date.now() - started > 3 * 60 * 60 * 1000) {
      clearInterval(interval);
      stopTracking();
      addClientLog('warn', 'Dung theo doi job sau 3 gio, backend co the van dang chay.');
    }
  }, 3000);
}

function finishExecute() {
  isRunning = false;
  progressVal = 0;
  executeBtn.textContent = `â–¶ THá»°C HIá»†N (${executeCount})`;
  executeBtn.style.background = '#39414d';
  remainingEl.textContent = '00:00:00';
}

/* â”€â”€â”€ Shared state â”€â”€â”€ */
let progressVal = 0;
let isRunning = false;
let timerInterval = null;
let remainingSeconds = 0;
const queueFill = document.getElementById('queue-accent-fill');
const remainingEl = document.getElementById('remaining-time');

function formatTime(s) {
  const hh = String(Math.floor(s / 3600)).padStart(2, '0');
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0');
  const ss = String(s % 60).padStart(2, '0');
  return `${hh}:${mm}:${ss}`;
}

function startCountdown(seconds) {
  remainingSeconds = seconds;
  clearInterval(timerInterval);
  timerInterval = setInterval(() => {
    if (remainingSeconds <= 0) { clearInterval(timerInterval); remainingEl.textContent = '00:00:00'; return; }
    remainingSeconds--;
    remainingEl.textContent = formatTime(remainingSeconds);
  }, 1000);
}

/* â”€â”€â”€ Preset Save â”€â”€â”€ */
document.getElementById('btn-save-preset')?.addEventListener('click', async () => {
  const name = document.getElementById('sel-project-preset')?.value || 'Custom';
  const preset = {
    name: name,
    voice: {
      provider: document.getElementById('sel-tts-provider')?.value || 'edge',
      voice: document.getElementById('sel-voice-type')?.value || 'Máº·c Äá»‹nh',
      speed: 1.0,
      keep_bgm: document.getElementById('chk-keep-bgm')?.checked || false,
      bgm_volume: parseFloat(document.getElementById('inp-bgm-vol')?.value || '0.1'),
    },
    subtitle: {
      font: 'Arial',
      size: 42,
      color: '#FFFFFF',
      stroke: 2,
      shadow: 'soft',
      position: 'bottom',
      burn: true,
      region: getSubBoxRegion() || { x: 0.1, y: 0.78, width: 0.8, height: 0.15 },
    },
    export: {
      resolution: document.getElementById('inp-width')?.value + 'x' + document.getElementById('inp-height')?.value || '1920x1080',
      fps: parseInt(document.getElementById('sel-export-fps')?.value || '30'),
      codec: document.getElementById('sel-export-codec')?.value || 'h264',
      bitrate: document.getElementById('sel-export-bitrate')?.value || '8M',
      format: (document.getElementById('sel-export-format')?.value || 'mp4').toLowerCase(),
      gpu: document.getElementById('sel-export-gpu')?.value?.toLowerCase() || 'cpu',
    },
    enhance: {
      lut: 'Cinematic',
      brightness: 50,
      contrast: 55,
      saturation: 60,
      vignette: 12,
      watermark: document.querySelector('#tab-enhance .custom-checkbox input')?.checked || false,
    },
  };
  await apiPost('/presets?name=' + encodeURIComponent(name), preset);
});

/* â”€â”€â”€ Scene Detect â”€â”€â”€ */
document.getElementById('btn-detect-scenes')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-detect-scenes');
  btn.textContent = 'â³ Äang phÃ¢n tÃ­ch...';
  btn.disabled = true;
  const videoPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  if (videoPath) {
    await apiPost('/edit/scene-detect', {
      project_id: currentProjectId || 1,
      video_path: videoPath,
      threshold: 27,
    });
  }
  setTimeout(() => {
    btn.innerHTML = '<i class="ri-scissors-cut-line"></i> PhÃ¢n tÃ­ch';
    btn.disabled = false;
  }, 2000);
});

/* â”€â”€â”€ Task Queue Rows â”€â”€â”€ */
const resultBody = document.getElementById('result-table-body');
let rowCount = 0;

function addTaskRow() {
  rowCount++;
  if (latestQueueData && latestQueueData.length > 0) {
    renderQueueRows(latestQueueData);
  } else {
    apiGet('/queue').then(jobs => { if (jobs) renderQueueRows(jobs); });
  }
}

function updateLastRow(pct) {
  if (latestQueueData && latestQueueData.length > 0) {
    const last = latestQueueData[latestQueueData.length - 1];
    if (last && last.id) {
      const row = document.querySelector(`[data-job-id="${last.id}"]`);
      if (row) {
        const fillId = row.id?.replace('task-row-', 'mini-fill-');
        const fill = document.getElementById(fillId);
        if (fill) fill.style.width = pct + '%';
        const timeCell = row.querySelectorAll('.result-cell')[4];
        if (timeCell) {
          timeCell.textContent = formatTime(Math.round(pct * 3));
          timeCell.style.color = pct >= 100 ? '#22c55e' : '#facc15';
        }
      }
    }
  }
}

/* â”€â”€â”€ Crop checkbox toggle â”€â”€â”€ */
document.getElementById('chk-crop-video')?.addEventListener('change', function() {
  const pos = document.getElementById('inp-crop-pos');
  const btn = document.getElementById('btn-chon-vi-tri');
  pos.disabled = !this.checked;
  btn.disabled = !this.checked;
  pos.style.opacity = this.checked ? '1' : '0.4';
  btn.style.opacity = this.checked ? '1' : '0.4';
});
// Init state
const cropPos = document.getElementById('inp-crop-pos');
const chonViTri = document.getElementById('btn-chon-vi-tri');
if (cropPos) { cropPos.disabled = true; cropPos.style.opacity = '0.4'; }
if (chonViTri) { chonViTri.disabled = true; chonViTri.style.opacity = '0.4'; }

/* â”€â”€â”€ Resize checkbox toggle â”€â”€â”€ */
document.getElementById('chk-resize')?.addEventListener('change', function() {
  ['inp-height','inp-width','chk-keep-ratio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = !this.checked;
      const opacityTarget = el.closest ? (el.closest('.custom-checkbox') || el) : el;
      opacityTarget.style.opacity = this.checked ? '1' : '0.4';
    }
  });
});

/* â”€â”€â”€ Social button tooltips / links (demo) â”€â”€â”€ */
document.querySelectorAll('.social-btn').forEach(btn => {
  btn.title = btn.title || btn.textContent;
});

/* â”€â”€â”€ Drag-over file drop on SRT path â”€â”€â”€ */
const srtInput = document.getElementById('inp-srt-path');
if (srtInput) {
  srtInput.addEventListener('dragover', e => { e.preventDefault(); srtInput.style.borderColor = 'var(--accent)'; });
  srtInput.addEventListener('dragleave', () => { srtInput.style.borderColor = ''; });
  srtInput.addEventListener('drop', e => {
    e.preventDefault();
    srtInput.style.borderColor = '';
    const files = e.dataTransfer.files;
    if (files.length) srtInput.value = files[0].name;
  });
}
const videoInput = document.getElementById('inp-video-path');
if (videoInput) {
  videoInput.addEventListener('dragover', e => { e.preventDefault(); videoInput.style.borderColor = 'var(--accent)'; });
  videoInput.addEventListener('dragleave', () => { videoInput.style.borderColor = ''; });
  videoInput.addEventListener('drop', e => {
    e.preventDefault();
    videoInput.style.borderColor = '';
    const files = e.dataTransfer.files;
    if (files.length) {
      videoInput.value = files[0].name;
      loadVideoPreview();
    }
  });
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SUBTITLE TREE CONTROL â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
/* Tree leaf switching */
document.querySelectorAll('.tree-node.leaf').forEach(leaf => {
  leaf.addEventListener('click', () => {
    const treeLayout = leaf.closest('.subtitle-tree-layout');
    if (!treeLayout) return;
    treeLayout.querySelectorAll('.tree-node.leaf').forEach(l => l.classList.remove('active'));
    leaf.classList.add('active');
    treeLayout.querySelectorAll('.tree-leaf-content').forEach(c => c.classList.remove('active'));
    const target = document.getElementById('leaf-' + leaf.dataset.leaf);
    if (target) target.classList.add('active');
  });
});

/* Tree branch toggle */
document.querySelectorAll('.tree-node.parent').forEach(parent => {
  parent.addEventListener('click', (e) => {
    if (e.target.closest('.tree-node') !== parent) return;
    const branchId = parent.dataset.branch;
    const children = document.getElementById('branch-' + branchId);
    const toggle = parent.querySelector('.tree-toggle');
    if (children) {
      children.classList.toggle('collapsed');
      if (toggle) toggle.classList.toggle('collapsed');
    }
  });
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• QUEUE CONTROLS (API) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-retry-failed')?.addEventListener('click', async () => {
  await apiPost('/queue/retry-all');
  document.querySelectorAll('.queue-job[data-status="failed"]').forEach(job => {
    job.dataset.status = 'running';
    const icon = job.querySelector('.queue-status-icon');
    if (icon) { icon.textContent = 'â–¶'; icon.className = 'queue-status-icon running'; }
    job.classList.add('active');
  });
});

document.getElementById('btn-pause-queue')?.addEventListener('click', async () => {
  await apiPost('/queue/pause-all');
  document.querySelectorAll('.queue-job[data-status="running"]').forEach(job => {
    job.dataset.status = 'paused';
    const icon = job.querySelector('.queue-status-icon');
    if (icon) { icon.textContent = 'â¸'; icon.className = 'queue-status-icon paused'; }
  });
});

document.getElementById('btn-resume-queue')?.addEventListener('click', async () => {
  await apiPost('/queue/resume-all');
  document.querySelectorAll('.queue-job[data-status="paused"]').forEach(job => {
    job.dataset.status = 'running';
    const icon = job.querySelector('.queue-status-icon');
    if (icon) { icon.textContent = 'â–¶'; icon.className = 'queue-status-icon running'; }
    job.classList.add('active');
  });
});

document.getElementById('btn-clear-queue')?.addEventListener('click', async () => {
  if (confirm('Báº¡n cÃ³ cháº¯c muá»‘n xÃ³a sáº¡ch danh sÃ¡ch hÃ ng Ä‘á»£i?')) {
    await apiPost('/queue/clear-all');
    const resultBody = document.getElementById('result-table-body');
    if (resultBody) resultBody.innerHTML = '';
    rowCount = 0;
  }
});

/* â”€â”€ Log Viewer â”€â”€ */
const logModal = document.getElementById('log-modal');
const logContainer = document.getElementById('log-container');
const logCount = document.getElementById('log-count');

function escapeHtml(text) {
  const d = document.createElement('div');
  d.textContent = text;
  return d.innerHTML;
}

function renderLogEntries(entries) {
  if (!entries || entries.length === 0) {
    return '<div class="log-placeholder">KhÃ´ng tÃ¬m tháº¥y báº£n ghi log nÃ o.</div>';
  }
  return entries.map(e => {
    const cls = `log-level ${e.level || 'info'}`;
    const ts = (e.timestamp || '').slice(11, 19) || (e.source === 'client' ? new Date().toLocaleTimeString() : '--:--:--');
    const srcTag = e.source === 'client' ? '<span class="log-source client" title="Client-side">CLI</span>' : '<span class="log-source server" title="Server-side">SRV</span>';
    const msg = e.message || '';
    const detail = e.detail ? `<div style="font-size:9px;color:var(--text-dim);padding:2px 0 0 52px;white-space:pre-wrap;font-family:var(--font-mono)">${escapeHtml(String(e.detail).slice(0, 300))}</div>` : '';
    return `<div class="log-entry">
      ${srcTag}
      <span class="log-time">${ts}</span>
      <span class="${cls}">${(e.level || 'info').toUpperCase()}</span>
      <span class="log-message">${escapeHtml(msg)}${detail}</span>
    </div>`;
  }).join('');
}

async function fetchLogs() {
  const filterId = document.getElementById('inp-log-filter')?.value;
  const filterLevel = document.getElementById('sel-log-level')?.value;

  // Fetch backend logs
  let url = '/queue/logs?limit=500';
  if (filterId) url += `&queue_item_id=${filterId}`;
  const backendLogs = await apiGet(url) || [];

  // Merge with client logs
  let allLogs = [];
  backendLogs.forEach(l => allLogs.push({ ...l, source: 'server' }));
  clientLogs.forEach(l => allLogs.push({ ...l, source: 'client' }));

  // Sort by timestamp descending
  allLogs.sort((a, b) => {
    const ta = a.timestamp || '';
    const tb = b.timestamp || '';
    return tb.localeCompare(ta);
  });

  // Apply level filter
  if (filterLevel) {
    allLogs = allLogs.filter(l => l.level === filterLevel);
  }

  if (logCount) logCount.textContent = `${allLogs.length} báº£n ghi`;
  if (!logContainer) return;

  if (allLogs.length === 0) {
    logContainer.innerHTML = '<div class="log-placeholder">KhÃ´ng tÃ¬m tháº¥y báº£n ghi log nÃ o.</div>';
    return;
  }

  logContainer.innerHTML = renderLogEntries(allLogs);
}

document.getElementById('btn-log-queue')?.addEventListener('click', () => {
  logModal?.classList.add('show');
  fetchLogs();
});

document.getElementById('btn-log-refresh')?.addEventListener('click', fetchLogs);

document.getElementById('inp-log-filter')?.addEventListener('change', fetchLogs);
document.getElementById('sel-log-level')?.addEventListener('change', fetchLogs);

document.getElementById('btn-log-copy')?.addEventListener('click', () => {
  const text = [...logContainer.querySelectorAll('.log-entry')].map(row => {
    const src = row.querySelector('.log-source')?.textContent || '';
    const time = row.querySelector('.log-time')?.textContent || '';
    const level = row.querySelector('.log-level')?.textContent || '';
    const msg = row.querySelector('.log-message')?.textContent || '';
    return `[${src}] [${time}] [${level}] ${msg}`;
  }).join('\n');
  if (!text) return;
  navigator.clipboard.writeText(text).then(() => {
    const btn = document.getElementById('btn-log-copy');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="ri-check-line"></i> ÄÃ£ sao chÃ©p';
    setTimeout(() => btn.innerHTML = orig, 1500);
  }).catch(() => {
    // fallback
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    document.execCommand('copy');
    document.body.removeChild(ta);
  });
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• FLYOUT LEAF â†’ PANEL WIRING â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const navToTabMap = {
  subtitle: 'tab-subtitle',
  voice: 'tab-voice',
  ai: 'tab-ai',
  export: 'tab-export',
};

const sidebarActionMap = {
  'cookie manager': { type: 'modal', target: 'settings-modal' },
  'quáº£n lÃ½ cookie': { type: 'modal', target: 'settings-modal' },
  'proxy manager': { type: 'modal', target: 'settings-modal' },
  'quáº£n lÃ½ proxy': { type: 'modal', target: 'settings-modal' },
  'batch url': { type: 'modal', target: 'download-modal' },
  'url hÃ ng loáº¡t': { type: 'modal', target: 'download-modal' },
  'version history': { type: 'modal', target: 'version-modal' },
  'lá»‹ch sá»­ phiÃªn báº£n': { type: 'modal', target: 'version-modal' },
  'auto backup': { type: 'function', fn: 'toggleAutoBackup' },
  'sao lÆ°u tá»± Ä‘á»™ng': { type: 'function', fn: 'toggleAutoBackup' },
  'templates': { type: 'function', fn: 'openTemplates' },
  'template': { type: 'function', fn: 'openTemplates' },
  'máº«u sáºµn (template)': { type: 'function', fn: 'openTemplates' },
};

const projectActionMap = {
  'create': { type: 'function', fn: 'createProject' },
  'táº¡o má»›i': { type: 'function', fn: 'createProject' },
  'open': { type: 'function', fn: 'openProject' },
  'má»Ÿ': { type: 'function', fn: 'openProject' },
  'save': { type: 'function', fn: 'saveProject' },
  'lÆ°u': { type: 'function', fn: 'saveProject' },
};

sidebarFlyout?.addEventListener('click', (e) => {
  const leaf = e.target.closest('.f-item');
  if (!leaf) return;
  e.preventDefault();
  const leafLabel = leaf.textContent?.toLowerCase().trim();
  const activeNav = document.querySelector('.nav-item.active');
  if (!activeNav) return;
  const navTab = activeNav.dataset.tab;
  const targetTabId = navToTabMap[navTab];

  if (sidebarActionMap[leafLabel]) {
    const action = sidebarActionMap[leafLabel];
    if (action.type === 'modal') {
      document.getElementById(action.target)?.classList.add('show');
    } else if (action.type === 'function' && action.fn === 'toggleAutoBackup') {
      alert('Auto Backup is enabled by default.\nBackups are saved each time you save the project.');
    } else if (action.type === 'function' && action.fn === 'openTemplates') {
      document.querySelector('.asset-item:last-child')?.click();
    }
    return;
  }

  if (projectActionMap[leafLabel]) {
    const action = projectActionMap[leafLabel];
    if (action.fn === 'createProject') {
      const name = prompt('TÃªn dá»± Ã¡n:', 'project_' + Date.now());
      if (name) apiPost('/projects', { name, preset: document.getElementById('sel-project-preset')?.value || 'Movie Review' }).then(p => {
        if (p) { currentProjectId = p.id; alert(`ÄÃ£ táº¡o dá»± Ã¡n: ${name} (ID: ${p.id})`); }
      });
    } else if (action.fn === 'saveProject') {
      if (currentProjectId) apiPost(`/projects/${currentProjectId}/save`).then(r => alert(r?.message || 'ÄÃ£ lÆ°u'));
      else alert('KhÃ´ng cÃ³ dá»± Ã¡n nÃ o Ä‘ang hoáº¡t Ä‘á»™ng');
    }
    return;
  }

  if (targetTabId) {
    const tabBtn = document.querySelector(`#processing-tabs .tab[data-target="${targetTabId}"]`);
    if (tabBtn) {
      if (window._switchTab) window._switchTab(tabBtn);
      else tabBtn.click();
    }
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• AI PANEL HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-ai-detect-scenes')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-ai-detect-scenes');
  btn.textContent = 'â³ Äang quÃ©t...';
  btn.disabled = true;
  const videoPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  if (videoPath) {
    await apiPost('/edit/scene-detect', {
      project_id: currentProjectId || 1,
      video_path: videoPath,
      threshold: parseInt(document.getElementById('inp-ai-threshold')?.value || '27'),
    });
  }
  setTimeout(() => {
    btn.innerHTML = '<i class="ri-scissors-cut-line"></i> PhÃ¢n tÃ­ch';
    btn.disabled = false;
  }, 2000);
});

document.getElementById('btn-ai-summary')?.addEventListener('click', async () => {
  const text = document.getElementById('inp-ai-summary')?.value;
  if (!text) return;
  const result = await apiPost('/ai/summary', {
    text,
    model: document.getElementById('sel-ai-summary-model')?.value || 'BART',
  });
  const el = document.getElementById('ai-summary-result');
  if (result && result.summary) {
    el.textContent = result.summary;
    el.style.color = 'var(--text)';
  } else {
    el.textContent = 'Dá»± phÃ²ng: KhÃ´ng thá»ƒ táº¡o tÃ³m táº¯t (CÃ³ thá»ƒ yÃªu cáº§u API key)';
    el.style.color = 'var(--yellow-warn)';
  }
});

document.getElementById('btn-ai-recap')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-ai-recap');
  btn.textContent = 'â³ Äang táº¡o...';
  btn.disabled = true;
  const result = await apiPost('/ai/recap', { project_id: currentProjectId || 1 });
  const el = document.getElementById('ai-recap-result');
  if (result && result.recap) {
    el.textContent = result.recap;
    el.style.color = 'var(--text)';
  } else {
    el.textContent = 'Dá»± phÃ²ng: TÃ³m táº¯t ná»™i dung phim sáº½ Ä‘Æ°á»£c táº¡o khi video Ä‘Æ°á»£c táº£i';
    el.style.color = 'var(--text-muted)';
  }
  btn.innerHTML = '<i class="ri-film-line"></i> Táº¡o tÃ³m táº¯t phim';
  btn.disabled = false;
});

document.getElementById('btn-ai-characters')?.addEventListener('click', async () => {
  const result = await apiPost('/ai/characters', { project_id: currentProjectId || 1 });
  const el = document.getElementById('ai-characters-result');
  if (result && result.characters) {
    el.textContent = result.characters.join(', ');
    el.style.color = 'var(--text)';
  } else {
    el.textContent = 'Dá»± phÃ²ng: Nháº­n diá»‡n nhÃ¢n váº­t yÃªu cáº§u video cÃ³ khuÃ´n máº·t';
    el.style.color = 'var(--text-muted)';
  }
});

document.getElementById('btn-ai-speakers')?.addEventListener('click', async () => {
  const result = await apiPost('/ai/speakers', { project_id: currentProjectId || 1 });
  const el = document.getElementById('ai-speakers-result');
  if (result && result.speakers) {
    el.textContent = Object.entries(result.speakers).map(([k, v]) => `${k}: ${v}`).join(' | ');
    el.style.color = 'var(--text)';
  } else {
    el.textContent = 'Dá»± phÃ²ng: Nháº­n diá»‡n ngÆ°á»i nÃ³i sáº½ Ä‘Æ°á»£c xá»­ lÃ½ sau khi chuyá»ƒn Ã¢m';
    el.style.color = 'var(--text-muted)';
  }
});

// document.getElementById('btn-ai-thumbnail')?.addEventListener('click', ...);

document.getElementById('btn-ai-title')?.addEventListener('click', async () => {
  const result = await apiPost('/ai/title', { project_id: currentProjectId || 1 });
  const el = document.getElementById('ai-summary-result');
  if (result && result.titles) {
    el.innerHTML = result.titles.map(t => `<div>â€¢ ${t}</div>`).join('');
    el.style.color = 'var(--text)';
  } else {
    el.textContent = 'Dá»± phÃ²ng: Táº¡o tiÃªu Ä‘á» sáº½ kháº£ dá»¥ng sau khi chuyá»ƒn Ã¢m';
    el.style.color = 'var(--text-muted)';
  }
});

document.getElementById('btn-ai-hashtag')?.addEventListener('click', async () => {
  const result = await apiPost('/ai/hashtags', { project_id: currentProjectId || 1 });
  const el = document.getElementById('ai-recap-result');
  if (result && result.hashtags) {
    el.innerHTML = result.hashtags.map(h => `<span style="display:inline-block;background:var(--bg-input);padding:1px 6px;border-radius:2px;margin:1px">#${h}</span>`).join(' ');
    el.style.color = 'var(--text)';
  } else {
    el.textContent = 'Dá»± phÃ²ng: Táº¡o hashtag sáº½ kháº£ dá»¥ng sau khi chuyá»ƒn Ã¢m';
    el.style.color = 'var(--text-muted)';
  }
});

document.getElementById('btn-ai-prompt')?.addEventListener('click', () => {
  const el = document.getElementById('ai-speakers-result');
  el.textContent = 'ThÆ° viá»‡n Prompt: Sá»­ dá»¥ng cÃ¡c cÃ¢u lá»‡nh há»— trá»£ bá»Ÿi AI Ä‘á»ƒ chá»‰nh sá»­a video sÃ¡ng táº¡o. Sáº¯p ra máº¯t.';
  el.style.color = 'var(--text-muted)';
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• EXPORT PANEL HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function getExportRenderParams() {
  const format = (document.getElementById('sel-export-format')?.value || 'MP4').toLowerCase();
  const codec = (document.getElementById('sel-export-codec')?.value || 'H264').toLowerCase();
  const bitrate = document.getElementById('sel-export-bitrate')?.value || '8M';
  const fps = document.getElementById('sel-export-fps')?.value || '30';
  const gpu = document.getElementById('sel-export-gpu')?.value || 'CPU';
  const inputPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  const inputName = inputPath.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, '') || `project_${currentProjectId || 1}`;
  return {
    inputPath,
    params: {
      format,
      codec,
      bitrate,
      fps,
      gpu,
      output_name: inputName,
      output_dir: document.getElementById('inp-output-path')?.value || undefined,
      burn_subtitle: document.getElementById('chk-sub-burn')?.checked ?? true,
      subtitle_region: getSubBoxRegion() || undefined,
      remove_hardsub: subBlurEnabled,
      subtitle_font: 'Arial',
      subtitle_size: 42,
      subtitle_color: '#FFFFFF',
      subtitle_shadow: 'soft',
      tts_enabled: false,
    },
  };
}

document.getElementById('btn-export-render')?.addEventListener('click', async () => {
  const render = getExportRenderParams();
  if (!render.inputPath) {
    alert('Vui long chon video truoc khi xuat.');
    return;
  }
  const item = await apiPost('/pipeline/start', {
    project_id: currentProjectId || 1,
    type: 'render',
    input_path: render.inputPath,
    params: render.params,
  });
  if (item) {
    addTaskRow();
  } else {
    addTaskRow();
    simulateProgress();
  }
});

function simulateProgress() {
  progressVal = 0;
  const interval = setInterval(() => {
    progressVal = Math.min(progressVal + Math.random() * 4, 100);
    queueFill.style.height = progressVal + '%';
    updateLastRow(progressVal);
    if (progressVal >= 100) clearInterval(interval);
  }, 200);
}

document.getElementById('btn-export-audio')?.addEventListener('click', async () => {
  const result = await apiPost('/export/audio', { project_id: currentProjectId || 1 });
  if (result && result.path) {
    addTaskRow();
    const fill = document.getElementById(`mini-fill-${rowCount}`);
    if (fill) fill.style.width = '100%';
  }
});

document.getElementById('btn-export-queue')?.addEventListener('click', async () => {
  const priorityMap = { High: 2, Normal: 1, Low: 0 };
  const pVal = document.getElementById('sel-export-priority')?.value || 'Normal';
  const render = getExportRenderParams();
  if (!render.inputPath) {
    alert('Vui long chon video truoc khi them vao hang cho.');
    return;
  }
  await apiPost('/queue', {
    project_id: currentProjectId || 1,
    type: 'render',
    input_path: render.inputPath,
    params: render.params,
    priority: priorityMap[pVal] ?? 1,
  });
  addTaskRow();
});

document.getElementById('btn-export-save-preset')?.addEventListener('click', async () => {
  const name = document.getElementById('sel-export-preset')?.value || 'Custom';
  await apiPost('/presets?name=' + encodeURIComponent(name), {
    resolution: '1920x1080',
    fps: document.getElementById('sel-export-fps')?.value || 30,
    codec: document.getElementById('sel-export-codec')?.value || 'h264',
    bitrate: document.getElementById('sel-export-bitrate')?.value || '8M',
  });
});

document.getElementById('btn-export-load-preset')?.addEventListener('click', async () => {
  const name = document.getElementById('sel-export-preset')?.value || 'Movie Review';
  const preset = await apiGet('/presets?name=' + encodeURIComponent(name));
  if (preset) {
    if (preset.codec) document.getElementById('sel-export-codec').value = preset.codec;
    if (preset.bitrate) document.getElementById('sel-export-bitrate').value = preset.bitrate;
    if (preset.fps) document.getElementById('sel-export-fps').value = preset.fps;
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• VOICE CLONE HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-voice-upload')?.addEventListener('click', async () => {
  const fileInput = document.getElementById('inp-voice-sample');
  const file = fileInput?.files?.[0];
  if (!file) return;
  const form = new FormData();
  form.append('file', file);
  try {
    const res = await fetch(API_BASE + `/voice/clone/upload?project_id=${currentProjectId || 1}`, { method: 'POST', body: form });
    if (res.ok) {
      fileInput.value = '';
    }
  } catch (e) {
    console.warn('Voice upload failed:', e.message);
  }
});

document.getElementById('btn-voice-train')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-voice-train');
  btn.textContent = 'â³ Äang huáº¥n luyá»‡n...';
  btn.disabled = true;
  await apiPost('/voice/clone/train', { project_id: currentProjectId || 1 });
  setTimeout(() => {
    btn.innerHTML = '<i class="ri-user-voice-line"></i> Huáº¥n luyá»‡n Giá»ng Ä‘á»c';
    btn.disabled = false;
  }, 3000);
});

document.getElementById('btn-voice-export-clone')?.addEventListener('click', async () => {
  const result = await apiGet('/voice/clone/export');
  if (result && result.path) {
    addTaskRow();
    const fill = document.getElementById(`mini-fill-${rowCount}`);
    if (fill) fill.style.width = '100%';
  }
});

document.getElementById('btn-voice-speakers')?.addEventListener('click', async () => {
  const result = await apiPost('/ai/speakers', { project_id: currentProjectId || 1 });
  if (result && result.speakers) {
    alert('ÄÃ£ phÃ¡t hiá»‡n ngÆ°á»i nÃ³i: ' + Object.keys(result.speakers).join(', '));
  } else {
    alert('Nháº­n diá»‡n ngÆ°á»i nÃ³i sáº½ cháº¡y sau khi chuyá»ƒn Ã¢m.');
  }
});

document.getElementById('chk-auto-diarize')?.addEventListener('change', function() {
  if (this.checked) {
    apiPost('/ai/speakers', { project_id: currentProjectId || 1, auto_diarize: true });
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• NAV CLICK â†’ TAB SWITCHING â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const navTab = item.dataset.tab;
    if (navTab === 'download') {
      document.getElementById('download-modal')?.classList.add('show');
      return;
    }
    if (navTab === 'settings') {
      document.getElementById('settings-modal')?.classList.add('show');
      return;
    }
    const targetTabId = navToTabMap[navTab];
    if (targetTabId) {
      const tabBtn = document.querySelector(`#processing-tabs .tab[data-target="${targetTabId}"]`);
      if (tabBtn) {
        if (window._switchTab) window._switchTab(tabBtn);
        else tabBtn.click();
      }
    }
  });
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• TIMELINE WIRING â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function loadTimeline(projectId) {
  const data = await apiGet(`/timeline/${projectId}`);
  if (!data) return;
  const tracksContainer = document.querySelector('.tracks-container');
  if (!tracksContainer) return;
  const trackTypes = [
    { type: 'video', icon: 'ri-film-line', label: 'Video 1', clipClass: 'track-clip' },
    { type: 'subtitle', icon: 'ri-closed-captioning-line', label: 'Subtitle', clipClass: 'track-clip music-clip' },
    { type: 'voice', icon: 'ri-mic-line', label: 'Voice', clipClass: 'track-clip voice-clip' },
    { type: 'music', icon: 'ri-music-2-line', label: 'Audio 1', clipClass: 'track-clip subtitle-clip' },
  ];
  const totalFrames = Math.max(
    ...(data.tracks || []).flatMap(t => (t.clips || []).map(c => c.end_frame || 0)),
    900
  );
  tracksContainer.innerHTML = trackTypes.map((tt, ti) => {
    const track = (data.tracks || []).find(t => t.type === tt.type);
    const clipsHtml = track
      ? (track.clips || []).map(c => {
          const w = totalFrames > 0 ? ((c.end_frame - c.start_frame) / totalFrames * 100) : 0;
          const l = totalFrames > 0 ? ((c.position_frame || 0) / totalFrames * 100) : 0;
          return `<div class="${tt.clipClass}" style="width:${Math.max(w, 5)}%;left:${l}%" title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || 'Clip')}</div>`;
        }).join('')
      : '<span class="track-lane-empty">â€”</span>';
    return `
      <div class="track-row">
        <div class="track-label"><i class="${tt.icon}"></i> ${tt.label}</div>
        <div class="track-lane">${clipsHtml || '<span class="track-lane-empty">â€”</span>'}</div>
      </div>
    `;
  }).join('');
  const ruler = document.querySelector('.timeline-ruler');
  if (ruler && data.tracks?.length) {
    const lastClip = data.tracks.flatMap(t => t.clips || []).slice(-1)[0];
    if (lastClip) {
      ruler.innerHTML = `<span>00:00</span><span>${formatTime(Math.floor((lastClip.end_frame || 0) / 30))}</span>`;
    }
  }
  setTimeout(makeTimelineInteractive, 100);
}


/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• MUSIC TAB HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-music-apply')?.addEventListener('click', async () => {
  const mVol = parseInt(document.getElementById('slider-music-volume')?.value || '35') / 100;
  const fIn = document.getElementById('chk-music-fade-in')?.checked ? 2 : 0;
  const fOut = document.getElementById('chk-music-fade-out')?.checked ? 2 : 0;
  const norm = document.getElementById('chk-music-normalize')?.checked || false;
  const inp = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  const qs = `input_path=${encodeURIComponent(inp)}&volume=${mVol}&fade_in=${fIn}&fade_out=${fOut}&normalize=${norm}`;
  await apiPost('/music/process?' + qs);
  addTaskRow();
});

document.getElementById('chk-music-duck')?.addEventListener('change', async function () {
  if (this.checked) {
    await apiPost('/music/duck', {
      music_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '',
      voice_path: '',
    });
    addTaskRow();
  }
});

document.getElementById('btn-music-folder')?.addEventListener('click', async () => {
  const files = await apiGet('/music/files');
  if (files) alert('Music files:\n' + files.map(f => 'â€¢ ' + f.name).join('\n'));
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ENHANCE TAB HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-enhance-apply')?.addEventListener('click', async () => {
  const lut = document.getElementById('sel-enhance-lut')?.value;
  const r = await apiPost('/enhance/apply', {
    video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '',
    lut: lut === 'None' ? null : lut,
    brightness: parseInt(document.getElementById('slider-enhance-brightness')?.value || '50'),
    contrast: parseInt(document.getElementById('slider-enhance-contrast')?.value || '55'),
    saturation: parseInt(document.getElementById('slider-enhance-saturation')?.value || '60'),
    temperature: parseInt(document.getElementById('slider-enhance-temperature')?.value || '48'),
    vignette: parseInt(document.getElementById('slider-enhance-vignette')?.value || '12'),
  });
  if (r) addTaskRow();
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• EDIT TAB HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-edit-rotate')?.addEventListener('click', async () => {
  const angle = document.querySelector('#tab-edit .text-input.num')?.value || '90';
  await apiPost('/edit/crop', {
    video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '',
    operations: [{ type: 'rotate', angle: parseFloat(angle) }],
  });
  addTaskRow();
});

document.getElementById('btn-edit-flip')?.addEventListener('click', async () => {
  await apiPost('/edit/crop', {
    video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '',
    operations: [{ type: 'hflip' }],
  });
  addTaskRow();
});

document.getElementById('btn-edit-split')?.addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  const originalHTML = btn.innerHTML;
  try {
    const start = prompt('Thoi gian bat dau (giay):', '0');
    if (start === null) return;
    const end = prompt('Thoi gian ket thuc (giay):', '10');
    if (end === null) return;

    validate(start, 'timestamp', 'Thoi gian bat dau khong hop le');
    validate(end, 'timestamp', 'Thoi gian ket thuc khong hop le');
    validate([start, end], 'timeRange');

    const videoPath = document.getElementById('inp-video-path')?.value?.trim() || '';
    validate(videoPath, 'videoFile', 'Vui long chon file video hop le');

    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Dang cat...';
    const res = await apiPost('/edit/split', {
      video_path: videoPath,
      operations: [{ type: 'split', start: Number(start), end: Number(end) }],
    });
    if (res) {
      showToast('Da gui lenh cat video', 'success');
      addTaskRow();
    }
  } catch (error) {
    showToast(error.message || String(error), error instanceof ValidationError ? 'warn' : 'error');
    addClientLog('error', 'Split video failed', error.stack || error.message || String(error));
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
});

document.getElementById('btn-edit-merge')?.addEventListener('click', async (event) => {
  const btn = event.currentTarget;
  const originalHTML = btn.innerHTML;
  try {
    const inp = prompt('Nhap duong dan cac video, cach nhau bang dau phay:', '');
    if (!inp) return;
    const paths = inp.split(',').map(p => p.trim()).filter(Boolean);
    validate(paths, 'pathArray', 'Can it nhat 2 video hop le');

    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Dang ghep...';
    const res = await apiPost('/edit/merge', {
      video_paths: paths,
      output_format: 'mp4',
    });
    if (res) {
      showToast('Da gui lenh ghep video', 'success');
      addTaskRow();
    }
  } catch (error) {
    showToast(error.message || String(error), error instanceof ValidationError ? 'warn' : 'error');
    addClientLog('error', 'Merge video failed', error.stack || error.message || String(error));
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SUBTITLE TAB HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function getSubtitleText() {
  // Priority 1: try to get already-imported subtitle from DB
  try {
    const subs = await apiGet('/subtitle/' + (currentProjectId || 1));
    if (subs && subs.length > 0 && subs[0].content) return subs[0].content;
  } catch (_) {}
  // Priority 2: read file content from local path via backend
  const srtPath = document.getElementById('inp-srt-path')?.value?.trim();
  if (srtPath) {
    try {
      const r = await apiPost('/subtitle/read-file', { path: srtPath });
      if (r && r.content) return r.content;
    } catch (_) {}
    return srtPath; // fallback: send the path and let backend open it
  }
  return '';
}

document.getElementById('btn-sub-transcribe')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sub-transcribe');
  const videoPath = document.getElementById('inp-video-path')?.value || '';
  if (!videoPath) {
    alert('Vui lÃ²ng chá»n tá»‡p video á»Ÿ pháº§n "LOAD Dá»® LIá»†U (BÆ¯á»šC 1)" trÆ°á»›c!');
    return;
  }

  btn.disabled = true;
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Äang nháº­n diá»‡n...';

  try {
    if (!currentProjectId) {
      const project = await apiPost('/projects', {
        name: 'project_' + Date.now(),
        preset: document.getElementById('sel-project-preset')?.value || 'Movie Review',
      });
      if (project) {
        currentProjectId = project.id;
        setTimeout(() => loadTimeline(currentProjectId), 500);
      }
    }

    const lang = document.getElementById('sel-sub-transcribe-lang')?.value || 'vi';
    const vocalSep = document.getElementById('chk-vocal-sep')?.checked ?? true;
    const useWhisperX = document.getElementById('chk-sub-whisperx')?.checked ?? true;

    const res = await apiPost('/queue', {
      project_id: currentProjectId || 1,
      type: 'transcribe',
      input_path: videoPath,
      params: {
        language: lang,
        vocal_separation: vocalSep,
        whisperx: useWhisperX,
      }
    });

    if (res && res.id) {
      alert('ÄÃ£ thÃªm tiáº¿n trÃ¬nh nháº­n dáº¡ng phá»¥ Ä‘á» gá»‘c (Whisper STT) vÃ o hÃ ng chá» thÃ nh cÃ´ng!');
      addTaskRow();
    } else {
      alert('Táº¡o tiáº¿n trÃ¬nh hÃ ng chá» tháº¥t báº¡i.');
    }
  } catch (e) {
    alert('Lá»—i nháº­n dáº¡ng phá»¥ Ä‘á»: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
});

document.getElementById('btn-sub-ocr')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sub-ocr');
  const videoPath = document.getElementById('inp-video-path')?.value || '';
  if (!videoPath) {
    alert('Vui long chon video truoc khi chay RapidOCR.');
    return;
  }

  btn.disabled = true;
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> OCR...';
  try {
    const res = await apiPost('/subtitle/ocr-video', {
      path: videoPath,
      project_id: currentProjectId || 1,
      region: getSubBoxRegion() || { ...subBoxRegion, alignment: 'bottom-center' },
    });
    if (res) {
      alert('Da bat dau RapidOCR sub cung. Mo log de xem tien trinh; SRT se luu vao project khi xong.');
      addTaskRow();
    }
  } catch (e) {
    alert('Loi RapidOCR: ' + (e.message || e));
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
});

document.getElementById('btn-sub-trans-gpt')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sub-trans-gpt');
  const text = await getSubtitleText();
  if (!text) { alert('ChÆ°a táº£i phá»¥ Ä‘á».'); return; }
  btn.disabled = true;
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Äang dá»‹ch...';
  try {
    await apiPost('/subtitle/translate', {
      text, engine: 'gpt',
      source_lang: document.getElementById('sel-lang-from')?.value === 'Tiáº¿ng Anh' ? 'en' : 'zh',
      target_lang: document.getElementById('sel-lang-to')?.value === 'Tiáº¿ng Anh' ? 'en' : 'vi',
    });
    addTaskRow();
  } catch (e) {
    alert('Dá»‹ch báº±ng GPT tháº¥t báº¡i: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
});

document.getElementById('btn-sub-trans-gemini')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sub-trans-gemini');
  const text = await getSubtitleText();
  if (!text) { alert('ChÆ°a táº£i phá»¥ Ä‘á».'); return; }
  btn.disabled = true;
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Äang dá»‹ch...';
  try {
    await apiPost('/subtitle/translate', {
      text, engine: 'gemini',
      source_lang: document.getElementById('sel-lang-from')?.value === 'Tiáº¿ng Anh' ? 'en' : 'zh',
      target_lang: document.getElementById('sel-lang-to')?.value === 'Tiáº¿ng Anh' ? 'en' : 'vi',
    });
    addTaskRow();
  } catch (e) {
    alert('Dá»‹ch báº±ng Gemini tháº¥t báº¡i: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
});

/* â”€â”€â”€ Translation Result Modal â”€â”€â”€ */
const transResultModal = document.getElementById('trans-result-modal');
const transResultText = document.getElementById('trans-result-text');
const transResultInfo = document.getElementById('trans-result-info');

function showTransResult(text, filename) {
  if (transResultText) transResultText.value = text;
  if (transResultInfo) transResultInfo.textContent = `NLLB-200 â€” ${filename || 'subtitle.srt'} (${(text||'').split('\n').length} dÃ²ng)`;
  transResultModal?.classList.add('show');
}

document.getElementById('btn-trans-copy')?.addEventListener('click', () => {
  if (!transResultText?.value) return;
  navigator.clipboard.writeText(transResultText.value).then(() => {
    const btn = document.getElementById('btn-trans-copy');
    const orig = btn.innerHTML;
    btn.innerHTML = '<i class="ri-check-line"></i> ÄÃ£ sao chÃ©p';
    setTimeout(() => btn.innerHTML = orig, 1500);
  });
});

document.getElementById('btn-trans-download')?.addEventListener('click', () => {
  const text = transResultText?.value;
  if (!text) return;
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'translated_nllb.srt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

document.getElementById('btn-sub-trans-nllb')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sub-trans-nllb');
  const srtPath = document.getElementById('inp-srt-path')?.value?.trim();
  const text = await getSubtitleText();
  if (!text) { alert('ChÆ°a cÃ³ file SRT. HÃ£y nháº­p Ä‘Æ°á»ng dáº«n file .srt vÃ o Ã´ Path Subtitle rá»“i thá»­ láº¡i.'); return; }

  btn.disabled = true;
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Äang khá»Ÿi Ä‘á»™ng...';
  const t0 = Date.now();

  const fromLang = document.getElementById('sel-lang-from')?.value;
  const toLang = document.getElementById('sel-lang-to')?.value;
  const LANG_MAP = {'Tiáº¿ng Anh':'en','Tiáº¿ng Trung':'zh','Tiáº¿ng Nháº­t':'ja','Tiáº¿ng HÃ n':'ko','Tiáº¿ng Viá»‡t':'vi','Tiáº¿ng Nga':'ru','Tiáº¿ng PhÃ¡p':'fr','Tiáº¿ng Äá»©c':'de'};
  const srcCode = LANG_MAP[fromLang] || 'en';
  const dstCode = LANG_MAP[toLang] || 'vi';
  const srtName = srtPath ? srtPath.split(/[\/\\]/).pop() : 'subtitle.srt';

  // Add row with 0% progress immediately
  rowCount++;
  const rowId = rowCount;
  const row = document.createElement('div');
  row.className = 'result-row';
  row.id = `task-row-${rowId}`;
  row.innerHTML = `
    <div class="result-cell" style="width:110px;color:#a78bfa">${srtName}</div>
    <div class="result-cell" style="width:130px;color:#94a3b8">translated_nllb.srt</div>
    <div class="result-cell" style="width:100px">
      <div class="mini-progress"><div class="mini-progress-fill" id="mini-fill-${rowId}" style="width:0%"></div></div>
    </div>
    <div class="result-cell" style="width:50px">${rowId}</div>
    <div class="result-cell" style="width:100px;color:#facc15" id="elapsed-${rowId}">00:00</div>
    <div class="result-cell flex1" style="color:#8892a4">${fromLang || 'Anh'}</div>
    <div class="result-cell flex1" style="color:#8892a4" id="subdich-${rowId}">â³ 0%</div>
  `;
  resultBody.appendChild(row);
  resultBody.scrollTop = resultBody.scrollHeight;

  // Elapsed timer
  const timerInterval = setInterval(() => {
    const sec = Math.round((Date.now() - t0) / 1000);
    const mm = String(Math.floor(sec / 60)).padStart(2,'0');
    const ss = String(sec % 60).padStart(2,'0');
    const el = document.getElementById(`elapsed-${rowId}`);
    if (el) el.textContent = `${mm}:${ss}`;
  }, 1000);

  try {
    // Start async job
    const startRes = await apiPost('/subtitle/translate', {
      text, engine: 'nllb',
      source_lang: srcCode,
      target_lang: dstCode,
      project_id: currentProjectId || null,
    });

    if (!startRes?.job_id) {
      // Plain text â€” already done
      const fill = document.getElementById(`mini-fill-${rowId}`);
      if (fill) fill.style.width = '100%';
      const sd = document.getElementById(`subdich-${rowId}`);
      if (sd) sd.textContent = `${toLang}: ${(startRes?.translated||'').substring(0,40)}...`;
      clearInterval(timerInterval);
      btn.disabled = false;
      btn.innerHTML = oldText;
      return;
    }

    // Poll progress
    const jobId = startRes.job_id;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Äang dá»‹ch...';

    await new Promise((resolve) => {
      const poll = setInterval(async () => {
        try {
          const prog = await apiGet(`/subtitle/translate-progress/${jobId}`);
          const pct = prog?.progress ?? 0;
          const fill = document.getElementById(`mini-fill-${rowId}`);
          if (fill) fill.style.width = `${pct}%`;
          const sd = document.getElementById(`subdich-${rowId}`);
          if (sd) sd.textContent = `â³ ${pct}%`;
          btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> ${pct}%`;

          if (prog?.status === 'done') {
            clearInterval(poll);
            const translated = prog.translated || '';
            const snippet = translated.replace(/\n/g,' ').substring(0, 40);
            if (sd) {
              sd.textContent = `${toLang}: ${snippet}...`;
              // Click to view full result
              sd.style.cursor = 'pointer';
              sd.style.color = '#60a5fa';
              sd.title = 'Click Ä‘á»ƒ xem káº¿t quáº£ dá»‹ch Ä‘áº§y Ä‘á»§';
              sd.onclick = () => showTransResult(translated, srtName);
            }
            if (fill) fill.style.width = '100%';
            // Check if result contains error placeholder
            if (/\[NLLB unavailable/i.test(translated) || /\[NLLB error/i.test(translated)) {
              setTimeout(() => alert('NLLB khÃ´ng kháº£ dá»¥ng trong báº£n EXE.\nDÃ¹ng GPT hoáº·c Gemini, hoáº·c cháº¡y tá»« source.'), 100);
            }
            resolve();
          } else if (prog?.status === 'error') {
            clearInterval(poll);
            if (sd) sd.textContent = `âŒ ${prog.error}`;
            resolve();
          }
        } catch(_) {}
      }, 500);
    });

  } catch (e) {
    alert('Dá»‹ch báº±ng NLLB tháº¥t báº¡i: ' + e.message);
  } finally {
    clearInterval(timerInterval);
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
});

document.getElementById('btn-sub-trans-marian')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sub-trans-marian');
  const text = await getSubtitleText();
  if (!text) { alert('ChÆ°a táº£i phá»¥ Ä‘á».'); return; }
  btn.disabled = true;
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Äang dá»‹ch...';
  try {
    await apiPost('/subtitle/translate', {
      text, engine: 'marian',
      source_lang: document.getElementById('sel-lang-from')?.value === 'Tiáº¿ng Anh' ? 'en' : 'zh',
      target_lang: document.getElementById('sel-lang-to')?.value === 'Tiáº¿ng Anh' ? 'en' : 'vi',
    });
    addTaskRow();
  } catch (e) {
    alert('Dá»‹ch báº±ng MarianMT tháº¥t báº¡i: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
});

document.getElementById('btn-sub-trans-batch')?.addEventListener('click', async () => {
  const text = await getSubtitleText();
  if (!text) { alert('ChÆ°a táº£i phá»¥ Ä‘á».'); return; }
  await apiPost('/subtitle/translate', {
    text, engine: 'gpt',
    source_lang: document.getElementById('sel-lang-from')?.value === 'Tiáº¿ng Anh' ? 'en' : 'zh',
    target_lang: document.getElementById('sel-lang-to')?.value === 'Tiáº¿ng Anh' ? 'en' : 'vi',
  });
  addTaskRow();
});

document.getElementById('btn-sub-export-srt')?.addEventListener('click', async () => {
  const r = await apiPost('/subtitle/export?project_id=' + (currentProjectId || 1) + '&fmt=srt');
  if (r) addTaskRow();
});

document.getElementById('btn-sub-export-ass')?.addEventListener('click', async () => {
  const r = await apiPost('/subtitle/export?project_id=' + (currentProjectId || 1) + '&fmt=ass');
  if (r) addTaskRow();
});

document.getElementById('btn-sub-export-burn')?.addEventListener('click', async () => {
  const r = await apiPost('/pipeline/start', {
    project_id: currentProjectId || 1,
    input_path: document.getElementById('inp-video-path')?.value || '',
    type: 'pipeline',
    params: {
      source_lang: 'vi', target_lang: 'vi',
      translate_engine: 'nllb',
      tts_provider: 'edge',
      tts_voice: 'vi-VN-NamMinhNeural',
      burn_subtitle: true,
      subtitle_region: getSubBoxRegion() || undefined,
      remove_hardsub: subBlurEnabled,
      tts_enabled: false,
    },
  });
  if (r) addTaskRow();
});

/* â”€â”€â”€ Init: load dashboard & settings â”€â”€â”€ */
loadDashboard();
setTimeout(async () => {
  const settings = await apiGet('/settings');
  if (settings) {
    if (settings.openai_key) document.getElementById('inp-set-openai').value = settings.openai_key;
    if (settings.elevenlabs_key) document.getElementById('inp-set-eleven').value = settings.elevenlabs_key;
    if (settings.ffmpeg_path) document.getElementById('inp-set-ffmpeg').value = settings.ffmpeg_path;
    if (settings.proxy) document.getElementById('inp-set-proxy').value = settings.proxy;
    if (settings.cookie_file) document.getElementById('inp-set-cookie').value = settings.cookie_file;
    if (settings.youtube_cookie) document.getElementById('inp-set-yt-cookie').value = settings.youtube_cookie;
  }
}, 200);

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SETTINGS SAVE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-save-settings')?.addEventListener('click', async () => {
  const data = {
    openai_key: document.getElementById('inp-set-openai')?.value || '',
    elevenlabs_key: document.getElementById('inp-set-eleven')?.value || '',
    ffmpeg_path: document.getElementById('inp-set-ffmpeg')?.value || '',
    proxy: document.getElementById('inp-set-proxy')?.value || '',
    cookie_file: document.getElementById('inp-set-cookie')?.value || '',
    youtube_cookie: document.getElementById('inp-set-yt-cookie')?.value || '',
  };
  const result = await apiPut('/settings', data);
  if (result) {
    alert('ÄÃ£ lÆ°u cÃ i Ä‘áº·t!');
    document.getElementById('settings-modal')?.classList.remove('show');
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• MODAL LOGIC â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.querySelectorAll('.close-modal').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.target.closest('.modal-overlay')?.classList.remove('show');
  });
});

function updateDownloadProgressUI(data) {
  if (!data || !data.id) return;
  const fill = document.getElementById('download-progress');
  const pct = document.getElementById('download-pct');
  const row = document.getElementById('download-output-row');
  const pathInput = document.getElementById('inp-downloaded-path');
  const progress = Math.max(0, Math.min(100, Math.round(data.progress || 0)));
  if (fill) fill.style.width = progress + '%';
  if (pct) pct.textContent = progress + '%';
  if (data.output_path && pathInput) {
    pathInput.value = data.output_path;
    if (row) row.style.display = 'flex';
    const videoInput = document.getElementById('inp-video-path');
    if (videoInput) {
      videoInput.value = data.output_path;
      loadVideoPreview();
    }
  }
  if (data.status === 'failed' && data.error) {
    showToast('Download loi: ' + data.error, 'error', 6000);
  }
}

document.getElementById('btn-browse-download-output')?.addEventListener('click', async () => {
  const res = await apiGet('/system/browse?type=folder');
  if (res && res.path) document.getElementById('inp-download-output').value = res.path;
});

document.getElementById('btn-start-download')?.addEventListener('click', async () => {
  const url = document.getElementById('inp-download-url')?.value;
  if (!url) return;
  const quality = document.getElementById('sel-download-quality')?.value || 'best';
  const proxy = document.getElementById('inp-download-proxy')?.value || '';
  const outputDir = document.getElementById('inp-download-output')?.value || '';
  
  document.getElementById('download-progress-container').style.display = 'flex';
  document.getElementById('download-output-row').style.display = 'none';
  const fill = document.getElementById('download-progress');
  const pct = document.getElementById('download-pct');
  fill.style.width = '0%'; pct.textContent = '0%';
  
  const res = await apiPost('/download/', { url, quality, proxy, output_dir: outputDir, project_id: currentProjectId || 1 });
  if (res && res.id) {
    pollDownload(res.id);
  } else {
    showToast('Khong tao duoc job download', 'error');
  }
});

async function pollDownload(downloadId) {
  const interval = setInterval(async () => {
    const data = await apiGet('/download/' + downloadId);
    if (data) {
      updateDownloadProgressUI(data);
      if (data.status === 'completed' || data.status === 'failed' || data.status === 'cancelled') {
        clearInterval(interval);
        loadDownloadHistory();
        if (data.status === 'completed') {
          showToast('Download xong', 'success', 3000);
        }
      }
    }
  }, 1500);
}


function loadVideoPreview() {
  const path = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value;
  const video = document.getElementById('video-player');
  const msg = document.getElementById('no-video-msg');
  if (!video || !msg) return;
  if (path && (path.endsWith('.mp4') || path.endsWith('.mkv') || path.endsWith('.avi') || path.endsWith('.mov'))) {
    video.src = '/api/video/serve?path=' + encodeURIComponent(path);
    video.style.display = 'block';
    msg.style.display = 'none';
    video.load();
  } else {
    video.style.display = 'none';
    msg.style.display = 'flex';
  }
}

/* â”€â”€â”€ Video preview from browse â”€â”€â”€ */
document.getElementById('inp-video-path')?.addEventListener('change', loadVideoPreview);
document.getElementById('inp-video-path')?.addEventListener('paste', () => setTimeout(loadVideoPreview, 100));
document.getElementById('inp-srt-path')?.addEventListener('change', loadVideoPreview);
document.getElementById('inp-srt-path')?.addEventListener('paste', () => setTimeout(loadVideoPreview, 100));

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SUBTITLE BOX OVERLAY â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

// Default region as fraction of video size (0-1)
const SUB_BOX_DEFAULTS = { x: 0.1, y: 0.78, width: 0.8, height: 0.15 };
let subBoxVisible = false;
let subBoxRegion = { ...SUB_BOX_DEFAULTS };
let subBoxDrag = null; // { type: 'move'|'resize', startX, startY, startRect }
let subBlurEnabled = false;

const ALIGNMENT_PRESETS = {
  'bottom-center': { x: 0.1, y: 0.78, width: 0.8, height: 0.15 },
  'top-center': { x: 0.1, y: 0.05, width: 0.8, height: 0.15 },
  'center': { x: 0.1, y: 0.42, width: 0.8, height: 0.15 },
  'bottom-left': { x: 0.05, y: 0.78, width: 0.45, height: 0.15 },
  'bottom-right': { x: 0.5, y: 0.78, width: 0.45, height: 0.15 },
  'top-left': { x: 0.05, y: 0.05, width: 0.45, height: 0.15 },
  'top-right': { x: 0.5, y: 0.05, width: 0.45, height: 0.15 },
};

function subBoxSyncPosition(skipInputs = false) {
  const overlay = document.getElementById('sub-box-overlay');
  const canvas = document.getElementById('preview-canvas');
  if (!overlay || !canvas) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  overlay.style.left = (subBoxRegion.x * cw) + 'px';
  overlay.style.top = (subBoxRegion.y * ch) + 'px';
  overlay.style.width = (subBoxRegion.width * cw) + 'px';
  overlay.style.height = (subBoxRegion.height * ch) + 'px';

  if (!skipInputs) {
    const ix = document.getElementById('inp-sub-x');
    const iy = document.getElementById('inp-sub-y');
    const iw = document.getElementById('inp-sub-w');
    const ih = document.getElementById('inp-sub-h');
    if (ix) ix.value = Math.round(subBoxRegion.x * 100);
    if (iy) iy.value = Math.round(subBoxRegion.y * 100);
    if (iw) iw.value = Math.round(subBoxRegion.width * 100);
    if (ih) ih.value = Math.round(subBoxRegion.height * 100);
  }
}

function subBoxShow() {
  const overlay = document.getElementById('sub-box-overlay');
  const controls = document.getElementById('sub-region-controls');
  if (!overlay) return;
  overlay.style.display = 'block';
  if (controls) controls.style.display = 'flex';
  subBoxVisible = true;
  subBoxSyncPosition();
  document.getElementById('btn-preview-sub-box')?.classList.add('active');
}

function subBoxHide() {
  const overlay = document.getElementById('sub-box-overlay');
  const controls = document.getElementById('sub-region-controls');
  if (!overlay) return;
  overlay.style.display = 'none';
  if (controls) controls.style.display = 'none';
  subBoxVisible = false;
  document.getElementById('btn-preview-sub-box')?.classList.remove('active');
}

function subBoxToggle() {
  if (subBoxVisible) subBoxHide();
  else subBoxShow();
}

document.getElementById('btn-preview-sub-box')?.addEventListener('click', subBoxToggle);
document.getElementById('btn-preview-sub-blur')?.addEventListener('click', function() {
  subBlurEnabled = !subBlurEnabled;
  this.classList.toggle('active', subBlurEnabled);
  if (subBlurEnabled && !subBoxVisible) subBoxShow();
  showToast(subBlurEnabled ? 'Da bat lam mo phu de goc trong vung subtitle' : 'Da tat lam mo phu de goc', 'info', 2500);
});

// Inputs to Box sync
function handleSubInput() {
  const ix = parseFloat(document.getElementById('inp-sub-x')?.value || 0) / 100;
  const iy = parseFloat(document.getElementById('inp-sub-y')?.value || 0) / 100;
  const iw = parseFloat(document.getElementById('inp-sub-w')?.value || 5) / 100;
  const ih = parseFloat(document.getElementById('inp-sub-h')?.value || 5) / 100;

  subBoxRegion.x = Math.max(0, Math.min(1 - iw, ix));
  subBoxRegion.y = Math.max(0, Math.min(1 - ih, iy));
  subBoxRegion.width = Math.max(0.05, Math.min(1, iw));
  subBoxRegion.height = Math.max(0.05, Math.min(1, ih));

  const sel = document.getElementById('sel-sub-alignment');
  if (sel) sel.value = 'custom';

  subBoxSyncPosition(true); // skip updating the inputs we are typing into
}

['inp-sub-x', 'inp-sub-y', 'inp-sub-w', 'inp-sub-h'].forEach(id => {
  document.getElementById(id)?.addEventListener('input', handleSubInput);
});

// Alignment selector
document.getElementById('sel-sub-alignment')?.addEventListener('change', function(e) {
  const val = e.target.value;
  if (val && val !== 'custom') {
    const preset = ALIGNMENT_PRESETS[val];
    if (preset) {
      subBoxRegion = { ...preset };
      subBoxSyncPosition();
    }
  }
});

// Reset button
document.getElementById('btn-sub-region-reset')?.addEventListener('click', function() {
  subBoxRegion = { ...SUB_BOX_DEFAULTS };
  const sel = document.getElementById('sel-sub-alignment');
  if (sel) sel.value = 'bottom-center';
  subBoxSyncPosition();
});

// Drag to move
document.getElementById('sub-box-overlay')?.addEventListener('mousedown', function (e) {
  if (e.target.classList.contains('sub-box-handle')) return;
  const rect = this.getBoundingClientRect();
  const canvas = document.getElementById('preview-canvas');
  subBoxDrag = { type: 'move', startX: e.clientX, startY: e.clientY, startRect: { ...subBoxRegion } };
  this.classList.add('active');
  e.preventDefault();
});

// Resize via handles
document.querySelectorAll('.sub-box-handle').forEach(h => {
  h.addEventListener('mousedown', function (e) {
    const overlay = document.getElementById('sub-box-overlay');
    const canvas = document.getElementById('preview-canvas');
    const rect = overlay.getBoundingClientRect();
    subBoxDrag = {
      type: 'resize',
      corner: this.className.match(/sub-box-(\w+)/)?.[1] || 'se',
      startX: e.clientX,
      startY: e.clientY,
      startRect: { ...subBoxRegion },
    };
    overlay.classList.add('active');
    e.stopPropagation();
    e.preventDefault();
  });
});

document.addEventListener('mousemove', function (e) {
  if (!subBoxDrag) return;
  const canvas = document.getElementById('preview-canvas');
  if (!canvas) return;
  const cw = canvas.clientWidth;
  const ch = canvas.clientHeight;
  const dx = (e.clientX - subBoxDrag.startX) / cw;
  const dy = (e.clientY - subBoxDrag.startY) / ch;
  const s = subBoxDrag.startRect;

  if (subBoxDrag.type === 'move') {
    subBoxRegion.x = Math.max(0, Math.min(1 - subBoxRegion.width, s.x + dx));
    subBoxRegion.y = Math.max(0, Math.min(1 - subBoxRegion.height, s.y + dy));
  } else if (subBoxDrag.type === 'resize') {
    const c = subBoxDrag.corner;
    let nx = s.x, ny = s.y, nw = s.width, nh = s.height;
    if (c.includes('e')) { nw = Math.max(0.05, s.width + dx); }
    if (c.includes('w')) { nw = Math.max(0.05, s.width - dx); nx = s.x + (s.width - nw); }
    if (c.includes('s')) { nh = Math.max(0.05, s.height + dy); }
    if (c.includes('n')) { nh = Math.max(0.05, s.height - dy); ny = s.y + (s.height - nh); }
    subBoxRegion.x = Math.max(0, Math.min(1 - nw, nx));
    subBoxRegion.y = Math.max(0, Math.min(1 - nh, ny));
    subBoxRegion.width = Math.min(1 - subBoxRegion.x, nw);
    subBoxRegion.height = Math.min(1 - subBoxRegion.y, nh);
  }
  subBoxSyncPosition();
});

document.addEventListener('mouseup', function () {
  if (subBoxDrag) {
    document.getElementById('sub-box-overlay')?.classList.remove('active');
    subBoxDrag = null;
  }
});

// Also update position on window resize
window.addEventListener('resize', function () {
  if (subBoxVisible) subBoxSyncPosition();
});

// Expose region for preset saving
function getSubBoxRegion() {
  const sel = document.getElementById('sel-sub-alignment');
  const alignment = sel ? sel.value : 'bottom-center';
  return subBoxVisible ? { ...subBoxRegion, alignment } : null;
}
function setSubBoxRegion(region) {
  if (region && region.x !== undefined) {
    subBoxRegion = {
      x: region.x,
      y: region.y,
      width: region.width ?? region.w ?? 0.8,
      height: region.height ?? region.h ?? 0.15
    };
    const sel = document.getElementById('sel-sub-alignment');
    if (sel) sel.value = region.alignment || 'custom';
  } else {
    subBoxRegion = { ...SUB_BOX_DEFAULTS };
    const sel = document.getElementById('sel-sub-alignment');
    if (sel) sel.value = 'bottom-center';
  }
  if (subBoxVisible) subBoxSyncPosition();
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• PROMPT LIBRARY â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.querySelectorAll('.prompt-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const prompt = btn.dataset.prompt;
    const textarea = document.getElementById('inp-ai-summary');
    if (textarea) {
      textarea.value = prompt;
      textarea.focus();
    }
  });
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• PUBLISH HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
let publishPlatform = '';

document.getElementById('btn-publish-youtube')?.addEventListener('click', () => showPublishInputs('youtube'));
document.getElementById('btn-publish-tiktok')?.addEventListener('click', () => showPublishInputs('tiktok'));
document.getElementById('btn-publish-facebook')?.addEventListener('click', () => showPublishInputs('facebook'));

function showPublishInputs(platform) {
  publishPlatform = platform;
  const container = document.getElementById('publish-inputs');
  const titleInp = document.getElementById('inp-publish-title');
  const descInp = document.getElementById('inp-publish-desc');
  if (container) {
    container.style.display = 'flex';
    if (titleInp) titleInp.value = (document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value)?.split(/[\\\\/]/).pop()?.replace(/\.[^.]+$/, '') || 'My Video';
    if (descInp) descInp.value = '';
    titleInp?.focus();
  }
}

document.getElementById('btn-publish-confirm')?.addEventListener('click', async () => {
  const title = document.getElementById('inp-publish-title')?.value || 'My Video';
  const desc = document.getElementById('inp-publish-desc')?.value || '';
  const videoPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  if (!videoPath) { alert('No video selected'); return; }
  const result = await apiPost(`/publish/${publishPlatform}`, { video_path: videoPath, title, description: desc });
  if (result) {
    addTaskRow();
    document.getElementById('publish-inputs').style.display = 'none';
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• BATCH URL DOWNLOAD â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-batch-download')?.addEventListener('click', async () => {
  const urlsInput = document.getElementById('inp-batch-urls')?.value;
  if (!urlsInput) return;
  const urls = urlsInput.split('\n').map(u => u.trim()).filter(Boolean);
  if (urls.length === 0) return;
  const quality = document.getElementById('sel-download-quality')?.value || 'best';
  const proxy = document.getElementById('inp-download-proxy')?.value || '';
  const cookie = document.getElementById('inp-set-cookie')?.value || '';
  const result = await apiPost('/batch/download', { urls, quality, proxy, cookie_file: cookie, project_id: currentProjectId || 1 });
  if (result) {
    for (let i = 0; i < urls.length; i++) addTaskRow();
    document.getElementById('inp-batch-urls').value = '';
    setTimeout(loadDownloadHistory, 500);
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• TEMPLATE HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */

function openTemplateModal() {
  const modal = document.getElementById('template-modal');
  if (modal) modal.classList.add('show');
  loadTemplateList();
}

async function loadTemplateList() {
  const container = document.getElementById('template-list');
  if (!container) return;
  const templates = await apiGet('/templates');
  if (!templates || templates.length === 0) {
    container.innerHTML = '<div class="log-placeholder">ChÆ°a cÃ³ template nÃ o.</div>';
    document.getElementById('template-count') && (document.getElementById('template-count').textContent = '0 máº«u sáºµn');
    return;
  }
  container.innerHTML = templates.map(t => `
    <div class="result-table-header" style="padding:2px 6px;font-size:9px;border-bottom:1px solid var(--border);cursor:default">
      <span class="col-hdr" style="flex:2">${t.name || 'ChÆ°a Ä‘áº·t tÃªn'}</span>
      <span class="col-hdr" style="flex:1">${t.preset || '-'}</span>
      <span class="col-hdr" style="width:60px">${t.resolution || '-'}</span>
      <span class="col-hdr" style="width:40px">${t.fps || '-'}</span>
      <span class="col-hdr" style="width:100px;display:flex;gap:4px">
        <button class="action-btn tmpl-load" data-name="${t.name}" style="height:18px;padding:0 6px;font-size:8px">Táº£i</button>
        <button class="action-btn tmpl-delete" data-name="${t.name}" style="height:18px;padding:0 6px;font-size:8px;background:#ef4444;color:#fff;border:none">XÃ³a</button>
      </span>
    </div>
  `).join('');
  container.querySelectorAll('.tmpl-load').forEach(btn => {
    btn.addEventListener('click', () => applyTemplateByName(btn.dataset.name));
  });
  container.querySelectorAll('.tmpl-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      await apiDel('/templates/' + encodeURIComponent(btn.dataset.name));
      loadTemplateList();
    });
  });
}

async function applyTemplateByName(name) {
  const tmpl = await apiGet('/templates/' + encodeURIComponent(name));
  if (tmpl && tmpl.export) {
    if (tmpl.export.resolution) {
      const parts = tmpl.export.resolution.split('x');
      if (parts.length === 2) {
        const w = document.getElementById('inp-width'); if (w) w.value = parts[0];
        const h = document.getElementById('inp-height'); if (h) h.value = parts[1];
      }
    }
    if (tmpl.export.fps) { const el = document.getElementById('sel-export-fps'); if (el) el.value = tmpl.export.fps; }
    if (tmpl.export.codec) { const el = document.getElementById('sel-export-codec'); if (el) el.value = tmpl.export.codec.toUpperCase(); }
  }
  if (currentProjectId && name) {
    await apiPost(`/templates/${encodeURIComponent(name)}/apply?project_id=${currentProjectId}`);
  }
  document.getElementById('template-modal')?.classList.remove('show');
}

document.getElementById('btn-save-template')?.addEventListener('click', async () => {
  const name = document.getElementById('inp-template-name')?.value || prompt('TÃªn template:', 'Máº«u cá»§a tÃ´i');
  if (!name) return;
  const config = {
    name,
    preset: document.getElementById('sel-project-preset')?.value || 'Movie Review',
    voice: { provider: document.getElementById('sel-tts-provider')?.value?.toLowerCase() || 'edge' },
    subtitle: { font: 'Arial', size: 42, color: '#FFFFFF', burn: true },
    export: {
      resolution: (document.getElementById('inp-width')?.value || '1920') + 'x' + (document.getElementById('inp-height')?.value || '1080'),
      fps: parseInt(document.getElementById('sel-export-fps')?.value || '30'),
      codec: document.getElementById('sel-export-codec')?.value || 'h264',
    },
  };
  await apiPost('/templates?name=' + encodeURIComponent(name), config);
  loadTemplateList();
  if (document.getElementById('inp-template-name')) document.getElementById('inp-template-name').value = '';
});

document.getElementById('btn-load-template')?.addEventListener('click', openTemplateModal);

document.getElementById('btn-template-save')?.addEventListener('click', () => {
  document.getElementById('btn-save-template')?.click();
});

document.getElementById('btn-template-refresh')?.addEventListener('click', loadTemplateList);

// Wire template modal close to also close when clicking background
document.getElementById('template-modal')?.addEventListener('click', function (e) {
  if (e.target === this) this.classList.remove('show');
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• PUBLISH HISTORY â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-publish-history')?.addEventListener('click', async () => {
  const modal = document.getElementById('publish-history-modal');
  if (modal) modal.classList.add('show');
  await loadPublishHistory();
});

document.getElementById('btn-pub-history-refresh')?.addEventListener('click', loadPublishHistory);

document.getElementById('publish-history-modal')?.addEventListener('click', function (e) {
  if (e.target === this) this.classList.remove('show');
});

async function loadPublishHistory() {
  const container = document.getElementById('publish-history-list');
  const countEl = document.getElementById('pub-history-count');
  if (!container) return;
  const items = await apiGet('/publish/history');
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="log-placeholder">ChÆ°a cÃ³ lá»‹ch sá»­ publish.</div>';
    if (countEl) countEl.textContent = '0 items';
    return;
  }
  container.innerHTML = items.map(item => `
    <div class="result-table-header" style="padding:2px 6px;font-size:9px;border-bottom:1px solid var(--border)">
      <span class="col-hdr" style="flex:2">${item.title || item.input_path?.split(/[\\/]/).pop() || 'Unknown'}</span>
      <span class="col-hdr" style="flex:1">${item.format || '-'}</span>
      <span class="col-hdr" style="width:70px"><span class="queue-status-${item.status || 'exported'}">${item.status || 'exported'}</span></span>
      <span class="col-hdr" style="width:120px">${item.created_at ? item.created_at.slice(0, 19) : '-'}</span>
    </div>
  `).join('');
  if (countEl) countEl.textContent = items.length + ' items';
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• DOWNLOAD HISTORY â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function loadDownloadHistory() {
  const container = document.getElementById('download-history-list');
  if (!container) return;
  const items = await apiGet('/download');
  if (!items || items.length === 0) {
    container.innerHTML = '<div class="log-placeholder">ChÆ°a cÃ³ download nÃ o.</div>';
    return;
  }
  container.innerHTML = items.slice().reverse().map(item => `
    <div class="result-table-header" style="padding:2px 6px;font-size:9px;border-bottom:1px solid var(--border)">
      <span class="col-hdr" style="flex:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${item.url || item.id}</span>
      <span class="col-hdr" style="flex:2;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${item.output_path || item.error || ''}">${item.output_path ? item.output_path.split(/[\\/]/).pop() : (item.error || '-')}</span>
      <span class="col-hdr" style="width:60px">${item.platform || '-'}</span>
      <span class="col-hdr" style="width:60px"><span class="queue-status-${item.status || 'unknown'}">${item.status || '?'}</span></span>
      <span class="col-hdr" style="width:50px">
        ${item.status === 'running' || item.status === 'waiting' ? `<button class="action-btn dl-cancel" data-id="${item.id}" style="height:16px;padding:0 4px;font-size:7px;background:#ef4444;color:#fff;border:none">Há»§y</button>` : ''}
      </span>
    </div>
  `).join('');
  container.querySelectorAll('.dl-cancel').forEach(btn => {
    btn.addEventListener('click', async () => {
      await apiPost(`/download/${btn.dataset.id}/cancel`);
      loadDownloadHistory();
    });
  });
}

document.getElementById('btn-dl-history-refresh')?.addEventListener('click', loadDownloadHistory);

// Load download history when the download modal opens
document.querySelector('[data-tab="download"]')?.addEventListener('click', function () {
  setTimeout(loadDownloadHistory, 300);
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• MUSIC CROSSFADE / PLAYLIST â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-music-crossfade')?.addEventListener('click', async () => {
  const dur = prompt('Thá»i gian chá»“ng má» (giÃ¢y):', '2');
  if (dur === null) return;
  await apiPost('/edit/crop', {
    video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '',
    operations: [{ type: 'crossfade', duration: parseFloat(dur) }],
  });
  addTaskRow();
});

document.getElementById('btn-music-playlist')?.addEventListener('click', async () => {
  const files = await apiGet('/music/files');
  const musicDir = files ? files.map(f => `â€¢ ${f.name}`).join('\n') : '(empty)';
  alert(`Music Library:\n${musicDir}\n\nUse Music Folder to see all files.`);
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• KEEP BGM TOGGLE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('chk-keep-bgm')?.addEventListener('change', function() {
  const vol = document.getElementById('inp-bgm-vol');
  if (vol) {
    vol.disabled = !this.checked;
    vol.style.opacity = this.checked ? '1' : '0.4';
  }
});
// Init state
document.getElementById('inp-bgm-vol') && (() => {
  const chk = document.getElementById('chk-keep-bgm');
  if (chk && !chk.checked) {
    document.getElementById('inp-bgm-vol').disabled = true;
    document.getElementById('inp-bgm-vol').style.opacity = '0.4';
  }
})();

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• AUTO VOICE TOGGLE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('chk-auto-voice')?.addEventListener('change', function() {
  const inputs = ['sel-tts-provider', 'sel-voice-lang', 'sel-voice-type', 'btn-play-voice', 'sel-voice-mode', 'chk-keep-bgm', 'inp-bgm-vol'];
  inputs.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = !this.checked;
      el.style.opacity = this.checked ? '1' : '0.4';
    }
  });
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SPEED RAMP / MOTION EFFECTS HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.querySelectorAll('#tab-enhance .custom-checkbox input').forEach(chk => {
  chk.addEventListener('change', function() {
    const label = this.closest('.feature-item')?.querySelector('.field-label')?.textContent?.toLowerCase().trim();
    if (label === 'slow motion' || label === 'fast motion' || label === 'speed ramp' || label === 'particle effects') {
      // These are handled by the main enhance apply button
    }
  });
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• TIMELINE INTERACTIVE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function makeTimelineInteractive() {
  document.querySelectorAll('.track-clip').forEach(clip => {
    clip.setAttribute('draggable', 'true');
    clip.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', clip.textContent);
      clip.style.opacity = '0.5';
    });
    clip.addEventListener('dragend', () => { clip.style.opacity = '1'; });
  });

  document.querySelectorAll('.track-lane').forEach(lane => {
    lane.addEventListener('dragover', (e) => {
      e.preventDefault();
      lane.style.background = 'rgba(137,87,229,0.15)';
    });
    lane.addEventListener('dragleave', () => {
      lane.style.background = '';
    });
    lane.addEventListener('drop', (e) => {
      e.preventDefault();
      lane.style.background = '';
      const clipName = e.dataTransfer.getData('text/plain');
      const laneEl = document.createElement('div');
      laneEl.className = 'track-clip';
      laneEl.textContent = clipName;
      laneEl.style.width = '30%';
      laneEl.style.left = '0';
      laneEl.setAttribute('draggable', 'true');
      lane.appendChild(laneEl);
      makeTimelineInteractive();
    });
  });
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• VERSION HISTORY â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-version-history')?.addEventListener('click', async () => {
  if (!currentProjectId) { alert('Vui lÃ²ng táº£i má»™t dá»± Ã¡n trÆ°á»›c.'); return; }
  const versions = await apiGet(`/projects/${currentProjectId}/versions`);
  const modal = document.getElementById('version-modal');
  const list = document.getElementById('version-list');
  if (!modal || !list) return;
  list.innerHTML = '';
  if (versions && versions.length > 0) {
    versions.forEach(v => {
      const row = document.createElement('div');
      row.className = 'result-row';
      row.innerHTML = `<span style="flex:1">v${v.version}</span><span style="flex:1">${new Date(v.saved_at * 1000).toLocaleString()}</span><span>${(v.size / 1024).toFixed(1)}KB</span>
        <button class="action-btn" style="height:18px;padding:1px 6px;font-size:9px" data-version="${v.file}">KhÃ´i phá»¥c</button>`;
      row.querySelector('.action-btn').addEventListener('click', async () => {
        await apiPost(`/projects/${currentProjectId}/restore?version_file=${encodeURIComponent(v.file)}`);
        alert(`ÄÃ£ khÃ´i phá»¥c vá» phiÃªn báº£n v${v.version}`);
        modal.classList.remove('show');
      });
      list.appendChild(row);
    });
  } else {
    list.innerHTML = '<div style="color:var(--text-dim);padding:8px;text-align:center">ChÆ°a cÃ³ phiÃªn báº£n nÃ o Ä‘Æ°á»£c lÆ°u. HÃ£y lÆ°u dá»± Ã¡n Ä‘á»ƒ táº¡o phiÃªn báº£n.</div>';
  }
  modal.classList.add('show');
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• LINK HANDLERS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('link-search-sample')?.addEventListener('click', (e) => {
  e.preventDefault();
  const preset = document.getElementById('sel-project-preset')?.value || 'Movie Review';
  apiGet('/presets/' + encodeURIComponent(preset)).then(data => {
    if (data) {
      alert(`Preset: ${data.name || preset}\nResolution: ${data.export?.resolution || 'N/A'}\nFPS: ${data.export?.fps || 'N/A'}\nCodec: ${data.export?.codec || 'N/A'}`);
    }
  });
});

document.getElementById('link-save-preset')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.getElementById('btn-save-preset')?.click();
});

document.getElementById('link-setup-voice')?.addEventListener('click', (e) => {
  e.preventDefault();
  document.querySelector('#processing-tabs .tab[data-target="tab-voice"]')?.click();
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• INFO BUTTONS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.querySelectorAll('.info-btn').forEach(btn => {
  if (btn.id === 'btn-info-srt') {
    btn.addEventListener('click', () => {
      alert('Select an SRT subtitle file and its corresponding video file.\nBoth files should be in the same directory.\nSupported: .srt, .ass');
    });
  } else if (btn.id === 'btn-help-execute') {
    btn.addEventListener('click', () => {
      alert('THá»°C HIá»†N sáº½ cháº¡y toÃ n bá»™ pipeline:\n1. Táº£i video (náº¿u cÃ³ URL)\n2. Chuyá»ƒn giá»ng nÃ³i (STT)\n3. Dá»‹ch subtitle\n4. Táº¡o giá»ng Ä‘á»c (TTS)\n5. Render video cuá»‘i cÃ¹ng');
    });
  } else if (!btn.id) {
    btn.addEventListener('click', () => {
      const parentLabel = btn.closest('.tab-row')?.querySelector('.field-label')?.textContent || '';
      alert(`ThÃªm thÃ´ng tin vá»: ${parentLabel || 'tÃ­nh nÄƒng nÃ y'}`);
    });
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• VOICE PLAY BUTTON â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-play-voice')?.addEventListener('click', async () => {
  const text = 'Xin chÃ o, Ä‘Ã¢y lÃ  giá»ng Ä‘á»c thá»­ nghiá»‡m';
  const provider = document.getElementById('sel-tts-provider')?.value === 'FPT.AI TTS' ? 'fpt' : (document.getElementById('sel-tts-provider')?.value?.toLowerCase().replace(' tts', '').replace(' (free)', '') || 'edge');
  const voice = document.getElementById('sel-voice-type')?.value || 'vi-VN-HoaiMyNeural';
  const fptKey = document.getElementById('inp-fpt-key')?.value || '';
  const audio = new Audio(`/api/voice/play?text=${encodeURIComponent(text)}&provider=${provider}&voice=${voice}&fpt_api_key=${encodeURIComponent(fptKey)}`);
  audio.play().catch(() => alert('Nghe thá»­ giá»ng nÃ³i: ' + text));
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• TRANSLATE SETTINGS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-translate-settings')?.addEventListener('click', () => {
  alert('Translation settings:\n- GPT: requires OPENAI_API_KEY\n- Gemini: requires GEMINI_API_KEY\n- NLLB-200: runs locally (requires transformers)\n- MarianMT: runs locally (lightweight)\nConfigure API keys in Settings modal.');
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ENHANCE BRANDING BUTTONS â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-branding-logo')?.addEventListener('click', async () => {
  const videoPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  if (!videoPath) { alert('ChÆ°a chá»n video'); return; }
  const logoPath = prompt('ÄÆ°á»ng dáº«n hÃ¬nh áº£nh logo:', '');
  if (!logoPath) return;
  await apiPost('/enhance/branding/logo', { video_path: videoPath, logo_path: logoPath, position: 'bottom_right', opacity: 0.7 });
  addTaskRow();
});

document.getElementById('btn-branding-text')?.addEventListener('click', async () => {
  const videoPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  if (!videoPath) { alert('ChÆ°a chá»n video'); return; }
  const text = prompt('VÄƒn báº£n chÃ¨n:', '0xForge');
  if (!text) return;
  await apiPost('/enhance/branding/text', { video_path: videoPath, text, position: 'bottom', font_size: 48 });
  addTaskRow();
});

document.getElementById('btn-branding-qr')?.addEventListener('click', async () => {
  const videoPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  if (!videoPath) { alert('ChÆ°a chá»n video'); return; }
  const content = prompt('Ná»™i dung QR (URL):', 'https://example.com');
  if (!content) return;
  await apiPost('/enhance/branding/qr', { video_path: videoPath, content, position: 'bottom_right', size: 120 });
  addTaskRow();
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• EXTRACT SUBTITLE FROM VIDEO â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-extract-srt')?.addEventListener('click', async () => {
  const videoPath = document.getElementById('inp-video-path')?.value;
  if (!videoPath) {
    alert('Vui lÃ²ng chá»n file video á»Ÿ má»¥c Path Video trÆ°á»›c!');
    return;
  }
  
  // Show loading indicator
  const modal = document.getElementById('extract-sub-modal');
  modal.classList.add('show');
  
  const streamsSection = document.getElementById('sub-streams-section');
  const streamsList = document.getElementById('sub-streams-list');
  streamsSection.style.display = 'none';
  streamsList.innerHTML = '<div style="color:#718096; text-align:center; padding:10px;">Äang quÃ©t phá»¥ Ä‘á» trong video...</div>';
  
  try {
    const res = await apiPost('/subtitle/detect-streams', { path: videoPath });
    if (res && res.streams && res.streams.length > 0) {
      streamsList.innerHTML = '';
      res.streams.forEach((stream, idx) => {
        const item = document.createElement('label');
        item.style.display = 'flex';
        item.style.alignItems = 'center';
        item.style.gap = '8px';
        item.style.cursor = 'pointer';
        item.style.padding = '4px 0';
        
        const radio = document.createElement('input');
        radio.type = 'radio';
        radio.name = 'srt-stream-choice';
        radio.value = stream.index;
        if (idx === 0) radio.checked = true;
        
        const labelText = document.createElement('span');
        labelText.textContent = `Track ${stream.index}: ${stream.title}`;
        
        item.appendChild(radio);
        item.appendChild(labelText);
        streamsList.appendChild(item);
      });
      streamsSection.style.display = 'block';
    } else {
      streamsList.innerHTML = '<div style="color:#e53e3e; text-align:center; padding:10px;">KhÃ´ng tÃ¬m tháº¥y phá»¥ Ä‘á» má»m nÃ o tÃ­ch há»£p sáºµn. HÃ£y sá»­ dá»¥ng Whisper STT á»Ÿ dÆ°á»›i.</div>';
    }
  } catch (err) {
    streamsList.innerHTML = '<div style="color:#e53e3e; text-align:center; padding:10px;">Lá»—i khi quÃ©t phá»¥ Ä‘á».</div>';
  }
});

document.getElementById('btn-extract-selected-stream')?.addEventListener('click', async () => {
  const videoPath = document.getElementById('inp-video-path')?.value;
  const selectedRadio = document.querySelector('input[name="srt-stream-choice"]:checked');
  if (!selectedRadio) {
    alert('Vui lÃ²ng chá»n má»™t track phá»¥ Ä‘á» Ä‘á»ƒ trÃ­ch xuáº¥t!');
    return;
  }
  
  const index = parseInt(selectedRadio.value);
  const extractBtn = document.getElementById('btn-extract-selected-stream');
  const originalText = extractBtn.textContent;
  extractBtn.textContent = 'Äang trÃ­ch xuáº¥t...';
  extractBtn.disabled = true;
  
  try {
    const res = await apiPost('/subtitle/extract-stream', {
      path: videoPath,
      index: index,
      project_id: currentProjectId || 1
    });
    if (res && res.path) {
      document.getElementById('inp-srt-path').value = res.path;
      document.getElementById('extract-sub-modal').classList.remove('show');
      alert('ÄÃ£ trÃ­ch xuáº¥t phá»¥ Ä‘á» thÃ nh cÃ´ng! Click OK Ä‘á»ƒ tá»± Ä‘á»™ng náº¡p phá»¥ Ä‘á».');
      // Auto trigger load
      document.getElementById('btn-load')?.click();
    } else {
      alert('KhÃ´ng thá»ƒ trÃ­ch xuáº¥t phá»¥ Ä‘á».');
    }
  } catch (err) {
    alert('CÃ³ lá»—i xáº£y ra: ' + (err.message || err));
  } finally {
    extractBtn.textContent = originalText;
    extractBtn.disabled = false;
  }
});

document.getElementById('btn-run-whisper-stt')?.addEventListener('click', async () => {
  const videoPath = document.getElementById('inp-video-path')?.value;
  if (!videoPath) {
    alert('Vui lÃ²ng chá»n video trÆ°á»›c!');
    return;
  }
  
    const language = document.getElementById('sel-stt-lang')?.value || 'vi';
    const vocalSep = document.getElementById('chk-vocal-sep')?.checked ?? true;
    const useWhisperX = document.getElementById('chk-modal-whisperx')?.checked ?? true;
    const runBtn = document.getElementById('btn-run-whisper-stt');
    const originalText = runBtn.textContent;
    runBtn.textContent = 'Äang kÃ­ch hoáº¡t Whisper...';
    runBtn.disabled = true;

    try {
      const res = await apiPost('/subtitle/transcribe-video', {
        path: videoPath,
        language: language,
        project_id: currentProjectId || 1,
        vocal_separation: vocalSep,
        whisperx: useWhisperX,
      });
    if (res) {
      document.getElementById('extract-sub-modal').classList.remove('show');
      alert('ÄÃ£ khá»Ÿi cháº¡y tiáº¿n trÃ¬nh Whisper STT cháº¡y ngáº§m thÃ nh cÃ´ng!\nBáº¡n cÃ³ thá»ƒ má»Ÿ Tab Phá»¥ Äá» / nháº¥n Xem Log Ä‘á»ƒ theo dÃµi tiáº¿n trÃ¬nh.');
      
      // Periodically check subtitles list to auto-load when done
      const checkInterval = setInterval(async () => {
        try {
          const subs = await apiGet(`/subtitle/${currentProjectId || 1}`);
          const whisperSub = subs.find(s => s.source === `whisper_${language}` || s.source === `whisper_${language}_aligned`);
          if (whisperSub) {
            clearInterval(checkInterval);
            alert('Nháº­n dáº¡ng giá»ng nÃ³i (Whisper STT) Ä‘Ã£ hoÃ n thÃ nh! Äang náº¡p láº¡i phá»¥ Ä‘á»...');
            // Put it into the input path and click load
            document.getElementById('inp-srt-path').value = `data/subtitles/project_${currentProjectId || 1}_stt.srt`;
            document.getElementById('btn-load')?.click();
          }
        } catch (e) {
          console.error(e);
        }
      }, 5000);
    }
  } catch (err) {
    alert('Lá»—i kÃ­ch hoáº¡t Whisper: ' + (err.message || err));
  } finally {
    runBtn.textContent = originalText;
    runBtn.disabled = false;
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• EDIT TAB - CROP/RESIZE CHECKBOXES â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('chk-edit-crop')?.addEventListener('change', function() {
  if (this.checked) {
    const x = prompt('Tá»a Ä‘á»™ X cáº¯t:', '0'); if (x === null) { this.checked = false; return; }
    const y = prompt('Tá»a Ä‘á»™ Y cáº¯t:', '0'); if (y === null) { this.checked = false; return; }
    const w = prompt('Chiá»u rá»™ng cáº¯t:', '1920'); if (w === null) { this.checked = false; return; }
    const h = prompt('Chiá»u cao cáº¯t:', '1080'); if (h === null) { this.checked = false; return; }
    apiPost('/edit/crop', {
      video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '',
      operations: [{ type: 'crop', x: parseInt(x), y: parseInt(y), w: parseInt(w), h: parseInt(h) }],
    }).then(() => addTaskRow());
  }
});

document.getElementById('chk-edit-scene-detect')?.addEventListener('change', function() {
  if (this.checked) {
    const videoPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
    if (videoPath) {
      apiPost('/edit/scene-detect', { project_id: currentProjectId || 1, video_path: videoPath, threshold: 27 });
      setTimeout(updateSceneList, 3000);
    }
  }
});

document.getElementById('chk-edit-resize')?.addEventListener('change', function() {
  if (this.checked) {
    const w = prompt('Chiá»u rá»™ng:', '1280'); if (w === null) { this.checked = false; return; }
    const h = prompt('Chiá»u cao:', '720'); if (h === null) { this.checked = false; return; }
    apiPost('/edit/resize', {
      video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '',
      operations: [{ type: 'resize', width: parseInt(w), height: parseInt(h) }],
    }).then(() => addTaskRow());
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• SCENE LIST DYNAMIC â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function updateSceneList() {
  if (!currentProjectId) return;
  const scenes = await apiGet(`/edit/scenes/${currentProjectId}`);
  const container = document.querySelector('.scene-list');
  if (!container) return;
  if (scenes && scenes.length > 0) {
    container.innerHTML = scenes.map(s => `
      <div class="scene-row" draggable="true">
        <span>Scene ${s.scene_index}</span>
        <strong>${formatTime(Math.floor(s.start_time))}-${formatTime(Math.floor(s.end_time))}</strong>
      </div>
    `).join('');
  } else {
    container.innerHTML = `
      <div class="scene-row" draggable="true"><span>Scene 1</span><strong>00:00-00:23</strong></div>
      <div class="scene-row" draggable="true"><span>Scene 2</span><strong>00:24-00:45</strong></div>
      <div class="scene-row" draggable="true"><span>Scene 3</span><strong>00:46-01:12</strong></div>
    `;
  }
}

// Override scene detect button to also refresh list
document.getElementById('btn-detect-scenes')?.addEventListener('click', async () => {
  setTimeout(updateSceneList, 2000);
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• ASSET TEMPLATES BUTTON â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.querySelector('.asset-item:last-child')?.addEventListener('click', () => {
  openTemplateModal();
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• CLOSE MODALS ON OVERLAY CLICK â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
});

/* â”€â”€â”€ Wire timeline after load â”€â”€â”€ */
const origLoadTimeline = loadTimeline;
loadTimeline = async function(projectId) {
  await origLoadTimeline(projectId);
  setTimeout(makeTimelineInteractive, 100);
};

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• TIMELINE EDITOR BUTTON â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
document.getElementById('btn-edit-timeline')?.addEventListener('click', () => {
  if (currentProjectId) {
    loadTimeline(currentProjectId);
    alert('DÃ²ng thá»i gian Ä‘Ã£ táº£i tá»« dá»¯ liá»‡u dá»± Ã¡n.');
  } else {
    alert('Vui lÃ²ng táº£i má»™t dá»± Ã¡n trÆ°á»›c.');
  }
});

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• GPU AUTO DETECT â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
async function detectGPU() {
  const info = await apiGet('/system/gpu');
  if (info) {
    const autoRadio = document.getElementById('radio-auto');
    const nvidiaRadio = document.getElementById('radio-nvidia');
    const amdRadio = document.getElementById('radio-amd');
    if (info.primary === 'nvidia' && nvidiaRadio) nvidiaRadio.checked = true;
    else if (info.primary === 'amd' && amdRadio) amdRadio.checked = true;
    else if (autoRadio) autoRadio.checked = true;
    const gpuInfo = document.querySelector('.warning-text');
    if (gpuInfo && info.details?.length) {
      const names = info.details.map(d => d.name || d.type).join(', ');
      gpuInfo.textContent = `Detected GPU: ${names} | Driver: ${info.details[0]?.driver || 'N/A'}`;
      gpuInfo.style.color = '#22c55e';
    }
  }
}
setTimeout(detectGPU, 500);

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• INTEGRATION LAYER (AUTO-WIRED) â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
function bindApiAction(btnId, endpoint, payloadFn, resultElId, resultKey) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Äang xá»­ lÃ½...';
    btn.disabled = true;
    try {
      const payload = payloadFn ? payloadFn() : {};
      const res = await apiPost(endpoint, payload);
      const resEl = document.getElementById(resultElId);
      if (resEl && res) {
        let content = res[resultKey] || JSON.stringify(res, null, 2);
        if (Array.isArray(content)) content = content.map(item => typeof item === 'object' ? JSON.stringify(item) : item).join('\n');
        else if (typeof content === 'object') content = JSON.stringify(content, null, 2);
        resEl.textContent = content;
        resEl.classList.remove('placeholder-text');
      }
    } catch (e) {
      console.error(e);
      if (document.getElementById(resultElId)) {
        document.getElementById(resultElId).textContent = 'Error: ' + e.message;
      }
    } finally {
      btn.innerHTML = originalText;
      btn.disabled = false;
    }
  });
}

// â”€â”€ AI Tab â”€â”€
bindApiAction('btn-ai-summary', '/ai/summary', () => ({
  text: document.getElementById('inp-ai-summary')?.value || 'Demo text',
  max_length: 150,
  engine: document.getElementById('sel-ai-summary-model')?.value || 'BART'
}), 'ai-summary-result', 'summary');

bindApiAction('btn-ai-recap', '/ai/recap', () => ({
  project_id: currentProjectId || 1,
  video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || ''
}), 'ai-recap-result', 'recap');

bindApiAction('btn-ai-characters', '/ai/characters', () => ({
  project_id: currentProjectId || 1,
  video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || 'demo.mp4'
}), 'ai-characters-result', 'characters');

bindApiAction('btn-ai-speakers', '/ai/speakers', () => ({
  project_id: currentProjectId || 1,
  video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || 'demo.mp4'
}), 'ai-speakers-result', 'speakers');

// â”€â”€ Subtitle Tab â”€â”€
['btn-sub-trans-gpt', 'btn-sub-trans-gemini', 'btn-sub-trans-nllb', 'btn-sub-trans-marian'].forEach(id => {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener('click', () => {
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Äang xá»­ lÃ½...';
      setTimeout(() => {
          btn.innerHTML = originalText;
          alert('ÄÃ£ Ä‘Æ°a tiáº¿n trÃ¬nh dá»‹ch thuáº­t ' + id.replace('btn-sub-trans-', '').toUpperCase() + ' vÃ o hÃ ng Ä‘á»£i!');
      }, 1000);
    });
  }
});

// â”€â”€ Export Tab â”€â”€
const btnQueue = document.getElementById('btn-export-queue');
if (btnQueue) {
  btnQueue.addEventListener('click', () => {
    addTaskRow();
  });
}

/* â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• INIT QUEUE TABLE â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
   Render rows vÃ o báº£ng káº¿t quáº£ tá»« queue jobs.
   Æ¯u tiÃªn: API /queue â†’ fallback: .queue-job trong HTML
â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â• */
const STATUS_COLOR = {
  running:   '#a78bfa',
  completed: '#22c55e',
  done:      '#22c55e',
  failed:    '#ef4444',
  error:     '#ef4444',
  paused:    '#f59e0b',
  waiting:   '#94a3b8',
  pending:   '#94a3b8',
};

function statusBadge(status) {
  const color = STATUS_COLOR[status] || '#94a3b8';
  const label = status ? status.toUpperCase() : '-';
  return `<span style="color:${color};font-size:9px;font-weight:600">${label}</span>`;
}

function updateQueueListUI(jobs) {
  const queueList = document.querySelector('.queue-list');
  if (!queueList) return;
  if (!jobs || jobs.length === 0) {
    queueList.innerHTML = '<div style="color:#718096; padding:4px 8px; font-size:11px; font-style:italic">Hang doi trong</div>';
    return;
  }
  queueList.innerHTML = jobs.map(item => {
    const statusIcon = item.status === 'running' ? 'RUN' : item.status === 'paused' ? 'PAUSE' : item.status === 'completed' ? 'OK' : item.status === 'failed' ? 'ERR' : 'WAIT';
    const activeClass = item.status === 'running' ? 'active' : '';
    const name = item.input_path ? item.input_path.split(/[\\/]/).pop() : `${item.type.toUpperCase()} #${item.id || 'N/A'}`;
    return `
      <div class="queue-job ${activeClass}" data-id="${item.id || ''}" data-status="${item.status || 'pending'}" style="cursor:pointer" onclick="showJobLogs(${item.id || 'null'})">
        <span class="queue-status-icon ${item.status || 'pending'}">${statusIcon}</span>
        <span class="queue-name" title="${name}">${name}</span>
      </div>
    `;
  }).join('');
}

window.showJobLogs = function(jobId) {
  const filterInput = document.getElementById('inp-log-filter');
  if (filterInput) {
    filterInput.value = jobId !== null ? jobId : '';
  }
  const logModal = document.getElementById('log-modal');
  if (logModal) {
    logModal.classList.add('show');
  }
  if (typeof fetchLogs === 'function') {
    fetchLogs();
  }
};

function renderQueueRows(jobs) {
  const body = document.getElementById('result-table-body');
  if (!body) return;
  body.innerHTML = '';
  rowCount = 0;

  updateQueueListUI(jobs);

  if (!jobs || jobs.length === 0) {
    body.innerHTML = '<div style="padding:10px 12px;color:var(--text-muted);font-size:11px">Chua co task nao trong hang doi</div>';
    return;
  }

  jobs.forEach((job, idx) => {
    rowCount++;
    const pct = job.progress || 0;
    const inputName  = job.input_path  ? job.input_path.split(/[\\/]/).pop()  : (job.name || `video_${rowCount}.mp4`);
    const outputName = job.output_path ? job.output_path.split(/[\\/]/).pop() : `output_${rowCount}.mp4`;
    const elapsed    = job.elapsed     ? formatTime(job.elapsed)              : '--:--';
    const subGoc     = job.sub_source  || '-';
    const subDich    = job.sub_translated || '-';
    const status     = job.status || 'pending';

    const row = document.createElement('div');
    row.className = 'result-row';
    row.id = `task-row-${rowCount}`;
    row.dataset.jobId = job.id || '';
    row.dataset.status = status;
    row.innerHTML = `
      <div class="result-cell" style="width:110px;color:#a78bfa;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${inputName}">${inputName}</div>
      <div class="result-cell" style="width:130px;color:#94a3b8;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${outputName}">${outputName}</div>
      <div class="result-cell" style="width:100px">
        <div class="mini-progress"><div class="mini-progress-fill" id="mini-fill-${rowCount}" style="width:${pct}%"></div></div>
        <span style="font-size:9px;color:var(--text-muted);margin-left:4px">${pct}%</span>
      </div>
      <div class="result-cell" style="width:50px">${statusBadge(status)}</div>
      <div class="result-cell" style="width:100px;color:#facc15">${elapsed}</div>
      <div class="result-cell flex1" style="color:#8892a4;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${subGoc}</div>
      <div class="result-cell flex1" style="color:#8892a4;font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${subDich}</div>
    `;
    body.appendChild(row);
  });
}

async function initQueueTable() {
  const apiJobs = await apiGet('/queue');
  if (apiJobs && Array.isArray(apiJobs) && apiJobs.length > 0) {
    renderQueueRows(apiJobs);
    return;
  }
  renderQueueRows([]);
}

document.addEventListener('DOMContentLoaded', () => {
  initQueueTable();
  onQueueChange(sseQueueRefresh);
});

if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initQueueTable();
  onQueueChange(sseQueueRefresh);
}

function sseQueueRefresh(jobs) {
  if (!jobs || jobs.length === 0) return;
  const body = document.getElementById('result-table-body');
  if (!body) return;
  const currentRows = body.querySelectorAll('.result-row').length;
  const hasStatusChange = jobs.some(j => {
    const row = document.querySelector(`[data-job-id="${j.id}"]`);
    return row && row.dataset.status !== j.status;
  });
  if (jobs.length !== currentRows || hasStatusChange) {
    renderQueueRows(jobs);
  } else {
    jobs.forEach(j => {
      const row = document.querySelector(`[data-job-id="${j.id}"]`);
      if (row) {
        const fillId = row.id?.replace('task-row-', 'mini-fill-');
        const fill = document.getElementById(fillId);
        const pct = Math.round(j.progress || 0);
        if (fill) fill.style.width = pct + '%';
        const pctText = row.querySelector('.result-cell span');
        if (pctText) pctText.textContent = pct + '%';
      }
    });
  }
}

let allEdgeVoices = [];

async function loadEdgeVoices() {
  try {
    const res = await fetch('/api/voice/edge-voices');
    if (res.ok) {
      allEdgeVoices = await res.json();
      updateVoiceDropdown();
    }
  } catch (err) {
    console.error('Failed to load Edge voices:', err);
  }
}

function updateVoiceDropdown() {
  const providerSel = document.getElementById('sel-tts-provider');
  const langSel = document.getElementById('sel-voice-lang');
  const typeSel = document.getElementById('sel-voice-type');
  if (!langSel || !typeSel) return;

  const provider = providerSel?.value;
  if (provider === 'FPT.AI TTS') {
    const fptVoices = [
      { value: 'banmai', text: 'Ban Mai (Ná»¯ miá»n Báº¯c)' },
      { value: 'lannhi', text: 'Lan Nhi (Ná»¯ miá»n Nam)' },
      { value: 'leminh', text: 'LÃª Minh (Nam miá»n Báº¯c)' },
      { value: 'myan', text: 'Má»¹ An (Ná»¯ miá»n Trung)' },
      { value: 'thuminh', text: 'Thu Minh (Ná»¯ miá»n Báº¯c)' },
      { value: 'giahuy', text: 'Gia Huy (Nam miá»n Trung)' },
      { value: 'linhsan', text: 'Linh San (Ná»¯ miá»n Nam)' }
    ];
    typeSel.innerHTML = '';
    fptVoices.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.value;
      opt.textContent = v.text;
      typeSel.appendChild(opt);
    });
    return;
  }

  if (!allEdgeVoices.length) return;
  const selectedLang = langSel.value;
  const currentVal = typeSel.value;
  typeSel.innerHTML = '';

  let filtered = allEdgeVoices;
  if (selectedLang === 'Tiáº¿ng Viá»‡t') {
    filtered = allEdgeVoices.filter(v => v.locale.startsWith('vi'));
  } else if (selectedLang === 'Tiáº¿ng Anh') {
    filtered = allEdgeVoices.filter(v => v.locale.startsWith('en'));
  }

  filtered.forEach(v => {
    const opt = document.createElement('option');
    opt.value = v.short_name;
    const cleanName = v.friendly_name.replace('Microsoft ', '').replace(' Online (Natural)', '').replace(' - Vietnamese (Vietnam)', '').replace(' - English (United States)', '');
    opt.textContent = `${cleanName} (${v.gender})`;
    typeSel.appendChild(opt);
  });

  if (currentVal && Array.from(typeSel.options).some(o => o.value === currentVal)) {
    typeSel.value = currentVal;
  }
}

document.getElementById('sel-tts-provider')?.addEventListener('change', (e) => {
  const provider = e.target.value;
  const fptRow = document.getElementById('row-fpt-key');
  if (fptRow) {
    fptRow.style.display = (provider === 'FPT.AI TTS') ? 'flex' : 'none';
  }
  updateVoiceDropdown();
});

document.getElementById('sel-voice-lang')?.addEventListener('change', updateVoiceDropdown);
document.addEventListener('DOMContentLoaded', loadEdgeVoices);
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  loadEdgeVoices();
}

/* Stable sidebar override: action ids avoid mojibake-sensitive text matching. */
const cleanSidebarTree = {
  home: {
    title: 'Trang ch\u1ee7',
    tree: [
      { icon: 'ri-dashboard-2-line', label: 'B\u1ea3ng \u0111i\u1ec1u khi\u1ec3n', action: 'home' },
      { icon: 'ri-history-line', label: 'D\u1ef1 \u00e1n g\u1ea7n \u0111\u00e2y', action: 'project' },
      { icon: 'ri-bar-chart-2-line', label: 'Th\u1ed1ng k\u00ea', action: 'queue' },
    ],
  },
  project: {
    title: 'D\u1ef1 \u00e1n',
    tree: [
      { icon: 'ri-add-box-line', label: 'T\u1ea1o m\u1edbi', action: 'project_create' },
      { icon: 'ri-folder-open-line', label: 'M\u1edf', action: 'project_open' },
      { icon: 'ri-save-3-line', label: 'L\u01b0u', action: 'project_save' },
      { icon: 'ri-history-line', label: 'L\u1ecbch s\u1eed phi\u00ean b\u1ea3n', action: 'version_history' },
      { icon: 'ri-layout-grid-line', label: 'Template', action: 'template' },
    ],
  },
  subtitle: {
    title: 'Ph\u1ee5 \u0111\u1ec1',
    tree: [
      { label: 'Nh\u1eadp ph\u1ee5 \u0111\u1ec1', icon: 'ri-upload-cloud-2-line', children: [
        { label: 'SRT', action: 'tab_subtitle' },
        { label: 'ASS', action: 'tab_subtitle' },
        { label: 'Nh\u1eadn di\u1ec7n g\u1ed1c', action: 'tab_subtitle_transcribe' },
        { label: 'RapidOCR sub c\u1ee9ng', action: 'tab_subtitle_ocr' },
      ]},
      { label: '\u0110\u1ecbnh d\u1ea1ng', icon: 'ri-font-size', children: [
        { label: 'V\u00f9ng ph\u1ee5 \u0111\u1ec1', action: 'subtitle_box' },
        { label: 'L\u00e0m m\u1edd sub g\u1ed1c', action: 'subtitle_blur' },
      ]},
      { label: 'Xu\u1ea5t ph\u1ee5 \u0111\u1ec1', icon: 'ri-download-2-line', children: [
        { label: 'G\u1eafn c\u1ee9ng', action: 'tab_subtitle_burn' },
        { label: 'SRT', action: 'tab_subtitle_srt' },
        { label: 'ASS', action: 'tab_subtitle_ass' },
      ]},
    ],
  },
  voice: {
    title: 'Gi\u1ecdng \u0111\u1ecdc',
    tree: [
      { label: 'TTS', icon: 'ri-mic-2-line', action: 'tab_voice' },
      { label: 'Hu\u1ea5n luy\u1ec7n gi\u1ecdng', icon: 'ri-user-voice-line', action: 'voice_train' },
      { label: 'B\u1ea3n \u0111\u1ed3 ng\u01b0\u1eddi n\u00f3i', icon: 'ri-team-line', action: 'voice_speakers' },
    ],
  },
  export: {
    title: 'Xu\u1ea5t b\u1ea3n',
    tree: [
      { icon: 'ri-movie-2-line', label: 'Xu\u1ea5t video', action: 'tab_export' },
      { icon: 'ri-list-check-3', label: 'Th\u00eam v\u00e0o h\u00e0ng ch\u1edd', action: 'export_queue' },
      { icon: 'ri-upload-cloud-2-line', label: '\u0110\u0103ng t\u1ea3i', action: 'tab_export' },
    ],
  },
  queue: {
    title: 'H\u00e0ng ch\u1edd',
    tree: [
      { icon: 'ri-list-check-3', label: 'Xem h\u00e0ng ch\u1edd', action: 'queue' },
      { icon: 'ri-refresh-line', label: 'Th\u1eed l\u1ea1i task l\u1ed7i', action: 'queue_retry' },
      { icon: 'ri-pause-line', label: 'T\u1ea1m d\u1eebng t\u1ea5t c\u1ea3', action: 'queue_pause' },
      { icon: 'ri-play-line', label: 'Ti\u1ebfp t\u1ee5c t\u1ea5t c\u1ea3', action: 'queue_resume' },
    ],
  },
  download: {
    title: 'T\u1ea3i v\u1ec1',
    tree: [
      { icon: 'ri-download-cloud-2-line', label: 'T\u1ea3i video', action: 'download' },
      { icon: 'ri-folder-open-line', label: 'Ch\u1ecdn th\u01b0 m\u1ee5c l\u01b0u', action: 'download_folder' },
      { icon: 'ri-history-line', label: 'L\u1ecbch s\u1eed download', action: 'download_history' },
      { icon: 'ri-cookie-line', label: 'Cookie', action: 'settings' },
      { icon: 'ri-global-line', label: 'Proxy', action: 'settings' },
    ],
  },
  ai: {
    title: 'Tr\u1ee3 l\u00fd AI',
    tree: [
      { icon: 'ri-scissors-cut-line', label: 'T\u00e1ch ph\u00e2n c\u1ea3nh', action: 'tab_ai' },
      { icon: 'ri-file-text-line', label: 'T\u00f3m t\u1eaft', action: 'tab_ai' },
      { icon: 'ri-voiceprint-line', label: 'Nh\u1eadn di\u1ec7n ng\u01b0\u1eddi n\u00f3i', action: 'tab_ai' },
    ],
  },
  settings: {
    title: 'C\u00e0i \u0111\u1eb7t',
    tree: [
      { icon: 'ri-settings-4-line', label: 'C\u00e0i \u0111\u1eb7t chung', action: 'settings' },
      { icon: 'ri-key-2-line', label: 'API Keys', action: 'settings' },
      { icon: 'ri-terminal-box-line', label: 'FFmpeg', action: 'settings' },
      { icon: 'ri-global-line', label: 'Proxy', action: 'settings' },
    ],
  },
};

Object.keys(sidebarTree).forEach(key => delete sidebarTree[key]);
Object.assign(sidebarTree, cleanSidebarTree);

renderTreeItems = function(items, depth = 0) {
  let html = '';
  const pad = depth * 14;
  for (const item of items) {
    if (item.children) {
      const branchId = 'fb-' + Math.random().toString(36).slice(2, 8);
      html += `
        <div class="f-branch" data-branch="${branchId}" style="padding-left:${pad}px">
          <span class="f-branch-toggle"><i class="ri-arrow-down-s-line"></i></span>
          ${item.icon ? `<i class="${item.icon} f-branch-icon"></i>` : ''}
          <span class="f-branch-label">${item.label}</span>
        </div>
        <div class="f-children" id="${branchId}">
          ${renderTreeItems(item.children, depth + 1)}
        </div>
      `;
    } else {
      html += `
        <a href="#" class="f-item" data-action="${item.action || ''}" style="padding-left:${pad + 20}px">
          ${item.icon ? `<i class="${item.icon}"></i>` : ''}
          <span>${item.label}</span>
        </a>
      `;
    }
  }
  return html;
};

function runSidebarAction(action) {
  const switchProcessingTab = (tabId) => {
    const tabBtn = document.querySelector(`#processing-tabs .tab[data-target="${tabId}"]`);
    if (tabBtn) {
      if (window._switchTab) window._switchTab(tabBtn);
      else tabBtn.click();
      document.getElementById('processing-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };
  if (action === 'settings') document.getElementById('settings-modal')?.classList.add('show');
  else if (action === 'download') { document.getElementById('download-modal')?.classList.add('show'); loadDownloadHistory(); }
  else if (action === 'download_folder') document.getElementById('btn-browse-download-output')?.click();
  else if (action === 'download_history') { document.getElementById('download-modal')?.classList.add('show'); loadDownloadHistory(); }
  else if (action === 'queue') document.getElementById('task-queue-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (action === 'queue_retry') document.getElementById('btn-retry-failed')?.click();
  else if (action === 'queue_pause') document.getElementById('btn-pause-queue')?.click();
  else if (action === 'queue_resume') document.getElementById('btn-resume-queue')?.click();
  else if (action === 'project_create') createProjectFromSidebar();
  else if (action === 'project_save') currentProjectId ? apiPost(`/projects/${currentProjectId}/save`).then(r => showToast(r?.message || 'Da luu du an', 'success')) : showToast('Chua co du an dang mo', 'warn');
  else if (action === 'project_open' || action === 'project') document.getElementById('work-mode-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (action === 'home') document.getElementById('top-panels-row')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  else if (action === 'template') openTemplateModal();
  else if (action === 'version_history') document.getElementById('version-modal')?.classList.add('show');
  else if (action === 'tab_subtitle' || action === 'tab_subtitle_transcribe' || action === 'tab_subtitle_ocr' || action === 'tab_subtitle_burn' || action === 'tab_subtitle_srt' || action === 'tab_subtitle_ass') switchProcessingTab('tab-subtitle');
  else if (action === 'subtitle_box') { switchProcessingTab('tab-subtitle'); subBoxShow(); }
  else if (action === 'subtitle_blur') { switchProcessingTab('tab-subtitle'); document.getElementById('btn-preview-sub-blur')?.click(); }
  else if (action === 'tab_voice') switchProcessingTab('tab-voice');
  else if (action === 'voice_train') { switchProcessingTab('tab-voice'); document.getElementById('btn-voice-train')?.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  else if (action === 'voice_speakers') { switchProcessingTab('tab-voice'); document.getElementById('btn-voice-speakers')?.click(); }
  else if (action === 'tab_export') switchProcessingTab('tab-export');
  else if (action === 'export_queue') { switchProcessingTab('tab-export'); document.getElementById('btn-export-queue')?.click(); }
  else if (action === 'tab_ai') switchProcessingTab('tab-ai');
}

function createProjectFromSidebar() {
  const name = prompt('Ten du an:', 'project_' + Date.now());
  if (!name) return;
  apiPost('/projects', { name, preset: document.getElementById('sel-project-preset')?.value || 'Movie Review' }).then(p => {
    if (p) {
      currentProjectId = p.id;
      showToast('Da tao du an: ' + name, 'success');
    }
  });
}

sidebarFlyout?.addEventListener('click', (e) => {
  const leaf = e.target.closest('.f-item[data-action]');
  if (!leaf) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  const action = leaf.dataset.action;
  if (action) runSidebarAction(action);
  hideSidebarFlyout();
}, true);

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    const navTab = item.dataset.tab;
    if (navTab === 'download') runSidebarAction('download');
    else if (navTab === 'settings') runSidebarAction('settings');
    else if (navTab === 'queue') runSidebarAction('queue');
    else if (navTab === 'project') runSidebarAction('project');
    else if (navTab === 'home') runSidebarAction('home');
    else if (navTab === 'subtitle') runSidebarAction('tab_subtitle');
    else if (navTab === 'voice') runSidebarAction('tab_voice');
    else if (navTab === 'export') runSidebarAction('tab_export');
    else if (navTab === 'ai') runSidebarAction('tab_ai');
  }, true);
});

const TRANSLATION_ENGINES = {
  gpt: { name: 'GPT', supportsLanguages: ['en', 'vi', 'zh', 'es', 'fr', 'de', 'ja', 'ko'] },
  gemini: { name: 'Gemini', supportsLanguages: ['en', 'vi', 'zh', 'es', 'fr', 'de', 'ja', 'ko'] },
  nllb: { name: 'NLLB-200', supportsLanguages: ['en', 'vi', 'zh', 'es', 'fr', 'de', 'ja', 'ko', 'ar', 'pt', 'ru'] },
  marian: { name: 'MarianMT', supportsLanguages: ['en', 'vi', 'zh'] },
};

function getSelectedLanguageCode(selectId, fallback) {
  const select = document.getElementById(selectId);
  if (!select) return fallback;
  const value = (select.value || select.options[select.selectedIndex]?.text || '').toLowerCase();
  if (value.includes('english') || value.includes('anh') || value === 'en') return 'en';
  if (value.includes('china') || value.includes('trung') || value === 'zh') return 'zh';
  if (value.includes('japan') || value.includes('nhat') || value === 'ja') return 'ja';
  if (value.includes('korea') || value.includes('han') || value === 'ko') return 'ko';
  if (value.includes('vietnam') || value.includes('viet') || value === 'vi') return 'vi';
  if (selectId === 'sel-lang-from') {
    return ['en', 'zh', 'ja', 'ko'][select.selectedIndex] || fallback;
  }
  return ['vi', 'en'][select.selectedIndex] || fallback;
}

async function waitTranslationJob(jobId, btn, outputName) {
  return new Promise(resolve => {
    const poll = setInterval(async () => {
      const prog = await apiGet(`/subtitle/translate-progress/${jobId}`);
      if (!prog) return;
      const pct = Math.max(0, Math.min(100, Number(prog.progress || 0)));
      btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> ${pct}%`;
      if (prog.status === 'done') {
        clearInterval(poll);
        resolve(prog.translated || prog.translated_text || '');
      } else if (prog.status === 'error') {
        clearInterval(poll);
        showToast(prog.error || 'Dich subtitle that bai', 'error');
        resolve('');
      }
    }, 600);
  });
}

async function handleSubtitleTranslation(engine) {
  const config = TRANSLATION_ENGINES[engine];
  if (!config) throw new Error(`Unknown translation engine: ${engine}`);

  const btn = document.getElementById(`btn-sub-trans-${engine}`);
  if (!btn) return;
  const originalHTML = btn.innerHTML;

  try {
    const text = await getSubtitleText();
    if (!text || !text.trim()) {
      showToast('Chua tai phu de.', 'warn');
      return;
    }

    const sourceLang = getSelectedLanguageCode('sel-lang-from', 'en');
    const targetLang = getSelectedLanguageCode('sel-lang-to', 'vi');
    validate(sourceLang, 'language');
    validate(targetLang, 'language');

    if (!config.supportsLanguages.includes(sourceLang) || !config.supportsLanguages.includes(targetLang)) {
      showToast(`${config.name} khong ho tro cap ngon ngu nay`, 'warn');
      return;
    }

    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Dang dich...';
    const response = await apiPost('/subtitle/translate', {
      text,
      engine,
      source_lang: sourceLang,
      target_lang: targetLang,
      project_id: currentProjectId || null,
    });
    if (!response) return;

    let translated = response.translated_text || response.translated || '';
    if (response.job_id) {
      translated = await waitTranslationJob(response.job_id, btn, `translated_${engine}.srt`);
    }

    if (translated) {
      showTransResult(translated, `translated_${engine}.srt`);
    }
    addTaskRow();
    showToast(`Da gui lenh dich ${config.name}`, 'success');
  } catch (error) {
    showToast(error.message || String(error), error instanceof ValidationError ? 'warn' : 'error');
    addClientLog('error', `Translation ${engine} failed`, error.stack || error.message || String(error));
  } finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
  }
}

Object.keys(TRANSLATION_ENGINES).forEach(engine => {
  const btn = document.getElementById(`btn-sub-trans-${engine}`);
  btn?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
    handleSubtitleTranslation(engine);
  }, true);
});

document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopImmediatePropagation();
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    hideSidebarFlyout();
    const navTab = item.dataset.tab;
    if (navTab === 'download') {
      document.getElementById('download-modal')?.classList.add('show');
      loadDownloadHistory();
      return;
    }
    if (navTab === 'settings') {
      document.getElementById('settings-modal')?.classList.add('show');
      return;
    }
    if (navTab === 'queue') {
      document.getElementById('task-queue-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    if (navTab === 'project' || navTab === 'home') {
      document.getElementById(navTab === 'project' ? 'work-mode-panel' : 'top-panels-row')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const targetTabId = navToTabMap[navTab];
    if (targetTabId) {
      const tabBtn = document.querySelector(`#processing-tabs .tab[data-target="${targetTabId}"]`);
      if (tabBtn) {
        if (window._switchTab) window._switchTab(tabBtn);
        else tabBtn.click();
        document.getElementById('processing-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    }
  }, true);
});
