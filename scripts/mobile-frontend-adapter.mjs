import {createHash} from 'node:crypto';

// Enable the original browser File/Blob path only in the personal iOS bundle.
// Keep the Mac vendor application and all other frontend resources unchanged.
export const attachmentPickerAsset = Object.freeze({
  path: 'assets/async/486887.8844429c7e.js',
  sha256: 'b3105263cb15643ec4abe4aa7f96cf1f43ee56b7aa18c46dfe6ceb4b6a80a240',
});

export function adaptMobileFrontend(relative, bytes) {
  if (relative !== attachmentPickerAsset.path) return bytes;
  if (createHash('sha256').update(bytes).digest('hex') !== attachmentPickerAsset.sha256) throw Error('Unreviewed mobile attachment picker resource');
  const source = bytes.toString('utf8');
  const before = 'let bB,bF=!fn&&"cloud"!==sG&&hJ!==nP.fI;';
  if (source.split(before).length !== 2) throw Error('Original attachment picker binding changed');
  return Buffer.from(source.replace(before, 'let bB=gk,bF=!fn&&"cloud"!==sG&&hJ!==nP.fI;'));
}
