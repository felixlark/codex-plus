#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';

export const toolRoot = path.join(os.homedir(), 'Library/Caches/codex-plus/project-order-probe');
export const reviewedHostResource = Object.freeze({
  path: 'webview/assets/async/907538.0572f09d40.js',
  sha256: 'eba5577e16a50a8106a64a05025fa23d0a589d8b4f775a6fe065ba7d916e6b1c',
});
export const reviewedRouteResource = Object.freeze({
  path: 'webview/assets/async/757723.3067c948bc.js',
  sha256: '67cc5635a64f200b60e53cbf6b2fe74e4e8f0440c6ab0ccffd6c0056f849f3e4',
});

export async function adaptReloadRoute(source) {
  if (createHash('sha256').update(source).digest('hex') !== reviewedRouteResource.sha256) return {supported:false,reason:'unreviewed-route-source'};
  const {parse}=await parser();const ast=parse(source,{ecmaVersion:'latest',sourceType:'module'});const matches=[];
  walk(ast,(node,parents)=>{
    if(node.type!=='IfStatement'||!contains(node.test,child=>child.type==='MemberExpression'&&child.property.name==='persistForReload'))return;
    if(!contains(node.consequent,child=>child.type==='MemberExpression'&&child.property.name==='replaceState')||!contains(node.consequent,child=>child.type==='Literal'&&child.value==='initialRoute'))return;
    const owner=[...parents].reverse().find(parent=>parent.type==='FunctionDeclaration');
    if(!owner)return;
    const locations=[];const effects=new Set();
    walk(owner.body,(child,ancestors)=>{
      if(child.type==='VariableDeclarator'&&child.id.type==='Identifier'&&child.init?.type==='CallExpression'){
        const callee=child.init.callee.type==='SequenceExpression'?child.init.callee.expressions.at(-1):child.init.callee;
        if(callee.type==='MemberExpression'&&callee.property.name==='zy'){
          const declaration=ancestors.at(-1);if(declaration.type==='VariableDeclaration')locations.push({name:child.id.name,at:declaration.end});
        }
      }
      if(child.type==='CallExpression'){
        const callee=child.callee.type==='SequenceExpression'?child.callee.expressions.at(-1):child.callee;
        if(callee.type==='MemberExpression'&&callee.property.name==='useEffect'&&callee.object.type==='Identifier')effects.add(callee.object.name);
      }
    });
    if(locations.length===1&&effects.size===1)matches.push({...locations[0],react:[...effects][0]});
  });
  if(matches.length!==1)return {supported:false,reason:'route-match-count'};
  const match=matches[0];
  const hook=`(0,${match.react}.useEffect)(()=>(${restoreChatRoute.toString()})(${match.name}),[${match.name}]);`;
  const adapted=source.slice(0,match.at)+hook+source.slice(match.at);
  parse(adapted,{ecmaVersion:'latest',sourceType:'module'});
  return {supported:true,source:adapted,match};
}

export function restoreChatRoute(location) {
  globalThis.__codexPlusFeatures?.routeChanged(location);
  const key='codex-plus.last-chat-route.v1';
  try {
    const url=new URL(window.location.href);
    if(url.protocol!=='app:'||url.hostname!=='-'||url.pathname!=='/index.html')return;
    const previous=sessionStorage.getItem(key);
    if(location.pathname==='/'||/^\/(local|remote)\/[a-zA-Z0-9_-]+$/.test(location.pathname)){
      const route=location.pathname+location.search+location.hash;
      url.searchParams.set('initialRoute',route);sessionStorage.setItem(key,route);
    }else if(previous&&url.searchParams.get('initialRoute')===previous){
      url.searchParams.delete('initialRoute');sessionStorage.removeItem(key);
    }else return;
    if(url.href!==window.location.href)window.history.replaceState(window.history.state,'',url.href);
  } catch {}
}

export async function parser() {
  const bundled = new URL('./acorn.mjs', import.meta.url);
  try { await fs.access(bundled); return import(bundled.href); }
  catch { return import(pathToFileURL(path.join(toolRoot, 'node_modules/acorn/dist/acorn.mjs')).href); }
}

export function walk(node, visit, parents = []) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parents);
  const next = [...parents, node];
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit, next);
    else if (value && typeof value.type === 'string') walk(value, visit, next);
  }
}

function property(object, name) {
  if (object?.type !== 'ObjectExpression') return undefined;
  return object.properties.find(p =>
    p.type === 'Property' && (p.key.name ?? p.key.value) === name);
}

function contains(node, match) {
  let found = false;
  walk(node, child => { if (match(child)) found = true; });
  return found;
}

export function sortProjectGroups(groups, getRecencyAt, getPriority = () => 3) {
  const buckets = new Map();
  groups.forEach((group, index) => {
    let timestamp = 0, priority = 3, unknown = false;
    for (const key of group.threadKeys) {
      priority = Math.min(priority, getPriority(key));
      const value = getRecencyAt(key);
      if (!Number.isFinite(value)) unknown = true;
      else timestamp = Math.max(timestamp, value);
    }
    if (!buckets.has(priority)) buckets.set(priority, []);
    buckets.get(priority).push({ group, index, timestamp, unknown });
  });
  const result = [...buckets].sort(([a], [b]) => a - b).flatMap(([, bucket]) => {
    const known = bucket.filter(item => !item.unknown).sort((a, b) => b.timestamp - a.timestamp || a.index - b.index);
    let next = 0;
    // Missing clocks retain their slots within their status class, so an idle
    // project with incomplete metadata cannot pin itself above active work.
    return bucket.map(item => item.unknown ? item.group : known[next++].group);
  });
  return result.every((group, index) => group === groups[index]) ? groups : result;
}

// Native summaries may retain the user-message timestamp after a background turn
// finishes. Observe the native reactive status as well as both native clocks.
export function createProjectActivityRuntime(storage, now, sortGroups) {
  const storagePrefix = 'codex-plus.project-activity.v1.';
  const storageKey = storagePrefix + globalThis.crypto.randomUUID();
  let times = {};
  const ownTimes = {};
  function mergeStored() {
    try {
      for (let index = 0; index < (storage?.length ?? 0); index++) {
        const key = storage.key(index);
        if (!key?.startsWith(storagePrefix)) continue;
        const saved = JSON.parse(storage.getItem(key) ?? 'null');
        if (saved?.version !== 1) continue;
        for (const [task,time] of Object.entries(saved.times ?? {})) if (Number.isFinite(time)) times[task] = Math.max(times[task] ?? 0,time);
      }
    } catch {}
  }
  mergeStored();
  const states = new Map();
  let stats = null;
  const runtime = { protocol: 8, get stats() { return stats; }, sort(groups, recency, updated, status) {
    const clocks = new Map();
    const priorities = new Map();
    let changed = false;
    mergeStored();
    for (const group of groups) for (const key of group.threadKeys) {
      let current;
      try { current = status(key); } catch {}
      const previous = states.get(key);
      if (current !== undefined && previous !== undefined && previous !== current && !(previous === 'unread' && current === 'idle')) {
        times[key] = Math.max(Number.isFinite(times[key]) ? times[key] : 0, now()); ownTimes[key] = times[key]; changed = true;
      }
      if (current !== undefined) states.set(key, current);
      priorities.set(key, ['input','approval','error'].includes(current) ? 0 : current === 'unread' ? 1 : current === 'active' ? 2 : 3);
      const a = recency(key), b = updated(key), c = times[key];
      const values = [a,b,c].filter(Number.isFinite);
      clocks.set(key, values.length ? Math.max(...values) : undefined);
    }
    // Each document writes only its own ledger. Concurrent windows never replace
    // each other's entries; all readers merge task timestamps with max().
    if (changed) { try { storage?.setItem(storageKey, JSON.stringify({version:1,times:ownTimes})); } catch {} }
    // Sort the complete model before native preview truncation and navigation
    // are derived. Preserve native order (including manual order) within a class.
    let projected = groups.map(group => {
      const threadKeys = [...group.threadKeys].sort((a,b) => priorities.get(a) - priorities.get(b));
      return threadKeys.every((key,index) => key === group.threadKeys[index]) ? group : {...group,threadKeys};
    });
    if (projected.every((group,index) => group === groups[index])) projected = groups;
    const result = sortGroups(projected,key=>clocks.get(key),key=>priorities.get(key));
    stats = {calls:(stats?.calls??0)+1, order:result.map(group=>projected.indexOf(group)),groups:groups.map(group=>({threads:group.threadKeys.length,recency:group.threadKeys.map(recency),updated:group.threadKeys.map(updated),status:group.threadKeys.map(key=>states.get(key)),activity:group.threadKeys.map(key=>times[key]??0)}))};
    return result;
  }};
  return Object.freeze(runtime);
}

function directConstant(owner, name) {
  const matches = owner.body.body.flatMap(statement => statement.type === 'VariableDeclaration' && statement.kind === 'const' ?
    statement.declarations.filter(declaration => declaration.id.type === 'Identifier' && declaration.id.name === name) : []);
  if (matches.length !== 1) return undefined;
  const writes = contains(owner.body, node => {
    let target = node.type === 'AssignmentExpression' ? node.left : node.type === 'UpdateExpression' ? node.argument : undefined;
    while (target?.type === 'MemberExpression') target = target.object;
    return target?.type === 'Identifier' && target.name === name;
  });
  return writes ? undefined : matches[0].init;
}

function directFixtureChain(ast, model, sidebar, inputName, sortedGroups) {
  if (model.type !== 'FunctionDeclaration' || sidebar.type !== 'FunctionDeclaration') return false;
  const returns = model.body.body.filter(statement => statement.type === 'ReturnStatement');
  if (returns.length !== 1 || property(returns[0].argument, 'projectGroups')?.value.name !== sortedGroups) return false;
  const entries = property(directConstant(sidebar, inputName), 'projectEntries')?.value;
  const groups = entries?.type === 'CallExpression' && entries.callee.type === 'MemberExpression' &&
    entries.callee.property.name === 'map' ? entries.callee.object : undefined;
  if (groups?.type !== 'MemberExpression' || groups.property.name !== 'projectGroups' || groups.object.type !== 'Identifier') return false;
  const parameter = sidebar.params.findIndex(node => node.type === 'Identifier' && node.name === groups.object.name);
  if (parameter < 0) return false;
  let proven = 0;
  let calls = 0;
  walk(ast, (node, parents) => {
    if (node.type !== 'CallExpression' || node.callee.name !== sidebar.id.name) return;
    calls++;
    const argument = node.arguments[parameter];
    if (argument?.type !== 'Identifier') return;
    const owner = [...parents].reverse().find(parent => /Function/.test(parent.type));
    const binding = owner?.body.type === 'BlockStatement' ? directConstant(owner, argument.name) : undefined;
    if (binding?.type === 'CallExpression' && binding.callee.name === model.id.name) proven++;
  });
  return calls === 1 && proven === 1;
}

export async function adaptSidebar(source, { host = false, resourcePath } = {}) {
  if (source.includes('globalThis.__codexPlusProjectOrder??=')) return { supported: false, reason: 'already-adapted' };
  if (!source.includes('getRecencyAt') || !source.includes('PROJECT_ORDER')) return { supported: false, reason: 'unrelated-resource' };
  if (host && (resourcePath !== reviewedHostResource.path ||
      createHash('sha256').update(source).digest('hex') !== reviewedHostResource.sha256)) {
    return { supported: false, reason: 'unreviewed-host-source' };
  }
  const { parse } = await parser();
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const candidates = [];
  const layouts = [];
  walk(ast, (node, parents) => {
    if (node.type === 'CallExpression' && node.arguments[0]?.type === 'ArrayExpression' && node.arguments[1]?.type === 'ObjectExpression') {
      const entries = node.arguments[0].elements.find(item => item?.type === 'SpreadElement' &&
        item.argument.type === 'MemberExpression' && item.argument.property.name === 'projectEntries');
      const options = node.arguments[1];
      const input = entries?.argument.object;
      const spread = options.properties.find(item => item.type === 'SpreadElement' &&
        item.argument.type === 'MemberExpression' && item.argument.object.name === input?.name && item.argument.property.name === 'options');
      const declaration = parents.at(-1);
      const owner = [...parents].reverse().find(parent => /Function/.test(parent.type));
      if (input?.type === 'Identifier' && spread && property(options, 'getCollapsedAttention') && property(options, 'pinnedOrder') &&
          declaration?.type === 'VariableDeclarator' && owner && contains(owner.body, child =>
            child.type === 'ReturnStatement' && property(child.argument, 'layout')?.value.name === declaration.id.name)) {
        layouts.push({ at: options.end - 1, input: input.name, owner });
      }
    }
    if (node.type !== 'AssignmentExpression' || node.operator !== '=' || node.left.type !== 'Identifier') return;
    const call = node.right;
    if (call.type !== 'CallExpression' || call.callee.type !== 'MemberExpression' ||
        call.callee.property.name !== 'map' || call.callee.object.name !== node.left.name) return;
    const callback = call.arguments[0];
    if (!callback || !contains(callback, child => child.type === 'MemberExpression' && child.property.name === 'threadKeys')) return;
    const clocks = new Set();
    walk(callback, child => {
      const clock = property(child, 'getRecencyAt');
      if (clock?.value.type === 'Identifier' && property(child, 'items') && property(child, 'sortMode')) clocks.add(clock.value.name);
    });
    if (clocks.size !== 1) return;
    const owner = [...parents].reverse().find(p => /Function/.test(p.type));
    if (!owner) return;
    const initializers = [];
    walk(owner.body, child => {
      if (child.type === 'VariableDeclarator' && child.id.name === node.left.name &&
          contains(child.init, item => property(item, 'groups') && property(item, 'projectOrder')) &&
          contains(child.init, item => item.type === 'MemberExpression' && item.property.name === 'PROJECT_ORDER')) initializers.push(child);
    });
    if (initializers.length !== 1 || !contains(owner.body, child =>
      property(child, 'projectGroups') && property(child, 'navigationThreadKeys'))) return;
    candidates.push({ start: call.start, end: call.end, groups: node.left.name, clock: [...clocks][0], owner });
  });
  if (candidates.length !== 1) return { supported: false, reason: 'model-match-count', matches: candidates.length };
  if (layouts.length !== 1) return { supported: false, reason: 'layout-match-count', matches: layouts.length };
  const { owner: modelOwner, ...match } = candidates[0];
  const { owner: layoutOwner, ...layout } = layouts[0];
  if (!host && !directFixtureChain(ast, modelOwner, layoutOwner, layout.input, match.groups)) return { supported: false, reason: 'model-layout-data-chain' };
  const clocks = [];
  walk(modelOwner.body, node => {
    if (node.type !== 'VariableDeclarator' || node.id.name !== match.clock) return;
    walk(node.init, call => {
      if (call.type !== 'CallExpression') return;
      const member = call.callee.type === 'SequenceExpression' ? call.callee.expressions.at(-1) : call.callee;
      if (member?.type === 'MemberExpression' && member.property.name === 'Kr' && member.object.type === 'Identifier' && call.arguments[0]?.type === 'Identifier') {
        clocks.push({ module: member.object.name, get: call.arguments[0].name });
      }
    });
  });
  if (clocks.length !== 1) return { supported: false, reason: 'native-clock-contract' };
  const clock = clocks[0];
  const runtime = `;globalThis.__codexPlusProjectOrder??=(${createProjectActivityRuntime.toString()})((()=>{try{return globalThis.localStorage}catch{return null}})(),Date.now,(${sortProjectGroups.toString()}));\n`;
  const replacement = `globalThis.__codexPlusProjectOrder.sort(${source.slice(match.start, match.end)},${match.clock},key=>${clock.get}(${clock.module}.RD,key),key=>${clock.get}(${clock.module}.qM,key))`;
  let adapted = source;
  const edits = [
    { start: match.start, end: match.end, replacement },
    { start: layout.at, end: layout.at, replacement: `,projectOrder:${layout.input}.projectEntries.map(entry=>entry.key)` },
  ];
  for (const edit of edits.sort((a, b) => b.start - a.start)) adapted = adapted.slice(0, edit.start) + edit.replacement + adapted.slice(edit.end);
  adapted = runtime + adapted;
  parse(adapted, { ecmaVersion: 'latest', sourceType: 'module' });
  return { supported: true, source: adapted, match, layout, binding: host ? 'reviewed-host-sha256' : 'fixture-direct-data-chain' };
}

export async function openAsar(app) {
  const file = await fs.open(path.join(app, 'Contents/Resources/app.asar'));
  const prefix = Buffer.alloc(16);
  await file.read(prefix, 0, 16, 0);
  const headerSize = prefix.readUInt32LE(4);
  const jsonSize = prefix.readUInt32LE(12);
  const data = Buffer.alloc(jsonSize);
  await file.read(data, 0, jsonSize, 16);
  const header = JSON.parse(data.toString('utf8'));
  const entries = [];
  function collect(directory, prefix = '') {
    for (const [name, entry] of Object.entries(directory.files ?? {})) {
      const namePath = prefix + name;
      if (entry.files) collect(entry, namePath + '/');
      else if (entry.offset !== undefined) entries.push({ path: namePath, ...entry });
    }
  }
  collect(header);
  return {
    entries,
    async read(entry) {
      const body = Buffer.alloc(entry.size);
      await file.read(body, 0, entry.size, 8 + headerSize + Number(entry.offset));
      return body.toString('utf8');
    },
    close: () => file.close(),
  };
}

export async function writeReport(out, report) {
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + '\n');
}

export async function inspect(app) {
  const plist = field => execFileSync('/usr/libexec/PlistBuddy', ['-c', `Print :${field}`, path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
  const archive = await openAsar(app);
  const resources = [];
  try {
    for (const entry of archive.entries.filter(e => e.path.startsWith('webview/') && e.path.endsWith('.js'))) {
      const source = await archive.read(entry);
      if (!source.includes('getRecencyAt:') || !source.includes('PROJECT_ORDER')) continue;
      const result = await adaptSidebar(source, { host: true, resourcePath: entry.path });
      resources.push({ path: entry.path, bytes: entry.size, supported: result.supported,
        reason: result.reason, matches: result.matches, match: result.match, layout: result.layout, binding: result.binding });
    }
  } finally { await archive.close(); }
  return { bundleID: plist('CFBundleIdentifier'), version: plist('CFBundleShortVersionString'), resources };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { values } = parseArgs({ options: { app: { type: 'string' }, out: { type: 'string' } } });
  if (!values.app || !values.out) throw new Error('--app and --out are required');
  const report = await inspect(values.app);
  await writeReport(values.out, report);
  console.log(JSON.stringify({ version: report.version, matchedResources: report.resources.filter(r => r.supported).length, out: values.out }));
}
