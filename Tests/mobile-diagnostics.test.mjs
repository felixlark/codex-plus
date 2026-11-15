import test from 'node:test';
import assert from 'node:assert/strict';
import {mobileDiagnostic} from '../Sources/CodexPlus/Resources/mobile-diagnostics.mjs';

test('renderer diagnostics retain code locations without error contents or URL identities', () => {
  const error = new Error('private document text, account id and token must stay here');
  error.stack = 'at app://-/assets/async/123.abcdef.js:4:56\nat https://example.test/private?token=secret:2:3';
  assert.deepEqual(mobileDiagnostic('script-error', error), {event: 'script-error', frames: [{file: '123.abcdef.js', line: 4, column: 56}]});
  assert.deepEqual(mobileDiagnostic('unhandled-rejection', Error("'getSystemInfo' is not a function.")), {event: 'unhandled-rejection', missingMethod: 'getSystemInfo'});
  assert.deepEqual(mobileDiagnostic('script-error', {message: "'private token value' is not a function."}), {event: 'script-error'});
});
