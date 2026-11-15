import {test} from 'node:test';
import assert from 'node:assert/strict';
import {workspacePath, TaskWorkspaceClient} from '../Sources/CodexPlus/Resources/task-workspace.mjs';

test('workspace reader accepts only fixed GET scopes and preserves explicit pagination', () => {
  assert.equal(workspacePath({operation: 'coordination', repository: 'felixlark/smart-shadow', number: 578}), '/api/v2/event-workspace/issues/578/coordination?repository=felixlark%2Fsmart-shadow');
  for (const request of [{operation: 'issues', repository: '../x'}, {operation: 'issues', repository: 'a/b', page: 0}, {operation: 'issue', repository: 'a/b', number: 1.5}, {operation: 'control', repository: 'a/b', number: 1}]) assert.throws(() => workspacePath(request));
});

test('formal API human identity is checked and transport failures never become empty task lists', async () => {
  const calls = [], responses = [JSON.stringify({status: 'ok', authentication: 'cloudflare_access', subject: 'test-subject'}) + '\n200', JSON.stringify({items: [], next_page: 2}) + '\n200'];
  const client = new TaskWorkspaceClient((file, args, options, callback) => { calls.push({file, args}); setImmediate(() => callback(null, responses.shift())); return {kill() {}}; });
  const value = await client.read({operation: 'issues', repository: 'felixlark/smart-shadow'});
  assert.equal(value.next_page, 2); assert.equal(calls[0].file, '/opt/homebrew/bin/cloudflared');
  assert.equal(calls[1].args[2].startsWith('https://smartshadow.ai/api/v2/'), true);
  assert.ok(calls[1].args.includes('Origin: https://smartshadow.ai'));
  client.readJSON = async () => ({status: 'ok', authentication: 'service', subject: 'test-subject'});
  await assert.rejects(client.read({operation: 'issues', repository: 'a/b'}), /human_session_required/);
});

test('a real non-JSON gateway failure is reported as HTTP failure, not a login error or empty list', async () => {
  const client = new TaskWorkspaceClient((file, args, options, callback) => { setImmediate(() => callback(null, 'error code: 502\n502')); return {kill() {}}; });
  await assert.rejects(client.readJSON('/api/v2/session'), /workspace_http_502/);
});
