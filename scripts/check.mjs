// Static sanity check: manifest parses, every referenced file exists, locales are complete and every
// JS file passes `node --check`. Run: node scripts/check.mjs
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (p) => readFileSync(join(root, p), 'utf8');
const errors = [];
const need = (p, why) => existsSync(join(root, p)) || errors.push(`missing file: ${p} (${why})`);

const manifest = JSON.parse(read('manifest.json'));
if (manifest.manifest_version !== 3) errors.push('manifest_version must be 3');
if (!/^\d+(\.\d+){0,3}$/.test(manifest.version)) errors.push('bad version');

need(manifest.background.service_worker, 'service worker');
need(manifest.action.default_popup, 'popup');
for (const p of Object.values(manifest.icons)) need(p, 'icon');
for (const p of Object.values(manifest.action.default_icon)) need(p, 'action icon');
for (const cs of manifest.content_scripts) for (const p of [...(cs.js || []), ...(cs.css || [])]) need(p, 'content script');

// The service worker re-injects the same list on user-enabled sites.
const files = JSON.parse(read('background.js').match(/const FILES = (\[[^\]]+\])/)[1].replace(/'/g, '"'));
if (JSON.stringify(files) !== JSON.stringify(manifest.content_scripts[0].js)) errors.push('background.js FILES differs from manifest content_scripts[0].js');

// Popup assets.
const popupDir = dirname(manifest.action.default_popup);
for (const [, ref] of read(manifest.action.default_popup).matchAll(/(?:src|href)="([^"]+)"/g)) need(join(popupDir, ref), 'popup asset');

// Locales: default exists, all locales share the same keys, every key used in code is defined.
const locales = readdirSync(join(root, '_locales'));
if (!locales.includes(manifest.default_locale)) errors.push('default_locale folder missing');
const messages = Object.fromEntries(locales.map((l) => [l, JSON.parse(read(`_locales/${l}/messages.json`))]));
const base = Object.keys(messages[manifest.default_locale]).sort();
for (const l of locales) {
  const keys = Object.keys(messages[l]).sort();
  if (keys.join() !== base.join()) errors.push(`locale ${l} keys differ from ${manifest.default_locale}`);
  const description = messages[l].extDescription.message;
  if (description.length > 132) errors.push(`locale ${l}: description is ${description.length} chars (max 132)`);
  if (messages[l].extName.message.length > 75) errors.push(`locale ${l}: name too long`);
}

const jsFiles = [];
(function walk(dir) {
  for (const name of readdirSync(join(root, dir))) {
    if (['node_modules', 'dist', '.git'].includes(name)) continue;
    const rel = dir ? `${dir}/${name}` : name;
    if (statSync(join(root, rel)).isDirectory()) walk(rel);
    else if (/\.(js|mjs)$/.test(name)) jsFiles.push(rel);
  }
})('');

const used = new Set();
for (const m of JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)) used.add(m[1]);
for (const m of read(manifest.action.default_popup).matchAll(/data-i18n(?:-placeholder|-title)?="(\w+)"/g)) used.add(m[1]);
let sources = '';
for (const f of jsFiles.filter((f) => /^(content|popup)\//.test(f))) {
  const src = read(f);
  sources += src;
  // t('key') plus keys picked by a ternary, which all carry one of these prefixes.
  for (const m of src.matchAll(/\bt\('(\w+)'|'((?:sys|status|ui)[A-Z]\w*)'/g)) used.add(m[1] || m[2]);
}
for (const key of used) if (!base.includes(key)) errors.push(`i18n key used but not defined: ${key}`);
for (const key of base) if (!used.has(key) && !sources.includes(`'${key}'`)) errors.push(`i18n key defined but never used: ${key}`);

for (const f of jsFiles) {
  try {
    execFileSync(process.execPath, ['--check', join(root, f)], { stdio: 'pipe' });
  } catch (err) {
    errors.push(`syntax error in ${f}: ${String(err.stderr).split('\n').slice(0, 5).join(' ')}`);
  }
}

if (errors.length) {
  console.error(errors.map((e) => 'FAIL ' + e).join('\n'));
  process.exit(1);
}
console.log(`OK manifest v${manifest.version}: ${jsFiles.length} JS files pass node --check, ${base.length} i18n keys x ${locales.length} locales, all referenced files exist`);
