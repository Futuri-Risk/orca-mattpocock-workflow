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

_避免_：把仓库作用域叫成「仓库根」「repo root」——那容易被理解成当前 worktree 的 git 顶层目录，
而附属 worktree 的顶层目录恰恰不是仓库作用域。
