# orca-mattpocock-workflow

Orca 插件：在右侧栏运行 [mattpocock/skills](https://github.com/mattpocock/skills) 工作流的工单面板。

移植自 DSH 宿主插件 [`dsh-mattpocock-workflow`](https://github.com/mattpocock/skills) 的同源实现，
宿主从 DSH 换成 Orca，交互按 Orca 的能力做了取舍。

## 视图

- **列表**：读当前工作区的工单，按「可接 / 阻塞 / 其他开放 / 已关闭」判定，支持状态过滤与多键排序；
  每张票给出技能动作徽标，点击「复制提示词」把 `/implement #40` 这类手势写进剪贴板。
- **概览**：一屏给出压力总览（规模 / 阻塞 / 时效）、关键数字、状态与分类构成、最该先看的票。
- **详情**：单张票的时间线、字段、原生阻塞关系。
- **环境检查**：逐项检查主目录、后端选择、CLI 安装与登录、仓库可达、工作区初始化、本地工单目录、
  面板用到的技能是否安装；失败项给对应原因的可执行修复方式。
- **流程帮助**：入池与 triage 状态机、需求链与缺陷链的流程图。

## 与 DSH 版本的差异

| DSH | Orca | 说明 |
|---|---|---|
| 提示词填进当前会话 | **复制提示词** | Orca 插件没有「写会话草稿」的能力；复制后由用户自己粘贴 |
| 提示词填进新会话 | 无 | Orca 的 `agent.launch` 只起终端型 agent，不构成会话草稿；不提供 |
| 插件注册运行时技能 `/mattwf-feature`、`/mattwf-bug` | 技能文件随插件分发，环境检查里一键安装 | Orca 插件不能贡献技能（`contributes.skills` 是保留点） |
| 插件私有 HTTP 路由 | 面板 ↔ worker 进程内桥（`orca.plugin.request`） | Orca 面板与 worker 同属一个插件，直接用桥 |
| `$DSH_HOME/cache/...` | `~/.orca-mattpocock-workflow/cache/` | Orca 没有对应数据根 |
| 浏览器 `localStorage` 记视图偏好 | `orca.storage` | 插件私有存储，按工作区记 |
| 宿主 `subprocess` 服务 | worker 内 `node:child_process` | worker 是独立 Node 进程 |

判定语义不变：可接 / 阻塞 / 已关闭、triage 标签（`needs-triage`、`wontfix`、`ready-for-human` …）、
`Blocked by:` 解析、GitLab 原生阻塞合并，全部沿用原实现。

## 工作区怎么认

Orca 右侧栏是全局的，面板没有「当前会话的工作区」可用。worker 依次尝试：

1. 聚焦工作区的显示名与工作区名精确匹配（忽略大小写与首尾空格），再退到仓库名匹配；
2. 显示名重名时用分支收窄；
3. 仍重名时读终端标题里的工作目录（`~/path/to/repo` 也认），唯一命中即采用；
4. 还是认不出：面板顶部列出候选，用户选一个；选择会作为 `workspaceRoot` 带回 worker。

## 工单后端

按 `origin` 远端自动选择，四种后端共用同一套判定与提示词：

- `github.com` → GitHub（`gh`）
- `gitlab.com` 或 `glab` 已登录的自建实例 → GitLab（`glab`），支持嵌套 group
- `tea` 已登录的自建 Gitea 实例 → Gitea（`tea`）
- 其余情况 → 本地 Markdown（`.scratch/<feature>/issues/*.md`）

## 开发

```bash
pnpm install
pnpm typecheck
pnpm test
pnpm build          # 产物 dist/worker/main.mjs、dist/panel/panel.{html,js}
orca plugin dev load <本目录>
```

开发时改代码后重新 `pnpm build`，再 `orca plugin dev reload` 让 worker 重启。

面板截图：`orca plugin dev watch . --shot ./shots --shot-panel tickets`。

清单指向 `dist/` 里的产物，`dist/` 不进版本库；克隆后 `pnpm install` 会自动构建一次，
发布前确认 `pnpm build` 通过。

## 已知限制

- 提示词只能复制，不能直接写进会话：Orca 插件没有会话草稿接口。
- 入池技能（`mattwf-feature`、`mattwf-bug`）靠环境检查里的安装动作写进 agent 技能目录，
  插件本身不能注册运行时技能。
- 后端 CLI（`gh` / `glab` / `tea`）在 worker 进程里直接调用，走的是用户 PATH，
  不经过 Orca 自己的 CLI 解析与 WSL 回退。

## 许可证

MIT
