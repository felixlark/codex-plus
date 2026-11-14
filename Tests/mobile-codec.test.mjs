import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeMobileValue as encode, decodeMobileValue as decode} from '../Sources/CodexPlus/Resources/mobile-codec.mjs';

test('carrier preserves RPC frames, binary views, missing fields and cyclic identity', async () => {
  const buffer = new Uint8Array([0, 128, 255, 4]).buffer;
  const frame = ['push', {bytes: new Uint8Array(buffer, 1, 2), view: new DataView(buffer, 1, 2), missing: undefined, big: 9n, nan: NaN, zero: -0}];
  frame.push(frame, new Map([[frame, new Set([undefined, frame])]]));
  const result = decode(await encode(frame));
  assert.deepEqual(result[1], frame[1]);
  assert.equal(result[1].bytes.buffer, result[1].view.buffer);
  assert.equal(result[2], result);
  assert.ok(result[3].get(result).has(result));
  assert.ok(Object.hasOwn(result[1], 'missing'));
});

test('carrier preserves Blob and object keys without prototype mutation', async () => {
  const input = JSON.parse('{"__proto__":{"polluted":true}}'); input.blob = new Blob(['hello'], {type: 'text/plain'});
  const result = decode(await encode(input));
  assert.equal(Object.getPrototypeOf(result), Object.prototype);
  assert.equal({}.polluted, undefined);
  assert.equal(result.__proto__.polluted, true);
  assert.equal(await result.blob.text(), 'hello');
  assert.equal(result.blob.type, 'text/plain');
});

test('carrier rejects executable and unrecognized platform objects', async () => {
  await assert.rejects(encode(() => 1));
  await assert.rejects(encode(new URL('https://example.com')));
  assert.throws(() => decode('{"version":1,"root":{"ref":0},"nodes":[{"type":"View","name":"Function"}]}'));
});
