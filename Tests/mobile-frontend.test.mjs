import test from 'node:test';
import assert from 'node:assert/strict';
import {localAssetPath} from '../scripts/prepare-mobile-frontend.mjs';

test('packaged asset paths cannot escape the mobile bundle', () => {
  assert.equal(localAssetPath('/bundle', 'assets/icon.png'), '/bundle/assets/icon.png');
  for (const name of ['../secrets', '/private/file', 'assets/../../file', 'assets\\file', 'assets//file', '']) assert.throws(() => localAssetPath('/bundle', name));
});
