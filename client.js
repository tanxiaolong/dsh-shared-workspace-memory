/**
 * dsh-shared-workspace-memory — client half.
 *
 * One surface: Settings → Plugins → 共享知识库 (`plugins.row.config`, page view). It shows
 * where the knowledge base lives, what is in it, the injected index, whether the `kb`
 * command is installed — and the two cleanup paths, because a plugin should be able to
 * take back what it brought.
 *
 * Everything talks to the Host over the plugin's own JSON bridge
 * (`/api/dsh-shared-workspace-memory/...`), so nothing here depends on typert or on a live agent.
 */
window.__ModuleLoader__.load({
  id: 'dsh-shared-workspace-memory',
  factory: (require) => {
    const React = require('react');
    const h = React.createElement;

    const DEFAULT_BASE = '/api/dsh-shared-workspace-memory';

    /** The Host publishes its prefix as a boot global; fall back to the default path. */
    function bridgeBase() {
      const boot = globalThis.__DSH_KNOWLEDGE__;
      if (boot !== null && typeof boot === 'object' && typeof boot.prefix === 'string' && boot.prefix.length > 0) {
        return boot.prefix;
      }
      return DEFAULT_BASE;
    }

    /** One place that turns a network/HTTP failure into text worth showing the user. */
    async function fetchJson(path, options) {
      const url = bridgeBase() + path;
      let response;
      try {
        response = await fetch(url, {
          ...options,
          credentials: 'same-origin',
          signal: typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function'
            ? AbortSignal.timeout(15000)
            : undefined,
        });
      } catch (error) {
        throw new Error(`${url}: ${error?.message ?? error}`);
      }
      const text = await response.text();
      let body;
      try {
        body = JSON.parse(text);
      } catch {
        throw new Error(`${url}: HTTP ${response.status} ${text.slice(0, 160)}`);
      }
      if (!response.ok && body?.ok !== false) throw new Error(`${url}: HTTP ${response.status}`);
      return body;
    }
    const PLUGIN_PAGE_KEY = 'dsh-shared-workspace-memory#workspace-memory';
    const NS = 'knowledge';

    console.info('[dsh-shared-workspace-memory] client factory materialized');

    const zh = {
      title: '共享知识库',
      summary: '共享知识库',
      root: '知识库路径',
      files: '{count} 个文件',
      cli: 'kb 命令',
      cliInstalled: '已安装（{path}）',
      cliMissing: '未安装',
      index: '注入到系统提示词的索引',
      empty: '还没有文件。任务收尾时的结论会写到这里。',
      refresh: '刷新',
      reinstall: '重新安装 kb',
      cleanupTitle: '清理',
      cleanupHint: '卸载本插件前请先清理：插件会移除它安装的 kb 命令，并询问是否删除知识库内容。',
      cleanupCli: '只移除 kb 命令（保留知识库）',
      cleanupAll: '移除 kb 命令并删除知识库内容',
      cleanupConfirm: '这会删除知识库里的全部文件，确定吗？',
      cleanupYes: '确认删除',
      cleanupNo: '取消',
      done: '完成：{text}',
      error: '失败：{message}',
      loading: '读取中…',
      modified: '更新于 {time}',
    };
    const en = {
      title: 'Shared knowledge base',
      summary: 'Knowledge base',
      root: 'Knowledge base path',
      files: '{count} files',
      cli: 'kb command',
      cliInstalled: 'installed ({path})',
      cliMissing: 'not installed',
      index: 'Index injected into the system prompt',
      empty: 'No files yet. Conclusions written at the end of a task land here.',
      refresh: 'Refresh',
      reinstall: 'Reinstall kb',
      cleanupTitle: 'Cleanup',
      cleanupHint: 'Run cleanup before uninstalling: the plugin removes the kb command it installed, and asks whether to delete the knowledge content.',
      cleanupCli: 'Remove the kb command only (keep knowledge)',
      cleanupAll: 'Remove the kb command and delete knowledge content',
      cleanupConfirm: 'This deletes every file in the knowledge base. Continue?',
      cleanupYes: 'Delete',
      cleanupNo: 'Cancel',
      done: 'Done: {text}',
      error: 'Failed: {message}',
      loading: 'Loading…',
      modified: 'updated {time}',
    };

    function makeTranslator(ctx) {
      const language = typeof ctx.locale?.language === 'string' ? ctx.locale.language : 'zh';
      const table = language.toLowerCase().startsWith('en') ? en : zh;
      return (key, params) =>
        String(table[key] ?? key).replace(/\{(\w+)\}/gu, (_match, name) => (params && name in params ? String(params[name]) : `{${name}}`));
    }

    function token(name, fallback) {
      return `var(--dsw-alias-${name}, ${fallback})`;
    }

    const styles = {
      root: { padding: '16px 18px', fontSize: 13, lineHeight: 1.6, color: token('text-primary', 'inherit') },
      h1: { fontSize: 15, fontWeight: 600, margin: '0 0 4px' },
      hint: { opacity: 0.7, margin: '0 0 14px' },
      row: { display: 'flex', gap: 8, alignItems: 'baseline', margin: '2px 0' },
      label: { width: 132, opacity: 0.6, flex: '0 0 auto' },
      mono: { fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', fontSize: 11 },
      pre: {
        background: token('surface-raised', 'rgba(127,127,127,0.10)'),
        border: `1px solid ${token('border-subtle', 'rgba(127,127,127,0.25)')}`,
        borderRadius: 6,
        padding: 10,
        margin: '8px 0 14px',
        whiteSpace: 'pre-wrap',
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
        fontSize: 11,
        maxHeight: 220,
        overflow: 'auto',
      },
      button: {
        padding: '4px 10px',
        marginRight: 8,
        borderRadius: 6,
        border: `1px solid ${token('border-subtle', 'rgba(127,127,127,0.35)')}`,
        background: token('surface-raised', 'transparent'),
        color: 'inherit',
        fontSize: 12,
        cursor: 'pointer',
      },
      danger: {
        padding: '4px 10px',
        marginRight: 8,
        borderRadius: 6,
        border: `1px solid ${token('text-danger', '#d64545')}`,
        background: 'transparent',
        color: token('text-danger', '#d64545'),
        fontSize: 12,
        cursor: 'pointer',
      },
      section: { marginTop: 18, paddingTop: 14, borderTop: `1px solid ${token('border-subtle', 'rgba(127,127,127,0.2)')}` },
      message: { marginTop: 10, fontSize: 12, opacity: 0.85 },
    };

    function KnowledgePage(props) {
      // Identities matter: a fresh translator on every render would make `load` a new
      // function each time, re-fire the effect, and spin an endless fetch loop.
      const language = typeof props?.locale?.language === 'string' ? props.locale.language : 'zh';
      const t = React.useMemo(() => makeTranslator({ locale: { language } }), [language]);
      const started = React.useRef(false);
      const [state, setState] = React.useState({ loading: true, data: undefined, message: '', busy: false, confirmPurge: false });

      const load = React.useCallback(async () => {
        setState((current) => ({ ...current, loading: true }));
        try {
          const body = await fetchJson('/status');
          setState((current) => ({ ...current, loading: false, data: body?.value, message: body?.ok === false ? t('error', { message: body.text }) : '' }));
        } catch (error) {
          setState((current) => ({ ...current, loading: false, message: t('error', { message: error?.message ?? error }) }));
        }
      }, [t]);

      React.useEffect(() => {
        if (started.current) return;
        started.current = true;
        load();
      }, [load]);

      const call = async (path, payload) => {
        setState((current) => ({ ...current, busy: true, message: '' }));
        try {
          const body = await fetchJson(`/${path}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(payload ?? {}),
          });
          setState((current) => ({ ...current, busy: false, confirmPurge: false, message: body?.ok === false ? t('error', { message: body.text }) : t('done', { text: body.text }) }));
          await load();
        } catch (error) {
          setState((current) => ({ ...current, busy: false, message: t('error', { message: error?.message ?? error }) }));
        }
      };

      const data = state.data;
      const header = h('h1', { style: styles.h1 }, t('title'));
      const hint = h('p', { style: styles.hint }, '跨 workspace 共享；索引自动注入系统提示词，新会话不用提示就知道它存在。');

      if (state.loading && data === undefined) {
        return h('div', { style: styles.root }, header, h('div', null, t('loading')));
      }
      if (data === undefined) {
        return h('div', { style: styles.root }, header, h('div', { style: { color: token('text-danger', '#d64545') } }, state.message));
      }

      const cliLine = data.cli?.installed
        ? t('cliInstalled', { path: data.cli.path })
        : t('cliMissing') + (data.cli?.reason ? ` — ${data.cli.reason}` : '');

      const families = (data.files ?? []).reduce((groups, file) => {
        const dir = file.rel.includes('/') ? file.rel.split('/')[0] : '.';
        (groups[dir] ??= []).push(file);
        return groups;
      }, {});

      const fileBlocks = Object.keys(families)
        .sort()
        .map((dir) =>
          h(
            'div',
            { key: dir, style: { marginBottom: 6 } },
            h('div', { style: { fontWeight: 600, opacity: 0.8 } }, dir === '.' ? '根目录' : `${dir}/`),
            ...families[dir].map((file) =>
              h(
                'div',
                { key: file.rel, style: { ...styles.row, ...styles.mono } },
                h('span', null, file.rel),
                h('span', { style: { opacity: 0.5 } }, `${Math.round(file.bytes / 100) / 10} KB`),
              ),
            ),
          ),
        );

      return h(
        'div',
        { style: styles.root },
        header,
        hint,
        h('div', { style: styles.row }, h('span', { style: styles.label }, t('root')), h('span', { style: styles.mono }, data.root)),
        h('div', { style: styles.row }, h('span', { style: styles.label }, t('cli')), h('span', { style: styles.mono }, cliLine)),
        h('div', { style: styles.row }, h('span', { style: styles.label }, '文件'), h('span', null, t('files', { count: (data.files ?? []).length }))),
        h('div', { style: { marginTop: 10 } }, h('span', { style: styles.mono, ...styles.label }, `${t('index')} · ${data.promptChars ?? 0} 字符`)),
        h('pre', { style: styles.pre }, data.index || t('empty')),
        (data.files ?? []).length === 0 ? h('div', { style: { opacity: 0.7 } }, t('empty')) : fileBlocks,
        h(
          'div',
          { style: { marginTop: 12 } },
          h('button', { style: styles.button, disabled: state.busy, onClick: load }, t('refresh')),
          h('button', { style: styles.button, disabled: state.busy, onClick: () => call('reinstall-cli', { action: 'reinstall-cli' }) }, t('reinstall')),
        ),
        h(
          'div',
          { style: styles.section },
          h('div', { style: { fontWeight: 600 } }, t('cleanupTitle')),
          h('p', { style: { opacity: 0.7, margin: '4px 0 10px' } }, t('cleanupHint')),
          state.confirmPurge
            ? h(
                'div',
                null,
                h('div', { style: { color: token('text-danger', '#d64545'), marginBottom: 8 } }, t('cleanupConfirm')),
                h('button', { style: styles.danger, disabled: state.busy, onClick: () => call('cleanup', { action: 'cleanup', purgeKnowledge: true }) }, t('cleanupYes')),
                h('button', { style: styles.button, disabled: state.busy, onClick: () => setState((current) => ({ ...current, confirmPurge: false })) }, t('cleanupNo')),
              )
            : h(
                'div',
                null,
                h('button', { style: styles.button, disabled: state.busy, onClick: () => call('cleanup', { action: 'cleanup', purgeKnowledge: false }) }, t('cleanupCli')),
                h('button', { style: styles.danger, disabled: state.busy, onClick: () => setState((current) => ({ ...current, confirmPurge: true })) }, t('cleanupAll')),
              ),
        ),
        state.message.length > 0 ? h('div', { style: styles.message }, state.message) : null,
      );
    }

    function apply(ctx) {
      console.info('[dsh-shared-workspace-memory] client apply');

      // Every service touched below must be listed in `inject`; Cordis throws
      // `cannot get property "<name>" without inject` on any undeclared access.
      try {
        if (typeof ctx.locale?.register === 'function') ctx.locale.register(NS, { zh, en });
      } catch (error) {
        console.warn(`[dsh-shared-workspace-memory] locale registration failed: ${error?.message ?? error}`);
      }

      try {
        ctx.slots.inject('plugins.row.config', () =>
          ctx.slots.register(
            { name: 'plugins.row.config', key: PLUGIN_PAGE_KEY },
            ({ view }) => (view === 'summary' ? '共享知识库' : h(KnowledgePage)),
          ),
        );
      } catch (error) {
        // A missing slot must never take the whole web client down.
        console.warn(`[dsh-shared-workspace-memory] settings page not registered: ${error?.message ?? error}`);
      }
    }

    return {
      name: 'dsh-shared-workspace-memory',
      description: 'Shared knowledge base with an auto-injected index.',
      inject: ['slots', 'locale'],
      apply,
    };
  },
});
