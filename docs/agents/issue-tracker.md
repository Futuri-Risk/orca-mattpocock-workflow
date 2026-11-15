# 工单后端：GitHub

本仓库的 issue 与 spec 都住在 GitHub Issues：`cnzgray/orca-mattpocock-workflow`（私有）。
所有操作走 `gh` CLI；在克隆目录内运行时 `gh` 会自动推断仓库。

## 约定

- **建票**：`gh issue create --title "..." --body "..."`。多行正文用 heredoc。
- **读票**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列票**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，按需加 `--label` 与 `--state` 过滤。
- **把一张票挂成子票**：`gh issue create --parent <parent> ...`，或事后 `gh issue edit <parent> --add-sub-issue <child>`（`gh` 2.94+）。旧版 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`，其中 `<child-db-id>` 是子票的**数据库 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`），不是 `#number`，也不是 `node_id`。没有子票能力时，在子票正文顶部写 `Part of #<parent>`。
- **阻塞关系**：用 GitHub 原生 issue dependency，这是唯一在 UI 可见的规范表示。加边：`gh issue create --blocked-by <n>,<n> ...` 或 `gh issue edit <child> --add-blocked-by <blocker>`（`gh` 2.94+）。旧版 `gh`：`gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>`，`<blocker-db-id>` 是阻塞方的数据库 id。原生依赖不可用时退回在子票正文顶部写 `Blocked by: #<n>, #<n>`。**所有阻塞方都关闭**，这张票才算解锁。
- **数未关闭的阻塞方**：`gh api repos/<owner>/<repo>/issues/<n> --jq .issue_dependencies_summary.blocked_by`（只算未关闭的，`0` 即可以开工）。`gh issue view <n> --json blockedBy` 会把已关闭的也列出来，要自己过滤：`--jq '[.blockedBy.nodes[] | select(.state == "OPEN")] | length'`。
- **评论**：`gh issue comment <number> --body "..."`。
- **加/去标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`。
- **关闭**：先 `gh issue comment <number> --body "..."` 说明原因，再 `gh issue close <number>`。对已关闭的票执行 `gh issue close --comment` 会**丢掉**评论但仍以 0 退出，所以永远分两步。

仓库从 `git remote -v` 推断，在克隆目录内 `gh` 自动完成。

只往用户自己的仓库建票。**绝不要**往 `mattpocock/skills`（这些技能的来源仓库）建票，除非用户就是它的 owner。
`gh` 有可能默认指到别的仓库，所以每次会话第一次 `gh issue create` 之前，先用
`gh repo view --json nameWithOwner` 确认目标是 `cnzgray/orca-mattpocock-workflow`，不一致就问用户。

## 发布到工单后端

发布 spec 时先定目标票：如果用户给了票号或 URL，或对话里已经指明了某张票，就用
`gh issue edit <number> --body-file <path>` 就地更新，不要再建一张。发布 tickets 时，每张票默认新建一张 issue，除非它已经存在。

没有目标线索时，先在打开的 issue 里搜一遍有没有对得上的，问过用户再建。同一个 spec 绝不建第二张票。

## 取当前这张票

按上面的 **读票** 读。

## Wayfinding 操作

供 `/wayfinder` 使用。**map** 是一张 issue，**子票**是它的 child issue。

- **Map**：单张 issue，带 `wayfinder:map` 标签，正文放 Notes / Decisions-so-far / Fog。`gh issue create --label wayfinder:map`。
- **子票**：挂成 map 的 GitHub sub-issue（见 **把一张票挂成子票**）。子票能力不可用时，把子票加进 map 正文的 task list，并在子票正文顶部写 `Part of #<map>`。标签用 `wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。被认领后，票指派给驱动它的开发者。
- **阻塞**：见 **阻塞关系**。
- **Frontier 查询**：列出 map 所有未关闭子票（`gh issue list --state open`，范围限定在 map 的 sub-issues / task list），丢掉带未关闭阻塞方的（见 **数未关闭的阻塞方**，或 `Blocked by` 行里指向未关闭票的）和已有 assignee 的；按 map 顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`，这是本会话的第一次写操作。
- **结案**：`gh issue comment <n> --body "<答案>"`，然后 `gh issue close <n>`，再把一条上下文指针（摘要 + 链接）追加到 map 的 Decisions-so-far。

## 本仓库特有的约束

标签字符串是产品契约：`src/protocol/labels.ts` 的 `TRACKER_LABELS` 就是宿主与面板读取的那七个名字，
改标签名要同时改该文件、`docs/agents/triage-labels.md` 和 GitHub 上的标签，缺一处就会让面板判定失准。
