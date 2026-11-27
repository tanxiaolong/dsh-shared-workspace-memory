import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

// A render loop here is not a cosmetic bug: every pass issued a bridge request, and the
// storm exhausted the Host's file descriptors (spawn EBADF, dead input).
test('the settings page keeps its render identities stable', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  assert.ok(
    !/const t = makeTranslator\(props\);/u.test(source),
    'the translator must be memoized — a fresh function per render re-fires the loader',
  );
  assert.match(source, /React\.useMemo\(\(\) => makeTranslator\(/u);
  assert.match(source, /if \(started\.current\) return;/u, 'the first load must be guarded by a ref');
  const effectLoads = source.match(/React\.useEffect\(\(\) => \{\s*load\(\);/gu) ?? [];
  assert.equal(effectLoads.length, 0, 'load() must not be called unguarded from an effect');
});

test('every bridge fetch goes through the shared helper', async () => {
  const source = await readFile(new URL('../client.js', import.meta.url), 'utf8');
  const raw = source.match(/\bfetch\(/gu) ?? [];
  assert.equal(raw.length, 1, 'only fetchJson may call fetch directly');
  assert.match(source, /async function fetchJson\(/u);
});
