// Real network smoke test: two clients join the same room, one broadcasts, the other must receive it
// and see the first one in presence. Run: node tests/realtime-smoke.mjs [--fallback]
import assert from 'node:assert';
import '../config.js';
import '../content/core.js';
import '../content/realtime.js';

const { ZP, ZARPA_CONFIG: cfg } = globalThis;
const room = ZP.core.generateRoomCode();
const keys = process.argv.includes('--fallback') ? [cfg.fallbackKey] : [cfg.key];

function client(id) {
  const c = { id, messages: [], peers: new Map() };
  c.ready = new Promise((resolve) => {
    c.rt = new ZP.Realtime({
      url: cfg.url, keys, topic: cfg.channelPrefix + room, id,
      meta: { name: id, joinedAt: Date.now() },
      onMessage: (m) => c.messages.push(m),
      onPresence: (p) => (c.peers = p),
      onStatus: (s) => { console.log(`  ${id}: ${s}`); if (s === 'connected') resolve(); },
      log: (...a) => console.log(`  ${id}:`, ...a),
    });
    c.rt.connect();
  });
  return c;
}

const until = async (what, cond, ms = 8000) => {
  const start = Date.now();
  while (!cond()) {
    if (Date.now() - start > ms) throw new Error('timeout waiting for ' + what);
    await new Promise((r) => setTimeout(r, 50));
  }
};

const a = client('ALICE');
const b = client('BOB');
const timeout = setTimeout(() => { console.error('FAIL: could not join within 20s'); process.exit(1); }, 20000);
await Promise.all([a.ready, b.ready]);
clearTimeout(timeout);

const sent = { type: 'chat', senderId: 'ALICE', text: 'hello ' + room, sentAt: Date.now() };
const t0 = Date.now();
assert.ok(a.rt.send(sent), 'send() should succeed once joined');
await until('broadcast delivery', () => b.messages.length > 0);
const latency = Date.now() - t0;
assert.deepStrictEqual(b.messages[0], sent);
assert.strictEqual(a.messages.length, 0, 'sender must not receive its own broadcast');
await until('presence sync', () => b.peers.has('ALICE') && a.peers.has('BOB'));
assert.strictEqual(b.peers.get('ALICE').name, 'ALICE');

a.rt.close();
await until('presence leave', () => !b.peers.has('ALICE'));
b.rt.close();
const label = process.argv.includes('--fallback') ? 'legacy anon key' : 'publishable key';
console.log(`PASS realtime smoke (${label}): room ${room}, broadcast delivered in ${latency} ms, presence join/leave OK`);
process.exit(0);
