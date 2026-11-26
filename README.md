# dsh-shared-workspace-memory

一个给 DSH 用的**跨 workspace 共享记忆/知识库**插件：知识库在磁盘上只有一个目录，每个会话的系统提示词里自动注入它的索引，所以新会话不用你提醒就知道"去查知识库"；同时装一个 `kb` 命令，终端里随时搜。

```
共享知识库（一个目录） ──┬── 系统提示词：自动注入关键词索引（每轮重算，改完即生效）
                       ├── kb 命令：终端检索，命中高亮
                       ├── kb_search / kb_read / kb_append：agent 工具
                       └── /kb 命令 + 设置页：状态、重装、清理
```

> 名字变更说明：`dsh-knowledge` → `dsh-shared-session-memory`（0.2.0）→ **`dsh-shared-workspace-memory`（0.2.1）**，每次改名都同步包名、cordis 行 id、HTTP 前缀、`kb` 清单名与 marker，并保留旧名常量以便旧版 `kb` 原地升级（见第 10 节）。它共享的是「跨 workspace 的知识与结论」，不是把会话历史搬来搬去。

---

## 1. 它会往你的机器上装什么

| 位置 | 内容 | 用途 |
|---|---|---|
| `~/work/knowledge/`（可配置） | `INDEX.md`、`conventions.md`、`lessons/`、`decisions/`、`projects/` | 知识库本体，纯 Markdown，没有数据库 |
| `~/.local/bin/kb`（可配置） | 一个 bash 脚本，约 2 KB | 终端检索命令 |
| `~/.local/bin/.dsh-shared-workspace-memory-kb.json` | 安装清单（含脚本 sha256、安装时间） | 证明 `kb` 是本插件装的，卸载时据此才敢删 |

**`kb` 是本插件新增的脚本文件，安装前请知悉。** 它只读知识库目录下的 Markdown 并打印命中行，不联网、不写别处。

安装时如果发现同名 `kb` 已被别的程序占用，**跳过并保留原文件**，只在状态里报 `a different kb command already exists`。

---

## 2. 安装

```bash
# 从 npm 安装（推荐）
plugin_manager install_bundle target=dsh-shared-workspace-memory

# 或者指定版本
plugin_manager install_bundle target=dsh-shared-workspace-memory@0.2.2

# 本地目录安装（开发态）
plugin_manager install_bundle target=file:/path/to/dsh-shared-workspace-memory
```

安装后：

- 包被复制进
  `~/Library/Application Support/dsh-desktop/harness/profiles/.generations/live/dsh-shared-workspace-memory+<ver>+<hash>/node_modules/dsh-shared-workspace-memory`，
  `profiles/desktop/node_modules/dsh-shared-workspace-memory` 是指向它的符号链接；
- 宿主半（`index.js`）**热加载**，不需要重启；
- 浏览器半（`client.js`）由 Host 扫描 `package.json` 的 `dsh.client` 自动发现，刷新页面即可看到设置页。

包的 `dsh` 声明：

```json
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": { "platform": "web", "immediately": true, "inject": ["@deepseek-ai/dsh-api-remotes", "@deepseek-ai/dsh-client-locale", "@deepseek-ai/dsh-client-ui-plugin-manager"] }
}
```

---

## 3. 使用

```bash
kb                      # 列出知识库所有文件
kb 帧 压缩               # 检索，多个词 OR；终端里命中处高亮
kb --path               # 打印知识库路径
kb --version            # kb 0.2.2
kb --uninstall          # 只删 kb 命令本身（保留知识库）
kb --uninstall --purge  # 连知识库内容一起删（要求输入 yes 确认）
```

会话内：

- `/kb status`、`/kb search <关键词>`、`/kb add <文件> <内容>`、`/kb scaffold`、`/kb cleanup [--purge]`
- 工具 `kb_search` / `kb_read` / `kb_append`
- 设置 → 插件 → 共享知识库：看路径、kb 状态、文件分组、注入字符数；按钮「刷新 / 重新安装 kb」；清理区两个入口

`kb` 的输出在终端（stdout 是 tty）时用 `grep --color=always` 高亮；被管道或重定向时自动去色，方便 agent 解析。

---

## 4. 自动注入的是什么

每次组装系统提示词时：

1. 读 `INDEX.md` 里的 **「关键词索引」** 小节（没有就退回前 40 行）；
2. 截断到 `maxIndexChars`；
3. 拼上路径、文件清单和四条使用规则，作为 `knowledge-base` 段（`order: 900`）注入。

`text()` 必须同步返回，所以它给出的是**上一次渲染的结果**，同时在后台检查一次：

- `INDEX.md` 的 mtime 变了 → 重算（关键词表是注入的主体）；
- 距上次渲染超过 30 秒 → 也重算一次，这样**新增文件**即使没动 `INDEX.md` 也会出现在「现有文件」那行里；
- 检查被节流到每 1 秒最多一次 `stat`，并且并发调用共用同一次渲染。

效果：改完 `INDEX.md` 或加一个新文件，**下一轮对话就生效，不需要重启**（0.2.2 起；0.2.1 及更早是进程内冻结的，只能重启）。

注入的段落长这样（节选）：

```
## 共享知识库（dsh-shared-workspace-memory 自动注入）
路径：<你的知识库绝对路径>（默认 ~/work/knowledge）
现有文件：INDEX.md、conventions.md、lessons/…、decisions/…、projects/…
| 关键词 | 去哪份文件 |
...
检索命令：grep -rl "<关键词>" ~/work/knowledge
```

---

## 5. 我们验证过什么（都是真跑出来的）

| 验证项 | 命令 / 方法 | 结果 |
|---|---|---|
| 自动注入端到端 | 新起一个干净 subagent，只让它读自己的系统提示词 | 逐字引用了 `## 共享知识库（… 自动注入）`、知识库路径与 9 个文件；确认工具表里有 `kb_search`/`kb_read`/`kb_append` |
| kb 由插件安装 | `kb --version` / `ls -l ~/.local/bin/kb` | `kb 0.2.1`；脚本由插件写入，清单 `.dsh-shared-workspace-memory-kb.json` 存在 |
| 高亮 | `script -q /dev/null kb 首帧 \| cat -v` | 命中处出现 `^[[01;31m`…`^[[m`（4 对），管道输出无颜色 |
| HTTP 桥 | `curl -s http://127.0.0.1:<gui-port>/api/dsh-shared-workspace-memory/status` | `200`，返回 root、文件数、kb 状态 |
| 单元测试 | `node --test test/kb.test.mjs` | `pass 9 / fail 0`（脚手架幂等、日期追加、索引节提取、promptBlock、safeTarget 拒绝越界、purge、CLI 安装、外来 kb 不删除、模板不含本机信息） |

---

## 6. 卸载：你带来的，你带走

插件**不修改** `session`、不改 `workspace.json`、不碰 DSH 自己的文件。清理有三个入口，都会**先问是否保留知识内容**：

1. **设置页**：设置 → 插件 → 共享知识库 → 清理
   - 「只移除 kb 命令（保留知识库）」
   - 「移除 kb 命令并删除知识库内容」（二次确认后才 `purgeKnowledge: true`）
2. **`/kb cleanup`**（加 `--purge` 连内容一起删）
3. **终端**：`kb --uninstall` / `kb --uninstall --purge`

细节：

- 删 `kb` 前会校验清单里的 marker 与 sha256 —— **不是本插件写的 `kb` 一律不动**；
- 改名前留下的旧清单 `.dsh-knowledge-kb.json` 会在重装时自动清掉；
- 漏做也没关系：`plugin_manager remove_bundle dsh-shared-workspace-memory` 只删包本身，`kb` 脚本还在，之后随时可以 `kb --uninstall`；
- 卸载后想留个记录：`purge` 只删 `root` 目录下的内容，**不会**删目录本身。

---

## 7. 配置

```yaml
- insert:
    - id: memory
      name: dsh-shared-workspace-memory
      config:
        root: ~/work/knowledge     # 知识库目录
        binDir: ~/.local/bin       # kb 安装目录
        injectIndex: true          # 是否注入系统提示词
        installCli: true           # 是否安装 kb 命令
        maxIndexChars: 1200        # 注入索引的字符上限
        order: 900                 # 提示词段顺序
        harnessRoot: null          # 一般不用填，默认 $DSH_HOME 或应用支持目录
```

默认值即上面所示；`~` 会展开成你的 home。

---

## 8. 排错

| 现象 | 先查 |
|---|---|
| 新会话里看不到注入段 | 会话内 `/kb status` 看 `injectIndex` 与字符数（命令行 `curl` 会因缺登录 cookie 返回 401）；再确认 `INDEX.md` 有「关键词索引」小节 |
| 注入段在，但 agent 不查 | 看系统提示里那段的使用规则是否被别的指令覆盖；`kb_search` 工具是否出现在工具表 |
| `kb: command not found` | `echo $PATH` 是否含 `~/.local/bin`；或设置页点「重新安装 kb」 |
| 终端不显示颜色 | 只有 tty 才高亮，`kb x \| cat` 是刻意去色的 |
| 设置页打不开 | 页面 key 是 `<包名>#<cordis.patch.yml 的 id>`，即 `dsh-shared-workspace-memory#workspace-memory` —— 三者任一改了都要同步 |
| bridge 返回 401 | 被 **DSH 准入**拦下：请求没有登录 cookie（`curl`、隐身窗口、别的站点发起）。从 DSH 界面里访问；命令行请用 `/kb status` |
| bridge 返回 403 | Host/Origin 围栏或本插件同源校验拦下：跨站 fetch、`Origin` 与 `Host` 不一致、或非 loopback 来源 |
| bridge 返回 404 | 路径前缀不对（`/api/dsh-shared-workspace-memory`），或插件未启用 |

---

## 9. 数据访问声明

- **读**：`root` 下的 Markdown；`binDir` 下自己的清单。
- **写**：`root` 下缺失的脚手架文件；`kb_append` 追加的行；`binDir` 下的 `kb` 与清单。**仅此。**
- **网络**：无出网请求。HTTP 路由挂在 Host 已有的本地端口上，**先过 DSH 自己的准入**（见下），再叠加本插件的同源/loopback 校验。
- **不**读写其它 workspace 的文件，不触碰 DSH 的会话日志、`workspace.json`、投影缓存。

### HTTP 路由的访问控制

`webServer.register` 本身不带准入——文档原话是「the caller admits the reader before reading」。所以每个 handler **第一件事**是问 DSH：

```js
const rejection = ctx.get('connection')?.requestRejection(request);
if (rejection !== undefined) { response.statusCode = rejection; response.end(); return; }
```

| 情况 | 结果 |
|---|---|
| Host/Origin 围栏不过（DNS rebinding、浏览器跨站调用） | `403` |
| 没有 DSH 登录 cookie，也没有附带的 API token | `401` |
| 放行 | 继续走插件自己的同源 + loopback 校验 |

`connection` 只在 Web 组装里存在；TUI 等没有 HTTP 服务的组装里这层自动跳过（用 `ctx.get('connection')` 探测，不写进 `inject`，否则非 Web 组装会加载失败），插件自己的校验仍然生效。判定过程抛错时按 `401` 失败关闭。

---

## 10. 包内没有你的本机信息

插件**发布出去的部分**（`index.js` / `client.js` / `lib/` / `scripts/kb` / `locale/` / `cordis.patch.yml`）不含任何本机路径、用户名或 workspace 名；`lib/kb.js` 里生成 `INDEX.md`、`conventions.md` 的模板也是通用文案（用 `projects/<项目>.md` 这类占位符）。单测 `shipped scaffold templates carry no machine-specific paths or workspace names` 会检查这一点，防止以后手滑把本机信息写进模板。

属于**你本机数据**、不会被这个包带走的是：

| 位置 | 内容 | 会不会被注入到别的机器 |
|---|---|---|
| `~/work/knowledge/**` | 你的知识库正文与 `INDEX.md` 索引 | 不会。root 由本机配置决定，包本身不带内容 |
| `$DSH_HOME/AGENTS.md` | 工作区地图、沉淀协议 | 不会。那是本机的全局指令 |
| `~/.local/bin/kb` | 安装出来的脚本 | 不会。安装清单随包安装时重写 |

一条实用建议：`INDEX.md` 的「关键词索引」会被整段注入到本机每个会话，所以**别在那里写本机专属的绝对路径或 workspace 名单**——用 `~/work/knowledge` 这类写法，工作区清单留在 `$DSH_HOME/AGENTS.md`。

## 11. 改名时要注意的联动点

这次从 `dsh-knowledge` 改成 `dsh-shared-workspace-memory`，实际动了 6 个地方，改包名时照抄：

1. `package.json` 的 `name`（浏览器半的 `__ModuleLoader__.load({ id })` 必须**逐字**相等）；
2. `cordis.patch.yml` 的 `name`（模块名）与 `id`（行 id）；
3. `client.js` 的 `PLUGIN_PAGE_KEY`（`<包名>#<行 id>`）与 `BASE`（HTTP 前缀）；
4. `index.js` 的 `PREFIX`、`export const name`；
5. `lib/install.js` 的 `MANIFEST_NAME` / `MARKER` / `plugin` 字段（并把旧清单名加进 `LEGACY_MANIFEST_NAMES`）；
6. `scripts/kb` 里的注释与清单路径。

改完重新 `install_bundle` 会生成新 generation；旧包记得 `remove_bundle`，否则会同时装两个、注入两遍。更要紧的是：**新旧两代不要共用同一个 cordis 行 id**，否则旧行禁用/新行启用会互相顶掉；改名时顺带换 id（`memory` → `workspace-memory`）。

---

## 12. 已知限制

- 知识库内容不做自动提炼：写什么仍由人/agent 判断（频次受全局 `AGENTS.md` 约束：每会话最多主动提醒一次）。
- 注入的是**索引摘要**，具体内容仍需 `kb_read` 读文件。
- `INDEX.md` 很大时索引会占 token，用 `maxIndexChars` 控制。
- 只支持 Markdown；不支持 PDF/图片检索。
- 注入的是**索引**，`INDEX.md` 写得过长会被截断，正文永远靠工具/命令读。

---

## 13. 变更记录

### 0.2.3

- **接入 DSH 准入**：新增 `lib/admission.js`，每个 bridge handler 先调用 `connection.requestRejection(request)`，未通过直接回 `401`/`403`；插件自带的同源 + loopback 校验保留为第二层。
- **收紧 `engines.dsh`**：原来是 `>=0.14.0`——那是 Desktop 应用版本号，对内核等于没有约束；改为 `>=0.2.2-rc.1`，即准入 API 所在的内核版本（Desktop 0.14.0 内置的正是 `0.2.2-rc.1`）。
- 新增 9 条准入单测（`test/admission.test.mjs`），总计 21/21 通过。

### 0.2.2

- **修复启动崩溃**：`client.js` 现在导出 `inject: ['slots', 'locale']`。此前它直接访问 `ctx.slots` 却未声明注入，Cordis 会抛 `cannot get property "slots" without inject`，整个 Web 客户端在启动阶段崩溃（表现为桌面端「The desktop host stopped」）。注册失败现在也只警告，不再影响启动。
- **修复注入块冻结**：`lib/kb.js` 新增 `createPromptCache`，`text()` 每次返回上次渲染结果并在后台检查 `INDEX.md` 的 mtime 与 30 秒时效，改动或新增文件后下一轮即可见，不必重启。


| 版本 | 变更 |
|---|---|
| 0.2.3 | 接入 DSH 准入（`connection.requestRejection`），收紧 `engines.dsh`；准入单测 9 条（21/21） |
| 0.2.2 | 修复注入块「进程内冻结」：`text()` 现在会后台刷新（INDEX.md mtime + 最长 30 秒兜底），改完下一轮生效；新增两条缓存单测（11/11） |
| 0.2.1 | 改名 `dsh-shared-session-memory` → `dsh-shared-workspace-memory`，cordis 行 id 改为 `workspace-memory`；`INDEX.md` 去掉本机 workspace 名与绝对路径 |
| 0.2.0 | 首次改名为 `dsh-shared-session-memory`；README 重写；旧 `kb` 清单/marker 兼容升级 |
| 0.1.0 | 首个可安装版本（当时叫 `dsh-knowledge`） |

MIT License.