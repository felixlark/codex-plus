import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

test('the retained CLI sends explicit open and stop only to the manager command entry', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'smartshadow-cli-'));
  try {
    const app = path.join(root, 'SmartShadow.app');
    const manager = path.join(app, 'Contents/MacOS/SmartShadowManager');
    const runtime = path.join(app, 'Contents/Library/LoginItems/SmartShadowInteraction.app/Contents/MacOS/SmartShadowInteraction');
    for (const [file, role] of [[manager, 'manager'], [runtime, 'runtime']]) {
      fs.mkdirSync(path.dirname(file), {recursive:true});
      fs.writeFileSync(file, `#!/bin/bash\nprintf '%s\\n' '${role}' "$@"\n`, {mode:0o700});
    }
    const script = path.join(root, 'entry');
    fs.writeFileSync(script, fs.readFileSync(new URL('../scripts/codex-plus', import.meta.url), 'utf8').replace('APP="/Applications/SmartShadow.app"', `APP="${app}"`), {mode:0o700});
    for (const [argument, role] of [['--open-codex','manager'],['--stop-interactiond','manager'],['--status','runtime'],['--tool-status','runtime']]) {
      const result = spawnSync(script, [argument], {encoding:'utf8'});
      assert.equal(result.status, 0, result.stderr);
      assert.equal(result.stdout, `${role}\n${argument}\n`);
    }
  } finally { fs.rmSync(root, {recursive:true, force:true}); }
});
