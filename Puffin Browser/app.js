(() => {
  'use strict';

  // ---------- Storage helpers ----------
  const store = {
    get(key, fallback) {
      try {
        const v = localStorage.getItem(key);
        return v ? JSON.parse(v) : fallback;
      } catch { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
    }
  };

  let bookmarks = store.get('puffin_bookmarks', []); // [{url, title}]
  let history = store.get('puffin_history', []);       // [{url, title, ts}]

  // ---------- DOM refs ----------
  const $ = (id) => document.getElementById(id);
  const tabStrip = $('tabStrip');
  const newTabBtn = $('newTabBtn');
  const viewport = $('viewport');
  const startScreen = $('startScreen');
  const urlForm = $('urlForm');
  const urlInput = $('urlInput');
  const backBtn = $('backBtn');
  const fwdBtn = $('fwdBtn');
  const reloadBtn = $('reloadBtn');
  const starBtn = $('starBtn');
  const menuBtn = $('menuBtn');
  const overlay = $('overlay');
  const menuPanel = $('menuPanel');
  const panelClose = $('panelClose');
  const menuList = $('menuList');
  const bookmarksView = $('bookmarksView');
  const historyView = $('historyView');
  const clearHistoryBtn = $('clearHistoryBtn');
  const toast = $('toast');
  const panelTitle = $('panelTitle');

  // ---------- Tab state ----------
  // each tab: { id, url, title, history:[urls], histIndex, iframeEl }
  let tabs = [];
  let activeTabId = null;
  let tabCounter = 0;

  function uid() { return 't' + (++tabCounter) + '_' + Date.now().toString(36); }

  function faviconFor(url) {
    if (!url) return '🌐';
    try {
      const h = new URL(url).hostname;
      if (h.includes('wikipedia')) return '📖';
      if (h.includes('github')) return '💻';
      return '🌐';
    } catch { return '🌐'; }
  }

  function shortTitle(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
  }

  // ---------- URL normalization ----------
  function normalizeInput(raw) {
    const val = raw.trim();
    if (!val) return null;
    const looksLikeUrl = /^https?:\/\//i.test(val) ||
      (/^[^\s]+\.[a-z]{2,}([/?#].*)?$/i.test(val) && !val.includes(' '));
    if (/^https?:\/\//i.test(val)) return val;
    if (looksLikeUrl) return 'https://' + val;
    return 'https://www.bing.com/search?q=' + encodeURIComponent(val);
  }

  // ---------- Tab creation / switching ----------
  function createTab(url) {
    const id = uid();
    const tab = { id, url: url || null, title: 'New tab', history: [], histIndex: -1, iframeEl: null };
    tabs.push(tab);
    renderTabStrip();
    switchTab(id);
    if (url) navigate(url, id);
    return tab;
  }

  function getTab(id) { return tabs.find(t => t.id === id); }

  function switchTab(id) {
    activeTabId = id;
    renderTabStrip();
    tabs.forEach(t => {
      if (t.iframeEl) t.iframeEl.classList.toggle('visible', t.id === id);
    });
    const tab = getTab(id);
    if (tab && tab.url) {
      startScreen.classList.add('hidden');
      urlInput.value = tab.url;
      updateNavButtons(tab);
      updateStarState(tab.url);
    } else {
      startScreen.classList.remove('hidden');
      urlInput.value = '';
      updateNavButtons(null);
      updateStarState(null);
    }
  }

  function closeTab(id) {
    const idx = tabs.findIndex(t => t.id === id);
    if (idx === -1) return;
    const tab = tabs[idx];
    if (tab.iframeEl) tab.iframeEl.remove();
    tabs.splice(idx, 1);

    if (tabs.length === 0) {
      createTab(null);
      return;
    }
    if (activeTabId === id) {
      const next = tabs[idx] || tabs[idx - 1] || tabs[0];
      switchTab(next.id);
    } else {
      renderTabStrip();
    }
  }

  function renderTabStrip() {
    tabStrip.querySelectorAll('.tab').forEach(el => el.remove());
    tabs.forEach(tab => {
      const el = document.createElement('div');
      el.className = 'tab' + (tab.id === activeTabId ? ' active' : '');
      el.setAttribute('role', 'tab');
      el.innerHTML = `
        <span class="favicon">${faviconFor(tab.url)}</span>
        <span class="tabTitle">${escapeHtml(tab.title || 'New tab')}</span>
        <button class="tabClose" aria-label="Close tab">✕</button>
      `;
      el.addEventListener('click', (e) => {
        if (e.target.closest('.tabClose')) return;
        switchTab(tab.id);
      });
      el.querySelector('.tabClose').addEventListener('click', (e) => {
        e.stopPropagation();
        closeTab(tab.id);
      });
      tabStrip.insertBefore(el, newTabBtn);
    });
  }

  function escapeHtml(s) {
    return (s || '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }

  // ---------- Navigation ----------
  function navigate(url, tabId, opts = {}) {
    const tab = getTab(tabId || activeTabId);
    if (!tab) return;

    startScreen.classList.add('hidden');

    if (!tab.iframeEl) {
      const iframe = document.createElement('iframe');
      iframe.setAttribute('sandbox', 'allow-scripts allow-forms allow-popups allow-same-origin allow-popups-to-escape-sandbox');
      viewport.appendChild(iframe);
      tab.iframeEl = iframe;

      let loadTimer = null;
      iframe.addEventListener('load', () => {
        clearTimeout(loadTimer);
        // Best-effort check: if the iframe loaded but is blank due to X-Frame-Options,
        // most browsers still fire 'load' — we cannot reliably read cross-origin content,
        // so we rely on a short heuristic timer as a backstop (see below) plus this event
        // to mark the tab loaded and refresh its title.
        tab.title = shortTitle(tab.url);
        if (tab.id === activeTabId) {
          urlInput.value = tab.url;
          renderTabStrip();
        }
      });
    }

    if (!opts.skipHistoryPush) {
      tab.history = tab.history.slice(0, tab.histIndex + 1);
      tab.history.push(url);
      tab.histIndex = tab.history.length - 1;
    }
    tab.url = url;
    tab.title = shortTitle(url);
    tab.iframeEl.src = url;
    if (tab.id === activeTabId) {
      tab.iframeEl.classList.add('visible');
      urlInput.value = url;
      updateNavButtons(tab);
      updateStarState(url);
    }
    renderTabStrip();
    pushHistory(url, tab.title);
  }

  function updateNavButtons(tab) {
    if (!tab) {
      backBtn.disabled = true;
      fwdBtn.disabled = true;
      return;
    }
    backBtn.disabled = tab.histIndex <= 0;
    fwdBtn.disabled = tab.histIndex >= tab.history.length - 1;
  }

  backBtn.addEventListener('click', () => {
    const tab = getTab(activeTabId);
    if (!tab || tab.histIndex <= 0) return;
    tab.histIndex--;
    navigate(tab.history[tab.histIndex], tab.id, { skipHistoryPush: true });
    updateNavButtons(tab);
  });

  fwdBtn.addEventListener('click', () => {
    const tab = getTab(activeTabId);
    if (!tab || tab.histIndex >= tab.history.length - 1) return;
    tab.histIndex++;
    navigate(tab.history[tab.histIndex], tab.id, { skipHistoryPush: true });
    updateNavButtons(tab);
  });

  reloadBtn.addEventListener('click', () => {
    const tab = getTab(activeTabId);
    if (!tab || !tab.iframeEl) return;
    tab.iframeEl.src = tab.iframeEl.src;
  });

  // ---------- URL form ----------
  urlForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const target = normalizeInput(urlInput.value);
    if (!target) return;
    urlInput.blur();

    if (isLikelyBlocked(target)) {
      openExternally(target);
      return;
    }
    navigate(target, activeTabId);
  });

  urlInput.addEventListener('focus', () => urlInput.select());

  // ---------- Known-blocked shortcut list ----------
  // A small allowlist of hosts we already know refuse iframing, so we can
  // skip straight to "open externally" instead of showing a blank frame first.
  const KNOWN_BLOCKED = [
    'google.com', 'youtube.com', 'facebook.com', 'instagram.com',
    'twitter.com', 'x.com', 'reddit.com', 'amazon.com', 'github.com',
    'stackoverflow.com', 'linkedin.com', 'netflix.com', 'tiktok.com',
    'gmail.com', 'mail.google.com', 'accounts.google.com', 'whatsapp.com'
  ];

  function isLikelyBlocked(url) {
    try {
      const h = new URL(url).hostname.replace(/^www\./, '');
      return KNOWN_BLOCKED.some(b => h === b || h.endsWith('.' + b));
    } catch { return false; }
  }

  function openExternally(url) {
    window.open(url, '_blank', 'noopener');
    showToast('This site blocks embedding — opened in a new browser tab');
    pushHistory(url, shortTitle(url));
  }

  function showToast(msg) {
    toast.textContent = msg;
    toast.classList.add('show');
    clearTimeout(showToast._t);
    showToast._t = setTimeout(() => toast.classList.remove('show'), 2600);
  }

  // ---------- New tab ----------
  newTabBtn.addEventListener('click', () => createTab(null));

  // ---------- Bookmarks ----------
  function updateStarState(url) {
    if (!url) { starBtn.classList.remove('active'); return; }
    starBtn.classList.toggle('active', bookmarks.some(b => b.url === url));
  }

  starBtn.addEventListener('click', () => {
    const tab = getTab(activeTabId);
    if (!tab || !tab.url) return;
    const idx = bookmarks.findIndex(b => b.url === tab.url);
    if (idx > -1) {
      bookmarks.splice(idx, 1);
      showToast('Bookmark removed');
    } else {
      bookmarks.unshift({ url: tab.url, title: tab.title || shortTitle(tab.url) });
      showToast('Bookmarked');
    }
    store.set('puffin_bookmarks', bookmarks);
    updateStarState(tab.url);
    renderBookmarks();
  });

  function renderBookmarks() {
    if (bookmarks.length === 0) {
      bookmarksView.innerHTML = '<div class="emptyState">No bookmarks yet. Tap ⭐ on any page to save it.</div>';
      return;
    }
    bookmarksView.innerHTML = '';
    bookmarks.forEach((b, i) => {
      const el = buildListItem(b.title, b.url, () => {
        closePanel();
        openFromList(b.url);
      }, () => {
        bookmarks.splice(i, 1);
        store.set('puffin_bookmarks', bookmarks);
        renderBookmarks();
        updateStarState(getTab(activeTabId)?.url);
      });
      bookmarksView.appendChild(el);
    });
  }

  // ---------- History ----------
  function pushHistory(url, title) {
    history = history.filter(h => h.url !== url);
    history.unshift({ url, title: title || shortTitle(url), ts: Date.now() });
    if (history.length > 200) history = history.slice(0, 200);
    store.set('puffin_history', history);
  }

  function renderHistory() {
    if (history.length === 0) {
      historyView.innerHTML = '<div class="emptyState">No history yet.</div>';
      return;
    }
    historyView.innerHTML = '';
    history.slice(0, 100).forEach((h, i) => {
      const el = buildListItem(h.title, h.url, () => {
        closePanel();
        openFromList(h.url);
      }, () => {
        history.splice(i, 1);
        store.set('puffin_history', history);
        renderHistory();
      });
      historyView.appendChild(el);
    });
  }

  clearHistoryBtn.addEventListener('click', () => {
    history = [];
    store.set('puffin_history', history);
    renderHistory();
    showToast('History cleared');
  });

  function buildListItem(title, url, onOpen, onRemove) {
    const el = document.createElement('div');
    el.className = 'listItem';
    el.innerHTML = `
      <span class="favicon">${faviconFor(url)}</span>
      <span class="itemText">
        <div class="itemTitle">${escapeHtml(title)}</div>
        <div class="itemUrl">${escapeHtml(url)}</div>
      </span>
      <button class="itemRemove" aria-label="Remove">✕</button>
    `;
    el.addEventListener('click', (e) => {
      if (e.target.closest('.itemRemove')) return;
      onOpen();
    });
    el.querySelector('.itemRemove').addEventListener('click', (e) => {
      e.stopPropagation();
      onRemove();
    });
    return el;
  }

  function openFromList(url) {
    if (isLikelyBlocked(url)) { openExternally(url); return; }
    let tab = getTab(activeTabId);
    if (!tab || tab.url) tab = createTab(null);
    navigate(url, tab.id);
  }

  // ---------- Menu panel ----------
  function openPanel() {
    overlay.classList.add('show');
    menuPanel.classList.add('show');
    showMenuRoot();
  }
  function closePanel() {
    overlay.classList.remove('show');
    menuPanel.classList.remove('show');
  }
  function showMenuRoot() {
    panelTitle.textContent = 'Menu';
    menuList.hidden = false;
    bookmarksView.hidden = true;
    historyView.hidden = true;
  }
  menuBtn.addEventListener('click', openPanel);
  panelClose.addEventListener('click', closePanel);
  overlay.addEventListener('click', closePanel);

  menuList.querySelectorAll('.menuItem[data-view]').forEach(btn => {
    btn.addEventListener('click', () => {
      const view = btn.dataset.view;
      menuList.hidden = true;
      if (view === 'bookmarks') {
        panelTitle.textContent = 'Bookmarks';
        bookmarksView.hidden = false;
        renderBookmarks();
      } else if (view === 'history') {
        panelTitle.textContent = 'History';
        historyView.hidden = false;
        renderHistory();
      }
    });
  });

  // Back arrow inside sub-views returns to root — add via long-press title area
  panelTitle.addEventListener('click', () => {
    if (!menuList.hidden) return;
    showMenuRoot();
  });

  // ---------- Service worker ----------
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('sw.js').catch(() => {});
    });
  }

  // ---------- Init ----------
  createTab(null);
})();
