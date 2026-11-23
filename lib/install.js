/**
 * Installing — and taking back — the `kb` command.
 *
 * The plugin writes two files into the bin directory:
 *
 *   kb                          the shell command (mode 0755)
 *   .dsh-shared-workspace-memory-kb.json      a manifest recording what we installed and its hash
 *
 * Removal is only ever allowed for a file this plugin wrote: either the manifest is
 * present and names us, or the script still carries our marker line. An unrelated
 * `kb` someone else installed is left alone and reported instead of deleted.
 */

import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const MANIFEST_NAME = '.dsh-shared-workspace-memory-kb.json';
/** Written by the previous package name; removed so a rename leaves nothing behind. */
export const LEGACY_MANIFEST_NAMES = ['.dsh-shared-session-memory-kb.json', '.dsh-knowledge-kb.json'];
/** Marker lines written by the previous package name, so a rename can still upgrade itself. */
export const LEGACY_MARKERS = ['# dsh-shared-session-memory:kb', '# dsh-knowledge:kb'];

function looksOurs(body) {
  if (body === undefined) return false;
  return body.includes(MARKER) || LEGACY_MARKERS.some((marker) => body.includes(marker));
}
export const MARKER = '# dsh-shared-workspace-memory:kb';
export const BIN_NAME = 'kb';

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function scriptPath(input) {
  if (typeof input === 'string') return input;
  return fileURLToPath(input);
}

export async function readManifest(binDir) {
  const text = await fs.readFile(path.join(binDir, MANIFEST_NAME), 'utf8').catch(() => undefined);
  if (text === undefined) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export async function cliStatus({ binDir }) {
  const target = path.join(binDir, BIN_NAME);
  const body = await fs.readFile(target, 'utf8').catch(() => undefined);
  const manifest = await readManifest(binDir);
  return {
    path: target,
    installed: body !== undefined,
    ours: manifest !== undefined ? [MARKER, ...LEGACY_MARKERS].includes(manifest.marker) : looksOurs(body),
    version: manifest?.version,
    changed: body !== undefined && manifest?.sha256 !== undefined ? sha256(body) !== manifest.sha256 : undefined,
  };
}

export async function installCli({ binDir, source, version = '0.2.1' }) {
  const template = await fs.readFile(scriptPath(source), 'utf8');
  const body = template.replace('__KB_VERSION__', version);
  await fs.mkdir(binDir, { recursive: true });

  const target = path.join(binDir, BIN_NAME);
  const existing = await fs.readFile(target, 'utf8').catch(() => undefined);
  const foreign = existing !== undefined && !looksOurs(existing);
  if (foreign) {
    return { installed: false, path: target, reason: 'a different kb command already exists; left it untouched' };
  }

  const changed = existing !== body;
  if (changed) {
    await fs.writeFile(target, body, 'utf8');
    await fs.chmod(target, 0o755);
  }
  const manifest = {
    marker: MARKER,
    plugin: 'dsh-shared-workspace-memory',
    version,
    sha256: sha256(body),
    installedAt: new Date().toISOString(),
    path: target,
  };
  await fs.writeFile(path.join(binDir, MANIFEST_NAME), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  for (const legacy of LEGACY_MANIFEST_NAMES) await fs.rm(path.join(binDir, legacy), { force: true });
  return { installed: true, path: target, changed, version };
}

export async function removeCli({ binDir }) {
  const target = path.join(binDir, BIN_NAME);
  const status = await cliStatus({ binDir });
  if (!status.installed) return { removed: false, path: target, reason: 'not installed' };
  if (!status.ours) return { removed: false, path: target, reason: 'kb was not installed by dsh-shared-workspace-memory; left it untouched' };
  await fs.rm(target, { force: true });
  await fs.rm(path.join(binDir, MANIFEST_NAME), { force: true });
  for (const legacy of LEGACY_MANIFEST_NAMES) await fs.rm(path.join(binDir, legacy), { force: true });
  return { removed: true, path: target };
}
