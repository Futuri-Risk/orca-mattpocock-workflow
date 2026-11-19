# ADR 0001: a directory-based local snapshot library

[简体中文](0001-directory-snapshot-library.zh-CN.md) | English

- Status: accepted
- Date: 2026-11-19
- Related: #24 (ticket panel Gitea first paint and refresh), #7 (repository scope)

## Context

The local snapshot library used to be one JSON file per cache key: every refresh serialized the
whole entry, wrote a temporary file and renamed it; `patchTicket` / `removeTicket` also rewrote the
whole file. It had no store version, no row granularity, no tombstones and no change log, so a
refresh always had to return the complete list, even when the remote had not changed.

The panel needs three storage capabilities:

1. when a client reports the store version it last saw, return only rows and tombstones changed
   since then;
2. changing one ticket writes only that ticket;
3. a crash never exposes half a batch.

At the same time we explicitly do not introduce SQLite or any native/embedded database: packaging
and cross-platform installation cost must stay at zero.

## Decision

One directory per cache key. The directory layout is private to the adapter; callers see only the
`SnapshotStore` interface:

```
<hash>.dir/
  meta.json              commit point: format version, store revision, repository identity,
                         source revision, ticket refs, tombstones, overview metrics
  tickets/<hash>.json    one file per ticket, raw backend data only
  changes.jsonl          append-only change log; each commit records changed refs and tombstones
```

### Commit order is the transaction

A write always runs:

1. write changed ticket files (temporary file + rename);
2. append the change log;
3. write meta (temporary file + rename).

Meta is the commit point. The read path reads meta first and then resolves only the ticket refs it
names. A crash can leave only orphan ticket files, an uncommitted log tail, or the old meta; none of
them exposes half a batch. The next write truncates the uncommitted log tail at the meta revision
and removes orphan ticket files that are no longer referenced.

### Two separate versions

- **Source revision**: the comparable identifier and authoritative total a backend gives for the
  current repository state. It answers "did the remote change?". A refresh sends it back as
  `ifRevision`; when it matches, the backend returns `notModified` and the host replies with a tiny
  not-modified response.
- **Store revision**: the monotonically increasing commit sequence in meta. It answers "what is in
  the local store?". A client sends back the store revision it last saw and the host uses the change
  log to return only changed rows and tombstones.

The two must never be mixed. When the source revision is unavailable, the authoritative total
drifts, the incremental result is truncated, or the hierarchy capability differs from the store,
the host falls back to a full fetch instead of publishing an untrustworthy delta.

### Tombstones

Deletion does not physically remove rows: meta's `tombstones` records the refs "absent in this
version", and the change set reports them as removals. When the same ticket reappears, the write
path clears its tombstone. Tombstones only participate while the change log is readable; once the
log rotates past the baseline, that baseline falls back to a full snapshot.

### Metrics and raw data

Meta stores the overview metrics computed from the same ticket data at write time, so the read side
does not recompute them. A ticket patch or removal clears the metrics and the next refresh writes
them again. The store itself keeps only raw backend data and these metrics, never readiness,
blocking or skill-action decisions; a rules upgrade never requires clearing the store.

### Fallback and self-healing

- Baseline older than the rotated log, client version newer than the store, or a missing/corrupt
  ticket file: no change set can be produced, so return a full snapshot.
- Corrupt meta or any unreadable ticket file: treat that cache key as no cache; other workspaces are
  unaffected.
- Format version mismatch: treat as no cache, no migration.
- The change log keeps at most 512 commits; older client baselines get a full snapshot.

### Single writer

The single-writer assumption holds: exactly one host process writes the local snapshot library at a
time. There is no file locking yet; add it when a second writer appears.

## Consequences

- Refresh replies shrink from "the whole list" to "changed rows + tombstones"; when the remote has
  not changed, they become a tiny not-modified response.
- Changing one ticket writes one ticket file; other ticket files stay untouched.
- The directory may briefly contain orphan ticket files; the next write removes them, and `prune`
  removes unreadable directories.
- Disk usage grows with the number of tickets; reconsider a database when a single workspace reaches
  tens of thousands of tickets or a second writer appears.
- The change-log rotation window decides how old a client baseline can be; requests outside the
  window pay the full-snapshot cost.
