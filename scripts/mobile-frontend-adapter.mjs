import {createHash} from 'node:crypto';
import {adaptReloadRoute, reviewedRouteResource} from './inspect-sidebar-model.mjs';

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
  if (`webview/${relative}` === reviewedRouteResource.path) {
    const result = await adaptReloadRoute(bytes.toString('utf8'), reportMobileRoute);
    if (!result.supported) throw Error('Unreviewed mobile router resource');
    return Buffer.from(result.source);
  }
  if (relative === 'assets/async/907538.0572f09d40.js') {
    if (createHash('sha256').update(bytes).digest('hex') !== 'eba5577e16a50a8106a64a05025fa23d0a589d8b4f775a6fe065ba7d916e6b1c') throw Error('Unreviewed mobile sidebar state resource');
    const source = bytes.toString('utf8'), before = 'function ea(){return!0}function es(){return!0}';
    if (source.split(before).length !== 2) throw Error('Original sidebar default changed');
    return Buffer.from(source.replace(before, 'function ea(){return window.matchMedia("(min-width: 768px)").matches}function es(){return!0}'));
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
  return Buffer.from(source.replace(before, 'let bB=gk,bF=!fn&&"cloud"!==sG&&hJ!==nP.fI;'));
}
