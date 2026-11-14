// Minimal Supabase Realtime client (Phoenix channels v1 over WebSocket): Broadcast + Presence only.
// Works in the browser and in node >= 22 (global WebSocket), which is what the smoke test uses.
(() => {
  'use strict';
  const ZP = (globalThis.ZP = globalThis.ZP || {});
  const EVENT = 'zp';
  const HEARTBEAT_MS = 25000;

  class Realtime {
    // opts: { url, keys: [key, fallback], topic, id, meta, onMessage, onPresence, onStatus, log }
    constructor(opts) {
      Object.assign(this, opts);
      this.topic = 'realtime:' + opts.topic;
      this.keys = opts.keys.filter(Boolean);
      this.keyIndex = 0;
      this.ref = 0;
      this.attempt = 0;
      this.joined = false;
      this.closed = false;
      this.status = 'idle';
      this.presence = {}; // key -> metas[]
      this.log = opts.log || (() => {});
    }

    connect() {
      if (this.closed) return;
      clearTimeout(this.retryTimer);
      this.setStatus(this.attempt ? 'reconnecting' : 'connecting');
      const key = this.keys[this.keyIndex % this.keys.length];
      const base = this.url.replace(/^http/, 'ws');
      let ws;
      try {
        ws = new WebSocket(`${base}/realtime/v1/websocket?apikey=${encodeURIComponent(key)}&vsn=1.0.0`);
      } catch (err) {
        this.log('socket failed', err);
        return this.retry();
      }
      this.ws = ws;
      this.joined = false;
      this.pendingBeat = null;
      ws.onopen = () => {
        if (ws !== this.ws) return;
        this.joinRef = String(++this.ref);
        this.push('phx_join', {
          config: {
            broadcast: { ack: false, self: false },
            presence: { key: this.id, enabled: true },
            postgres_changes: [],
            private: false,
          },
        });
        this.beatTimer = setInterval(() => this.beat(), HEARTBEAT_MS);
      };
      ws.onmessage = (e) => ws === this.ws && this.handle(e.data);
      ws.onerror = () => {};
      ws.onclose = () => ws === this.ws && this.dropped();
    }

    push(event, payload, topic = this.topic) {
      if (!this.ws || this.ws.readyState !== 1) return false;
      const ref = event === 'phx_join' ? this.joinRef : String(++this.ref);
      this.ws.send(JSON.stringify({ topic, event, payload, ref, join_ref: this.joinRef }));
      return ref;
    }

    beat() {
      if (this.pendingBeat) {
        // Previous heartbeat never answered: the link is dead. Reconnect now; close() on a dead socket
        // can take a minute to fire onclose, and dropped() makes that late event a no-op.
        const ws = this.ws;
        this.dropped();
        try {
          ws.close();
        } catch {}
        return;
      }
      this.pendingBeat = this.push('heartbeat', {}, 'phoenix');
    }

    handle(raw) {
      let m;
      try {
        m = JSON.parse(raw);
      } catch {
        return;
      }
      if (m.topic === 'phoenix') {
        if (m.ref === this.pendingBeat) this.pendingBeat = null;
        return;
      }
      if (m.topic !== this.topic) return;
      const p = m.payload || {};
      switch (m.event) {
        case 'phx_reply':
          if (m.ref !== this.joinRef || this.joined) break;
          if (p.status !== 'ok') {
            this.log('join refused', p);
            this.ws.close();
            break;
          }
          this.joined = true;
          this.attempt = 0;
          this.track(this.meta);
          this.setStatus('connected');
          break;
        case 'broadcast':
          if (p.event === EVENT) this.onMessage(p.payload);
          break;
        case 'presence_state':
          this.presence = {};
          this.mergePresence(p, {});
          break;
        case 'presence_diff':
          this.mergePresence(p.joins || {}, p.leaves || {});
          break;
        case 'phx_error':
        case 'phx_close':
          this.ws.close();
          break;
      }
    }

    mergePresence(joins, leaves) {
      for (const [key, entry] of Object.entries(joins)) {
        const known = this.presence[key] || (this.presence[key] = []);
        for (const meta of (entry && entry.metas) || []) {
          if (!known.some((k) => k.phx_ref === meta.phx_ref)) known.push(meta);
        }
      }
      for (const [key, entry] of Object.entries(leaves)) {
        const gone = new Set(((entry && entry.metas) || []).map((meta) => meta.phx_ref));
        const left = (this.presence[key] || []).filter((k) => !gone.has(k.phx_ref));
        if (left.length) this.presence[key] = left;
        else delete this.presence[key];
      }
      const peers = new Map();
      for (const [key, metas] of Object.entries(this.presence)) {
        if (metas.length) peers.set(key, metas[metas.length - 1]);
      }
      this.onPresence(peers);
    }

    send(payload) {
      if (!this.joined) return false;
      return !!this.push('broadcast', { type: 'broadcast', event: EVENT, payload });
    }

    track(meta) {
      this.meta = meta;
      if (this.joined) this.push('presence', { type: 'presence', event: 'track', payload: meta });
    }

    dropped() {
      clearInterval(this.beatTimer);
      const wasJoined = this.joined;
      this.ws = null;
      this.joined = false;
      if (this.closed) return;
      if (!wasJoined) this.keyIndex++; // never got in: try the other key next time
      this.retry();
    }

    retry() {
      this.setStatus('reconnecting');
      const delay = ZP.core.backoffDelay(this.attempt++);
      this.log('reconnecting in', delay, 'ms');
      this.retryTimer = setTimeout(() => this.connect(), delay);
    }

    // Skip the backoff wait (e.g. the browser just came back online).
    retryNow() {
      if (!this.closed && !this.ws) this.connect();
    }

    setStatus(status) {
      if (status === this.status) return;
      this.status = status;
      this.onStatus(status);
    }

    close() {
      this.closed = true;
      clearTimeout(this.retryTimer);
      clearInterval(this.beatTimer);
      const ws = this.ws;
      this.ws = null;
      this.joined = false;
      if (ws) {
        try {
          if (ws.readyState === 1) {
            ws.send(JSON.stringify({ topic: this.topic, event: 'phx_leave', payload: {}, ref: String(++this.ref) }));
          }
          ws.close();
        } catch {}
      }
      this.setStatus('closed');
    }
  }

  ZP.Realtime = Realtime;
})();
