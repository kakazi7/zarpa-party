// Popup: a remote control for the party running in the active tab's content script.
(() => {
  'use strict';
  const { core } = globalThis.ZP;
  const $ = (id) => document.getElementById(id);
  const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;

  let tab = null;
  let state = null;

  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of document.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
  document.documentElement.lang = chrome.i18n.getUILanguage();

  // Null when the tab has no content script (unsupported site, or not enabled yet).
  async function ask(msg) {
    try {
      return (await chrome.tabs.sendMessage(tab.id, msg, { frameId: 0 })) || null;
    } catch {
      return null;
    }
  }

  const isWeb = () => !!tab && /^https?:/.test(tab.url || '');

  function render(next) {
    state = next && next.ok ? next : null;
    const inRoom = !!state && !!state.room;
    $('app').hidden = false;
    $('viewOff').hidden = !!state;
    $('viewIdle').hidden = !state || inRoom;
    $('viewRoom').hidden = !inRoom;
    $('joinForm').hidden = inRoom || (!state && !isWeb());
    $('nameBox').hidden = !state;
    $('status').hidden = !inRoom;

    if (!state) {
      $('offText').textContent = t(isWeb() ? 'offSite' : 'unsupportedPage');
      $('enable').hidden = $('enableHint').hidden = !isWeb();
      return;
    }
    if (document.activeElement !== $('name')) $('name').value = state.name;
    $('noVideo').hidden = state.hasVideo;
    if (!inRoom) return;

    const connected = state.status === 'connected';
    $('status').classList.toggle('connected', connected);
    $('connText').textContent = t(connected ? 'statusConnected' : state.status === 'connecting' ? 'statusConnecting' : 'statusReconnecting');
    $('code').textContent = state.room;
    $('count').textContent = String(state.peers.length);
    $('peers').replaceChildren(...state.peers.map((p) => {
      const li = document.createElement('li');
      const av = document.createElement('span');
      av.className = 'av';
      av.style.background = p.color;
      av.textContent = [...p.name][0] || '?';
      const who = document.createElement('span');
      who.className = 'who';
      who.textContent = p.name;
      li.append(av, who);
      for (const [flag, cls, key] of [[p.me, 'tag', 'you'], [p.host, 'tag host', 'host']]) {
        if (!flag) continue;
        const tag = document.createElement('span');
        tag.className = cls;
        tag.textContent = t(key);
        li.append(tag);
      }
      return li;
    }));
    $('hostOnly').checked = state.hostOnly;
    $('hostOnly').disabled = !state.isHost;
    $('toggle').textContent = t(state.open ? 'closeChat' : 'openChat');
  }

  const refresh = async () => render(await ask({ zp: 'status' }));
  const act = async (msg) => render(await ask(msg));

  async function copyLink() {
    if (!state || !state.link) return;
    try {
      await navigator.clipboard.writeText(state.link);
      $('copy').textContent = t('copied');
      setTimeout(() => ($('copy').textContent = t('copyLink')), 1600);
    } catch {
      // Clipboard unavailable: the link stays reachable from the sidebar.
    }
  }

  $('create').addEventListener('click', async () => {
    await act({ zp: 'create' });
    await copyLink(); // one click: party created and invite already on the clipboard
  });
  $('copy').addEventListener('click', copyLink);
  $('leave').addEventListener('click', () => act({ zp: 'leave' }));
  $('toggle').addEventListener('click', () => act({ zp: 'toggle' }));
  $('hostOnly').addEventListener('change', (e) => act({ zp: 'setHostOnly', value: e.target.checked }));
  $('name').addEventListener('change', (e) => act({ zp: 'setName', name: e.target.value }));

  $('joinForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const value = $('joinInput').value.trim();
    const code = core.parseRoomCode(value);
    const fail = (key) => {
      $('joinError').textContent = t(key);
      $('joinError').hidden = false;
    };
    if (!code) return fail('invalidCode');
    $('joinError').hidden = true;
    // A full invite link for another page: go there, the content script joins on load.
    if (/^https?:\/\//i.test(value) && core.mediaKey(value) !== core.mediaKey(tab.url || '')) {
      await chrome.tabs.update(tab.id, { url: value });
      return window.close();
    }
    if (!state) return fail('offSite');
    await act({ zp: 'join', code });
  });

  $('enable').addEventListener('click', async () => {
    // Must run straight from the click: permission prompts need a user gesture. The service worker
    // reacts to the grant and injects the scripts; the refresh loop below picks it up.
    try {
      await chrome.permissions.request({ origins: [new URL(tab.url).origin + '/*'] });
    } catch {}
    refresh();
  });

  (async () => {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return render(null);
    await refresh();
    setInterval(refresh, 1000);
    const commands = await chrome.commands.getAll().catch(() => []);
    const shortcut = commands.find((c) => c.name === 'toggle-sidebar')?.shortcut;
    if (shortcut) {
      $('shortcut').textContent = t('shortcutHint', shortcut);
      $('shortcut').hidden = false;
    }
  })();
})();
