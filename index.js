/**
 * dsh-shared-workspace-memory — Host half.
 *
 * One knowledge base on disk (`~/work/knowledge` by default), exposed three ways so it
 * works without the user having to remember to ask for it:
 *
 *   - a system-prompt section carrying the INDEX keyword table, refreshed on every
 *     prompt assembly, so a new Session already knows the base exists;
 *   - `kb_*` tools (search / read / append) for precise reads and writes;
 *   - a `kb` shell command installed into a bin directory, plus a `/kb` session command
 *     and a small HTTP bridge that the Settings page talks to.
 *
 * The plugin owns what it installs: `kb` is written together with a manifest, and
 * `cleanup` (from `/kb cleanup`, the Settings page, or `kb --uninstall`) only removes a
 * file this plugin can prove it wrote. Knowledge content is never deleted unless the
 * caller explicitly asks for it.
 */

import path from 'node:path';

import { defineTool } from '@deepseek-ai/dsh-tools';

import * as kb from './lib/kb.js';
import { installCli, removeCli } from './lib/install.js';

export const name = 'dsh-shared-workspace-memory';
export const inject = ['tools', 'commands', 'webServer'];

const VERSION = '0.2.1';
const PREFIX = '/api/dsh-shared-workspace-memory';
const MAX_BODY = 256 * 1024;
const PROMPT_SECTION = 'knowledge-base';
const USAGE = 'status | search <关键词> | add <文件> <内容> | scaffold | cleanup [--purge]';

/* ------------------------------------------------------------- HTTP guards */

/** Reject cross-site and off-origin callers: these endpoints read and write files. */
function requestAllowed(request) {
  if (request.headers['sec-fetch-site'] === 'cross-site') return false;
  let host;
  try {
    host = new URL(`http://${request.headers.host}`);
  } catch {
    return false;
  }
  const origin = request.headers.origin;
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== host.host) return false;
    } catch {
      return false;
    }
  }
  const hostname = host.hostname;
  const loopback = hostname === 'localhost' || hostname === '::1' || hostname.startsWith('127.');
  if (!loopback) return true;
  const remote = request.socket?.remoteAddress;
  return typeof remote === 'string' && (remote === '::1' || remote === '::ffff:127.0.0.1' || remote.startsWith('127.'));
}

function sendJson(response, status, body) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
  response.end(JSON.stringify(body));
}

async function readJsonBody(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > MAX_BODY) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    return undefined;
  }
}

function resolveConfig(config = {}) {
  const home = kb.expandHome('~');
  return {
    root: kb.expandRoot(config.root),
    binDir: kb.expandHome(config.binDir) ?? path.join(home, '.local', 'bin'),
    maxIndexChars: Number.isFinite(config.maxIndexChars) && config.maxIndexChars > 200 ? config.maxIndexChars : 1200,
    injectIndex: config.injectIndex !== false,
    installCli: config.installCli !== false,
    order: Number.isFinite(config.order) ? config.order : 900,
  };
}

/* ------------------------------------------------------------------ plugin */

export function apply(ctx, config) {
  const cfg = resolveConfig(config ?? {});
  const state = { cli: undefined, scaffold: undefined };

  const prepared = (async () => {
    try {
      state.scaffold = await kb.ensureScaffold(cfg.root);
    } catch (error) {
      ctx.logger?.warn?.('dsh-shared-workspace-memory: could not prepare %s: %o', cfg.root, error);
    }
    if (cfg.installCli) {
      try {
        state.cli = await installCli({ binDir: cfg.binDir, source: new URL('./scripts/kb', import.meta.url), version: VERSION });
      } catch (error) {
        state.cli = { installed: false, path: path.join(cfg.binDir, 'kb'), reason: error?.message ?? String(error) };
      }
    } else {
      state.cli = { installed: false, path: path.join(cfg.binDir, 'kb'), reason: 'installCli is off in config' };
    }
    return state;
  })();
  prepared.catch(() => undefined);

  async function status() {
    await prepared;
    const files = await kb.listFiles(cfg.root);
    const index = kb.extractIndexSection(await kb.readIndex(cfg.root), cfg.maxIndexChars);
    const prompt = cfg.injectIndex ? await kb.promptBlock(cfg.root, cfg.maxIndexChars) : '';
    return {
      ok: true,
      text: `knowledge base ${cfg.root}: ${files.length} files`,
      value: {
        version: VERSION,
        root: cfg.root,
        binDir: cfg.binDir,
        files,
        cli: state.cli,
        scaffold: state.scaffold,
        index,
        promptChars: prompt.length,
        injectIndex: cfg.injectIndex,
      },
    };
  }

  async function run(args = {}) {
    const action = typeof args.action === 'string' && args.action.length > 0 ? args.action : 'status';
    try {
      switch (action) {
        case 'status':
          return await status();
        case 'search': {
          const hits = await kb.search(cfg.root, args.query, { limit: Math.min(Number(args.limit) || 30, 100) });
          return {
            ok: true,
            text: hits.length === 0 ? `no match: ${args.query}` : hits.map((hit) => `${hit.file}:${hit.line}: ${hit.text}`).join('\n'),
            value: { hits },
          };
        }
        case 'read': {
          const out = await kb.readMarkdown(cfg.root, args.file);
          return { ok: true, text: out.text, value: out };
        }
        case 'add': {
          const out = await kb.appendLine(cfg.root, args.file, args.text, args.date === true ? {} : { date: undefined });
          return { ok: true, text: `appended to ${out.rel}: ${out.line}`, value: out };
        }
        case 'scaffold': {
          const out = await kb.ensureScaffold(cfg.root);
          state.scaffold = out;
          return { ok: true, text: `${out.created.length} created, ${out.existed.length} already there`, value: out };
        }
        case 'reinstall-cli': {
          const out = await installCli({ binDir: cfg.binDir, source: new URL('./scripts/kb', import.meta.url), version: VERSION });
          state.cli = out;
          return { ok: out.installed === true, text: out.installed ? `installed ${out.path}` : `not installed: ${out.reason}`, value: out };
        }
        case 'cleanup': {
          const cli = await removeCli({ binDir: cfg.binDir });
          const purgeKnowledge = args.purgeKnowledge === true;
          const purged = purgeKnowledge ? await kb.purge(cfg.root) : undefined;
          const parts = [cli.removed ? `removed ${cli.path}` : `kb left in place: ${cli.reason}`];
          if (purged !== undefined) parts.push(`deleted ${purged.removed.length} knowledge files`);
          return { ok: true, text: parts.join('; '), value: { cli, purged } };
        }
        default:
          return { ok: false, text: `unknown action "${action}". usage: ${USAGE}` };
      }
    } catch (error) {
      return { ok: false, text: `${action} failed: ${error?.message ?? error}` };
    }
  }

  /* ---------------------------------------------------------- system prompt */

  if (cfg.injectIndex) {
    ctx.inject(['systemPrompt'], (scoped) =>
      scoped.effect(
        () =>
          scoped.systemPrompt.section({
            name: PROMPT_SECTION,
            order: cfg.order,
            interpolate: false,
            text: () => {
              try {
                return promptText;
              } catch {
                return '';
              }
            },
          }),
        'dsh-shared-workspace-memory: system prompt section',
      ),
    );
  }

  // Rendered once at load and refreshed lazily so edits show up on the next assembly.
  let promptText = '';
  let promptStamp = 0;
  const refreshPrompt = async () => {
    if (!cfg.injectIndex) return;
    const indexFile = path.join(cfg.root, 'INDEX.md');
    const { mtimeMs } = await import('node:fs/promises').then((fs) => fs.stat(indexFile).catch(() => ({ mtimeMs: 0 })));
    if (mtimeMs !== promptStamp) {
      promptText = await kb.promptBlock(cfg.root, cfg.maxIndexChars).catch(() => '');
      promptStamp = mtimeMs;
    }
  };
  prepared.then(refreshPrompt).catch(() => undefined);

  /* ----------------------------------------------------------------- tools */

  ctx.inject(['tools'], (scoped) =>
    scoped.effect(() => {
      const disposers = [];

      disposers.push(
        scoped.tools.register(
          defineTool({
            name: 'kb_search',
            description:
              'Search the shared knowledge base (cross-workspace notes: decisions, lessons, conventions, project background). Run this before answering questions about DSH internals, past mistakes, or earlier decisions.',
            parameters: {
              query: { type: 'string', required: true, description: 'Keywords, space separated (OR).' },
              limit: { type: 'number', description: 'Maximum matches, default 30.' },
            },
            output: {
              schema: { type: 'object', additionalProperties: true },
              render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
            },
            async execute(args) {
              const outcome = await run({ action: 'search', query: args?.query, limit: args?.limit });
              return { ok: outcome.ok, text: outcome.text };
            },
          }),
        ),
      );

      disposers.push(
        scoped.tools.register(
          defineTool({
            name: 'kb_read',
            description: 'Read one file from the shared knowledge base by its relative path (for example lessons/dsh-plugin-dev.md).',
            parameters: {
              file: { type: 'string', required: true, description: 'Path relative to the knowledge base root.' },
            },
            output: {
              schema: { type: 'object', additionalProperties: true },
              render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
            },
            async execute(args) {
              const outcome = await run({ action: 'read', file: args?.file });
              return { ok: outcome.ok, text: outcome.text };
            },
          }),
        ),
      );

      disposers.push(
        scoped.tools.register(
          defineTool({
            name: 'kb_append',
            description:
              'Append one dated line to a knowledge base file (conventions.md, lessons/<topic>.md, decisions/<YYYY-MM>.md, projects/<name>.md). Use it at the end of a task when a reusable conclusion appeared.',
            parameters: {
              file: { type: 'string', required: true, description: 'Path relative to the knowledge base root.' },
              text: { type: 'string', required: true, description: 'One line; the date is prepended when missing.' },
            },
            output: {
              schema: { type: 'object', additionalProperties: true },
              render: (_args, value) => [{ type: 'text', text: String(value?.text ?? '') }],
            },
            async execute(args) {
              const outcome = await run({ action: 'add', file: args?.file, text: args?.text });
              return { ok: outcome.ok, text: outcome.text };
            },
          }),
        ),
      );

      return () => {
        for (const dispose of disposers) if (typeof dispose === 'function') dispose();
      };
    }, 'dsh-shared-workspace-memory: tools'),
  );

  /* --------------------------------------------------------------- command */

  ctx.inject(['commands'], (scoped) =>
    scoped.effect(
      () =>
        scoped.commands.register({
          name: 'kb',
          description: `Shared knowledge base: ${USAGE}`,
          input: { hint: USAGE },
          handler: async (invocation) => {
            const tokens = String(invocation.rawInput ?? '')
              .trim()
              .split(/\s+/u)
              .filter((token) => token.length > 0);
            const flags = new Set(tokens.filter((token) => token.startsWith('--')));
            const positional = tokens.filter((token) => !token.startsWith('--'));
            const action = positional[0] ?? 'status';
            const outcome = await run({
              action,
              query: positional[1],
              file: positional[1],
              text: positional.slice(2).join(' '),
              purgeKnowledge: flags.has('--purge'),
            });
            return outcome.ok ? { kind: 'success', text: outcome.text } : { kind: 'error', text: outcome.text };
          },
        }),
      'dsh-shared-workspace-memory: command',
    ),
  );

  /* ---------------------------------------------------------------- bridge */

  const routes = [
    {
      kind: 'prefix',
      path: PREFIX,
      handler: async (request, response) => {
        if (!requestAllowed(request)) return sendJson(response, 403, { ok: false, text: 'forbidden' });
        const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`);
        const operation = url.pathname.slice(PREFIX.length).replace(/^\/+/u, '');
        if (request.method === 'GET') {
          if (operation === '' || operation === 'status') {
            const outcome = await status();
            return sendJson(response, 200, outcome);
          }
          if (operation === 'search') {
            const outcome = await run({ action: 'search', query: url.searchParams.get('q') ?? '' });
            return sendJson(response, outcome.ok ? 200 : 400, outcome);
          }
          return sendJson(response, 404, { ok: false, text: 'not found' });
        }
        if (request.method !== 'POST') return sendJson(response, 405, { ok: false, text: 'method not allowed' });
        const body = await readJsonBody(request);
        if (body === undefined || typeof body !== 'object') return sendJson(response, 400, { ok: false, text: 'invalid JSON body' });
        const outcome = await run({ ...body, action: typeof body.action === 'string' && body.action.length > 0 ? body.action : operation });
        return sendJson(response, outcome.ok ? 200 : 400, outcome);
      },
    },
  ];

  const registered = new Set();
  ctx.inject(['webServer'], (scoped) => {
    scoped.effect(() => {
      const disposers = [];
      for (const route of routes) {
        if (registered.has(route.path)) continue;
        registered.add(route.path);
        disposers.push(scoped.webServer.register(route));
      }
      return () => {
        for (const dispose of disposers) if (typeof dispose === 'function') dispose();
        registered.clear();
      };
    }, 'dsh-shared-workspace-memory: HTTP bridge');
  });
}
