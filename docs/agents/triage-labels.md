# Triage 标签

Triage 按**角色**说话，这张表把角色映射到本仓库工单后端里真实使用的标签字符串。
两类角色都要覆盖：五个**状态角色**（一张票在 triage 状态机里的位置），和两个**分类角色**
（每张 triaged 的票恰好带一个）。

| 规范角色                   | 本仓库的标签          | 含义                       |
| -------------------------- | --------------------- | -------------------------- |
| `needs-triage`             | `needs-triage`        | 维护者需要先评估、定性     |
| `needs-info`               | `needs-info`          | 等待报告人补充信息         |
| `ready-for-agent`          | `ready-for-agent`     | 规格完整，可直接交给 agent |
| `ready-for-human`          | `ready-for-human`     | 需要人工实现               |
| `wontfix`                  | `wontfix`             | 决定不做                   |

| 规范角色                   | 本仓库的标签          | 含义                               |
| -------------------------- | --------------------- | ---------------------------------- |
| `bug`                      | `bug`                 | 分类角色，每张 triaged 票恰好一个  |
| `enhancement`              | `enhancement`         | 分类角色，每张 triaged 票恰好一个  |

提到某个角色时（例如「打上可交给 agent 的 triage 标签」），就取表里对应的标签字符串，不要另造名字。

## 与代码的一致性

这些字符串是产品契约，不是随手写的文档：

- `src/protocol/labels.ts` 的 `TRACKER_LABELS` 持有同一组名字，宿主与面板都按它判定；
- GitHub 上必须存在同名标签，`to-tickets` 发布会直接 `--add-label`。

三处（本表、`labels.ts`、GitHub labels）必须同时改。改完跑 `pnpm typecheck && pnpm test`，
`src/core` 与 `src/adapters/*` 的判定用例会暴露漏改的地方。

本仓库沿用默认名，所以「Label in our tracker」一列暂不需要覆盖值；若将来后端改用
`bug:triage` 这类既有命名，只改中间一列，其余文档不必动。
