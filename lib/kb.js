/**
 * The knowledge base on disk, and the text we inject into the system prompt.
 *
 * Everything here is plain filesystem work with no Host dependency, so it can be
 * unit-tested without DSH and reused by the CLI installer.
 */

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

export const DEFAULT_ROOT = path.join(os.homedir(), 'work', 'knowledge');
export const MAX_READ_BYTES = 64 * 1024;

/** `~/x` and `~` expand against the process home; everything else is resolved. */
export function expandHome(input) {
  if (typeof input !== 'string' || input.length === 0) return undefined;
  if (input === '~') return os.homedir();
  if (input.startsWith('~/')) return path.join(os.homedir(), input.slice(2));
  return path.resolve(input);
}

export function expandRoot(input) {
  return expandHome(input) ?? DEFAULT_ROOT;
}

export function today(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

const INDEX_TEMPLATE = `# 共享知识库

这份目录对**所有 workspace 的会话**都可见，用来存跨项目、跨会话的历史结论与踩坑记录。
它由 dsh-shared-workspace-memory 插件自动注入索引；新会话不用做任何事就能知道它存在。

## 目录

| 需要什么 | 文件 |
|---|---|
| 用户偏好、环境、工具纪律 | \`conventions.md\` |
| 项目背景 | \`projects/<项目>.md\` |
| 历史决策 | \`decisions/<YYYY-MM>.md\` |
| 踩过的坑、可复用做法 | \`lessons/<主题>.md\` |

## 关键词索引

检索规则：动手前先 \`kb "<关键词>"\`，命中就读命中文件。

| 关键词 | 去哪份文件 |
|---|---|
| （在这里登记主题，例如：会话日志、zstd、插件、workspace） | \`lessons/<主题>.md\` |

## 写什么

- 任务收尾时，若出现可复用的内容（决策、约定、坑、可复用流程），追加到上表对应文件。
- 一行一条，带日期 \`YYYY-MM-DD\`。
- 不写原始对话过程、临时调试记录、代码里已经能看出的事实。
`;

const CONVENTIONS_TEMPLATE = `# 约定与偏好

## 回答风格

- 中文；先结论后依据；能验证就验证，验证不了说明卡在哪。

## 环境

- 在这里记录机器、版本、常用路径。

## 工具纪律

- 大改前先备份；破坏性操作先 dry-run。
`;

const SCAFFOLD = [
  ['INDEX.md', INDEX_TEMPLATE],
  ['conventions.md', CONVENTIONS_TEMPLATE],
  ['lessons', null],
  ['decisions', null],
  ['projects', null],
];

/** Create the missing pieces of a knowledge base without touching existing files. */
export async function ensureScaffold(root) {
  const created = [];
  const existed = [];
  await fs.mkdir(root, { recursive: true });
  for (const [rel, content] of SCAFFOLD) {
    const target = path.join(root, rel);
    if (content === null) {
      const already = await fs.stat(target).then((stat) => stat.isDirectory()).catch(() => false);
      if (already) {
        existed.push(`${rel}/`);
      } else {
        await fs.mkdir(target, { recursive: true });
        created.push(`${rel}/`);
      }
      continue;
    }
    const exists = await fs.stat(target).then((stat) => stat.isFile()).catch(() => false);
    if (exists) {
      existed.push(rel);
    } else {
      await fs.writeFile(target, content, 'utf8');
      created.push(rel);
    }
  }
  return { root, created, existed };
}

/** Every regular file under the root, relative and newest-first. */
export async function listFiles(root) {
  const out = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => undefined);
        if (stat === undefined) continue;
        out.push({ rel: path.relative(root, full), bytes: stat.size, mtime: stat.mtimeMs });
      }
    }
  }
  await walk(root);
  out.sort((left, right) => right.mtime - left.mtime);
  return out;
}

export async function readIndex(root) {
  return fs.readFile(path.join(root, 'INDEX.md'), 'utf8').catch(() => '');
}

/** Just the keyword table of INDEX.md — the part worth spending prompt tokens on. */
export function extractIndexSection(text, maxChars = 1200) {
  if (typeof text !== 'string' || text.trim().length === 0) return '';
  const lines = text.split('\n');
  const start = lines.findIndex((line) => /^##\s+.*(关键词|keyword)/iu.test(line));
  let block;
  if (start === -1) {
    block = lines.slice(0, 40).join('\n').trim();
  } else {
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (/^##\s+/u.test(lines[index])) {
        end = index;
        break;
      }
    }
    block = lines.slice(start, end).join('\n').trim();
  }
  return block.length > maxChars ? `${block.slice(0, maxChars).trimEnd()}\n…` : block;
}

/** The system-prompt block: where the knowledge base is, and how to use it. */
export async function promptBlock(root, maxChars = 1200) {
  const index = extractIndexSection(await readIndex(root), maxChars);
  const files = await listFiles(root);
  if (files.length === 0) return '';
  const listing = files
    .slice(0, 12)
    .map((file) => file.rel)
    .join('、');
  return [
    '## 共享知识库（dsh-shared-workspace-memory 自动注入）',
    `路径：${root}`,
    `现有文件：${listing}${files.length > 12 ? ` 等 ${files.length} 个` : ''}`,
    '',
    index,
    '',
    '使用规则：',
    '- 动手前先 `kb "<关键词>"`（终端）或 `kb_search` 工具；命中就读命中文件再回答。',
    '- 回答里用到了知识库，末尾写一行 `参考：knowledge/<相对路径>`。',
    '- 任务收尾时若有可复用结论，用 `kb_append` 追加一行（带日期）；主动提醒每个会话最多一次。',
    '- 知识库里没有的内容不要编：先说明「知识库里没有」，再说你从别处查或推测。',
  ].join('\n');
}

/**
 * Keeps the system-prompt block in step with the files on disk.
 *
 * `text()` must be synchronous because the Host assembles the prompt synchronously,
 * so it returns whatever was rendered last and re-renders in the background:
 *
 *   - `INDEX.md` mtime changed  -> re-render (keywords are what the prompt carries);
 *   - more than `maxAgeMs` since the last render -> re-render anyway, so a new file
 *     shows up in the "现有文件" line even though INDEX.md did not change.
 *
 * Checks are throttled to one `stat` per `minIntervalMs`, and concurrent calls share
 * a single in-flight render.
 */
export function createPromptCache({ root, maxChars = 1200, minIntervalMs = 1000, maxAgeMs = 30_000 }) {
  let text = '';
  let stamp = -1;
  let renderedAt = 0;
  let checkedAt = 0;
  let inflight;

  const indexMtime = () =>
    fs.stat(path.join(root, 'INDEX.md')).then((stat) => stat.mtimeMs).catch(() => 0);

  async function render() {
    text = await promptBlock(root, maxChars).catch(() => text);
    renderedAt = Date.now();
    return text;
  }

  async function refresh({ force = false } = {}) {
    if (inflight !== undefined) return inflight;
    const now = Date.now();
    if (!force && now - checkedAt < minIntervalMs) return text;
    checkedAt = now;
    inflight = (async () => {
      try {
        const mtime = await indexMtime();
        const stale = mtime !== stamp || now - renderedAt > maxAgeMs;
        if (force || stale) {
          stamp = mtime;
          return await render();
        }
        return text;
      } finally {
        inflight = undefined;
      }
    })();
    return inflight;
  }

  return {
    /** Synchronous value for the prompt section; kicks a background refresh. */
    text() {
      void refresh();
      return text;
    },
    /** Awaitable refresh, used at load time and by the tests. */
    refresh,
    peek() {
      return text;
    },
  };
}

/** Walk up a relative path and refuse anything that escapes the root. */
export function safeTarget(root, rel) {
  if (typeof rel !== 'string' || rel.trim().length === 0) throw new Error('missing file path');
  const target = path.resolve(root, rel);
  const normalizedRoot = path.resolve(root);
  if (target !== normalizedRoot && !target.startsWith(`${normalizedRoot}${path.sep}`)) {
    throw new Error(`path escapes the knowledge base: ${rel}`);
  }
  return target;
}

/** Case-insensitive substring search, several terms OR-ed together. */
export async function search(root, query, { limit = 30 } = {}) {
  const terms = String(query ?? '')
    .split(/\s+/u)
    .map((term) => term.trim().toLowerCase())
    .filter((term) => term.length > 0);
  if (terms.length === 0) return [];
  const hits = [];
  for (const file of await listFiles(root)) {
    if (!file.rel.toLowerCase().endsWith('.md')) continue;
    const text = await fs.readFile(path.join(root, file.rel), 'utf8').catch(() => '');
    if (text.length === 0) continue;
    const lines = text.split('\n');
    for (let index = 0; index < lines.length; index += 1) {
      const lower = lines[index].toLowerCase();
      if (!terms.some((term) => lower.includes(term))) continue;
      hits.push({ file: file.rel, line: index + 1, text: lines[index].trim().slice(0, 300) });
      if (hits.length >= limit) return hits;
    }
  }
  return hits;
}

export async function readMarkdown(root, rel) {
  const target = safeTarget(root, rel);
  const text = await fs.readFile(target, 'utf8').catch((error) => {
    if (error.code === 'ENOENT') throw new Error(`knowledge file not found: ${rel}`);
    throw error;
  });
  return { rel, text: text.length > MAX_READ_BYTES ? `${text.slice(0, MAX_READ_BYTES)}\n…` : text, bytes: text.length };
}

/** Append one dated line; creates the file (and its folder) when needed. */
export async function appendLine(root, rel, text, { date = today() } = {}) {
  const target = safeTarget(root, rel);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const body = String(text ?? '').trim();
  if (body.length === 0) throw new Error('refusing to append an empty line');
  const line = /^\d{4}-\d{2}-\d{2}/u.test(body) ? `- ${body}` : `- ${date} ${body}`;
  const existing = await fs.readFile(target, 'utf8').catch(() => '');
  const prefix = existing.length > 0 && !existing.endsWith('\n') ? '\n' : '';
  await fs.writeFile(target, `${existing}${prefix}${line}\n`, 'utf8');
  return { rel, line, bytes: Buffer.byteLength(line, 'utf8') };
}

/** Delete the knowledge *contents*, keeping the folder itself. */
export async function purge(root) {
  const removed = [];
  async function walk(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        await fs.rmdir(full).catch(() => undefined);
      } else {
        await fs.rm(full, { force: true });
        removed.push(path.relative(root, full));
      }
    }
  }
  await walk(root);
  return { root, removed };
}
