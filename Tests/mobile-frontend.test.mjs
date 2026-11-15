import test from 'node:test';
import assert from 'node:assert/strict';
import {localAssetPath} from '../scripts/prepare-mobile-frontend.mjs';
import {adaptMobileFrontend, attachmentPickerAsset} from '../scripts/mobile-frontend-adapter.mjs';

test('packaged asset paths cannot escape the mobile bundle', () => {
  assert.equal(localAssetPath('/bundle', 'assets/icon.png'), '/bundle/assets/icon.png');
  for (const name of ['../secrets', '/private/file', 'assets/../../file', 'assets\\file', 'assets//file', '']) assert.throws(() => localAssetPath('/bundle', name));
});

test('mobile attachment adaptation refuses an unreviewed composer and preserves other assets', async () => {
  const bytes = Buffer.from('unreviewed vendor build');
  await assert.rejects(adaptMobileFrontend(attachmentPickerAsset.path, bytes), /Unreviewed/);
  assert.equal(await adaptMobileFrontend('assets/another.js', bytes), bytes);
  for (const asset of ['907538.0572f09d40.js', '149364.fd50fe6b4a.js', '757723.3067c948bc.js']) await assert.rejects(adaptMobileFrontend('assets/async/' + asset, bytes), /Unreviewed/);
});
