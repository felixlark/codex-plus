// Local iOS persistence of already-uploaded attachment references. Text stays
// in the original composer store. Never persist Blob/data URLs or replay sends.
export function installMobileDrafts(connection) {
  let sequence = 0, closed = false;
  const calls = new Map(), cleanups = new Set();
  function request(operation, key, refs) {
    if (closed) return Promise.reject(Error('Connection closed'));
    const id = `${connection}:draft:${++sequence}`;
    return new Promise((resolve, reject) => {
      calls.set(id, {resolve, reject});
      try { window.webkit.messageHandlers.lifecycle.postMessage({connection, operation, id, key, ...refs ? {refs} : {}}); }
      catch (error) { calls.delete(id); reject(error); }
    });
  }
  function resolve(message) {
    const call = calls.get(message.id); if (!call) return;
    calls.delete(message.id); message.ok ? call.resolve(message.refs) : call.reject(Error('Attachment draft storage unavailable'));
  }
  function bind({key, read, watch, apply, loadImages, fileKey, imageKey}) {
    if (closed || typeof key !== 'string') return () => {};
    let active = true, revision = 0, last = read(), writes = Promise.resolve();
    const initial = last;
    const empty = state => !state.files.length && !state.images.length && !state.added.length && !state.order.length;
    const descriptor = file => {
      if (!file || !['label', 'path', 'fsPath'].every(k => typeof file[k] === 'string')) return null;
      return Object.fromEntries(['label', 'path', 'fsPath', 'startLine', 'endLine'].filter(k => file[k] !== undefined).map(k => [k, file[k]]));
    };
    const project = state => {
      const files = state.files.map(descriptor).filter(Boolean), added = state.added.map(descriptor).filter(Boolean);
      const images = state.images.filter(image => typeof image.id === 'string' && typeof image.localPath === 'string' && !['uploading', 'error'].includes(image.uploadStatus))
        .map(image => ({id: image.id, localPath: image.localPath, ...typeof image.filename === 'string' ? {filename: image.filename} : {}}));
      const keys = new Set([...files.map(f => fileKey(f)), ...added.map(f => fileKey(f, 'added-file')), ...images.map(i => imageKey(i.id))]);
      return {files, added, images, order: state.order.filter(key => keys.has(key))};
    };
    function warning() {
      if (active && !closed) void request('refs-warning', key).catch(() => {});
    }
    function save(state) {
      const refs = project(state);
      // Writes keep their original ordering, including the final empty record.
      writes = writes.catch(() => {}).then(() => request('refs-save', key, refs)).catch(warning);
    }
    const stop = watch(state => {
      if (!active) return;
      const changed = ['files', 'images', 'added', 'order', 'generation'].some(k => state[k] !== last[k]);
      last = state;
      if (!changed) return;
      revision++;
      save(state);
    });
    void request('refs-get', key).then(async refs => {
      if (!active || closed || revision || read().generation !== initial.generation || !empty(read())) return;
      if (!refs || (!refs.files.length && !refs.added.length && !refs.images.length)) return;
      const images = await loadImages(refs.images);
      // Every async image read finishes before this final canonical-state check.
      if (!active || closed || revision || read().generation !== initial.generation || !empty(read())) return;
      apply({...refs, images});
    }).catch(warning);
    const cleanup = () => { if (!active) return; active = false; stop(); cleanups.delete(cleanup); };
    cleanups.add(cleanup); return cleanup;
  }
  const api = {bind, resolve, close() {
    if (closed) return; closed = true;
    for (const cleanup of [...cleanups]) cleanup();
    for (const {reject} of calls.values()) reject(Error('Connection closed'));
    calls.clear();
  }};
  globalThis.__codexPlusMobileDrafts = api;
  window.addEventListener('pagehide', () => api.close(), {once: true});
}
