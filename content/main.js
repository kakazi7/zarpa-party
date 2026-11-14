// Orchestration. The top frame owns the party (realtime connection, sync decisions, sidebar).
// Every frame can own the video: child frames act as remote players, relayed through the service worker.
(() => {
  'use strict';
  const ZP = globalThis.ZP;
  if (!ZP || ZP.started || !globalThis.chrome?.runtime?.id) return;
  ZP.started = true;

  const { core } = ZP;
  const cfg = globalThis.ZARPA_CONFIG;
  const log = (...args) => cfg.debug && console.debug('[zarpa-party]', ...args);
  const isTop = window === window.top;

  // The extension may be reloaded/updated under a live page; chrome.* then throws.
  function relay(to, msg) {
    try {
      chrome.runtime.sendMessage({ zp: 'relay', to, msg }).catch(() => {});
    } catch {}
  }

  if (isTop) runTop();
  else runChild();

  // ---------------------------------------------------------------------------------------------
  // Child frame: stays dormant until the top frame says a party is on, then reports its video.
  function runChild() {
    const token = core.randomId();
    let player = null;
    let driving = false;
    let pushTimer = 0;

    const send = (msg) => relay('top', { ...msg, token });
    const announce = () => player && send({ k: 'video', area: player.area() });

    function setDriving(next) {
      if (next === driving) return;
      driving = next;
      clearInterval(pushTimer);
      if (driving) {
        pushTimer = setInterval(() => {
          player.flush(); // events first, so the top frame never reads a user action as drift
          send({ k: 'st', st: player.state() });
        }, 1000);
      } else if (player) player.apply({ nudge: 1 });
    }

    chrome.runtime.onMessage.addListener((m) => {
      if (!m || m.zp !== 'relayed' || !m.msg) return;
      const msg = m.msg;
      if (msg.k === 'party') {
        if (msg.active && !player) {
          player = ZP.createPlayer({
            onEvent: (flags, st) => driving && send({ k: 'ev', flags, st }),
            onChange: announce,
            onBlocked: () => send({ k: 'blocked' }),
          });
        }
        if (msg.active) announce();
        setDriving(!!msg.active && msg.driver === token);
      } else if (msg.k === 'apply' && msg.token === token && player) {
        player.apply(msg.cmd);
      }
    });
    send({ k: 'frame' }); // a party may already be running in this tab
  }

  // ---------------------------------------------------------------------------------------------
  function runTop() {
    const STORE_KEY = 'zarpaParty';
    const HEARTBEAT_TICKS = 5; // seconds between drift heartbeats from the host
    const SUPPRESS_MS = 800; // after applying a remote command, ignore the player events it causes

    const t = (key, ...subs) => chrome.i18n.getMessage(key, subs.map(String)) || key;
    const store = {
      get() {
        try {
          return JSON.parse(sessionStorage.getItem(STORE_KEY));
        } catch {
          return null;
        }
      },
      set(value) {
        try {
          if (value) sessionStorage.setItem(STORE_KEY, JSON.stringify(value));
          else sessionStorage.removeItem(STORE_KEY);
        } catch {}
      },
    };

    const S = {
      room: null, id: '', joinedAt: 0, name: '', color: '',
      rt: null, status: 'idle', peers: new Map(), presenceReady: false,
      shared: null, // { time, playing, rate, at } — what the party is doing
      last: null, // Lamport stamp of the event that produced `shared`
      seq: 0, synced: false, awaiting: false, hostOnly: false, away: false,
      suppressUntil: 0, hold: 0, nudging: 0, ticks: 0,
      media: '', // which video this tab shows
      partyMedia: '', // which video the party is on (assumed ours until a peer navigates)
    };
    const offsets = new Map(); // peer id -> (peer clock - our clock)
    const replyTimers = new Map();
    const remotes = new Map(); // child-frame players: token -> { area, st, at }
    const inbound = new Map(); // per-peer chat limiter
    const chatLimit = core.rateLimiter(5, 5000);
    const reactLimit = core.rateLimiter(8, 5000);
    let player = null;
    let ui = null;
    let driver = null; // 'top' or a child token
    let tickTimer = 0;
    let stateTimer = 0;
    let lastNotice = 0;

    // ---- players (local + child frames) ----

    function ensurePlayer() {
      if (player) return;
      player = ZP.createPlayer({
        onEvent: (flags, st) => driver === 'top' && onLocalEvent(flags, st),
        onChange() {
          S.hold = 0; // the new video is here: no need to keep waiting for it
          chooseDriver();
        },
        onBlocked: notifyBlocked,
      });
      chooseDriver();
    }

    function chooseDriver() {
      let best = player && player.state() ? 'top' : null;
      let bestArea = best ? player.area() : 0;
      for (const [token, r] of remotes) {
        if (r.area > bestArea) {
          best = token;
          bestArea = r.area;
        }
      }
      if (best === driver) return;
      if (driver === 'top' && player) player.apply({ nudge: 1 });
      driver = best;
      S.nudging = 0;
      if (remotes.has(best)) remotes.get(best).at = Date.now(); // it starts reporting now
      log('driver', driver);
      announceParty();
    }

    const announceParty = () => relay('all', { k: 'party', active: !!S.room, driver });

    function driverState() {
      if (driver === 'top') return player.state();
      const r = remotes.get(driver);
      if (!r || !r.st) return null;
      const st = { ...r.st };
      if (st.playing && !st.buffering) st.time += ((Date.now() - r.at) / 1000) * st.rate;
      return st;
    }

    function driverApply(cmd) {
      if (driver === 'top') player.apply(cmd);
      else if (driver) relay('all', { k: 'apply', token: driver, cmd });
    }

    function onRelayed(msg) {
      if (!msg || typeof msg.token !== 'string') return;
      const { token } = msg;
      if (msg.k === 'frame') {
        if (S.room) announceParty();
      } else if (msg.k === 'video') {
        if (msg.area > 0) remotes.set(token, { area: msg.area, st: remotes.get(token)?.st || null, at: Date.now() });
        else remotes.delete(token);
        chooseDriver();
      } else if (msg.k === 'st') {
        const r = remotes.get(token);
        if (!r) return;
        if (!msg.st) {
          remotes.delete(token);
          return chooseDriver();
        }
        r.st = msg.st;
        r.at = Date.now();
      } else if (msg.k === 'ev' && token === driver) {
        const r = remotes.get(token);
        if (r && msg.st) {
          r.st = msg.st;
          r.at = Date.now();
          onLocalEvent(msg.flags || {}, msg.st);
        }
      } else if (msg.k === 'blocked') notifyBlocked();
    }

    // ---- party membership ----

    const peersList = () => {
      const list = [...S.peers].map(([id, meta]) => ({
        id,
        name: core.cleanName(meta && meta.name) || t('defaultName'),
        color: core.colorFor(id),
        joinedAt: Number(meta && meta.joinedAt) || 0,
        me: id === S.id,
      }));
      if (S.room && !S.peers.has(S.id)) list.push({ id: S.id, name: S.name, color: S.color, joinedAt: S.joinedAt, me: true });
      list.sort((a, b) => a.joinedAt - b.joinedAt || (a.id < b.id ? -1 : 1));
      const host = core.pickHost(list);
      for (const p of list) p.host = !!host && p.id === host.id;
      return list;
    };
    const hostId = () => core.pickHost(peersList())?.id;
    const amHost = () => hostId() === S.id;
    const canControl = () => !S.hostOnly || amHost();
    const peerName = (m) => core.cleanName(S.peers.get(m.senderId)?.name) || m.name || t('defaultName');
    const persist = () => store.set({ room: S.room, id: S.id, joinedAt: S.joinedAt, media: S.media });
    const inviteLink = () => core.buildInviteLink(location.href, S.room);

    function join(code, created) {
      if (S.room) leave(true);
      const saved = store.get();
      const resumed = !!saved && saved.room === code;
      Object.assign(S, {
        room: code,
        id: resumed ? saved.id : core.randomId(),
        joinedAt: resumed ? saved.joinedAt : Date.now(),
        shared: null, last: null, seq: 0, synced: false, awaiting: false, hostOnly: false, away: false,
        peers: new Map(), presenceReady: false, nudging: 0, hold: 0, ticks: 0,
        media: core.mediaKey(location.href),
      });
      S.partyMedia = S.media;
      S.color = core.colorFor(S.id);
      // Navigating to another video with a full page load counts as a navigation too.
      const moved = resumed && saved.media && saved.media !== S.media;
      persist();
      try {
        // Drop the invite param so a later reload or a copied URL does not rejoin an old room.
        const clean = core.stripInvite(location.href);
        if (clean !== location.href) history.replaceState(history.state, '', clean);
      } catch {}

      ensurePlayer();
      ui = ZP.createUI({ t, onSend: sendChat, onReact: sendReaction, onName: setName, onLeave: () => leave(), onCopy: copyLink });
      ui.setMe(S.name, S.color);
      ui.setPeers(peersList());
      ui.mount();
      ui.addSystem(t(created ? 'sysCreated' : 'sysJoinedSelf'));

      let first = true;
      S.rt = new ZP.Realtime({
        url: cfg.url,
        keys: [cfg.key, cfg.fallbackKey],
        topic: cfg.channelPrefix + code,
        id: S.id,
        meta: { name: S.name, joinedAt: S.joinedAt },
        log,
        onMessage,
        onPresence,
        onStatus(status) {
          const was = S.status;
          S.status = status;
          if (!ui) return;
          ui.setStatus(status);
          if (status === 'reconnecting' && was === 'connected') ui.addSystem(t('sysDisconnected'));
          if (status !== 'connected') return;
          if (!first) ui.addSystem(t('sysReconnected'));
          send({ type: 'ping', t0: Date.now() });
          if (first && created) S.synced = true; // our own room: whatever we play is the state
          else requestState();
          if (first && moved) send({ type: 'nav', url: core.stripInvite(location.href) });
          first = false;
        },
      });
      S.rt.connect();
      clearInterval(tickTimer);
      tickTimer = setInterval(tick, 1000);
      announceParty();
      badge();
    }

    function requestState() {
      S.awaiting = true;
      send({ type: 'req' });
      clearTimeout(stateTimer);
      stateTimer = setTimeout(() => {
        // Nobody answered: we are alone, so our player defines the state.
        S.awaiting = false;
        S.synced = true;
      }, 1500);
    }

    function leave(silent) {
      if (!S.room) return;
      clearInterval(tickTimer);
      clearTimeout(stateTimer);
      for (const timer of replyTimers.values()) clearTimeout(timer);
      replyTimers.clear();
      if (S.nudging) driverApply({ nudge: 1 });
      S.rt.close();
      S.rt = null;
      S.room = null;
      S.status = 'idle';
      S.peers = new Map();
      ui.unmount();
      ui = null;
      if (!silent) store.set(null);
      announceParty();
      badge();
    }

    function badge() {
      try {
        chrome.runtime.sendMessage({ zp: 'badge', text: S.room ? String(Math.max(1, S.peers.size)) : '' }).catch(() => {});
      } catch {}
    }

    function setName(name) {
      name = core.cleanName(name);
      if (!name || name === S.name) return;
      S.name = name;
      try {
        chrome.storage.local.set({ name });
      } catch {}
      if (!S.room) return;
      S.rt.track({ name, joinedAt: S.joinedAt });
      ui.setMe(name, S.color);
    }

    async function copyLink() {
      try {
        await navigator.clipboard.writeText(inviteLink());
        ui.addSystem(t('sysLinkCopied'));
      } catch {
        ui.addSystem(inviteLink()); // clipboard blocked by the page: show it so it can be copied by hand
      }
    }

    // ---- outgoing ----

    function send(msg) {
      if (!S.rt) return false;
      return S.rt.send({ ...msg, senderId: S.id, name: S.name, sentAt: Date.now() });
    }

    function sendChat(text) {
      text = core.cleanText(text);
      if (!text) return false;
      if (!chatLimit()) {
        ui.addSystem(t('sysRateLimited'));
        return false;
      }
      if (!send({ type: 'chat', text })) {
        ui.addSystem(t('sysOffline'));
        return false;
      }
      ui.addChat({ name: S.name, color: S.color, text, mine: true });
    }

    function sendReaction(emoji) {
      if (!reactLimit()) return;
      send({ type: 'react', emoji });
      ui.float(emoji);
    }

    function setHostOnly(value) {
      if (!S.room || !amHost() || S.hostOnly === value) return;
      S.hostOnly = value;
      send({ type: 'settings', hostOnly: value });
      ui.addSystem(t(value ? 'sysHostOnlyOn' : 'sysHostOnlyOff'));
    }

    // Make our player state the party state and tell everyone.
    function publish(type, st, silent) {
      S.seq++;
      S.last = { seq: S.seq, senderId: S.id };
      S.shared = { time: st.time, playing: st.playing, rate: st.rate, at: Date.now() };
      send({ type, time: st.time, playing: st.playing, rate: st.rate, seq: S.seq });
      if (!silent) describe(type, S.name, st);
    }

    function describe(type, name, st) {
      const key = { play: 'sysPlay', pause: 'sysPause', seek: 'sysSeek', rate: 'sysRate' }[type];
      ui.addSystem(t(key, name, type === 'rate' ? st.rate : core.formatTime(st.time)));
    }

    // ---- local player events ----

    function onLocalEvent(flags, st) {
      if (!S.room || !S.synced || S.away || !S.shared || st.ad) return;
      const now = Date.now();
      if (now < S.suppressUntil) return;
      const expected = { time: core.extrapolate(S.shared, now), playing: S.shared.playing, rate: S.shared.rate };
      const kind = core.diffLocal(st, expected, flags);
      if (!kind) return;
      if (!canControl()) {
        sync(st, true); // snap back: only the host drives
        if (now - lastNotice > 5000) {
          lastNotice = now;
          ui.addSystem(t('sysHostOnlyBlocked'));
        }
        return;
      }
      publish(kind, st);
    }

    function notifyBlocked() {
      const now = Date.now();
      if (!ui || now - lastNotice < 8000) return;
      lastNotice = now;
      ui.addSystem(t('sysAutoplayBlocked'));
    }

    // ---- sync ----

    // Bring the player to the shared state. exact = an explicit action (seek right away);
    // otherwise it is drift correction (gentle rate nudge for small gaps).
    function sync(st, exact) {
      const sh = S.shared;
      const now = Date.now();
      const expected = core.extrapolate(sh, now);
      const cmd = {};
      if (st.playing !== sh.playing) cmd.playing = sh.playing;
      if (Math.abs(st.rate - sh.rate) > 0.01) cmd.rate = sh.rate;
      const reachable = !st.duration || expected < st.duration - 1;
      if (!st.live && reachable && !(st.buffering && !exact)) {
        const d = core.decideDrift(st.time, expected, { playing: sh.playing && st.playing, nudging: !!S.nudging });
        const seek = d.action === 'seek' || (exact && Math.abs(d.drift) > core.DRIFT.event);
        if (seek) cmd.time = expected;
        const nudge = !seek && d.action === 'nudge' ? d.rate : 1;
        if (nudge !== 1 || S.nudging) cmd.nudge = nudge; // re-sent while nudging: the site may reset the rate
        S.nudging = nudge === 1 ? 0 : nudge;
      }
      if (cmd.rate != null) S.nudging = 0;
      if (cmd.time != null || cmd.playing != null || cmd.rate != null) S.suppressUntil = now + SUPPRESS_MS;
      if (Object.keys(cmd).length) {
        log('sync', cmd);
        driverApply(cmd);
      }
    }

    function tick() {
      if (!S.room) return;
      S.ticks++;
      const now = Date.now();

      const key = core.mediaKey(location.href);
      if (key !== S.media) {
        // In-page navigation to another video: restart the shared state from the new one.
        S.media = key;
        persist();
        if (S.synced && canControl()) {
          S.partyMedia = key;
          S.shared = null;
          S.hold = now + 3000; // give the new video time to replace the old element
          send({ type: 'nav', url: core.stripInvite(location.href) });
        }
        S.away = S.partyMedia !== key;
      }
      for (const [token, r] of remotes) {
        if (token === driver && now - r.at > 6000) {
          remotes.delete(token); // frame went away without telling us
          chooseDriver();
        }
      }
      if (S.ticks % 3 === 0 && player) player.rescan();

      if (!S.synced || S.away || !driver) return;
      if (driver === 'top') player.flush();
      const st = driverState();
      if (!st || st.ad) return;
      if (!S.shared) {
        if (now > S.hold && canControl()) publish('seek', st, true);
        return;
      }
      if (now < S.suppressUntil) return;

      if (amHost()) {
        // The host is the clock: it never chases anyone, it reports where it is.
        if (S.nudging) {
          // Became host mid-nudge (old host left): drop the nudge or we would run fast/slow forever.
          S.nudging = 0;
          driverApply({ nudge: 1 });
        }
        if (st.playing !== S.shared.playing) return sync(st, true);
        // Not while buffering: a stalled host would drag everyone back with each heartbeat.
        if (st.playing && !st.buffering && !st.live && S.ticks % HEARTBEAT_TICKS === 0 && S.peers.size > 1) {
          S.shared = { ...S.shared, time: st.time, at: now };
          send({ type: 'hb', time: st.time, playing: true, rate: S.shared.rate, seq: S.last ? S.last.seq : 0 });
        }
        return;
      }
      if (S.ticks % 2 === 0) sync(st, false);
    }

    // ---- incoming ----

    const fromWire = (m, now) => ({
      time: m.time, playing: m.playing, rate: m.rate,
      at: now - core.messageAge(m.sentAt, now, offsets.get(m.senderId)),
    });

    function applyShared() {
      if (S.away || !driver) return;
      const st = driverState();
      if (st && !st.ad) sync(st, true);
    }

    function onMessage(raw) {
      const m = core.sanitizeMessage(raw);
      if (!m || m.senderId === S.id || !S.room) return;
      const now = Date.now();
      switch (m.type) {
        case 'play':
        case 'pause':
        case 'seek':
        case 'rate':
          if (S.hostOnly && m.senderId !== hostId()) break;
          if (!core.isNewer(m, S.last)) break;
          S.last = { seq: m.seq, senderId: m.senderId };
          S.seq = Math.max(S.seq, m.seq);
          S.shared = fromWire(m, now);
          S.synced = true;
          describe(m.type, peerName(m), m);
          applyShared();
          break;
        case 'hb':
          if (m.senderId !== hostId() || !S.shared || (S.last && m.seq < S.last.seq)) break;
          S.shared = fromWire(m, now);
          break;
        case 'req': {
          if (!S.synced || S.awaiting) break;
          clearTimeout(replyTimers.get(m.senderId));
          // The host answers at once; the others only if nobody else did.
          const delay = amHost() ? 0 : 150 + Math.random() * 300;
          replyTimers.set(m.senderId, setTimeout(() => {
            replyTimers.delete(m.senderId);
            const sh = S.shared;
            send({
              type: 'state', to: m.senderId, empty: !sh,
              time: sh ? Math.max(0, core.extrapolate(sh, Date.now())) : 0,
              playing: !!sh && sh.playing, rate: sh ? sh.rate : 1,
              seq: S.last ? S.last.seq : 0, by: S.last ? S.last.senderId : S.id,
              hostOnly: S.hostOnly,
            });
          }, delay));
          break;
        }
        case 'state':
          if (m.to !== S.id) {
            clearTimeout(replyTimers.get(m.to));
            replyTimers.delete(m.to);
            break;
          }
          if (!S.awaiting) break;
          clearTimeout(stateTimer);
          S.awaiting = false;
          S.synced = true;
          S.hostOnly = m.hostOnly;
          S.last = { seq: m.seq, senderId: m.by };
          S.seq = Math.max(S.seq, m.seq);
          S.shared = m.empty ? null : fromWire(m, now);
          if (S.shared) applyShared();
          break;
        case 'settings':
          if (m.senderId !== hostId() || S.hostOnly === m.hostOnly) break;
          S.hostOnly = m.hostOnly;
          ui.addSystem(t(m.hostOnly ? 'sysHostOnlyOn' : 'sysHostOnlyOff'));
          break;
        case 'chat':
          if (!limiterFor(m.senderId)(now)) break;
          ui.addChat({ name: peerName(m), color: core.colorFor(m.senderId), text: m.text, mine: false });
          break;
        case 'react':
          if (limiterFor(m.senderId)(now)) ui.float(m.emoji);
          break;
        case 'ping':
          send({ type: 'pong', to: m.senderId, t0: m.t0, t1: now });
          break;
        case 'pong':
          if (m.to === S.id && now - m.t0 < 3000) offsets.set(m.senderId, core.clockOffset(m.t0, m.t1, now));
          break;
        case 'nav':
          onPeerNav(m);
          break;
      }
    }

    function limiterFor(id) {
      if (!inbound.has(id)) inbound.set(id, core.rateLimiter(12, 5000));
      return inbound.get(id);
    }

    // A peer opened another video. Syncing two different videos makes no sense, so we stand aside
    // until we follow (same-site links only, and only on click).
    function onPeerNav(m) {
      if (S.hostOnly && m.senderId !== hostId()) return;
      S.partyMedia = core.mediaKey(m.url);
      S.away = S.partyMedia !== core.mediaKey(location.href);
      if (!S.away) return;
      let sameSite = false;
      try {
        sameSite = new URL(m.url).origin === location.origin;
      } catch {}
      ui.addSystem(t('sysNav', peerName(m)), sameSite ? { label: t('follow'), run: () => location.assign(m.url) } : null);
    }

    function onPresence(peers) {
      const before = S.peers;
      S.peers = peers;
      if (!ui) return;
      let fresh = false;
      for (const [id, meta] of peers) {
        if (id === S.id || before.has(id)) continue;
        fresh = true;
        if (S.presenceReady) ui.addSystem(t('sysJoined', core.cleanName(meta && meta.name) || t('defaultName')));
      }
      for (const [id, meta] of before) {
        if (id === S.id || peers.has(id)) continue;
        offsets.delete(id);
        inbound.delete(id);
        ui.addSystem(t('sysLeft', core.cleanName(meta && meta.name) || t('defaultName')));
      }
      S.presenceReady = true;
      if (fresh) send({ type: 'ping', t0: Date.now() }); // learn the newcomers' clock offsets
      ui.setPeers(peersList());
      badge();
    }

    // ---- popup / background ----

    const status = () => ({
      ok: true,
      hasVideo: !!driver,
      room: S.room,
      link: S.room ? inviteLink() : '',
      status: S.status,
      peers: S.room ? peersList().map(({ name, color, me, host }) => ({ name, color, me, host })) : [],
      name: S.name,
      hostOnly: S.hostOnly,
      isHost: !!S.room && amHost(),
      open: !!ui && ui.isOpen(),
    });

    chrome.runtime.onMessage.addListener((m, sender, respond) => {
      if (!m || sender.id !== chrome.runtime.id) return;
      switch (m.zp) {
        case 'relayed':
          onRelayed(m.msg);
          return;
        case 'status':
          ensurePlayer();
          break;
        case 'create':
          join(core.generateRoomCode(), true);
          break;
        case 'join': {
          const code = core.parseRoomCode(m.code);
          if (!code) return respond({ ok: false });
          if (code !== S.room) join(code, false);
          break;
        }
        case 'leave':
          leave();
          break;
        case 'setName':
          setName(m.name);
          break;
        case 'setHostOnly':
          setHostOnly(!!m.value);
          break;
        case 'toggle':
          if (ui) ui.toggle();
          break;
        default:
          return;
      }
      respond(status());
    });

    window.addEventListener('pagehide', () => S.rt && S.rt.close()); // leave presence promptly
    window.addEventListener('pageshow', (e) => {
      const saved = store.get();
      if (e.persisted && saved) join(saved.room, false); // restored from the back/forward cache
    });
    window.addEventListener('online', () => S.rt && S.rt.retryNow());

    // ---- boot ----

    const invited = core.parseRoomCode(location.href);
    chrome.storage.local.get('name').then(
      (stored) => stored && stored.name,
      () => '',
    ).then((name) => {
      S.name = core.cleanName(name) || `${t('defaultName')} ${Math.floor(10 + Math.random() * 90)}`;
      if (!name) chrome.storage.local.set({ name: S.name }).catch(() => {});
      const code = invited || store.get()?.room;
      if (code && !S.room) join(code, false);
    });
  }
})();
