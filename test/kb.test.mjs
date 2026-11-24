import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import * as kb from '../lib/kb.js';
import { installCli, removeCli, cliStatus } from '../lib/install.js';

async function tempDir(prefix) {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

test('scaffold creates the layout once and never overwrites', async () => {
  const root = path.join(await tempDir('kb-scaffold-'), 'knowledge');
  const first = await kb.ensureScaffold(root);
  assert.deepEqual(first.created.sort(), ['INDEX.md', 'conventions.md', 'decisions/', 'lessons/', 'projects/'].sort());
  await fs.writeFile(path.join(root, 'INDEX.md'), '# mine\n');
  const second = await kb.ensureScaffold(root);
  assert.deepEqual(second.created, []);
  assert.equal(await fs.readFile(path.join(root, 'INDEX.md'), 'utf8'), '# mine\n');
});

test('appendLine dates the line and search finds it', async () => {
  const root = await tempDir('kb-append-');
  await kb.ensureScaffold(root);
  await kb.appendLine(root, 'lessons/x.md', 'zstd 首帧必须只有表头行', { date: '2026-11-23' });
  const text = await fs.readFile(path.join(root, 'lessons/x.md'), 'utf8');
  assert.equal(text, '- 2026-11-23 zstd 首帧必须只有表头行\n');
  const hits = await kb.search(root, 'ZSTD 首帧');
  assert.ok(hits.some((hit) => hit.file === 'lessons/x.md'));
  assert.ok(hits.every((hit) => hit.text.length > 0));
});

test('pre-dated lines are not dated twice', async () => {
  const root = await tempDir('kb-dated-');
  await kb.appendLine(root, 'decisions/2026-11.md', '2026-11-23 决定不发布插件');
  assert.equal(await fs.readFile(path.join(root, 'decisions/2026-11.md'), 'utf8'), '- 2026-11-23 决定不发布插件\n');
});

test('extractIndexSection returns just the keyword table', async () => {
  const root = await tempDir('kb-index-');
  await kb.ensureScaffold(root);
  await fs.writeFile(
    path.join(root, 'INDEX.md'),
    '# 索引\n\n## 目录\n\n| a | b |\n\n## 关键词索引\n\n| 关键词 | 文件 |\n|---|---|\n| zstd | lessons/a.md |\n\n## 写什么\n\n- 一行\n',
  );
  const section = kb.extractIndexSection(await kb.readIndex(root), 500);
  assert.match(section, /关键词索引/u);
  assert.match(section, /lessons\/a\.md/u);
  assert.ok(!section.includes('## 写什么'));
});

test('promptBlock carries the path, the index and the rules', async () => {
  const root = await tempDir('kb-prompt-');
  await kb.ensureScaffold(root);
  const block = await kb.promptBlock(root, 800);
  assert.match(block, /共享知识库/u);
  assert.ok(block.includes(root));
  assert.match(block, /kb_search/u);
  assert.match(block, /参考：knowledge\//u);
});

test('safeTarget refuses to escape the root', async () => {
  const root = await tempDir('kb-safe-');
  assert.throws(() => kb.safeTarget(root, '../etc/passwd'), /escapes/u);
  assert.equal(kb.safeTarget(root, 'lessons/a.md'), path.join(root, 'lessons/a.md'));
});

test('purge deletes content but keeps the folder', async () => {
  const root = await tempDir('kb-purge-');
  await kb.ensureScaffold(root);
  await kb.appendLine(root, 'lessons/x.md', 'one');
  const result = await kb.purge(root);
  assert.ok(result.removed.length >= 2);
  assert.deepEqual(await fs.readdir(root), []);
});

test('the CLI is installed with a manifest and only that file is removable', async () => {
  const binDir = await tempDir('kb-bin-');
  const source = new URL('../scripts/kb', import.meta.url);
  const installed = await installCli({ binDir, source, version: '9.9.9' });
  assert.equal(installed.installed, true);
  assert.equal((await fs.stat(path.join(binDir, 'kb'))).mode & 0o111, 0o111);
  const body = await fs.readFile(path.join(binDir, 'kb'), 'utf8');
  assert.ok(!body.includes('__KB_VERSION__'));
  assert.match(body, /9\.9\.9/u);
  assert.equal((await cliStatus({ binDir })).ours, true);

  // A foreign kb must survive removal.
  await fs.writeFile(path.join(binDir, 'kb'), '#!/bin/sh\necho mine\n');
  await fs.rm(path.join(binDir, '.dsh-shared-workspace-memory-kb.json'), { force: true });
  const refused = await removeCli({ binDir });
  assert.equal(refused.removed, false);
  assert.match(refused.reason, /not installed by dsh-shared-workspace-memory/u);
  assert.ok((await fs.readFile(path.join(binDir, 'kb'), 'utf8')).includes('mine'));
});

test('shipped scaffold templates carry no machine-specific paths or workspace names', async () => {
  const root = path.join(await tempDir('kb-generic-'), 'knowledge');
  await kb.ensureScaffold(root);
  for (const file of ['INDEX.md', 'conventions.md']) {
    const text = await fs.readFile(path.join(root, file), 'utf8');
    assert.ok(!text.includes(os.homedir()), `${file} must not embed the current home directory`);
    assert.ok(!/\/Users\/|\/home\//u.test(text), `${file} must not embed an absolute home path`);
    assert.ok(!/default-workspace|new-starmaker/u.test(text), `${file} must not name a machine's workspaces`);
    assert.ok(!text.includes('tanxiaolong'), `${file} must not embed author details`);
  }
});

test('the prompt cache re-renders when INDEX.md changes and when a file appears', async () => {
  const root = await tempDir('kb-cache-');
  await kb.ensureScaffold(root);
  const cache = kb.createPromptCache({ root, maxChars: 400, minIntervalMs: 0, maxAgeMs: 0 });

  await cache.refresh({ force: true });
  assert.match(cache.text(), /共享知识库/u);

  // Rewrite the keyword section: the next forced refresh must pick it up.
  await fs.writeFile(
    path.join(root, 'INDEX.md'),
    '# 索引\n\n## 关键词索引\n\n| 关键词 | 去哪 |\n|---|---|\n| 缓存哨兵 | lessons/cache.md |\n',
  );
  await cache.refresh({ force: true });
  assert.match(cache.text(), /缓存哨兵/u);

  // A brand new file has to show up in the "现有文件" line without touching INDEX.md.
  await kb.appendLine(root, 'lessons/cache.md', '新文件应当出现在注入块的清单里', { date: '2026-11-24' });
  await cache.refresh({ force: true });
  assert.match(cache.text(), /lessons\/cache\.md/u);
});

test('the prompt cache throttle avoids re-reading on every call', async () => {
  const root = await tempDir('kb-throttle-');
  await kb.ensureScaffold(root);
  const cache = kb.createPromptCache({ root, minIntervalMs: 60_000, maxAgeMs: 60_000 });
  const first = await cache.refresh({ force: true });
  const again = await cache.refresh();
  assert.equal(again, first);
  assert.equal(cache.text(), first);
});

test('client bundle declares every service it touches in inject', async () => {
  const source = await fs.readFile(new URL('../client.js', import.meta.url), 'utf8');
  const match = source.match(/inject:\s*\[([^\]]*)\]/);
  assert.ok(match, 'client.js must export an inject list');
  const declared = match[1].split(',').map((part) => part.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean);
  assert.ok(declared.includes('slots'), 'slots must be declared in inject');
  assert.ok(declared.includes('locale'), 'locale must be declared in inject');
  // Guard against regressions: the apply body must not touch services it does not declare.
  for (const service of ['slots', 'locale']) {
    assert.ok(source.includes(`ctx.${service}`), `expected ctx.${service} usage to be covered by the inject list`);
  }
  assert.ok(!/ctx\.(remote|sessions|workspaces)\b/.test(source), 'client must not reach for undeclared services');
});
