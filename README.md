# orca-mattpocock-workflow

Orca 插件：在右侧栏运行 [mattpocock/skills](https://github.com/mattpocock/skills) 工作流的工单面板。

工单的判定规则、triage 标签、提示词手势与流程说明都在本仓库内实现，
交互按 Orca 插件自身的能力边界设计。

## 视图

- **列表**：读当前工作区的工单，按「可接 / 阻塞 / 其他开放 / 已关闭」判定，支持状态过滤与多键排序；
  工具栏下方还有「分配给我 / 我创建的」两个人员开关，与状态筛选交叉生效，两个都开时取并集；
  可在**平铺**（默认）与**父子**两种布局间切换：父子模式把子票缩进挂在父票下，父行可折叠整棵子树并显示可见子票数；
  父票被筛掉或还没加载时，子票升到顶层并显示父级引用徽标；
  每张票给出技能动作徽标，点击「复制提示词」把 `/implement #40` 这类手势写进剪贴板；
  能开工的远端工单还有一个「建 worktree」动作，一次点击就建出 Orca 托管的 worktree。
- **概览**：一屏给出压力总览（规模 / 阻塞 / 时效）、关键数字、状态与分类构成、最该先看的票。
- **详情**：单张票的时间线、字段、原生阻塞关系。
- **环境检查**：逐项检查主目录、后端选择、Orca 命令行、CLI 安装与登录、仓库可达、工作区初始化、
  本地工单目录、面板用到的技能是否安装；失败项给对应原因的可执行修复方式。
- **流程帮助**：入池与 triage 状态机、需求链、缺陷链、访谈还是画图，以及实现之后的评审与 PR 流程图。

## 能力边界与取舍

Orca 插件的能力由宿主给定，下面是本插件在这些边界内给出的做法：

| 能力 | 本插件的做法 | 说明 |
|---|---|---|
| 提示词填进当前会话 | **复制提示词** | Orca 插件没有「写会话草稿」的能力；复制后由用户自己粘贴 |
| 提示词填进新会话 | 不提供 | Orca 的 `agent.launch` 只起终端型 agent，不构成会话草稿 |
| 注册运行时技能 `/mattwf-feature`、`/mattwf-bug` | 技能文件随插件分发，环境检查里一键安装 | Orca 插件不能贡献技能（`contributes.skills` 是保留点） |
| 插件私有 HTTP 路由 | 面板 ↔ worker 进程内桥（`orca.plugin.request`） | Orca 面板与 worker 同属一个插件，直接用桥 |
| 宿主数据根下的缓存目录 | `~/.orca-mattpocock-workflow/cache/` | Orca 没有对应数据根 |
| 浏览器 `localStorage` 记视图偏好 | `orca.storage` | 插件私有存储，按仓库记筛选、排序与人员开关 |
| 宿主 `subprocess` 服务 | worker 内 `node:child_process` | worker 是独立 Node 进程 |

「建 worktree」只走 Orca 自己的命令行（`orca worktree create`），不用裸 `git worktree`：
分支名按仓库约定从票推导（`feat/4-…` / `bugfix/1-…`），工单链接挂到新 worktree 上，
建完由 Orca 切到新工作区；同分支已有工作区时直接返回既有结果，不会重复创建。
自建 Gitea / GitHub 的 `/issues/<n>` 没有 Orca 认得的 provider 路由，不传 `--reference`，
工单链接改补进 `--comment`，仍然建出工作区；`/pull/<n>`、`/pulls/<n>` 与 GitLab 的
`/-/issues|merge_requests/<n>` 继续挂载。

判定语义统一为一套：可接 / 阻塞 / 已关闭、triage 标签（`needs-triage`、`wontfix`、`ready-for-human` …）、
`Blocked by:` 解析、GitLab 原生阻塞合并。

## 工作区怎么认

Orca 右侧栏是全局的，面板没有「当前会话的工作区」可用。worker 依次尝试：

1. 用户在面板顶部候选里显式选过的工作区（选择记在当前聚焦上下文里，也写进插件私有存储，
   worker 重启或面板重载后仍有效；只有聚焦上下文换了才失效）；
2. 聚焦工作区的显示名与工作区名精确匹配（忽略大小写与首尾空格），再退到仓库名匹配；
   空白显示名不参与匹配，显示名与分支同名时也不当作唯一线索——未命名工作区的显示名会退化成
   分支名，`main` 会被大量工作区共用；
3. 显示名重名时用分支收窄；
4. 仍重名时读终端标题里的工作目录（`~/path/to/repo` 也认），唯一命中即采用；
5. 还是认不出：面板顶部列出候选（项目 · 名称 · 分支 · 路径，每行一个「使用」动作），
   用户点一下就选定；同一份候选只推一次，失败不再周期性自动重试——只有聚焦上下文变化或
   用户主动刷新时才重新尝试。

worker 侧的 `workspace.readContext` 会带工作区 id（与 `workspace.list` 的 id 同源）：有 id 时
直接按 id 认领，「当前上下文」也按 id 识别，两个仓库的 `main` 不会混在一起。旧宿主不给 id 时，
才退回上面的规则，用显示名 + 分支识别上下文；那时两个同名同分支的工作区无法区分，显式选择也按
这个粒度记住。

## 工单后端

按 `origin` 远端自动选择，四种后端共用同一套判定与提示词：

- `github.com` → GitHub（`gh`）
- `gitlab.com` 或 `glab` 已登录的自建实例 → GitLab（`glab`），支持嵌套 group
- `tea` 已登录的自建 Gitea 实例 → Gitea（`tea`）
- 其余情况 → 本地 Markdown（`.scratch/<feature>/issues/*.md`）

远端后端在列表快照里带每张票的分配人登录名与当前登录用户：GitHub 在同一次 GraphQL 查询里
取 `viewer.login` 与 `assignees[].login`，GitLab / Gitea 的列表响应自带分配人、另发一次身份查询。
本地 Markdown 没有创建人与分配人，因此不显示人员筛选行。

本地快照库（`~/.orca-mattpocock-workflow/cache/`）保存当前用户与每张票的分配人；
格式版本已升到 3，旧版本条目按没有缓存处理，升级后第一次打开会全量重拉一次。
身份查询临时失败时沿用同一仓库上一次已知的身份，人员筛选不会因为一次抖动整行消失。

父子关系按后端能力取用，只用于列表布局，不改变判定、统计或写操作：

| 后端 | 父子来源 | 说明 |
|---|---|---|
| GitHub | 原生子工单 | 列表查询同时取父票；跨仓库父票保留 `owner/name#编号`，不误配同号票 |
| GitLab | 工作项层级 | 任务挂在工单下用 `#iid`；epic 只保留 `&iid` 引用，不画 epic 行；层级查询失败时父子模式禁用，刷新重试 |
| Gitea | 无 | 没有原生子工单，父子模式禁用并说明；平铺照常 |
| 本地 Markdown | `Parent:` 约定 | 只认同一 feature 下的工单；见下 |

本地 Markdown 工单的正文前言（`## Comments` 之前）支持这些行：

```
Status: ready-for-agent
Blocked by: 01, 03
Parent: 01
```

`Parent:` 取第一个数字，指向同一 feature 目录下的另一张工单；指向不存在的票、指向自己或跨
feature 时按无父级处理。评论里的 `Parent:` 不改变层级。增量刷新会把变更票引用的父票文件一并读入，
只改子文件也不会丢父级。

## 开发

用 Orca 命令行加载开发插件：

```bash
pnpm install      # 自动构建一次
pnpm typecheck
pnpm test
pnpm build        # 产物 dist/worker/main.mjs、dist/panel/panel.{html,js}

orca plugin dev load .    # 打印授权指纹，照抄它给的 --approve 命令重跑一次
orca plugin dev watch .   # 持续打印日志与重载；--shot ./shots --shot-panel tickets 存面板截图
```

改了 `src/` 要先 `pnpm build` 再 `orca plugin dev reload`，worker 跑的是 `dist/` 里的产物。
如果新增或改名了 RPC 处理器，`reload` 后仍报
`unknown_method: no panel handler named …`，说明还是旧 worker：用
`orca plugin dev unload . && orca plugin dev load .` 强制换一个 worker。
完整的开发流程——审批指纹、调试 worker 请求、造事件、看日志与截图——见
[docs/development.md](docs/development.md)。

清单指向 `dist/` 里的产物，`dist/` 不进版本库；克隆后 `pnpm install` 会自动构建一次，
发布前确认 `pnpm build` 通过。

装成本机正式插件（不再走 dev load）用文件夹安装：

```bash
pnpm build && pnpm run pack:plugin        # 产出 .orca/plugin-package
orca plugin dev unload .
orca plugin install .orca/plugin-package   # 首次按提示带 --approve <指纹>
```

仓库根不能直接装——`node_modules` 里的符号链接会被拒绝；细节与更新方式见
[docs/development.md](docs/development.md#装成本机正式插件)。

## 已知限制

- 提示词只能复制，不能直接写进会话：Orca 插件没有会话草稿接口。
- 入池技能（`mattwf-feature`、`mattwf-bug`）靠环境检查里的安装动作写进 agent 技能目录，
  插件本身不能注册运行时技能。
- 后端 CLI（`gh` / `glab` / `tea`）在 worker 进程里直接调用，走的是用户 PATH，
  不经过 Orca 自己的 CLI 解析与 WSL 回退。

## 许可证

MIT
