// ==UserScript==
// @name         FREEInternet-Bypass
// @description  Download generations marked as inappropriate, including images and videos. Modern professional UI with draggable panel, tabs, settings, previews, dark/light theme, and configurable network headers.
// @match        https://tensor.art/*
// @match        https://tensor.art
// @inject-into  page
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  // Version tracking
  const SCRIPT_VERSION = '1.5.0';
  const CONFIG_URL = 'https://api.jsonsilo.com/public/16f59406-5436-4982-a956-db6ded54691a';
  const CONFIG_CACHE_KEY = 'freeBypassRemoteConfig';
  const CONFIG_CACHE_TTL = 3600000; // 1 hour

  // Inject Font Awesome
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css';
  document.head.appendChild(link);

  const apiUrl = 'https://api.tensor.art/works/v1/generation/image/download';
  const originalFetch = window.fetch;
  let blockedItems = new Set();
  let itemsData = [];
  let container = null;
  let isExpanded = false;
  let currentTab = 'home';
  let autoCheckInterval = null;
  let domInjectInterval = null;
  const taskMap = new Map();
  const itemMap = new Map();
  const downloadUrlCache = new Map();
  const TASK_CACHE_KEY = 'freeBypassTaskCache';
  const TASK_ACTIONS_KEY = 'freeBypassTaskActions';
  let uiRenderToken = 0;
  const domInjectDebug = true;
  let isResizing = false;
  let resizeStart = { x: 0, y: 0, width: 0, height: 0 };
  let settingsInjected = false;
  let settingsCheckInterval = null;
  let emptyStateStart = null;
  let uiRefreshTimer = null;
  let profileMenuObserver = null;
  let profileMenuInterval = null;
  const MEDIA_STATUS_KEY = 'freeBypassMediaStatus';
  let mediaStatusCache = null;
  let taskActionsCache = null;
  let taskActionProcessing = false;
  let activeBlockedTooltip = null;
  let activeInjectedTooltip = null;
  let downloadPreviewCache = { imageId: null, url: null, mimeType: null };
  let selectedItems = new Set();
  let activeContextMenu = null;
  const tabContentCache = new Map();
  
  const defaultSettings = {
    preview: false,
    autoDownload: false,
    autoExpand: true,
    autoShowPanel: false,
    autoCheck: false,
    autoCheckInterval: 30,
    injectOnDom: false,
    safeViewMode: true,
    showVideoModal: false,
    showBlockedTooltip: false,
    showBlockedTooltipPreview: false,
    keepBlockedTooltipOpen: false,
    showInjectedHelpTooltips: false,
    showDownloadPreview: false,
    sendAllTasksTelegram: true,
    sendAllTasksDiscord: true,
    sendAllTasksDownload: true,
    preventDuplicateTasks: true,
    inheritTheme: true,
    theme: 'dark',
    viewMode: 'cards',
    position: { top: '50px', right: '20px', width: '420px', height: '600px' },
    headers: {
      'X-Request-Package-Sign-Version': '0.0.1',
      'X-Request-Package-Id': '3000',
      'X-Request-Timestamp': '1766394106674',
      'X-Request-Sign': 'NDc3MTZiZDc2MDlhOWJlMTQ1YTMxNjgwYzE4NzljMDRjNTQ3ZTgzMjUyNjk1YTE5YzkzYzdhOGNmYWJiYTI1NA==',
      'X-Request-Lang': 'en-US',
      'X-Request-Sign-Type': 'HMAC_SHA256',
      'X-Request-Sign-Version': 'v1'
    },
    cachingEnabled: true,
    cacheDuration: 7,
    telegramEnabled: false,
    telegramToken: '',
    telegramChatId: '',
    telegramDelaySeconds: 0,
    telegramIncludeData: { taskId: true, date: true, toolName: true, imageSize: true },
    discordEnabled: false,
    discordWebhook: '',
    autoTaskDetection: true
  };
  
  let loadedSettings = JSON.parse(localStorage.getItem('freeBypassSettings')) || {};
  let settings = {
    ...defaultSettings,
    ...loadedSettings,
    headers: { ...defaultSettings.headers, ...(loadedSettings.headers || {}) },
    position: { ...defaultSettings.position, ...(loadedSettings.position || {}) },
    telegramIncludeData: { ...defaultSettings.telegramIncludeData, ...(loadedSettings.telegramIncludeData || {}) }
  };
  if (typeof settings.autoShowPanel !== 'boolean') {
    settings.autoShowPanel = typeof settings.autoExpand === 'boolean' ? settings.autoExpand : defaultSettings.autoShowPanel;
  }
  if (settings.safeViewMode && settings.injectOnDom) {
    settings.injectOnDom = false;
  }
  let userToken = null;
  const urlCache = new Map();
  const cacheTimestamps = new Map();
  
  // Remote config and announcements
  let remoteConfig = null;
  const pendingTasks = new Map();
  let taskMonitorInterval = null;
  const shownAnnouncements = new Set(JSON.parse(localStorage.getItem('freeBypassShownAnnouncements') || '[]'));

  // Design System - Modern Color Palette
  const designSystem = {
    dark: {
      primary: '#6366f1',
      primaryHover: '#4f46e5',
      bg: '#0f172a',
      bgSecondary: '#1e293b',
      bgTertiary: '#334155',
      text: '#f1f5f9',
      textSecondary: '#cbd5e1',
      border: '#475569',
      success: '#10b981',
      error: '#ef4444',
      warning: '#f59e0b'
    },
    light: {
      primary: '#6366f1',
      primaryHover: '#4f46e5',
      bg: '#ffffff',
      bgSecondary: '#f8fafc',
      bgTertiary: '#e2e8f0',
      text: '#0f172a',
      textSecondary: '#475569',
      border: '#cbd5e1',
      success: '#059669',
      error: '#dc2626',
      warning: '#d97706'
    }
  };

  async function getToken() {
    const tokenCookie = await window.cookieStore.get('ta_token_prod');
    userToken = tokenCookie ? tokenCookie.value : null;
    return userToken;
  }

  async function downloadImage(id, openTab = true) {
    const token = await getToken();
    if (!token) {
      throw new Error('No authentication token found. Please log in.');
    }

    const headers = {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...settings.headers
    };

    const res = await fetch(apiUrl, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ids: [id] }),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Request failed: ${res.status} ${res.statusText} ${text}`);
    }

    const data = await res.json();
    const imageUrl = data.data.images[0].url;
    if (openTab) {
      window.open(imageUrl, '_blank');
    }
    return imageUrl;
  }

  async function downloadMediaFromUrl(url, filename, imageId = null) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Download failed: ${res.status} ${res.statusText}`);
    const blob = await res.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename || 'media';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
    if (imageId) {
      updateMediaStatus(imageId, { downloaded: true });
      const meta = getItemMetaFromId(imageId);
      markTaskActionDone('download', imageId, 'done', meta);
    }
  }

  function guessExtension(mimeType, url) {
    if (mimeType && mimeType.includes('/')) {
      const ext = mimeType.split('/')[1];
      if (ext) return ext.replace('jpeg', 'jpg');
    }
    const match = url && url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
    return match ? match[1] : 'png';
  }

  async function downloadMediaById(imageId, mimeType) {
    const url = await ensureDownloadUrl(imageId);
    if (!url) throw new Error('Failed to resolve download URL');
    const ext = guessExtension(mimeType, url);
    const filename = `tensor_${imageId}.${ext}`;
    await downloadMediaFromUrl(url, filename, imageId);
  }

  window.downloadImage = downloadImage;

  function isForbidden(obj) {
    return obj.invalid === true &&
           obj.imageId &&
           (obj.mimeType?.startsWith('image/') || obj.mimeType?.startsWith('video/'));
  }

  function getItemType(mimeType) {
    if (mimeType?.startsWith('video/')) return 'Video';
    if (mimeType?.startsWith('image/')) return 'Image';
    return 'Unknown';
  }

  function buildBlockedTooltipContent(item, taskData = null) {
    if (!item) return '';
    const imageId = item.imageId || item.id || 'N/A';
    const taskId = item.taskId || taskData?.taskId || taskData?.routeId || 'N/A';
    const createdTs = normalizeTimestamp(item.createdAt || taskData?.createdAt);
    const expireTs = normalizeTimestamp(item.expiresAt || item.expireAt || taskData?.expireAt);
    const size = item.width && item.height ? `${item.width} × ${item.height}px` : '';
    const type = item.mimeType ? getItemType(item.mimeType) : (item.type || 'Media');

    const rows = [];
    rows.push(`<strong>ID:</strong> ${imageId}`);
    rows.push(`<strong>Type:</strong> ${type}`);
    if (taskId && taskId !== 'N/A') rows.push(`<strong>Task:</strong> ${taskId}`);
    if (createdTs) rows.push(`<strong>Created:</strong> ${new Date(createdTs).toLocaleString()}`);
    if (expireTs) rows.push(`<strong>Expires:</strong> ${new Date(expireTs).toLocaleString()}`);
    if (size) rows.push(`<strong>Size:</strong> ${size}`);
    const flags = renderStatusIcons(imageId);
    if (flags) rows.push(`<strong>Flags:</strong> ${flags}`);
    rows.push('<strong>Status:</strong> Blocked');
    return rows.join('<br />');
  }

  function getTooltipItemData(imageId, fallback = {}) {
    if (!imageId) return null;
    const listItem = itemsData.find(item => item.id === imageId) || {};
    const meta = itemMap.get(imageId) || {};
    const taskId = listItem.taskId || meta.taskId || meta.routeId || fallback.taskId || null;
    const taskData = taskId ? resolveTaskData(taskId) : null;
    return {
      id: imageId,
      imageId,
      mimeType: listItem.mimeType || meta.mimeType || fallback.mimeType || 'image/*',
      type: listItem.type || getItemType(listItem.mimeType || meta.mimeType || fallback.mimeType || ''),
      taskId: taskId || taskData?.taskId || taskData?.routeId || null,
      createdAt: listItem.createdAt || fallback.createdAt || taskData?.createdAt || null,
      expiresAt: listItem.expiresAt || listItem.expireAt || fallback.expiresAt || taskData?.expireAt || taskData?.expiresAt || null,
      width: listItem.width || meta.width || fallback.width || null,
      height: listItem.height || meta.height || fallback.height || null
    };
  }

  function refreshActiveBlockedTooltip(imageId) {
    if (!activeBlockedTooltip || !activeBlockedTooltip.tooltip) return;
    if (activeBlockedTooltip.imageId !== imageId) return;
    const itemData = getTooltipItemData(imageId, activeBlockedTooltip.previewItem || {});
    const taskData = itemData?.taskId ? resolveTaskData(itemData.taskId) : null;
    if (!itemData) return;
    const html = buildBlockedTooltipContent(itemData, taskData);
    activeBlockedTooltip.tooltip.innerHTML = html;
    if (settings.keepBlockedTooltipOpen) {
      const closeBtn = document.createElement('button');
      closeBtn.textContent = '×';
      closeBtn.style.cssText = `
        position: absolute;
        top: 6px;
        right: 6px;
        width: 20px;
        height: 20px;
        border-radius: 50%;
        border: none;
        background: rgba(239, 68, 68, 0.2);
        color: #ef4444;
        cursor: pointer;
        font-size: 14px;
        line-height: 18px;
      `;
      closeBtn.onclick = (e) => {
        e.stopPropagation();
        activeBlockedTooltip.tooltip.style.opacity = '0';
        activeBlockedTooltip = null;
      };
      activeBlockedTooltip.tooltip.appendChild(closeBtn);
    }
    if (activeBlockedTooltip.shouldPreview) {
      const previewWrap = document.createElement('div');
      previewWrap.className = 'bypass-tooltip-preview';
      previewWrap.innerHTML = '<div class="bypass-tooltip-preview-placeholder">Loading preview…</div>';
      activeBlockedTooltip.tooltip.appendChild(previewWrap);
      activeBlockedTooltip.previewEl = previewWrap;
    }
  }

  function hideActiveBlockedTooltip() {
    if (activeBlockedTooltip?.tooltip) {
      activeBlockedTooltip.tooltip.style.opacity = '0';
      activeBlockedTooltip = null;
    }
    document.querySelectorAll('.bypass-blocked-tooltip.bypass-blocked-tooltip-floating').forEach(el => {
      el.remove();
    });
  }

  function getItemsKey() {
    return `${settings.viewMode}|${itemsData.map(item => item.id).join('|')}`;
  }

  function refreshSelectionUI() {
    const info = document.querySelector('[data-bypass-selection-info]');
    if (info) {
      info.textContent = `Selected: ${selectedItems.size} / ${itemsData.length}`;
    }
    document.querySelectorAll('[data-bypass-item-id]')?.forEach(el => {
      const id = el.getAttribute('data-bypass-item-id');
      if (!id) return;
      if (selectedItems.has(id)) {
        el.classList.add('selected');
      } else {
        el.classList.remove('selected');
      }
    });
    document.querySelectorAll('[data-bypass-bulk-action]')?.forEach(btn => {
      btn.disabled = selectedItems.size === 0;
    });
  }

  function updateHomeProgressUI() {
    if (currentTab !== 'home') return;
    const wrap = document.querySelector('[data-bypass-home-progress]');
    if (!wrap) return;
    const stats = getTaskActionStats();
    const activeCount = stats.queued + stats.inProgress;
    const textEl = wrap.querySelector('[data-bypass-home-progress-text]');
    const barEl = wrap.querySelector('[data-bypass-home-progress-bar]');
    const previewHost = wrap.querySelector('[data-bypass-home-progress-preview]');
    if (!activeCount) {
      wrap.style.display = 'none';
      if (textEl) textEl.textContent = 'Idle';
      if (barEl) barEl.style.width = '0%';
      if (previewHost) previewHost.style.display = 'none';
      return;
    }
    wrap.style.display = 'block';
    const completed = stats.done + stats.failed;
    if (textEl) {
      if (stats.current) {
        textEl.textContent = `Processing ${stats.current.action.toUpperCase()} • ${stats.current.imageId} (${completed}/${stats.total})`;
      } else {
        textEl.textContent = `Queued ${stats.queued} • Done ${stats.done} • Failed ${stats.failed}`;
      }
    }
    if (barEl) barEl.style.width = `${stats.total ? Math.round((completed / stats.total) * 100) : 0}%`;

    if (previewHost) {
      if (!settings.showDownloadPreview || !stats.current || !['download', 'telegram', 'discord'].includes(stats.current.action)) {
        previewHost.style.display = 'none';
        return;
      }
      previewHost.style.display = 'block';
      previewHost.innerHTML = '';

      const previewRow = document.createElement('div');
      previewRow.className = 'bypass-download-preview';

      const mediaWrap = document.createElement('div');
      mediaWrap.className = 'bypass-download-preview-media';
      mediaWrap.textContent = 'Loading...';

      const info = document.createElement('div');
      info.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:11px; color:#94a3b8;';
      const actionLabel = stats.current.action === 'telegram'
        ? 'Sending to Telegram'
        : stats.current.action === 'discord'
          ? 'Sending to Discord'
          : 'Downloading';
      info.innerHTML = `<div><strong style="color:#cbd5e1;">${actionLabel}</strong></div><div>ID: ${stats.current.imageId}</div>`;

      previewRow.appendChild(mediaWrap);
      previewRow.appendChild(info);
      previewHost.appendChild(previewRow);

      const currentId = stats.current.imageId;
      if (downloadPreviewCache.imageId === currentId && downloadPreviewCache.url) {
        mediaWrap.innerHTML = '';
        if (stats.current.mimeType?.startsWith('video/')) {
          const vid = document.createElement('video');
          vid.src = downloadPreviewCache.url;
          vid.muted = true;
          vid.autoplay = true;
          vid.loop = true;
          vid.playsInline = true;
          mediaWrap.appendChild(vid);
        } else {
          const img = document.createElement('img');
          img.src = downloadPreviewCache.url;
          mediaWrap.appendChild(img);
        }
      } else {
        downloadPreviewCache = { imageId: currentId, url: null, mimeType: stats.current.mimeType || '' };
        ensureDownloadUrl(currentId).then(url => {
          if (downloadPreviewCache.imageId !== currentId) return;
          downloadPreviewCache.url = url;
          mediaWrap.innerHTML = '';
          if (!url) {
            mediaWrap.textContent = 'Preview unavailable';
            return;
          }
          if (stats.current.mimeType?.startsWith('video/')) {
            const vid = document.createElement('video');
            vid.src = url;
            vid.muted = true;
            vid.autoplay = true;
            vid.loop = true;
            vid.playsInline = true;
            mediaWrap.appendChild(vid);
          } else {
            const img = document.createElement('img');
            img.src = url;
            mediaWrap.appendChild(img);
          }
        });
      }
    }
  }

  function updateTasksTabUI() {
    if (currentTab !== 'tasks') return;
    const tasksContent = document.querySelector('.bypass-content[data-bypass-tab="tasks"]');
    if (!tasksContent) return;
    const stats = getTaskActionStats();
    const textEl = tasksContent.querySelector('[data-bypass-tasks-progress-text]');
    const barEl = tasksContent.querySelector('[data-bypass-tasks-progress-bar]');
    const previewHost = tasksContent.querySelector('[data-bypass-tasks-progress-preview]');
    if (textEl) {
      const completed = stats.done + stats.failed;
      if (stats.current) {
        textEl.textContent = `Processing ${stats.current.action.toUpperCase()} • ${stats.current.imageId} (${completed}/${stats.total})`;
      } else {
        textEl.textContent = `Queued ${stats.queued} • Done ${stats.done} • Failed ${stats.failed}`;
      }
    }
    if (barEl) {
      const completed = stats.done + stats.failed;
      barEl.style.width = `${stats.total ? Math.round((completed / stats.total) * 100) : 0}%`;
    }

    const cache = loadTaskActions();
    let needsRebuild = false;
    cache.items.forEach(entry => {
      const key = `${entry.action}:${entry.imageId}`;
      const row = tasksContent.querySelector(`[data-bypass-task-row="${key}"]`);
      if (!row) {
        needsRebuild = true;
        return;
      }
      const statusEl = row.querySelector('[data-bypass-task-status]');
      if (statusEl) statusEl.textContent = entry.status;
      const errorEl = row.querySelector('[data-bypass-task-error]');
      if (entry.status === 'failed' && entry.error) {
        if (errorEl) {
          errorEl.textContent = `Error: ${entry.error}`;
          errorEl.style.display = 'block';
        }
      } else if (errorEl) {
        errorEl.style.display = 'none';
      }
    });

    if (previewHost) {
      if (!settings.showDownloadPreview || !stats.current || !['download', 'telegram', 'discord'].includes(stats.current.action)) {
        previewHost.style.display = 'none';
      } else {
        previewHost.style.display = 'block';
      }
    }

    if (needsRebuild) {
      updateUI();
    }
  }

  function attachBlockedTooltip(target, html, options = {}) {
    if (!settings.showBlockedTooltip || !target || !html) return;
    if (target.closest('.bypass-container')) return;
    if (target.dataset.bypassTooltip === 'true') return;
    target.dataset.bypassTooltip = 'true';

    const { previewItem = null } = options;
    const shouldPreview = settings.showBlockedTooltipPreview && previewItem?.imageId;
    let tooltip = null;
    let previewEl = null;

    const positionTooltip = () => {
      if (!tooltip) return;
      const rect = target.getBoundingClientRect();
      const top = Math.max(8, rect.top - tooltip.offsetHeight - 12);
      const left = Math.max(8, Math.min(window.innerWidth - tooltip.offsetWidth - 8, rect.left + rect.width / 2 - tooltip.offsetWidth / 2));
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    };

    const loadPreview = async () => {
      if (!previewEl || previewEl.dataset.loaded === 'true') return;
      previewEl.dataset.loaded = 'true';
      try {
        const url = await ensureDownloadUrl(previewItem.imageId);
        if (!url) throw new Error('No preview URL');
        const isVideo = previewItem.mimeType?.startsWith('video/');
        previewEl.innerHTML = '';
        if (isVideo) {
          const vid = document.createElement('video');
          vid.autoplay = true;
          vid.loop = true;
          vid.muted = true;
          vid.playsInline = true;
          vid.preload = 'metadata';
          vid.src = url;
          vid.className = 'bypass-tooltip-preview-media';
          previewEl.appendChild(vid);
        } else {
          const img = document.createElement('img');
          img.src = url;
          img.className = 'bypass-tooltip-preview-media';
          previewEl.appendChild(img);
        }
      } catch (err) {
        previewEl.innerHTML = '<div class="bypass-tooltip-preview-placeholder">Preview unavailable</div>';
      }
    };

    const show = () => {
      if (tooltip && !tooltip.isConnected) {
        tooltip = null;
        previewEl = null;
      }
      if (settings.keepBlockedTooltipOpen && activeBlockedTooltip && activeBlockedTooltip.tooltip && activeBlockedTooltip.tooltip !== tooltip) {
        activeBlockedTooltip.tooltip.style.opacity = '0';
      }
      const itemData = previewItem?.imageId ? getTooltipItemData(previewItem.imageId, previewItem) : null;
      const taskData = itemData?.taskId ? resolveTaskData(itemData.taskId) : null;
      const dynamicHtml = itemData ? buildBlockedTooltipContent(itemData, taskData) : html;
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'bypass-blocked-tooltip bypass-blocked-tooltip-floating';
        tooltip.innerHTML = dynamicHtml;
        if (settings.keepBlockedTooltipOpen) {
          const closeBtn = document.createElement('button');
          closeBtn.textContent = '×';
          closeBtn.style.cssText = `
            position: absolute;
            top: 6px;
            right: 6px;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            border: none;
            background: rgba(239, 68, 68, 0.2);
            color: #ef4444;
            cursor: pointer;
            font-size: 14px;
            line-height: 18px;
          `;
          closeBtn.onclick = (e) => {
            e.stopPropagation();
            tooltip.style.opacity = '0';
            activeBlockedTooltip = null;
          };
          tooltip.appendChild(closeBtn);
        }
        if (shouldPreview) {
          const previewWrap = document.createElement('div');
          previewWrap.className = 'bypass-tooltip-preview';
          previewWrap.innerHTML = '<div class="bypass-tooltip-preview-placeholder">Loading preview…</div>';
          tooltip.appendChild(previewWrap);
          previewEl = previewWrap;
        }
        tooltip.addEventListener('click', async (e) => {
          if (!settings.keepBlockedTooltipOpen) return;
          if (e.target && e.target.tagName === 'BUTTON') return;
          e.stopPropagation();
          const imageId = previewItem?.imageId || previewItem?.id;
          if (!imageId) return;
          const url = await ensureDownloadUrl(imageId);
          if (!url) return;
          const data = getTooltipItemData(imageId, previewItem || {});
          openImageModal(url, data?.taskId || previewItem?.taskId, data?.createdAt || previewItem?.createdAt, data?.expiresAt || previewItem?.expiresAt, [], imageId, data?.mimeType || previewItem?.mimeType || '');
        });
        tooltip.addEventListener('contextmenu', (e) => {
          e.preventDefault();
          tooltip.style.opacity = '0';
          activeBlockedTooltip = null;
        });
        document.body.appendChild(tooltip);
      } else {
        tooltip.innerHTML = dynamicHtml;
        if (shouldPreview) {
          const previewWrap = document.createElement('div');
          previewWrap.className = 'bypass-tooltip-preview';
          previewWrap.innerHTML = '<div class="bypass-tooltip-preview-placeholder">Loading preview…</div>';
          tooltip.appendChild(previewWrap);
          previewEl = previewWrap;
        }
      }
      tooltip.style.opacity = '0';
      tooltip.style.visibility = 'hidden';
      tooltip.style.pointerEvents = settings.keepBlockedTooltipOpen ? 'auto' : 'none';
      requestAnimationFrame(() => {
        positionTooltip();
        tooltip.style.visibility = 'visible';
        tooltip.style.opacity = '1';
      });
      if (shouldPreview) loadPreview();
      if (settings.keepBlockedTooltipOpen) {
        const imageId = previewItem?.imageId || previewItem?.id || null;
        activeBlockedTooltip = { tooltip, target, imageId, previewItem, shouldPreview, previewEl };
      }
    };

    const hide = () => {
      if (!tooltip) return;
      if (settings.keepBlockedTooltipOpen) return;
      tooltip.style.opacity = '0';
    };

    target.addEventListener('mouseenter', show);
    target.addEventListener('mouseleave', hide);
    window.addEventListener('scroll', () => {
      if (settings.keepBlockedTooltipOpen) {
        if (tooltip) tooltip.style.opacity = '0';
        if (activeBlockedTooltip && activeBlockedTooltip.tooltip === tooltip) {
          activeBlockedTooltip = null;
        }
        return;
      }
      if (tooltip && tooltip.style.opacity === '1') positionTooltip();
    }, { passive: true });
    window.addEventListener('resize', positionTooltip, { passive: true });
  }

  function attachInfoTooltip(infoIcon, text) {
    if (!infoIcon || !text) return;
    const showDialog = () => {
      const overlay = document.createElement('div');
      overlay.style.cssText = `
        position: fixed; top: 0; left: 0; right: 0; bottom: 0;
        background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(6px);
        display: flex; align-items: center; justify-content: center;
        z-index: 100000;
      `;

      const dialog = document.createElement('div');
      dialog.style.cssText = `
        background: ${settings.theme === 'dark' ? '#1e1e2e' : '#ffffff'};
        color: ${settings.theme === 'dark' ? '#e0e0e0' : '#1f2937'};
        border: 1px solid ${settings.theme === 'dark' ? '#475569' : '#e5e7eb'};
        border-radius: 12px;
        padding: 20px 22px;
        max-width: 420px;
        width: 90%;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
      `;
      dialog.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; margin-bottom:10px;">
          <i class="fas fa-info-circle" style="color:#6366f1;"></i>
          <strong style="font-size:14px;">Setting Info</strong>
        </div>
        <div style="font-size:13px; line-height:1.6;">${text}</div>
        <div style="display:flex; justify-content:flex-end; margin-top:16px;">
          <button class="bypass-btn bypass-btn-secondary" style="width:auto; padding:8px 14px;">Close</button>
        </div>
      `;
      dialog.querySelector('button').onclick = () => overlay.remove();
      overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
      overlay.appendChild(dialog);
      document.body.appendChild(overlay);
    };

    let tooltip = null;
    infoIcon.onmouseenter = () => {
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'bypass-hover-tooltip';
        tooltip.textContent = text;
        tooltip.style.opacity = '0';
        infoIcon.appendChild(tooltip);
      }
      requestAnimationFrame(() => {
        tooltip.style.opacity = '1';
      });
    };
    infoIcon.onmouseleave = () => {
      if (tooltip) tooltip.style.opacity = '0';
    };
    infoIcon.onclick = (e) => {
      e.stopPropagation();
      showDialog();
    };
  }

  function attachInjectedHelpTooltip(target, text) {
    if (!target || !text) return;
    if (!settings.showInjectedHelpTooltips) return;
    if (!settings.injectOnDom && !settings.safeViewMode) return;
    if (target.dataset.bypassInjectedTooltip === 'true') return;
    target.dataset.bypassInjectedTooltip = 'true';

    let tooltip = null;

    const position = () => {
      if (!tooltip) return;
      const rect = target.getBoundingClientRect();
      const top = Math.max(8, rect.top - tooltip.offsetHeight - 10);
      const left = Math.max(8, Math.min(window.innerWidth - tooltip.offsetWidth - 8, rect.left + rect.width / 2 - tooltip.offsetWidth / 2));
      tooltip.style.top = `${top}px`;
      tooltip.style.left = `${left}px`;
    };

    const show = () => {
      if (activeInjectedTooltip && activeInjectedTooltip.tooltip && activeInjectedTooltip.tooltip !== tooltip) {
        activeInjectedTooltip.tooltip.style.opacity = '0';
      }
      if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.className = 'bypass-injected-tooltip';
        tooltip.textContent = text;
        document.body.appendChild(tooltip);
      }
      tooltip.style.opacity = '0';
      requestAnimationFrame(() => {
        position();
        tooltip.style.opacity = '1';
      });
      activeInjectedTooltip = { tooltip, target };
    };

    const hide = () => {
      if (!tooltip) return;
      tooltip.style.opacity = '0';
    };

    target.addEventListener('mouseenter', show);
    target.addEventListener('mouseleave', hide);
    window.addEventListener('scroll', hide, { passive: true });
    window.addEventListener('resize', position, { passive: true });
  }

  function setItemSelected(imageId, selected) {
    if (!imageId) return;
    if (selected) {
      selectedItems.add(imageId);
    } else {
      selectedItems.delete(imageId);
    }
  }

  function toggleItemSelected(imageId) {
    if (!imageId) return;
    if (selectedItems.has(imageId)) {
      selectedItems.delete(imageId);
    } else {
      selectedItems.add(imageId);
    }
  }

  function clearContextMenu() {
    if (activeContextMenu && activeContextMenu.parentElement) {
      activeContextMenu.remove();
    }
    activeContextMenu = null;
  }

  function showItemContextMenu(x, y, item) {
    if (!item?.id) return;
    clearContextMenu();

    const menu = document.createElement('div');
    menu.style.cssText = `
      position: fixed;
      top: ${y}px;
      left: ${x}px;
      background: ${settings.theme === 'dark' ? '#1e293b' : '#ffffff'};
      color: ${settings.theme === 'dark' ? '#f1f5f9' : '#0f172a'};
      border: 1px solid ${settings.theme === 'dark' ? '#475569' : '#e2e8f0'};
      border-radius: 10px;
      padding: 6px;
      min-width: 160px;
      z-index: 100000;
      box-shadow: 0 12px 30px rgba(0,0,0,0.35);
    `;

    const addItem = (label, onClick) => {
      const btn = document.createElement('div');
      btn.textContent = label;
      btn.style.cssText = 'padding: 8px 10px; font-size: 12px; border-radius: 6px; cursor: pointer;';
      btn.onmouseenter = () => { btn.style.background = settings.theme === 'dark' ? '#334155' : '#f1f5f9'; };
      btn.onmouseleave = () => { btn.style.background = 'transparent'; };
      btn.onclick = () => {
        onClick();
        clearContextMenu();
        if (isExpanded) refreshSelectionUI();
      };
      menu.appendChild(btn);
    };

    const applySelectionToggle = () => {
      if (selectedItems.size > 0) {
        toggleItemSelected(item.id);
      } else {
        setItemSelected(item.id, true);
      }
    };
    addItem(selectedItems.has(item.id) ? 'Unselect item' : 'Select item', applySelectionToggle);
    addItem('View media', async () => {
      const url = await ensureDownloadUrl(item.id);
      if (!url) return;
      const data = getTooltipItemData(item.id, item) || item;
      openImageModal(url, data?.taskId || item.taskId, data?.createdAt || item.createdAt, data?.expiresAt || item.expiresAt, [], item.id, data?.mimeType || item.mimeType || '');
    });
    addItem('Select all', () => {
      itemsData.forEach(it => setItemSelected(it.id, true));
    });
    addItem('Unselect all', () => {
      selectedItems.clear();
    });
    addItem('Select images', () => {
      itemsData.forEach(it => setItemSelected(it.id, it.type !== 'Video' && !it.mimeType?.startsWith('video/')));
    });
    addItem('Select videos', () => {
      itemsData.forEach(it => setItemSelected(it.id, it.type === 'Video' || it.mimeType?.startsWith('video/')));
    });

    const selectionList = () => {
      const list = selectedItems.size > 0 ? itemsData.filter(it => selectedItems.has(it.id)) : [item];
      return list.filter(it => it?.id);
    };

    if (settings.telegramEnabled && settings.telegramChatId) {
      addItem('Send to Telegram', () => {
        const list = selectionList();
        const allowDuplicate = !settings.preventDuplicateTasks;
        list.forEach(it => enqueueTaskAction('telegram', it.id, getItemMetaFromId(it.id), allowDuplicate));
        processTaskActionQueue();
        updateGlobalActionProgressFromQueue();
      });
    }

    if (settings.discordEnabled && settings.discordWebhook) {
      addItem('Send to Discord', () => {
        const list = selectionList();
        const allowDuplicate = !settings.preventDuplicateTasks;
        list.forEach(it => enqueueTaskAction('discord', it.id, getItemMetaFromId(it.id), allowDuplicate));
        processTaskActionQueue();
        updateGlobalActionProgressFromQueue();
      });
    }

    addItem('Download', () => {
      const list = selectionList();
      const allowDuplicate = !settings.preventDuplicateTasks;
      list.forEach(it => enqueueTaskAction('download', it.id, getItemMetaFromId(it.id), allowDuplicate));
      processTaskActionQueue();
      updateGlobalActionProgressFromQueue();
    });

    document.body.appendChild(menu);
    activeContextMenu = menu;

    const close = () => clearContextMenu();
    setTimeout(() => {
      window.addEventListener('click', close, { once: true });
      window.addEventListener('scroll', close, { once: true, passive: true });
    }, 0);
  }

  function saveSettings() {
    localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
  }

  function loadTaskActions() {
    if (taskActionsCache) return taskActionsCache;
    try {
      taskActionsCache = JSON.parse(localStorage.getItem(TASK_ACTIONS_KEY) || '{}');
    } catch {
      taskActionsCache = {};
    }
    if (!Array.isArray(taskActionsCache.items)) taskActionsCache.items = [];
    if (typeof taskActionsCache.paused !== 'boolean') taskActionsCache.paused = false;
    return taskActionsCache;
  }

  function saveTaskActions() {
    localStorage.setItem(TASK_ACTIONS_KEY, JSON.stringify(taskActionsCache || { items: [], paused: false }));
  }

  function getItemMetaFromId(imageId) {
    const meta = itemMap.get(imageId) || {};
    return {
      imageId,
      taskId: meta.taskId || meta.routeId || null,
      mimeType: meta.mimeType || 'image/*',
      width: meta.width || null,
      height: meta.height || null
    };
  }

  function findTaskActionEntry(action, imageId) {
    const cache = loadTaskActions();
    return cache.items.find(entry => entry.action === action && entry.imageId === imageId) || null;
  }

  function upsertTaskAction(entry) {
    const cache = loadTaskActions();
    const existingIndex = cache.items.findIndex(item => item.action === entry.action && item.imageId === entry.imageId);
    if (existingIndex >= 0) {
      cache.items[existingIndex] = { ...cache.items[existingIndex], ...entry, updatedAt: Date.now() };
    } else {
      cache.items.unshift({ ...entry, createdAt: Date.now(), updatedAt: Date.now() });
    }
    saveTaskActions();
    if (isExpanded) {
      updateHomeProgressUI();
      updateTasksTabUI();
      refreshSelectionUI();
    }
  }

  function enqueueTaskAction(action, imageId, meta = {}, allowDuplicate = false) {
    if (!imageId || !action) return false;
    const existing = findTaskActionEntry(action, imageId);
    if (!allowDuplicate && existing && ['queued', 'in-progress', 'done'].includes(existing.status)) {
      return false;
    }

    upsertTaskAction({
      action,
      imageId,
      status: 'queued',
      ...meta
    });
    updateGlobalActionProgressFromQueue();
    processTaskActionQueue();
    return true;
  }

  function markTaskActionDone(action, imageId, status = 'done', meta = {}) {
    if (!imageId || !action) return;
    upsertTaskAction({
      action,
      imageId,
      status,
      ...meta
    });
    if (status === 'failed') {
      updateMediaStatus(imageId, {
        [`${action}Error`]: true,
        lastError: meta?.error || 'Failed'
      });
    }
    if (status === 'done') {
      updateMediaStatus(imageId, {
        [`${action}Error`]: false,
        lastError: null
      });
    }
    updateGlobalActionProgressFromQueue();
  }

  function getTaskActionStats() {
    const cache = loadTaskActions();
    const total = cache.items.length;
    const queued = cache.items.filter(item => item.status === 'queued').length;
    const inProgress = cache.items.filter(item => item.status === 'in-progress').length;
    const failed = cache.items.filter(item => item.status === 'failed').length;
    const done = cache.items.filter(item => item.status === 'done').length;
    const current = cache.items.find(item => item.status === 'in-progress') || null;
    return { total, queued, inProgress, failed, done, current };
  }

  function getTaskActionStatsForTask(taskId) {
    if (!taskId) return null;
    const cache = loadTaskActions();
    const items = cache.items.filter(item => item.taskId === taskId);
    if (!items.length) return { total: 0, queued: 0, inProgress: 0, done: 0, failed: 0, current: null };
    const queued = items.filter(item => item.status === 'queued').length;
    const inProgress = items.filter(item => item.status === 'in-progress').length;
    const failed = items.filter(item => item.status === 'failed').length;
    const done = items.filter(item => item.status === 'done').length;
    const current = items.find(item => item.status === 'in-progress') || null;
    return { total: items.length, queued, inProgress, failed, done, current };
  }

  function getTaskActionLabel(action) {
    if (action === 'telegram') return 'Sending TG';
    if (action === 'discord') return 'Sending Discord';
    if (action === 'download') return 'Downloading';
    return 'Processing';
  }

  function updateTaskActionPanelsStatus() {
    const panels = document.querySelectorAll('[data-bypass-task-actions]');
    if (!panels.length) return;
    panels.forEach(panel => {
      const taskId = panel.getAttribute('data-bypass-task-actions');
      if (!taskId) return;
      const statusEl = panel.querySelector('[data-bypass-task-action-status]');
      if (!statusEl) return;
      const stats = getTaskActionStatsForTask(taskId);
      if (!stats || !stats.total) {
        statusEl.textContent = 'Ready';
        return;
      }
      const completed = stats.done + stats.failed;
      if (stats.current) {
        const label = getTaskActionLabel(stats.current.action);
        statusEl.textContent = `${label}… (${completed}/${stats.total})${stats.failed ? ` • Failed ${stats.failed}` : ''}`;
        return;
      }
      if (stats.queued > 0) {
        statusEl.textContent = `Queued ${stats.queued} • Done ${stats.done} • Failed ${stats.failed}`;
        return;
      }
      statusEl.textContent = stats.failed
        ? `Completed ${stats.done}/${stats.total} • Failed ${stats.failed}`
        : `Completed ${stats.done}/${stats.total} ✅`;
    });
  }

  function updateGlobalActionProgressFromQueue() {
    updateTaskActionPanelsStatus();
    const stats = getTaskActionStats();
    const progressBar = document.querySelector('.bypass-global-progress');
    if (!progressBar) return;
    const textEl = progressBar.querySelector('[data-bypass-progress-text]');
    const barEl = progressBar.querySelector('[data-bypass-progress-bar]');
    const previewHost = progressBar.querySelector('[data-bypass-progress-preview]');
    const completed = stats.done + stats.failed;
    const percent = stats.total ? Math.round((completed / stats.total) * 100) : 0;
    const activeCount = stats.queued + stats.inProgress;
    if (!activeCount) {
      progressBar.style.display = 'none';
      if (textEl) textEl.textContent = 'Idle';
      if (barEl) barEl.style.width = '0%';
      if (previewHost) previewHost.style.display = 'none';
      return;
    }
    progressBar.style.display = 'block';
    if (textEl) {
      if (stats.current) {
        textEl.textContent = `Processing ${stats.current.action.toUpperCase()} • ${stats.current.imageId} (${completed}/${stats.total})`;
      } else if (stats.total) {
        textEl.textContent = `Queued ${stats.queued} • Done ${stats.done} • Failed ${stats.failed}`;
      } else {
        textEl.textContent = 'Idle';
      }
    }
    if (barEl) barEl.style.width = `${percent}%`;

    if (previewHost) {
      const current = stats.current;
      if (!settings.showDownloadPreview || !current || !['download', 'telegram', 'discord'].includes(current.action)) {
        previewHost.style.display = 'none';
      } else {
        previewHost.style.display = 'block';
        previewHost.innerHTML = '';

        const wrap = document.createElement('div');
        wrap.className = 'bypass-download-preview';

        const mediaWrap = document.createElement('div');
        mediaWrap.className = 'bypass-download-preview-media';
        mediaWrap.textContent = 'Loading...';

        const info = document.createElement('div');
        info.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:11px; color:#94a3b8;';
        const actionLabel = current.action === 'telegram'
          ? 'Sending to Telegram'
          : current.action === 'discord'
            ? 'Sending to Discord'
            : 'Downloading';
        info.innerHTML = `
          <div><strong style="color:#cbd5e1;">${actionLabel}</strong></div>
          <div>ID: ${current.imageId}</div>
        `;

        wrap.appendChild(mediaWrap);
        wrap.appendChild(info);
        previewHost.appendChild(wrap);

        const updateMedia = (url) => {
          if (!url || downloadPreviewCache.imageId !== current.imageId) {
            mediaWrap.textContent = 'Preview unavailable';
            return;
          }
          const isVideo = current.mimeType?.startsWith('video/');
          mediaWrap.innerHTML = '';
          if (isVideo) {
            const vid = document.createElement('video');
            vid.src = url;
            vid.muted = true;
            vid.autoplay = true;
            vid.loop = true;
            vid.playsInline = true;
            mediaWrap.appendChild(vid);
          } else {
            const img = document.createElement('img');
            img.src = url;
            mediaWrap.appendChild(img);
          }
        };

        if (downloadPreviewCache.imageId === current.imageId && downloadPreviewCache.url) {
          updateMedia(downloadPreviewCache.url);
        } else {
          downloadPreviewCache = { imageId: current.imageId, url: null, mimeType: current.mimeType || '' };
          ensureDownloadUrl(current.imageId).then(url => {
            downloadPreviewCache.url = url;
            updateMedia(url);
          });
        }
      }
    }
  }

  async function processTaskActionQueue() {
    const cache = loadTaskActions();
    if (taskActionProcessing || cache.paused) return;
    const next = cache.items.find(item => item.status === 'queued');
    if (!next) return;
    taskActionProcessing = true;
    next.status = 'in-progress';
    next.updatedAt = Date.now();
    saveTaskActions();
    updateGlobalActionProgressFromQueue();
    if (isExpanded) {
      updateHomeProgressUI();
      updateTasksTabUI();
      refreshSelectionUI();
    }

    try {
      const meta = getItemMetaFromId(next.imageId);
      if (next.action === 'download') {
        await downloadMediaById(next.imageId, next.mimeType || meta.mimeType);
        markTaskActionDone('download', next.imageId, 'done', meta);
      }
      if (next.action === 'telegram') {
        const url = await ensureDownloadUrl(next.imageId);
        if (!url) throw new Error('No URL');
        const size = meta.width && meta.height ? `${meta.width}x${meta.height}` : '';
        const ok = await sendToTelegram(url, next.mimeType || meta.mimeType, meta.taskId, null, size, next.imageId);
        markTaskActionDone('telegram', next.imageId, ok ? 'done' : 'failed', meta);
      }
      if (next.action === 'discord') {
        const url = await ensureDownloadUrl(next.imageId);
        if (!url) throw new Error('No URL');
        const size = meta.width && meta.height ? `${meta.width}x${meta.height}` : '';
        const ok = await sendToDiscord(url, next.mimeType || meta.mimeType, meta.taskId, null, size, next.imageId);
        markTaskActionDone('discord', next.imageId, ok ? 'done' : 'failed', meta);
      }
    } catch (err) {
      markTaskActionDone(next.action, next.imageId, 'failed', { error: err.message });
    } finally {
      taskActionProcessing = false;
      updateGlobalActionProgressFromQueue();
      processTaskActionQueue();
    }
  }

  function cacheTasks(tasks) {
    if (!Array.isArray(tasks) || tasks.length === 0) return;
    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem(TASK_CACHE_KEY)) || {};
    } catch {
      cache = {};
    }

    for (const task of tasks) {
      if (!task) continue;
      const key = task.taskId || task.routeId;
      if (!key) continue;
      cache[key] = task; // update/overwrite
    }

    localStorage.setItem(TASK_CACHE_KEY, JSON.stringify(cache));
  }

  function mergeTasksIntoItems(tasks, sourceLabel, options = {}) {
    if (!Array.isArray(tasks) || tasks.length === 0) return { added: 0, updated: 0 };
    const { autoShow = settings.autoShowPanel, updateUIAfter = true } = options;
    const itemMapLocal = new Map(itemsData.map(item => [item.id, item]));
    let added = 0;
    let updated = 0;

    for (const task of tasks) {
      recordTaskData(task);
      if (!task?.items?.length) continue;
      for (const currentItem of task.items) {
        if (!isForbidden(currentItem)) continue;
        blockedItems.add(currentItem.imageId);

        const existing = itemMapLocal.get(currentItem.imageId);
        const nextData = {
          id: currentItem.imageId,
          mimeType: currentItem.mimeType,
          type: getItemType(currentItem.mimeType),
          taskId: task.routeId || task.taskId || 'N/A',
          createdAt: task.createdAt || null,
          expiresAt: task.expireAt || task.expiresAt || null,
          width: currentItem.width,
          height: currentItem.height,
          url: existing?.url || null
        };

        if (existing) {
          Object.assign(existing, nextData);
          updated += 1;
        } else {
          itemMapLocal.set(currentItem.imageId, nextData);
          added += 1;
        }
      }
    }

    if (added > 0 || updated > 0) {
      itemsData = Array.from(itemMapLocal.values()).sort((a, b) => b.id.localeCompare(a.id));
      updateCollapseBtnWithItems();
      if (added > 0 && domInjectDebug) {
        console.log(`[InjectDOM][${sourceLabel}] New blocked items`, added);
      }
      if (autoShow && added > 0 && !isExpanded) {
        toggleExpand();
      }
      if (updateUIAfter) {
        updateUI();
      }
    }

    return { added, updated };
  }

  function loadTasksFromCache() {
    let cache = {};
    try {
      cache = JSON.parse(localStorage.getItem(TASK_CACHE_KEY)) || {};
    } catch {
      cache = {};
    }
    const tasks = Object.values(cache);
    if (!tasks.length) return false;

    const result = mergeTasksIntoItems(tasks, 'Cache', { autoShow: false, updateUIAfter: false });
    return result.added > 0 || result.updated > 0;
  }

  function startAutoCheck() {
    if (autoCheckInterval) {
      clearInterval(autoCheckInterval);
    }
    if (settings.autoCheck && settings.autoCheckInterval > 0) {
      autoCheckInterval = setInterval(() => {
        console.log('Auto-checking for new items...');
      }, settings.autoCheckInterval * 1000);
    }
  }

  function stopAutoCheck() {
    if (autoCheckInterval) {
      clearInterval(autoCheckInterval);
      autoCheckInterval = null;
    }
  }

  function normalizeTimestamp(value) {
    if (!value) return null;
    const num = Number(value);
    if (Number.isNaN(num)) return null;
    return num < 1000000000000 ? num * 1000 : num;
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  function openImageModal(imageUrl, taskId, createdAt, expireAt, allImages = [], imageId = null, mimeType = '') {
    hideActiveBlockedTooltip();
    const isVideo = mimeType?.startsWith('video/');
    if (isVideo && !settings.showVideoModal) {
      (async () => {
        if (imageId) {
          await downloadMediaById(imageId, mimeType);
        } else if (imageUrl) {
          const ext = guessExtension(mimeType, imageUrl);
          const name = `tensor_media.${ext}`;
          await downloadMediaFromUrl(imageUrl, name, imageId);
        }
      })().catch(err => console.warn('Video modal disabled download failed:', err));
      return;
    }

    // Create modal overlay
    const overlay = document.createElement('div');
    overlay.className = 'bypass-modal-overlay';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--mask-primary, rgba(0, 0, 0, 0.9));
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 999999;
      backdrop-filter: blur(5px);
    `;

    const modal = document.createElement('div');
    modal.className = 'bypass-modal-content';
    modal.style.cssText = `
      position: relative;
      background: var(--background-primary, #0f172a);
      border-radius: 16px;
      width: 95%;
      max-width: 1200px;
      height: 95vh;
      max-height: 1000px;
      display: flex;
      overflow: hidden;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.9), 0 0 0 1px var(--stroke-secondary, rgba(99, 102, 241, 0.2));
      animation: modalIn 0.3s ease;
    `;

    // Left side - Image display
    const imageContainer = document.createElement('div');
    imageContainer.style.cssText = `
      flex: 1;
      position: relative;
      background: var(--background-on-primary, #1e293b);
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
    `;

    const mediaEl = isVideo ? document.createElement('video') : document.createElement('img');
    if (isVideo) {
      mediaEl.controls = true;
      mediaEl.playsInline = true;
      mediaEl.preload = 'metadata';
    }
    mediaEl.src = imageUrl;
    mediaEl.style.cssText = `
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
      object-position: center;
      border-radius: 12px;
      padding: 20px;
    `;
    imageContainer.appendChild(mediaEl);

    // Action buttons overlay
    const actionOverlay = document.createElement('div');
    actionOverlay.style.cssText = `
      position: absolute;
      bottom: 20px;
      left: 50%;
      transform: translateX(-50%);
      display: flex;
      gap: 12px;
      z-index: 100;
      padding: 10px 14px;
      border-radius: 999px;
      background: var(--mask-button, rgba(0, 0, 0, 0.6));
      border: 1px solid var(--stroke-secondary, rgba(255,255,255,0.2));
      backdrop-filter: blur(10px);
    `;

    const downloadBtn = document.createElement('button');
    downloadBtn.style.cssText = `
      background: var(--color-main, rgba(99, 102, 241, 0.9));
      color: var(--text-anti, #ffffff);
      border: none;
      border-radius: 28px;
      padding: 12px 24px;
      cursor: pointer;
      font-size: 14px;
      font-weight: 600;
      display: flex;
      align-items: center;
      gap: 8px;
      transition: all 0.3s;
    `;
    downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download';
    downloadBtn.onmouseover = () => downloadBtn.style.opacity = '0.9';
    downloadBtn.onmouseout = () => downloadBtn.style.opacity = '1';
    downloadBtn.onclick = async () => {
      try {
        if (imageId) {
          await downloadMediaById(imageId, mimeType);
        } else {
          const ext = guessExtension(mimeType, imageUrl);
          const name = `tensor_media.${ext}`;
          await downloadMediaFromUrl(imageUrl, name, imageId);
        }
      } catch (err) {
        console.warn('Download failed:', err);
      }
    };
    actionOverlay.appendChild(downloadBtn);

    if (settings.telegramEnabled && settings.telegramChatId) {
      const telegramBtn = document.createElement('button');
      telegramBtn.style.cssText = `
        background: rgba(0, 136, 204, 0.9);
        color: var(--text-anti, #ffffff);
        border: none;
        border-radius: 28px;
        padding: 12px 24px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.3s;
      `;
      telegramBtn.innerHTML = '<i class="fab fa-telegram"></i> Telegram';
      telegramBtn.onmouseover = () => telegramBtn.style.background = 'rgba(0, 136, 204, 1)';
      telegramBtn.onmouseout = () => telegramBtn.style.background = 'rgba(0, 136, 204, 0.9)';
      telegramBtn.onclick = async () => {
        try {
          const success = await sendToTelegram(imageUrl, mimeType || 'image/png', taskId, createdAt, '', imageId || null);
          telegramBtn.innerHTML = success ? '<i class="fas fa-check"></i> Sent!' : '<i class="fas fa-link"></i> URL Sent';
          setTimeout(() => {
            telegramBtn.innerHTML = '<i class="fab fa-telegram"></i> Telegram';
          }, 2000);
        } catch (err) {
          console.warn('Telegram failed:', err);
        }
      };
      actionOverlay.appendChild(telegramBtn);
    }

    if (settings.discordEnabled && settings.discordWebhook) {
      const discordBtn = document.createElement('button');
      discordBtn.style.cssText = `
        background: rgba(88, 101, 242, 0.9);
        color: var(--text-anti, #ffffff);
        border: none;
        border-radius: 28px;
        padding: 12px 24px;
        cursor: pointer;
        font-size: 14px;
        font-weight: 600;
        display: flex;
        align-items: center;
        gap: 8px;
        transition: all 0.3s;
      `;
      discordBtn.innerHTML = '<i class="fab fa-discord"></i> Discord';
      discordBtn.onmouseover = () => discordBtn.style.background = 'rgba(88, 101, 242, 1)';
      discordBtn.onmouseout = () => discordBtn.style.background = 'rgba(88, 101, 242, 0.9)';
      discordBtn.onclick = async () => {
        try {
          const success = await sendToDiscord(imageUrl, mimeType || 'image/png', taskId, createdAt, '', imageId || null);
          discordBtn.innerHTML = success ? '<i class="fas fa-check"></i> Sent!' : '<i class="fas fa-link"></i> URL Sent';
          setTimeout(() => {
            discordBtn.innerHTML = '<i class="fab fa-discord"></i> Discord';
          }, 2000);
        } catch (err) {
          console.warn('Discord failed:', err);
        }
      };
      actionOverlay.appendChild(discordBtn);
    }

    imageContainer.appendChild(actionOverlay);

    // Right side - Details panel
    const detailsContainer = document.createElement('div');
    detailsContainer.style.cssText = `
      width: 420px;
      overflow-y: auto;
      border-left: 1px solid var(--stroke-secondary, #475569);
      padding: 28px;
      background: var(--background-primary, #0f172a);
      color: var(--text-primary, #f1f5f9);
      display: flex;
      flex-direction: column;
      gap: 20px;
    `;

    const detailsHtml = `
      <div>
        <h2 style="font-size: 14px; color: var(--color-main, #6366f1); font-weight: 600; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 0.5px;">${isVideo ? 'Media Details' : 'Image Details'}</h2>
        <div style="border-radius: 8px; border: 1px solid var(--stroke-secondary, rgba(99, 102, 241, 0.2)); background: var(--fill-default, rgba(99, 102, 241, 0.05)); padding: 12px; font-size: 13px; line-height: 1.8; color: var(--text-secondary, #cbd5e1);">
          <div><strong>Task ID:</strong> <code style="background: #1e293b; padding: 4px 8px; border-radius: 4px; display: inline-block; margin-top: 2px;">${taskId || 'N/A'}</code></div>
          <div style="margin-top: 8px;"><strong>Created:</strong> ${createdAt ? new Date(normalizeTimestamp(createdAt)).toLocaleString() : 'N/A'}</div>
          <div style="margin-top: 8px;"><strong>Expires:</strong> ${expireAt ? new Date(normalizeTimestamp(expireAt)).toLocaleString() : 'N/A'}</div>
        </div>
      </div>
      
      <div>
        <h2 style="font-size: 14px; color: var(--color-main, #6366f1); font-weight: 600; margin: 0 0 12px 0; text-transform: uppercase; letter-spacing: 0.5px;">Image URL</h2>
        <div style="border-radius: 8px; border: 1px solid var(--stroke-secondary, rgba(99, 102, 241, 0.2)); background: var(--fill-default, rgba(99, 102, 241, 0.05)); padding: 12px; font-size: 11px; max-height: 100px; overflow-y: auto; word-break: break-all; font-family: 'Courier New', monospace; color: var(--text-secondary, #cbd5e1);">
          ${imageUrl}
        </div>
      </div>

      <div style="flex: 1;"></div>
      
      <div style="padding-top: 12px; border-top: 1px solid var(--stroke-secondary, #475569); font-size: 11px; color: var(--text-tertiary, #cbd5e1); text-align: center;">
        <i class="fas fa-shield-alt"></i> BypassInternet v1.0
      </div>
    `;
    detailsContainer.innerHTML = detailsHtml;

    // Close button
    const closeBtn = document.createElement('button');
    closeBtn.style.cssText = `
      position: absolute;
      top: 16px;
      right: 16px;
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.3);
      width: 44px;
      height: 44px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 101;
      transition: all 0.3s;
    `;
    closeBtn.innerHTML = '✕';
    closeBtn.onmouseover = () => {
      closeBtn.style.background = 'rgba(239, 68, 68, 0.3)';
    };
    closeBtn.onmouseout = () => {
      closeBtn.style.background = 'rgba(239, 68, 68, 0.2)';
    };
    closeBtn.onclick = () => {
      overlay.style.animation = 'modalOut 0.3s ease forwards';
      setTimeout(() => overlay.remove(), 300);
    };
    modal.appendChild(closeBtn);

    modal.appendChild(imageContainer);
    modal.appendChild(detailsContainer);
    overlay.appendChild(modal);

    // Close on overlay click
    overlay.onclick = (e) => {
      if (e.target === overlay) {
        overlay.style.animation = 'modalOut 0.3s ease forwards';
        setTimeout(() => overlay.remove(), 300);
      }
    };

    // Add animations
    const style = document.createElement('style');
    style.textContent = `
      @keyframes modalIn {
        from { opacity: 0; transform: scale(0.95); }
        to { opacity: 1; transform: scale(1); }
      }
      @keyframes modalOut {
        from { opacity: 1; transform: scale(1); }
        to { opacity: 0; transform: scale(0.95); }
      }
    `;
    overlay.appendChild(style);

    document.body.appendChild(overlay);
  }

  function isTemplateLikePage() {
    const href = window.location.href;
    return /template|workspace|workflow\/editor/i.test(href);
  }

  function startDomInjectionWatcher() {
    if (domInjectInterval) {
      clearInterval(domInjectInterval);
    }
    if (!settings.injectOnDom && !settings.safeViewMode && !isTemplateLikePage()) return;
    domInjectInterval = setInterval(() => {
      if (!settings.injectOnDom && !settings.safeViewMode && !isTemplateLikePage()) return;
      injectBlockedMediaIntoDom();
      injectCacheLoadButton();
    }, 500);
  }

  function stopDomInjectionWatcher() {
    if (domInjectInterval) {
      clearInterval(domInjectInterval);
      domInjectInterval = null;
    }
  }

  function recordTaskData(task) {
    if (!task) return;
    const taskId = task.taskId || '';
    const routeId = task.routeId || '';
    const taskData = {
      taskId,
      routeId,
      createdAt: task.createdAt || null,
      expireAt: task.expireAt || null,
      userId: task.userId || null,
      status: task.status || null,
      items: Array.isArray(task.items) ? task.items : []
    };

    if (taskId) taskMap.set(taskId, taskData);
    if (routeId) taskMap.set(routeId, taskData);

    taskData.items.forEach(item => {
      if (!item?.imageId) return;
      itemMap.set(item.imageId, {
        imageId: item.imageId,
        taskId,
        routeId,
        invalid: item.invalid,
        mimeType: item.mimeType,
        url: item.url,
        width: item.width,
        height: item.height,
        seed: item.seed,
        downloadFileName: item.downloadFileName
      });
    });
  }

  function extractTaskIdFromDetails(detailsBlock) {
    if (!detailsBlock) return null;
    const rows = Array.from(detailsBlock.querySelectorAll('div'));
    for (const row of rows) {
      if (row.textContent?.includes('Task ID')) {
        const spans = row.querySelectorAll('span');
        const idSpan = Array.from(spans).find(span => /\d{6,}/.test(span.textContent || ''));
        if (idSpan?.textContent) {
          return idSpan.textContent.trim();
        }
      }
    }
    return null;
  }

  function extractTaskIdFromHeaderText(text) {
    if (!text) return null;
    const match = text.match(/ID:\s*(\d{6,})/i);
    return match ? match[1] : null;
  }

  function resolveTaskData(taskId) {
    if (!taskId) return null;
    let taskData = taskMap.get(taskId);
    if (!taskData && taskId.length > 18) {
      const fallback = taskId.slice(0, 18);
      taskData = taskMap.get(fallback) || taskMap.get(taskId);
    }
    if (taskData) return taskData;

    // Fuzzy match against known keys (taskId/routeId)
    for (const [key, value] of taskMap.entries()) {
      if (!key) continue;
      if (taskId.startsWith(key) || key.startsWith(taskId)) {
        return value;
      }
    }

    return null;
  }

  async function ensureDownloadUrl(imageId) {
    if (!imageId) return null;
    
    // Check cache first
    if (settings.cachingEnabled && downloadUrlCache.has(imageId)) {
      const cached = downloadUrlCache.get(imageId);
      const timestamp = cacheTimestamps.get(imageId);
      const ageInDays = (Date.now() - timestamp) / (1000 * 60 * 60 * 24);
      if (ageInDays < settings.cacheDuration) {
        if (domInjectDebug) console.log('[Cache] Using cached URL for', imageId);
        return cached;
      }
    }
    
    if (downloadUrlCache.has(imageId)) return downloadUrlCache.get(imageId);
    try {
      const url = await downloadImage(imageId, false);
      downloadUrlCache.set(imageId, url);
      if (settings.cachingEnabled) {
        cacheTimestamps.set(imageId, Date.now());
      }
      return url;
    } catch (err) {
      console.warn('Failed to fetch download URL for', imageId, err);
      return null;
    }
  }

  async function sendToTelegram(mediaUrl, mediaType, taskId, createdAt, imageSize, imageId = null) {
    if (!settings.telegramEnabled || !settings.telegramToken || !settings.telegramChatId) {
      console.warn('[Telegram] Telegram not configured');
      return false;
    }

    try {
      const delayMs = Math.max(0, Number(settings.telegramDelaySeconds) || 0) * 1000;
      if (delayMs > 0) {
        await sleep(delayMs);
      }
      const message = buildTelegramCaption(taskId, createdAt, imageSize);
      const method = mediaType.startsWith('video/') ? 'sendVideo' : 'sendPhoto';
      const fileParam = mediaType.startsWith('video/') ? 'video' : 'photo';

      const response = await fetch(`https://api.telegram.org/bot${settings.telegramToken}/sendDocument`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: settings.telegramChatId,
          document: mediaUrl,
          caption: message,
          parse_mode: 'HTML'
        })
      });

      if (response.ok) {
        if (domInjectDebug) console.log('[Telegram] Media sent successfully');
        updateMediaStatus(imageId || taskId || mediaUrl, { telegram: true });
        if (imageId) {
          const meta = getItemMetaFromId(imageId);
          markTaskActionDone('telegram', imageId, 'done', meta);
        }
        return true;
      } else {
        if (domInjectDebug) console.warn('[Telegram] Send failed, trying URL');
        return false;
      }
    } catch (err) {
      console.warn('[Telegram] Error:', err);
      return false;
    }
  }

  function buildTelegramCaption(taskId, createdAt, imageSize) {
    let caption = '<b>BypassInternet 🛡️</b>\n\n';
    
    if (settings.telegramIncludeData.toolName) {
      caption += '🔧 <b>Tool:</b> FREEInternet-Bypass\n';
    }
    if (settings.telegramIncludeData.taskId && taskId) {
      caption += `📋 <b>Task ID:</b> <code>${taskId}</code>\n`;
    }
    if (settings.telegramIncludeData.date && createdAt) {
      const date = new Date(normalizeTimestamp(createdAt));
      caption += `📅 <b>Created:</b> ${date.toLocaleString()}\n`;
    }
    if (settings.telegramIncludeData.imageSize && imageSize) {
      caption += `📐 <b>Size:</b> ${imageSize}\n`;
    }
    
    return caption;
  }

  async function sendToDiscord(mediaUrl, mediaType, taskId, createdAt, imageSize, imageId = null) {
    if (!settings.discordEnabled || !settings.discordWebhook) {
      if (domInjectDebug) console.log('[Discord] Disabled or no webhook configured');
      return false;
    }

    try {
      const isVideo = mediaType === 'video' || (typeof mediaType === 'string' && mediaType.startsWith('video/'));
      const scriptName = remoteConfig?.script?.display_name || '🛡️ FreeInternet Bypass';
      const embed = {
        title: `${isVideo ? '🎬' : '🖼️'} Bypassed ${isVideo ? 'Video' : 'Image'}`,
        description: scriptName,
        color: 0x6366f1,
        fields: [],
        timestamp: new Date().toISOString(),
        footer: {
          text: 'FREEInternet-Bypass'
        }
      };

      if (taskId) {
        embed.fields.push({ name: '📋 Task ID', value: `\`${taskId}\``, inline: true });
      }
      if (createdAt) {
        const date = new Date(normalizeTimestamp(createdAt));
        embed.fields.push({ name: '📅 Created', value: date.toLocaleString(), inline: true });
      }
      if (imageSize) {
        embed.fields.push({ name: '📐 Size', value: imageSize, inline: true });
      }

      const payload = {
        embeds: [embed]
      };

      // Try to send the file directly
      const formData = new FormData();
      try {
        const mediaBlob = await fetch(mediaUrl).then(r => r.blob());
        const fileName = `bypass_${taskId || Date.now()}.${mediaType === 'video' ? 'mp4' : 'png'}`;
        formData.append('file', mediaBlob, fileName);
        formData.append('payload_json', JSON.stringify(payload));

        const response = await fetch(settings.discordWebhook, {
          method: 'POST',
          body: formData
        });

        if (response.ok) {
          if (domInjectDebug) console.log('[Discord] Media sent successfully');
          updateMediaStatus(imageId || taskId || mediaUrl, { discord: true });
          if (imageId) {
            const meta = getItemMetaFromId(imageId);
            markTaskActionDone('discord', imageId, 'done', meta);
          }
          return true;
        }
      } catch (err) {
        if (domInjectDebug) console.warn('[Discord] File upload failed, sending URL:', err);
      }

      // Fallback: send URL in embed
      embed.fields.push({ name: '🔗 Media URL', value: mediaUrl, inline: false });
      const response = await fetch(settings.discordWebhook, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (response.ok) {
        if (domInjectDebug) console.log('[Discord] URL sent successfully');
        updateMediaStatus(imageId || taskId || mediaUrl, { discord: true });
        if (imageId) {
          const meta = getItemMetaFromId(imageId);
          markTaskActionDone('discord', imageId, 'done', meta);
        }
        return true;
      } else {
        if (domInjectDebug) console.warn('[Discord] Send failed');
        return false;
      }
    } catch (err) {
      console.warn('[Discord] Error:', err);
      return false;
    }
  }

  function loadMediaStatus() {
    if (mediaStatusCache) return mediaStatusCache;
    try {
      mediaStatusCache = JSON.parse(localStorage.getItem(MEDIA_STATUS_KEY) || '{}');
    } catch {
      mediaStatusCache = {};
    }
    return mediaStatusCache;
  }

  function saveMediaStatus() {
    localStorage.setItem(MEDIA_STATUS_KEY, JSON.stringify(mediaStatusCache || {}));
  }

  function getMediaStatus(imageId) {
    const cache = loadMediaStatus();
    return cache[imageId] || {};
  }

  function updateMediaStatus(imageId, patch) {
    if (!imageId) return;
    const cache = loadMediaStatus();
    cache[imageId] = {
      ...cache[imageId],
      ...patch,
      updatedAt: Date.now()
    };
    saveMediaStatus();
    updateStatusOverlays(imageId);
    refreshActiveBlockedTooltip(imageId);
    updateItemStatusBadges(imageId);
    if (isExpanded) {
      updateHomeProgressUI();
      updateTasksTabUI();
      refreshSelectionUI();
    }
  }

  function updateItemStatusBadges(imageId) {
    const icons = renderStatusIcons(imageId);
    document.querySelectorAll(`[data-bypass-item-status="${imageId}"]`).forEach(el => {
      el.innerHTML = icons ? `<span style="font-weight: 600;">Status:</span> ${icons}` : '';
    });
    document.querySelectorAll(`[data-bypass-gallery-status="${imageId}"]`).forEach(el => {
      el.innerHTML = icons;
      el.style.display = icons ? 'flex' : 'none';
    });
  }

  function updateStatusOverlays(imageId) {
    const overlays = document.querySelectorAll(`[data-bypass-status-overlay][data-bypass-image-id="${imageId}"]`);
    if (!overlays.length) return;
    const icons = renderStatusIcons(imageId);
    overlays.forEach(overlay => {
      overlay.innerHTML = icons || '<i class="fas fa-circle" title="No status"></i>';
    });
  }

  function renderStatusIcons(imageId) {
    const status = getMediaStatus(imageId);
    const icons = [];
    if (status.downloaded) icons.push('<i class="fas fa-download" title="Downloaded"></i>');
    if (status.telegram) icons.push('<i class="fab fa-telegram" title="Sent to Telegram"></i>');
    if (status.discord) icons.push('<i class="fab fa-discord" title="Sent to Discord"></i>');
    if (status.telegramError || status.discordError || status.downloadError) {
      const msg = status.lastError ? `Error: ${status.lastError}` : 'Last action failed';
      icons.push(`<i class="fas fa-exclamation-triangle" title="${msg}"></i>`);
    }
    return icons.join('');
  }

  async function fetchRemoteConfig() {
    try {
      // Check cache first
      const cached = localStorage.getItem(CONFIG_CACHE_KEY);
      if (cached) {
        try {
          const cachedData = JSON.parse(cached);
          const cacheAge = Date.now() - (cachedData.timestamp || 0);
          const ttl = cachedData.config?.configuration?.cache?.ttl || CONFIG_CACHE_TTL;
          
          if (cacheAge < ttl) {
            console.log('[RemoteConfig] Using cached config (age:', Math.round(cacheAge / 1000), 's)');
            remoteConfig = cachedData.config;
            processAnnouncements(remoteConfig);
            processUpdates(remoteConfig);
            scheduleUIRefresh();
            return remoteConfig;
          }
        } catch (e) {
          console.warn('[RemoteConfig] Cache parse error:', e);
        }
      }

      // Fetch fresh config
      console.log('[RemoteConfig] Fetching from:', CONFIG_URL);
      const response = await originalFetch(CONFIG_URL);
      if (!response.ok) {
        console.warn('[RemoteConfig] Fetch failed:', response.status);
        return null;
      }
      const config = await response.json();
      remoteConfig = config;
      console.log('[RemoteConfig] Loaded:', config.script?.name, config.script?.version);
      
      // Cache the config
      if (config.configuration?.cache?.enabled !== false) {
        localStorage.setItem(CONFIG_CACHE_KEY, JSON.stringify({
          timestamp: Date.now(),
          config: config
        }));
        console.log('[RemoteConfig] Cached for', (config.configuration?.cache?.ttl || CONFIG_CACHE_TTL) / 1000, 'seconds');
      }
      
      // Process announcements and updates
      processAnnouncements(config);
      processUpdates(config);
      scheduleUIRefresh();
      
      // Apply remote feature flags if configured
      if (config.configuration?.remote_disable?.all) {
        console.warn('[RemoteConfig] Script disabled remotely!');
        showBlockingDialog('FREEInternet-Bypass has been disabled remotely. Please check for updates.', CONFIG_URL, true);
        return config;
      }
      
      return config;
    } catch (err) {
      console.warn('[RemoteConfig] Error fetching config:', err);
      return null;
    }
  }

  function scheduleUIRefresh() {
    if (uiRefreshTimer) clearTimeout(uiRefreshTimer);
    uiRefreshTimer = setTimeout(() => {
      if (isExpanded) {
        updateUI(true);
      }
    }, 120);
  }

  function showFeatureHubDialog() {
    const colors = getThemeColors();
    const overlayBg = settings.inheritTheme ? 'var(--mask-primary, rgba(0, 0, 0, 0.75))' : 'rgba(0, 0, 0, 0.75)';
    const dialogBg = settings.inheritTheme ? 'var(--background-primary, #0f172a)' : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
    const dialogBorder = settings.inheritTheme ? colors.border : 'rgba(99, 102, 241, 0.35)';

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: ${overlayBg};
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000000;
      backdrop-filter: blur(6px);
      animation: fadeIn 0.3s ease;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: ${dialogBg};
      border-radius: 16px;
      width: 92%;
      max-width: 720px;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.9);
      border: 1px solid ${dialogBorder};
      position: relative;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
      position: absolute;
      top: 14px;
      right: 14px;
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.3);
      width: 34px;
      height: 34px;
      border-radius: 50%;
      cursor: pointer;
    `;
    closeBtn.onclick = () => overlay.remove();

    const content = document.createElement('div');
    content.style.cssText = `padding: 28px; color: ${colors.text};`;

    const title = remoteConfig?.script?.display_name || 'FreeInternet';
    const features = remoteConfig?.features || [];

    content.innerHTML = `
      <div style="margin-bottom: 20px; text-align: center;">
        <h2 style="font-size: 20px; margin: 0 0 6px 0; color: #6366f1;"><i class="fas fa-shield-alt"></i> ${title}</h2>
        <p style="margin: 0; font-size: 13px; color: #94a3b8;">Feature overview and quick help</p>
      </div>
    `;

    if (features.length) {
      const list = document.createElement('div');
      list.style.cssText = 'display: grid; gap: 12px;';
      features.forEach(feature => {
        const card = document.createElement('div');
        card.style.cssText = 'padding: 12px; border-radius: 10px; background: rgba(99, 102, 241, 0.06); border: 1px solid rgba(99, 102, 241, 0.2);';
        card.innerHTML = `
          <div style="font-weight: 600; font-size: 13px; color: #f1f5f9; margin-bottom: 6px;">
            <i class="fas fa-star" style="color: #6366f1; margin-right: 6px;"></i>${feature.title}
          </div>
          <div style="font-size: 12px; color: #cbd5e1;">${feature.description || ''}</div>
        `;
        list.appendChild(card);
      });
      content.appendChild(list);
    } else {
      const empty = document.createElement('div');
      empty.style.cssText = 'text-align: center; color: #94a3b8; font-size: 12px;';
      empty.textContent = 'Features will appear here when remote config is available.';
      content.appendChild(empty);
    }

    dialog.appendChild(closeBtn);
    dialog.appendChild(content);
    overlay.appendChild(dialog);
    overlay.onclick = (e) => {
      if (e.target === overlay) overlay.remove();
    };
    document.body.appendChild(overlay);
  }

  function injectProfileMenuItem() {
    const menu = document.querySelector('div.flex.flex-col.flex-1.overflow-y-auto.max-h-80vh.scroll-bar-base');
    if (!menu) return false;

    if (menu.querySelector('[data-bypass-profile-menu]')) return true;

    const item = document.createElement('div');
    item.setAttribute('data-bypass-profile-menu', 'true');
    item.className = 'flex items-center text-14 lh-20 fw-500 h-40 px-12 hover:opacity-[60%] gap-12 c-text-primary cursor-pointer';
    item.innerHTML = '<i class="fas fa-shield-alt" style="font-size: 16px;"></i><span>FreeInternet</span>';
    item.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      showFeatureHubDialog();
    };

    const settingsLink = menu.querySelector('a[href="/settings"]');
    const settingsRow = settingsLink?.closest('div.flex.items-center');
    if (settingsRow && settingsRow.parentElement) {
      settingsRow.parentElement.insertBefore(item, settingsRow);
    } else {
      menu.appendChild(item);
    }
    return true;
  }

  function startProfileMenuWatcher() {
    if (profileMenuObserver || profileMenuInterval) return;
    profileMenuObserver = new MutationObserver(() => {
      injectProfileMenuItem();
    });
    profileMenuObserver.observe(document.body, { childList: true, subtree: true });
    profileMenuInterval = setInterval(() => {
      injectProfileMenuItem();
    }, 250);
  }

  function compareVersions(v1, v2) {
    // Simple semver comparison (returns 1 if v1 > v2, -1 if v1 < v2, 0 if equal)
    const parts1 = v1.replace(/[^0-9.]/g, '').split('.').map(Number);
    const parts2 = v2.replace(/[^0-9.]/g, '').split('.').map(Number);
    
    for (let i = 0; i < Math.max(parts1.length, parts2.length); i++) {
      const p1 = parts1[i] || 0;
      const p2 = parts2[i] || 0;
      if (p1 > p2) return 1;
      if (p1 < p2) return -1;
    }
    return 0;
  }

  function processUpdates(config) {
    if (!config?.updates || !Array.isArray(config.updates)) return;
    
    // Find applicable update
    for (const update of config.updates) {
      if (!update.version) continue;
      
      // Compare versions
      if (update.version === SCRIPT_VERSION) {
        // Same version, no update needed
        continue;
      }
      
      // Check if this update is for a newer version
      const isNewer = compareVersions(update.version, SCRIPT_VERSION) > 0;
      if (!isNewer) continue;
      
      console.log('[Update] New version available:', update.version, 'Current:', SCRIPT_VERSION);
      
      if (update.required && update.injection?.block_usage) {
        // Critical update - block all functionality
        showUpdateDialog(update, true);
        
        // Disable core functionality
        stopAutoCheck();
        stopDomInjectionWatcher();
        stopTaskMonitoring();
        
        return; // Stop processing other updates
      } else {
        // Optional update - show notification
        showUpdateNotification(update);
      }
      
      break; // Only process first applicable update
    }
  }

  function showUpdateDialog(update, blocking = false) {
    const colors = getThemeColors();
    const overlayBg = settings.inheritTheme ? `var(--mask-primary, rgba(0, 0, 0, ${blocking ? '0.95' : '0.85'}))` : `rgba(0, 0, 0, ${blocking ? '0.95' : '0.85'})`;
    const dialogBg = settings.inheritTheme ? 'var(--background-primary, #0f172a)' : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
    const dialogBorder = settings.inheritTheme ? colors.border : (blocking ? '#ef4444' : '#6366f1');

    const overlay = document.createElement('div');
    overlay.id = 'bypass-update-dialog';
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: ${overlayBg};
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999999;
      backdrop-filter: blur(10px);
      animation: fadeIn 0.3s ease;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: ${dialogBg};
      border-radius: 16px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.9), 0 0 0 2px ${dialogBorder};
      position: relative;
      animation: slideUp 0.4s ease;
    `;

    const content = document.createElement('div');
    content.innerHTML = update.message?.html || `<div style="padding: 20px; text-align: center;"><h2>${update.title}</h2><p>${update.message?.text || 'Update available'}</p></div>`;

    dialog.appendChild(content);

    // Add update button
    const buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = 'padding: 0 24px 24px 24px; display: flex; gap: 12px; justify-content: center;';
    
    const updateBtn = document.createElement('a');
    updateBtn.href = update.download_url || CONFIG_URL;
    updateBtn.target = '_blank';
    updateBtn.innerHTML = blocking ? '⚠️ Update Now (Required)' : '📥 Download Update';
    updateBtn.style.cssText = `
      background: ${blocking ? 'linear-gradient(135deg, #ef4444 0%, #dc2626 100%)' : 'linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)'};
      color: white;
      padding: 14px 28px;
      border-radius: 8px;
      text-decoration: none;
      font-size: 15px;
      font-weight: 600;
      transition: all 0.3s;
      display: inline-block;
    `;
    updateBtn.onmouseover = () => updateBtn.style.transform = 'translateY(-2px)';
    updateBtn.onmouseout = () => updateBtn.style.transform = 'translateY(0)';
    buttonContainer.appendChild(updateBtn);

    if (!blocking) {
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '✕ Later';
      closeBtn.style.cssText = `
        background: rgba(255, 255, 255, 0.1);
        color: #cbd5e1;
        padding: 14px 28px;
        border: 1px solid rgba(255, 255, 255, 0.2);
        border-radius: 8px;
        cursor: pointer;
        font-size: 15px;
        font-weight: 600;
        transition: all 0.3s;
      `;
      closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.15)';
      closeBtn.onmouseout = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.1)';
      closeBtn.onclick = () => document.body.removeChild(overlay);
      buttonContainer.appendChild(closeBtn);
    }

    dialog.appendChild(buttonContainer);
    overlay.appendChild(dialog);

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(30px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    overlay.appendChild(style);

    document.body.appendChild(overlay);

    if (blocking) {
      // Prevent closing for critical updates
      overlay.onclick = (e) => e.stopPropagation();
    }
  }

  function showUpdateNotification(update) {
    if (!update.injection) return;

    // Check if user dismissed this version
    const dismissedKey = `freeBypassDismissedUpdate_${update.version}`;
    if (localStorage.getItem(dismissedKey)) return;

    if (update.injection.dialog_enabled) {
      showUpdateDialog(update, false);
      return;
    }

    if (update.injection.banner_enabled && update.injection.targets?.length > 0) {
      // Inject into page using dynamic selectors
      const currentUrl = window.location.href;
      
      for (const target of update.injection.targets) {
        // Check if we're on the right page
        if (target.page_pattern && !new RegExp(target.page_pattern).test(currentUrl)) {
          continue;
        }

        const targetEl = document.querySelector(target.selector);
        if (!targetEl) continue;

        const banner = document.createElement('div');
        banner.className = 'bypass-update-banner';
        banner.style.cssText = `
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          padding: 16px 20px;
          border-radius: 12px;
          box-shadow: 0 4px 12px rgba(99, 102, 241, 0.4);
          position: relative;
          ${target.style || ''}
        `;

        const contentDiv = document.createElement('div');
        contentDiv.innerHTML = update.message?.html || `<div style="color: white;"><strong>${update.title}</strong></div>`;
        banner.appendChild(contentDiv);

        // Add close button
        const closeBtn = document.createElement('button');
        closeBtn.innerHTML = '✕';
        closeBtn.style.cssText = `
          position: absolute;
          top: 12px;
          right: 12px;
          background: rgba(255, 255, 255, 0.2);
          color: white;
          border: none;
          width: 24px;
          height: 24px;
          border-radius: 50%;
          cursor: pointer;
          font-size: 14px;
          transition: all 0.3s;
        `;
        closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.3)';
        closeBtn.onmouseout = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
        closeBtn.onclick = () => {
          banner.remove();
          localStorage.setItem(dismissedKey, 'true');
        };
        banner.appendChild(closeBtn);

        // Add update link
        const updateLink = document.createElement('a');
        updateLink.href = update.download_url || CONFIG_URL;
        updateLink.target = '_blank';
        updateLink.innerHTML = '📥 Update Now';
        updateLink.style.cssText = `
          display: inline-block;
          margin-top: 12px;
          padding: 8px 16px;
          background: white;
          color: #6366f1;
          border-radius: 6px;
          text-decoration: none;
          font-weight: 600;
          font-size: 13px;
          transition: all 0.3s;
        `;
        updateLink.onmouseover = () => updateLink.style.transform = 'translateY(-2px)';
        updateLink.onmouseout = () => updateLink.style.transform = 'translateY(0)';
        contentDiv.appendChild(updateLink);

        // Insert based on position
        if (target.position === 'prepend' || target.position === 'afterbegin') {
          targetEl.insertBefore(banner, targetEl.firstChild);
        } else {
          targetEl.appendChild(banner);
        }

        break; // Only inject once
      }
    }
  }

  function showBlockingDialog(message, linkUrl = null, isError = false) {
    const colors = getThemeColors();
    const overlayBg = settings.inheritTheme ? 'var(--mask-primary, rgba(0, 0, 0, 0.95))' : 'rgba(0, 0, 0, 0.95)';
    const dialogBg = settings.inheritTheme ? 'var(--background-primary, #0f172a)' : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
    const dialogBorder = settings.inheritTheme ? colors.border : (isError ? '#ef4444' : '#6366f1');

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: ${overlayBg};
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 99999999;
      backdrop-filter: blur(10px);
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: ${dialogBg};
      border-radius: 16px;
      padding: 40px;
      max-width: 500px;
      text-align: center;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.9), 0 0 0 2px ${dialogBorder};
    `;

    dialog.innerHTML = `
      <div style="font-size: 48px; margin-bottom: 20px;">${isError ? '⚠️' : '🛡️'}</div>
      <h2 style="color: ${isError ? '#ef4444' : colors.primary}; margin-bottom: 16px; font-size: 20px;">${isError ? 'Action Required' : 'Notice'}</h2>
      <p style="color: ${colors.textSecondary}; line-height: 1.8; margin-bottom: 24px;">${message}</p>
    `;

    if (linkUrl) {
      const link = document.createElement('a');
      link.href = linkUrl;
      link.target = '_blank';
      link.innerHTML = 'Learn More';
      link.style.cssText = `
        display: inline-block;
        background: linear-gradient(135deg, ${colors.primary} 0%, ${colors.primaryHover} 100%);
        color: white;
        padding: 12px 24px;
        border-radius: 8px;
        text-decoration: none;
        font-weight: 600;
      `;
      dialog.appendChild(link);
    }

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  function processAnnouncements(config) {
    if (!config?.announcements) return;
    
    for (const announcement of config.announcements) {
      if (announcement.status !== 'published') continue;
      if (announcement.show_once && shownAnnouncements.has(announcement.id)) continue;
      
      // Display based on type
      if (announcement.type === 'dialog' && announcement.display_type === 'modal') {
        showAnnouncementDialog(announcement);
      } else if (announcement.type === 'header' && announcement.display_type === 'banner') {
        showAnnouncementBanner(announcement);
      }
      
      // Mark as shown
      if (announcement.show_once) {
        shownAnnouncements.add(announcement.id);
        localStorage.setItem('freeBypassShownAnnouncements', JSON.stringify([...shownAnnouncements]));
      }
    }
  }

  function showAnnouncementDialog(announcement) {
    const colors = getThemeColors();
    const overlayBg = settings.inheritTheme ? 'var(--mask-primary, rgba(0, 0, 0, 0.85))' : 'rgba(0, 0, 0, 0.85)';
    const dialogBg = settings.inheritTheme ? 'var(--background-primary, #0f172a)' : 'linear-gradient(135deg, #0f172a 0%, #1e293b 100%)';
    const dialogBorder = settings.inheritTheme ? colors.border : 'rgba(99, 102, 241, 0.3)';

    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: ${overlayBg};
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 9999999;
      backdrop-filter: blur(8px);
      animation: fadeIn 0.3s ease;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: ${dialogBg};
      border-radius: 16px;
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      box-shadow: 0 25px 80px rgba(0, 0, 0, 0.9), 0 0 0 1px ${dialogBorder};
      position: relative;
      animation: slideUp 0.4s ease;
    `;

    const closeBtn = document.createElement('button');
    closeBtn.innerHTML = '✕';
    closeBtn.style.cssText = `
      position: absolute;
      top: 16px;
      right: 16px;
      background: rgba(239, 68, 68, 0.2);
      color: #ef4444;
      border: 1px solid rgba(239, 68, 68, 0.3);
      width: 36px;
      height: 36px;
      border-radius: 50%;
      cursor: pointer;
      font-size: 18px;
      z-index: 10;
      transition: all 0.3s;
    `;
    closeBtn.onmouseover = () => {
      closeBtn.style.background = 'rgba(239, 68, 68, 0.4)';
      closeBtn.style.transform = 'scale(1.1)';
    };
    closeBtn.onmouseout = () => {
      closeBtn.style.background = 'rgba(239, 68, 68, 0.2)';
      closeBtn.style.transform = 'scale(1)';
    };
    closeBtn.onclick = () => document.body.removeChild(overlay);

    const content = document.createElement('div');
    content.style.padding = '40px 32px';
    content.innerHTML = announcement.content.html || `<p>${announcement.content.text}</p>`;

    dialog.appendChild(closeBtn);
    dialog.appendChild(content);

    if (announcement.links && announcement.links.length > 0) {
      const linksContainer = document.createElement('div');
      linksContainer.style.cssText = `
        padding: 0 32px 32px 32px;
        display: flex;
        gap: 12px;
        flex-wrap: wrap;
      `;
      
      for (const link of announcement.links) {
        const linkBtn = document.createElement('a');
        linkBtn.href = link.url;
        linkBtn.target = '_blank';
        linkBtn.innerHTML = `${link.icon ? `<i class="${link.icon}"></i> ` : ''}${link.label}`;
        linkBtn.style.cssText = `
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
          color: white;
          padding: 10px 20px;
          border-radius: 8px;
          text-decoration: none;
          font-size: 14px;
          font-weight: 600;
          transition: all 0.3s;
          display: inline-flex;
          align-items: center;
          gap: 8px;
        `;
        linkBtn.onmouseover = () => linkBtn.style.transform = 'translateY(-2px)';
        linkBtn.onmouseout = () => linkBtn.style.transform = 'translateY(0)';
        linksContainer.appendChild(linkBtn);
      }
      
      dialog.appendChild(linksContainer);
    }

    overlay.appendChild(dialog);
    
    if (announcement.injection?.dismissible !== false) {
      overlay.onclick = (e) => {
        if (e.target === overlay) document.body.removeChild(overlay);
      };
    }

    const style = document.createElement('style');
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideUp {
        from { opacity: 0; transform: translateY(30px); }
        to { opacity: 1; transform: translateY(0); }
      }
    `;
    overlay.appendChild(style);

    document.body.appendChild(overlay);
  }

  function showAnnouncementBanner(announcement) {
    const banner = document.createElement('div');
    banner.id = `announcement-banner-${announcement.id}`;
    banner.innerHTML = announcement.content.html || `<strong>${announcement.title}</strong>: ${announcement.content.text}`;
    
    const baseStyle = announcement.injection?.style || '';
    banner.style.cssText = baseStyle + (baseStyle ? '; ' : '') + `
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      z-index: 999998;
      animation: slideDown 0.5s ease;
    `;

    if (announcement.injection?.dismissible !== false) {
      const closeBtn = document.createElement('button');
      closeBtn.innerHTML = '✕';
      closeBtn.style.cssText = `
        position: absolute;
        top: 50%;
        right: 20px;
        transform: translateY(-50%);
        background: rgba(255, 255, 255, 0.2);
        color: white;
        border: none;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        cursor: pointer;
        font-size: 16px;
        transition: all 0.3s;
      `;
      closeBtn.onmouseover = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.3)';
      closeBtn.onmouseout = () => closeBtn.style.background = 'rgba(255, 255, 255, 0.2)';
      closeBtn.onclick = () => document.body.removeChild(banner);
      banner.appendChild(closeBtn);
    }

    const style = document.createElement('style');
    style.textContent = `
      @keyframes slideDown {
        from { transform: translateY(-100%); }
        to { transform: translateY(0); }
      }
    `;
    banner.appendChild(style);

    const target = announcement.injection?.selector ? document.querySelector(announcement.injection.selector) : document.body;
    const position = announcement.injection?.position || 'prepend';
    
    if (position === 'prepend') {
      target.insertBefore(banner, target.firstChild);
    } else {
      target.appendChild(banner);
    }

    if (announcement.injection?.auto_hide_after) {
      setTimeout(() => {
        if (banner.parentElement) {
          banner.style.animation = 'slideUp 0.5s ease';
          setTimeout(() => {
            if (banner.parentElement) document.body.removeChild(banner);
          }, 500);
        }
      }, announcement.injection.auto_hide_after);
    }
  }

  function startTaskMonitoring() {
    if (taskMonitorInterval || !settings.autoTaskDetection) return;
    
    taskMonitorInterval = setInterval(async () => {
      if (pendingTasks.size === 0) return;
      
      const taskIds = Array.from(pendingTasks.keys());
      if (taskIds.length === 0) return;
      
      // We'll intercept mget_task naturally through fetch override
      // This interval just ensures we track timing
      for (const [taskId, taskInfo] of pendingTasks.entries()) {
        if (Date.now() - taskInfo.startTime > 300000) { // 5 minutes timeout
          if (domInjectDebug) console.log(`[TaskMonitor] Removing stale task ${taskId}`);
          pendingTasks.delete(taskId);
        }
      }
    }, 2000);
  }

  function stopTaskMonitoring() {
    if (taskMonitorInterval) {
      clearInterval(taskMonitorInterval);
      taskMonitorInterval = null;
    }
  }

  function handleTasksResponse(body, sourceLabel) {
    if (!body?.data?.tasks?.length) return;

    cacheTasks(body.data.tasks);

    mergeTasksIntoItems(body.data.tasks, sourceLabel, { autoShow: settings.autoShowPanel, updateUIAfter: true });
  }

  async function injectBlockedMediaIntoDom(options = {}) {
    const { forceBypass = false } = options;
    const safeViewEnabled = settings.safeViewMode && !forceBypass;
    const bypassDeferVideo = !forceBypass;
    const rootCandidates = [
      document.querySelector('div.h-full.overflow-y-auto.pt-12.px-16.scroll-bar-base.bg-bg-on-primary'),
      document.querySelector('div.h-full.flex.flex-col.overflow-y-auto.scroll-bar-base'),
      document.querySelector('div.mt-24.overflow-x-hidden.overflow-y-auto.flex-1'),
      document.querySelector('div.overflow-y-auto.flex-1'),
      document.querySelector('div.border-stroke-secondary.border-1.rd-12.max-h-full.flex-1.flex.flex-col.overflow-hidden'),
      document.querySelector('div.flex.flex-col.gap-24.my-20.px-12')
    ].filter(Boolean);

    const roots = [];
    for (const candidate of rootCandidates) {
      if (!roots.includes(candidate)) roots.push(candidate);
    }

    if (!roots.length) {
      if (domInjectDebug) console.warn('[InjectDOM] Root container not found');
      return;
    }

    // Helper function to add Telegram section
    const addTelegramSection = (slot, itemImageId, taskId, createdAt) => {
      if (!settings.telegramEnabled || !settings.telegramChatId) return;
      
      let telegramSection = slot.querySelector('[data-bypass-telegram-section]');
      if (telegramSection) return; // Already added
      
      telegramSection = document.createElement('div');
      telegramSection.setAttribute('data-bypass-telegram-section', 'true');
      telegramSection.style.cssText = `
        margin-top: 12px;
        padding: 12px;
        background: linear-gradient(135deg, rgba(0, 136, 204, 0.1), rgba(0, 136, 204, 0.05));
        border: 1px solid rgba(0, 136, 204, 0.3);
        border-radius: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      
      const label = document.createElement('span');
      label.style.cssText = `
        font-size: 12px;
        font-weight: 600;
        color: #0088cc;
        flex: 1;
      `;
      label.innerHTML = '<i class="fab fa-telegram"></i> Send to Telegram';
      
      const button = document.createElement('button');
      button.style.cssText = `
        background: linear-gradient(135deg, #0088cc, #005fa3);
        color: white;
        border: none;
        padding: 6px 12px;
        border-radius: 6px;
        cursor: pointer;
        font-size: 12px;
        font-weight: 600;
        transition: all 0.3s ease;
      `;
      button.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
      button.onmouseover = () => {
        button.style.transform = 'translateY(-2px)';
        button.style.boxShadow = '0 6px 16px rgba(0, 136, 204, 0.4)';
      };
      button.onmouseout = () => {
        button.style.transform = 'translateY(0)';
        button.style.boxShadow = 'none';
      };
      button.onclick = async () => {
        button.disabled = true;
        button.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
        try {
          const downloadUrl = await ensureDownloadUrl(itemImageId);
          if (downloadUrl) {
            const success = await sendToTelegram(downloadUrl, 'image/jpeg', taskId, createdAt, '', itemImageId);
            alert(success ? '✅ Sent to Telegram!' : '⚠️ Failed to send');
          }
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
        button.disabled = false;
        button.innerHTML = '<i class="fas fa-paper-plane"></i> Send';
      };
      
      telegramSection.appendChild(label);
      telegramSection.appendChild(button);
      slot.appendChild(telegramSection);

      attachInjectedHelpTooltip(button, 'Send this blocked media to your Telegram chat.');
    };

    const addStatusOverlay = (slot, imageId) => {
      if (!slot || !imageId) return;
      const existing = slot.querySelector('[data-bypass-status-overlay]');
      if (existing) return;

      slot.classList.add('bypass-status-wrap');
      const overlay = document.createElement('div');
      overlay.className = 'bypass-status-overlay';
      overlay.setAttribute('data-bypass-status-overlay', 'true');
      overlay.setAttribute('data-bypass-image-id', imageId);

      const icons = renderStatusIcons(imageId);
      overlay.innerHTML = icons || '<i class="fas fa-circle" title="No status"></i>';

      slot.appendChild(overlay);
    };

    const getTensorButtonClass = (type = 'primary') => {
      const anySiteBtn = document.querySelector('button.n-button');
      const baseClass = (anySiteBtn && anySiteBtn.className) || '__button-dark-njtao5-blmme n-button n-button--medium-type n-button--ghost';
      const cleaned = baseClass
        .split(/\s+/)
        .filter(Boolean)
        .filter(c => !/^n-button--(primary|success|warning|error|info)-type$/.test(c))
        .join(' ');
      return `${cleaned} n-button--${type}-type`;
    };

    const findTaskIdForContainer = (container) => {
      if (!container) return null;
      const direct = container.getAttribute('data-bypass-task-id');
      if (direct) return direct;

      const ancestors = [
        container.closest('div.min-h-100'),
        container.closest('div.bg-bg-primary'),
        container.closest('section'),
        container.parentElement
      ].filter(Boolean);

      for (const root of ancestors) {
        const header = root.querySelector('h3.c-text-secondary');
        const headerId = extractTaskIdFromHeaderText(header?.textContent || '');
        if (headerId) return headerId;

        const textNodes = root.querySelectorAll('h3, h4, span, div, p');
        for (const node of textNodes) {
          const text = node?.textContent || '';
          if (!text.includes('ID:')) continue;
          const id = extractTaskIdFromHeaderText(text);
          if (id) return id;
        }
      }

      return null;
    };

    const addTaskCompactActionsPanel = (anchorEl, taskData, taskId, insertBeforeEl = null) => {
      if (!anchorEl) return false;
      const key = taskData?.taskId || taskId || '';
      const existing = anchorEl.querySelector(`[data-bypass-task-actions="${key}"]`);
      if (existing) return true;

      const panel = document.createElement('div');
      panel.className = 'space-y-4 bg-fill-default px-12 py-8 rd-8';
      panel.setAttribute('data-bypass-task-actions', key);

      const header = document.createElement('div');
      header.className = 'flex-c-sb';
      const title = document.createElement('h3');
      title.className = 'text-16 c-text-primary fw-600';
      title.innerHTML = '<i class="fas fa-layer-group" style="margin-right: 6px;"></i> Task Actions';
      const statusWrap = document.createElement('div');
      statusWrap.className = 'flex-c gap-4';
      const statusText = document.createElement('span');
      statusText.className = 'text-12 c-text-tertiary';
      statusText.setAttribute('data-bypass-task-action-status', key);
      statusText.textContent = 'Ready';
      statusWrap.appendChild(statusText);
      header.appendChild(title);
      header.appendChild(statusWrap);

      const actionsRow = document.createElement('div');
      actionsRow.className = 'flex-c gap-8';

      const invalidItems = Array.isArray(taskData?.items) ? taskData.items.filter(item => item?.invalid && item?.imageId) : [];
      const allItems = Array.isArray(taskData?.items) ? taskData.items.filter(item => item?.imageId && (item.mimeType?.startsWith('image/') || item.mimeType?.startsWith('video/'))) : [];

      const enqueueItems = (items, action) => {
        const allowDuplicate = !settings.preventDuplicateTasks;
        items.forEach(item => enqueueTaskAction(action, item.imageId, getItemMetaFromId(item.imageId), allowDuplicate));
        processTaskActionQueue();
        updateGlobalActionProgressFromQueue();
        updateTaskActionPanelsStatus();
      };

      const makeIconBtn = (icon, title, onClick, onRightClick) => {
        const btn = document.createElement('button');
        btn.className = 'text-14 b-1-stroke-secondary rd-8 fw-600 px-8 py-4 cursor-pointer';
        btn.style.cssText = 'display:flex; align-items:center; justify-content:center; width:40px; height:40px;';
        btn.title = title;
        btn.innerHTML = `<i class="${icon}"></i>`;
        btn.onclick = (e) => {
          e.stopPropagation();
          onClick();
        };
        btn.addEventListener('contextmenu', (e) => {
          if (!onRightClick) return;
          e.preventDefault();
          e.stopPropagation();
          onRightClick();
        });
        attachInjectedHelpTooltip(btn, title);
        return btn;
      };

      if (settings.telegramEnabled && settings.telegramChatId) {
        actionsRow.appendChild(makeIconBtn('fab fa-telegram', 'Send all to Telegram', () => enqueueItems(allItems, 'telegram'), () => enqueueItems(invalidItems, 'telegram')));
      }
      if (settings.discordEnabled && settings.discordWebhook) {
        actionsRow.appendChild(makeIconBtn('fab fa-discord', 'Send all to Discord', () => enqueueItems(allItems, 'discord'), () => enqueueItems(invalidItems, 'discord')));
      }
      actionsRow.appendChild(makeIconBtn('fas fa-download', 'Download all', () => enqueueItems(allItems, 'download'), () => enqueueItems(invalidItems, 'download')));

      const safeViewBtn = makeIconBtn('fas fa-eye', 'Safe View (reveal all)', async () => {
        const panelRoot = anchorEl.closest('div.bg-bg-primary') || anchorEl;
        const spaceContainer = panelRoot.querySelector('div.space-y-12')
          || panelRoot.querySelector('div.mt-12.flex.flex-wrap.gap-12')
          || panelRoot;
        const mediaSlots = getMediaSlots(spaceContainer);
        const blockedSlots = mediaSlots.filter(slot => isBlockedSlot(slot, true));
        for (let i = 0; i < Math.min(blockedSlots.length, invalidItems.length); i++) {
          await injectItemIntoSlot(blockedSlots[i], invalidItems[i], taskData, taskId, { deferVideo: false });
        }
      });
      safeViewBtn.addEventListener('mouseenter', hideActiveBlockedTooltip);
      safeViewBtn.addEventListener('click', hideActiveBlockedTooltip);
      actionsRow.appendChild(safeViewBtn);

      panel.appendChild(header);
      panel.appendChild(actionsRow);

      if (insertBeforeEl && insertBeforeEl.parentElement) {
        insertBeforeEl.parentElement.insertBefore(panel, insertBeforeEl);
      } else {
        anchorEl.appendChild(panel);
      }
      updateTaskActionPanelsStatus();
      return true;
    };

    const addTaskTelegramPanel = (anchorEl, taskData, taskId, insertBeforeEl = null) => {
      if (isTemplateLikePage()) {
        addTaskCompactActionsPanel(anchorEl, taskData, taskId, insertBeforeEl);
        return;
      }
      if (!settings.telegramEnabled || !settings.telegramChatId || !settings.telegramToken) return;
      if (!anchorEl) return;

      const key = taskData?.taskId || taskId || '';
      const existing = anchorEl.querySelector(`[data-bypass-task-telegram="${key}"]`);
      if (existing) return;

      const panel = document.createElement('div');
      panel.className = 'space-y-4 bg-fill-default px-12 py-8 rd-8';
      panel.setAttribute('data-bypass-task-telegram', key);

      const header = document.createElement('div');
      header.className = 'flex-c-sb';
      header.innerHTML = `
        <h3 class="text-16 c-text-primary fw-600"><i class="fab fa-telegram" style="margin-right: 6px;"></i> Telegram</h3>
        <div class="flex-c gap-4"><span class="text-12 c-text-tertiary">Send all media for this task</span></div>
      `;

      const statusRow = document.createElement('div');
      statusRow.className = 'flex-c gap-8';
      statusRow.style.justifyContent = 'space-between';
      statusRow.style.alignItems = 'center';

      const statusText = document.createElement('div');
      statusText.className = 'text-12 c-text-tertiary';
      statusText.textContent = 'Ready to send.';

      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.tabIndex = 0;
      retryBtn.className = getTensorButtonClass('warning');
      retryBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; display: none;';
      retryBtn.innerHTML = `
        <span class="n-button__content"><i class="fas fa-redo" style="margin-right: 6px;"></i> Retry failed</span>
        <div aria-hidden="true" class="n-base-wave"></div>
        <div aria-hidden="true" class="n-button__border"></div>
        <div aria-hidden="true" class="n-button__state-border"></div>
      `;

      statusRow.appendChild(statusText);
      statusRow.appendChild(retryBtn);

      const toggleRow = document.createElement('label');
      toggleRow.className = 'flex-c gap-8 text-12 c-text-tertiary';
      toggleRow.style.cursor = 'pointer';
      const onlyBlockedInput = document.createElement('input');
      onlyBlockedInput.type = 'checkbox';
      onlyBlockedInput.style.cssText = 'cursor: pointer; width: 16px; height: 16px;';
      toggleRow.appendChild(onlyBlockedInput);
      toggleRow.appendChild(document.createTextNode('Send only blocked items'));

      const list = document.createElement('div');
      list.className = 'space-y-4';
      list.style.display = 'none';

      const buttonRow = document.createElement('div');
      buttonRow.className = 'flex-c gap-8';

      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.tabIndex = 0;
      sendBtn.className = getTensorButtonClass('default');
      sendBtn.innerHTML = `
        <span class="n-button__content"><i class="fas fa-paper-plane" style="margin-right: 6px;"></i> Send all to Telegram</span>
        <div aria-hidden="true" class="n-base-wave"></div>
        <div aria-hidden="true" class="n-button__border"></div>
        <div aria-hidden="true" class="n-button__state-border"></div>
      `;

      const rowMap = new Map();
      let lastFailedItems = [];

      const ensureRow = (item) => {
        if (!item?.imageId) return null;
        let row = rowMap.get(item.imageId);
        if (row) return row;

        row = document.createElement('div');
        row.className = 'flex-c-sb';

        const left = document.createElement('div');
        left.className = 'flex-c gap-6';
        const idText = document.createElement('span');
        idText.className = 'text-12 c-text-secondary';
        idText.textContent = item.imageId;
        const typeText = document.createElement('span');
        typeText.className = 'text-12 c-text-tertiary';
        typeText.textContent = item.mimeType?.startsWith('video/') ? 'Video' : 'Image';
        left.appendChild(idText);
        left.appendChild(typeText);

        const statusBadge = document.createElement('span');
        statusBadge.className = 'text-12 c-text-tertiary';
        statusBadge.textContent = 'Queued';

        row.appendChild(left);
        row.appendChild(statusBadge);
        list.appendChild(row);
        rowMap.set(item.imageId, statusBadge);
        return statusBadge;
      };

      const setRowStatus = (itemId, text) => {
        const badge = rowMap.get(itemId);
        if (badge) badge.textContent = text;
      };

      const buildCandidates = () => {
        const items = Array.isArray(taskData?.items) ? taskData.items : [];
        let mediaItems = items.filter(item => item?.imageId && (item.mimeType?.startsWith('image/') || item.mimeType?.startsWith('video/')));
        if (onlyBlockedInput.checked) {
          mediaItems = mediaItems.filter(item => item?.invalid === true);
        }
        return mediaItems;
      };

      const sendItems = async (itemsToSend, isRetry = false) => {
        const unique = [];
        const seen = new Set();
        for (const item of itemsToSend) {
          if (!item?.imageId || seen.has(item.imageId)) continue;
          seen.add(item.imageId);
          unique.push(item);
        }

        if (!unique.length) {
          statusText.textContent = 'No media found for this task.';
          return;
        }

        list.style.display = 'block';
        if (!isRetry || rowMap.size === 0) {
          list.innerHTML = '';
          rowMap.clear();
        }

        unique.forEach(item => ensureRow(item));

        sendBtn.disabled = true;
        retryBtn.style.display = 'none';
        statusText.textContent = isRetry
          ? `Retrying ${unique.length} item(s)...`
          : `Sending ${unique.length} item(s)...`;

        let sent = 0;
        let failed = 0;
        lastFailedItems = [];

        for (const item of unique) {
          setRowStatus(item.imageId, 'Sending…');
          const url = await ensureDownloadUrl(item.imageId);
          if (!url) {
            failed += 1;
            lastFailedItems.push(item);
            setRowStatus(item.imageId, 'Failed (no URL)');
            updateMediaStatus(item.imageId, { telegramError: true, lastError: 'No URL' });
            continue;
          }
          const size = item.width && item.height ? `${item.width}x${item.height}` : '';
          const ok = await sendToTelegram(url, item.mimeType || 'image/*', taskData?.taskId || taskId, taskData?.createdAt, size, item.imageId);
          if (ok) {
            sent += 1;
            setRowStatus(item.imageId, 'Sent ✅');
          } else {
            failed += 1;
            lastFailedItems.push(item);
            setRowStatus(item.imageId, 'Failed');
            updateMediaStatus(item.imageId, { telegramError: true, lastError: 'Telegram send failed' });
          }
        }

        statusText.textContent = failed
          ? `Sent ${sent}/${unique.length}. ${failed} failed.`
          : `Sent ${sent}/${unique.length} ✅`;

        if (failed > 0) {
          retryBtn.style.display = 'inline-flex';
          retryBtn.disabled = false;
          retryBtn.querySelector('.n-button__content').innerHTML = `<i class="fas fa-redo" style="margin-right: 6px;"></i> Retry failed (${failed})`;
        }
        sendBtn.disabled = false;
      };

      sendBtn.onclick = async () => {
        const mediaItems = buildCandidates();
        await sendItems(mediaItems, false);
      };

      retryBtn.onclick = async () => {
        if (!lastFailedItems.length) return;
        await sendItems(lastFailedItems, true);
      };

      attachInjectedHelpTooltip(sendBtn, 'Send all media for this task to Telegram.');
      attachInjectedHelpTooltip(retryBtn, 'Retry sending only failed items.');

      buttonRow.appendChild(sendBtn);
      panel.appendChild(header);
      panel.appendChild(statusRow);
      panel.appendChild(toggleRow);
      panel.appendChild(buttonRow);
      panel.appendChild(list);

      if (insertBeforeEl && insertBeforeEl.parentElement) {
        insertBeforeEl.parentElement.insertBefore(panel, insertBeforeEl);
      } else {
        anchorEl.appendChild(panel);
      }
    };

    const addTaskDiscordPanel = (anchorEl, taskData, taskId, insertBeforeEl = null) => {
      if (isTemplateLikePage()) return;
      if (!settings.discordEnabled || !settings.discordWebhook) return;
      if (!anchorEl) return;

      const key = taskData?.taskId || taskId || '';
      const existing = anchorEl.querySelector(`[data-bypass-task-discord="${key}"]`);
      if (existing) return;

      const panel = document.createElement('div');
      panel.className = 'space-y-4 bg-fill-default px-12 py-8 rd-8';
      panel.setAttribute('data-bypass-task-discord', key);

      const header = document.createElement('div');
      header.className = 'flex-c-sb';
      header.innerHTML = `
        <h3 class="text-16 c-text-primary fw-600"><i class="fab fa-discord" style="margin-right: 6px; color: #5865f2;"></i> Discord</h3>
        <div class="flex-c gap-4"><span class="text-12 c-text-tertiary">Send all media to webhook</span></div>
      `;

      const statusRow = document.createElement('div');
      statusRow.className = 'flex-c gap-8';
      statusRow.style.justifyContent = 'space-between';
      statusRow.style.alignItems = 'center';

      const statusText = document.createElement('div');
      statusText.className = 'text-12 c-text-tertiary';
      statusText.textContent = 'Ready to send.';

      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.tabIndex = 0;
      retryBtn.className = getTensorButtonClass('warning');
      retryBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; display: none;';
      retryBtn.innerHTML = `
        <span class="n-button__content"><i class="fas fa-redo" style="margin-right: 6px;"></i> Retry failed</span>
        <div aria-hidden="true" class="n-base-wave"></div>
        <div aria-hidden="true" class="n-button__border"></div>
        <div aria-hidden="true" class="n-button__state-border"></div>
      `;

      statusRow.appendChild(statusText);
      statusRow.appendChild(retryBtn);

      const toggleRow = document.createElement('label');
      toggleRow.className = 'flex-c gap-8 text-12 c-text-tertiary';
      toggleRow.style.cursor = 'pointer';
      const onlyBlockedInput = document.createElement('input');
      onlyBlockedInput.type = 'checkbox';
      onlyBlockedInput.style.cssText = 'cursor: pointer; width: 16px; height: 16px;';
      toggleRow.appendChild(onlyBlockedInput);
      toggleRow.appendChild(document.createTextNode('Send only blocked items'));

      const list = document.createElement('div');
      list.className = 'space-y-4';
      list.style.display = 'none';

      const buttonRow = document.createElement('div');
      buttonRow.className = 'flex-c gap-8';

      const sendBtn = document.createElement('button');
      sendBtn.type = 'button';
      sendBtn.className = getTensorButtonClass('default');
      sendBtn.innerHTML = `
        <span class="n-button__content"><i class="fas fa-paper-plane" style="margin-right: 6px;"></i> Send all to Discord</span>
        <div aria-hidden="true" class="n-base-wave"></div>
        <div aria-hidden="true" class="n-button__border"></div>
        <div aria-hidden="true" class="n-button__state-border"></div>
      `;

      const rowMap = new Map();
      let lastFailedItems = [];

      const ensureRow = (item) => {
        if (!item?.imageId) return null;
        let row = rowMap.get(item.imageId);
        if (row) return row;

        row = document.createElement('div');
        row.className = 'flex-c-sb';

        const left = document.createElement('div');
        left.className = 'flex-c gap-6';
        const idText = document.createElement('span');
        idText.className = 'text-12 c-text-secondary';
        idText.textContent = item.imageId;
        const typeText = document.createElement('span');
        typeText.className = 'text-12 c-text-tertiary';
        typeText.textContent = item.mimeType?.startsWith('video/') ? 'Video' : 'Image';
        left.appendChild(idText);
        left.appendChild(typeText);

        const statusBadge = document.createElement('span');
        statusBadge.className = 'text-12 c-text-tertiary';
        statusBadge.textContent = 'Queued';

        row.appendChild(left);
        row.appendChild(statusBadge);
        list.appendChild(row);
        rowMap.set(item.imageId, statusBadge);
        return statusBadge;
      };

      const setRowStatus = (itemId, text) => {
        const badge = rowMap.get(itemId);
        if (badge) badge.textContent = text;
      };

      const buildCandidates = () => {
        const items = Array.isArray(taskData?.items) ? taskData.items : [];
        let mediaItems = items.filter(item => item?.imageId && (item.mimeType?.startsWith('image/') || item.mimeType?.startsWith('video/')));
        if (onlyBlockedInput.checked) {
          mediaItems = mediaItems.filter(item => item?.invalid === true);
        }
        return mediaItems;
      };

      const sendItems = async (itemsToSend, isRetry = false) => {
        const unique = [];
        const seen = new Set();
        for (const item of itemsToSend) {
          if (!item?.imageId || seen.has(item.imageId)) continue;
          seen.add(item.imageId);
          unique.push(item);
        }

        if (!unique.length) {
          statusText.textContent = 'No media found for this task.';
          return;
        }

        list.style.display = 'block';
        if (!isRetry || rowMap.size === 0) {
          list.innerHTML = '';
          rowMap.clear();
        }

        unique.forEach(item => ensureRow(item));

        sendBtn.disabled = true;
        retryBtn.style.display = 'none';
        statusText.textContent = isRetry
          ? `Retrying ${unique.length} item(s)...`
          : `Sending ${unique.length} item(s)...`;

        let sent = 0;
        let failed = 0;
        lastFailedItems = [];

        for (const item of unique) {
          setRowStatus(item.imageId, 'Sending…');
          const url = await ensureDownloadUrl(item.imageId);
          if (!url) {
            failed += 1;
            lastFailedItems.push(item);
            setRowStatus(item.imageId, 'Failed (no URL)');
            updateMediaStatus(item.imageId, { discordError: true, lastError: 'No URL' });
            continue;
          }
          const size = item.width && item.height ? `${item.width}x${item.height}` : '';
          const ok = await sendToDiscord(url, item.mimeType || 'image/*', taskData?.taskId || taskId, taskData?.createdAt, size, item.imageId);
          if (ok) {
            sent += 1;
            setRowStatus(item.imageId, 'Sent ✅');
          } else {
            failed += 1;
            lastFailedItems.push(item);
            setRowStatus(item.imageId, 'Failed');
            updateMediaStatus(item.imageId, { discordError: true, lastError: 'Discord send failed' });
          }
        }

        statusText.textContent = failed
          ? `Sent ${sent}/${unique.length}. ${failed} failed.`
          : `Sent ${sent}/${unique.length} ✅`;

        if (failed > 0) {
          retryBtn.style.display = 'inline-flex';
          retryBtn.disabled = false;
          retryBtn.querySelector('.n-button__content').innerHTML = `<i class="fas fa-redo" style="margin-right: 6px;"></i> Retry failed (${failed})`;
        }
        sendBtn.disabled = false;
      };

      sendBtn.onclick = async () => {
        const mediaItems = buildCandidates();
        await sendItems(mediaItems, false);
      };

      retryBtn.onclick = async () => {
        if (!lastFailedItems.length) return;
        await sendItems(lastFailedItems, true);
      };

      attachInjectedHelpTooltip(sendBtn, 'Send all media for this task to Discord.');
      attachInjectedHelpTooltip(retryBtn, 'Retry sending only failed items.');

      buttonRow.appendChild(sendBtn);
      panel.appendChild(header);
      panel.appendChild(statusRow);
      panel.appendChild(toggleRow);
      panel.appendChild(buttonRow);
      panel.appendChild(list);

      if (insertBeforeEl && insertBeforeEl.parentElement) {
        insertBeforeEl.parentElement.insertBefore(panel, insertBeforeEl);
      } else {
        anchorEl.appendChild(panel);
      }
    };

    const addTaskDownloadPanel = (anchorEl, taskData, taskId, insertBeforeEl = null) => {
      if (isTemplateLikePage()) return;
      if (!anchorEl) return;

      const key = taskData?.taskId || taskId || '';
      const existing = anchorEl.querySelector(`[data-bypass-task-download="${key}"]`);
      if (existing) return;

      const panel = document.createElement('div');
      panel.className = 'space-y-4 bg-fill-default px-12 py-8 rd-8';
      panel.setAttribute('data-bypass-task-download', key);

      const header = document.createElement('div');
      header.className = 'flex-c-sb';
      header.innerHTML = `
        <h3 class="text-16 c-text-primary fw-600"><i class="fas fa-download" style="margin-right: 6px;"></i> Download</h3>
        <div class="flex-c gap-4"><span class="text-12 c-text-tertiary">Download all media for this task</span></div>
      `;

      const statusRow = document.createElement('div');
      statusRow.className = 'flex-c gap-8';
      statusRow.style.justifyContent = 'space-between';
      statusRow.style.alignItems = 'center';

      const statusText = document.createElement('div');
      statusText.className = 'text-12 c-text-tertiary';
      statusText.textContent = 'Ready to download.';

      const retryBtn = document.createElement('button');
      retryBtn.type = 'button';
      retryBtn.tabIndex = 0;
      retryBtn.className = getTensorButtonClass('warning');
      retryBtn.style.cssText = 'padding: 4px 10px; font-size: 12px; display: none;';
      retryBtn.innerHTML = `
        <span class="n-button__content"><i class="fas fa-redo" style="margin-right: 6px;"></i> Retry failed</span>
        <div aria-hidden="true" class="n-base-wave"></div>
        <div aria-hidden="true" class="n-button__border"></div>
        <div aria-hidden="true" class="n-button__state-border"></div>
      `;

      statusRow.appendChild(statusText);
      statusRow.appendChild(retryBtn);

      const toggleRow = document.createElement('label');
      toggleRow.className = 'flex-c gap-8 text-12 c-text-tertiary';
      toggleRow.style.cursor = 'pointer';
      const onlyBlockedInput = document.createElement('input');
      onlyBlockedInput.type = 'checkbox';
      onlyBlockedInput.style.cssText = 'cursor: pointer; width: 16px; height: 16px;';
      toggleRow.appendChild(onlyBlockedInput);
      toggleRow.appendChild(document.createTextNode('Download only blocked items'));

      const list = document.createElement('div');
      list.className = 'space-y-4';
      list.style.display = 'none';

      const buttonRow = document.createElement('div');
      buttonRow.className = 'flex-c gap-8';

      const downloadBtn = document.createElement('button');
      downloadBtn.type = 'button';
      downloadBtn.className = getTensorButtonClass('default');
      downloadBtn.innerHTML = `
        <span class="n-button__content"><i class="fas fa-download" style="margin-right: 6px;"></i> Download all</span>
        <div aria-hidden="true" class="n-base-wave"></div>
        <div aria-hidden="true" class="n-button__border"></div>
        <div aria-hidden="true" class="n-button__state-border"></div>
      `;

      const rowMap = new Map();
      let lastFailedItems = [];

      const ensureRow = (item) => {
        if (!item?.imageId) return null;
        let row = rowMap.get(item.imageId);
        if (row) return row;

        row = document.createElement('div');
        row.className = 'flex-c-sb';

        const left = document.createElement('div');
        left.className = 'flex-c gap-6';
        const idText = document.createElement('span');
        idText.className = 'text-12 c-text-secondary';
        idText.textContent = item.imageId;
        const typeText = document.createElement('span');
        typeText.className = 'text-12 c-text-tertiary';
        typeText.textContent = item.mimeType?.startsWith('video/') ? 'Video' : 'Image';
        left.appendChild(idText);
        left.appendChild(typeText);

        const statusBadge = document.createElement('span');
        statusBadge.className = 'text-12 c-text-tertiary';
        statusBadge.textContent = 'Queued';

        row.appendChild(left);
        row.appendChild(statusBadge);
        list.appendChild(row);
        rowMap.set(item.imageId, statusBadge);
        return statusBadge;
      };

      const setRowStatus = (itemId, text) => {
        const badge = rowMap.get(itemId);
        if (badge) badge.textContent = text;
      };

      const buildCandidates = () => {
        const items = Array.isArray(taskData?.items) ? taskData.items : [];
        let mediaItems = items.filter(item => item?.imageId && (item.mimeType?.startsWith('image/') || item.mimeType?.startsWith('video/')));
        if (onlyBlockedInput.checked) {
          mediaItems = mediaItems.filter(item => item?.invalid === true);
        }
        return mediaItems;
      };

      const downloadItems = async (itemsToDownload, isRetry = false) => {
        const unique = [];
        const seen = new Set();
        for (const item of itemsToDownload) {
          if (!item?.imageId || seen.has(item.imageId)) continue;
          seen.add(item.imageId);
          unique.push(item);
        }

        if (!unique.length) {
          statusText.textContent = 'No media found for this task.';
          return;
        }

        list.style.display = 'block';
        if (!isRetry || rowMap.size === 0) {
          list.innerHTML = '';
          rowMap.clear();
        }

        unique.forEach(item => ensureRow(item));

        downloadBtn.disabled = true;
        retryBtn.style.display = 'none';
        statusText.textContent = isRetry
          ? `Retrying ${unique.length} item(s)...`
          : `Downloading ${unique.length} item(s)...`;

        let sent = 0;
        let failed = 0;
        lastFailedItems = [];

        for (const item of unique) {
          setRowStatus(item.imageId, 'Downloading…');
          try {
            await downloadMediaById(item.imageId, item.mimeType);
            sent += 1;
            setRowStatus(item.imageId, 'Downloaded ✅');
          } catch (err) {
            failed += 1;
            lastFailedItems.push(item);
            setRowStatus(item.imageId, 'Failed');
            updateMediaStatus(item.imageId, { downloadError: true, lastError: err.message || 'Download failed' });
          }
        }

        statusText.textContent = failed
          ? `Downloaded ${sent}/${unique.length}. ${failed} failed.`
          : `Downloaded ${sent}/${unique.length} ✅`;

        if (failed > 0) {
          retryBtn.style.display = 'inline-flex';
          retryBtn.disabled = false;
          retryBtn.querySelector('.n-button__content').innerHTML = `<i class="fas fa-redo" style="margin-right: 6px;"></i> Retry failed (${failed})`;
        }
        downloadBtn.disabled = false;
      };

      downloadBtn.onclick = async () => {
        const mediaItems = buildCandidates();
        await downloadItems(mediaItems, false);
      };

      retryBtn.onclick = async () => {
        if (!lastFailedItems.length) return;
        await downloadItems(lastFailedItems, true);
      };

      attachInjectedHelpTooltip(downloadBtn, 'Download all media for this task.');
      attachInjectedHelpTooltip(retryBtn, 'Retry downloading only failed items.');

      buttonRow.appendChild(downloadBtn);
      panel.appendChild(header);
      panel.appendChild(statusRow);
      panel.appendChild(toggleRow);
      panel.appendChild(buttonRow);
      panel.appendChild(list);

      if (insertBeforeEl && insertBeforeEl.parentElement) {
        insertBeforeEl.parentElement.insertBefore(panel, insertBeforeEl);
      } else {
        anchorEl.appendChild(panel);
      }
    };

    const removeBlockedOverlayFromSlot = (slot) => {
      const overlays = slot.querySelectorAll('div.cursor-not-allowed, div.flex-c-c.bg-fill-default, div.absolute, span.absolute');
      overlays.forEach(el => {
        const text = (el.textContent || '').toLowerCase();
        const hasFlagText = text.includes('inappropriate') || text.includes('reviewing');
        const hasFlagClass = el.classList.contains('bg-bg-on-secondary') || el.classList.contains('bg-block');
        if (hasFlagText || hasFlagClass || el.classList.contains('cursor-not-allowed')) {
          el.remove();
        }
      });

      const blockedShell = slot.querySelector('div.w-full.h-full.flex-c-c.bg-fill-default.border');
      if (blockedShell) blockedShell.remove();
    };

    const findBlockedShell = (slot) => {
      if (!slot) return null;
      return slot.querySelector('div.w-full.h-full.flex-c-c.bg-fill-default.border')
        || slot.querySelector('div.cursor-not-allowed')
        || null;
    };

    const removeBlockedMediaArtifacts = (slot) => {
      const imgNodes = Array.from(slot.querySelectorAll('img'));
      imgNodes.forEach(img => {
        const src = `${img.getAttribute('src') || ''} ${img.getAttribute('srcset') || ''}`;
        if (src.includes('forbidden.jpg') || src.includes('reviewing.png')) {
          img.remove();
        }
      });
    };

    const isBlockedSlot = (slot, includeForbidden = false) => {
      const text = slot.textContent || '';
      const hasBlockedLabel = text.includes('Inappropriate') || text.includes('Reviewing');
      const isBlockedCard = slot.querySelector('.cursor-not-allowed') || hasBlockedLabel;
      if (!includeForbidden) return Boolean(isBlockedCard);
      const forbiddenImg = slot.querySelector('img[src*="forbidden.jpg"], img[srcset*="forbidden.jpg"], img[src*="reviewing.png"], img[srcset*="reviewing.png"]');
      return Boolean(isBlockedCard || forbiddenImg);
    };

    const getMediaSlots = (mediaContainer) => {
      if (!mediaContainer) return [];
      const allSlots = Array.from(mediaContainer.querySelectorAll('div.rd-8.overflow-hidden'));
      const richSlots = allSlots.filter(slot => slot.querySelector('.thumbnail-image') || slot.querySelector('img') || slot.querySelector('video'));
      if (richSlots.length) return richSlots;
      const blockedSlots = allSlots.filter(slot => slot.classList.contains('cursor-not-allowed') || slot.querySelector('.cursor-not-allowed'));
      if (blockedSlots.length) return blockedSlots;
      const sizedSlots = Array.from(mediaContainer.querySelectorAll('div.rd-8.overflow-hidden.cursor-pointer.w-196'));
      if (sizedSlots.length) return sizedSlots;
      return allSlots;
    };

    const injectItemIntoSlot = async (slot, item, taskData, taskId, options = {}) => {
      const { deferVideo = true } = options;
      hideActiveBlockedTooltip();
      removeBlockedOverlayFromSlot(slot);
      removeBlockedMediaArtifacts(slot);
      if (slot.dataset.bypassInjected === item.imageId) {
        addTelegramSection(slot, item.imageId, taskData.taskId || taskId, taskData.createdAt);
        addStatusOverlay(slot, item.imageId);
        return;
      }
      slot.dataset.bypassInjected = item.imageId;

      const mimeType = item.mimeType || '';

      const thumbnailContainer = slot.querySelector('.thumbnail-image') || slot.querySelector('div.relative') || slot.querySelector('.rd-8') || slot;

      if (mimeType.startsWith('video/')) {
        const blockedShell = slot.querySelector('div.w-full.h-full.flex-c-c.bg-fill-default.border');
        if (blockedShell) blockedShell.remove();
        slot.querySelectorAll('video').forEach(v => v.remove());
        slot.querySelectorAll('img').forEach(img => img.remove());
        const video = document.createElement('video');
        video.controls = true;
        video.className = 'bypass-dom-video';
        video.style.width = '100%';
        video.style.height = '100%';
        video.style.objectFit = 'contain';
        video.style.display = 'block';
        video.preload = 'none';
        if (thumbnailContainer !== slot && slot.classList.contains('relative')) {
          video.style.position = 'absolute';
          video.style.inset = '0';
        }
        thumbnailContainer.appendChild(video);
        if (deferVideo) {
          const playOverlay = document.createElement('div');
          playOverlay.className = 'bypass-gallery-play';
          playOverlay.innerHTML = '<i class="fas fa-play"></i>';
          playOverlay.style.cursor = 'pointer';
          playOverlay.style.pointerEvents = 'auto';
          playOverlay.onclick = async () => {
            if (!video.src) {
              const downloadUrl = await ensureDownloadUrl(item.imageId);
              if (!downloadUrl) return;
              video.src = downloadUrl;
            }
            video.play().catch(() => {});
            playOverlay.remove();
          };
          thumbnailContainer.appendChild(playOverlay);
        } else {
          const downloadUrl = await ensureDownloadUrl(item.imageId);
          if (!downloadUrl) return;
          video.src = downloadUrl;
        }
      } else {
        const downloadUrl = await ensureDownloadUrl(item.imageId);
        if (!downloadUrl) return;
        let img = thumbnailContainer.querySelector('img');
        if (!img) {
          img = document.createElement('img');
          img.className = 'w-full h-full';
          img.style.objectFit = 'contain';
          img.style.objectPosition = 'center center';
          img.style.cursor = 'pointer';
          thumbnailContainer.appendChild(img);
        }
        img.src = downloadUrl;
        if (img.srcset) {
          img.srcset = `${downloadUrl} 1x`;
        }
        img.onclick = (e) => {
          e.stopPropagation();
          openImageModal(downloadUrl, taskData.taskId || taskId, taskData.createdAt, taskData.expireAt, [], item.imageId, mimeType);
        };
      }

      slot.setAttribute('data-bypass-task-id', taskData.taskId || taskId);
      slot.setAttribute('data-bypass-created-at', taskData.createdAt || '');
      slot.setAttribute('data-bypass-expire-at', taskData.expireAt || '');
      addTelegramSection(slot, item.imageId, taskData.taskId || taskId, taskData.createdAt);
      addStatusOverlay(slot, item.imageId);
      attachBlockedTooltip(slot, buildBlockedTooltipContent(item, taskData), { previewItem: item });

      if (domInjectDebug) console.log('[InjectDOM] Injected', { taskId: taskData.taskId || taskId, imageId: item.imageId, mimeType });
    };

    const addSafeViewButtonToSlot = (slot, item, taskData, taskId) => {
      if (!slot || !item?.imageId) return;
      const blockedShell = findBlockedShell(slot);
      if (!blockedShell) return;
      if (blockedShell.querySelector('[data-bypass-safe-view-btn]')) return;

      const inner = blockedShell.querySelector('div.p-12.flex.flex-col') || blockedShell;
      const btn = document.createElement('button');
      btn.className = 'vi-button vi-button--size-small vi-button--type-secondary';
      btn.setAttribute('data-bypass-safe-view-btn', 'true');
      btn.type = 'button';
      btn.innerHTML = '<div class="vi-button__wrap">Bypass - View</div>';
      btn.onclick = async (e) => {
        e.stopPropagation();
        hideActiveBlockedTooltip();
        await injectItemIntoSlot(slot, item, taskData, taskId, { deferVideo: false });
      };
      btn.addEventListener('mouseenter', hideActiveBlockedTooltip);
      inner.appendChild(btn);

      attachInjectedHelpTooltip(btn, 'Reveal this blocked media in place.');

      attachBlockedTooltip(blockedShell, buildBlockedTooltipContent(item, taskData), { previewItem: item });
    };

    const addTaskSafeViewPanel = (anchorEl, taskData, taskId, insertBeforeEl = null) => {
      if (isTemplateLikePage()) return;
      if (!settings.safeViewMode || !anchorEl) return;
      const key = taskData?.taskId || taskId || '';
      const existing = anchorEl.querySelector(`[data-bypass-task-safeview="${key}"]`);
      if (existing) return;

      const invalidItems = Array.isArray(taskData?.items) ? taskData.items.filter(item => item?.invalid && item?.imageId) : [];
      if (invalidItems.length < 2) return;

      const panel = document.createElement('div');
      panel.className = 'space-y-4 bg-fill-default px-12 py-8 rd-8';
      panel.setAttribute('data-bypass-task-safeview', key);

      const header = document.createElement('div');
      header.className = 'flex-c-sb';
      header.innerHTML = `
        <h3 class="text-16 c-text-primary fw-600"><i class="fas fa-eye" style="margin-right: 6px;"></i> Safe View</h3>
        <div class="flex-c gap-4"><span class="text-12 c-text-tertiary">Reveal all blocked media in this task</span></div>
      `;

      const buttonRow = document.createElement('div');
      buttonRow.className = 'flex-c gap-8';
      const viewAllBtn = document.createElement('button');
      viewAllBtn.type = 'button';
      viewAllBtn.className = getTensorButtonClass('default');
      viewAllBtn.innerHTML = `
        <span class="n-button__content"><i class="fas fa-unlock" style="margin-right: 6px;"></i> Bypass - View All</span>
        <div aria-hidden="true" class="n-base-wave"></div>
        <div aria-hidden="true" class="n-button__border"></div>
        <div aria-hidden="true" class="n-button__state-border"></div>
      `;
      viewAllBtn.onclick = async () => {
        const panelRoot = anchorEl.closest('div.bg-bg-primary') || anchorEl;
        const spaceContainer = panelRoot.querySelector('div.space-y-12')
          || panelRoot.querySelector('div.mt-12.flex.flex-wrap.gap-12')
          || panelRoot;
        const mediaSlots = getMediaSlots(spaceContainer);
        const blockedSlots = mediaSlots.filter(slot => isBlockedSlot(slot, true));
        for (let i = 0; i < Math.min(blockedSlots.length, invalidItems.length); i++) {
          await injectItemIntoSlot(blockedSlots[i], invalidItems[i], taskData, taskId, { deferVideo: false });
        }
      };
      buttonRow.appendChild(viewAllBtn);
      panel.appendChild(header);
      panel.appendChild(buttonRow);

      attachInjectedHelpTooltip(viewAllBtn, 'Reveal all blocked media for this task.');

      if (insertBeforeEl && insertBeforeEl.parentElement) {
        insertBeforeEl.parentElement.insertBefore(panel, insertBeforeEl);
      } else {
        anchorEl.appendChild(panel);
      }
    };

    const addGlobalBypassAllButton = (root) => {
      if (!settings.safeViewMode || !root) return;
      const headerRow = root.querySelector('div.hidden.lg\\:flex.lg\\:flex-c.justify-between.w-full.py-8');
      if (!headerRow) return;
      if (headerRow.querySelector('[data-bypass-global-safeview]')) return;

      const btn = document.createElement('button');
      btn.className = 'text-14 b-1-stroke-secondary rd-8 fw-600 px-8 py-4 cursor-pointer';
      btn.setAttribute('data-bypass-global-safeview', 'true');
      btn.textContent = 'Bypass All current tasks';
      btn.onclick = async () => {
        await injectBlockedMediaIntoDom({ forceBypass: true });
      };
      headerRow.appendChild(btn);

      attachInjectedHelpTooltip(btn, 'Reveal all blocked media across current tasks.');
    };

    const addGlobalTaskActionsBar = (root) => {
      if (!root) return;
      const headerRow = root.querySelector('div.hidden.lg\\:flex.lg\\:flex-c.justify-between.w-full.py-8');
      if (!headerRow) return;
      if (headerRow.parentElement?.querySelector('[data-bypass-global-actions]')) return;

      const wrap = document.createElement('div');
      wrap.className = 'hidden lg:flex lg:flex-c justify-between w-full py-8';
      wrap.setAttribute('data-bypass-global-actions', 'true');

      const left = document.createElement('div');
      left.className = 'flex-c gap-12';
      const right = document.createElement('div');
      right.className = 'flex-c gap-8';

      const preventWrap = document.createElement('label');
      preventWrap.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:12px; color: #cbd5e1;';
      const preventInput = document.createElement('input');
      preventInput.type = 'checkbox';
      preventInput.checked = settings.preventDuplicateTasks;
      preventInput.style.cssText = 'width:14px; height:14px; cursor:pointer;';
      preventInput.onchange = () => {
        settings.preventDuplicateTasks = preventInput.checked;
        saveSettings();
      };
      preventWrap.appendChild(preventInput);
      preventWrap.appendChild(document.createTextNode('Prevent duplicates'));
      attachInjectedHelpTooltip(preventWrap, 'Skip items already processed when running global actions.');

      const createActionBtn = (label, action, enabled, helpText) => {
        if (!enabled) return null;
        const btn = document.createElement('button');
        btn.className = 'text-14 b-1-stroke-secondary rd-8 fw-600 px-8 py-4 cursor-pointer';
        btn.textContent = label;
        btn.onclick = async () => {
          const items = itemsData.filter(item => item?.id);
          if (!items.length) return;
          const allowDuplicate = !settings.preventDuplicateTasks;
          for (const item of items) {
            const meta = getItemMetaFromId(item.id);
            enqueueTaskAction(action, item.id, meta, allowDuplicate);
          }
          processTaskActionQueue();
          updateGlobalActionProgressFromQueue();
        };
        if (helpText) {
          attachInjectedHelpTooltip(btn, helpText);
        }
        return btn;
      };

      const telegramBtn = createActionBtn(
        'Send All current tasks to Telegram',
        'telegram',
        settings.telegramEnabled && settings.sendAllTasksTelegram,
        'Queue all current tasks to send to Telegram.'
      );
      const discordBtn = createActionBtn(
        'Send All current tasks to Discord',
        'discord',
        settings.discordEnabled && settings.sendAllTasksDiscord,
        'Queue all current tasks to send to Discord.'
      );
      const downloadBtn = createActionBtn(
        'Download All current tasks',
        'download',
        settings.sendAllTasksDownload,
        'Queue all current tasks for download.'
      );

      if (telegramBtn) right.appendChild(telegramBtn);
      if (discordBtn) right.appendChild(discordBtn);
      if (downloadBtn) right.appendChild(downloadBtn);
      right.appendChild(preventWrap);

      const progress = document.createElement('div');
      progress.className = 'bypass-global-progress';
      progress.style.cssText = 'width: 100%; margin-top: 8px; margin-bottom: 8px; display: none;';
      progress.innerHTML = `
        <div style="font-size: 11px; color: #94a3b8; margin-bottom: 6px;" data-bypass-progress-text>Idle</div>
        <div style="height: 6px; background: rgba(148,163,184,0.25); border-radius: 999px; overflow: hidden;">
          <div data-bypass-progress-bar style="height: 100%; width: 0%; background: linear-gradient(135deg, #6366f1, #8b5cf6);"></div>
        </div>
        <div data-bypass-progress-preview style="display:none;"></div>
      `;

      wrap.appendChild(left);
      wrap.appendChild(right);
      headerRow.parentElement.insertBefore(wrap, headerRow.nextSibling);
      headerRow.parentElement.insertBefore(progress, wrap.nextSibling);
      updateGlobalActionProgressFromQueue();
    };

    const addTemplateTabActions = () => {
      if (!/^https:\/\/tensor\.art\/template\/[A-Za-z0-9_-]+\/?$/.test(window.location.href)) return;
      const tabsWrapper = document.querySelector('div.n-tabs-wrapper');
      if (!tabsWrapper) return;
      if (!tabsWrapper.querySelector('div.n-tabs-tab--active[data-name="result"]')) return;
      if (tabsWrapper.querySelector('[data-bypass-template-actions]')) return;

      const actionsWrap = document.createElement('div');
      actionsWrap.className = 'n-tabs-tab-wrapper';
      actionsWrap.setAttribute('data-bypass-template-actions', 'true');

      const actionsRow = document.createElement('div');
      actionsRow.style.cssText = 'display:flex; gap:8px; align-items:center; flex-wrap: wrap;';

      const makeIconBtn = (icon, title, onClick) => {
        const btn = document.createElement('button');
        btn.className = 'text-14 b-1-stroke-secondary rd-8 fw-600 px-8 py-4 cursor-pointer';
        btn.style.cssText = 'display:flex; align-items:center; justify-content:center; width:40px; height:40px;';
        btn.title = title;
        btn.innerHTML = `<i class="${icon}"></i>`;
        btn.onclick = onClick;
        attachInjectedHelpTooltip(btn, title);
        return btn;
      };

      if (settings.telegramEnabled && settings.sendAllTasksTelegram) {
        actionsRow.appendChild(makeIconBtn('fab fa-telegram', 'Send All current tasks to Telegram', () => {
          const items = itemsData.filter(item => item?.id);
          const allowDuplicate = !settings.preventDuplicateTasks;
          items.forEach(item => enqueueTaskAction('telegram', item.id, getItemMetaFromId(item.id), allowDuplicate));
          processTaskActionQueue();
          updateGlobalActionProgressFromQueue();
        }));
      }

      if (settings.discordEnabled && settings.sendAllTasksDiscord) {
        actionsRow.appendChild(makeIconBtn('fab fa-discord', 'Send All current tasks to Discord', () => {
          const items = itemsData.filter(item => item?.id);
          const allowDuplicate = !settings.preventDuplicateTasks;
          items.forEach(item => enqueueTaskAction('discord', item.id, getItemMetaFromId(item.id), allowDuplicate));
          processTaskActionQueue();
          updateGlobalActionProgressFromQueue();
        }));
      }

      if (settings.sendAllTasksDownload) {
        actionsRow.appendChild(makeIconBtn('fas fa-download', 'Download All current tasks', () => {
          const items = itemsData.filter(item => item?.id);
          const allowDuplicate = !settings.preventDuplicateTasks;
          items.forEach(item => enqueueTaskAction('download', item.id, getItemMetaFromId(item.id), allowDuplicate));
          processTaskActionQueue();
          updateGlobalActionProgressFromQueue();
        }));
      }

      const dupBtn = document.createElement('label');
      dupBtn.style.cssText = 'display:flex; align-items:center; gap:8px; font-size:12px; color:#cbd5e1;';
      const dupInput = document.createElement('input');
      dupInput.type = 'checkbox';
      dupInput.checked = settings.preventDuplicateTasks;
      dupInput.style.cssText = 'width:14px; height:14px; cursor:pointer;';
      dupInput.onchange = () => {
        settings.preventDuplicateTasks = dupInput.checked;
        saveSettings();
      };
      dupBtn.appendChild(dupInput);
      dupBtn.appendChild(document.createTextNode('Prevent duplicates'));
      attachInjectedHelpTooltip(dupBtn, 'Skip items already processed when running global actions.');
      actionsRow.appendChild(dupBtn);

      actionsWrap.appendChild(actionsRow);
      const wrappers = Array.from(tabsWrapper.querySelectorAll('div.n-tabs-tab-wrapper'));
      const resultTab = wrappers.find(wrap => wrap.querySelector('div[data-name="result"]')) || tabsWrapper.lastElementChild;
      if (resultTab && resultTab.parentElement) {
        resultTab.parentElement.insertBefore(actionsWrap, resultTab);
      } else {
        tabsWrapper.appendChild(actionsWrap);
      }
    };

    for (const root of roots) {
      addGlobalBypassAllButton(root);
      addGlobalTaskActionsBar(root);
      addTemplateTabActions();
      // Process type 1: space-y-4.px-12.py-8.rd-8.bg-fill-default
      const detailsBlocks = root.querySelectorAll('div.space-y-4.px-12.py-8.rd-8.bg-fill-default');
      for (const detailsBlock of detailsBlocks) {
        const taskId = extractTaskIdFromDetails(detailsBlock);
        if (!taskId) continue;

        const taskData = resolveTaskData(taskId);
        if (!taskData || !taskData.items?.length) {
          if (domInjectDebug) console.log('[InjectDOM][Type1] No task data', { taskId, hasTaskData: Boolean(taskData) });
          continue;
        }

        // Task-level Telegram panel under the details block
        addTaskTelegramPanel(detailsBlock.parentElement || detailsBlock, taskData, taskId);
        addTaskDiscordPanel(detailsBlock.parentElement || detailsBlock, taskData, taskId);
        addTaskDownloadPanel(detailsBlock.parentElement || detailsBlock, taskData, taskId);
        addTaskSafeViewPanel(detailsBlock.parentElement || detailsBlock, taskData, taskId);

        const panelRoot = detailsBlock?.closest('div.bg-bg-primary') || root;
        const spaceContainer = panelRoot.querySelector('div.space-y-12');
        if (!spaceContainer) continue;

        const mediaSlots = Array.from(spaceContainer.querySelectorAll('div.relative.group.h-auto.min-h-0.w-full'));
        if (!mediaSlots.length) continue;

        const blockedSlots = mediaSlots.filter(slot => isBlockedSlot(slot));

        const invalidItems = taskData.items.filter(item => item?.invalid);
        if (domInjectDebug) console.log('[InjectDOM][Type1] Slots', { taskId, blockedSlots: blockedSlots.length, invalidItems: invalidItems.length });
        if (!invalidItems.length || !blockedSlots.length) continue;

        for (let i = 0; i < Math.min(blockedSlots.length, invalidItems.length); i++) {
          const slot = blockedSlots[i];
          const item = invalidItems[i];
          if (safeViewEnabled) {
            addSafeViewButtonToSlot(slot, item, taskData, taskId);
          } else {
            await injectItemIntoSlot(slot, item, taskData, taskId, { deferVideo: bypassDeferVideo });
          }
        }
      }

      // Process type 2: bg-bg-primary.rd-12.overflow-hidden.p-12
      const primaryPanels = root.querySelectorAll('div.bg-bg-primary.rd-12.overflow-hidden.p-12');
      for (const panel of primaryPanels) {
        const detailsInPanel = panel.querySelector('div.space-y-4.px-12.py-8.rd-8.bg-fill-default');
        if (!detailsInPanel) continue;

        const taskId = extractTaskIdFromDetails(detailsInPanel);
        if (!taskId) continue;

        const taskData = resolveTaskData(taskId);
        if (!taskData || !taskData.items?.length) {
          if (domInjectDebug) console.log('[InjectDOM][Type2] No task data', { taskId, hasTaskData: Boolean(taskData) });
          continue;
        }

        // Task-level Telegram panel under the details block
        addTaskTelegramPanel(detailsInPanel.parentElement || detailsInPanel, taskData, taskId);
        addTaskDiscordPanel(detailsInPanel.parentElement || detailsInPanel, taskData, taskId);
        addTaskDownloadPanel(detailsInPanel.parentElement || detailsInPanel, taskData, taskId);
        addTaskSafeViewPanel(detailsInPanel.parentElement || detailsInPanel, taskData, taskId);

        const spaceContainer = panel.querySelector('div.space-y-12');
        if (!spaceContainer) continue;

        const mediaSlots = Array.from(spaceContainer.querySelectorAll('div.relative.group.h-auto.min-h-0.w-full'));
        if (!mediaSlots.length) continue;

        const blockedSlots = mediaSlots.filter(slot => isBlockedSlot(slot));
        const pendingSlots = blockedSlots.filter(slot => !slot.dataset.bypassInjected);
        if (panel.dataset.bypassProcessed === 'true' && !pendingSlots.length) continue;

        const invalidItems = taskData.items.filter(item => item?.invalid);
        if (domInjectDebug) console.log('[InjectDOM][Type2] Slots', { taskId, blockedSlots: blockedSlots.length, invalidItems: invalidItems.length, pendingSlots: pendingSlots.length });
        if (!invalidItems.length || !blockedSlots.length) continue;

        for (let i = 0; i < Math.min(blockedSlots.length, invalidItems.length); i++) {
          const slot = blockedSlots[i];
          const item = invalidItems[i];
          if (safeViewEnabled) {
            addSafeViewButtonToSlot(slot, item, taskData, taskId);
          } else {
            await injectItemIntoSlot(slot, item, taskData, taskId, { deferVideo: bypassDeferVideo });
          }
        }

        panel.dataset.bypassProcessed = 'true';
      }

      // Process type 3: template/result cards
      const templateCards = Array.from(root.querySelectorAll('div.min-h-100'))
        .filter(card => card.querySelector('h3.c-text-secondary')?.textContent?.includes('ID:'));

      for (const card of templateCards) {
        const header = card.querySelector('h3.c-text-secondary');
        const taskId = extractTaskIdFromHeaderText(header?.textContent || '');
        if (!taskId) continue;

        const taskData = resolveTaskData(taskId);
        if (!taskData || !taskData.items?.length) {
          if (domInjectDebug) console.log('[InjectDOM][Template] No task data', { taskId, hasTaskData: Boolean(taskData) });
          continue;
        }

        const mediaContainer = card.querySelector('div.mt-12.flex.flex-wrap.gap-12');
        if (!mediaContainer) continue;

        // Task-level Telegram panel for template cards (insert above media)
        addTaskTelegramPanel(card, taskData, taskId, mediaContainer);
        addTaskDiscordPanel(card, taskData, taskId, mediaContainer);
        addTaskDownloadPanel(card, taskData, taskId, mediaContainer);
        addTaskSafeViewPanel(card, taskData, taskId, mediaContainer);

        const mediaSlots = getMediaSlots(mediaContainer);
        if (!mediaSlots.length) continue;

        const blockedSlots = mediaSlots.filter(slot => isBlockedSlot(slot, true));

        const invalidItems = taskData.items.filter(item => item?.invalid);
        if (domInjectDebug) console.log('[InjectDOM][Template] Slots', { taskId, blockedSlots: blockedSlots.length, invalidItems: invalidItems.length });
        if (!invalidItems.length || !blockedSlots.length) continue;

        for (let i = 0; i < Math.min(blockedSlots.length, invalidItems.length); i++) {
          const slot = blockedSlots[i];
          const item = invalidItems[i];
          if (safeViewEnabled) {
            addSafeViewButtonToSlot(slot, item, taskData, taskId);
          } else {
            await injectItemIntoSlot(slot, item, taskData, taskId, { deferVideo: bypassDeferVideo });
          }
        }
      }

      // Process type 4: workflow editor page cards
      const workflowCards = Array.from(root.querySelectorAll('div.min-h-100'))
        .filter(card => card.querySelector('h3.c-text-secondary')?.textContent?.includes('ID:'));

      for (const card of workflowCards) {
        const header = card.querySelector('h3.c-text-secondary');
        const taskId = extractTaskIdFromHeaderText(header?.textContent || '');
        if (!taskId) continue;

        const taskData = resolveTaskData(taskId);
        if (!taskData || !taskData.items?.length) {
          if (domInjectDebug) console.log('[InjectDOM][Workflow] No task data', { taskId, hasTaskData: Boolean(taskData) });
          continue;
        }

        const mediaContainer = card.querySelector('div.mt-12.flex.flex-wrap.gap-12');
        if (!mediaContainer) continue;

        const mediaSlots = getMediaSlots(mediaContainer);
        if (!mediaSlots.length) continue;

        const blockedSlots = mediaSlots.filter(slot => isBlockedSlot(slot, true));
        const invalidItems = taskData.items.filter(item => item?.invalid);
        if (domInjectDebug) console.log('[InjectDOM][Workflow] Slots', { taskId, blockedSlots: blockedSlots.length, invalidItems: invalidItems.length });
        if (!invalidItems.length || !blockedSlots.length) continue;

        for (let i = 0; i < Math.min(blockedSlots.length, invalidItems.length); i++) {
          const slot = blockedSlots[i];
          const item = invalidItems[i];
          if (safeViewEnabled) {
            addSafeViewButtonToSlot(slot, item, taskData, taskId);
          } else {
            await injectItemIntoSlot(slot, item, taskData, taskId, { deferVideo: bypassDeferVideo });
          }
        }
      }

      // Process type 5: workspace media containers (no min-h-100 card wrapper)
      const workspaceContainers = Array.from(root.querySelectorAll('div.mt-12.flex.flex-wrap.gap-12'))
        .filter(container => !container.closest('div.min-h-100'));

      for (const mediaContainer of workspaceContainers) {
        const taskId = findTaskIdForContainer(mediaContainer);
        if (!taskId) {
          if (domInjectDebug) console.log('[InjectDOM][Workspace] No task id for container');
          continue;
        }

        const taskData = resolveTaskData(taskId);
        if (!taskData || !taskData.items?.length) {
          if (domInjectDebug) console.log('[InjectDOM][Workspace] No task data', { taskId, hasTaskData: Boolean(taskData) });
          continue;
        }

        const mediaSlots = getMediaSlots(mediaContainer);
        if (!mediaSlots.length) continue;

        const blockedSlots = mediaSlots.filter(slot => isBlockedSlot(slot, true));
        const invalidItems = taskData.items.filter(item => item?.invalid);
        if (domInjectDebug) console.log('[InjectDOM][Workspace] Slots', { taskId, blockedSlots: blockedSlots.length, invalidItems: invalidItems.length });
        if (!invalidItems.length || !blockedSlots.length) continue;

        for (let i = 0; i < Math.min(blockedSlots.length, invalidItems.length); i++) {
          const slot = blockedSlots[i];
          const item = invalidItems[i];
          if (safeViewEnabled) {
            addSafeViewButtonToSlot(slot, item, taskData, taskId);
          } else {
            await injectItemIntoSlot(slot, item, taskData, taskId, { deferVideo: bypassDeferVideo });
          }
        }
      }
    }
  }

  function getThemeColors() {
    if (settings.inheritTheme) {
      return {
        primary: 'var(--color-main, #6366f1)',
        primaryHover: 'var(--color-main, #4f46e5)',
        bg: 'var(--background-primary, #0f172a)',
        bgSecondary: 'var(--background-on-primary, #1e293b)',
        bgTertiary: 'var(--background-tertiary, #334155)',
        text: 'var(--text-primary, #f1f5f9)',
        textSecondary: 'var(--text-secondary, #cbd5e1)',
        border: 'var(--stroke-secondary, #475569)',
        success: 'var(--color-success, #10b981)',
        error: 'var(--color-error, #ef4444)',
        warning: 'var(--text-yellow, #f59e0b)'
      };
    }
    return designSystem[settings.theme];
  }

  function injectStyles() {
    if (document.getElementById('bypass-styles')) {
      document.getElementById('bypass-styles').remove();
    }
    
    const colors = getThemeColors();
    const style = document.createElement('style');
    style.id = 'bypass-styles';
    style.textContent = `
      * {
        box-sizing: border-box;
      }

      @keyframes slideInDown {
        from { opacity: 0; transform: translateY(-20px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes slideInUp {
        from { opacity: 0; transform: translateY(20px); }
        to { opacity: 1; transform: translateY(0); }
      }

      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }

      @keyframes shimmer {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }

      @keyframes smoothBounce {
        0%, 100% { transform: translateY(0); }
        50% { transform: translateY(-2px); }
      }

      .bypass-container {
        all: revert;
        position: fixed;
        z-index: 99999;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-size: 14px;
        -webkit-user-select: none;
        user-select: none;
        background: ${colors.bg};
        color: ${colors.text};
        border: 1px solid ${colors.border};
        border-radius: 22px;
        box-shadow: 0 20px 60px rgba(0, 0, 0, 0.35);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        transition: all 0.5s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(20px);
        animation: slideInDown 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
      }

      .bypass-container:hover {
        box-shadow: 0 30px 80px rgba(0, 0, 0, 0.4);
        transform: translateY(-2px);
      }

      .bypass-header {
        background: linear-gradient(135deg, ${colors.primary}, ${colors.primaryHover});
        padding: 20px;
        display: flex;
        align-items: center;
        justify-content: space-between;
        cursor: move;
        user-select: none;
        flex-shrink: 0;
        box-shadow: 0 4px 20px rgba(99, 102, 241, 0.15);
        position: relative;
      }

      .bypass-header::after {
        content: '';
        position: absolute;
        bottom: 0;
        left: 0;
        right: 0;
        height: 1px;
        background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent);
      }

      .bypass-header-title {
        display: flex;
        align-items: center;
        gap: 12px;
        font-weight: 700;
        color: white;
        font-size: 16px;
        margin: 0;
        letter-spacing: 0.5px;
      }

      .bypass-header-icon {
        font-size: 20px;
        animation: smoothBounce 3s infinite;
      }

      .bypass-header-actions {
        display: flex;
        gap: 10px;
        align-items: center;
      }

      .bypass-btn-icon {
        background: rgba(255, 255, 255, 0.15);
        border: 1px solid rgba(255, 255, 255, 0.2);
        color: white;
        width: 36px;
        height: 36px;
        border-radius: 8px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 16px;
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        backdrop-filter: blur(10px);
      }

      .bypass-btn-icon:hover {
        background: rgba(255, 255, 255, 0.25);
        transform: scale(1.08);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.2);
      }

      .bypass-btn-icon:active {
        transform: scale(0.95);
      }

      .bypass-resize-handle {
        position: absolute;
        bottom: 0;
        right: 0;
        width: 16px;
        height: 16px;
        cursor: se-resize;
        opacity: 0.5;
        transition: opacity 0.3s cubic-bezier(0.4, 0, 0.2, 1);
      }

      .bypass-resize-handle:hover {
        opacity: 1;
      }

      .bypass-resize-handle::after {
        content: '';
        position: absolute;
        bottom: 3px;
        right: 3px;
        width: 5px;
        height: 5px;
        border-right: 2px solid ${colors.textSecondary};
        border-bottom: 2px solid ${colors.textSecondary};
        opacity: 0.7;
      }

      .bypass-tabs {
        display: flex;
        background: ${colors.bg};
        border-bottom: 1px solid ${colors.border};
        gap: 0;
        flex-shrink: 0;
        padding: 0 8px;
      }

      .bypass-tab {
        flex: 1;
        padding: 14px 20px;
        background: none;
        border: none;
        color: ${colors.textSecondary};
        cursor: pointer;
        font-weight: 600;
        font-size: 13px;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        position: relative;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        border-radius: 8px 8px 0 0;
        margin: 4px 0 0 0;
      }

      .bypass-tab:hover {
        color: ${colors.text};
        background: ${colors.bgSecondary};
      }

      .bypass-tab.active {
        color: ${colors.primary};
        background: ${colors.bgSecondary};
      }

      .bypass-tab.active::after {
        content: '';
        position: absolute;
        bottom: -1px;
        left: 20%;
        right: 20%;
        height: 3px;
        background: linear-gradient(90deg, ${colors.primary}, ${colors.primaryHover});
        border-radius: 3px 3px 0 0;
        box-shadow: 0 -2px 8px rgba(99, 102, 241, 0.3);
      }

      .bypass-content {
        flex: 1;
        overflow-y: auto;
        padding: 20px;
        display: flex;
        flex-direction: column;
        gap: 16px;
        background: ${colors.bg};
      }

      .bypass-content::-webkit-scrollbar {
        width: 8px;
      }

      .bypass-content::-webkit-scrollbar-track {
        background: transparent;
      }

      .bypass-content::-webkit-scrollbar-thumb {
        background: ${colors.bgTertiary};
        border-radius: 4px;
      }

      .bypass-content::-webkit-scrollbar-thumb:hover {
        background: ${colors.border};
      }

      .bypass-container * {
        scrollbar-width: thin;
        scrollbar-color: ${colors.bgTertiary} transparent;
      }

      .bypass-container *::-webkit-scrollbar {
        width: 8px;
        height: 8px;
      }

      .bypass-container *::-webkit-scrollbar-track {
        background: transparent;
      }

      .bypass-container *::-webkit-scrollbar-thumb {
        background: ${colors.bgTertiary};
        border-radius: 4px;
      }

      .bypass-container *::-webkit-scrollbar-thumb:hover {
        background: ${colors.border};
      }

      .bypass-btn {
        padding: 12px 18px;
        border: none;
        border-radius: 10px;
        cursor: pointer;
        font-weight: 600;
        font-size: 13px;
        transition: all 0.2s ease;
        text-transform: uppercase;
        letter-spacing: 0.5px;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 8px;
      }

      .bypass-btn:active {
        transform: scale(0.96);
      }

      .bypass-btn-primary {
        background: linear-gradient(135deg, ${colors.primary}, ${colors.primaryHover});
        color: white;
        box-shadow: 0 6px 16px rgba(99, 102, 241, 0.25);
        border: none;
      }

      .bypass-btn-primary:hover {
        transform: translateY(-3px);
        box-shadow: 0 10px 28px rgba(99, 102, 241, 0.4);
      }

      .bypass-btn-primary:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }

      .bypass-btn-danger {
        background: linear-gradient(135deg, #ef4444, #dc2626);
        color: white;
        box-shadow: 0 6px 16px rgba(239, 68, 68, 0.25);
      }

      .bypass-btn-danger:hover {
        transform: translateY(-3px);
        box-shadow: 0 10px 28px rgba(239, 68, 68, 0.4);
      }

      .bypass-btn-secondary {
        background: ${colors.bgSecondary};
        color: ${colors.text};
        border: 1px solid ${colors.border};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
      }

      .bypass-btn-secondary:hover {
        background: ${colors.bgTertiary};
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0, 0, 0, 0.15);
      }

      /* Action Buttons - Icon Only Horizontal Layout */
      .bypass-action-buttons {
        display: flex;
        gap: 12px;
        justify-content: center;
        align-items: center;
        flex-wrap: wrap;
        padding: 10px 12px;
        border: 1px solid ${colors.border};
        border-radius: 12px;
        background: ${colors.bgSecondary};
        margin-top: 12px;
      }

      .bypass-action-btn {
        transition: transform 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
      }

      .bypass-action-btn {
        width: 44px;
        height: 44px;
        min-width: 44px;
        padding: 10px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-size: 16px;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        position: relative;
      }

      .bypass-action-btn i {
        display: block;
      }

      .bypass-action-btn .bypass-action-label {
        display: none;
      }

      .bypass-action-btn-primary {
        background: linear-gradient(135deg, ${colors.primary}, ${colors.primaryHover});
        color: white;
        box-shadow: 0 6px 16px rgba(99, 102, 241, 0.25);
      }

      .bypass-action-btn-primary:hover {
        transform: translateY(-2px);
        box-shadow: 0 8px 20px rgba(99, 102, 241, 0.35);
      }

      .bypass-action-btn-secondary {
        background: ${colors.bgSecondary};
        color: ${colors.text};
        border: 1px solid ${colors.border};
      }

      .bypass-action-btn-secondary:hover {
        background: ${colors.bgTertiary};
        transform: translateY(-2px);
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
      }

      .bypass-action-btn-danger {
        background: rgba(239, 68, 68, 0.1);
        color: #ef4444;
        border: 1px solid #ef4444;
      }

      .bypass-action-btn-danger:hover {
        background: linear-gradient(135deg, #ef4444, #dc2626);
        color: white;
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(239, 68, 68, 0.3);
      }

      .bypass-action-btn:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        transform: none;
      }

      .bypass-item-card {
        background: ${colors.bgSecondary};
        border: 1px solid ${colors.border};
        border-radius: 12px;
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
        transition: all 0.2s ease;
        animation: slideInUp 0.5s ease-out;
      }

      .bypass-item-card:hover {
        border-color: ${colors.primary};
        background: ${colors.bgSecondary};
        box-shadow: 0 12px 32px rgba(99, 102, 241, 0.15);
        transform: translateY(-4px);
      }

      .bypass-item-card.selected {
        border-color: ${colors.primary};
        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.35);
        background: ${colors.bgTertiary};
      }

      .bypass-item-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        gap: 12px;
      }

      .bypass-item-id {
        font-weight: 600;
        color: ${colors.text};
        font-size: 12px;
        font-family: 'Monaco', 'Courier New', monospace;
        word-break: break-all;
      }

      .bypass-item-type {
        background: linear-gradient(135deg, ${colors.primary}, ${colors.primaryHover});
        color: white;
        padding: 4px 12px;
        border-radius: 8px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.4px;
        box-shadow: 0 3px 10px rgba(99, 102, 241, 0.25);
        white-space: nowrap;
      }

      .bypass-item-preview {
        width: 100%;
        border-radius: 10px;
        max-height: 200px;
        object-fit: contain;
        background: ${colors.bg};
        border: 1px solid ${colors.border};
        transition: all 0.3s ease;
      }

      .bypass-item-preview:hover {
        border-color: ${colors.primary};
      }

      .bypass-item-buttons {
        display: flex;
        gap: 10px;
        justify-content: stretch;
        flex-wrap: wrap;
      }

      .bypass-item-button {
        flex: 1;
        min-width: 80px;
        padding: 9px 14px;
        border: none;
        border-radius: 8px;
        cursor: pointer;
        font-weight: 600;
        font-size: 12px;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }

      .bypass-item-button:active {
        transform: scale(0.95);
      }

      .bypass-item-button-download {
        background: linear-gradient(135deg, ${colors.primary}, ${colors.primaryHover});
        color: white;
        box-shadow: 0 5px 15px rgba(99, 102, 241, 0.3);
      }

      .bypass-item-button-download:hover {
        transform: translateY(-3px);
        box-shadow: 0 8px 20px rgba(99, 102, 241, 0.4);
      }

      .bypass-item-button-telegram {
        background: linear-gradient(135deg, #0088cc, #005fa3);
        color: white;
        box-shadow: 0 4px 12px rgba(0, 136, 204, 0.3);
      }

      .bypass-item-button-telegram:hover {
        transform: translateY(-2px);
        box-shadow: 0 6px 16px rgba(0, 136, 204, 0.4);
      }

      .bypass-item-button-telegram:active {
        transform: translateY(0);
      }

      .bypass-gallery-view {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
        gap: 12px;
        width: 100%;
      }

      .bypass-gallery-item {
        position: relative;
        border-radius: 8px;
        overflow: hidden;
        cursor: pointer;
        transition: all 0.3s ease;
        border: 1px solid ${colors.border};
        background: ${colors.bg};
        aspect-ratio: 1;
      }

      .bypass-gallery-item:hover {
        border-color: ${colors.primary};
        box-shadow: 0 8px 24px rgba(99, 102, 241, 0.3);
        transform: scale(1.05);
      }

      .bypass-gallery-item.selected {
        border-color: ${colors.primary};
        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.4);
      }

      .bypass-gallery-item-image {
        width: 100%;
        height: 100%;
        object-fit: cover;
      }

      .bypass-gallery-item-badge {
        position: absolute;
        top: 8px;
        right: 8px;
        background: rgba(99, 102, 241, 0.9);
        color: white;
        padding: 4px 8px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.3px;
        backdrop-filter: blur(5px);
      }

      .bypass-gallery-item-overlay {
        position: absolute;
        inset: 0;
        background: linear-gradient(180deg, transparent 0%, rgba(0,0,0,0.8) 100%);
        opacity: 0;
        transition: opacity 0.3s ease;
        display: flex;
        align-items: flex-end;
        padding: 12px;
      }

      .bypass-gallery-item:hover .bypass-gallery-item-overlay {
        opacity: 1;
      }

      .bypass-gallery-item-id {
        color: white;
        font-size: 11px;
        font-weight: 600;
        word-break: break-all;
      }

      .bypass-dom-video {
        width: 100%;
        height: 100%;
        background: ${colors.bg};
        border-radius: 8px;
      }

      .bypass-item-loading {
        text-align: center;
        color: ${colors.textSecondary};
        font-size: 12px;
        padding: 8px;
        animation: pulse 2s infinite;
      }

      @keyframes pulse {
        0%, 100% { opacity: 0.6; }
        50% { opacity: 1; }
      }

      .bypass-form-group {
        display: flex;
        flex-direction: column;
        gap: 8px;
        animation: slideInUp 0.5s ease-out;
      }

      .bypass-label {
        color: ${colors.text};
        font-weight: 600;
        font-size: 13px;
        display: flex;
        align-items: center;
        gap: 10px;
        letter-spacing: 0.3px;
        position: relative;
      }

      .bypass-tooltip-icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        cursor: help;
        position: relative;
      }

      .bypass-hover-tooltip {
        position: absolute;
        bottom: 125%;
        left: 50%;
        transform: translateX(-50%);
        background: ${settings.theme === 'dark' ? '#2d2d44' : '#333333'};
        color: white;
        padding: 8px 12px;
        border-radius: 6px;
        font-size: 11px;
        white-space: normal;
        max-width: 240px;
        z-index: 10001;
        pointer-events: none;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
      }

      .bypass-checkbox {
        width: 20px;
        height: 20px;
        cursor: pointer;
        accent-color: ${colors.primary};
        transition: none;
      }

      .bypass-input,
      .bypass-select {
        background: ${colors.bgSecondary};
        border: 1px solid ${colors.border};
        color: ${colors.text};
        padding: 10px 14px;
        border-radius: 10px;
        font-size: 13px;
        transition: none;
        font-family: 'Monaco', 'Courier New', monospace;
        -webkit-appearance: none;
        appearance: none;
        user-select: text;
        -webkit-user-select: text;
      }

      .bypass-input:focus,
      .bypass-select:focus {
        outline: none;
        border-color: ${colors.primary};
        box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.15);
        background: ${colors.bg};
      }

      .bypass-input:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background: ${colors.bgTertiary};
      }

      .bypass-section-title {
        color: ${colors.text};
        font-weight: 700;
        font-size: 13px;
        text-transform: uppercase;
        letter-spacing: 0.6px;
        margin-top: 12px;
        margin-bottom: 4px;
        padding-bottom: 10px;
        border-bottom: 2px solid ${colors.border};
        display: flex;
        align-items: center;
        gap: 8px;
        cursor: pointer;
        user-select: none;
        transition: color 0.15s ease;
      }

      .bypass-section-title:hover {
        color: ${colors.primary};
      }

      .bypass-collapsible-section {
        margin-bottom: 16px;
      }

      .bypass-section-content {
        display: flex;
        flex-direction: column;
        gap: 12px;
        max-height: 1000px;
        overflow: hidden;
        transition: max-height 0.2s ease, opacity 0.2s ease;
        opacity: 1;
      }

      .bypass-section-content.collapsed {
        max-height: 0;
        opacity: 0;
        overflow: hidden;
      }

      .bypass-section-title .bypass-chevron {
        display: inline-block;
        transition: transform 0.15s ease;
        margin-left: auto;
      }

      .bypass-section-title.collapsed .bypass-chevron {
        transform: rotate(-90deg);
      }

      .bypass-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 16px;
        padding: 48px 24px;
        text-align: center;
        animation: fadeIn 0.6s ease-out;
      }

      .bypass-empty-icon {
        font-size: 56px;
        opacity: 0.25;
        animation: slideInUp 0.6s ease-out 0.2s backwards;
      }

      .bypass-empty-text {
        color: ${colors.textSecondary};
        font-size: 14px;
        line-height: 1.6;
        max-width: 280px;
        animation: slideInUp 0.6s ease-out 0.3s backwards;
      }

      .bypass-collapsed-btn {
        position: fixed;
        padding: 14px 28px;
        background: linear-gradient(135deg, ${colors.primary}, ${colors.primaryHover});
        color: white;
        border: none;
        border-radius: 50px;
        cursor: pointer;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        font-weight: 700;
        font-size: 14px;
        box-shadow: 0 10px 30px rgba(99, 102, 241, 0.35);
        z-index: 2147483647;
        transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
        display: flex;
        align-items: center;
        gap: 10px;
        bottom: 20px;
        right: 20px;
        backdrop-filter: blur(20px);
        border: 1px solid rgba(255, 255, 255, 0.2);
        animation: slideInUp 0.6s cubic-bezier(0.34, 1.56, 0.64, 1);
        pointer-events: auto;
      }

      .bypass-collapsed-btn:hover {
        transform: translateY(-6px);
        box-shadow: 0 15px 40px rgba(99, 102, 241, 0.45);
      }

      .bypass-collapsed-btn:active {
        transform: translateY(-3px);
      }

      .bypass-badge {
        position: absolute;
        top: -8px;
        right: -8px;
        background: ${colors.error};
        color: white;
        border-radius: 50%;
        width: 28px;
        height: 28px;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        font-weight: bold;
        border: 2px solid ${colors.bg};
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
      }

      .bypass-status-wrap {
        position: relative;
      }

      .bypass-status-overlay {
        position: absolute;
        top: 10px;
        right: 10px;
        display: flex;
        gap: 6px;
        align-items: center;
        padding: 6px 8px;
        border-radius: 10px;
        background: rgba(0, 0, 0, 0.55);
        color: #f1f5f9;
        font-size: 12px;
        z-index: 50;
        opacity: 0;
        transform: translateY(-6px);
        transition: all 0.2s ease;
        backdrop-filter: blur(6px);
      }

      .bypass-status-wrap:hover .bypass-status-overlay {
        opacity: 1;
        transform: translateY(0);
      }

      .bypass-status-overlay i {
        opacity: 0.9;
      }

      .bypass-blocked-wrap {
        position: relative;
      }

      .bypass-blocked-tooltip {
        position: absolute;
        bottom: calc(100% + 10px);
        left: 50%;
        transform: translateX(-50%);
        background: ${colors.bgSecondary};
        color: ${colors.text};
        border: 1px solid ${colors.border};
        border-radius: 8px;
        padding: 8px 10px;
        padding-bottom: 12px;
        font-size: 11px;
        line-height: 1.4;
        white-space: normal;
        display: inline-block;
        max-width: min(360px, 85vw);
        min-width: 220px;
        box-sizing: border-box;
        word-break: break-word;
        z-index: 120;
        opacity: 0;
        pointer-events: none;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        transition: opacity 0.2s ease, transform 0.2s ease;
      }

      .bypass-blocked-tooltip-floating {
        position: fixed;
        top: auto;
        right: auto;
        bottom: auto;
        left: auto;
        transform: none;
        pointer-events: none;
        z-index: 100000;
      }

      .bypass-blocked-wrap:hover .bypass-blocked-tooltip {
        opacity: 1;
        transform: translateX(-50%) translateY(-2px);
      }

      .bypass-tooltip-preview {
        margin-top: 8px;
        margin-bottom: 4px;
        width: 180px;
        height: 120px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid ${colors.border};
        background: ${colors.bgTertiary};
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .bypass-tooltip-preview-placeholder {
        font-size: 10px;
        color: ${colors.textSecondary};
      }

      .bypass-tooltip-preview-media {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .bypass-injected-tooltip {
        position: fixed;
        background: ${colors.bgSecondary};
        color: ${colors.text};
        border: 1px solid ${colors.border};
        border-radius: 8px;
        padding: 8px 10px;
        font-size: 11px;
        line-height: 1.4;
        max-width: min(360px, 85vw);
        z-index: 100000;
        box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
        pointer-events: none;
        opacity: 0;
        transition: opacity 0.2s ease;
      }

      .bypass-download-preview {
        margin-top: 10px;
        padding: 10px;
        border-radius: 10px;
        border: 1px solid ${colors.border};
        background: ${colors.bgSecondary};
        display: flex;
        gap: 10px;
        align-items: center;
      }

      .bypass-download-preview-media {
        width: 90px;
        height: 70px;
        border-radius: 8px;
        overflow: hidden;
        border: 1px solid ${colors.border};
        background: ${colors.bgTertiary};
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .bypass-download-preview-media img,
      .bypass-download-preview-media video {
        width: 100%;
        height: 100%;
        object-fit: cover;
        display: block;
      }

      .bypass-gallery-play {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 28px;
        color: white;
        background: radial-gradient(circle, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0) 60%);
        pointer-events: none;
      }

      @keyframes shimmer {
        0% { background-position: -1000px 0; }
        100% { background-position: 1000px 0; }
      }

      .bypass-loading-state {
        background: linear-gradient(90deg, ${colors.bgSecondary} 25%, ${colors.bgTertiary} 50%, ${colors.bgSecondary} 75%);
        background-size: 1000px 100%;
        animation: shimmer 2s infinite;
      }

      .bypass-collapsed-btn.loading {
        opacity: 0.8;
      }

      .bypass-collapsed-btn.loading span::after {
        content: '';
        animation: blink 1.4s infinite;
      }

      @keyframes blink {
        0%, 20%, 50%, 80%, 100% { opacity: 1; }
        40% { opacity: 0.5; }
        60% { opacity: 0.7; }
      }
    `;
    document.head.appendChild(style);
  }

  function injectCollapseButtonEarly() {
    // Inject styles first if not already done
    if (!document.getElementById('bypass-styles')) {
      injectStyles();
    }

    // Check if already injected
    if (document.querySelector('.bypass-collapsed-btn')) {
      return;
    }

    const attachButton = () => {
      if (document.querySelector('.bypass-collapsed-btn')) {
        return;
      }
      if (!document.body) {
        return;
      }

      const btn = document.createElement('button');
      btn.className = 'bypass-collapsed-btn loading';
      btn.innerHTML = '<i class="fas fa-shield-alt"></i> <span>Bypass</span>';
      btn.style.opacity = '0.7';
      btn.onclick = (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleExpand();
      };
      
      document.body.appendChild(btn);
    };

    if (document.body) {
      attachButton();
      return;
    }

    // If body isn't ready yet, observe and attach ASAP
    const observer = new MutationObserver(() => {
      if (document.body) {
        attachButton();
        observer.disconnect();
      }
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
  }

  function updateCollapseBtnWithItems() {
    const btn = document.querySelector('.bypass-collapsed-btn');
    if (!btn) return;

    // Remove loading state once items are loaded
    btn.classList.remove('loading');
    btn.style.opacity = '1';
    btn.style.pointerEvents = 'auto';

    if (itemsData.length > 0) {
      let badge = btn.querySelector('.bypass-badge');
      if (!badge) {
        badge = document.createElement('div');
        badge.className = 'bypass-badge';
        btn.appendChild(badge);
      }
      badge.textContent = itemsData.length;
    }
  }

  function loadItemsFromCache() {
    if (!settings.cachingEnabled || downloadUrlCache.size === 0) return false;
    const existingIds = new Set(itemsData.map(item => item.id));
    let added = 0;
    for (const [imageId, url] of downloadUrlCache.entries()) {
      if (!imageId || existingIds.has(imageId)) continue;
      itemsData.push({
        id: imageId,
        mimeType: 'image/*',
        type: 'Image',
        taskId: 'Cached',
        createdAt: null,
        expiresAt: null,
        width: null,
        height: null,
        url
      });
      blockedItems.add(imageId);
      added += 1;
    }
    if (added > 0) {
      itemsData = itemsData.sort((a, b) => b.id.localeCompare(a.id));
      updateCollapseBtnWithItems();
      return true;
    }
    return false;
  }

  function loadCachedTasksIntoItems() {
    const loaded = loadTasksFromCache();
    if (loaded) {
      itemsData = itemsData.sort((a, b) => b.id.localeCompare(a.id));
      updateCollapseBtnWithItems();
    }
  }

  function injectCacheLoadButton() {
    if (!settings.cachingEnabled) return;
    const existing = document.getElementById('bypass-cache-load-btn');
    if (existing) return;

    const btn = document.createElement('button');
    btn.id = 'bypass-cache-load-btn';
    btn.textContent = 'Load from Cache';
    btn.style.cssText = `
      position: fixed;
      right: 20px;
      bottom: 80px;
      z-index: 2147483647;
      padding: 8px 12px;
      border-radius: 8px;
      border: 1px solid #475569;
      background: #1e293b;
      color: #e2e8f0;
      font-size: 12px;
      cursor: pointer;
      opacity: 0.85;
    `;
    btn.onclick = () => {
      const loaded = loadTasksFromCache();
      if (loaded) {
        injectBlockedMediaIntoDom();
        updateUI();
      }
    };
    document.body.appendChild(btn);
  }


  async function fetchPreviews() {
    const promises = itemsData
      .filter(item => !item.url && !item.mimeType?.startsWith('video/'))
      .map(async item => {
        try {
          item.url = await downloadImage(item.id, false);
        } catch (err) {
          console.error(`Failed to fetch preview for ${item.id}: ${err}`);
          item.url = '';
        }
      });
    await Promise.all(promises);
  }

  function setupDragAndResize(el, header) {
    let isDragging = false;
    let isResizingWindow = false;
    let dragStartX = 0, dragStartY = 0;
    let dragStartLeft = 0, dragStartTop = 0;
    let resizeStartX = 0, resizeStartY = 0;
    let resizeStartWidth = 0, resizeStartHeight = 0;

    header.addEventListener('mousedown', (e) => {
      if (e.target.closest('.bypass-btn-icon')) return;
      isDragging = true;
      dragStartX = e.clientX;
      dragStartY = e.clientY;
      dragStartLeft = el.offsetLeft;
      dragStartTop = el.offsetTop;
      e.preventDefault();
      
      // Hide all tooltips when starting to drag
      document.querySelectorAll('.bypass-hover-tooltip').forEach(t => {
        t.style.opacity = '0';
        t.style.pointerEvents = 'none';
      });
    });

    const resizeHandle = el.querySelector('.bypass-resize-handle');
    if (resizeHandle) {
      resizeHandle.addEventListener('mousedown', (e) => {
        isResizingWindow = true;
        resizeStartX = e.clientX;
        resizeStartY = e.clientY;
        resizeStartWidth = el.offsetWidth;
        resizeStartHeight = el.offsetHeight;
        e.preventDefault();
        e.stopPropagation();
      });
    }

    let dragTimeout = null;
    let lastSaveTime = 0;
    document.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const deltaX = e.clientX - dragStartX;
        const deltaY = e.clientY - dragStartY;
        el.style.left = `${dragStartLeft + deltaX}px`;
        el.style.top = `${dragStartTop + deltaY}px`;
        el.style.right = 'auto';
        el.style.bottom = 'auto';
        
        // Save position every 100ms max (throttled), but UI updates every frame
        const now = Date.now();
        if (now - lastSaveTime > 100) {
          settings.position = {
            top: el.style.top,
            left: el.style.left,
            right: 'auto',
            width: el.style.width,
            height: el.style.height
          };
          localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
          lastSaveTime = now;
        }
      }
      if (isResizingWindow) {
        const deltaX = e.clientX - resizeStartX;
        const deltaY = e.clientY - resizeStartY;
        const newWidth = Math.max(300, resizeStartWidth + deltaX);
        const newHeight = Math.max(250, resizeStartHeight + deltaY);
        el.style.width = `${newWidth}px`;
        el.style.height = `${newHeight}px`;
      }
    });

    document.addEventListener('mouseup', () => {
      if (isDragging) {
        // Re-enable tooltips after drag ends
        document.querySelectorAll('.bypass-hover-tooltip').forEach(t => {
          t.style.opacity = '1';
          t.style.pointerEvents = 'auto';
        });
      }
      if (isResizingWindow) {
        settings.position = {
          ...settings.position,
          width: `${el.offsetWidth}px`,
          height: `${el.offsetHeight}px`
        };
        saveSettings();
      }
      isDragging = false;
      isResizingWindow = false;
    });
  }

  // Show confirmation dialog with warning styling
  function showConfirmDialog(message, onConfirm) {
    const overlay = document.createElement('div');
    overlay.style.cssText = `
      position: fixed; top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(5px);
      display: flex; align-items: center; justify-content: center;
      z-index: 10000; animation: fadeIn 0.3s ease-out;
    `;

    const dialog = document.createElement('div');
    dialog.style.cssText = `
      background: ${settings.theme === 'dark' ? '#1e1e2e' : '#ffffff'};
      color: ${settings.theme === 'dark' ? '#e0e0e0' : '#333333'};
      border: 2px solid #ff6b6b;
      border-radius: 12px;
      padding: 24px;
      max-width: 400px;
      box-shadow: 0 20px 60px rgba(255, 107, 107, 0.3);
      animation: slideInUp 0.3s cubic-bezier(0.4, 0, 0.2, 1);
    `;

    dialog.innerHTML = `
      <div style="display: flex; align-items: flex-start; gap: 16px; margin-bottom: 20px;">
        <i class="fas fa-exclamation-triangle" style="color: #ff6b6b; font-size: 24px; flex-shrink: 0; margin-top: 4px;"></i>
        <div style="flex: 1;">
          <h3 style="margin: 0 0 8px 0; font-size: 16px; font-weight: 600;">Confirm Action</h3>
          <p style="margin: 0; font-size: 14px; opacity: 0.8;">${message}</p>
        </div>
      </div>
      <div style="display: flex; gap: 12px; justify-content: flex-end;">
        <button class="bypass-btn bypass-btn-secondary" style="padding: 8px 16px;">Cancel</button>
        <button class="bypass-btn bypass-btn-danger" style="padding: 8px 16px;">Confirm</button>
      </div>
    `;

    const buttons = dialog.querySelectorAll('button');
    buttons[0].onclick = () => overlay.remove();
    buttons[1].onclick = () => {
      overlay.remove();
      if (onConfirm) onConfirm();
    };

    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  // Create setting label with tooltip info icon
  function createSettingLabel(text, icon, tooltip) {
    const label = document.createElement('label');
    label.className = 'bypass-label';
    label.style.display = 'flex';
    label.style.alignItems = 'center';
    label.style.gap = '8px';
    label.innerHTML = `<i class="fas ${icon}"></i> <span>${text}</span>`;
    
    if (tooltip) {
      const infoIcon = document.createElement('span');
      infoIcon.className = 'bypass-tooltip-icon';
      infoIcon.innerHTML = '<i class="fas fa-info-circle"></i>';
      infoIcon.title = tooltip;
      infoIcon.style.cssText = `
        font-size: 12px;
        opacity: 0.6;
        cursor: help;
        position: relative;
      `;
      
      // Add hover tooltip
      const createTooltip = () => {
        const tooltip = document.createElement('div');
        tooltip.className = 'bypass-hover-tooltip';
        tooltip.innerHTML = infoIcon.title;
        tooltip.style.cssText = `
          position: absolute;
          bottom: 125%;
          left: 50%;
          transform: translateX(-50%);
          background: ${settings.theme === 'dark' ? '#2d2d44' : '#333333'};
          color: white;
          padding: 8px 12px;
          border-radius: 6px;
          font-size: 11px;
          white-space: nowrap;
          z-index: 10001;
          pointer-events: none;
          opacity: 0;
          transition: opacity 0.2s ease;
          box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3);
        `;
        return tooltip;
      };
      
      let tooltip = null;
      infoIcon.onmouseenter = () => {
        if (!tooltip) {
          tooltip = createTooltip();
          infoIcon.appendChild(tooltip);
        }
        setTimeout(() => tooltip.style.opacity = '1', 10);
      };
      infoIcon.onmouseleave = () => {
        if (tooltip) {
          tooltip.style.opacity = '0';
        }
      };
      
      label.appendChild(infoIcon);
    }
    
    return label;
  }

  // Create collapsible settings section
  function createCollapsibleSection(title, icon, initialOpen = true) {
    const sectionKey = `section_${title.replace(/\s+/g, '_')}`;
    const isSectionOpen = localStorage.getItem(sectionKey) !== 'false';
    
    const section = document.createElement('div');
    section.className = 'bypass-collapsible-section';
    
    const header = document.createElement('div');
    header.className = `bypass-section-title ${!isSectionOpen ? 'collapsed' : ''}`;
    header.style.cursor = 'pointer';
    header.innerHTML = `<i class="fas ${icon}"></i> ${title} <i class="fas fa-chevron-down bypass-chevron"></i>`;
    
    const content = document.createElement('div');
    content.className = `bypass-section-content ${!isSectionOpen ? 'collapsed' : ''}`;
    
    header.onclick = () => {
      const isOpen = !content.classList.contains('collapsed');
      if (isOpen) {
        content.classList.add('collapsed');
        header.classList.add('collapsed');
        localStorage.setItem(sectionKey, 'false');
      } else {
        content.classList.remove('collapsed');
        header.classList.remove('collapsed');
        localStorage.setItem(sectionKey, 'true');
      }
    };
    
    section.appendChild(header);
    section.appendChild(content);
    
    return { section, content };
  }

  function toggleExpand() {
    isExpanded = !isExpanded;
    updateUI();
  }

  function createCollapsedButton() {
    // Check if button already exists from early injection
    let btn = document.querySelector('.bypass-collapsed-btn');
    if (btn) {
      // Update existing button with items
      updateCollapseBtnWithItems();
      return btn;
    }

    // Fallback: create new button if early injection failed
    btn = document.createElement('button');
    btn.className = 'bypass-collapsed-btn';
    btn.innerHTML = '<i class="fas fa-shield-alt"></i> <span>Bypass</span>';
    btn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleExpand();
    };
    
    if (itemsData.length > 0) {
      const badge = document.createElement('div');
      badge.className = 'bypass-badge';
      badge.textContent = itemsData.length;
      btn.appendChild(badge);
    }
    
    document.body.appendChild(btn);
    return btn;
  }

  function createTabButton(label, tabName, isActive) {
    const btn = document.createElement('button');
    btn.className = `bypass-tab ${isActive ? 'active' : ''}`;
    btn.textContent = label;
    btn.onclick = () => {
      currentTab = tabName;
      updateUI();
    };
    return btn;
  }

  function createItemCard(item) {
    const card = document.createElement('div');
    card.className = 'bypass-item-card';
    card.setAttribute('data-bypass-item-id', item.id);
    if (selectedItems.has(item.id)) {
      card.classList.add('selected');
    }
    
    const header = document.createElement('div');
    header.className = 'bypass-item-header';
    
    const id = document.createElement('div');
    id.className = 'bypass-item-id';
    id.textContent = item.id;
    
    const type = document.createElement('div');
    type.className = 'bypass-item-type';
    type.innerHTML = item.type === 'Video' ? '<i class="fas fa-video"></i> Video' : '<i class="fas fa-image"></i> Image';
    
    header.appendChild(id);
    header.appendChild(type);
    card.appendChild(header);

    // Add metadata section
    const metadata = document.createElement('div');
    metadata.style.cssText = 'display: flex; flex-direction: column; gap: 4px; padding: 8px; background: rgba(99, 102, 241, 0.05); border-radius: 4px; font-size: 11px;';
    
    if (item.taskId && item.taskId !== 'N/A') {
      const taskInfo = document.createElement('div');
      taskInfo.innerHTML = `<i class="fas fa-tasks" style="margin-right: 6px; opacity: 0.7;"></i><strong>Task ID:</strong> ${item.taskId}`;
      metadata.appendChild(taskInfo);
    }
    
    const createdTs = normalizeTimestamp(item.createdAt);
    if (createdTs) {
      const createdInfo = document.createElement('div');
      const createdDate = new Date(createdTs);
      createdInfo.innerHTML = `<i class="fas fa-calendar-plus" style="margin-right: 6px; opacity: 0.7;"></i><strong>Created:</strong> ${createdDate.toLocaleString()}`;
      metadata.appendChild(createdInfo);
    }
    
    const expiresTs = normalizeTimestamp(item.expiresAt);
    if (expiresTs) {
      const expiresInfo = document.createElement('div');
      const expiresDate = new Date(expiresTs);
      const isExpired = expiresDate < new Date();
      expiresInfo.innerHTML = `<i class="fas fa-clock" style="margin-right: 6px; opacity: 0.7;"></i><strong>Expires:</strong> ${expiresDate.toLocaleString()} ${isExpired ? '<span style="color: #ef4444;">(Expired)</span>' : ''}`;
      metadata.appendChild(expiresInfo);
    }
    
    if (item.width && item.height) {
      const sizeInfo = document.createElement('div');
      sizeInfo.innerHTML = `<i class="fas fa-expand" style="margin-right: 6px; opacity: 0.7;"></i><strong>Size:</strong> ${item.width} × ${item.height}px`;
      metadata.appendChild(sizeInfo);
    }
    
    if (metadata.children.length > 0) {
      card.appendChild(metadata);
    }

    const statusIcons = renderStatusIcons(item.id);
    if (statusIcons) {
      const statusRow = document.createElement('div');
      statusRow.style.cssText = 'display: flex; gap: 8px; align-items: center; font-size: 12px; color: #94a3b8;';
      statusRow.setAttribute('data-bypass-item-status', item.id);
      statusRow.innerHTML = `<span style="font-weight: 600;">Status:</span> ${statusIcons}`;
      card.appendChild(statusRow);
    }

    if (settings.preview && item.url && item.type !== 'Video') {
      const media = document.createElement('img');
      media.className = 'bypass-item-preview';
      media.src = item.url;
      card.appendChild(media);
    } else if (settings.preview && !item.url) {
      const loading = document.createElement('div');
      loading.className = 'bypass-item-loading';
      loading.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Loading preview...';
      card.appendChild(loading);
    } else if (settings.preview && item.type === 'Video') {
      const placeholder = document.createElement('div');
      placeholder.style.cssText = 'width: 100%; height: 180px; border-radius: 10px; background: rgba(148, 163, 184, 0.2); border: 1px solid rgba(148, 163, 184, 0.3); display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 14px; gap: 8px;';
      placeholder.innerHTML = '<i class="fas fa-play"></i> Video preview disabled';
      card.appendChild(placeholder);
    }

    // Action buttons container
    const buttonsContainer = document.createElement('div');
    buttonsContainer.className = 'bypass-item-buttons';

    const downloadBtn = document.createElement('button');
    downloadBtn.className = 'bypass-item-button bypass-item-button-download';
    downloadBtn.innerHTML = '<i class="fas fa-download"></i> Download';
    downloadBtn.onclick = async () => {
      try {
        await downloadMediaById(item.id, item.mimeType);
      } catch (err) {
        updateMediaStatus(item.id, { downloadError: true, lastError: err.message || 'Download failed' });
        alert(`Error: ${err.message}`);
      }
    };
    buttonsContainer.appendChild(downloadBtn);

    if (settings.telegramEnabled && settings.telegramChatId) {
      const telegramBtn = document.createElement('button');
      telegramBtn.className = 'bypass-item-button bypass-item-button-telegram';
      telegramBtn.title = 'Send to Telegram';
      telegramBtn.innerHTML = '<i class="fab fa-telegram"></i> Send';
      telegramBtn.onclick = async () => {
        try {
          const url = await ensureDownloadUrl(item.id);
          if (url) {
            const success = await sendToTelegram(url, item.mimeType, item.taskId, item.createdAt, `${item.width}x${item.height}`, item.id);
            if (!success) {
              updateMediaStatus(item.id, { telegramError: true, lastError: 'Telegram send failed' });
            }
            alert(success ? '✅ Sent to Telegram!' : '⚠️ Failed to send media, URL sent instead');
          }
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      };
      buttonsContainer.appendChild(telegramBtn);
    }

    if (settings.discordEnabled && settings.discordWebhook) {
      const discordBtn = document.createElement('button');
      discordBtn.className = 'bypass-item-button bypass-item-button-telegram';
      discordBtn.title = 'Send to Discord';
      discordBtn.innerHTML = '<i class="fab fa-discord"></i> Send';
      discordBtn.onclick = async () => {
        try {
          const url = await ensureDownloadUrl(item.id);
          if (url) {
            const success = await sendToDiscord(url, item.mimeType, item.taskId, item.createdAt, `${item.width}x${item.height}`, item.id);
            if (!success) {
              updateMediaStatus(item.id, { discordError: true, lastError: 'Discord send failed' });
            }
            alert(success ? '✅ Sent to Discord!' : '⚠️ Failed to send media, URL sent instead');
          }
        } catch (err) {
          alert(`Error: ${err.message}`);
        }
      };
      buttonsContainer.appendChild(discordBtn);
    }

    card.appendChild(buttonsContainer);

    card.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      if (selectedItems.size === 0) {
        (async () => {
          let url = item.url;
          if (!url) {
            url = await ensureDownloadUrl(item.id);
          }
          if (!url) return;
          openImageModal(url, item.taskId, item.createdAt, item.expiresAt, [], item.id, item.mimeType);
        })();
        return;
      }
      toggleItemSelected(item.id);
      refreshSelectionUI();
    });

    card.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showItemContextMenu(e.clientX, e.clientY, item);
    });

    return card;
  }

  function createHelpContent() {
    const helpContainer = document.createElement('div');
    helpContainer.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 16px;
      padding: 12px;
      overflow-y: auto;
      height: 100%;
    `;

    const helpSections = [
      {
        title: 'Getting Started',
        icon: 'fa-compass',
        description: `<p><strong>BypassInternet</strong> watches tensor.art responses and finds blocked items automatically. Use the <strong>Bypass</strong> floating button to open the panel.</p>
<ul>
  <li>Use <strong>Items</strong> to view, download, and manage blocked content.</li>
  <li>Use <strong>Settings</strong> for quick toggles.</li>
  <li>Use <strong>Help</strong> for detailed tips and troubleshooting.</li>
</ul>`
      },
      {
        title: 'Auto-Check for Items',
        icon: 'fa-refresh',
        description: `<p>This feature automatically monitors tensor.art for new restricted content at regular intervals.</p>
<p><strong>Enabled:</strong> The tool checks every N seconds (see Check Interval). New blocked items are detected without manual action.</p>
<p><strong>Disabled:</strong> Items are detected only when you load or refresh pages manually.</p>
<p><strong>Impact:</strong> More frequent checks increase background requests. Use longer intervals if you want lower resource usage.</p>`
      },
      {
        title: 'Check Interval (Seconds)',
        icon: 'fa-clock',
        description: `<p>Controls how often Auto-Check runs (5–300 seconds).</p>
<p><strong>Lower values:</strong> Faster detection but more network usage.</p>
<p><strong>Higher values:</strong> Slower detection but lighter on device/network.</p>
<p><strong>Tip:</strong> 30–60 seconds is a good balance for most users.</p>`
      },
      {
        title: 'Preview Media',
        icon: 'fa-eye',
        description: `<p>Shows thumbnails or previews in the Items list.</p>
<p><strong>Enabled:</strong> You can see images/videos directly in the list (more data usage).</p>
<p><strong>Disabled:</strong> Faster list loading; thumbnails only appear when opened.</p>`
      },
      {
        title: 'Auto-Download on Detect',
        icon: 'fa-download',
        description: `<p>Automatically downloads blocked items when detected.</p>
<p><strong>Enabled:</strong> Hands‑free downloads; useful for batch discovery.</p>
<p><strong>Disabled:</strong> Manual control; you choose what to download.</p>`
      },
      {
        title: 'Auto-Expand on New Items',
        icon: 'fa-expand',
        description: `<p>Opens the floating window automatically when new blocked content is found.</p>
<p><strong>Enabled:</strong> You see new items immediately.</p>
<p><strong>Disabled:</strong> The panel stays hidden until you click it.</p>`
      },
      {
        title: 'Inject On DOM',
        icon: 'fa-code',
        description: `<p>Continuously scans the page DOM for blocked items and injects bypass content.</p>
<p><strong>Enabled:</strong> Works even as new items render on the page.</p>
<p><strong>Disabled:</strong> Only processes during API response updates.</p>
<p><strong>Tip:</strong> Enable if you want live page replacement of blocked previews.</p>`
      },
      {
        title: 'Tooltip & Help Overlays',
        icon: 'fa-comment-dots',
        description: `<p>Control how tooltips behave on injected items.</p>
    <p><strong>Show Blocked Media Tooltip:</strong> Adds metadata tooltips on injected blocked slots (not in the floating window).</p>
    <p><strong>Keep Last Tooltip Open:</strong> Pins the last tooltip until you scroll or hover another item.</p>
    <p><strong>View Media on Tooltip:</strong> Shows a small image/video preview in the tooltip.</p>
    <p><strong>Injected Buttons Help Tooltip:</strong> Explains injected buttons like “Send All tasks”.</p>`
      },
      {
        title: 'Download Preview',
        icon: 'fa-image',
        description: `<p>Shows the current download in the queue with a live preview and progress indicator.</p>
    <p><strong>Enabled:</strong> Displays preview in the header progress bar and in the Download/Sent tab.</p>
    <p><strong>Tip:</strong> Great for monitoring long batch downloads.</p>`
      },
      {
        title: 'Telegram Delay',
        icon: 'fa-stopwatch',
        description: `<p>Add a delay between Telegram sends to avoid rate limits.</p>
    <p><strong>Usage:</strong> Set delay in seconds (e.g., 1–3s) for heavy batches.</p>`
      },
      {
        title: 'Auto-Detect Blocked Tasks',
        icon: 'fa-magic',
        description: `<p>NEW: Monitors workflow task creation and automatically adds blocked content when generation completes.</p>
<p><strong>Enabled:</strong> No page refresh needed! Blocked items appear instantly after generation.</p>
<p><strong>Disabled:</strong> Manual detection only through API interception.</p>
<p><strong>Tip:</strong> Keep enabled for seamless workflow experience.</p>`
      },
      {
        title: 'Telegram Integration',
        icon: 'fa-telegram',
        description: `<p>Send bypassed media directly to your Telegram chat.</p>
<p><strong>Setup:</strong> Enter Bot Token and Chat ID in tensor.art/settings.</p>
<p><strong>Features:</strong> Batch sending, retry failed items, customizable metadata captions.</p>
<p><strong>Tip:</strong> Use "Send only blocked items" toggle for filtered sending.</p>`
      },
      {
        title: 'Discord Webhooks',
        icon: 'fa-discord',
        description: `<p>NEW: Post bypassed media to Discord channels via webhooks.</p>
<p><strong>Setup:</strong> Create a webhook in Discord Server Settings → Integrations, paste URL in settings.</p>
<p><strong>Features:</strong> Rich embeds with task metadata, automatic file uploads.</p>
<p><strong>Tip:</strong> Perfect for archiving or sharing with team.</p>`
      },
      {
        title: 'Enable URL Caching',
        icon: 'fa-database',
        description: `<p>Stores download URLs locally to speed up repeated access.</p>
<p><strong>Enabled:</strong> Faster repeat downloads, fewer network calls.</p>
<p><strong>Disabled:</strong> Always fetch fresh URLs from the server.</p>
<p><strong>Tip:</strong> Keep enabled unless you need maximum freshness.</p>`
      },
      {
        title: 'Cache Duration (Days)',
        icon: 'fa-hourglass',
        description: `<p>Controls how long cached URLs remain valid (1–30 days).</p>
<p><strong>Shorter:</strong> Fresher links, more requests.</p>
<p><strong>Longer:</strong> Fewer requests, slightly higher chance of stale links.</p>
<p><strong>Default:</strong> 7 days is a good balance.</p>`
      },
      {
        title: 'Theme',
        icon: 'fa-paint-brush',
        description: `<p>Switch between dark and light themes for the floating UI.</p>
<p><strong>Dark:</strong> Comfortable at night; slightly better on OLED battery.</p>
<p><strong>Light:</strong> Better in bright environments.</p>`
      },
      {
        title: 'If Items Keep Loading',
        icon: 'fa-life-ring',
        description: `<p>If the Items tab keeps showing “waiting”, try this:</p>
<ol>
  <li>Click <strong>Create</strong> in the site header.</li>
  <li>On the creation page, click the <strong>Reload</strong> icon.</li>
  <li>This triggers the API request the tool listens to.</li>
</ol>
<p>If still empty after 15 seconds, use <strong>Load from Cache</strong> (only works when caching is enabled).</p>`
      }
    ];

    const generalInfo = document.createElement('div');
    generalInfo.style.cssText = `
      background: rgba(99, 102, 241, 0.1);
      border: 1px solid rgba(99, 102, 241, 0.3);
      border-radius: 8px;
      padding: 12px;
      margin-bottom: 12px;
      font-size: 12px;
      line-height: 1.6;
    `;
    generalInfo.innerHTML = `
      <strong style="color: #6366f1; display: block; margin-bottom: 8px;">📋 General Information & Tips</strong>
      <div>
        <p>BypassInternet runs entirely in your browser. Settings are stored locally and never sent anywhere.</p>
        <p>For advanced controls (headers, Telegram, tokens), use <strong>tensor.art/settings</strong>.</p>
        <p>Tip: Keep the floating window closed when not needed to reduce visual clutter.</p>
      </div>
    `;
    helpContainer.appendChild(generalInfo);

    helpSections.forEach(section => {
      const sectionDiv = document.createElement('div');
      sectionDiv.style.cssText = `
        background: ${settings.theme === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)'};
        border: 1px solid ${settings.theme === 'dark' ? '#475569' : '#cbd5e1'};
        border-radius: 8px;
        padding: 12px;
        margin-bottom: 12px;
      `;
      
      const titleDiv = document.createElement('div');
      titleDiv.style.cssText = `
        font-weight: 600;
        color: #6366f1;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 8px;
      `;
      titleDiv.innerHTML = `<i class="fas ${section.icon}"></i> ${section.title}`;
      
      const descDiv = document.createElement('div');
      descDiv.style.cssText = `
        font-size: 12px;
        line-height: 1.7;
        color: ${settings.theme === 'dark' ? '#cbd5e1' : '#475569'};
        white-space: pre-wrap;
        word-break: break-word;
      `;
      descDiv.innerHTML = section.description;
      
      sectionDiv.appendChild(titleDiv);
      sectionDiv.appendChild(descDiv);
      helpContainer.appendChild(sectionDiv);
    });

    return helpContainer;
  }

  async function updateUI(skipFullRebuild = false) {
    const renderToken = ++uiRenderToken;
    
    // Don't create floating window on settings page - settings are injected directly
    if (window.location.href.includes('/settings')) {
      return;
    }
    
    // If just updating items, don't rebuild entire UI
    const existingContainer = document.querySelector('.bypass-container');
    if (skipFullRebuild && existingContainer) {
      const itemList = existingContainer.querySelector('.bypass-item-list');
      if (itemList) {
        itemList.innerHTML = '';
        itemsData.forEach(item => {
          const card = createItemCard(item);
          itemList.appendChild(card);
        });
      }
      return;
    }

    injectStyles();
    await getToken();

    const collapsedBtn = document.querySelector('.bypass-collapsed-btn');

    if (!isExpanded) {
      if (existingContainer) {
        existingContainer.remove();
      }
      container = null;
      createCollapsedButton();
      if (collapsedBtn) {
        collapsedBtn.style.display = 'flex';
      }
      return;
    }

    if (collapsedBtn) {
      collapsedBtn.style.display = 'none';
    }

    // Create or reuse main container
    if (existingContainer) {
      container = existingContainer;
      container.innerHTML = '';
    } else {
      container = document.createElement('div');
      container.className = 'bypass-container';
    }
    
    const width = settings.position.width || '420px';
    const height = settings.position.height || '600px';
    
    // Position container on right or left side (only when creating)
    if (!existingContainer) {
      if (settings.position.right) {
        container.style.right = settings.position.right;
        container.style.left = 'auto';
      } else {
        container.style.left = settings.position.left;
        container.style.right = 'auto';
      }
      
      container.style.top = settings.position.top;
      container.style.width = width;
      container.style.height = height;
      container.style.transform = 'none';
      
      // Only use transform if positioned with percentages (centered)
      if (settings.position.left && settings.position.left.includes('%') && settings.position.top && settings.position.top.includes('%')) {
        container.style.transform = 'translate(-50%, -50%)';
      }
    }

    // Header
    const header = document.createElement('div');
    header.className = 'bypass-header';
    header.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; width: 100%;">
        <div>
          <h3 class="bypass-header-title">
            <i class="fas fa-shield-alt"></i>
            Bypass Manager
          </h3>
          <p style="margin: 4px 0 0 28px; font-size: 11px; opacity: 0.7; font-weight: 500;">
            <i class="fas fa-code"></i> Developer: TheFreeOne Guy | Free Internet
          </p>
        </div>
        <div class="bypass-header-actions">
          <button class="bypass-btn-icon" title="Theme" id="themeToggleBtn"><i class="fas fa-moon"></i></button>
          <button class="bypass-btn-icon" title="Collapse" id="closeBtn"><i class="fas fa-minus"></i></button>
        </div>
      </div>
    `;

    const themeToggleBtn = header.querySelector('#themeToggleBtn');
    themeToggleBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      settings.theme = settings.theme === 'dark' ? 'light' : 'dark';
      saveSettings();
      updateUI();
    };

    const closeBtn = header.querySelector('#closeBtn');
    closeBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      isExpanded = false;
      updateUI();
    };

    if (renderToken !== uiRenderToken) return;
    container.appendChild(header);

    // Tabs
    const tabs = document.createElement('div');
    tabs.className = 'bypass-tabs';
    
    const itemsTabBtn = createTabButton('Items', 'home', currentTab === 'home');
    const tasksTabBtn = createTabButton('Download/Sent', 'tasks', currentTab === 'tasks');
    const settingsTabBtn = createTabButton('Settings', 'settings', currentTab === 'settings');
    const aboutTabBtn = createTabButton('About', 'about', currentTab === 'about');
    const helpTabBtn = createTabButton('Help', 'help', currentTab === 'help');
    
    tabs.appendChild(itemsTabBtn);
    tabs.appendChild(tasksTabBtn);
    tabs.appendChild(aboutTabBtn);
    tabs.appendChild(settingsTabBtn);
    tabs.appendChild(helpTabBtn);
    if (renderToken !== uiRenderToken) return;
    container.appendChild(tabs);

    const taskStats = getTaskActionStats();
    if (taskStats.total) {
      const badge = document.createElement('span');
      badge.style.cssText = 'margin-left: 6px; background: rgba(99,102,241,0.2); color: #cbd5e1; padding: 2px 6px; border-radius: 999px; font-size: 10px;';
      badge.textContent = `${taskStats.queued + taskStats.inProgress}`;
      tasksTabBtn.appendChild(badge);
    }

    // Content - cache existing home tab to avoid reloads
    const existingContent = container.querySelector('.bypass-content');
    if (existingContent) {
      const tabKey = existingContent.getAttribute('data-bypass-tab');
      if (tabKey === 'home') {
        tabContentCache.set('home', existingContent);
      }
      existingContent.remove();
    }
    
    if (renderToken !== uiRenderToken) return;
    let content = null;
    const itemsKey = getItemsKey();
    const cachedHome = currentTab === 'home' ? tabContentCache.get('home') : null;
    let usedCachedHome = false;
    if (cachedHome && cachedHome.getAttribute('data-bypass-items-key') === itemsKey) {
      content = cachedHome;
      usedCachedHome = true;
    } else {
      content = document.createElement('div');
      content.className = 'bypass-content';
      content.setAttribute('data-bypass-tab', currentTab);
      if (currentTab === 'home') {
        content.setAttribute('data-bypass-items-key', itemsKey);
      }
    }

    if (currentTab === 'home') {
      if (usedCachedHome) {
        // use cached content
      } else if (itemsData.length === 0) {
        if (!emptyStateStart) emptyStateStart = Date.now();
        const elapsed = Date.now() - emptyStateStart;
        const showTip = elapsed >= 5000;
        const showCache = elapsed >= 15000;

        const emptyState = document.createElement('div');
        emptyState.className = 'bypass-empty-state';
        emptyState.innerHTML = `
          <div class="bypass-empty-icon"><i class="fas fa-spinner fa-spin"></i></div>
          <div class="bypass-empty-text">Loading… Waiting for blocked items</div>
          <div style="width: 100%; display: grid; gap: 12px;">
            <div class="bypass-loading-state" style="height: 80px; border-radius: 10px;"></div>
            <div class="bypass-loading-state" style="height: 80px; border-radius: 10px;"></div>
            <div class="bypass-loading-state" style="height: 80px; border-radius: 10px;"></div>
          </div>
        `;

        if (showTip) {
          const tip = document.createElement('div');
          tip.style.cssText = 'font-size: 12px; color: #cbd5e1; line-height: 1.6; max-width: 320px;';
          tip.innerHTML = `
            <strong>Tip:</strong> If it keeps waiting, go to Tensor creation page: click the <strong>Create</strong> button in the site header, then click the <strong>Reload</strong> icon on the creation page. This triggers the tool to detect blocked items.
          `;
          emptyState.appendChild(tip);
        }

        if (showCache) {
          const cacheBtn = document.createElement('button');
          cacheBtn.className = 'bypass-btn bypass-btn-secondary';
          cacheBtn.style.maxWidth = '220px';
          cacheBtn.textContent = 'Load from Cache';
          const canUseCache = settings.cachingEnabled && downloadUrlCache.size > 0;
          cacheBtn.disabled = !canUseCache;
          cacheBtn.onclick = () => {
            const loaded = loadItemsFromCache();
            if (loaded) {
              emptyStateStart = null;
              updateUI();
            }
          };
          emptyState.appendChild(cacheBtn);
        }

        content.appendChild(emptyState);
      } else {
        emptyStateStart = null;
        const existingIds = new Set(itemsData.map(item => item.id));
        selectedItems = new Set([...selectedItems].filter(id => existingIds.has(id)));

        const selectionBar = document.createElement('div');
        selectionBar.style.cssText = 'display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; padding: 10px 12px; border: 1px solid rgba(148,163,184,0.25); border-radius: 12px; background: rgba(15,23,42,0.4);';

        const selectionInfo = document.createElement('div');
        selectionInfo.setAttribute('data-bypass-selection-info', 'true');
        selectionInfo.style.cssText = 'font-size: 12px; color: #cbd5e1; font-weight: 600;';
        selectionInfo.textContent = `Selected: ${selectedItems.size} / ${itemsData.length}`;

        const selectionControls = document.createElement('div');
        selectionControls.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; align-items:center;';

        const makeMiniBtn = (label, onClick) => {
          const btn = document.createElement('button');
          btn.className = 'bypass-btn bypass-btn-secondary';
          btn.style.cssText = 'width:auto; padding:6px 10px; font-size:11px;';
          btn.textContent = label;
          btn.onclick = onClick;
          return btn;
        };

        selectionControls.appendChild(makeMiniBtn('Select All', () => { itemsData.forEach(it => setItemSelected(it.id, true)); refreshSelectionUI(); }));
        selectionControls.appendChild(makeMiniBtn('Unselect All', () => { selectedItems.clear(); refreshSelectionUI(); }));
        selectionControls.appendChild(makeMiniBtn('Images', () => { itemsData.forEach(it => setItemSelected(it.id, it.type !== 'Video' && !it.mimeType?.startsWith('video/'))); refreshSelectionUI(); }));
        selectionControls.appendChild(makeMiniBtn('Videos', () => { itemsData.forEach(it => setItemSelected(it.id, it.type === 'Video' || it.mimeType?.startsWith('video/'))); refreshSelectionUI(); }));

        const bulkActions = document.createElement('div');
        bulkActions.style.cssText = 'display:flex; gap:8px; align-items:center;';

        const getSelectedList = () => itemsData.filter(it => selectedItems.has(it.id));
        const disabled = selectedItems.size === 0;

        const actionBtn = (icon, title, onClick) => {
          const btn = document.createElement('button');
          btn.className = 'bypass-action-btn bypass-action-btn-primary';
          btn.style.width = '38px';
          btn.style.height = '38px';
          btn.title = title;
          btn.innerHTML = `<i class="${icon}"></i>`;
          btn.disabled = disabled;
          btn.setAttribute('data-bypass-bulk-action', 'true');
          btn.onclick = onClick;
          return btn;
        };

        if (settings.telegramEnabled && settings.telegramChatId) {
          bulkActions.appendChild(actionBtn('fab fa-telegram', 'Send selected to Telegram', () => {
            const list = getSelectedList();
            const allowDuplicate = !settings.preventDuplicateTasks;
            list.forEach(item => enqueueTaskAction('telegram', item.id, getItemMetaFromId(item.id), allowDuplicate));
            processTaskActionQueue();
            updateGlobalActionProgressFromQueue();
          }));
        }

        if (settings.discordEnabled && settings.discordWebhook) {
          bulkActions.appendChild(actionBtn('fab fa-discord', 'Send selected to Discord', () => {
            const list = getSelectedList();
            const allowDuplicate = !settings.preventDuplicateTasks;
            list.forEach(item => enqueueTaskAction('discord', item.id, getItemMetaFromId(item.id), allowDuplicate));
            processTaskActionQueue();
            updateGlobalActionProgressFromQueue();
          }));
        }

        bulkActions.appendChild(actionBtn('fas fa-download', 'Download selected', () => {
          const list = getSelectedList();
          const allowDuplicate = !settings.preventDuplicateTasks;
          list.forEach(item => enqueueTaskAction('download', item.id, getItemMetaFromId(item.id), allowDuplicate));
          processTaskActionQueue();
          updateGlobalActionProgressFromQueue();
        }));

        selectionBar.appendChild(selectionInfo);
        selectionBar.appendChild(selectionControls);
        selectionBar.appendChild(bulkActions);
        content.appendChild(selectionBar);

        const actionDiv = document.createElement('div');
        actionDiv.className = 'bypass-action-buttons';

        const downloadAllBtn = document.createElement('button');
        downloadAllBtn.className = 'bypass-action-btn bypass-action-btn-primary';
        downloadAllBtn.title = `Download All ${itemsData.length} Items`;
        downloadAllBtn.innerHTML = `<i class="fas fa-download"></i><span class="bypass-action-label">Download All</span>`;
        downloadAllBtn.onclick = async () => {
          showConfirmDialog(`Download ${itemsData.length} items?`, async () => {
            for (const item of itemsData) {
              try {
                await downloadMediaById(item.id, item.mimeType);
              } catch (err) {
                alert(`Error downloading ${item.id}: ${err.message}`);
              }
            }
          });
        };

        const viewModeBtn = document.createElement('button');
        viewModeBtn.className = 'bypass-action-btn bypass-action-btn-secondary';
        viewModeBtn.title = settings.viewMode === 'cards' ? 'Switch to Gallery View' : 'Switch to Cards View';
        viewModeBtn.innerHTML = settings.viewMode === 'cards' ? '<i class="fas fa-th"></i><span class="bypass-action-label">Gallery</span>' : '<i class="fas fa-list"></i><span class="bypass-action-label">Cards</span>';
        viewModeBtn.onclick = () => {
          settings.viewMode = settings.viewMode === 'cards' ? 'gallery' : 'cards';
          saveSettings();
          updateUI();
        };

        const refreshBtn = document.createElement('button');
        refreshBtn.className = 'bypass-action-btn bypass-action-btn-secondary';
        refreshBtn.title = 'Refresh Items List';
        refreshBtn.innerHTML = `<i class="fas fa-sync-alt"></i><span class="bypass-action-label">Refresh</span>`;
        refreshBtn.onclick = async () => {
          refreshBtn.disabled = true;
          refreshBtn.innerHTML = `<i class="fas fa-spinner fa-spin"></i>`;
          await new Promise(r => setTimeout(r, 1500));
          refreshBtn.innerHTML = `<i class="fas fa-sync-alt"></i><span class="bypass-action-label">Refresh</span>`;
          refreshBtn.disabled = false;
        };

        const clearBtn = document.createElement('button');
        clearBtn.className = 'bypass-action-btn bypass-action-btn-danger';
        clearBtn.title = 'Clear All Items';
        clearBtn.innerHTML = `<i class="fas fa-trash-alt"></i><span class="bypass-action-label">Clear</span>`;
        clearBtn.onclick = () => {
          showConfirmDialog('Clear all items? This cannot be undone.', () => {
            itemsData = [];
            blockedItems = new Set();
            selectedItems.clear();
            updateUI();
          });
        };

        actionDiv.appendChild(downloadAllBtn);
        actionDiv.appendChild(viewModeBtn);
        actionDiv.appendChild(refreshBtn);
        actionDiv.appendChild(clearBtn);
        content.appendChild(actionDiv);

        const stats = getTaskActionStats();
        if (stats.total && (stats.queued + stats.inProgress)) {
          const progressWrap = document.createElement('div');
          progressWrap.style.cssText = 'padding: 8px 10px; border: 1px solid rgba(148,163,184,0.25); border-radius: 10px; background: rgba(15,23,42,0.35);';
          progressWrap.setAttribute('data-bypass-home-progress', 'true');
          const progressText = document.createElement('div');
          progressText.setAttribute('data-bypass-home-progress-text', 'true');
          progressText.style.cssText = 'font-size: 11px; color: #94a3b8; margin-bottom: 6px;';
          const completed = stats.done + stats.failed;
          if (stats.current) {
            progressText.textContent = `Processing ${stats.current.action.toUpperCase()} • ${stats.current.imageId} (${completed}/${stats.total})`;
          } else {
            progressText.textContent = `Queued ${stats.queued} • Done ${stats.done} • Failed ${stats.failed}`;
          }
          const progressBar = document.createElement('div');
          progressBar.style.cssText = 'height: 6px; background: rgba(148,163,184,0.25); border-radius: 999px; overflow: hidden;';
          const progressFill = document.createElement('div');
          progressFill.setAttribute('data-bypass-home-progress-bar', 'true');
          progressFill.style.cssText = `height: 100%; width: ${stats.total ? Math.round((completed / stats.total) * 100) : 0}%; background: linear-gradient(135deg, #6366f1, #8b5cf6);`;
          progressBar.appendChild(progressFill);

          progressWrap.appendChild(progressText);
          progressWrap.appendChild(progressBar);

          const previewHost = document.createElement('div');
          previewHost.setAttribute('data-bypass-home-progress-preview', 'true');
          progressWrap.appendChild(previewHost);

          if (settings.showDownloadPreview && stats.current && ['download', 'telegram', 'discord'].includes(stats.current.action)) {
            const previewRow = document.createElement('div');
            previewRow.className = 'bypass-download-preview';
            previewRow.style.marginTop = '10px';

            const mediaWrap = document.createElement('div');
            mediaWrap.className = 'bypass-download-preview-media';
            mediaWrap.textContent = 'Loading...';

            const info = document.createElement('div');
            info.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:11px; color:#94a3b8;';
            const actionLabel = stats.current.action === 'telegram'
              ? 'Sending to Telegram'
              : stats.current.action === 'discord'
                ? 'Sending to Discord'
                : 'Downloading';
            info.innerHTML = `<div><strong style="color:#cbd5e1;">${actionLabel}</strong></div><div>ID: ${stats.current.imageId}</div>`;

            previewRow.appendChild(mediaWrap);
            previewRow.appendChild(info);
            previewHost.appendChild(previewRow);

            const currentId = stats.current.imageId;
            if (downloadPreviewCache.imageId === currentId && downloadPreviewCache.url) {
              mediaWrap.innerHTML = '';
              if (stats.current.mimeType?.startsWith('video/')) {
                const vid = document.createElement('video');
                vid.src = downloadPreviewCache.url;
                vid.muted = true;
                vid.autoplay = true;
                vid.loop = true;
                vid.playsInline = true;
                mediaWrap.appendChild(vid);
              } else {
                const img = document.createElement('img');
                img.src = downloadPreviewCache.url;
                mediaWrap.appendChild(img);
              }
            } else {
              downloadPreviewCache = { imageId: currentId, url: null, mimeType: stats.current.mimeType || '' };
              ensureDownloadUrl(currentId).then(url => {
                if (downloadPreviewCache.imageId !== currentId) return;
                downloadPreviewCache.url = url;
                mediaWrap.innerHTML = '';
                if (!url) {
                  mediaWrap.textContent = 'Preview unavailable';
                  return;
                }
                if (stats.current.mimeType?.startsWith('video/')) {
                  const vid = document.createElement('video');
                  vid.src = url;
                  vid.muted = true;
                  vid.autoplay = true;
                  vid.loop = true;
                  vid.playsInline = true;
                  mediaWrap.appendChild(vid);
                } else {
                  const img = document.createElement('img');
                  img.src = url;
                  mediaWrap.appendChild(img);
                }
              });
            }
          }

          content.appendChild(progressWrap);
        }

        // Items list or gallery
        if (settings.preview) {
          await fetchPreviews();
          if (renderToken !== uiRenderToken) return;
        }

        if (settings.viewMode === 'gallery') {
          const gallery = document.createElement('div');
          gallery.style.cssText = 'display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 12px; width: 100%;';
          
          itemsData.forEach(item => {
            const galleryItem = document.createElement('div');
            galleryItem.className = 'bypass-gallery-item';
            galleryItem.style.cursor = 'pointer';
            galleryItem.setAttribute('data-bypass-item-id', item.id);
            if (selectedItems.has(item.id)) {
              galleryItem.classList.add('selected');
            }

            const isVideo = item.type === 'Video' || item.mimeType?.startsWith('video/');
            const placeholder = () => {
              const ph = document.createElement('div');
              ph.style.cssText = 'width: 100%; height: 150px; background: #334155; display: flex; align-items: center; justify-content: center; color: #cbd5e1;';
              ph.innerHTML = isVideo ? '<i class="fas fa-video"></i>' : '<i class="fas fa-image"></i>';
              return ph;
            };

            if (settings.preview && item.url && !isVideo) {
              const img = document.createElement('img');
              img.src = item.url;
              img.style.cssText = 'width: 100%; height: 150px; object-fit: cover;';
              img.onerror = () => {
                if (img.parentElement) {
                  img.parentElement.replaceChild(placeholder(), img);
                }
              };
              galleryItem.appendChild(img);
            } else {
              galleryItem.appendChild(placeholder());
            }

            if (isVideo) {
              const play = document.createElement('div');
              play.className = 'bypass-gallery-play';
              play.innerHTML = '<i class="fas fa-play"></i>';
              galleryItem.appendChild(play);
            }
            
            const badge = document.createElement('div');
            badge.style.cssText = 'position: absolute; top: 8px; right: 8px; background: #6366f1; color: white; padding: 4px 8px; border-radius: 4px; font-size: 11px; font-weight: 600;';
            badge.textContent = item.type;
            galleryItem.appendChild(badge);

            const statusIcons = renderStatusIcons(item.id);
            if (statusIcons) {
              const statusBadge = document.createElement('div');
              statusBadge.style.cssText = 'position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,0.6); color: white; padding: 4px 6px; border-radius: 6px; font-size: 11px; display: flex; gap: 6px; align-items: center;';
              statusBadge.setAttribute('data-bypass-gallery-status', item.id);
              statusBadge.innerHTML = statusIcons;
              galleryItem.appendChild(statusBadge);
            }

            galleryItem.onclick = async () => {
              if (selectedItems.size > 0) {
                toggleItemSelected(item.id);
                refreshSelectionUI();
                return;
              }
              if (isVideo && !settings.showVideoModal) {
                await downloadMediaById(item.id, item.mimeType);
                return;
              }
              let url = item.url;
              if (!url) {
                url = await ensureDownloadUrl(item.id);
              }
              if (!url) return;
              openImageModal(url, item.taskId, item.createdAt, item.expiresAt, [], item.id, item.mimeType);
            };
            galleryItem.onmouseover = () => galleryItem.style.borderColor = '#6366f1';
            galleryItem.onmouseout = () => galleryItem.style.borderColor = '#475569';

            galleryItem.addEventListener('contextmenu', (e) => {
              e.preventDefault();
              showItemContextMenu(e.clientX, e.clientY, item);
            });
            
            gallery.appendChild(galleryItem);
          });
          
          content.appendChild(gallery);
        } else {
          itemsData.forEach(item => {
            content.appendChild(createItemCard(item));
          });
        }
      }
      if (currentTab === 'home') {
        content.setAttribute('data-bypass-tab', 'home');
        content.setAttribute('data-bypass-items-key', itemsKey);
        tabContentCache.set('home', content);
      }
    } else if (currentTab === 'tasks') {
      const cache = loadTaskActions();
      const actions = cache.items;
      const stats = getTaskActionStats();

      if (stats.total) {
        const progressWrap = document.createElement('div');
        progressWrap.style.cssText = 'padding: 8px 10px; border: 1px solid rgba(148,163,184,0.25); border-radius: 10px; background: rgba(15,23,42,0.35);';
        const progressText = document.createElement('div');
        progressText.setAttribute('data-bypass-tasks-progress-text', 'true');
        progressText.style.cssText = 'font-size: 11px; color: #94a3b8; margin-bottom: 6px;';
        const completed = stats.done + stats.failed;
        if (stats.current) {
          progressText.textContent = `Processing ${stats.current.action.toUpperCase()} • ${stats.current.imageId} (${completed}/${stats.total})`;
        } else {
          progressText.textContent = `Queued ${stats.queued} • Done ${stats.done} • Failed ${stats.failed}`;
        }
        const progressBar = document.createElement('div');
        progressBar.style.cssText = 'height: 6px; background: rgba(148,163,184,0.25); border-radius: 999px; overflow: hidden;';
        const progressFill = document.createElement('div');
        progressFill.setAttribute('data-bypass-tasks-progress-bar', 'true');
        progressFill.style.cssText = `height: 100%; width: ${stats.total ? Math.round((completed / stats.total) * 100) : 0}%; background: linear-gradient(135deg, #6366f1, #8b5cf6);`;
        progressBar.appendChild(progressFill);

        progressWrap.appendChild(progressText);
        progressWrap.appendChild(progressBar);

        const previewHost = document.createElement('div');
        previewHost.setAttribute('data-bypass-tasks-progress-preview', 'true');
        progressWrap.appendChild(previewHost);

        if (settings.showDownloadPreview && stats.current && ['download', 'telegram', 'discord'].includes(stats.current.action)) {
          const previewRow = document.createElement('div');
          previewRow.className = 'bypass-download-preview';
          previewRow.style.marginTop = '10px';

          const mediaWrap = document.createElement('div');
          mediaWrap.className = 'bypass-download-preview-media';
          mediaWrap.textContent = 'Loading...';

          const info = document.createElement('div');
          info.style.cssText = 'display:flex; flex-direction:column; gap:4px; font-size:11px; color:#94a3b8;';
          const actionLabel = stats.current.action === 'telegram'
            ? 'Sending to Telegram'
            : stats.current.action === 'discord'
              ? 'Sending to Discord'
              : 'Downloading';
          info.innerHTML = `<div><strong style="color:#cbd5e1;">${actionLabel}</strong></div><div>ID: ${stats.current.imageId}</div>`;

          previewRow.appendChild(mediaWrap);
          previewRow.appendChild(info);
          previewHost.appendChild(previewRow);

          const currentId = stats.current.imageId;
          if (downloadPreviewCache.imageId === currentId && downloadPreviewCache.url) {
            mediaWrap.innerHTML = '';
            if (stats.current.mimeType?.startsWith('video/')) {
              const vid = document.createElement('video');
              vid.src = downloadPreviewCache.url;
              vid.muted = true;
              vid.autoplay = true;
              vid.loop = true;
              vid.playsInline = true;
              mediaWrap.appendChild(vid);
            } else {
              const img = document.createElement('img');
              img.src = downloadPreviewCache.url;
              mediaWrap.appendChild(img);
            }
          } else {
            downloadPreviewCache = { imageId: currentId, url: null, mimeType: stats.current.mimeType || '' };
            ensureDownloadUrl(currentId).then(url => {
              if (downloadPreviewCache.imageId !== currentId) return;
              downloadPreviewCache.url = url;
              mediaWrap.innerHTML = '';
              if (!url) {
                mediaWrap.textContent = 'Preview unavailable';
                return;
              }
              if (stats.current.mimeType?.startsWith('video/')) {
                const vid = document.createElement('video');
                vid.src = url;
                vid.muted = true;
                vid.autoplay = true;
                vid.loop = true;
                vid.playsInline = true;
                mediaWrap.appendChild(vid);
              } else {
                const img = document.createElement('img');
                img.src = url;
                mediaWrap.appendChild(img);
              }
            });
          }
        }

        content.appendChild(progressWrap);
      }

      const headerRow = document.createElement('div');
      headerRow.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:12px;';
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:600; font-size:13px;';
      title.textContent = 'Task Actions Queue';
      const controls = document.createElement('div');
      controls.style.cssText = 'display:flex; gap:8px; align-items:center;';

      const pauseBtn = document.createElement('button');
      pauseBtn.className = 'bypass-btn bypass-btn-secondary';
      pauseBtn.style.width = 'auto';
      pauseBtn.textContent = cache.paused ? 'Resume All' : 'Pause All';
      pauseBtn.onclick = () => {
        cache.paused = !cache.paused;
        saveTaskActions();
        if (!cache.paused) processTaskActionQueue();
        updateUI();
      };

      const clearBtn = document.createElement('button');
      clearBtn.className = 'bypass-btn bypass-btn-danger';
      clearBtn.style.width = 'auto';
      clearBtn.textContent = 'Clear All';
      clearBtn.onclick = () => {
        cache.items = [];
        saveTaskActions();
        updateUI();
      };

      controls.appendChild(pauseBtn);
      controls.appendChild(clearBtn);
      headerRow.appendChild(title);
      headerRow.appendChild(controls);
      content.appendChild(headerRow);

      if (!actions.length) {
        const empty = document.createElement('div');
        empty.style.cssText = 'padding: 20px; font-size: 12px; color: #94a3b8;';
        empty.textContent = 'No queued or completed actions yet.';
        content.appendChild(empty);
      } else {
        actions.forEach((entry, index) => {
          const row = document.createElement('div');
          row.setAttribute('data-bypass-task-row', `${entry.action}:${entry.imageId}`);
          row.style.cssText = 'padding: 10px 12px; border: 1px solid rgba(148,163,184,0.25); border-radius: 8px; display:flex; flex-direction:column; gap:6px;';
          row.setAttribute('draggable', 'true');
          row.dataset.index = String(index);
          if (entry.status === 'failed') {
            row.style.borderColor = '#ef4444';
            row.style.background = 'rgba(239, 68, 68, 0.08)';
          }

          const top = document.createElement('div');
          top.style.cssText = 'display:flex; align-items:center; justify-content:space-between; gap:8px;';
          top.innerHTML = `
            <div style="font-size:12px; font-weight:600;">${entry.action.toUpperCase()} • ${entry.imageId}</div>
            <div style="font-size:11px; color:#94a3b8;" data-bypass-task-status>${entry.status}</div>
          `;

          const meta = document.createElement('div');
          meta.style.cssText = 'font-size:11px; color:#94a3b8;';
          meta.textContent = entry.taskId ? `Task: ${entry.taskId}` : 'Task: N/A';

          const errorLine = document.createElement('div');
          errorLine.setAttribute('data-bypass-task-error', 'true');
          errorLine.style.cssText = 'font-size:11px; color:#ef4444;';
          if (entry.status === 'failed' && entry.error) {
            errorLine.textContent = `Error: ${entry.error}`;
          } else {
            errorLine.style.display = 'none';
          }
          meta.appendChild(errorLine);

          const buttons = document.createElement('div');
          buttons.style.cssText = 'display:flex; gap:6px; align-items:center; flex-wrap:wrap;';

          const retryBtn = document.createElement('button');
          retryBtn.className = 'bypass-btn bypass-btn-secondary';
          retryBtn.style.width = 'auto';
          retryBtn.style.padding = '6px 10px';
          retryBtn.textContent = 'Retry';
          retryBtn.onclick = () => {
            entry.status = 'queued';
            saveTaskActions();
            processTaskActionQueue();
            updateUI();
          };

          const deleteBtn = document.createElement('button');
          deleteBtn.className = 'bypass-btn bypass-btn-danger';
          deleteBtn.style.width = 'auto';
          deleteBtn.style.padding = '6px 10px';
          deleteBtn.textContent = 'Delete';
          deleteBtn.onclick = () => {
            cache.items.splice(index, 1);
            saveTaskActions();
            updateUI();
          };

          const upBtn = document.createElement('button');
          upBtn.className = 'bypass-btn bypass-btn-secondary';
          upBtn.style.width = 'auto';
          upBtn.style.padding = '6px 10px';
          upBtn.textContent = '↑';
          upBtn.onclick = () => {
            if (index === 0) return;
            [cache.items[index - 1], cache.items[index]] = [cache.items[index], cache.items[index - 1]];
            saveTaskActions();
            updateUI();
          };

          const downBtn = document.createElement('button');
          downBtn.className = 'bypass-btn bypass-btn-secondary';
          downBtn.style.width = 'auto';
          downBtn.style.padding = '6px 10px';
          downBtn.textContent = '↓';
          downBtn.onclick = () => {
            if (index === cache.items.length - 1) return;
            [cache.items[index + 1], cache.items[index]] = [cache.items[index], cache.items[index + 1]];
            saveTaskActions();
            updateUI();
          };

          buttons.appendChild(upBtn);
          buttons.appendChild(downBtn);
          buttons.appendChild(retryBtn);
          buttons.appendChild(deleteBtn);

          row.appendChild(top);
          row.appendChild(meta);
          row.appendChild(buttons);
          content.appendChild(row);

          row.addEventListener('dragstart', (e) => {
            e.dataTransfer.setData('text/plain', row.dataset.index || '');
            row.style.opacity = '0.6';
          });
          row.addEventListener('dragend', () => {
            row.style.opacity = '1';
          });
          row.addEventListener('dragover', (e) => {
            e.preventDefault();
            row.style.borderColor = '#6366f1';
          });
          row.addEventListener('dragleave', () => {
            row.style.borderColor = 'rgba(148,163,184,0.25)';
          });
          row.addEventListener('drop', (e) => {
            e.preventDefault();
            row.style.borderColor = 'rgba(148,163,184,0.25)';
            const fromIndex = Number(e.dataTransfer.getData('text/plain'));
            const toIndex = Number(row.dataset.index);
            if (Number.isNaN(fromIndex) || Number.isNaN(toIndex) || fromIndex === toIndex) return;
            const moved = cache.items.splice(fromIndex, 1)[0];
            cache.items.splice(toIndex, 0, moved);
            saveTaskActions();
            updateUI();
          });
        });
      }
    } else if (currentTab === 'settings') {
      // Settings form (checkbox-only)
      const form = document.createElement('div');
      form.style.display = 'flex';
      form.style.flexDirection = 'column';
      form.style.gap = '12px';

      const infoNote = document.createElement('div');
      infoNote.style.cssText = `
        background: rgba(99, 102, 241, 0.1);
        border: 1px solid rgba(99, 102, 241, 0.3);
        border-radius: 8px;
        padding: 12px;
        font-size: 12px;
        line-height: 1.5;
      `;
      infoNote.innerHTML = '<strong style="color: #6366f1; display: block; margin-bottom: 6px;">⚙️ Advanced Settings</strong>For network headers, Telegram integration, user tokens, and more detailed settings, visit <strong>tensor.art/settings</strong>.';
      form.appendChild(infoNote);

      const settingsCheckboxes = [
        { id: 'preview', label: 'Preview Media', value: settings.preview, icon: 'fa-eye', tooltip: 'Load and display thumbnail previews of blocked items (videos are deferred)' },
        { id: 'autoDownload', label: 'Auto-download on Detect', value: settings.autoDownload, icon: 'fa-download', tooltip: 'Automatically download images when they are detected as blocked' },
        { id: 'autoShowPanel', label: 'Auto-show Panel on Detect', value: settings.autoShowPanel, icon: 'fa-expand', tooltip: 'Show the floating panel when new blocked items are detected' },
        { id: 'autoTaskDetection', label: 'Auto-detect Blocked Tasks', value: settings.autoTaskDetection, icon: 'fa-magic', tooltip: 'Automatically adds blocked items when generation completes (no refresh needed)' }
      ];

      settingsCheckboxes.forEach(checkbox => {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '8px';
        
        const input = document.createElement('input');
        input.className = 'bypass-checkbox';
        input.type = 'checkbox';
        input.checked = checkbox.value;
        input.onchange = () => {
          settings[checkbox.id] = input.checked;
          if (checkbox.id === 'injectOnDom' && input.checked) {
            settings.safeViewMode = false;
          }
          if (checkbox.id === 'safeViewMode' && input.checked) {
            settings.injectOnDom = false;
          }
          localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
          if (checkbox.id === 'preview' && input.checked) {
            fetchPreviews();
          }
          if (checkbox.id === 'autoTaskDetection') {
            if (settings.autoTaskDetection) {
              startTaskMonitoring();
            } else {
              stopTaskMonitoring();
            }
          }
          if (checkbox.id === 'injectOnDom') {
            if (settings.injectOnDom) {
              startDomInjectionWatcher();
            } else {
              stopDomInjectionWatcher();
            }
          }
          if (checkbox.id === 'safeViewMode') {
            if (settings.safeViewMode) {
              startDomInjectionWatcher();
            } else if (!settings.injectOnDom) {
              stopDomInjectionWatcher();
            }
            updateUI();
          }
          if (checkbox.id === 'injectOnDom') {
            updateUI();
          }
        };
        
        const label = document.createElement('label');
        label.style.cssText = 'flex: 1; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 6px;';
        label.innerHTML = `<i class="fas ${checkbox.icon}"></i> ${checkbox.label}`;
        label.onclick = () => input.click();

        const infoIcon = document.createElement('span');
        infoIcon.className = 'bypass-tooltip-icon';
        infoIcon.innerHTML = '<i class="fas fa-info-circle"></i>';
        infoIcon.style.cssText = 'font-size: 12px; opacity: 0.6; cursor: help; margin-left: auto; position: relative;';
        infoIcon.title = checkbox.tooltip;
        attachInfoTooltip(infoIcon, checkbox.tooltip);

        container.appendChild(input);
        container.appendChild(label);
        container.appendChild(infoIcon);
        form.appendChild(container);
      });

      const injectionSection = createCollapsibleSection('Injection Method', 'fa-code', true);
      const injectionOptions = [
        { id: 'safeViewMode', label: 'Safe View Blocked Media', value: settings.safeViewMode, icon: 'fa-eye-slash', tooltip: 'Keep blocked covers and add a Bypass View button to reveal on demand (mutually exclusive with Inject On DOM)' },
        { id: 'injectOnDom', label: 'Inject On DOM', value: settings.injectOnDom, icon: 'fa-code', tooltip: 'Replace blocked media directly with bypassed content (mutually exclusive with Safe View)' }
      ];

      injectionOptions.forEach(option => {
        const container = document.createElement('div');
        container.style.display = 'flex';
        container.style.alignItems = 'center';
        container.style.gap = '8px';

        const input = document.createElement('input');
        input.className = 'bypass-checkbox';
        input.type = 'checkbox';
        input.checked = option.value;
        input.onchange = () => {
          settings[option.id] = input.checked;
          if (option.id === 'injectOnDom' && input.checked) {
            settings.safeViewMode = false;
          }
          if (option.id === 'safeViewMode' && input.checked) {
            settings.injectOnDom = false;
          }
          saveSettings();
          if (option.id === 'injectOnDom') {
            if (settings.injectOnDom) {
              startDomInjectionWatcher();
            } else if (!settings.safeViewMode) {
              stopDomInjectionWatcher();
            }
          }
          if (option.id === 'safeViewMode') {
            if (settings.safeViewMode) {
              startDomInjectionWatcher();
            } else if (!settings.injectOnDom) {
              stopDomInjectionWatcher();
            }
          }
          injectBlockedMediaIntoDom();
          updateUI();
        };

        const label = document.createElement('label');
        label.style.cssText = 'flex: 1; cursor: pointer; font-size: 14px; display: flex; align-items: center; gap: 6px;';
        label.innerHTML = `<i class="fas ${option.icon}"></i> ${option.label}`;
        label.onclick = () => input.click();

        const infoIcon = document.createElement('span');
        infoIcon.className = 'bypass-tooltip-icon';
        infoIcon.innerHTML = '<i class="fas fa-info-circle"></i>';
        infoIcon.style.cssText = 'font-size: 12px; opacity: 0.6; cursor: help; margin-left: auto; position: relative;';
        infoIcon.title = option.tooltip;
        attachInfoTooltip(infoIcon, option.tooltip);

        container.appendChild(input);
        container.appendChild(label);
        container.appendChild(infoIcon);
        injectionSection.content.appendChild(container);
      });

      form.appendChild(injectionSection.section);

      const uiSection = createCollapsibleSection('UI Settings', 'fa-sliders-h', true);
      const uiOptions = [
        { id: 'inheritTheme', label: 'Inherit Page Theme', value: settings.inheritTheme, tooltip: 'Match the site color palette and background automatically' },
        { id: 'showVideoModal', label: 'Enable Video Modal', value: settings.showVideoModal, tooltip: 'Open videos in the preview dialog (disabled by default)' },
        { id: 'showBlockedTooltip', label: 'Show Blocked Media Tooltip', value: settings.showBlockedTooltip, tooltip: 'Show extra info when hovering blocked media (only on injected items)' },
        { id: 'showInjectedHelpTooltips', label: 'Injected Buttons Help Tooltip', value: settings.showInjectedHelpTooltips, tooltip: 'Show detailed hover tooltips on injected buttons when Inject On DOM is enabled' },
        { id: 'showDownloadPreview', label: 'Preview Current Download', value: settings.showDownloadPreview, tooltip: 'Show a live preview of the current download in the queue' }
      ];

      if (settings.showBlockedTooltip) {
        uiOptions.push({
          id: 'showBlockedTooltipPreview',
          label: 'View Media on Tooltip',
          value: settings.showBlockedTooltipPreview,
          tooltip: 'Show a small image/video preview inside the blocked media tooltip'
        });
      }

      if (settings.showBlockedTooltip) {
        uiOptions.push({
          id: 'keepBlockedTooltipOpen',
          label: 'Keep Last Tooltip Open',
          value: settings.keepBlockedTooltipOpen,
          tooltip: 'Keep the last blocked-media tooltip open until you scroll or hover another item'
        });
      }

      uiOptions.forEach(option => {
        const row = document.createElement('label');
        row.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px;';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'bypass-checkbox';
        input.checked = option.value;
        input.onchange = () => {
          settings[option.id] = input.checked;
          saveSettings();
          if (option.id === 'inheritTheme') {
            injectStyles();
            updateUI();
          }
          if (option.id === 'showBlockedTooltip' || option.id === 'showBlockedTooltipPreview' || option.id === 'keepBlockedTooltipOpen') {
            updateUI();
            injectBlockedMediaIntoDom();
          }
          if (option.id === 'showInjectedHelpTooltips') {
            injectBlockedMediaIntoDom();
          }
          if (option.id === 'showDownloadPreview') {
            updateGlobalActionProgressFromQueue();
          }
        };
        const label = document.createElement('span');
        label.textContent = option.label;
        row.appendChild(input);
        row.appendChild(label);
        if (option.tooltip) {
          const info = document.createElement('span');
          info.className = 'bypass-tooltip-icon';
          info.innerHTML = '<i class="fas fa-info-circle"></i>';
          info.title = option.tooltip;
          attachInfoTooltip(info, option.tooltip);
          row.appendChild(info);
        }
        uiSection.content.appendChild(row);
      });

      form.appendChild(uiSection.section);

      const taskSection = createCollapsibleSection('Task Actions', 'fa-tasks', true);
      const taskOptions = [];
      if (settings.telegramEnabled) {
        taskOptions.push({ id: 'sendAllTasksTelegram', label: 'Telegram: Send all tasks', value: settings.sendAllTasksTelegram, tooltip: 'Show the global “Send all tasks to Telegram” button on the page' });
      }
      if (settings.discordEnabled) {
        taskOptions.push({ id: 'sendAllTasksDiscord', label: 'Discord: Send all tasks', value: settings.sendAllTasksDiscord, tooltip: 'Show the global “Send all tasks to Discord” button on the page' });
      }
      taskOptions.push({ id: 'sendAllTasksDownload', label: 'Download all tasks', value: settings.sendAllTasksDownload, tooltip: 'Show the global “Download all tasks” button on the page' });
      taskOptions.push({ id: 'preventDuplicateTasks', label: 'Prevent duplicate actions', value: settings.preventDuplicateTasks, tooltip: 'Skip items already sent/downloaded when using global actions' });

      taskOptions.forEach(option => {
        const row = document.createElement('label');
        row.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 13px;';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.className = 'bypass-checkbox';
        input.checked = option.value;
        input.onchange = () => {
          settings[option.id] = input.checked;
          saveSettings();
          updateUI();
          injectBlockedMediaIntoDom();
        };
        const label = document.createElement('span');
        label.textContent = option.label;
        row.appendChild(input);
        row.appendChild(label);
        if (option.tooltip) {
          const info = document.createElement('span');
          info.className = 'bypass-tooltip-icon';
          info.innerHTML = '<i class="fas fa-info-circle"></i>';
          info.title = option.tooltip;
          attachInfoTooltip(info, option.tooltip);
          row.appendChild(info);
        }
        taskSection.content.appendChild(row);
      });

      form.appendChild(taskSection.section);

      const autoCheckLabel = document.createElement('label');
      autoCheckLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px; margin-top: 8px;';
      const autoCheckInput = document.createElement('input');
      autoCheckInput.className = 'bypass-checkbox';
      autoCheckInput.type = 'checkbox';
      autoCheckInput.checked = settings.autoCheck;
      autoCheckInput.onchange = () => {
        settings.autoCheck = autoCheckInput.checked;
        localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
        if (settings.autoCheck) {
          startAutoCheck();
        } else {
          stopAutoCheck();
        }
        updateUI();
      };
      autoCheckLabel.appendChild(autoCheckInput);
      autoCheckLabel.appendChild(document.createTextNode('Auto-check for Items'));
      form.appendChild(autoCheckLabel);

      if (settings.autoCheck) {
        const intervalGroup = document.createElement('div');
        intervalGroup.className = 'bypass-form-group';
        const intervalLabel = document.createElement('label');
        intervalLabel.className = 'bypass-label';
        intervalLabel.setAttribute('for', 'checkInterval');
        intervalLabel.innerHTML = '<i class="fas fa-clock"></i> Check Interval (seconds)';
        const intervalInput = document.createElement('input');
        intervalInput.className = 'bypass-input';
        intervalInput.type = 'number';
        intervalInput.id = 'checkInterval';
        intervalInput.name = 'checkInterval';
        intervalInput.min = '5';
        intervalInput.max = '300';
        intervalInput.step = '5';
        intervalInput.value = settings.autoCheckInterval;
        intervalInput.onclick = (e) => e.stopPropagation();
        intervalInput.onchange = () => {
          settings.autoCheckInterval = Math.max(5, parseInt(intervalInput.value) || 30);
          localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
          startAutoCheck();
        };
        intervalGroup.appendChild(intervalLabel);
        intervalGroup.appendChild(intervalInput);
        form.appendChild(intervalGroup);
      }

      const themeGroup = document.createElement('div');
      themeGroup.className = 'bypass-form-group';
      const themeLabel = document.createElement('label');
      themeLabel.className = 'bypass-label';
      themeLabel.setAttribute('for', 'themeSelect');
      themeLabel.innerHTML = '<i class="fas fa-palette"></i> Theme';
      const themeSelect = document.createElement('select');
      themeSelect.className = 'bypass-select';
      themeSelect.id = 'themeSelect';
      themeSelect.name = 'theme';
      themeSelect.onclick = (e) => e.stopPropagation();
      ['dark', 'light'].forEach(th => {
        const opt = document.createElement('option');
        opt.value = th;
        opt.textContent = th.charAt(0).toUpperCase() + th.slice(1);
        if (th === settings.theme) opt.selected = true;
        themeSelect.appendChild(opt);
      });
      themeSelect.onchange = () => {
        settings.theme = themeSelect.value;
        saveSettings();
        updateUI();
      };
      themeGroup.appendChild(themeLabel);
      themeGroup.appendChild(themeSelect);
      form.appendChild(themeGroup);

      const cachingLabel = document.createElement('label');
      cachingLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; cursor: pointer; font-size: 14px;';
      const cachingInput = document.createElement('input');
      cachingInput.className = 'bypass-checkbox';
      cachingInput.type = 'checkbox';
      cachingInput.checked = settings.cachingEnabled;
      cachingInput.onchange = () => {
        settings.cachingEnabled = cachingInput.checked;
        saveSettings();
        updateUI();
      };
      cachingLabel.appendChild(cachingInput);
      cachingLabel.appendChild(document.createTextNode('Enable URL Caching'));
      form.appendChild(cachingLabel);

      if (settings.cachingEnabled) {
        const cacheDurationGroup = document.createElement('div');
        cacheDurationGroup.className = 'bypass-form-group';
        const cacheDurationLabel = document.createElement('label');
        cacheDurationLabel.className = 'bypass-label';
        cacheDurationLabel.setAttribute('for', 'cacheDuration');
        cacheDurationLabel.innerHTML = '<i class="fas fa-hourglass"></i> Cache Duration (Days)';
        const cacheDurationInput = document.createElement('input');
        cacheDurationInput.className = 'bypass-input';
        cacheDurationInput.type = 'number';
        cacheDurationInput.id = 'cacheDuration';
        cacheDurationInput.name = 'cacheDuration';
        cacheDurationInput.min = '1';
        cacheDurationInput.max = '30';
        cacheDurationInput.value = settings.cacheDuration;
        cacheDurationInput.onclick = (e) => e.stopPropagation();
        cacheDurationInput.onchange = () => {
          settings.cacheDuration = Math.max(1, parseInt(cacheDurationInput.value) || 7);
          localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
        };
        cacheDurationGroup.appendChild(cacheDurationLabel);
        cacheDurationGroup.appendChild(cacheDurationInput);
        form.appendChild(cacheDurationGroup);
      }

      content.appendChild(form);
    } else if (currentTab === 'about') {
      const aboutSection = document.createElement('div');
      aboutSection.style.cssText = 'padding: 16px; color: #f1f5f9;';
      
      const scriptName = remoteConfig?.script?.display_name || 'FREEInternet-Bypass';
      const remoteVersion = remoteConfig?.script?.version || 'Unknown';
      const tagline = remoteConfig?.script?.tagline || 'Unlock the Web Without Limits';
      
      // Version comparison
      const versionCompare = /\d/.test(remoteVersion) ? compareVersions(remoteVersion, SCRIPT_VERSION) : 0;
      const versionMatch = versionCompare <= 0;
      const versionColor = versionMatch ? '#10b981' : '#f59e0b';
      const versionIcon = versionMatch ? '✅' : '⚠️';
      
      aboutSection.innerHTML = `
        <div style="text-align: center; padding: 24px 0; border-bottom: 1px solid #475569;">
          <h2 style="font-size: 24px; margin: 0 0 8px 0; color: #6366f1;">${scriptName}</h2>
          <div style="font-size: 14px; color: #cbd5e1; margin-bottom: 12px;">${tagline}</div>
          <div style="font-size: 12px; color: #94a3b8; margin-bottom: 8px;">
            <strong>Installed:</strong> v${SCRIPT_VERSION}
          </div>
          <div style="font-size: 12px; color: ${versionColor};">
            ${versionIcon} <strong>Latest:</strong> v${remoteVersion}
            ${versionMatch ? '' : ' (Update available)'}
          </div>
        </div>
      `;
      
      if (remoteConfig?.authors?.length > 0) {
        const authorsDiv = document.createElement('div');
        authorsDiv.style.cssText = 'padding: 20px 0; border-bottom: 1px solid #475569;';
        authorsDiv.innerHTML = '<h3 style="font-size: 16px; margin: 0 0 12px 0; color: #6366f1;"><i class="fas fa-users"></i> Authors</h3>';
        
        for (const author of remoteConfig.authors) {
          const authorCard = document.createElement('div');
          authorCard.style.cssText = 'margin-bottom: 12px; padding: 12px; background: rgba(99, 102, 241, 0.05); border-radius: 8px;';
          authorCard.innerHTML = `
            <div style="font-weight: 600; font-size: 14px;">${author.name}</div>
            <div style="font-size: 12px; color: #cbd5e1; margin-top: 4px;">${author.role || 'Contributor'}</div>
            ${author.bio ? `<div style="font-size: 12px; color: #94a3b8; margin-top: 6px; font-style: italic;">${author.bio}</div>` : ''}
          `;
          authorsDiv.appendChild(authorCard);
        }
        
        aboutSection.appendChild(authorsDiv);
      }
      
      if (remoteConfig?.features?.length > 0) {
        const featuresDiv = document.createElement('div');
        featuresDiv.style.cssText = 'padding: 20px 0;';
        featuresDiv.innerHTML = '<h3 style="font-size: 16px; margin: 0 0 12px 0; color: #6366f1;"><i class="fas fa-rocket"></i> Features</h3>';
        
        for (const feature of remoteConfig.features) {
          const featureCard = document.createElement('div');
          featureCard.style.cssText = 'margin-bottom: 12px; padding: 12px; background: rgba(99, 102, 241, 0.05); border-radius: 8px;';
          
          const statusIcon = feature.enabled_by_default ? '✅' : '⚙️';
          const categoryBadge = feature.category ? `<span style="font-size: 10px; background: rgba(99, 102, 241, 0.3); padding: 2px 6px; border-radius: 4px; margin-left: 8px;">${feature.category}</span>` : '';
          
          featureCard.innerHTML = `
            <div style="font-weight: 600; font-size: 13px;">${statusIcon} ${feature.title}${categoryBadge}</div>
            <div style="font-size: 12px; color: #cbd5e1; margin-top: 6px;">${feature.description}</div>
            ${feature.help ? `<div style="font-size: 11px; color: #94a3b8; margin-top: 8px; padding-top: 8px; border-top: 1px solid #475569;"><strong>Help:</strong> ${feature.help}</div>` : ''}
          `;
          featuresDiv.appendChild(featureCard);
        }
        
        aboutSection.appendChild(featuresDiv);
      }
      
      if (remoteConfig?.supported_platforms?.length > 0) {
        const platformsDiv = document.createElement('div');
        platformsDiv.style.cssText = 'padding: 20px 0; border-top: 1px solid #475569;';
        platformsDiv.innerHTML = '<h3 style="font-size: 16px; margin: 0 0 12px 0; color: #6366f1;"><i class="fas fa-globe"></i> Supported Platforms</h3>';
        
        for (const platform of remoteConfig.supported_platforms) {
          const statusColor = platform.status === 'stable' ? '#10b981' : platform.status === 'experimental' ? '#f59e0b' : '#6366f1';
          const compatibilityBar = platform.compatibility ? `
            <div style="margin-top: 6px;">
              <div style="background: #1e293b; height: 6px; border-radius: 3px; overflow: hidden;">
                <div style="background: ${statusColor}; height: 100%; width: ${platform.compatibility}%;"></div>
              </div>
              <div style="font-size: 10px; color: #94a3b8; margin-top: 2px;">${platform.compatibility}% compatible</div>
            </div>
          ` : '';
          
          platformsDiv.innerHTML += `
            <div style="margin-bottom: 10px; padding: 10px; background: rgba(99, 102, 241, 0.05); border-radius: 8px;">
              <div style="font-weight: 600; font-size: 13px;">
                ${platform.name}
                <span style="font-size: 10px; background: ${statusColor}; color: white; padding: 2px 6px; border-radius: 4px; margin-left: 8px;">${platform.status}</span>
              </div>
              ${platform.notes ? `<div style="font-size: 11px; color: #cbd5e1; margin-top: 4px;">${platform.notes}</div>` : ''}
              ${compatibilityBar}
            </div>
          `;
        }
        
        aboutSection.appendChild(platformsDiv);
      }
      
      const footer = document.createElement('div');
      footer.style.cssText = 'padding-top: 20px; border-top: 1px solid #475569; text-align: center; font-size: 11px; color: #94a3b8;';
      footer.innerHTML = `
        <div style="margin-bottom: 8px;">Made with care for a free and open internet</div>
        ${remoteConfig?.script?.repository ? `<a href="${remoteConfig.script.repository}" target="_blank" style="color: #6366f1; text-decoration: none;">Repository</a> • ` : ''}
        ${remoteConfig?.script?.support_url ? `<a href="${remoteConfig.script.support_url}" target="_blank" style="color: #6366f1; text-decoration: none;">Support</a>` : ''}
      `;
      aboutSection.appendChild(footer);
      
      content.appendChild(aboutSection);
    } else if (currentTab === 'help') {
      const helpContent = createHelpContent();
      content.appendChild(helpContent);
    }

    if (renderToken !== uiRenderToken) return;
    container.appendChild(content);
    if (currentTab === 'home') {
      refreshSelectionUI();
    }

    // Add resize handle
    const resizeHandle = document.createElement('div');
    resizeHandle.className = 'bypass-resize-handle';
    container.appendChild(resizeHandle);

    document.body.appendChild(container);

    // Setup drag and resize
    setupDragAndResize(container, header);
  }

  function injectSettingsIntoPage(force = false) {
    // Check if on settings page
    const url = window.location.href;
    if (!url.includes('/settings')) {
      if (settingsInjected) {
        settingsInjected = false;
      }
      return;
    }

    // Check for settings page heading
    const heading = document.querySelector('h1.fw-600.text-32.lh-38.c-text-primary');
    if (!heading || !heading.textContent.includes('Settings')) {
      return;
    }

    // Avoid duplicate injection unless forced (used after saving settings)
    const existingSection = document.getElementById('bypass-settings-section');
    if (existingSection) {
      if (!force) return;
      existingSection.remove();
    }

    // Find the settings container
    const settingsContainer = document.querySelector('div.px-16.md\\:w-666.md\\:mx-auto');
    if (!settingsContainer) {
      return;
    }

    // Create BypassInternet settings section
    const section = document.createElement('section');
    section.id = 'bypass-settings-section';
    section.className = 'flex flex-col gap-16';
    section.style.marginTop = '24px';
    section.style.paddingTop = '24px';
    section.style.borderTop = '1px solid #475569';

    // Helper: create Tensor-styled buttons by reusing site classes when possible
    const createTensorButton = (label, type = 'primary') => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.tabIndex = 0;

      // Try to copy the site's current button classes to keep style consistent.
      // Fallback to the sample classes provided by user.
      const anySiteBtn = document.querySelector('button.n-button');
      const baseClass = (anySiteBtn && anySiteBtn.className) || '__button-dark-njtao5-blmme n-button n-button--medium-type n-button--ghost';
      const cleaned = baseClass
        .split(/\s+/)
        .filter(Boolean)
        .filter(c => !/^n-button--(primary|success|warning|error|info)-type$/.test(c))
        .join(' ');

      btn.className = `${cleaned} n-button--${type}-type`;
      btn.innerHTML = `
        <span class="n-button__content">${label}</span>
        <div aria-hidden="true" class="n-base-wave"></div>
        <div aria-hidden="true" class="n-button__border"></div>
        <div aria-hidden="true" class="n-button__state-border"></div>
      `;
      return btn;
    };

    // Title
    const title = document.createElement('h2');
    title.className = 'fw-600 text-20 lh-28 c-text-primary';
    title.innerHTML = '<i class="fas fa-shield-alt"></i> BypassInternet Settings';
    title.style.marginBottom = '16px';
    section.appendChild(title);

    // Theme selector
    const themeGroup = document.createElement('div');
    themeGroup.className = 'flex flex-col gap-8';
    const themeLabel = document.createElement('label');
    themeLabel.style.cssText = 'display: block; font-weight: 600; font-size: 14px; margin-bottom: 8px;';
    themeLabel.innerHTML = 'Theme';
    const themeSelect = document.createElement('select');
    themeSelect.id = 'bypass-settings-theme';
    themeSelect.name = 'theme';
    themeSelect.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #475569;
      border-radius: 6px;
      background: #1e293b;
      color: #f1f5f9;
      font-size: 14px;
      cursor: pointer;
    `;
    themeSelect.onclick = (e) => e.stopPropagation();
    ['dark', 'light'].forEach(theme => {
      const opt = document.createElement('option');
      opt.value = theme;
      opt.textContent = theme.charAt(0).toUpperCase() + theme.slice(1);
      if (theme === settings.theme) opt.selected = true;
      themeSelect.appendChild(opt);
    });
    themeSelect.onchange = () => {
      settings.theme = themeSelect.value;
      saveSettings();
      updateUI();
    };
    themeGroup.appendChild(themeLabel);
    themeGroup.appendChild(themeSelect);
    section.appendChild(themeGroup);

    // User Token
    const tokenGroup = document.createElement('div');
    tokenGroup.className = 'flex flex-col gap-8';
    const tokenLabel = document.createElement('label');
    tokenLabel.style.cssText = 'display: block; font-weight: 600; font-size: 14px; margin-bottom: 8px;';
    tokenLabel.innerHTML = '<i class="fas fa-key"></i> User Token';
    const tokenInput = document.createElement('input');
    tokenInput.id = 'bypass-settings-token';
    tokenInput.name = 'token';
    tokenInput.type = 'password';
    tokenInput.placeholder = 'Auto-detected from cookie (editing disabled)';
    tokenInput.value = userToken || '';
    tokenInput.disabled = true;
    tokenInput.style.cssText = `
      width: 100%;
      padding: 8px 12px;
      border: 1px solid #475569;
      border-radius: 6px;
      background: #1e293b;
      color: #f1f5f9;
      font-size: 14px;
      opacity: 0.7;
      cursor: not-allowed;
    `;
    tokenInput.onclick = (e) => e.stopPropagation();

    const tokenNote = document.createElement('div');
    tokenNote.style.cssText = 'font-size: 12px; color: #cbd5e1; opacity: 0.85; margin-top: 6px; line-height: 1.4;';
    tokenNote.innerHTML = 'Token is read from <code>ta_token_prod</code> cookie. Editing is disabled for safety.';
    tokenGroup.appendChild(tokenLabel);
    tokenGroup.appendChild(tokenInput);
    tokenGroup.appendChild(tokenNote);
    section.appendChild(tokenGroup);

    const injectionHeader = document.createElement('div');
    injectionHeader.style.cssText = 'font-weight: 600; font-size: 13px; margin-top: 16px; color: #cbd5e1;';
    injectionHeader.textContent = 'Injection Method';
    section.appendChild(injectionHeader);

    const safeViewLabel = document.createElement('label');
    safeViewLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 12px 0;
    `;
    const safeViewInput = document.createElement('input');
    safeViewInput.type = 'checkbox';
    safeViewInput.checked = settings.safeViewMode;
    safeViewInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    safeViewInput.onchange = () => {
      settings.safeViewMode = safeViewInput.checked;
      if (settings.safeViewMode) {
        settings.injectOnDom = false;
      }
      saveSettings();
      if (settings.safeViewMode) {
        startDomInjectionWatcher();
      } else if (!settings.injectOnDom) {
        stopDomInjectionWatcher();
      }
      injectSettingsIntoPage(true);
    };
    safeViewLabel.appendChild(safeViewInput);
    safeViewLabel.appendChild(document.createTextNode('Safe View Blocked Media'));
    section.appendChild(safeViewLabel);

    const injectDomLabel = document.createElement('label');
    injectDomLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 12px 0;
    `;
    const injectDomInput = document.createElement('input');
    injectDomInput.type = 'checkbox';
    injectDomInput.checked = settings.injectOnDom;
    injectDomInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    injectDomInput.onchange = () => {
      settings.injectOnDom = injectDomInput.checked;
      if (settings.injectOnDom) {
        settings.safeViewMode = false;
      }
      localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
      if (settings.injectOnDom) {
        startDomInjectionWatcher();
      } else if (!settings.safeViewMode) {
        stopDomInjectionWatcher();
      }
      injectSettingsIntoPage(true);
    };
    injectDomLabel.appendChild(injectDomInput);
    injectDomLabel.appendChild(document.createTextNode('Inject On DOM'));
    section.appendChild(injectDomLabel);

    const autoShowLabel = document.createElement('label');
    autoShowLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 16px 0;
    `;
    const autoShowInput = document.createElement('input');
    autoShowInput.type = 'checkbox';
    autoShowInput.checked = settings.autoShowPanel;
    autoShowInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    autoShowInput.onchange = () => {
      settings.autoShowPanel = autoShowInput.checked;
      localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
    };
    autoShowLabel.appendChild(autoShowInput);
    autoShowLabel.appendChild(document.createTextNode('Auto-show Panel on Detect'));
    section.appendChild(autoShowLabel);

    const previewLabel = document.createElement('label');
    previewLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 16px 0;
    `;
    const previewInput = document.createElement('input');
    previewInput.type = 'checkbox';
    previewInput.checked = settings.preview;
    previewInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    previewInput.onchange = () => {
      settings.preview = previewInput.checked;
      saveSettings();
      updateUI();
    };
    previewLabel.appendChild(previewInput);
    previewLabel.appendChild(document.createTextNode('Preview Media'));
    section.appendChild(previewLabel);

    const autoDownloadLabel = document.createElement('label');
    autoDownloadLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 16px 0;
    `;
    const autoDownloadInput = document.createElement('input');
    autoDownloadInput.type = 'checkbox';
    autoDownloadInput.checked = settings.autoDownload;
    autoDownloadInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    autoDownloadInput.onchange = () => {
      settings.autoDownload = autoDownloadInput.checked;
      saveSettings();
    };
    autoDownloadLabel.appendChild(autoDownloadInput);
    autoDownloadLabel.appendChild(document.createTextNode('Auto-download on Detect'));
    section.appendChild(autoDownloadLabel);

    const inheritLabel = document.createElement('label');
    inheritLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 16px 0;
    `;
    const inheritInput = document.createElement('input');
    inheritInput.type = 'checkbox';
    inheritInput.checked = settings.inheritTheme;
    inheritInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    inheritInput.onchange = () => {
      settings.inheritTheme = inheritInput.checked;
      saveSettings();
      injectStyles();
      updateUI();
    };
    inheritLabel.appendChild(inheritInput);
    inheritLabel.appendChild(document.createTextNode('Inherit Page Theme'));
    section.appendChild(inheritLabel);

    const videoModalLabel = document.createElement('label');
    videoModalLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 16px 0;
    `;
    const videoModalInput = document.createElement('input');
    videoModalInput.type = 'checkbox';
    videoModalInput.checked = settings.showVideoModal;
    videoModalInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    videoModalInput.onchange = () => {
      settings.showVideoModal = videoModalInput.checked;
      saveSettings();
    };
    videoModalLabel.appendChild(videoModalInput);
    videoModalLabel.appendChild(document.createTextNode('Enable Video Modal'));
    section.appendChild(videoModalLabel);

    const tooltipLabel = document.createElement('label');
    tooltipLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 16px 0;
    `;
    const tooltipInput = document.createElement('input');
    tooltipInput.type = 'checkbox';
    tooltipInput.checked = settings.showBlockedTooltip;
    tooltipInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    tooltipInput.onchange = () => {
      settings.showBlockedTooltip = tooltipInput.checked;
      saveSettings();
      injectSettingsIntoPage(true);
      injectBlockedMediaIntoDom();
      updateUI();
    };
    tooltipLabel.appendChild(tooltipInput);
    tooltipLabel.appendChild(document.createTextNode('Show Blocked Media Tooltip (Injected Only)'));
    section.appendChild(tooltipLabel);

    if (settings.showBlockedTooltip) {
      const keepTooltipLabel = document.createElement('label');
      keepTooltipLabel.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        font-size: 14px;
        margin: 16px 0;
      `;
      const keepTooltipInput = document.createElement('input');
      keepTooltipInput.type = 'checkbox';
      keepTooltipInput.checked = settings.keepBlockedTooltipOpen;
      keepTooltipInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
      keepTooltipInput.onchange = () => {
        settings.keepBlockedTooltipOpen = keepTooltipInput.checked;
        saveSettings();
      };
      keepTooltipLabel.appendChild(keepTooltipInput);
      keepTooltipLabel.appendChild(document.createTextNode('Keep last tooltip open'));
      section.appendChild(keepTooltipLabel);
    }

    const injectedHelpLabel = document.createElement('label');
    injectedHelpLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 16px 0;
    `;
    const injectedHelpInput = document.createElement('input');
    injectedHelpInput.type = 'checkbox';
    injectedHelpInput.checked = settings.showInjectedHelpTooltips;
    injectedHelpInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    injectedHelpInput.onchange = () => {
      settings.showInjectedHelpTooltips = injectedHelpInput.checked;
      saveSettings();
      injectBlockedMediaIntoDom();
    };
    injectedHelpLabel.appendChild(injectedHelpInput);
    injectedHelpLabel.appendChild(document.createTextNode('Injected buttons help tooltips'));
    section.appendChild(injectedHelpLabel);

    const downloadPreviewLabel = document.createElement('label');
    downloadPreviewLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 16px 0;
    `;
    const downloadPreviewInput = document.createElement('input');
    downloadPreviewInput.type = 'checkbox';
    downloadPreviewInput.checked = settings.showDownloadPreview;
    downloadPreviewInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    downloadPreviewInput.onchange = () => {
      settings.showDownloadPreview = downloadPreviewInput.checked;
      saveSettings();
      updateGlobalActionProgressFromQueue();
      updateUI();
    };
    downloadPreviewLabel.appendChild(downloadPreviewInput);
    downloadPreviewLabel.appendChild(document.createTextNode('Preview current download'));
    section.appendChild(downloadPreviewLabel);

    const tasksHeader = document.createElement('div');
    tasksHeader.style.cssText = 'font-weight: 600; font-size: 13px; margin-top: 16px; color: #cbd5e1;';
    tasksHeader.textContent = 'Task Actions';
    section.appendChild(tasksHeader);

    if (settings.telegramEnabled) {
      const sendAllTg = document.createElement('label');
      sendAllTg.style.cssText = 'display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 14px; margin: 10px 0;';
      const sendAllTgInput = document.createElement('input');
      sendAllTgInput.type = 'checkbox';
      sendAllTgInput.checked = settings.sendAllTasksTelegram;
      sendAllTgInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
      sendAllTgInput.onchange = () => {
        settings.sendAllTasksTelegram = sendAllTgInput.checked;
        saveSettings();
        injectBlockedMediaIntoDom();
      };
      sendAllTg.appendChild(sendAllTgInput);
      sendAllTg.appendChild(document.createTextNode('Telegram: Send all tasks'));
      section.appendChild(sendAllTg);
    }

    if (settings.discordEnabled) {
      const sendAllDiscord = document.createElement('label');
      sendAllDiscord.style.cssText = 'display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 14px; margin: 10px 0;';
      const sendAllDiscordInput = document.createElement('input');
      sendAllDiscordInput.type = 'checkbox';
      sendAllDiscordInput.checked = settings.sendAllTasksDiscord;
      sendAllDiscordInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
      sendAllDiscordInput.onchange = () => {
        settings.sendAllTasksDiscord = sendAllDiscordInput.checked;
        saveSettings();
        injectBlockedMediaIntoDom();
      };
      sendAllDiscord.appendChild(sendAllDiscordInput);
      sendAllDiscord.appendChild(document.createTextNode('Discord: Send all tasks'));
      section.appendChild(sendAllDiscord);
    }

    const sendAllDownload = document.createElement('label');
    sendAllDownload.style.cssText = 'display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 14px; margin: 10px 0;';
    const sendAllDownloadInput = document.createElement('input');
    sendAllDownloadInput.type = 'checkbox';
    sendAllDownloadInput.checked = settings.sendAllTasksDownload;
    sendAllDownloadInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    sendAllDownloadInput.onchange = () => {
      settings.sendAllTasksDownload = sendAllDownloadInput.checked;
      saveSettings();
      injectBlockedMediaIntoDom();
    };
    sendAllDownload.appendChild(sendAllDownloadInput);
    sendAllDownload.appendChild(document.createTextNode('Download: All tasks'));
    section.appendChild(sendAllDownload);

    const preventDupLabel = document.createElement('label');
    preventDupLabel.style.cssText = 'display: flex; align-items: center; gap: 12px; cursor: pointer; font-size: 14px; margin: 10px 0;';
    const preventDupInput = document.createElement('input');
    preventDupInput.type = 'checkbox';
    preventDupInput.checked = settings.preventDuplicateTasks;
    preventDupInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    preventDupInput.onchange = () => {
      settings.preventDuplicateTasks = preventDupInput.checked;
      saveSettings();
    };
    preventDupLabel.appendChild(preventDupInput);
    preventDupLabel.appendChild(document.createTextNode('Prevent duplicate actions'));
    section.appendChild(preventDupLabel);

    if (settings.showBlockedTooltip) {
      const tooltipPreviewLabel = document.createElement('label');
      tooltipPreviewLabel.style.cssText = `
        display: flex;
        align-items: center;
        gap: 12px;
        cursor: pointer;
        font-size: 14px;
        margin: 16px 0;
      `;
      const tooltipPreviewInput = document.createElement('input');
      tooltipPreviewInput.type = 'checkbox';
      tooltipPreviewInput.checked = settings.showBlockedTooltipPreview;
      tooltipPreviewInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
      tooltipPreviewInput.onchange = () => {
        settings.showBlockedTooltipPreview = tooltipPreviewInput.checked;
        saveSettings();
        injectBlockedMediaIntoDom();
        updateUI();
      };
      tooltipPreviewLabel.appendChild(tooltipPreviewInput);
      tooltipPreviewLabel.appendChild(document.createTextNode('View media on tooltip'));
      section.appendChild(tooltipPreviewLabel);
    }

    // Auto-check toggle
    const autoCheckLabel = document.createElement('label');
    autoCheckLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 16px 0;
    `;
    const autoCheckInput = document.createElement('input');
    autoCheckInput.type = 'checkbox';
    autoCheckInput.checked = settings.autoCheck;
    autoCheckInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    autoCheckInput.onchange = () => {
      settings.autoCheck = autoCheckInput.checked;
      localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
      if (settings.autoCheck) {
        startAutoCheck();
      } else {
        stopAutoCheck();
      }
    };
    autoCheckLabel.appendChild(autoCheckInput);
    autoCheckLabel.appendChild(document.createTextNode('Auto-check for Items'));
    section.appendChild(autoCheckLabel);

    // Check Interval (conditional)
    if (settings.autoCheck) {
      const intervalGroup = document.createElement('div');
      intervalGroup.className = 'flex flex-col gap-8';
      const intervalLabel = document.createElement('label');
      intervalLabel.style.cssText = 'display: block; font-weight: 600; font-size: 14px; margin-bottom: 8px;';
      intervalLabel.innerHTML = '<i class="fas fa-clock"></i> Check Interval (seconds)';
      const intervalInput = document.createElement('input');
      intervalInput.type = 'number';
      intervalInput.id = 'bypass-settings-interval';
      intervalInput.name = 'checkInterval';
      intervalInput.min = '5';
      intervalInput.max = '300';
      intervalInput.step = '5';
      intervalInput.value = settings.autoCheckInterval;
      intervalInput.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #475569;
        border-radius: 6px;
        background: #1e293b;
        color: #f1f5f9;
        font-size: 14px;
      `;
      intervalInput.onclick = (e) => e.stopPropagation();
      intervalInput.onchange = () => {
        settings.autoCheckInterval = Math.max(5, parseInt(intervalInput.value) || 30);
        localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
        startAutoCheck();
      };
      intervalGroup.appendChild(intervalLabel);
      intervalGroup.appendChild(intervalInput);
      section.appendChild(intervalGroup);
    }

    // Caching toggle
    const cachingLabel = document.createElement('label');
    cachingLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 16px 0;
    `;
    const cachingInput = document.createElement('input');
    cachingInput.type = 'checkbox';
    cachingInput.checked = settings.cachingEnabled;
    cachingInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    cachingInput.onchange = () => {
      settings.cachingEnabled = cachingInput.checked;
      localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
    };
    cachingLabel.appendChild(cachingInput);
    cachingLabel.appendChild(document.createTextNode('Enable URL Caching'));
    section.appendChild(cachingLabel);

    // Cache Duration (conditional)
    if (settings.cachingEnabled) {
      const cacheGroup = document.createElement('div');
      cacheGroup.className = 'flex flex-col gap-8';
      const cacheLabel = document.createElement('label');
      cacheLabel.style.cssText = 'display: block; font-weight: 600; font-size: 14px; margin-bottom: 8px;';
      cacheLabel.innerHTML = '<i class="fas fa-hourglass"></i> Cache Duration (Days)';
      const cacheInput = document.createElement('input');
      cacheInput.type = 'number';
      cacheInput.id = 'bypass-settings-cache-duration';
      cacheInput.name = 'cacheDuration';
      cacheInput.min = '1';
      cacheInput.max = '30';
      cacheInput.value = settings.cacheDuration;
      cacheInput.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #475569;
        border-radius: 6px;
        background: #1e293b;
        color: #f1f5f9;
        font-size: 14px;
      `;
      cacheInput.onclick = (e) => e.stopPropagation();
      cacheInput.onchange = () => {
        settings.cacheDuration = Math.max(1, parseInt(cacheInput.value) || 7);
        localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
      };
      cacheGroup.appendChild(cacheLabel);
      cacheGroup.appendChild(cacheInput);
      section.appendChild(cacheGroup);
    }

    // Telegram toggle
    const telegramLabel = document.createElement('label');
    telegramLabel.style.cssText = `
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-size: 14px;
      margin: 16px 0;
    `;
    const telegramInput = document.createElement('input');
    telegramInput.type = 'checkbox';
    telegramInput.checked = settings.telegramEnabled;
    telegramInput.style.cssText = 'cursor: pointer; width: 18px; height: 18px;';
    telegramInput.onchange = () => {
      settings.telegramEnabled = telegramInput.checked;
      localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
      injectSettingsIntoPage(true); // Refresh to show/hide Telegram fields
    };
    telegramLabel.appendChild(telegramInput);
    telegramLabel.appendChild(document.createTextNode('Enable Telegram Notifications'));
    section.appendChild(telegramLabel);

    // Telegram Token (conditional)
    if (settings.telegramEnabled) {
      const tgTokenGroup = document.createElement('div');
      tgTokenGroup.className = 'flex flex-col gap-8';
      const tgTokenLabel = document.createElement('label');
      tgTokenLabel.style.cssText = 'display: block; font-weight: 600; font-size: 14px; margin-bottom: 8px;';
      tgTokenLabel.innerHTML = '<i class="fab fa-telegram"></i> Bot Token';
      const tgTokenInput = document.createElement('input');
      tgTokenInput.id = 'bypass-settings-tg-token';
      tgTokenInput.name = 'telegramToken';
      tgTokenInput.type = 'password';
      tgTokenInput.placeholder = 'Enter your Telegram bot token';
      tgTokenInput.value = settings.telegramToken;
      tgTokenInput.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #475569;
        border-radius: 6px;
        background: #1e293b;
        color: #f1f5f9;
        font-size: 14px;
      `;
      tgTokenInput.onclick = (e) => e.stopPropagation();
      tgTokenInput.onchange = () => {
        settings.telegramToken = tgTokenInput.value;
        localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
      };
      tgTokenGroup.appendChild(tgTokenLabel);
      tgTokenGroup.appendChild(tgTokenInput);
      section.appendChild(tgTokenGroup);

      const tgDelayGroup = document.createElement('div');
      tgDelayGroup.className = 'flex flex-col gap-8';
      const tgDelayLabel = document.createElement('label');
      tgDelayLabel.style.cssText = 'display: block; font-weight: 600; font-size: 14px; margin-bottom: 8px;';
      tgDelayLabel.innerHTML = '<i class="fas fa-stopwatch"></i> Telegram Delay (seconds)';
      const tgDelayInput = document.createElement('input');
      tgDelayInput.type = 'number';
      tgDelayInput.min = '0';
      tgDelayInput.max = '30';
      tgDelayInput.step = '1';
      tgDelayInput.value = settings.telegramDelaySeconds || 0;
      tgDelayInput.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #475569;
        border-radius: 6px;
        background: #1e293b;
        color: #f1f5f9;
        font-size: 14px;
      `;
      tgDelayInput.onclick = (e) => e.stopPropagation();
      tgDelayInput.onchange = () => {
        settings.telegramDelaySeconds = Math.max(0, parseInt(tgDelayInput.value, 10) || 0);
        saveSettings();
      };
      tgDelayGroup.appendChild(tgDelayLabel);
      tgDelayGroup.appendChild(tgDelayInput);
      section.appendChild(tgDelayGroup);

      // Telegram status dialog (success/error messages)
      const tgStatus = document.createElement('div');
      tgStatus.id = 'bypass-tg-status';
      tgStatus.style.cssText = `
        padding: 10px 12px;
        border: 1px solid #475569;
        border-radius: 8px;
        background: rgba(30, 41, 59, 0.6);
        color: #e2e8f0;
        font-size: 12px;
        line-height: 1.5;
      `;
      tgStatus.textContent = settings.telegramChatId
        ? 'Telegram is configured. You can remove Chat ID to re-initialize.'
        : 'To initialize: open your bot chat, send /access, then click “Initialize Telegram”.';
      section.appendChild(tgStatus);

      // Chat ID input (injected when missing; readonly when present)
      const chatIdGroup = document.createElement('div');
      chatIdGroup.className = 'flex flex-col gap-8';
      const chatIdLabel = document.createElement('label');
      chatIdLabel.style.cssText = 'display: block; font-weight: 600; font-size: 14px; margin-bottom: 8px;';
      chatIdLabel.innerHTML = '<i class="fas fa-hashtag"></i> Chat ID';
      const chatIdInput = document.createElement('input');
      chatIdInput.id = 'bypass-settings-chat-id';
      chatIdInput.name = 'chatId';
      chatIdInput.type = 'text';
      chatIdInput.placeholder = 'Chat ID will appear here after initialization (or paste manually)';
      chatIdInput.value = settings.telegramChatId || '';
      chatIdInput.disabled = !!settings.telegramChatId;
      chatIdInput.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #475569;
        border-radius: 6px;
        background: #1e293b;
        color: #f1f5f9;
        font-size: 14px;
        ${settings.telegramChatId ? 'opacity: 0.7; cursor: not-allowed;' : ''}
      `;
      chatIdInput.onclick = (e) => e.stopPropagation();
      chatIdInput.onchange = () => {
        if (settings.telegramChatId) return;
        settings.telegramChatId = chatIdInput.value.trim();
        localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
        tgStatus.textContent = settings.telegramChatId
          ? `Chat ID saved manually: ${settings.telegramChatId}`
          : 'Chat ID cleared.';
      };
      chatIdGroup.appendChild(chatIdLabel);
      // Inject input only when no chat id OR show readonly when set (matches request)
      chatIdGroup.appendChild(chatIdInput);
      section.appendChild(chatIdGroup);

      // Buttons row: Initialize + Uninitialize
      const tgBtnRow = document.createElement('div');
      tgBtnRow.style.cssText = 'display: flex; gap: 10px; width: 100%; flex-wrap: wrap;';

      const initBtn = createTensorButton('Initialize Telegram', 'primary');
      initBtn.onclick = async () => {
        const botToken = (settings.telegramToken || '').trim();
        if (!botToken) {
          tgStatus.textContent = '❌ Please enter Bot Token first.';
          return;
        }

        initBtn.disabled = true;
        tgStatus.textContent = '⏳ Waiting for /access... (checking getUpdates)';

        try {
          let chatId = null;
          let attempts = 0;
          const accessCommand = '/access';

          while (!chatId && attempts < 60) {
            const response = await fetch(`https://api.telegram.org/bot${botToken}/getUpdates`);
            const data = await response.json();

            const updates = Array.isArray(data.result) ? data.result : [];
            for (let i = updates.length - 1; i >= 0; i--) {
              const update = updates[i];
              const msg = update && update.message;
              const text = msg && typeof msg.text === 'string' ? msg.text.trim() : '';
              if (text === accessCommand && msg.chat && msg.chat.id) {
                chatId = String(msg.chat.id);
                break;
              }
            }

            if (!chatId) {
              await new Promise(r => setTimeout(r, 1000));
              attempts++;
            }
          }

          if (chatId) {
            settings.telegramChatId = chatId;
            localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
            tgStatus.textContent = `✅ Success! Chat ID: ${chatId}`;
            injectSettingsIntoPage(true);
          } else {
            tgStatus.textContent = '❌ Timeout: No /access command received. Send /access to your bot chat, then try again.';
          }
        } catch (err) {
          tgStatus.textContent = `❌ Error: ${err.message}`;
        } finally {
          initBtn.disabled = false;
        }
      };
      tgBtnRow.appendChild(initBtn);

      if (settings.telegramChatId) {
        const removeBtn = createTensorButton('Remove Chat ID', 'error');
        removeBtn.onclick = () => {
          settings.telegramChatId = '';
          localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
          tgStatus.textContent = '🧹 Chat ID removed. You can re-initialize by sending /access then clicking Initialize.';
          injectSettingsIntoPage(true);
        };
        tgBtnRow.appendChild(removeBtn);
      }

      section.appendChild(tgBtnRow);
    }

    // Discord webhook section
    const discordLabel = document.createElement('label');
    discordLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; margin-top: 16px;';
    const discordCheckbox = document.createElement('input');
    discordCheckbox.type = 'checkbox';
    discordCheckbox.checked = settings.discordEnabled;
    discordCheckbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
    discordCheckbox.onclick = (e) => e.stopPropagation();
    discordCheckbox.onchange = () => {
      settings.discordEnabled = discordCheckbox.checked;
      localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
      injectSettingsIntoPage(true);
    };
    discordLabel.appendChild(discordCheckbox);
    discordLabel.appendChild(document.createTextNode('Enable Discord Webhooks'));
    section.appendChild(discordLabel);

    if (settings.discordEnabled) {
      const webhookGroup = document.createElement('div');
      webhookGroup.className = 'flex flex-col gap-8';
      const webhookLabel = document.createElement('label');
      webhookLabel.style.cssText = 'display: block; font-weight: 600; font-size: 14px; margin-bottom: 8px;';
      webhookLabel.innerHTML = '<i class="fab fa-discord" style="color: #5865f2;"></i> Webhook URL';
      const webhookInput = document.createElement('input');
      webhookInput.id = 'bypass-settings-discord-webhook';
      webhookInput.name = 'discordWebhook';
      webhookInput.type = 'password';
      webhookInput.placeholder = 'https://discord.com/api/webhooks/...';
      webhookInput.value = settings.discordWebhook;
      webhookInput.style.cssText = `
        width: 100%;
        padding: 8px 12px;
        border: 1px solid #475569;
        border-radius: 6px;
        background: #1e293b;
        color: #f1f5f9;
        font-size: 14px;
      `;
      webhookInput.onclick = (e) => e.stopPropagation();
      webhookInput.onchange = () => {
        settings.discordWebhook = webhookInput.value.trim();
        localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
      };
      webhookGroup.appendChild(webhookLabel);
      webhookGroup.appendChild(webhookInput);
      
      const webhookHelp = document.createElement('div');
      webhookHelp.style.cssText = `
        padding: 10px 12px;
        border: 1px solid #475569;
        border-radius: 8px;
        background: rgba(30, 41, 59, 0.6);
        color: #e2e8f0;
        font-size: 12px;
        line-height: 1.5;
        margin-top: 8px;
      `;
      webhookHelp.innerHTML = `
        <strong>How to get your Discord webhook:</strong><br>
        1. Go to Server Settings → Integrations → Webhooks<br>
        2. Click "New Webhook" or edit an existing one<br>
        3. Copy the Webhook URL and paste it above
      `;
      webhookGroup.appendChild(webhookHelp);
      section.appendChild(webhookGroup);
    }

    // Auto task detection toggle
    const autoTaskLabel = document.createElement('label');
    autoTaskLabel.style.cssText = 'display: flex; align-items: center; gap: 8px; font-weight: 600; cursor: pointer; margin-top: 16px;';
    const autoTaskCheckbox = document.createElement('input');
    autoTaskCheckbox.type = 'checkbox';
    autoTaskCheckbox.checked = settings.autoTaskDetection;
    autoTaskCheckbox.style.cssText = 'width: 18px; height: 18px; cursor: pointer;';
    autoTaskCheckbox.onclick = (e) => e.stopPropagation();
    autoTaskCheckbox.onchange = () => {
      settings.autoTaskDetection = autoTaskCheckbox.checked;
      localStorage.setItem('freeBypassSettings', JSON.stringify(settings));
      if (settings.autoTaskDetection) {
        startTaskMonitoring();
      } else {
        stopTaskMonitoring();
      }
    };
    autoTaskLabel.appendChild(autoTaskCheckbox);
    autoTaskLabel.appendChild(document.createTextNode('Auto-detect blocked tasks'));
    
    const autoTaskHelp = document.createElement('div');
    autoTaskHelp.style.cssText = `
      margin-left: 26px;
      padding: 8px;
      font-size: 12px;
      color: #cbd5e1;
      font-style: italic;
    `;
    autoTaskHelp.textContent = 'Automatically adds blocked items when generation completes (no refresh needed)';
    section.appendChild(autoTaskLabel);
    section.appendChild(autoTaskHelp);

    // Network Headers section intentionally hidden on settings page for safety.

    // Append to settings container
    settingsContainer.appendChild(section);
    settingsInjected = true;
  }

  function startSettingsPageCheck() {
    if (settingsCheckInterval) clearInterval(settingsCheckInterval);
    settingsCheckInterval = setInterval(() => {
      try {
        injectSettingsIntoPage();
      } catch (e) {
        console.error('Settings injection error:', e);
      }
    }, 500);
  }

  function stopSettingsPageCheck() {
    if (settingsCheckInterval) {
      clearInterval(settingsCheckInterval);
      settingsCheckInterval = null;
    }
  }

  // Intercept fetch
  window.fetch = function (...args) {
    const request = args[0];
    const fetchUrl = typeof request === 'string' ? request : request.url;
    return originalFetch.apply(this, args).then(async response => {
      const isQueryEndpoint = fetchUrl.endsWith('/works/v1/works/tasks/query');
      const isTemplateTasksEndpoint = fetchUrl.includes('/works/v1/works/tasks?');
      const isWorkflowEditorEndpoint = fetchUrl.includes('/workflow/editor/');
      const isTaskCreateEndpoint = fetchUrl.includes('/workflow/template/task/create');
      const isMgetTaskEndpoint = fetchUrl.includes('/works/v1/works/mget_task');
      
      // Monitor task creation
      if (isTaskCreateEndpoint && settings.autoTaskDetection) {
        try {
          const clonedResponse = response.clone();
          const body = await clonedResponse.json();
          if (body.data?.workflowTemplateTask?.id) {
            const taskId = body.data.workflowTemplateTask.id;
            pendingTasks.set(taskId, {
              startTime: Date.now(),
              status: 'WAITING',
              templateId: body.data.workflowTemplateTask.workflowTemplateId
            });
            if (domInjectDebug) console.log(`[TaskMonitor] Created task ${taskId}`);
          }
        } catch (e) {
          console.warn('[TaskMonitor] Failed to parse task create response', e);
        }
      }
      
      // Monitor task completion
      if (isMgetTaskEndpoint && settings.autoTaskDetection) {
        try {
          const clonedResponse = response.clone();
          const body = await clonedResponse.json();
          if (body.data?.tasks) {
            for (const [taskId, taskData] of Object.entries(body.data.tasks)) {
              if (!pendingTasks.has(taskId)) continue;
              
              if (taskData.status === 'FINISH' && taskData.items?.length > 0) {
                if (domInjectDebug) console.log(`[TaskMonitor] Task ${taskId} finished with ${taskData.items.length} items`);
                
                // Check for blocked items
                for (const item of taskData.items) {
                  if (item.invalid === true && item.imageId) {
                    if (domInjectDebug) console.log(`[TaskMonitor] Found blocked item ${item.imageId} in completed task`);
                    
                    // Auto-add to blocked items without refresh
                    const existingIds = new Set(itemsData.map(i => i.id));
                    if (!existingIds.has(item.imageId)) {
                      const newItem = {
                        id: item.imageId,
                        taskId: taskData.taskId,
                        type: getItemType(item.mimeType),
                        createdAt: taskData.createdAt,
                        expireAt: taskData.expireAt,
                        url: null,
                        downloading: false,
                        downloaded: false,
                        mimeType: item.mimeType,
                        width: item.width,
                        height: item.height,
                        seed: item.seed,
                        downloadFileName: item.downloadFileName
                      };
                      
                      itemsData.unshift(newItem);
                      blockedItems.add(item.imageId);
                      recordTaskData(taskData);
                      
                      if (domInjectDebug) console.log(`[TaskMonitor] Auto-added blocked item ${item.imageId} to list`);
                      
                      // Update UI without full rebuild
                      updateUI(true);

                      if (settings.autoShowPanel && !isExpanded) {
                        toggleExpand();
                      }
                      
                      // Auto-download URL if needed
                      if (settings.autoDownload) {
                        ensureDownloadUrl(item.imageId);
                      }
                    }
                  }
                }
                
                // Remove from pending tasks
                pendingTasks.delete(taskId);
              }
            }
          }
        } catch (e) {
          console.warn('[TaskMonitor] Failed to parse mget_task response', e);
        }
      }
      
      if (isQueryEndpoint || isTemplateTasksEndpoint || isWorkflowEditorEndpoint) {
        const clonedResponse = response.clone();
        try {
          const body = await clonedResponse.json();
          if (domInjectDebug) {
            const label = isQueryEndpoint ? '/query' : (isTemplateTasksEndpoint ? '/tasks' : '/workflow/editor');
            console.log(`Intercepted ${label} response:`, body);
          }
          const sourceLabel = isQueryEndpoint ? 'Query' : (isTemplateTasksEndpoint ? 'Template' : 'Workflow');
          handleTasksResponse(body, sourceLabel);
        } catch (e) {
          console.warn('Failed to read response body', e);
        }
      }
      return response;
    });
  };

  // Initialize
  injectStyles();
  fetchRemoteConfig(); // Load remote config and announcements
  startAutoCheck();
  startDomInjectionWatcher();
  startSettingsPageCheck();
  startTaskMonitoring();
  startProfileMenuWatcher();
  loadCachedTasksIntoItems();
  updateUI();
  // Inject collapse button early on page load
  injectCollapseButtonEarly();
})();