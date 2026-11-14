import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const css = async file => readFile(new URL(`../browser-extension/${file}`, import.meta.url), 'utf8');
const [manager, settings, nav] = await Promise.all(['pages/manager/manager.css', 'pages/settings/settings.css', 'shared/workspace-nav.css'].map(css));
const rule = (source, selector) => source.match(new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([^}]+)\\}`))[1];
const maxWidth = source => Number(source.match(/max-width:\s*(\d+)px/)[1]);
test('standalone management shells use one width and viewport inset at desktop and narrow sizes', () => {
  const video = rule(manager, '.page');
  const prefs = rule(settings, '.settings');
  const header = rule(nav, '.workspace-header-inner');
  for (const block of [video, prefs, header]) {
    assert.equal(maxWidth(block), 1180);
    assert.match(block, /margin:\s*0 auto/);
    assert.match(block, /padding:\s*\d+px 20px/);
  }
  for (const source of [manager, settings, nav]) {
    assert.match(source, /@media\s*\(max-width:\s*560px\)/);
  }
  assert.match(manager, /\.page\s*\{\s*padding:\s*12px 16px 184px/);
  assert.match(settings, /\.settings\s*\{\s*padding:\s*12px 16px 32px/);
  assert.match(nav, /\.workspace-header-inner\{padding-inline:16px/);
  // CSS box-model regression, not a claim of real browser/platform acceptance.
  for (const viewport of [320, 375, 560, 600, 768, 1180, 1440, 1920]) {
    const bounds = block => {
      const width = Math.min(viewport, maxWidth(block));
      const inset = viewport <= 560 ? 16 : 20;
      return [(viewport - width) / 2 + inset, width - inset * 2];
    };
    assert.deepEqual(bounds(prefs), bounds(video), `settings at ${viewport}`);
    assert.deepEqual(bounds(header), bounds(video), `header at ${viewport}`);
    assert.ok(bounds(prefs)[1] > 0);
  }
});
test('brand hover suppresses global link underline without removing keyboard focus', async () => {
  assert.match(rule(nav, '.workspace-brand:hover'), /text-decoration:\s*none/);
  assert.match(await css('shared/theme.css'), /a:focus-visible\s*\{[^}]*outline:/);
  assert.doesNotMatch(settings, /body\s*\{[^}]*font-size:/);
});
