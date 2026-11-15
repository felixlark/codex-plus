import test from 'node:test';
import assert from 'node:assert/strict';
import {localAssetPath} from '../scripts/prepare-mobile-frontend.mjs';
import {adaptMobileFrontend, attachmentPickerAsset} from '../scripts/mobile-frontend-adapter.mjs';
import fs from 'node:fs/promises';
import {openAsar, parser, walk} from '../scripts/inspect-sidebar-model.mjs';

test('packaged asset paths cannot escape the mobile bundle', () => {
  assert.equal(localAssetPath('/bundle', 'assets/icon.png'), '/bundle/assets/icon.png');
  for (const name of ['../secrets', '/private/file', 'assets/../../file', 'assets\\file', 'assets//file', '']) assert.throws(() => localAssetPath('/bundle', name));
});

test('phone adaptation removes the original desktop-only legacy skill migration hook', async t => {
  try { await fs.access('/Applications/ChatGPT.app/Contents/Resources/app.asar'); }
  catch { t.skip('Requires the pinned original frontend'); return; }
  const archive = await openAsar('/Applications/ChatGPT.app');
  try {
    const name = 'assets/async/907538.0572f09d40.js';
    const bytes = await archive.readBytes(archive.entries.find(entry => entry.path === 'webview/' + name));
    const {parse} = await parser();
    const hook = source => {
      let module, options;
      walk(parse(source, {ecmaVersion: 'latest', sourceType: 'module'}), node => {
        if (node.type === 'Property' && node.key.name === 'gKJK') module = node;
      });
      walk(module.value.body, node => {
        if (node.type === 'VariableDeclarator' && node.id.name === 'T') options = node.init.arguments[2];
      });
      return options;
    };
    assert.equal(hook(bytes.toString()).properties[0].key.name, 'onMount');
    const adapted = (await adaptMobileFrontend(name, bytes)).toString();
    assert.equal(hook(adapted).properties.length, 0);
    assert.ok(adapted.includes('__codexPlusMobileLocal.install'));
  } finally { await archive.close(); }
});

test('mobile attachment adaptation refuses an unreviewed composer and preserves other assets', async () => {
  const bytes = Buffer.from('unreviewed vendor build');
  await assert.rejects(adaptMobileFrontend(attachmentPickerAsset.path, bytes), /Unreviewed/);
  assert.equal(await adaptMobileFrontend('assets/another.js', bytes), bytes);
  for (const asset of ['907538.0572f09d40.js', '149364.fd50fe6b4a.js', '757723.3067c948bc.js']) await assert.rejects(adaptMobileFrontend('assets/async/' + asset, bytes), /Unreviewed/);
});
