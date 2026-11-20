English | [简体中文](GLOSSARY.zh-CN.md)

# Glossary

Domain terms used in this repository. When docs, issues or test names use these concepts, use the
words defined here.

## Repository scope

The root directory of a repository's main worktree, used as the **repository-level identity** for
ticket caches.

- Read the first surviving `worktree <path>` line from `git worktree list --porcelain`; when the main
  worktree directory has been deleted, fall through to the next surviving one.
- When resolution fails (not a git repository, git missing, unparsable output), fall back to the
  current workspace root.
- Managed backends (GitHub / GitLab / Gitea) group local snapshot-store entries, in-memory snapshots,
  first-screen deduplication, incremental chains and backend resolution results by this identity:
  multiple worktrees of the same repository share one copy.
- It is a cache identity, not a command location: git / gh / glab / tea still run in the current
  workspace.

Code: `src/core/repository-scope.ts` (pure parsing and cache keys), `src/worker/repository-scope.ts`
(runs the command). Introduced in #7.

## Workspace scope

The current workspace root (the `workspaceRoot` in panel requests), used as the **cache identity**
for the local Markdown backend.

- The local Markdown "repository" is the `.scratch/` directory tree inside the current workspace, so
  it is naturally workspace-local. It is isolated per workspace: a ticket in one worktree never leaks
  into another.
- In a non-git directory, repository scope falls back to the workspace root, so both scopes are the
  same cache.

The cache-key choice lives in one place: `storeKeyOf` (managed backends use repository scope, local
Markdown uses workspace scope). Introduced in #7.

The panel's view preference (filter, sort key, direction, the two people toggles, the two row-detail
toggles and layout) follows the same rule, but the panel cannot see repository scope, so it uses the
repository identity from the snapshot instead: `viewPreferenceKey` (`src/panel/view-preference.ts`).

_Avoid_: calling repository scope "repository root" or "repo root" — that reads as the git top-level
directory of the current worktree, and an attached worktree's top-level directory is exactly not the
repository scope.

## Local snapshot library

The on-disk cache that keeps the last successfully fetched raw ticket data for a cache key across
process restarts.

- One cache key = one directory: `meta.json` is the commit point, `tickets/<hash>.json` holds one
  ticket per file, and `changes.jsonl` is an append-only change log delimited by store revision.
- A write always commits in the order "ticket files → change log → meta". The meta file is written
  last and the read path resolves only the ticket refs it names, so a crash never exposes half a
  batch. Orphan ticket files are removed by the next write.
- Deletion uses tombstones instead of physically removing rows: a tombstone only says "not present
  in this version", and is cleared when the ticket reappears.
- Only raw backend data and overview metrics computed at write time are stored; readiness, blocking
  and skill-action decisions are not.
- Single-writer assumption; no file locking for concurrent writes from multiple host processes yet.
- Entries older than 30 days, or whose repository directory is gone, are pruned at startup; at most
  20 repositories are kept.
- The format version is `SNAPSHOT_STORE_VERSION`; entries with another version are treated as "no
  cache", with no migration.

Code: `src/adapters/fs/snapshot-store.ts` (directory I/O) and `src/core/snapshot-store.ts`
(meta and ticket validation). See `docs/adr/0001-directory-snapshot-library.md`; introduced in #24.

_Avoid_: calling the local snapshot library a "cache file" — it is no longer one whole JSON file.

## Source revision

A comparable identifier a backend gives for "the current ticket state of this repository", returned
with each snapshot and incremental result and shaped as `{ id, total }`. `id` is only compared for
equality; `total` is the authoritative ticket count at that moment.

- It is returned with snapshots and change results for diagnostics, and its `total` is the
  authoritative count used for reconciliation; a refresh does not send `id` back and never
  short-circuits the change window on it.
- Local Markdown has no source revision (`null`). When a backend cannot provide the authoritative
  total, that refresh falls back to a full fetch.
- It answers "what does the remote look like?" for diagnostics; the store revision is the refresh
  freshness gate.

## Store revision

The monotonically increasing commit sequence of the local snapshot library (`meta.storeRevision`);
the change log and tombstones are delimited by it.

- A client sends back the store revision it last saw; the host uses `changesSince` to return only
  changed rows and tombstones.
- When the log has rotated past the baseline, the client version is newer than the store, or a
  ticket file is unreadable, no change set can be produced and the host returns a full snapshot.
- It answers "what is in the local store?", and must not be used to decide whether the remote
  changed.

## Viewer

The currently signed-in user in a list snapshot: GitHub GraphQL's `viewer.login`, GitLab's
`username` from `glab api user`, Gitea's `login` from `tea api /user`. Local Markdown has no remote
user, so it is always `null`.

- Stored in the snapshot's `viewer` field and in local snapshot-store entries, as the login only.
- A failed identity lookup is not a list failure: `viewer` is recorded as `null` (full refresh) or
  omitted (incremental refresh, keeping the previous value).
- When a full refresh returns `null` but the same repository has a previously known identity, the
  previous one is kept, so one transient failure does not make the people-filter row disappear.
- The UI shows `@login` in the filter row and matches case-insensitively.

Code: `src/core/ticket.ts` (`TrackerSnapshot.viewer`), `src/protocol/tracker.ts`
(`WorkspaceSnapshot.viewer`).

## People filter

Two independent toggles in the list view: "Assigned to me" and "Created by me". The data comes from
the snapshot's viewer and each ticket's assignee logins; matching is implemented once, in the
presentation logic of `src/panel/ticket-view.ts`.

- Both off: no people filtering; one on: only that role; both on: the union (assigned to me ∪
  created by me).
- Combined with the status filter in a fixed order: status filter → people filter → sort.
- Counts are computed on the status-filtered set, and the two roles do not affect each other; the
  status segments and statistics are still based on the whole snapshot.
- Login comparison is case-insensitive; a `null` creator (local Markdown, anonymized) never counts as
  "created by me".
- When the viewer is `null`, the whole row is not rendered; saved toggles are kept and take effect
  again once the identity is back.

List snapshots store assignees as remote logins only (`Ticket.assignees` /
`TicketSnapshot.assignees`), without display names or avatars; the structured `TicketAuthor`
assignees in details are unchanged. Changing assignees in a detail does not immediately write back
to the list snapshot (`assignSelf` would need another viewer lookup); the next refresh catches up,
and until then the people filter may still use the old assignees.

## Flat layout

The default list layout: all tickets in one line, by the current filter and sort, with no
collapsing, child counts or parent badges. Verdicts, statistics and prompts behave exactly as in the
tree layout.

Code: the `flat` branch of `buildTicketRows` in `src/panel/ticket-tree.ts` and `layout: 'flat'` in
`src/panel/view-preference.ts`. Introduced in #14.

## Tree layout

The list layout that indents child tickets under their parent by **parent-child relation**. A parent
can collapse / expand its whole subtree, and a parent row shows its descendant count in the currently
visible tree. It only changes layout; it does not change ready / blocked / closed verdicts,
filtering, sorting, statistics or load-more.

Code: `src/panel/ticket-tree.ts` (tree building, cycle and missing-parent fallback),
`src/panel/tickets-view.tsx` (collapse state and expand-on-locate). Introduced in #14.

## Hierarchy capability

Where the parent-child relations declared by a snapshot come from:

- `native`: the backend has native child tickets (GitHub sub-issues, GitLab work-item hierarchy);
- `convention`: derived from a body convention (the `Parent:` line in local Markdown, the
  `Part of #number` first line in a Gitea child ticket);
- `none`: the backend provides no hierarchy, or this refresh could not fetch it (Gitea also reads
  `none` from a pre-upgrade cache).

With `none`, the panel disables the tree layout and explains why; the flat layout works as usual.
The field is `hierarchy`. Introduced in #14.

Gitea has no native sub-issues; `to-tickets` puts `Part of #<spec>` on the first non-empty line of a
child body, and the panel reads only that line from the list response already in hand. Other forms
and blocking dependencies produce no parent-child relation.

## Parent-child relation

The organizational relation of one ticket hanging under another; see **Hierarchy capability** for
sources. Used only for list layout: there is no status roll-up, a parent does not become ready
because all its children are done, and a child is not judged blocked because its parent is blocked.

## Parent ticket / child ticket

A ticket in the same list that can act as a parent is a **parent ticket**; tickets under it are
**child tickets**. In the tree layout a parent can collapse its whole subtree and shows its visible
descendant count; when the parent is not in the current view, the child moves to the top level and
shows a parent-reference badge.

## Parent reference

The `parent` field on a ticket. It stores only a reference string and never copies the parent's
title, status or object. Its shape matches `ref`: a ticket in the same list is `#number` or a
relative file path; a parent outside the list is `owner/name#number` (a cross-repository GitHub
parent) or `&iid` (a GitLab epic). When the parent is not among the currently visible tickets, the
child moves to the top level and shows a parent-reference badge; no fake parent row is made up.

Code: the `parent` field in `src/core/ticket.ts` / `src/protocol/tracker.ts`. Introduced in #14.

_Avoid_: calling a parent reference a "parent object" or "parent snapshot" — it is only a reference;
parent information is still looked up from the current list.

## Ticket link

The page URL of a remote ticket on its code-hosting service, supplied verbatim by the backend:
GitHub takes the GraphQL `url`, GitLab takes `web_url`, and Gitea takes `html_url`. The panel never
assembles the address from host and project path — a self-hosted instance may live under a subpath,
and a guessed URL would not open. The link travels with the list snapshot and the local snapshot
store; old cached tickets without the field are treated as having no link and fill in after a
refresh. Local Markdown has no remote link.

Clicking a ticket number in the list copies the ticket link; the number in the detail header still
opens the browser, with a separate "Copy link" button next to it. The snapshot fields are
`Ticket.url` / `TicketSnapshot.url`, both optional.

Code: `src/adapters/github/tracker.ts` (GraphQL node fields), `src/adapters/gitlab/parse.ts` and
`src/adapters/gitea/parse.ts` (list parsing), `src/panel/ticket-list.tsx` (the copy entry point).
Introduced in #17.

_Avoid_: calling the number text (`#15`) a ticket link — it is a reference and does not open
anything; also avoid having the panel build URLs itself.

## Publish tree

The set of files in the commit a version tag points at: the bytes Orca installs and the catalog sees.

- A Git tree is the only distribution carrier: the npm registry and Release attachments are not Orca
  plugin channels.
- Four build artifacts are committed: the worker entry, the panel page, the panel script and the panel
  theme styles; generate them with `pnpm build:release`; source maps are not committed.
- `main` is also the default branch: versionless installs read this commit, pinned installs use
  `vX.Y.Z`.
- The repository root must not contain symlinks, submodules or unknown entries.
- The publish-readiness check (`pnpm release:check`) is the only gate: it exports the publish tree
  from HEAD, runs Orca's validation, rebuilds and compares the artifacts in the tree, checks the
  version tag, license and topic, and finally prints the catalog entry.

Code: `scripts/release-check.mjs` (runner), `scripts/lib/publish-readiness.mjs` (verdict). Introduced
in #11.

_Avoid_: treating an `orca plugin dev load` development folder as a distribution format — it never
goes through a Git tree and is never listed by the catalog.
