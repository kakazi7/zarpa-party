// Runs in the page's MAIN world on netflix.com only. Netflix's own player API is the only safe way to
// seek (writing video.currentTime triggers error M7375). Commands arrive from our isolated-world
// content script over window.postMessage and are strictly validated.
(() => {
  'use strict';
  if (window.__zarpaPartyNetflix) return;
  window.__zarpaPartyNetflix = true;

  function currentPlayer() {
    try {
      const api = window.netflix.appContext.state.playerApp.getAPI().videoPlayer;
      const ids = api.getAllPlayerSessionIds();
      // Billboard/preview trailers also own sessions; the real one is prefixed "watch".
      const id = ids.find((s) => String(s).startsWith('watch')) || ids[0];
      return id ? api.getVideoPlayerBySessionId(id) : null;
    } catch {
      return null;
    }
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const d = event.data;
    if (!d || typeof d !== 'object' || d.source !== 'zarpa-party' || typeof d.cmd !== 'string') return;
    const player = currentPlayer();
    if (!player) return;
    try {
      if (d.cmd === 'seek') {
        if (typeof d.ms === 'number' && Number.isFinite(d.ms) && d.ms >= 0) player.seek(Math.round(d.ms));
      } else if (d.cmd === 'play') player.play();
      else if (d.cmd === 'pause') player.pause();
    } catch {
      // Player not ready; the next drift correction retries.
    }
  });
})();
