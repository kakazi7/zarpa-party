// Netflix browse UI: a "Start Zarpa Party" button next to Netflix's own Play button (billboard hero,
// details modal, mini hover card). Clicking it leaves a short-lived flag and starts the video;
// content/main.js sees the flag once the video is ready and creates the party. Netflix's DOM
// changes often, so every lookup is best effort: a miss means no button, never a broken page.
(() => {
  'use strict';
  if (window.top !== window || globalThis.ZP_NF) return;
  globalThis.ZP_NF = true;

  const AUTOSTART_KEY = 'zarpaPartyAutostart'; // read by content/main.js
  const PAGES = /^\/(browse|title|search|latest)\b/;
  const CONTAINERS = '.billboard-links, .previewModal--container .buttonControls--container';
  const PLAY = '[data-uia="play-button"], [data-uia*="play"], a[href*="/watch/"]';
  const t = (key) => chrome.i18n.getMessage(key) || key;

  const CSS = `
.zp-nf-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: .55em; box-sizing: border-box;
  margin: 0 0 0 .75rem; padding: .7em 1.5em .7em 1.2em; border: 0; border-radius: 4px; cursor: pointer;
  background: #c8f542; color: #0b0d10; font: 700 1.15rem/1.2 "Netflix Sans", system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  white-space: nowrap; vertical-align: middle; flex: none; transition: filter .15s, transform .15s;
}
.zp-nf-btn:hover { filter: brightness(1.1); }
.zp-nf-btn:active { transform: scale(.97); }
.zp-nf-btn:focus-visible { outline: 2px solid #fff; outline-offset: 2px; }
.zp-nf-btn svg { width: 1.5em; height: 1.5em; flex: none; }
.zp-nf-mini { width: 40px; height: 40px; min-width: 40px; padding: 0; margin: 0 0 0 .5em; border-radius: 50%; font-size: 13px; letter-spacing: .02em; box-shadow: 0 0 0 2px rgba(200, 245, 66, .45); }
.zp-nf-mini:hover { box-shadow: 0 0 0 2px #fff; }
@media (prefers-reduced-motion: reduce) { .zp-nf-btn { transition: none; } }
`;

  function addStyles() {
    try {
      const sheet = new CSSStyleSheet(); // constructable sheet: not subject to the page's style-src CSP
      sheet.replaceSync(CSS);
      document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = CSS;
      (document.head || document.documentElement).append(style);
    }
  }

  function logo() {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    const box = document.createElementNS(ns, 'rect');
    for (const [k, v] of Object.entries({ width: 24, height: 24, rx: 7, fill: '#0b0d10' })) box.setAttribute(k, v);
    const tri = document.createElementNS(ns, 'path');
    tri.setAttribute('d', 'M9 6.5v11l9-5.5z');
    tri.setAttribute('fill', '#c8f542');
    svg.append(box, tri);
    return svg;
  }

  function findPlay(box) {
    const own = (el) => el && !el.closest('.zp-nf-btn');
    for (const el of box.querySelectorAll(PLAY)) if (own(el)) return el;
    for (const el of box.querySelectorAll('button, a, [role="button"]')) {
      if (own(el) && /play|assistir|reproduzir/i.test(el.getAttribute('aria-label') || '')) return el;
    }
    return null;
  }

  function titleId(box, play) {
    const link = play.closest('a[href*="/watch/"]') || box.querySelector('a[href*="/watch/"]');
    const m = link && link.getAttribute('href').match(/\/watch\/(\d+)/);
    if (m) return m[1];
    // The details modal puts its title in ?jbv=; the billboard and hover cards must not borrow it.
    if (box.closest('.previewModal--container') && !box.closest('.mini-modal')) {
      const jbv = new URLSearchParams(location.search).get('jbv');
      if (/^\d+$/.test(jbv || '')) return jbv;
    }
    return null;
  }

  function start(box, play) {
    try {
      sessionStorage.setItem(AUTOSTART_KEY, String(Date.now()));
    } catch {}
    const id = titleId(box, play);
    if (id) return location.assign('https://www.netflix.com/watch/' + id);
    play.click();
    // Netflix navigates without a page load here, so main.js's boot check never runs: nudge it.
    const until = Date.now() + 15000;
    const timer = setInterval(() => {
      if (location.pathname.startsWith('/watch/')) globalThis.ZP?.autostart?.();
      if (location.pathname.startsWith('/watch/') || Date.now() > until) clearInterval(timer);
    }, 300);
  }

  function makeButton(box, play, mini) {
    const label = t('nfStart');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = mini ? 'zp-nf-btn zp-nf-mini' : 'zp-nf-btn';
    btn.title = label;
    btn.setAttribute('aria-label', label);
    if (mini) btn.textContent = 'ZP';
    else btn.append(logo(), document.createTextNode(label));
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation(); // keep the card/modal from treating it as its own click
      start(box, play);
    });
    return btn;
  }

  function scan() {
    if (!PAGES.test(location.pathname)) return;
    for (const box of document.querySelectorAll(CONTAINERS)) {
      if (box.querySelector('.zp-nf-btn')) continue; // already done (and redone after a re-render)
      const play = findPlay(box);
      if (!play) continue;
      let anchor = play; // insert next to the row item that holds Play, not inside a wrapper
      while (anchor.parentElement && anchor.parentElement !== box) anchor = anchor.parentElement;
      try {
        anchor.after(makeButton(box, play, !!box.closest('.mini-modal')));
      } catch {}
    }
  }

  let pending = 0;
  const schedule = () => {
    if (!pending) pending = setTimeout(() => ((pending = 0), scan()), 250);
  };

  addStyles();
  scan();
  new MutationObserver(schedule).observe(document.documentElement, { childList: true, subtree: true });
})();
