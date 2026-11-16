# 术语表

本仓库的领域术语。文档、issue、测试名里出现这些概念时用这里的词。

## 仓库作用域

一个仓库的主 worktree 根目录，作为工单缓存的**仓库级身份**。

- 取 `git worktree list --porcelain` 输出里第一条仍然存在的 `worktree <path>`；
  主 worktree 目录被删掉时顺延到下一条存在的。
- 解析失败（不是 git 仓库、没装 git、输出不可解析）时退回当前工作区根目录。
- 托管后端（GitHub / GitLab / Gitea）的本地快照库条目、内存快照、首屏去重、增量链与后端解析结果
  都按它归并：同一仓库的多个 worktree 共用一份。
- 它只是缓存身份，不是命令位置：git / gh / glab / tea 仍然在当前工作区里跑。

代码：`src/core/repository-scope.ts`（纯解析与缓存键）、`src/worker/repository-scope.ts`（跑命令）。
引入于 #7。

## 工作区作用域

当前工作区根目录（面板请求里的 `workspaceRoot`），作为**本地 Markdown 后端**的缓存身份。

- 本地 Markdown 的「仓库」就是当前工作区里的 `.scratch/` 目录树，天然是工作区本地的；
  按工作区隔离，一个 worktree 的本地工单不会串到另一个。
- 非 git 目录里，仓库作用域退回工作区根目录，两者是同一份缓存。

缓存键的选择只写在一处：`storeKeyOf`（托管后端用仓库作用域，本地 Markdown 用工作区作用域）。
引入于 #7。

面板的视图偏好（筛选、排序键、方向与两个人员开关）走同一条规则，但面板拿不到仓库作用域，
用快照里的仓库身份代替：`viewPreferenceKey`（`src/panel/view-preference.ts`）。

_避免_：把仓库作用域叫成「仓库根」「repo root」——那容易被理解成当前 worktree 的 git 顶层目录，
而附属 worktree 的顶层目录恰恰不是仓库作用域。

## 当前用户（viewer）

列表快照里的当前登录用户：远端后端是 GitHub GraphQL 的 `viewer.login`、GitLab 的
`glab api user` 的 `username`、Gitea 的 `tea api /user` 的 `login`；本地 Markdown 没有远端用户，
恒为 `null`。

- 存在快照的 `viewer` 字段与本地快照库条目里，只保存登录名；
- 身份查询失败时不当作列表失败，只把 `viewer` 记为 `null`（全量）或省略（增量，沿用上一次）；
- 全量刷新返回 `null` 但同一仓库有上一次已知身份时沿用上次，避免一次抖动让人员筛选整行消失；
- 界面用它在筛选行显示 `@登录名`，并做大小写不敏感的匹配。

代码：`src/core/ticket.ts`（`TrackerSnapshot.viewer`）、`src/protocol/tracker.ts`
（`WorkspaceSnapshot.viewer`）。

## 人员筛选

列表视图里的两个独立开关：「分配给我」与「我创建的」。数据来自快照里的当前用户与每张票的
分配人登录名；匹配只在 `src/panel/ticket-view.ts` 的展示逻辑里实现一次。

- 两个都关：不按人员过滤；只开一个：只看对应角色；两个都开：取并集（分配给我 ∪ 我创建的）；
- 与状态筛选交叉生效，顺序固定为状态过滤 → 人员过滤 → 排序；
- 计数按当前状态筛选后的集合计算，两个角色互不影响；状态分段与统计仍基于整份快照；
- 登录名比较不区分大小写；创建人为 `null`（本地 Markdown、被匿名）不算「我创建的」；
- 当前用户为 `null` 时整行不渲染，已保存的开关保留，等身份恢复后重新生效。

分配人在列表快照里只存远端登录名（`Ticket.assignees` / `TicketSnapshot.assignees`），
不存展示名与头像；详情里的结构化 `TicketAuthor` 分配人不变。详情里改分配人后，列表快照不会立即
写回（`assignSelf` 需要再查一次当前用户），由下一次刷新拉齐；这期间人员筛选可能仍按旧分配人判断。
