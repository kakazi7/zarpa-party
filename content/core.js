// Pure sync logic. No DOM, no chrome.* — loaded by the content scripts, the popup and the node tests.
(() => {
  'use strict';

  const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1
  const CODE_RE = /^[A-HJKMNP-Z2-9]{10,32}$/;
  const PARAM = 'zarpaParty';
  const EMOJIS = ['😂', '😮', '😍', '😢', '🔥', '👏'];
  const COLORS = ['#c8f542', '#5ee6d0', '#ffb454', '#ff7a90', '#8ab4ff', '#d59bff', '#7ee787', '#ffd166'];
  const MAX_CHAT = 500;
  const MAX_NAME = 24;

  // Seconds. Below `ignore` nothing happens; up to `seek` the playback rate is nudged; beyond it we seek.
  // `settle` is where an ongoing nudge stops; `event` is the tolerance when applying an explicit action.
  const DRIFT = { ignore: 0.5, settle: 0.1, seek: 2, nudge: 0.1, event: 0.5 };

  function generateRoomCode(length = 10, getRandomValues = (a) => crypto.getRandomValues(a)) {
    let out = '';
    const buf = new Uint8Array(length * 2);
    while (out.length < length) {
      getRandomValues(buf);
      for (const b of buf) {
        const i = b & 31; // rejection sampling: 31 symbols, index 31 is dropped to stay unbiased
        if (i < ALPHABET.length && out.length < length) out += ALPHABET[i];
      }
    }
    return out;
  }

  const randomId = () => generateRoomCode(12);

  // Accepts a bare code or any URL carrying ?zarpaParty= / #zarpaParty=.
  function parseRoomCode(input) {
    if (typeof input !== 'string') return null;
    const s = input.trim();
    const m = s.match(/[?#&]zarpaParty=([A-Za-z0-9]+)/);
    const code = (m ? m[1] : s).toUpperCase();
    return CODE_RE.test(code) ? code : null;
  }

  function buildInviteLink(href, code) {
    const u = new URL(href);
    u.searchParams.set(PARAM, code);
    return u.href;
  }

  function stripInvite(href) {
    const u = new URL(href);
    u.searchParams.delete(PARAM);
    if (u.hash.startsWith('#' + PARAM + '=')) u.hash = '';
    return u.href;
  }

  // Identifies "which video" a page is showing, ignoring tracking params.
  function mediaKey(href) {
    try {
      const u = new URL(href);
      const v = u.searchParams.get('v');
      return u.origin + u.pathname + (v ? '?v=' + v : '');
    } catch {
      return '';
    }
  }

  function formatTime(seconds) {
    const s = Math.max(0, Math.floor(Number(seconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
  }

  // state = { time, playing, rate, at } where `at` is the local clock (ms) at which `time` was true.
  function extrapolate(state, now) {
    return state.playing ? state.time + ((now - state.at) / 1000) * state.rate : state.time;
  }

  // Last-writer-wins on a Lamport stamp { seq, senderId }; wall clocks are never compared across machines.
  function isNewer(incoming, last) {
    if (!last) return true;
    if (incoming.seq !== last.seq) return incoming.seq > last.seq;
    return incoming.senderId > last.senderId;
  }

  // What to do about the gap between where we are and where the party is.
  function decideDrift(localTime, expectedTime, { playing = true, nudging = false } = {}) {
    const drift = expectedTime - localTime; // > 0: we are behind
    const abs = Math.abs(drift);
    if (abs < (nudging ? DRIFT.settle : DRIFT.ignore)) return { action: 'none', drift };
    if (!playing || abs > DRIFT.seek) return { action: 'seek', drift };
    return { action: 'nudge', drift, rate: drift > 0 ? 1 + DRIFT.nudge : 1 - DRIFT.nudge };
  }

  // Echo suppression: a local player event is only worth broadcasting if it moved us away from the
  // shared state. `flags` says which DOM events fired; `expected` is the shared state right now.
  function diffLocal(local, expected, flags = {}) {
    if (flags.playback && local.playing !== expected.playing) return local.playing ? 'play' : 'pause';
    if (flags.seeked && !local.live && Math.abs(local.time - expected.time) > 1) return 'seek';
    if (flags.rate && Math.abs(local.rate - expected.rate) > 0.01) return 'rate';
    return null;
  }

  // NTP-style: t0 = our send time, t1 = peer clock when it answered, t2 = our receive time.
  // Result = peerClock - ourClock.
  function clockOffset(t0, t1, t2) {
    return t1 - (t0 + t2) / 2;
  }

  // How old a message is on arrival, given the sender's clock offset (undefined = unknown, assume fresh).
  function messageAge(sentAt, now, offset) {
    if (offset === undefined) return 0;
    return Math.min(5000, Math.max(0, now + offset - sentAt));
  }

  // The longest-standing member is the host and the drift reference.
  function pickHost(peers) {
    let best = null;
    for (const p of peers) {
      if (!best || p.joinedAt < best.joinedAt || (p.joinedAt === best.joinedAt && p.id < best.id)) best = p;
    }
    return best;
  }

  function backoffDelay(attempt, random = Math.random()) {
    return Math.round(Math.min(30000, 1000 * 2 ** attempt) * (0.5 + random / 2));
  }

  // Sliding-window limiter: returns a function(now) -> allowed?
  function rateLimiter(max, windowMs) {
    const hits = [];
    return (now = Date.now()) => {
      while (hits.length && now - hits[0] >= windowMs) hits.shift();
      if (hits.length >= max) return false;
      hits.push(now);
      return true;
    };
  }

  function cleanName(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu, '').trim().slice(0, MAX_NAME);
  }

  function cleanText(value) {
    if (typeof value !== 'string') return '';
    return value.replace(/[\p{Cc}\p{Zl}\p{Zp}]/gu, ' ').trim().slice(0, MAX_CHAT);
  }

  function colorFor(id) {
    let h = 0;
    for (const ch of String(id)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return COLORS[h % COLORS.length];
  }

  const isNum = (v, min, max) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  const isId = (v) => typeof v === 'string' && v.length > 0 && v.length <= 40;

  // Everything arriving from the channel is untrusted. Returns a normalized copy or null.
  function sanitizeMessage(m) {
    if (!m || typeof m !== 'object' || !isId(m.senderId) || typeof m.type !== 'string') return null;
    const out = {
      type: m.type,
      senderId: m.senderId,
      sentAt: isNum(m.sentAt, 0, 1e14) ? m.sentAt : 0,
      name: cleanName(m.name),
    };
    const playback = () => {
      if (!isNum(m.time, 0, 1e7) || typeof m.playing !== 'boolean' || !isNum(m.rate, 0.1, 16)) return false;
      if (!Number.isInteger(m.seq) || m.seq < 0 || m.seq > 1e12) return false;
      Object.assign(out, { time: m.time, playing: m.playing, rate: m.rate, seq: m.seq });
      return true;
    };
    switch (m.type) {
      case 'play':
      case 'pause':
      case 'seek':
      case 'rate':
      case 'hb':
        return playback() ? out : null;
      case 'state':
        if (!playback() || !isId(m.to) || !isId(m.by)) return null;
        return Object.assign(out, { to: m.to, by: m.by, empty: m.empty === true, hostOnly: m.hostOnly === true });
      case 'req':
        return out;
      case 'settings':
        return typeof m.hostOnly === 'boolean' ? Object.assign(out, { hostOnly: m.hostOnly }) : null;
      case 'chat': {
        const text = cleanText(m.text);
        return text ? Object.assign(out, { text }) : null;
      }
      case 'react':
        return EMOJIS.includes(m.emoji) ? Object.assign(out, { emoji: m.emoji }) : null;
      case 'ping':
        return isNum(m.t0, 0, 1e14) ? Object.assign(out, { t0: m.t0 }) : null;
      case 'pong':
        if (!isId(m.to) || !isNum(m.t0, 0, 1e14) || !isNum(m.t1, 0, 1e14)) return null;
        return Object.assign(out, { to: m.to, t0: m.t0, t1: m.t1 });
      case 'nav':
        if (typeof m.url !== 'string' || m.url.length > 2000 || !/^https?:\/\//i.test(m.url)) return null;
        return Object.assign(out, { url: m.url });
      default:
        return null;
    }
  }

  const ZP = (globalThis.ZP = globalThis.ZP || {});
  ZP.core = {
    ALPHABET, PARAM, EMOJIS, DRIFT, MAX_CHAT, MAX_NAME,
    generateRoomCode, randomId, parseRoomCode, buildInviteLink, stripInvite, mediaKey, formatTime,
    extrapolate, isNewer, decideDrift, diffLocal, clockOffset, messageAge, pickHost, backoffDelay,
    rateLimiter, cleanName, cleanText, colorFor, sanitizeMessage,
  };
})();
