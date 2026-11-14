// A versioned structured-clone carrier. No executable code or RPC semantics.
// The original app-host RPC serializes capabilities itself before this layer.
export async function encodeMobileValue(value) {
  const nodes = [], seen = new Map();
  async function visit(v) {
    if (v === undefined) return {atom: 'undefined'};
    if (typeof v === 'number' && !Number.isFinite(v)) return {atom: String(v)};
    if (typeof v === 'number' && Object.is(v, -0)) return {atom: '-0'};
    if (typeof v === 'bigint') return {atom: 'bigint', value: String(v)};
    if (v === null || ['string', 'boolean', 'number'].includes(typeof v)) return v;
    if (typeof v !== 'object') throw Error('Unsupported mobile carrier value');
    if (seen.has(v)) return {ref: seen.get(v)};
    const id = nodes.length; seen.set(v, id); nodes.push(null);
    let n;
    if (Array.isArray(v)) n = {type: 'Array', length: v.length, entries: await Promise.all(Object.keys(v).map(async k => [k, await visit(v[k])]))};
    else if (v instanceof ArrayBuffer) {
      let binary = ''; for (const b of new Uint8Array(v)) binary += String.fromCharCode(b);
      n = {type: 'ArrayBuffer', data: btoa(binary)};
    } else if (ArrayBuffer.isView(v)) n = {type: 'View', name: v.constructor.name, buffer: await visit(v.buffer), offset: v.byteOffset, length: v instanceof DataView ? v.byteLength : v.length};
    else if (v instanceof Date) n = {type: 'Date', value: v.toISOString()};
    else if (v instanceof RegExp) n = {type: 'RegExp', source: v.source, flags: v.flags};
    else if (v instanceof Map) n = {type: 'Map', entries: await Promise.all([...v].map(async ([k, val]) => [await visit(k), await visit(val)]))};
    else if (v instanceof Set) n = {type: 'Set', entries: await Promise.all([...v].map(visit))};
    else if (typeof Blob !== 'undefined' && v instanceof Blob) n = {type: typeof File !== 'undefined' && v instanceof File ? 'File' : 'Blob', mime: v.type, name: v.name, lastModified: v.lastModified, buffer: await visit(await v.arrayBuffer())};
    else if (v instanceof Error) n = {type: 'Error', name: v.name, message: v.message, stack: v.stack, cause: await visit(v.cause)};
    else if (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null) n = {type: 'Object', entries: await Promise.all(Object.keys(v).map(async k => [k, await visit(v[k])]))};
    else throw Error(`Unsupported mobile carrier type: ${Object.prototype.toString.call(v)}`);
    nodes[id] = n; return {ref: id};
  }
  const root = await visit(value);
  return JSON.stringify({version: 1, root, nodes});
}

export function decodeMobileValue(text) {
  const packet = JSON.parse(text);
  if (packet.version !== 1 || !Array.isArray(packet.nodes)) throw Error('Invalid mobile carrier');
  const values = new Map();
  const views = {Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array, Int32Array, Uint32Array, Float32Array, Float64Array, BigInt64Array, BigUint64Array, DataView};
  function visit(v) {
    if (v === null || typeof v !== 'object') return v;
    if (Object.hasOwn(v, 'atom')) {
      switch (v.atom) {case 'undefined': return undefined; case 'NaN': return NaN; case 'Infinity': return Infinity; case '-Infinity': return -Infinity; case '-0': return -0; case 'bigint': return BigInt(v.value); default: throw Error('Invalid mobile atom');}
    }
    const id = v.ref;
    if (!Number.isSafeInteger(id) || id < 0 || id >= packet.nodes.length) throw Error('Invalid mobile reference');
    if (values.has(id)) return values.get(id);
    const n = packet.nodes[id]; let result;
    switch (n.type) {
      case 'Array': result = new Array(n.length); break;
      case 'Object': result = {}; break;
      case 'Map': result = new Map(); break;
      case 'Set': result = new Set(); break;
      case 'ArrayBuffer': result = Uint8Array.from(atob(n.data), c => c.charCodeAt(0)).buffer; break;
      case 'View': {
        if (!Object.hasOwn(views, n.name)) throw Error('Unsupported mobile view');
        result = new views[n.name](visit(n.buffer), n.offset, n.length); break;
      }
      case 'Date': result = new Date(n.value); break;
      case 'RegExp': result = new RegExp(n.source, n.flags); break;
      case 'Blob': result = new Blob([visit(n.buffer)], {type: n.mime}); break;
      case 'File': result = new File([visit(n.buffer)], n.name, {type: n.mime, lastModified: n.lastModified}); break;
      case 'Error': result = new Error(n.message); result.name = n.name; result.stack = n.stack; break;
      default: throw Error('Invalid mobile node');
    }
    values.set(id, result);
    if (n.type === 'Object' || n.type === 'Array') for (const [key, val] of n.entries) Object.defineProperty(result, key, {value: visit(val), writable: true, enumerable: true, configurable: true});
    if (n.type === 'Map') for (const [key, val] of n.entries) result.set(visit(key), visit(val));
    if (n.type === 'Set') for (const val of n.entries) result.add(visit(val));
    if (n.type === 'Error') result.cause = visit(n.cause);
    return result;
  }
  return visit(packet.root);
}
