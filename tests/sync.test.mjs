// Run: node tests/sync.test.mjs
import assert from 'node:assert';
import '../content/core.js';

const c = globalThis.ZP.core;
let passed = 0;
const test = (name, fn) => {
  fn();
  passed++;
  console.log('ok - ' + name);
};

test('room codes: length, alphabet, uniqueness', () => {
  const seen = new Set();
  for (let i = 0; i < 2000; i++) {
    const code = c.generateRoomCode();
    assert.match(code, /^[A-HJKMNP-Z2-9]{10}$/);
    seen.add(code);
  }
  assert.strictEqual(seen.size, 2000);
  assert.strictEqual(c.generateRoomCode(16).length, 16);
  assert.ok(!/[ILO01]/.test(c.ALPHABET));
  // Rejection sampling: byte 31 (and 63, 95...) must be skipped, not wrapped.
  const bytes = [31, 0, 63, 1];
  let i = 0;
  assert.strictEqual(c.generateRoomCode(2, (buf) => buf.fill(0).set(bytes.slice(i, (i += 4)))), 'AB');
});

test('room codes: parsing from code and links', () => {
  assert.strictEqual(c.parseRoomCode(' abcdefghjk '), 'ABCDEFGHJK');
  assert.strictEqual(c.parseRoomCode('https://www.netflix.com/watch/1?trackId=2&zarpaParty=ABCDEFGHJK'), 'ABCDEFGHJK');
  assert.strictEqual(c.parseRoomCode('https://x.test/v#zarpaParty=ABCDEFGHJK'), 'ABCDEFGHJK');
  assert.strictEqual(c.parseRoomCode('https://www.netflix.com/watch/1'), null);
  assert.strictEqual(c.parseRoomCode('SHORT'), null);
  assert.strictEqual(c.parseRoomCode('ABCDEFGHI0'), null); // ambiguous chars are never valid
  assert.strictEqual(c.parseRoomCode('<script>alert(1)</script>'), null);
  assert.strictEqual(c.parseRoomCode(null), null);
});

test('invite links round-trip', () => {
  const link = c.buildInviteLink('https://www.youtube.com/watch?v=abc#t=1', 'ABCDEFGHJK');
  assert.strictEqual(link, 'https://www.youtube.com/watch?v=abc&zarpaParty=ABCDEFGHJK#t=1');
  assert.strictEqual(c.parseRoomCode(link), 'ABCDEFGHJK');
  assert.strictEqual(c.stripInvite(link), 'https://www.youtube.com/watch?v=abc#t=1');
  assert.strictEqual(c.mediaKey(link), 'https://www.youtube.com/watch?v=abc');
  assert.strictEqual(c.mediaKey('https://www.netflix.com/watch/1?trackId=9'), c.mediaKey('https://www.netflix.com/watch/1'));
  assert.notStrictEqual(c.mediaKey('https://www.netflix.com/watch/1'), c.mediaKey('https://www.netflix.com/watch/2'));
});

test('time formatting', () => {
  assert.strictEqual(c.formatTime(0), '0:00');
  assert.strictEqual(c.formatTime(59.9), '0:59');
  assert.strictEqual(c.formatTime(754), '12:34');
  assert.strictEqual(c.formatTime(3600), '1:00:00');
  assert.strictEqual(c.formatTime(3725), '1:02:05');
  assert.strictEqual(c.formatTime(-5), '0:00');
  assert.strictEqual(c.formatTime(NaN), '0:00');
});

test('extrapolation', () => {
  assert.strictEqual(c.extrapolate({ time: 10, playing: true, rate: 1, at: 1000 }, 3000), 12);
  assert.strictEqual(c.extrapolate({ time: 10, playing: true, rate: 1.5, at: 1000 }, 3000), 13);
  assert.strictEqual(c.extrapolate({ time: 10, playing: false, rate: 1, at: 1000 }, 9000), 10);
});

test('last-writer-wins ordering', () => {
  assert.ok(c.isNewer({ seq: 1, senderId: 'A' }, null));
  assert.ok(c.isNewer({ seq: 5, senderId: 'A' }, { seq: 4, senderId: 'Z' }));
  assert.ok(!c.isNewer({ seq: 4, senderId: 'Z' }, { seq: 5, senderId: 'A' }));
  assert.ok(c.isNewer({ seq: 5, senderId: 'B' }, { seq: 5, senderId: 'A' })); // tie broken by sender id
  assert.ok(!c.isNewer({ seq: 5, senderId: 'A' }, { seq: 5, senderId: 'B' }));
  assert.ok(!c.isNewer({ seq: 5, senderId: 'A' }, { seq: 5, senderId: 'A' })); // duplicates are dropped
  // Two peers that apply the same concurrent events in different orders converge.
  const events = [{ seq: 3, senderId: 'B' }, { seq: 3, senderId: 'A' }, { seq: 2, senderId: 'C' }];
  const settle = (list) => list.reduce((last, e) => (c.isNewer(e, last) ? e : last), null);
  assert.deepStrictEqual(settle(events), settle([...events].reverse()));
  assert.deepStrictEqual(settle(events), { seq: 3, senderId: 'B' });
});

test('drift decision', () => {
  assert.strictEqual(c.decideDrift(100, 100.3).action, 'none');
  assert.strictEqual(c.decideDrift(100, 99.6).action, 'none');
  const behind = c.decideDrift(100, 101.2);
  assert.strictEqual(behind.action, 'nudge');
  assert.ok(behind.rate > 1);
  const ahead = c.decideDrift(100, 98.8);
  assert.strictEqual(ahead.action, 'nudge');
  assert.ok(ahead.rate < 1);
  assert.strictEqual(c.decideDrift(100, 103).action, 'seek');
  assert.strictEqual(c.decideDrift(100, 90).action, 'seek');
  // A paused player cannot be nudged.
  assert.strictEqual(c.decideDrift(100, 101.2, { playing: false }).action, 'seek');
  assert.strictEqual(c.decideDrift(100, 100.2, { playing: false }).action, 'none');
  // Hysteresis: an ongoing nudge keeps going until the gap is really closed.
  assert.strictEqual(c.decideDrift(100, 100.3, { nudging: true }).action, 'nudge');
  assert.strictEqual(c.decideDrift(100, 100.05, { nudging: true }).action, 'none');
});

test('echo suppression', () => {
  const shared = { time: 50, playing: true, rate: 1 };
  const all = { playback: true, seeked: true, rate: true };
  // Events caused by applying a remote command leave us exactly on the shared state.
  assert.strictEqual(c.diffLocal({ time: 50.2, playing: true, rate: 1 }, shared, all), null);
  assert.strictEqual(c.diffLocal({ time: 50, playing: false, rate: 1 }, shared, all), 'pause');
  assert.strictEqual(c.diffLocal({ time: 50, playing: true, rate: 1 }, { ...shared, playing: false }, all), 'play');
  assert.strictEqual(c.diffLocal({ time: 90, playing: true, rate: 1 }, shared, all), 'seek');
  assert.strictEqual(c.diffLocal({ time: 50, playing: true, rate: 1.5 }, shared, all), 'rate');
  // Falling behind while buffering is not a seek: no `seeked` event fired.
  assert.strictEqual(c.diffLocal({ time: 45, playing: true, rate: 1 }, shared, { playback: true }), null);
  // A drift-correction rate nudge is reported as the base rate, so it never looks like a change.
  assert.strictEqual(c.diffLocal({ time: 50, playing: true, rate: 1 }, shared, { rate: true }), null);
  // Live streams have no meaningful position.
  assert.strictEqual(c.diffLocal({ time: 900, playing: true, rate: 1, live: true }, shared, all), null);
  assert.strictEqual(c.diffLocal({ time: 90, playing: false, rate: 1 }, shared, all), 'pause'); // play state wins
});

test('clock offset and message age', () => {
  assert.strictEqual(c.clockOffset(1000, 6050, 1100), 5000); // peer clock is 5 s ahead, 100 ms round trip
  assert.strictEqual(c.messageAge(6050, 1100, 5000), 50);
  assert.strictEqual(c.messageAge(6050, 1100, undefined), 0);
  assert.strictEqual(c.messageAge(999999, 1100, 0), 0); // never negative
  assert.strictEqual(c.messageAge(0, 999999, 0), 5000); // capped
});

test('host election, backoff, rate limiter', () => {
  const peers = [{ id: 'B', joinedAt: 5 }, { id: 'A', joinedAt: 9 }, { id: 'C', joinedAt: 5 }];
  assert.strictEqual(c.pickHost(peers).id, 'B');
  assert.strictEqual(c.pickHost([]), null);
  assert.strictEqual(c.backoffDelay(0, 1), 1000);
  assert.strictEqual(c.backoffDelay(3, 1), 8000);
  assert.strictEqual(c.backoffDelay(20, 1), 30000);
  assert.strictEqual(c.backoffDelay(20, 0), 15000);
  const allow = c.rateLimiter(2, 1000);
  assert.deepStrictEqual([allow(0), allow(10), allow(20), allow(1001), allow(1011), allow(1012)], [true, true, false, true, true, false]);
});

test('incoming messages are validated', () => {
  const base = { senderId: 'PEER', sentAt: 1, name: '  Ana\u0007  ' };
  const play = c.sanitizeMessage({ ...base, type: 'play', time: 12, playing: true, rate: 1, seq: 3, extra: 'x' });
  assert.deepStrictEqual(play, { type: 'play', senderId: 'PEER', sentAt: 1, name: 'Ana', time: 12, playing: true, rate: 1, seq: 3 });
  assert.strictEqual(c.sanitizeMessage(null), null);
  assert.strictEqual(c.sanitizeMessage({ type: 'play' }), null);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'evil' }), null);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'seek', time: NaN, playing: true, rate: 1, seq: 1 }), null);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'seek', time: -1, playing: true, rate: 1, seq: 1 }), null);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'seek', time: 1, playing: 'yes', rate: 1, seq: 1 }), null);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'rate', time: 1, playing: true, rate: 99, seq: 1 }), null);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'seek', time: 1, playing: true, rate: 1, seq: 1.5 }), null);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'chat', text: '   ' }), null);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'chat', text: 'x'.repeat(900) }).text.length, 500);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'chat', text: '<img src=x onerror=alert(1)>' }).text, '<img src=x onerror=alert(1)>'); // kept as text, rendered with textContent
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'react', emoji: c.EMOJIS[0] }).emoji, c.EMOJIS[0]);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'react', emoji: '<b>' }), null);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'nav', url: 'javascript:alert(1)' }), null);
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'nav', url: 'https://a.test/x' }).url, 'https://a.test/x');
  assert.strictEqual(c.sanitizeMessage({ ...base, type: 'settings', hostOnly: 1 }), null);
  assert.strictEqual(c.cleanName('x'.repeat(80)).length, 24);
  assert.match(c.colorFor('PEER'), /^#[0-9a-f]{6}$/);
  assert.strictEqual(c.colorFor('PEER'), c.colorFor('PEER'));
});

console.log(`\n${passed} tests passed`);
