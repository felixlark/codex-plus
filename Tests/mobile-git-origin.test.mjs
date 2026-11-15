import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installMobileGitOriginRepair} from '../Sources/CodexPlus/Resources/mobile-git-origin.mjs';

function fixture() {
  const sent = [], markers = {anchor: 'nonce', instance: 'generation', policy: "default-src 'none'"};
  const original = function(...args) { sent.push({receiver: this, args}); if (args[1] === 'null') throw new SyntaxError('Invalid target origin'); return 'original-result'; };
  const window = {postMessage: original}, location = {href: 'about:blank', origin: 'null'};
  const document = {querySelector(selector) { return selector === 'script' ? (markers.script ? {} : null) : {content: selector.includes('http-equiv') ? markers.policy : selector.includes('instance') ? markers.instance : markers.anchor}; }};
  const context = vm.createContext({window, location, document, MessagePort});
  const install = () => vm.runInContext(`(${installMobileGitOriginRepair.toString()})('nonce','generation')`, context);
  return {sent, markers, original, window, location, context, install};
}

test('only exact native Git open and closed calls repair the opaque same-window target', () => {
  const f = fixture(), channel = new MessageChannel();
  try {
    assert.equal(f.install(), true); const post = f.window.postMessage; assert.equal(f.install(), true); assert.equal(f.window.postMessage, post);
    const open = {type: 'codex_desktop:git-worker-port', requestId: 'original-id', closed: undefined};
    const close = {...open, closed: true};
    assert.equal(f.window.postMessage(open, 'null', [channel.port1]), 'original-result');
    f.window.postMessage(close, 'null', []);
    assert.deepEqual(f.sent.map(x => x.args[1]), ['*', '*']);
    assert.equal(f.sent[0].args[0], open); assert.equal(f.sent[0].args[2][0], channel.port1);
    assert.equal(f.sent[1].args[0], close); assert.ok(f.sent.every(x => x.receiver === f.window));
    f.context.__codexPlusMobileGitOriginRepair.close(); assert.equal(f.window.postMessage, f.original);
  } finally { channel.port1.close(); channel.port2.close(); }
});

test('unrelated calls preserve original arguments, receiver, return value and errors', () => {
  const f = fixture(); f.install(); const message = {type: 'unrelated'};
  assert.equal(f.window.postMessage(message, 'app://-', []), 'original-result');
  assert.throws(() => f.window.postMessage(message, 'null', []), SyntaxError);
  const receiver = {}; assert.equal(f.window.postMessage.call(receiver, message, '*', []), 'original-result');
  assert.equal(f.sent[0].args[0], message); assert.equal(f.sent[2].receiver, receiver);
  for (const args of [
    [{type: 'codex_desktop:git-worker-port', requestId: 'id', closed: false}, 'null', []],
    [{type: 'codex_desktop:git-worker-port', requestId: 'id', closed: true, extra: true}, 'null', []],
    [{type: 'codex_desktop:git-worker-port', requestId: '', closed: true}, 'null', []],
    [{type: 'codex_desktop:git-worker-port', requestId: 'id', closed: undefined}, 'null', [{}]],
  ]) assert.throws(() => f.window.postMessage(...args), SyntaxError);
});

test('identity loss never repairs a call and cleanup never overwrites a successor', () => {
  for (const variant of ['anchor', 'instance', 'policy', 'script', 'url']) {
    const f = fixture(); f.install();
    if (variant === 'url') f.location.href = 'app://-/index.html'; else f.markers[variant] = variant === 'script' ? true : 'changed';
    assert.throws(() => f.window.postMessage({type: 'codex_desktop:git-worker-port', requestId: 'id', closed: true}, 'null', []), SyntaxError);
  }
  const f = fixture(); f.install(); const successor = () => {};
  f.window.postMessage = successor; f.context.__codexPlusMobileGitOriginRepair.close();
  assert.equal(f.window.postMessage, successor);
});
