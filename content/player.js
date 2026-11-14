// Finds the main <video> of this frame and wraps it in a tiny uniform API.
// Netflix is the one special case: writing video.currentTime there crashes the player (error M7375),
// so seek/play/pause go through netflix-main.js (MAIN world) via window.postMessage.
(() => {
  'use strict';
  const ZP = (globalThis.ZP = globalThis.ZP || {});
  const IS_NETFLIX = /(^|\.)netflix\.com$/.test(location.hostname);
  const EVENTS = { play: 'playback', pause: 'playback', seeked: 'seeked', ratechange: 'rate' };
  const DEBOUNCE_MS = 80; // merges the pause+seek+play bursts players emit for one user action
  const RESCAN_MS = 1000;

  // onEvent(flags, state): the user (or the site) changed playback. onChange(): the main video changed.
  // onBlocked(): the browser refused to start playback without a user gesture.
  ZP.createPlayer = ({ onEvent, onChange, onBlocked }) => {
    let video = null;
    let baseRate = 1; // the rate the party agreed on; the actual rate is baseRate * nudge
    let nudge = 1;
    let flags = null;
    let flushTimer = 0;
    let scanTimer = 0;

    // chrome.dom.openOrClosedShadowRoot throws for non-HTMLElement nodes (e.g. <svg>).
    const shadowOf = (el) => {
      if (!(el instanceof HTMLElement)) return null;
      try { return globalThis.chrome?.dom?.openOrClosedShadowRoot?.(el) || el.shadowRoot; } catch { return el.shadowRoot; }
    };

    function allVideos() {
      const found = [...document.querySelectorAll('video')];
      if (found.length) return found;
      // ponytail: full-DOM walk for players hidden in shadow roots (e.g. Disney+), only when the light
      // DOM has no <video>. One level deep; recurse if a site ever nests shadow roots.
      for (const el of document.querySelectorAll('*')) {
        const root = shadowOf(el);
        if (root) found.push(...root.querySelectorAll('video'));
      }
      return found;
    }

    function pick() {
      let best = null;
      let bestArea = 0;
      for (const v of allVideos()) {
        if (v.readyState < 1) continue;
        const r = v.getBoundingClientRect();
        if (r.width < 160 || r.height < 90) continue;
        const area = r.width * r.height;
        if (area > bestArea) {
          best = v;
          bestArea = area;
        }
      }
      return best;
    }

    const onMedia = (e) => {
      if (e.target !== video) return;
      if (e.type === 'emptied') return rescan(true); // same element, new source (YouTube, ads)
      flags = flags || {};
      flags[EVENTS[e.type]] = true;
      clearTimeout(flushTimer);
      flushTimer = setTimeout(flush, DEBOUNCE_MS);
    };

    // Deliver pending events now. Callers use it before reading state so a user action is never
    // mistaken for drift.
    function flush() {
      clearTimeout(flushTimer);
      if (!flags) return;
      const fired = flags;
      flags = null;
      const st = state();
      if (st) onEvent(fired, st);
    }

    function bind(next) {
      const types = [...Object.keys(EVENTS), 'emptied'];
      if (video) for (const t of types) video.removeEventListener(t, onMedia);
      video = next;
      flags = null;
      nudge = 1;
      if (video) {
        baseRate = video.playbackRate;
        for (const t of types) video.addEventListener(t, onMedia);
      }
    }

    function rescan(force) {
      const next = pick();
      if (next === video && !force) return;
      bind(next);
      onChange();
    }

    function scheduleScan() {
      if (scanTimer) return;
      scanTimer = setTimeout(() => {
        scanTimer = 0;
        rescan(false);
      }, RESCAN_MS);
    }

    function inAd(v) {
      // YouTube plays ads in the same <video>; syncing during one would drag everybody around.
      const yt = v.closest && v.closest('.html5-video-player');
      return !!yt && (yt.classList.contains('ad-showing') || yt.classList.contains('ad-interrupting'));
    }

    function state() {
      const v = video;
      if (!v || !v.isConnected) return null;
      let rate = v.playbackRate;
      if (nudge !== 1 && Math.abs(rate - baseRate * nudge) < 0.011) rate = baseRate;
      else {
        baseRate = rate; // changed by the user or the site: the nudge is over
        nudge = 1;
      }
      const duration = v.duration;
      return {
        time: v.currentTime,
        playing: !v.paused && !v.ended,
        rate,
        duration: Number.isFinite(duration) ? duration : 0,
        live: !Number.isFinite(duration),
        buffering: !v.paused && v.readyState < 3,
        ad: inAd(v),
      };
    }

    const netflix = (cmd, ms) => window.postMessage({ source: 'zarpa-party', cmd, ms }, location.origin);

    // cmd: { time?, playing?, rate?, nudge? } — only the fields that must change.
    function apply(cmd) {
      const v = video;
      if (!v || !v.isConnected) return;
      try {
        if (cmd.rate != null) {
          baseRate = cmd.rate;
          nudge = 1;
          v.playbackRate = cmd.rate;
        }
        if (cmd.nudge != null && cmd.nudge !== nudge) {
          nudge = cmd.nudge;
          v.playbackRate = baseRate * nudge;
        }
        if (cmd.time != null) {
          const max = Number.isFinite(v.duration) ? Math.max(0, v.duration - 0.5) : cmd.time;
          const t = Math.max(0, Math.min(cmd.time, max));
          if (IS_NETFLIX) netflix('seek', Math.round(t * 1000));
          else v.currentTime = t;
        }
        if (cmd.playing === true && (v.paused || v.ended)) {
          if (IS_NETFLIX) netflix('play');
          else {
            const p = v.play();
            if (p) p.catch((err) => err && err.name === 'NotAllowedError' && onBlocked());
          }
        } else if (cmd.playing === false && !v.paused) {
          if (IS_NETFLIX) netflix('pause');
          else v.pause();
        }
      } catch {
        // A detached or errored media element: the next rescan replaces it.
      }
    }

    function area() {
      if (!video || !video.isConnected) return 0;
      const r = video.getBoundingClientRect();
      return Math.round(r.width * r.height);
    }

    const observer = new MutationObserver(scheduleScan);
    observer.observe(document.documentElement, { childList: true, subtree: true });
    // Media events do not bubble, but they can be captured: catches videos that become ready later.
    document.addEventListener('loadedmetadata', scheduleScan, true);
    document.addEventListener('playing', scheduleScan, true);
    rescan(false);

    return { state, apply, flush, area, rescan: () => rescan(false) };
  };
})();
