import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {installMobileDrafts} from '../Sources/CodexPlus/Resources/mobile-drafts.mjs';
const flush = () => new Promise(resolve => setImmediate(resolve));
function fixture() {
  const messages = [], window = new EventTarget();
  window.webkit = {messageHandlers: {lifecycle: {postMessage: value => messages.push(value)}}};
  const context = vm.createContext({window});
  vm.runInContext(`(${installMobileDrafts.toString()})('epoch')`, context);
  const api = context.__codexPlusMobileDrafts;
  let state = {files: [], images: [], added: [], order: [], generation: 0}, observer, applied = [];
  const config = {key: 'own-thread', read: () => state, watch: fn => { observer = fn; fn(state); return () => { observer = null; }; },
    apply: value => applied.push(value), loadImages: async images => images,
    fileKey: (file, kind = 'file') => `${kind}:${file.path}`, imageKey: id => `image:${id}`};
  return {api, messages, config, applied, change(next) { state = {...state, ...next}; observer?.(state); },
    answer(message, refs) { api.resolve({id: message.id, ok: true, refs}); }};
}
const refs = {files: [{label: 'sample.txt', path: '/own/sample.txt', fsPath: '/own/sample.txt'}], added: [], images: [], order: ['file:/own/sample.txt']};

test('initial empty composer does not erase stored refs before restoration', async () => {
  const f = fixture(); f.api.bind(f.config);
  assert.deepEqual(f.messages.map(m => m.operation), ['refs-get']);
  f.answer(f.messages[0], refs); await flush();
  assert.equal(f.applied.length, 1); assert.equal(f.applied[0].files[0].path, '/own/sample.txt');
  f.api.close();
});

test('clear, user additions, and unmount each revoke a delayed image restore', async () => {
  for (const action of ['clear', 'add', 'unmount']) {
    const f = fixture(); let release, started;
    const loading = new Promise(resolve => { started = resolve; });
    f.config.loadImages = () => { started(); return new Promise(resolve => { release = resolve; }); };
    const cleanup = f.api.bind(f.config);
    f.answer(f.messages[0], {...refs, images: [{id: 'image', localPath: '/own/image.png'}]});
    await loading;
    if (action === 'clear') f.change({generation: 1, files: [], images: [], added: [], order: []});
    else if (action === 'add') f.change({files: refs.files, order: refs.order});
    else cleanup();
    release([{id: 'image', src: 'data:original'}]); await flush();
    assert.equal(f.applied.length, 0, action);
    for (const request of f.messages) f.answer(request);
    f.api.close();
  }
});

test('nonempty writes commit before the later empty record, without persisting image bytes', async () => {
  const f = fixture(); f.api.bind(f.config); f.answer(f.messages[0], null); await flush();
  f.change({files: [{...refs.files[0], secret: 'excluded'}], images: [{id: 'img', localPath: '/own/blue.png', src: 'data:excluded', uploadStatus: 'idle'}], order: [...refs.order, 'image:img', 'pending:excluded']});
  await flush();
  const first = f.messages.find(m => m.operation === 'refs-save');
  assert.ok(first); assert.equal(JSON.stringify(first.refs).includes('excluded'), false);
  f.change({files: [], images: [], added: [], order: [], generation: 1}); await flush();
  assert.equal(f.messages.filter(m => m.operation === 'refs-save').length, 1);
  f.answer(first); await flush();
  const writes = f.messages.filter(m => m.operation === 'refs-save');
  assert.equal(writes.length, 2); assert.equal(writes[1].refs.files.length, 0); assert.equal(writes[1].refs.images.length, 0);
  f.answer(writes[1]); f.api.close();
});
