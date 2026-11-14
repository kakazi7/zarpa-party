// Chat sidebar. Lives in a closed Shadow DOM so page CSS/JS cannot touch it; every piece of user
// text goes in through textContent.
(() => {
  'use strict';
  const ZP = (globalThis.ZP = globalThis.ZP || {});
  const WIDTH = 320;
  const MAX_ROWS = 200;
  const OPEN_KEY = 'zarpaPartyOpen';

  const CSS = `
:host { all: initial; }
.zp {
  --bg: #0b0d10; --surface: #14171c; --surface-2: #1d2128; --line: #272c35;
  --text: #f2f4f7; --muted: #939bab; --accent: #c8f542; --accent-ink: #0b0d10; --danger: #ff7a7a;
  --radius: 12px; --w: ${WIDTH}px; --ease: cubic-bezier(.2, .8, .2, 1);
  font: 14px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  color: var(--text); color-scheme: dark; text-align: left; letter-spacing: normal;
}
*, *::before, *::after { box-sizing: border-box; }
button, input { font: inherit; color: inherit; margin: 0; }
button { cursor: pointer; border: 0; background: none; padding: 0; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
[hidden] { display: none !important; }
svg { width: 18px; height: 18px; fill: none; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; flex: none; }

.panel {
  position: fixed; top: 0; right: 0; width: min(var(--w), 100vw); height: 100vh; height: 100dvh;
  display: flex; flex-direction: column; background: var(--bg); border-left: 1px solid var(--line);
  box-shadow: -18px 0 48px rgba(0, 0, 0, .45);
  transform: translateX(100%); visibility: hidden;
  transition: transform .26s var(--ease), visibility 0s .26s;
}
.zp.open .panel { transform: none; visibility: visible; transition: transform .26s var(--ease), visibility 0s; }

.head { display: flex; align-items: center; gap: 8px; padding: 12px 10px 12px 14px; border-bottom: 1px solid var(--line); }
.mark { width: 24px; height: 24px; border-radius: 7px; background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; flex: none; }
.mark svg { width: 12px; height: 12px; fill: currentColor; stroke: none; }
.title { font-weight: 650; font-size: 14px; letter-spacing: .01em; flex: 1; min-width: 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.dot { width: 8px; height: 8px; border-radius: 50%; background: var(--muted); flex: none; }
.dot.connected { background: var(--accent); box-shadow: 0 0 0 3px rgba(200, 245, 66, .16); }
.dot.reconnecting, .dot.connecting { background: #ffb454; animation: pulse 1.1s ease-in-out infinite; }
.icon { height: 32px; min-width: 32px; padding: 0 7px; border-radius: 9px; display: inline-flex; align-items: center; justify-content: center; gap: 5px; color: var(--muted); transition: background .15s, color .15s; }
.icon:hover, .icon[aria-expanded="true"] { background: var(--surface-2); color: var(--text); }
.icon.danger:hover { color: var(--danger); }
.count { font-size: 12px; font-weight: 600; font-variant-numeric: tabular-nums; }

.peers { max-height: 34%; overflow-y: auto; padding: 8px 10px; border-bottom: 1px solid var(--line); background: var(--surface); display: grid; gap: 2px; }
.peer { display: flex; align-items: center; gap: 9px; padding: 5px 4px; min-width: 0; }
.peer .who { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.tag { font-size: 10px; font-weight: 650; text-transform: uppercase; letter-spacing: .06em; padding: 2px 6px; border-radius: 99px; background: var(--surface-2); color: var(--muted); }
.tag.host { background: rgba(200, 245, 66, .14); color: var(--accent); }

.av { width: 26px; height: 26px; border-radius: 50%; display: grid; place-items: center; flex: none; font-size: 12px; font-weight: 700; color: #0b0d10; text-transform: uppercase; }

.log { flex: 1; min-height: 0; overflow-y: auto; padding: 12px 12px 6px; display: flex; flex-direction: column; gap: 10px; overscroll-behavior: contain; scrollbar-width: thin; scrollbar-color: var(--line) transparent; }
.empty { margin: auto; text-align: center; color: var(--muted); font-size: 13px; max-width: 200px; }
.msg { display: flex; gap: 9px; align-items: flex-start; animation: in .22s var(--ease); }
.msg .body { min-width: 0; flex: 1; }
.msg .who { font-size: 12px; font-weight: 650; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msg .txt { overflow-wrap: anywhere; white-space: pre-wrap; }
.sys { align-self: center; text-align: center; font-size: 12px; color: var(--muted); padding: 0 8px; animation: in .22s var(--ease); overflow-wrap: anywhere; }
.sys button { display: block; margin: 6px auto 0; padding: 5px 12px; border-radius: 99px; background: var(--accent); color: var(--accent-ink); font-size: 12px; font-weight: 650; }

.reacts { display: flex; justify-content: space-between; gap: 2px; padding: 4px 10px; }
.reacts button { flex: 1; height: 34px; border-radius: 9px; font-size: 18px; line-height: 1; transition: background .15s, transform .15s var(--ease); }
.reacts button:hover { background: var(--surface-2); transform: translateY(-2px); }
.reacts button:active { transform: scale(.88); }

.composer { display: flex; gap: 8px; padding: 6px 10px 10px; }
.field { flex: 1; min-width: 0; height: 40px; padding: 0 12px; border-radius: var(--radius); border: 1px solid var(--line); background: var(--surface); color: var(--text); outline: none; transition: border-color .15s; }
.field::placeholder { color: var(--muted); }
.field:focus { border-color: var(--accent); }
.send { width: 40px; height: 40px; border-radius: var(--radius); background: var(--accent); color: var(--accent-ink); display: grid; place-items: center; flex: none; transition: transform .15s var(--ease), filter .15s; }
.send:hover { filter: brightness(1.08); }
.send:active { transform: scale(.92); }

.foot { display: flex; align-items: center; gap: 4px; padding: 8px 10px; border-top: 1px solid var(--line); background: var(--surface); }
.me { flex: 1; min-width: 0; display: flex; align-items: center; gap: 8px; height: 34px; padding: 0 6px; border-radius: 9px; text-align: left; }
.me:hover { background: var(--surface-2); }
.me .who { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; font-weight: 600; }
.me svg { width: 13px; height: 13px; color: var(--muted); }
.nameform { flex: 1; min-width: 0; display: flex; }
.nameform .field { height: 34px; }

.tab {
  position: fixed; right: 0; top: 50%; transform: translateY(-50%);
  width: 40px; height: 52px; border-radius: 14px 0 0 14px; background: var(--bg); color: var(--accent);
  border: 1px solid var(--line); border-right: 0; display: grid; place-items: center;
  box-shadow: -6px 0 24px rgba(0, 0, 0, .4); opacity: .78; transition: opacity .15s, width .15s var(--ease);
}
.tab:hover, .tab:focus-visible { opacity: 1; width: 46px; }
.zp.open .tab { display: none; }
.badge { position: absolute; top: -7px; left: -7px; min-width: 20px; height: 20px; padding: 0 5px; border-radius: 99px; background: var(--accent); color: var(--accent-ink); font-size: 11px; font-weight: 700; display: grid; place-items: center; animation: pop .3s var(--ease); }

.donate { flex: 1; min-height: 0; overflow-y: auto; padding: 16px 14px; display: flex; flex-direction: column; gap: 10px; animation: in .22s var(--ease); }
.donate img { width: 100%; max-width: 260px; aspect-ratio: 1; align-self: center; background: #fff; border-radius: var(--radius); image-rendering: pixelated; }
.donate p { margin: 0; text-align: center; color: var(--muted); font-size: 13px; }
.donate code { font: 12px ui-monospace, Consolas, monospace; text-align: center; overflow-wrap: anywhere; user-select: all; }
.donate .btn { height: 38px; border-radius: var(--radius); font-weight: 600; background: var(--surface-2); border: 1px solid var(--line); }
.donate .btn.primary { background: var(--accent); color: var(--accent-ink); border-color: transparent; }
.icon.heart:hover { color: #ff7a90; }

.fx { position: fixed; inset: 0; pointer-events: none; overflow: hidden; }
.zp.open .fx { right: min(var(--w), 100vw); }
.fx span { position: absolute; bottom: 14%; font-size: 38px; line-height: 1; animation: rise 2.6s cubic-bezier(.2, .6, .3, 1) forwards; text-shadow: 0 4px 18px rgba(0, 0, 0, .5); }

@keyframes in { from { opacity: 0; transform: translateY(6px); } }
@keyframes pop { from { transform: scale(.4); } }
@keyframes pulse { 50% { opacity: .35; } }
@keyframes rise {
  0% { opacity: 0; transform: translateY(0) scale(.5); }
  12% { opacity: 1; transform: translateY(-4vh) scale(1.15); }
  100% { opacity: 0; transform: translateY(-52vh) scale(1); }
}
@media (max-height: 420px) { .reacts { display: none; } .head { padding-block: 6px; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation: none !important; transition: none !important; }
}
`;

  const ICONS = {
    play: 'M7 4.5v15l12-7.5z',
    chat: 'M4 5h16v11H10l-5 4v-4H4z',
    close: 'M9 6l6 6-6 6',
    send: 'M5 12h13M12 6l6 6-6 6',
    people: 'M16 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1M9.5 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M21 19v-1a4 4 0 0 0-3-3.9M15.5 4.1a3 3 0 0 1 0 5.8',
    link: 'M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1',
    leave: 'M14 4h5v16h-5M10 8l-4 4 4 4M6 12h9',
    edit: 'M4 20h4L19 9l-4-4L4 16z',
    heart: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  };

  function icon(name) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', ICONS[name]);
    svg.append(path);
    return svg;
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (k === 'class') el.className = v;
      else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    }
    el.append(...kids.filter(Boolean));
    return el;
  }

  function avatar(name, color) {
    const el = h('span', { class: 'av', 'aria-hidden': 'true', text: [...(name || '?')][0] || '?' });
    el.style.background = color;
    return el;
  }

  // handlers: { t, onSend, onReact, onName, onLeave, onCopy }
  ZP.createUI = ({ t, onSend, onReact, onName, onLeave, onCopy }) => {
    const host = document.createElement('zarpa-party');
    host.style.cssText = 'all:initial;position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    try {
      const sheet = new CSSStyleSheet(); // constructable sheet: not subject to the page's style-src CSP
      sheet.replaceSync(CSS);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      shadow.append(h('style', { text: CSS }));
    }

    let open = true;
    let unread = 0;
    let me = { name: '', color: '#c8f542' };
    let pushed = null;

    const dot = h('span', { class: 'dot connecting', role: 'img' });
    const count = h('span', { class: 'count', text: '1' });
    const peersBox = h('div', { class: 'peers', hidden: '' });
    const peopleBtn = h('button', {
      class: 'icon', type: 'button', 'aria-expanded': 'false', 'aria-label': t('uiPeople'), title: t('uiPeople'),
      onclick: () => {
        peersBox.hidden = !peersBox.hidden;
        peopleBtn.setAttribute('aria-expanded', String(!peersBox.hidden));
      },
    }, icon('people'), count);
    const empty = h('div', { class: 'empty', text: t('uiEmpty') });
    const log = h('div', { class: 'log', role: 'log', 'aria-live': 'polite', tabindex: '0', 'aria-label': t('uiChat') }, empty);
    const input = h('input', {
      class: 'field', type: 'text', maxlength: String(ZP.core.MAX_CHAT), autocomplete: 'off', enterkeyhint: 'send',
      placeholder: t('uiChatPlaceholder'), 'aria-label': t('uiChatPlaceholder'),
    });
    const composer = h('form', {
      class: 'composer',
      onsubmit: (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (text && onSend(text) !== false) input.value = '';
      },
    }, input, h('button', { class: 'send', type: 'submit', 'aria-label': t('uiSend'), title: t('uiSend') }, icon('send')));
    const reacts = h('div', { class: 'reacts', role: 'group', 'aria-label': t('uiReact') },
      ...ZP.core.EMOJIS.map((e) => h('button', { type: 'button', text: e, 'aria-label': e, onclick: () => onReact(e) })));

    const meName = h('span', { class: 'who' });
    const meBtn = h('button', { class: 'me', type: 'button', title: t('uiEditName'), 'aria-label': t('uiEditName'), onclick: editName });
    const nameInput = h('input', { class: 'field', type: 'text', maxlength: String(ZP.core.MAX_NAME), autocomplete: 'off', 'aria-label': t('uiEditName') });
    const nameForm = h('form', { class: 'nameform', hidden: '', onsubmit: (e) => { e.preventDefault(); commitName(); } }, nameInput);
    nameInput.addEventListener('blur', commitName);

    const badge = h('span', { class: 'badge', hidden: '' });
    const tab = h('button', { class: 'tab', type: 'button', 'aria-label': t('uiExpand'), title: t('uiExpand'), onclick: () => toggle(true) }, icon('chat'), badge);
    const fx = h('div', { class: 'fx', 'aria-hidden': 'true' });

    // Pix donation pane, swapped in for the chat. The QR PNG is a web-accessible resource; if the
    // page blocks it (CSP, hand-enabled site) the key and copy button still work.
    const qr = h('img', { alt: 'QR Code Pix', width: '260', height: '260', src: chrome.runtime.getURL('icons/pix-qr.png') });
    qr.addEventListener('error', () => (qr.hidden = true));
    const copyPix = h('button', { class: 'btn primary', type: 'button', text: t('copyPix'), onclick: () => {
      navigator.clipboard.writeText(ZP.core.pixPayload()).then(() => {
        copyPix.textContent = t('copied');
        setTimeout(() => (copyPix.textContent = t('copyPix')), 1600);
      }, () => {});
    } });
    const donate = h('div', { class: 'donate', hidden: '' }, qr, h('p', { text: t('donateText') }),
      h('code', { text: ZP.core.PIX.key }), copyPix,
      h('button', { class: 'btn', type: 'button', text: t('back'), onclick: () => showDonate(false) }));
    const heartBtn = h('button', { class: 'icon heart', type: 'button', 'aria-label': t('donate'), title: t('donate'), onclick: () => showDonate(donate.hidden) }, icon('heart'));
    function showDonate(on) {
      donate.hidden = !on;
      log.hidden = reacts.hidden = composer.hidden = on;
      heartBtn.setAttribute('aria-expanded', String(on));
    }
    const panel = h('aside', { class: 'panel', 'aria-label': 'Zarpa Party' },
      h('div', { class: 'head' },
        h('span', { class: 'mark' }, icon('play')),
        h('span', { class: 'title', text: 'Zarpa Party' }),
        dot, heartBtn, peopleBtn,
        h('button', { class: 'icon', type: 'button', 'aria-label': t('uiCollapse'), title: t('uiCollapse'), onclick: () => toggle(false) }, icon('close'))),
      peersBox, log, donate, reacts, composer,
      h('div', { class: 'foot' }, meBtn, nameForm,
        h('button', { class: 'icon', type: 'button', 'aria-label': t('uiCopyLink'), title: t('uiCopyLink'), onclick: () => onCopy() }, icon('link')),
        h('button', { class: 'icon danger', type: 'button', 'aria-label': t('uiLeave'), title: t('uiLeave'), onclick: () => onLeave() }, icon('leave'))));
    const root = h('div', { class: 'zp open' }, fx, tab, panel);
    shadow.append(root);

    function editName() {
      meBtn.hidden = true;
      nameForm.hidden = false;
      nameInput.value = me.name;
      nameInput.focus();
      nameInput.select();
    }

    function commitName() {
      if (nameForm.hidden) return;
      nameForm.hidden = true;
      meBtn.hidden = false;
      const name = ZP.core.cleanName(nameInput.value);
      if (name && name !== me.name) onName(name);
    }

    function setMe(name, color) {
      me = { name, color };
      meName.textContent = name;
      meBtn.replaceChildren(avatar(name, color), meName, icon('edit'));
    }

    function addRow(row, mine) {
      empty.remove();
      const pinned = mine || log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      log.append(row);
      while (log.childElementCount > MAX_ROWS) log.firstElementChild.remove();
      if (pinned) log.scrollTop = log.scrollHeight;
    }

    function addChat({ name, color, text, mine }) {
      const who = h('div', { class: 'who', text: name });
      who.style.color = color;
      addRow(h('div', { class: 'msg' }, avatar(name, color), h('div', { class: 'body' }, who, h('div', { class: 'txt', text }))), mine);
      if (!open && !mine) {
        unread++;
        badge.textContent = unread > 99 ? '99+' : String(unread);
        badge.hidden = false;
      }
    }

    // action: optional { label, run } rendered as a button under the message.
    function addSystem(text, action) {
      const row = h('div', { class: 'sys', text });
      if (action) row.append(h('button', { type: 'button', text: action.label, onclick: action.run }));
      addRow(row, false);
    }

    function setPeers(peers) {
      count.textContent = String(Math.max(1, peers.length));
      peersBox.replaceChildren(...peers.map((p) => h('div', { class: 'peer' },
        avatar(p.name, p.color),
        h('span', { class: 'who', text: p.name }),
        p.me && h('span', { class: 'tag', text: t('you') }),
        p.host && h('span', { class: 'tag host', text: t('host') }))));
    }

    function setStatus(status) {
      dot.className = 'dot ' + status;
      const label = t(status === 'connected' ? 'statusConnected' : status === 'connecting' ? 'statusConnecting' : 'statusReconnecting');
      dot.title = label;
      dot.setAttribute('aria-label', label);
    }

    function float(emoji) {
      if (fx.childElementCount > 24) return;
      const el = h('span', { text: emoji });
      el.style.right = 4 + Math.random() * 22 + '%';
      fx.append(el);
      setTimeout(() => el.remove(), 2600);
    }

    // Best effort: make room for the panel instead of covering the video. Fixed-position players
    // ignore it and simply get overlaid.
    function push() {
      const el = document.documentElement;
      const want = open && host.isConnected && !document.fullscreenElement && window.innerWidth >= 900;
      if (want && !pushed) {
        pushed = { width: el.style.getPropertyValue('width'), wp: el.style.getPropertyPriority('width'), position: el.style.getPropertyValue('position'), pp: el.style.getPropertyPriority('position') };
        el.style.setProperty('width', `calc(100% - ${WIDTH}px)`, 'important');
        el.style.setProperty('position', 'relative', 'important');
      } else if (!want && pushed) {
        el.style.setProperty('width', pushed.width, pushed.wp);
        el.style.setProperty('position', pushed.position, pushed.pp);
        pushed = null;
      }
    }

    function toggle(next = !open) {
      open = next;
      root.classList.toggle('open', open);
      try {
        sessionStorage.setItem(OPEN_KEY, open ? '1' : '0');
      } catch {}
      if (open) {
        unread = 0;
        badge.hidden = true;
        log.scrollTop = log.scrollHeight;
      }
      push();
      return open;
    }

    // Fullscreen only paints the fullscreen element's subtree, so the sidebar has to move into it.
    function place() {
      const fs = document.fullscreenElement;
      const parent = fs && !/^(VIDEO|IFRAME|CANVAS)$/.test(fs.tagName) ? fs : document.documentElement;
      if (host.parentNode !== parent) parent.append(host);
      push();
    }

    // Registered on window in the capture phase, so it runs before the site's own shortcut handlers
    // (space, F, K, arrows...) and keeps typing in the chat from controlling the player.
    function trapKeys(e) {
      if (e.target !== host) return;
      e.stopImmediatePropagation();
      if (e.type === 'keydown' && e.key === 'Escape') {
        if (!nameForm.hidden) {
          nameInput.value = me.name;
          commitName();
        } else if (shadow.activeElement) shadow.activeElement.blur();
      }
    }
    const KEY_EVENTS = ['keydown', 'keyup', 'keypress'];

    function mount() {
      try {
        open = sessionStorage.getItem(OPEN_KEY) !== '0';
      } catch {}
      root.classList.toggle('open', open);
      place();
      document.addEventListener('fullscreenchange', place);
      window.addEventListener('resize', push);
      for (const type of KEY_EVENTS) window.addEventListener(type, trapKeys, true);
    }

    function unmount() {
      document.removeEventListener('fullscreenchange', place);
      window.removeEventListener('resize', push);
      for (const type of KEY_EVENTS) window.removeEventListener(type, trapKeys, true);
      host.remove();
      push();
    }

    return { mount, unmount, addChat, addSystem, setPeers, setStatus, setMe, float, toggle, isOpen: () => open };
  };
})();
