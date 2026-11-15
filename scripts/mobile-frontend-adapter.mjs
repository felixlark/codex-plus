import {createHash} from 'node:crypto';
import {mobileHost} from '../Sources/CodexPlus/Resources/mobile-host.mjs';
import {adaptReloadRoute, reviewedRouteResource, parser, walk} from './inspect-sidebar-model.mjs';

// Enable the original browser File/Blob path only in the personal iOS bundle.
// Keep the Mac vendor application and all other frontend resources unchanged.
export const attachmentPickerAsset = Object.freeze({
  path: 'assets/async/486887.8844429c7e.js',
  sha256: 'b3105263cb15643ec4abe4aa7f96cf1f43ee56b7aa18c46dfe6ceb4b6a80a240',
});

// Called by the original router's existing React location effect.
export function reportMobileRoute(location) {
  globalThis.__codexPlusMobileLifecycle?.routeChanged(location);
}

export async function adaptMobileFrontend(relative, bytes) {
  if (relative === 'index.html') {
    if (createHash('sha256').update(bytes).digest('hex') !== mobileHost.indexSHA256) throw Error('Unreviewed mobile document resource');
    const source = bytes.toString('utf8');
    if (source.split('</head>').length !== 2) throw Error('Original document head changed');
    // Keep touch editing readable without WebKit focus zoom. User pinch zoom
    // and the original input, selection, composition and submit handlers remain.
    const style = `<style data-codex-mobile-input-size>
@media(pointer:coarse){html body input,html body textarea,html body [contenteditable="true"]{font-size:max(16px,1em)}}
@media(pointer:coarse) and (orientation:landscape) and (max-height:240px){
body:has([contenteditable="true"]:focus) [data-window-titlebar],body:has([contenteditable="true"]:focus) [data-app-shell-header-layout]{display:none}
html body [data-composer-input-layout="multiline"]{--composer-editor-min-height:24px;--frame-height-cap:24px;font-size:16px;line-height:24px;min-height:24px;max-height:24px}
html body [data-composer-input-layout="multiline"]>[contenteditable="true"]{min-height:24px;max-height:none;overflow:visible}
}
</style>`;
    return Buffer.from(source.replace('</head>', style + '</head>'));
  }
  if (`webview/${relative}` === reviewedRouteResource.path) {
    const result = await adaptReloadRoute(bytes.toString('utf8'), reportMobileRoute);
    if (!result.supported) throw Error('Unreviewed mobile router resource');
    return Buffer.from(result.source);
  }
  if (relative === 'assets/async/907538.0572f09d40.js') {
    if (createHash('sha256').update(bytes).digest('hex') !== 'eba5577e16a50a8106a64a05025fa23d0a589d8b4f775a6fe065ba7d916e6b1c') throw Error('Unreviewed mobile sidebar state resource');
    const source = bytes.toString('utf8'), before = 'function ea(){return!0}function es(){return!0}';
    if (source.split(before).length !== 2) throw Error('Original sidebar default changed');
    return Buffer.from(await adaptPhoneServices(source.replace(before, 'function ea(){return window.matchMedia("(min-width: 768px)").matches}function es(){return!0}')));
  }
  if (relative === 'assets/async/149364.fd50fe6b4a.js') {
    if (createHash('sha256').update(bytes).digest('hex') !== '5ecc1fb9f5ff213542696289e2f8ec37006be3b5aee8df3c460ce68853fb8f67') throw Error('Unreviewed mobile sidebar trigger resource');
    const source = bytes.toString('utf8'), before = 'o?.hasPageSurface&&null!=o.fixedLeftPanelWidth';
    if (source.split(before).length !== 2) throw Error('Original sidebar trigger gate changed');
    return Buffer.from(source.replace(before, before + '&&window.matchMedia("(min-width: 768px)").matches'));
  }
  if (relative !== attachmentPickerAsset.path) return bytes;
  if (createHash('sha256').update(bytes).digest('hex') !== attachmentPickerAsset.sha256) throw Error('Unreviewed mobile attachment picker resource');
  const source = bytes.toString('utf8');
  const before = 'let bB,bF=!fn&&"cloud"!==sG&&hJ!==nP.fI;';
  if (source.split(before).length !== 2) throw Error('Original attachment picker binding changed');
  const attachmentHook = 'hJ="worktree"===sG?mH:u3,pf=(0,nP.Qz)(hJ);';
  if (source.split(attachmentHook).length !== 2) throw Error('Original composer attachment scope changed');
  const fields = get => `({files:${get}(ok.PA),images:${get}(ok.gy),added:${get}(ok.a$),order:${get}(ok.CH),generation:${get}(ok.kV)})`;
  const effect = `(0,f.useEffect)(()=>globalThis.__codexPlusMobileDrafts?.bind({
    key:(0,tI.eL)(lL.value),read:()=>${fields('lL.get')},
    watch:callback=>lL.watch(({get})=>callback(${fields('get')})),
    fileKey:(file,kind)=>oA.Jz(file,kind),imageKey:id=>oA.Xq("image",id),
    loadImages:async refs=>{const loaded=await hV.m(refs.map(ref=>({label:ref.filename??ref.localPath,fsPath:ref.localPath,path:ref.localPath})));if(loaded.some(item=>item==null))throw Error("Attachment file unavailable");return loaded.map((item,i)=>({...refs[i],src:item.dataUrl,uploadStatus:"idle"}));},
    apply:value=>(0,ok.Kk)(lL,draft=>{draft.fileAttachments=value.files;draft.imageAttachments=value.images;draft.addedFiles=value.added;draft.attachmentOrder=value.order;})
  }),[lL,(0,tI.eL)(lL.value)]);`;
  return Buffer.from(source.replace(before, 'let bB=gk,bF=!fn&&"cloud"!==sG&&hJ!==nP.fI;').replace(attachmentHook, attachmentHook + effect));
}


async function adaptPhoneServices(source) {
  const {parse} = await parser();
  const ast = parse(source, {ecmaVersion: 'latest', sourceType: 'module'});
  const modules = [], petModules = [], boundaries = [];
  walk(ast, node => {
    if (node.type === 'MethodDefinition' && node.key.name === 'componentDidCatch' && node.value.params[0]?.type === 'Identifier') boundaries.push(node.value);
    if (node.type !== 'Property' || node.value.type !== 'FunctionExpression') return;
    if ((node.key.name ?? node.key.value) === 'wRZ2') modules.push(node);
    if ((node.key.name ?? node.key.value) === 'gKJK') petModules.push(node);
  });
  if (modules.length !== 1) throw Error('Original AppView module changed');
  const module = modules[0], imports = [], installs = [];
  walk(module.value.body, (node, parents) => {
    if (node.type === 'VariableDeclarator' && node.init?.type === 'CallExpression' && node.init.arguments[0]?.value === 'ZG9f') imports.push({alias: node.id.name, at: parents.at(-1).end});
    if (node.type === 'CallExpression' && node.callee.type === 'SequenceExpression') {
      const callee = node.callee.expressions.at(-1), argument = node.arguments[0];
      if (callee?.type === 'MemberExpression' && callee.property.name === 'setAppServices' && argument?.type === 'AwaitExpression' && argument.argument?.property?.name === 'services') installs.push({at: node.end, module: callee.object.name});
    }
  });
  if (imports.length !== 1 || installs.length !== 1 || source.includes('__codexPlusPhoneRPC')) throw Error('Original AppView services binding changed');
  if (boundaries.length !== 1) throw Error('Original renderer error boundary changed');
  const requireName = module.value.params[2].name, load = imports[0], install = installs[0];
  const edits = [
    {at: boundaries[0].body.start + 1, text: `globalThis.__codexPlusMobileReportCaught?.(${boundaries[0].params[0].name});`},
    {at: load.at, text: `const __codexPlusPhoneRPC=${load.alias},__codexPlusPhoneRecord=${requireName}("waIq").m;`},
    {at: install.at, text: `,await globalThis.__codexPlusMobileLocal.install(${install.module},__codexPlusPhoneRPC,__codexPlusPhoneRecord)`},
  ];
  // This desktop-only onMount migrates a legacy Mac skill by writing its
  // configuration. A second renderer on the phone must not repeat that effect.
  const migrations = [];
  if (petModules.length === 1) walk(petModules[0].value.body, node => {
    if (node.type !== 'VariableDeclarator' || node.id.name !== 'T' || node.init?.type !== 'CallExpression') return;
    const options = node.init.arguments[2];
    if (options?.type === 'ObjectExpression' && options.properties.length === 1 && options.properties[0].key.name === 'onMount') migrations.push(options);
  });
  if (migrations.length !== 1 || !source.slice(migrations[0].start, migrations[0].end).includes('"skills/config/write"') || !source.slice(migrations[0].start, migrations[0].end).includes('"hatch-pet"')) throw Error('Original desktop skill migration changed');
  edits.push({at: migrations[0].start, end: migrations[0].end, text: '{}'});
  for (const edit of edits.sort((a,b) => b.at - a.at)) source = source.slice(0, edit.at) + edit.text + source.slice(edit.end ?? edit.at);
  parse(source, {ecmaVersion: 'latest', sourceType: 'module'});
  return source;
}
