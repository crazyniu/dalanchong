import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const read = file => readFileSync(new URL('../'+file, import.meta.url), 'utf8');
const workflow = read('.github/workflows/extension-release.yml');
test('manual CRX packaging defaults to artifacts, without publishing',()=>{
  assert.match(workflow,/workflow_dispatch:/);
  assert.match(workflow,/publish:[\s\S]*?default: false/);
  assert.match(workflow,/if: \(github.event_name == 'push' \|\| inputs.publish\) && needs.package.outputs.tag != ''/);
  assert.match(workflow,/permissions:\n  contents: read/);
  assert.ok(!workflow.includes('pull_request_target'));
});
test('CRX workflow requires fixed signing identity and cleans its temporary key',()=>{
  assert.match(workflow,/test -n "\$EXTENSION_SIGNING_KEY"/);
  assert.match(workflow,/test -n "\$EXTENSION_ID"/);
  assert.match(workflow,/umask 077/);
  assert.match(workflow,/trap 'rm -f "\$EXTENSION_KEY_PATH"' EXIT/);
  assert.match(workflow,/unset EXTENSION_SIGNING_KEY/);
  assert.match(workflow,/assert.equal\(info.signed, true/);
  assert.match(workflow,/assert.equal\(info.extensionId, process.env.EXPECTED_ID/);
  const pack = read('scripts/package-browser-extension.mjs');
  assert.match(pack,/extensionId !== process.env.EXTENSION_ID/);
  assert.match(pack,/privateKey.asymmetricKeyType !== 'rsa'/);
});
test('tested artifacts retain reviewed source and no automatic update declaration',()=>{
  assert.ok(workflow.indexOf('pnpm check') < workflow.indexOf('Package signed extension'));
  assert.ok(workflow.indexOf('pnpm test') < workflow.indexOf('Package signed extension'));
  assert.match(workflow,/git merge-base --is-ancestor HEAD origin\/main/);
  const verification = workflow.indexOf('Verify signed artifacts and release source');
  assert.ok(verification < workflow.indexOf('actions/upload-artifact'));
  assert.match(workflow.slice(verification),/test "\$actual" = "\$EXPECTED_COMMIT"/);
  assert.match(workflow,/assert.equal\(info.sourceCommit, process.env.EXPECTED_COMMIT/);
  assert.match(workflow,/!Object.hasOwn\(manifest, 'update_url'\)/);
  assert.match(workflow,/sha256sum -c SHA256SUMS/);
  assert.match(workflow.slice(workflow.indexOf('Publish complete release')),/test "\$actual" = "\$EXPECTED_COMMIT"/);
  assert.equal(JSON.parse(read('browser-extension/manifest.json')).update_url, undefined);
});

test('artifact-only source is restricted and never publishes without a tag',()=>{
  assert.match(workflow,/source:[\s\S]*?default: main/);
  assert.match(workflow,/test "\$REQUEST_PUBLISH" != true/);
  assert.match(workflow,/Source must be main or a full commit SHA/);
  assert.match(workflow,/git checkout --detach origin\/main/);
  assert.match(workflow,/needs.package.outputs.tag != ''/);
});
