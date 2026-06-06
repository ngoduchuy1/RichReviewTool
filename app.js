/* ─── app.js – RichReviewTool V2.0.0 ─── */

/* ─── API Layer ─── */
const API_BASE = window.location.origin + '/api';

/* ─── Client-side error log ─── */
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
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return await res.json();
  } catch (e) {
    const msg = `API ${method} ${path} failed: ${e.message}`;
    console.warn(msg);
    addClientLog('error', msg, e.stack);
    return null;
  }
}

function apiGet(path) { return api('GET', path); }
function apiPost(path, body) { return api('POST', path, body); }
function apiPut(path, body) { return api('PUT', path, body); }
function apiDel(path) { return api('DELETE', path); }

/* ─── Health check & Stats ─── */
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
    }
  }
}

/* Tab switching – Processing Panel */
document.querySelectorAll('#processing-tabs .tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('#processing-tabs .tab').forEach(t => t.classList.remove('active'));
    document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
    btn.classList.add('active');
    const target = btn.dataset.target;
    const el = document.getElementById(target);
    if (el) el.classList.add('active');
  });
});



/* Sidebar feature flyout - Full Tree */
const sidebarTree = {
  home: {
    title: 'Home',
    tree: [
      { icon: 'ri-dashboard-2-line', label: 'Dashboard' },
      { icon: 'ri-history-line', label: 'Recent Projects' },
      { icon: 'ri-bar-chart-2-line', label: 'Statistics' },
      { label: 'Assets', icon: 'ri-archive-stack-line', children: [
        { label: 'Videos', children: [
          { label: 'Raw' },
          { label: 'Edited' },
          { label: 'Exported' }
        ]},
        { label: 'Audio', children: [
          { label: 'Music' },
          { label: 'Voice' },
          { label: 'Effects' }
        ]},
        { label: 'Subtitle', children: [
          { label: 'Source' },
          { label: 'Translate' }
        ]},
        { label: 'Branding', children: [
          { label: 'Logos' },
          { label: 'Watermarks' },
          { label: 'QR' }
        ]},
        { label: 'Templates' }
      ]}
    ]
  },
  project: {
    title: 'Project',
    tree: [
      { icon: 'ri-add-box-line', label: 'Create' },
      { icon: 'ri-folder-open-line', label: 'Open' },
      { icon: 'ri-save-3-line', label: 'Save' },
      { icon: 'ri-history-line', label: 'Version History' },
      { icon: 'ri-cloud-line', label: 'Auto Backup' },
      { icon: 'ri-layout-grid-line', label: 'Templates' },
      { icon: 'ri-stack-line', label: 'Batch Project' }
    ]
  },
  download: {
    title: 'Download',
    tree: [
      { icon: 'ri-youtube-line', label: 'YouTube' },
      { icon: 'ri-tiktok-line', label: 'TikTok' },
      { icon: 'ri-video-line', label: 'Douyin' },
      { icon: 'ri-facebook-line', label: 'Facebook' },
      { icon: 'ri-instagram-line', label: 'Instagram' },
      { icon: 'ri-play-list-line', label: 'Playlist' },
      { icon: 'ri-cookie-line', label: 'Cookie Manager' },
      { icon: 'ri-global-line', label: 'Proxy Manager' },
      { icon: 'ri-link-m', label: 'Batch URL' }
    ]
  },
  subtitle: {
    title: 'Subtitle',
    tree: [
      { label: 'Import', icon: 'ri-upload-cloud-2-line', children: [
        { label: 'SRT' },
        { label: 'ASS' },
        { label: 'Merge' }
      ]},
      { label: 'Translate', icon: 'ri-translate-2', children: [
        { label: 'GPT' },
        { label: 'Gemini' },
        { label: 'Batch' }
      ]},
      { label: 'Style', icon: 'ri-font-size', children: [
        { label: 'Font' },
        { label: 'Color' },
        { label: 'Shadow' }
      ]},
      { label: 'Export', icon: 'ri-download-2-line', children: [
        { label: 'Burn' },
        { label: 'SRT' },
        { label: 'ASS' }
      ]}
    ]
  },
  voice: {
    title: 'Voice',
    tree: [
      { label: 'TTS', icon: 'ri-mic-2-line', children: [
        { label: 'Google' },
        { label: 'Azure' },
        { label: 'ElevenLabs' },
        { label: 'EdgeTTS' }
      ]},
      { label: 'Voice Clone', icon: 'ri-user-voice-line', children: [
        { label: 'Upload Sample' },
        { label: 'Train Voice' },
        { label: 'Export Voice' }
      ]},
      { label: 'Multi Speaker', icon: 'ri-team-line', children: [
        { label: 'Speaker Mapping' },
        { label: 'Auto Detect' }
      ]},
      { label: 'Voice Library', icon: 'ri-voiceprint-line' }
    ]
  },
  ai: {
    title: 'AI',
    tree: [
      { icon: 'ri-scissors-cut-line', label: 'Scene Detection' },
      { icon: 'ri-file-text-line', label: 'Auto Summary' },
      { icon: 'ri-film-line', label: 'Auto Recap' },
      { icon: 'ri-user-smile-line', label: 'Character Detection' },
      { icon: 'ri-voiceprint-line', label: 'Speaker Detection' },
      { icon: 'ri-image-line', label: 'Thumbnail Generator' },
      { icon: 'ri-font-size', label: 'Title Generator' },
      { icon: 'ri-hashtag-line', label: 'Hashtag Generator' },
      { icon: 'ri-bubble-chart-line', label: 'Prompt Library' }
    ]
  },
  export: {
    title: 'Export',
    tree: [
      { icon: 'ri-movie-2-line', label: 'Render' },
      { icon: 'ri-list-check-3', label: 'Queue' },
      { icon: 'ri-equalizer-line', label: 'Presets' },
      { icon: 'ri-upload-cloud-2-line', label: 'Upload' },
      { label: 'Video', icon: 'ri-video-line', children: [
        { label: 'MP4' },
        { label: 'MKV' },
        { label: 'MOV' }
      ]},
      { label: 'Codec', icon: 'ri-cpu-line', children: [
        { label: 'H264' },
        { label: 'H265' },
        { label: 'AV1' }
      ]},
      { label: 'GPU', icon: 'ri-server-line', children: [
        { label: 'NVENC' },
        { label: 'AMD' },
        { label: 'CPU' }
      ]},
      { label: 'Publish', icon: 'ri-share-line', children: [
        { label: 'YouTube' },
        { label: 'TikTok' },
        { label: 'Facebook' }
      ]}
    ]
  },
  queue: {
    title: 'Queue',
    tree: [
      { icon: 'ri-play-circle-line', label: 'Running' },
      { icon: 'ri-time-line', label: 'Waiting' },
      { icon: 'ri-checkbox-circle-line', label: 'Completed' },
      { icon: 'ri-close-circle-line', label: 'Failed' },
      { icon: 'ri-refresh-line', label: 'Retry Failed' },
      { icon: 'ri-pause-line', label: 'Pause All' },
      { icon: 'ri-play-line', label: 'Resume All' },
      { icon: 'ri-arrow-up-line', label: 'Priority' }
    ]
  },
  settings: {
    title: 'Settings',
    tree: [
      { icon: 'ri-settings-4-line', label: 'General' },
      { icon: 'ri-key-2-line', label: 'API Keys' },
      { icon: 'ri-sparkling-line', label: 'AI Model' },
      { icon: 'ri-cpu-line', label: 'GPU' },
      { icon: 'ri-terminal-box-line', label: 'FFmpeg' },
      { icon: 'ri-global-line', label: 'Proxy' },
      { icon: 'ri-refresh-line', label: 'Updates' },
      { icon: 'ri-information-line', label: 'About' }
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

/* ─── Load button (API) ─── */
let currentProjectId = null;

document.getElementById('btn-browse-video')?.addEventListener('click', async () => {
  const res = await apiGet('/system/browse?type=file&ext=video');
  if (res && res.path) {
    document.getElementById('inp-video-path').value = res.path;
    loadVideoPreview();
  }
});

document.getElementById('btn-browse-srt')?.addEventListener('click', async () => {
  const res = await apiGet('/system/browse?type=file&ext=srt');
  if (res && res.path) {
    document.getElementById('inp-srt-path').value = res.path;
  }
});

document.getElementById('btn-browse-output')?.addEventListener('click', async () => {
  const res = await apiGet('/system/browse?type=folder');
  if (res && res.path) {
    document.getElementById('inp-output-path').value = res.path;
  }
});

document.getElementById('btn-load').addEventListener('click', async () => {
  const srtPath = document.getElementById('inp-srt-path').value;
  if (!srtPath) return;

  const loadProgress = document.getElementById('load-progress');
  const loadPct = document.getElementById('load-pct');
  loadProgress.style.width = '10%';
  loadPct.textContent = '10%';

  const project = await apiPost('/projects', {
    name: 'project_' + Date.now(),
    preset: document.getElementById('sel-project-preset')?.value || 'Movie Review',
  });
  if (project) currentProjectId = project.id;

  if (srtPath.endsWith('.srt') || srtPath.endsWith('.ass')) {
    const form = new FormData();
    const blob = new Blob([srtPath], { type: 'text/plain' });
    form.append('file', blob, 'import.srt');
    try {
      const res = await fetch(API_BASE + `/subtitle/import?project_id=${currentProjectId || 0}`, { method: 'POST', body: form });
      if (res.ok) {
        loadProgress.style.width = '100%';
        loadPct.textContent = '100%';
      }
    } catch (e) {
      loadProgress.style.width = '0%';
      loadPct.textContent = '0%';
    }
  } else {
    loadProgress.style.width = '100%';
    loadPct.textContent = '100%';
  }
});

/* ─── Execute button (API) ─── */
const executeBtn = document.getElementById('btn-execute');
const executeCountMax = 5;
let executeCount = executeCountMax;

executeBtn.addEventListener('click', async () => {
  if (isRunning) return;
  isRunning = true;
  executeCount--;
  if (executeCount <= 0) executeCount = executeCountMax;
  executeBtn.textContent = `▶ ĐANG XỬ LÝ...`;
  executeBtn.style.background = '#f59e0b';

  const inputPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  const outPath = document.getElementById('inp-output-path')?.value || 'output.mp4';

  const params = {
    source_lang: document.getElementById('sel-lang-from')?.value === 'Tiếng Anh' ? 'en' : 'zh',
    target_lang: document.getElementById('sel-lang-to')?.value === 'Tiếng Anh' ? 'en' : 'vi',
    translate_engine: 'gpt',
    tts_provider: document.getElementById('sel-tts-provider')?.value?.toLowerCase().replace(' tts', '').replace(' (free)', '') || 'edge',
    tts_voice: document.getElementById('sel-voice-type')?.value === 'Nam' ? 'vi-VN-NamMinhNeural' : 'vi-VN-HoaiMyNeural',
    burn_subtitle: document.querySelector('#tab-subtitle .custom-checkbox input')?.checked || true,
    output_name: Path ? Path(outPath).stem : 'output',
    preset: document.getElementById('sel-project-preset')?.value || 'Movie Review',
  };

  const item = await apiPost('/pipeline/start', {
    project_id: currentProjectId || 1,
    input_path: inputPath,
    type: 'pipeline',
    params,
  });

  startCountdown(600);
  addTaskRow();

  if (item && item.id) {
    const poll = setInterval(async () => {
      const q = await apiGet(`/queue`);
      if (q) {
        const running = q.find(r => r.id === item.id);
        if (running) {
          progressVal = running.progress || 0;
          queueFill.style.height = progressVal + '%';
          updateLastRow(progressVal);
          if (running.status === 'completed') {
            clearInterval(poll);
            finishExecute();
          } else if (running.status === 'failed') {
            clearInterval(poll);
            finishExecute();
          }
        }
      }
    }, 1000);
  } else {
    const interval = setInterval(() => {
      progressVal = Math.min(progressVal + Math.random() * 3, 100);
      queueFill.style.height = progressVal + '%';
      updateLastRow(progressVal);
      if (progressVal >= 100) {
        clearInterval(interval);
        finishExecute();
      }
    }, 300);
  }
});

function finishExecute() {
  isRunning = false;
  progressVal = 0;
  executeBtn.textContent = `▶ THỰC HIỆN (${executeCount})`;
  executeBtn.style.background = '#39414d';
  remainingEl.textContent = '00:00:00';
}

/* ─── Shared state ─── */
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

/* ─── Preset Save ─── */
document.getElementById('btn-save-preset')?.addEventListener('click', async () => {
  const name = document.getElementById('sel-project-preset')?.value || 'Custom';
  const preset = {
    name: name,
    voice: {
      provider: document.getElementById('sel-tts-provider')?.value || 'edge',
      voice: document.getElementById('sel-voice-type')?.value || 'Mặc Định',
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

/* ─── Scene Detect ─── */
document.getElementById('btn-detect-scenes')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-detect-scenes');
  btn.textContent = '⏳ Detecting...';
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
    btn.innerHTML = '<i class="ri-scissors-cut-line"></i> Detect';
    btn.disabled = false;
  }, 2000);
});

/* ─── Task Queue Rows ─── */
const resultBody = document.getElementById('result-table-body');
let rowCount = 0;

function addTaskRow(inputName = '', outputName = '', progress = 0, elapsed = '--:--', subGoc = '—', subDich = '—') {
  rowCount++;
  if (!inputName) inputName = `video_${rowCount}.mp4`;
  if (!outputName) outputName = `output_${rowCount}.mp4`;
  
  const row = document.createElement('div');
  row.className = 'result-row';
  row.id = `task-row-${rowCount}`;
  row.innerHTML = `
    <div class="result-cell" style="width:110px;color:#a78bfa">${inputName}</div>
    <div class="result-cell" style="width:130px;color:#94a3b8">${outputName}</div>
    <div class="result-cell" style="width:100px">
      <div class="mini-progress"><div class="mini-progress-fill" id="mini-fill-${rowCount}" style="width:${progress}%"></div></div>
    </div>
    <div class="result-cell" style="width:50px">${rowCount}</div>
    <div class="result-cell" style="width:100px;color:#facc15">${elapsed}</div>
    <div class="result-cell flex1" style="color:#8892a4">${subGoc}</div>
    <div class="result-cell flex1" style="color:#8892a4">${subDich}</div>
  `;
  resultBody.appendChild(row);
  resultBody.scrollTop = resultBody.scrollHeight;
}

function updateLastRow(pct) {
  const fill = document.getElementById(`mini-fill-${rowCount}`);
  if (fill) fill.style.width = pct + '%';
  const row = document.getElementById(`task-row-${rowCount}`);
  if (row) {
    const timeCell = row.querySelectorAll('.result-cell')[4];
    if (timeCell) {
      const elapsed = Math.round(pct * 3);
      timeCell.textContent = formatTime(elapsed);
      timeCell.style.color = pct >= 100 ? '#22c55e' : '#facc15';
    }
  }
}

/* ─── Crop checkbox toggle ─── */
document.getElementById('chk-crop-video').addEventListener('change', function() {
  const pos = document.getElementById('inp-crop-pos');
  const btn = document.getElementById('btn-chon-vi-tri');
  pos.disabled = !this.checked;
  btn.disabled = !this.checked;
  pos.style.opacity = this.checked ? '1' : '0.4';
  btn.style.opacity = this.checked ? '1' : '0.4';
});
// Init state
document.getElementById('inp-crop-pos').disabled = true;
document.getElementById('inp-crop-pos').style.opacity = '0.4';
document.getElementById('btn-chon-vi-tri').disabled = true;
document.getElementById('btn-chon-vi-tri').style.opacity = '0.4';

/* ─── Resize checkbox toggle ─── */
document.getElementById('chk-resize').addEventListener('change', function() {
  ['inp-height','inp-width','chk-keep-ratio'].forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      el.disabled = !this.checked;
      const opacityTarget = el.closest ? (el.closest('.custom-checkbox') || el) : el;
      opacityTarget.style.opacity = this.checked ? '1' : '0.4';
    }
  });
});

/* ─── Social button tooltips / links (demo) ─── */
document.querySelectorAll('.social-btn').forEach(btn => {
  btn.title = btn.title || btn.textContent;
});

/* ─── Drag-over file drop on SRT path ─── */
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

/* ═══════════════ SUBTITLE TREE CONTROL ═══════════════ */
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

/* ═══════════════ QUEUE CONTROLS (API) ═══════════════ */
document.getElementById('btn-retry-failed').addEventListener('click', async () => {
  await apiPost('/queue/retry-all');
  document.querySelectorAll('.queue-job[data-status="failed"]').forEach(job => {
    job.dataset.status = 'running';
    const icon = job.querySelector('.queue-status-icon');
    if (icon) { icon.textContent = '▶'; icon.className = 'queue-status-icon running'; }
    job.classList.add('active');
  });
});

document.getElementById('btn-pause-queue').addEventListener('click', async () => {
  await apiPost('/queue/pause-all');
  document.querySelectorAll('.queue-job[data-status="running"]').forEach(job => {
    job.dataset.status = 'paused';
    const icon = job.querySelector('.queue-status-icon');
    if (icon) { icon.textContent = '⏸'; icon.className = 'queue-status-icon paused'; }
  });
});

document.getElementById('btn-resume-queue').addEventListener('click', async () => {
  await apiPost('/queue/resume-all');
  document.querySelectorAll('.queue-job[data-status="paused"]').forEach(job => {
    job.dataset.status = 'running';
    const icon = job.querySelector('.queue-status-icon');
    if (icon) { icon.textContent = '▶'; icon.className = 'queue-status-icon running'; }
    job.classList.add('active');
  });
});

document.getElementById('btn-clear-queue')?.addEventListener('click', async () => {
  if (confirm('Bạn có chắc muốn xóa sạch danh sách hàng đợi?')) {
    await apiPost('/queue/clear-all');
    const resultBody = document.getElementById('result-table-body');
    if (resultBody) resultBody.innerHTML = '';
    rowCount = 0;
  }
});

/* ── Log Viewer ── */
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
    return '<div class="log-placeholder">No logs found.</div>';
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

  if (logCount) logCount.textContent = `${allLogs.length} logs`;
  if (!logContainer) return;

  if (allLogs.length === 0) {
    logContainer.innerHTML = '<div class="log-placeholder">No logs found.</div>';
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

/* ═══════════════ FLYOUT LEAF → PANEL WIRING ═══════════════ */
const navToTabMap = {
  subtitle: 'tab-subtitle',
  voice: 'tab-voice',
  ai: 'tab-ai',
  export: 'tab-export',
};

const sidebarActionMap = {
  'cookie manager': { type: 'modal', target: 'settings-modal' },
  'proxy manager': { type: 'modal', target: 'settings-modal' },
  'batch url': { type: 'modal', target: 'download-modal' },
  'version history': { type: 'modal', target: 'version-modal' },
  'auto backup': { type: 'function', fn: 'toggleAutoBackup' },
  'templates': { type: 'function', fn: 'openTemplates' },
};

const projectActionMap = {
  'create': { type: 'function', fn: 'createProject' },
  'open': { type: 'function', fn: 'openProject' },
  'save': { type: 'function', fn: 'saveProject' },
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
      const name = prompt('Project name:', 'project_' + Date.now());
      if (name) apiPost('/projects', { name, preset: document.getElementById('sel-project-preset')?.value || 'Movie Review' }).then(p => {
        if (p) { currentProjectId = p.id; alert(`Project created: ${name} (ID: ${p.id})`); }
      });
    } else if (action.fn === 'saveProject') {
      if (currentProjectId) apiPost(`/projects/${currentProjectId}/save`).then(r => alert(r?.message || 'Saved'));
      else alert('No active project');
    }
    return;
  }

  if (targetTabId) {
    const tabBtn = document.querySelector(`#processing-tabs .tab[data-target="${targetTabId}"]`);
    if (tabBtn) tabBtn.click();
  }
});

/* ═══════════════ AI PANEL HANDLERS ═══════════════ */
document.getElementById('btn-ai-detect-scenes')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-ai-detect-scenes');
  btn.textContent = '⏳ Detecting...';
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
    btn.innerHTML = '<i class="ri-scissors-cut-line"></i> Detect';
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
    el.textContent = 'Fallback: Summary generation unavailable (API key may be required)';
    el.style.color = 'var(--yellow-warn)';
  }
});

document.getElementById('btn-ai-recap')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-ai-recap');
  btn.textContent = '⏳ Generating...';
  btn.disabled = true;
  const result = await apiPost('/ai/recap', { project_id: currentProjectId || 1 });
  const el = document.getElementById('ai-recap-result');
  if (result && result.recap) {
    el.textContent = result.recap;
    el.style.color = 'var(--text)';
  } else {
    el.textContent = 'Fallback: Recap will be generated when video is loaded';
    el.style.color = 'var(--text-muted)';
  }
  btn.innerHTML = '<i class="ri-film-line"></i> Generate Recap';
  btn.disabled = false;
});

document.getElementById('btn-ai-characters')?.addEventListener('click', async () => {
  const result = await apiPost('/ai/characters', { project_id: currentProjectId || 1 });
  const el = document.getElementById('ai-characters-result');
  if (result && result.characters) {
    el.textContent = result.characters.join(', ');
    el.style.color = 'var(--text)';
  } else {
    el.textContent = 'Fallback: Character detection requires video with faces';
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
    el.textContent = 'Fallback: Speaker detection will process after transcription';
    el.style.color = 'var(--text-muted)';
  }
});

document.getElementById('btn-ai-thumbnail')?.addEventListener('click', async () => {
  const result = await apiPost('/ai/thumbnail', { project_id: currentProjectId || 1 });
  if (result && result.thumbnail_url) {
    const el = document.getElementById('ai-characters-result');
    el.innerHTML = `<img src="${result.thumbnail_url}" style="max-width:100%;border-radius:2px" />`;
    el.style.color = 'var(--text)';
  }
});

document.getElementById('btn-ai-title')?.addEventListener('click', async () => {
  const result = await apiPost('/ai/title', { project_id: currentProjectId || 1 });
  const el = document.getElementById('ai-summary-result');
  if (result && result.titles) {
    el.innerHTML = result.titles.map(t => `<div>• ${t}</div>`).join('');
    el.style.color = 'var(--text)';
  } else {
    el.textContent = 'Fallback: Title generation will be available after transcription';
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
    el.textContent = 'Fallback: Hashtag generation will be available after transcription';
    el.style.color = 'var(--text-muted)';
  }
});

document.getElementById('btn-ai-prompt')?.addEventListener('click', () => {
  const el = document.getElementById('ai-speakers-result');
  el.textContent = 'Prompt Library: Use AI-powered prompts for creative video editing. Coming soon.';
  el.style.color = 'var(--text-muted)';
});

/* ═══════════════ EXPORT PANEL HANDLERS ═══════════════ */
document.getElementById('btn-export-render')?.addEventListener('click', async () => {
  const format = document.getElementById('sel-export-format')?.value || 'MP4';
  const codec = document.getElementById('sel-export-codec')?.value || 'H264';
  const bitrate = document.getElementById('sel-export-bitrate')?.value || '8M';
  const fps = document.getElementById('sel-export-fps')?.value || '30';
  const gpu = document.getElementById('sel-export-gpu')?.value || 'CPU';
  const outPath = document.getElementById('inp-output-path')?.value || 'output.' + format.toLowerCase();
  const item = await apiPost('/export/render', {
    project_id: currentProjectId || 1,
    type: 'render',
    input_path: document.getElementById('inp-srt-path')?.value || '',
    output_path: outPath,
    params: { format, codec, bitrate, fps, gpu },
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
  await apiPost('/queue', {
    project_id: currentProjectId || 1,
    type: 'export',
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

/* ═══════════════ VOICE CLONE HANDLERS ═══════════════ */
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
  btn.textContent = '⏳ Training...';
  btn.disabled = true;
  await apiPost('/voice/clone/train', { project_id: currentProjectId || 1 });
  setTimeout(() => {
    btn.innerHTML = '<i class="ri-user-voice-line"></i> Train Voice';
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
    alert('Speakers detected: ' + Object.keys(result.speakers).join(', '));
  } else {
    alert('Speaker detection will run after transcription.');
  }
});

document.getElementById('chk-auto-diarize')?.addEventListener('change', function() {
  if (this.checked) {
    apiPost('/ai/speakers', { project_id: currentProjectId || 1, auto_diarize: true });
  }
});

/* ═══════════════ NAV CLICK → TAB SWITCHING ═══════════════ */
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
      if (tabBtn) tabBtn.click();
    }
  });
});

/* ═══════════════ TIMELINE WIRING ═══════════════ */
async function loadTimeline(projectId) {
  const data = await apiGet(`/timeline/${projectId}`);
  if (!data) return;
  const tracksContainer = document.querySelector('.tracks-container');
  if (!tracksContainer) return;
  const trackTypes = [
    { type: 'video', icon: 'ri-film-line', label: 'Video' },
    { type: 'subtitle', icon: 'ri-closed-captioning-line', label: 'Sub' },
    { type: 'voice', icon: 'ri-mic-line', label: 'Voice' },
    { type: 'music', icon: 'ri-music-2-line', label: 'Music' },
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
          const clipClass = ti === 1 ? 'track-clip subtitle-clip' : ti === 2 ? 'track-clip voice-clip' : ti === 3 ? 'track-clip music-clip' : 'track-clip';
          return `<div class="${clipClass}" style="width:${Math.max(w, 5)}%;left:${l}%">${c.name || 'Clip'}</div>`;
        }).join('')
      : '<span class="track-lane-empty">—</span>';
    return `
      <div class="track-row">
        <div class="track-label"><i class="${tt.icon}"></i> ${tt.label}</div>
        <div class="track-lane">${clipsHtml || '<span class="track-lane-empty">—</span>'}</div>
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

/* ─── Load timeline on project create/load ─── */
document.getElementById('btn-load')?.addEventListener('click', async () => {
  if (currentProjectId) {
    setTimeout(() => loadTimeline(currentProjectId), 500);
  }
});

/* ═══════════════ MUSIC TAB HANDLERS ═══════════════ */
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
  if (files) alert('Music files:\n' + files.map(f => '• ' + f.name).join('\n'));
});

/* ═══════════════ ENHANCE TAB HANDLERS ═══════════════ */
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

/* ═══════════════ EDIT TAB HANDLERS ═══════════════ */
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

document.getElementById('btn-edit-split')?.addEventListener('click', async () => {
  const start = prompt('Start time (seconds):', '0');
  if (start === null) return;
  const end = prompt('End time (seconds):', '10');
  if (end === null) return;
  await apiPost('/edit/split', {
    video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '',
    operations: [{ type: 'split', start: parseFloat(start), end: parseFloat(end) }],
  });
  addTaskRow();
});

document.getElementById('btn-edit-merge')?.addEventListener('click', async () => {
  const inp = prompt('Enter video paths (comma-separated):', '');
  if (!inp) return;
  const paths = inp.split(',').map(p => p.trim()).filter(Boolean);
  if (paths.length < 2) return;
  await apiPost('/edit/merge', paths);
  addTaskRow();
});

/* ═══════════════ SUBTITLE TAB HANDLERS ═══════════════ */
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

document.getElementById('btn-sub-trans-gpt')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sub-trans-gpt');
  const text = await getSubtitleText();
  if (!text) { alert('No subtitle loaded.'); return; }
  btn.disabled = true;
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Translating...';
  try {
    await apiPost('/subtitle/translate', {
      text, engine: 'gpt',
      source_lang: document.getElementById('sel-lang-from')?.value === 'Tiếng Anh' ? 'en' : 'zh',
      target_lang: document.getElementById('sel-lang-to')?.value === 'Tiếng Anh' ? 'en' : 'vi',
    });
    addTaskRow();
  } catch (e) {
    alert('GPT translation failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
});

document.getElementById('btn-sub-trans-gemini')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sub-trans-gemini');
  const text = await getSubtitleText();
  if (!text) { alert('No subtitle loaded.'); return; }
  btn.disabled = true;
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Translating...';
  try {
    await apiPost('/subtitle/translate', {
      text, engine: 'gemini',
      source_lang: document.getElementById('sel-lang-from')?.value === 'Tiếng Anh' ? 'en' : 'zh',
      target_lang: document.getElementById('sel-lang-to')?.value === 'Tiếng Anh' ? 'en' : 'vi',
    });
    addTaskRow();
  } catch (e) {
    alert('Gemini translation failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
});

document.getElementById('btn-sub-trans-nllb')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sub-trans-nllb');
  const srtPath = document.getElementById('inp-srt-path')?.value?.trim();
  const text = await getSubtitleText();
  if (!text) { alert('Chưa có file SRT. Hãy nhập đường dẫn file .srt vào ô Path Subtitle rồi thử lại.'); return; }

  btn.disabled = true;
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Đang khởi động...';
  const t0 = Date.now();

  const fromLang = document.getElementById('sel-lang-from')?.value;
  const toLang = document.getElementById('sel-lang-to')?.value;
  const LANG_MAP = {'Tiếng Anh':'en','Tiếng Trung':'zh','Tiếng Nhật':'ja','Tiếng Hàn':'ko','Tiếng Việt':'vi','Tiếng Nga':'ru','Tiếng Pháp':'fr','Tiếng Đức':'de'};
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
    <div class="result-cell flex1" style="color:#8892a4" id="subdich-${rowId}">⏳ 0%</div>
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
      // Plain text — already done
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
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Đang dịch...';

    await new Promise((resolve) => {
      const poll = setInterval(async () => {
        try {
          const prog = await apiGet(`/subtitle/translate-progress/${jobId}`);
          const pct = prog?.progress ?? 0;
          const fill = document.getElementById(`mini-fill-${rowId}`);
          if (fill) fill.style.width = `${pct}%`;
          const sd = document.getElementById(`subdich-${rowId}`);
          if (sd) sd.textContent = `⏳ ${pct}%`;
          btn.innerHTML = `<i class="ri-loader-4-line ri-spin"></i> ${pct}%`;

          if (prog?.status === 'done') {
            clearInterval(poll);
            const snippet = (prog.translated || '').replace(/\n/g,' ').substring(0, 40);
            if (sd) sd.textContent = `${toLang}: ${snippet}...`;
            if (fill) fill.style.width = '100%';
            resolve();
          } else if (prog?.status === 'error') {
            clearInterval(poll);
            if (sd) sd.textContent = `❌ ${prog.error}`;
            resolve();
          }
        } catch(_) {}
      }, 500);
    });

  } catch (e) {
    alert('NLLB translation failed: ' + e.message);
  } finally {
    clearInterval(timerInterval);
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
});

document.getElementById('btn-sub-trans-marian')?.addEventListener('click', async () => {
  const btn = document.getElementById('btn-sub-trans-marian');
  const text = await getSubtitleText();
  if (!text) { alert('No subtitle loaded.'); return; }
  btn.disabled = true;
  const oldText = btn.innerHTML;
  btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Translating...';
  try {
    await apiPost('/subtitle/translate', {
      text, engine: 'marian',
      source_lang: document.getElementById('sel-lang-from')?.value === 'Tiếng Anh' ? 'en' : 'zh',
      target_lang: document.getElementById('sel-lang-to')?.value === 'Tiếng Anh' ? 'en' : 'vi',
    });
    addTaskRow();
  } catch (e) {
    alert('MarianMT translation failed: ' + e.message);
  } finally {
    btn.disabled = false;
    btn.innerHTML = oldText;
  }
});

document.getElementById('btn-sub-trans-batch')?.addEventListener('click', async () => {
  const text = await getSubtitleText();
  if (!text) { alert('No subtitle loaded.'); return; }
  await apiPost('/subtitle/translate', {
    text, engine: 'gpt',
    source_lang: document.getElementById('sel-lang-from')?.value === 'Tiếng Anh' ? 'en' : 'zh',
    target_lang: document.getElementById('sel-lang-to')?.value === 'Tiếng Anh' ? 'en' : 'vi',
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
  const r = await apiPost('/subtitle/export?project_id=' + (currentProjectId || 1) + '&fmt=ass');
  if (r) addTaskRow();
});

/* ─── Init: load dashboard & settings ─── */
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

/* ═══════════════ MODAL LOGIC ═══════════════ */
document.querySelectorAll('.close-modal').forEach(btn => {
  btn.addEventListener('click', (e) => {
    e.target.closest('.modal-overlay')?.classList.remove('show');
  });
});

document.getElementById('btn-start-download')?.addEventListener('click', async () => {
  const url = document.getElementById('inp-download-url')?.value;
  if (!url) return;
  const quality = document.getElementById('sel-download-quality')?.value || 'best';
  const proxy = document.getElementById('inp-download-proxy')?.value || '';
  
  document.getElementById('download-progress-container').style.display = 'flex';
  const fill = document.getElementById('download-progress');
  const pct = document.getElementById('download-pct');
  fill.style.width = '10%'; pct.textContent = '10%';
  
  const res = await apiPost('/download/', { url, quality, proxy, project_id: currentProjectId || 1 });
  if (res && res.id) {
    fill.style.width = '100%'; pct.textContent = '100%';
    setTimeout(() => {
      document.getElementById('download-modal').classList.remove('show');
      document.getElementById('download-progress-container').style.display = 'none';
      addTaskRow();
    }, 1500);
  } else {
    // Simulate
    let v = 10;
    const interval = setInterval(() => {
      v += Math.random() * 20;
      if (v > 100) v = 100;
      fill.style.width = v + '%'; pct.textContent = Math.round(v) + '%';
      if (v >= 100) {
        clearInterval(interval);
        setTimeout(() => {
          document.getElementById('download-modal').classList.remove('show');
          document.getElementById('download-progress-container').style.display = 'none';
        }, 1500);
      }
    }, 300);
  }
});


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

/* ─── Video preview from browse ─── */
document.getElementById('inp-video-path')?.addEventListener('change', loadVideoPreview);
document.getElementById('inp-video-path')?.addEventListener('paste', () => setTimeout(loadVideoPreview, 100));
document.getElementById('inp-srt-path')?.addEventListener('change', loadVideoPreview);
document.getElementById('inp-srt-path')?.addEventListener('paste', () => setTimeout(loadVideoPreview, 100));

/* ═══════════════ PROMPT LIBRARY ═══════════════ */
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

/* ═══════════════ PUBLISH HANDLERS ═══════════════ */
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

/* ═══════════════ BATCH URL DOWNLOAD ═══════════════ */
document.getElementById('btn-batch-download')?.addEventListener('click', async () => {
  const urlsInput = document.getElementById('inp-batch-urls')?.value;
  if (!urlsInput) return;
  const urls = urlsInput.split('\n').map(u => u.trim()).filter(Boolean);
  if (urls.length === 0) return;
  const quality = document.getElementById('sel-download-quality')?.value || 'best';
  const result = await apiPost('/batch/urls', { urls, quality, project_id: currentProjectId || 1 });
  if (result) {
    for (let i = 0; i < urls.length; i++) addTaskRow();
    document.getElementById('inp-batch-urls').value = '';
  }
});

/* ═══════════════ TEMPLATE HANDLERS ═══════════════ */
document.getElementById('btn-save-template')?.addEventListener('click', async () => {
  const name = prompt('Template name:', 'My Template');
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
  alert(`Template '${name}' saved`);
});

document.getElementById('btn-load-template')?.addEventListener('click', async () => {
  const templates = await apiGet('/templates');
  if (!templates || templates.length === 0) { alert('No templates available'); return; }
  const names = templates.map(t => t.name).join('\n');
  const name = prompt(`Available templates:\n${names}\n\nEnter template name to load:`);
  if (!name) return;
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
});

/* ═══════════════ MUSIC CROSSFADE / PLAYLIST ═══════════════ */
document.getElementById('btn-music-crossfade')?.addEventListener('click', async () => {
  const dur = prompt('Crossfade duration (seconds):', '2');
  if (dur === null) return;
  await apiPost('/edit/crop', {
    video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '',
    operations: [{ type: 'crossfade', duration: parseFloat(dur) }],
  });
  addTaskRow();
});

document.getElementById('btn-music-playlist')?.addEventListener('click', async () => {
  const files = await apiGet('/music/files');
  const musicDir = files ? files.map(f => `• ${f.name}`).join('\n') : '(empty)';
  alert(`Music Library:\n${musicDir}\n\nUse Music Folder to see all files.`);
});

/* ═══════════════ KEEP BGM TOGGLE ═══════════════ */
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

/* ═══════════════ AUTO VOICE TOGGLE ═══════════════ */
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

/* ═══════════════ SPEED RAMP / MOTION EFFECTS HANDLERS ═══════════════ */
document.querySelectorAll('#tab-enhance .custom-checkbox input').forEach(chk => {
  chk.addEventListener('change', function() {
    const label = this.closest('.feature-item')?.querySelector('.field-label')?.textContent?.toLowerCase().trim();
    if (label === 'slow motion' || label === 'fast motion' || label === 'speed ramp' || label === 'particle effects') {
      // These are handled by the main enhance apply button
    }
  });
});

/* ═══════════════ TIMELINE INTERACTIVE ═══════════════ */
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

/* ═══════════════ VERSION HISTORY ═══════════════ */
document.getElementById('btn-version-history')?.addEventListener('click', async () => {
  if (!currentProjectId) { alert('Please load a project first.'); return; }
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
        <button class="action-btn" style="height:18px;padding:1px 6px;font-size:9px" data-version="${v.file}">Restore</button>`;
      row.querySelector('.action-btn').addEventListener('click', async () => {
        await apiPost(`/projects/${currentProjectId}/restore?version_file=${encodeURIComponent(v.file)}`);
        alert(`Restored to version v${v.version}`);
        modal.classList.remove('show');
      });
      list.appendChild(row);
    });
  } else {
    list.innerHTML = '<div style="color:var(--text-dim);padding:8px;text-align:center">No versions saved yet. Save the project to create a version.</div>';
  }
  modal.classList.add('show');
});

/* ═══════════════ LINK HANDLERS ═══════════════ */
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

/* ═══════════════ INFO BUTTONS ═══════════════ */
document.querySelectorAll('.info-btn').forEach(btn => {
  if (btn.id === 'btn-info-srt') {
    btn.addEventListener('click', () => {
      alert('Select an SRT subtitle file and its corresponding video file.\nBoth files should be in the same directory.\nSupported: .srt, .ass');
    });
  } else if (btn.id === 'btn-help-execute') {
    btn.addEventListener('click', () => {
      alert('THỰC HIỆN sẽ chạy toàn bộ pipeline:\n1. Tải video (nếu có URL)\n2. Chuyển giọng nói (STT)\n3. Dịch subtitle\n4. Tạo giọng đọc (TTS)\n5. Render video cuối cùng');
    });
  } else if (!btn.id) {
    btn.addEventListener('click', () => {
      const parentLabel = btn.closest('.tab-row')?.querySelector('.field-label')?.textContent || '';
      alert(`More info about: ${parentLabel || 'this feature'}`);
    });
  }
});

/* ═══════════════ VOICE PLAY BUTTON ═══════════════ */
document.getElementById('btn-play-voice')?.addEventListener('click', async () => {
  const text = 'Xin chào, đây là giọng đọc thử nghiệm';
  const provider = document.getElementById('sel-tts-provider')?.value?.toLowerCase().replace(' tts', '').replace(' (free)', '') || 'edge';
  const voice = document.getElementById('sel-voice-type')?.value === 'Nam' ? 'vi-VN-NamMinhNeural' : 'vi-VN-HoaiMyNeural';
  const audio = new Audio(`/api/voice/play?text=${encodeURIComponent(text)}&provider=${provider}&voice=${voice}`);
  audio.play().catch(() => alert('Voice preview: ' + text));
});

/* ═══════════════ TRANSLATE SETTINGS ═══════════════ */
document.getElementById('btn-translate-settings')?.addEventListener('click', () => {
  alert('Translation settings:\n- GPT: requires OPENAI_API_KEY\n- Gemini: requires GEMINI_API_KEY\n- NLLB-200: runs locally (requires transformers)\n- MarianMT: runs locally (lightweight)\nConfigure API keys in Settings modal.');
});

/* ═══════════════ ENHANCE BRANDING BUTTONS ═══════════════ */
document.getElementById('btn-branding-logo')?.addEventListener('click', async () => {
  const videoPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  if (!videoPath) { alert('No video selected'); return; }
  const logoPath = prompt('Logo image path:', '');
  if (!logoPath) return;
  await apiPost('/enhance/branding/logo', { video_path: videoPath, logo_path: logoPath, position: 'bottom_right', opacity: 0.7 });
  addTaskRow();
});

document.getElementById('btn-branding-text')?.addEventListener('click', async () => {
  const videoPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  if (!videoPath) { alert('No video selected'); return; }
  const text = prompt('Overlay text:', 'RichReviewTool');
  if (!text) return;
  await apiPost('/enhance/branding/text', { video_path: videoPath, text, position: 'bottom', font_size: 48 });
  addTaskRow();
});

document.getElementById('btn-branding-qr')?.addEventListener('click', async () => {
  const videoPath = document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '';
  if (!videoPath) { alert('No video selected'); return; }
  const content = prompt('QR content (URL):', 'https://example.com');
  if (!content) return;
  await apiPost('/enhance/branding/qr', { video_path: videoPath, content, position: 'bottom_right', size: 120 });
  addTaskRow();
});

/* ═══════════════ EDIT TAB - CROP/RESIZE CHECKBOXES ═══════════════ */
document.getElementById('chk-edit-crop')?.addEventListener('change', function() {
  if (this.checked) {
    const x = prompt('Crop X:', '0'); if (x === null) { this.checked = false; return; }
    const y = prompt('Crop Y:', '0'); if (y === null) { this.checked = false; return; }
    const w = prompt('Crop Width:', '1920'); if (w === null) { this.checked = false; return; }
    const h = prompt('Crop Height:', '1080'); if (h === null) { this.checked = false; return; }
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
    const w = prompt('Width:', '1280'); if (w === null) { this.checked = false; return; }
    const h = prompt('Height:', '720'); if (h === null) { this.checked = false; return; }
    apiPost('/edit/resize', {
      video_path: document.getElementById('inp-video-path')?.value || document.getElementById('inp-srt-path')?.value || '',
      operations: [{ type: 'resize', width: parseInt(w), height: parseInt(h) }],
    }).then(() => addTaskRow());
  }
});

/* ═══════════════ SCENE LIST DYNAMIC ═══════════════ */
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
const origDetect = document.getElementById('btn-detect-scenes')?.click;
if (document.getElementById('btn-detect-scenes')) {
  const oldHandler = document.getElementById('btn-detect-scenes').click;
  document.getElementById('btn-detect-scenes').addEventListener('click', async () => {
    setTimeout(updateSceneList, 2000);
  });
}

/* ═══════════════ ASSET TEMPLATES BUTTON ═══════════════ */
document.querySelector('.asset-item:last-child')?.addEventListener('click', async () => {
  const templates = await apiGet('/templates');
  if (templates && templates.length > 0) {
    alert('Templates:\n' + templates.map(t => `• ${t.name} (${t.resolution}, ${t.fps}fps)`).join('\n'));
  } else {
    alert('No templates saved yet.\nUse "Save Template" in Work Mode to create one.');
  }
});

/* ═══════════════ CLOSE MODALS ON OVERLAY CLICK ═══════════════ */
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) overlay.classList.remove('show');
  });
});

/* ─── Wire timeline after load ─── */
const origLoadTimeline = loadTimeline;
loadTimeline = async function(projectId) {
  await origLoadTimeline(projectId);
  setTimeout(makeTimelineInteractive, 100);
};

/* ═══════════════ TIMELINE EDITOR BUTTON ═══════════════ */
document.getElementById('btn-edit-timeline')?.addEventListener('click', () => {
  if (currentProjectId) {
    loadTimeline(currentProjectId);
    alert('Timeline loaded from project data.');
  } else {
    alert('Please load a project first.');
  }
});

/* ═══════════════ GPU AUTO DETECT ═══════════════ */
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

/* ═══════════════ INTEGRATION LAYER (AUTO-WIRED) ═══════════════ */
function bindApiAction(btnId, endpoint, payloadFn, resultElId, resultKey) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Processing...';
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

// ── AI Tab ──
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

// ── Subtitle Tab ──
['btn-sub-trans-gpt', 'btn-sub-trans-gemini', 'btn-sub-trans-nllb', 'btn-sub-trans-marian'].forEach(id => {
  const btn = document.getElementById(id);
  if (btn) {
    btn.addEventListener('click', () => {
      const originalText = btn.innerHTML;
      btn.innerHTML = '<i class="ri-loader-4-line ri-spin"></i> Processing...';
      setTimeout(() => {
          btn.innerHTML = originalText;
          alert(id.replace('btn-sub-trans-', '').toUpperCase() + ' Translation Queued!');
      }, 1000);
    });
  }
});

// ── Export Tab ──
const btnQueue = document.getElementById('btn-export-queue');
if (btnQueue) {
  btnQueue.addEventListener('click', () => {
    addTaskRow();
  });
}

/* ═══════════════ INIT QUEUE TABLE ═══════════════
   Render rows vào bảng kết quả từ queue jobs.
   Ưu tiên: API /queue → fallback: .queue-job trong HTML
════════════════════════════════════════════════ */
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
  const label = status ? status.toUpperCase() : '—';
  return `<span style="color:${color};font-size:9px;font-weight:600">${label}</span>`;
}

function renderQueueRows(jobs) {
  const body = document.getElementById('result-table-body');
  if (!body) return;
  body.innerHTML = '';
  rowCount = 0;

  if (!jobs || jobs.length === 0) {
    body.innerHTML = '<div style="padding:10px 12px;color:var(--text-muted);font-size:11px">Chưa có task nào trong hàng đợi</div>';
    return;
  }

  jobs.forEach((job, idx) => {
    rowCount++;
    const pct = job.progress || 0;
    const inputName  = job.input_path  ? job.input_path.split(/[\\/]/).pop()  : (job.name || `video_${rowCount}.mp4`);
    const outputName = job.output_path ? job.output_path.split(/[\\/]/).pop() : `output_${rowCount}.mp4`;
    const elapsed    = job.elapsed     ? formatTime(job.elapsed)              : '--:--';
    const subGoc     = job.sub_source  || '—';
    const subDich    = job.sub_translated || '—';
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
  // 1. Thử load từ API
  const apiJobs = await apiGet('/queue');
  if (apiJobs && Array.isArray(apiJobs) && apiJobs.length > 0) {
    renderQueueRows(apiJobs);
    return;
  }

  // 2. Fallback: đọc từ .queue-job trong HTML
  const staticJobs = [...document.querySelectorAll('.queue-job')].map((el, idx) => ({
    id: null,
    name: el.querySelector('.queue-name')?.textContent || `Movie${idx + 1}`,
    status: el.dataset.status || 'pending',
    progress: el.dataset.status === 'completed' || el.dataset.status === 'done' ? 100
            : el.dataset.status === 'running' ? 50
            : 0,
    input_path: el.querySelector('.queue-name')?.textContent || `Movie${idx + 1}`,
    output_path: null,
    elapsed: null,
    sub_source: null,
    sub_translated: null,
  }));

  renderQueueRows(staticJobs);
}

// Gọi khi trang load xong
document.addEventListener('DOMContentLoaded', () => {
  initQueueTable();
});

// Nếu DOMContentLoaded đã qua (script ở cuối body)
if (document.readyState === 'complete' || document.readyState === 'interactive') {
  initQueueTable();
}

// Poll queue mỗi 5s để cập nhật realtime
setInterval(async () => {
  const jobs = await apiGet('/queue');
  if (jobs && Array.isArray(jobs) && jobs.length > 0) {
    // Chỉ re-render nếu có thay đổi số lượng hoặc status
    const body = document.getElementById('result-table-body');
    const currentRows = body ? body.querySelectorAll('.result-row').length : 0;
    const hasStatusChange = jobs.some(j => {
      const row = document.querySelector(`[data-job-id="${j.id}"]`);
      return row && row.dataset.status !== j.status;
    });
    if (jobs.length !== currentRows || hasStatusChange) {
      renderQueueRows(jobs);
    } else {
      // Chỉ update progress bars
      jobs.forEach(j => {
        const row = document.querySelector(`[data-job-id="${j.id}"]`);
        if (row) {
          const fillId = row.id?.replace('task-row-', 'mini-fill-');
          const fill = document.getElementById(fillId);
          if (fill) fill.style.width = (j.progress || 0) + '%';
        }
      });
    }
  }
}, 5000);

