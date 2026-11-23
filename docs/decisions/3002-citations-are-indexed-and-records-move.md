# ADR-3002: Citations Are Indexed, and a Record Can Move

| | |
|---|---|
| **Decision Date** | 2026-11-19 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-20 |

## Status

Accepted

## Audience

Anyone changing how the hub saves documents or writes decision records,
how it answers what cites a record, or how a record is renumbered.

## Purpose

Settles how the hub knows where each record is cited from, and how a
record changes its number, its category, or its registry without breaking
a single citation.

## Context

Diagrams and pages cite records from a box's `decisions:` list and with
`[[decision:SHOP-2001]]`, and records cite each other in their prose and
their Related list. A strict save only checked that a citation names a
record; nothing remembered where citations came from. A reader of a
record could not see what leans on it, and a record could never be
renumbered or recategorized, because nothing could find the citations to
change.

## Decision

The hub keeps a citation index, and a record may move.

- **The index.** One row per citation (`decision_citations`): the source
  (a document's head version and the box or page in it, or a record and
  the field) and the target by its ULID, never by its text. Every document
  save rewrites its document's rows from the head it saves; every record
  write rewrites that record's rows. A citation that names no record yet
  keeps no target until a record takes the number. Migrations backfill
  what the index has not read.
- **Backlinks.** A record's Cited by lists each document with its boxes
  and pages, each record, and what the record governs. A reader sees only
  the sources in workspaces and registries they can open; the rest are a
  count.
- **A move.** A record takes a new number in its registry, the next number
  in another category, or a number in another registry. It keeps its
  ULID. Its old citation becomes an alias (`decision_aliases`) that still
  resolves: links redirect, and a save accepts it and answers the
  citation it names now. No other record ever takes an old number.
- **Rewrites.** A move rewrites every citation the index knows of, as new
  document versions and record revisions by the mover, with an audit
  entry. A source the mover cannot write keeps resolving through the alias
  and is reported, never a reason to fail. A dry run reports the same and
  writes nothing.
- **Meaning never changes.** A record that leaves its registry turns its
  own `ADR-NNNN` citations of the records it left behind into qualified
  ones; a record that stays behind cites it by its new qualified citation.
  The machine form and Related, which are kept by id, never change.
- **Text, not structure.** A rewrite replaces the whole citation token in a
  source's text (a document's YAML, its imports, and its pages; a record's
  prose), so every mention follows the record, and the lines around it
  keep their formatting.

## What this means for the code

- `packages/hub/src/decisions/citations.ts` reads and writes the index;
  `backlinks.ts` answers Cited by; `move.ts` plans and runs a move;
  `rewrite.ts` holds the text rules, with no database.
- A document save goes through `saveDocument`, which indexes the head it
  writes, so every surface that saves indexes. A record write goes through
  `remember` in `write.ts`, which indexes the record.
- A lookup by citation goes through `resolveRef` in `repo.ts`, which finds
  an alias when no record holds the number. `takenNumbers` counts aliases.

## Verification

`packages/hub/src/decisions/citations.test.ts` covers the index on save
and on record writes, waiting citations, the backfill, and what a reader
may see. `move.test.ts` covers a dry run, a renumber, a new category, a
new registry, an alias that resolves and redirects, a save of an alias, a number never reused, and a document the mover cannot write.
`rewrite.test.ts` covers the text rules.

## Consequences

### Benefits

Readers see what leans on a record, and registries can be cleaned up,
renumbered, and reorganized as an estate learns, with every citation
following.

### Costs

Every save reads its pages to index them, and the index is a second copy
of what documents and records say, kept true only because every write
goes through the two functions that maintain it. An old number lives on
as an alias forever.

## Alternatives Considered

### Find citations by searching every document at move time

Slow on a large estate, and it gives readers no backlinks.

### Index in the render worker

The worker reads every page already, but the index would trail the save,
and a move planned right after a save would miss it.

### Keep numbers immutable and supersede to renumber

A supersede says the decision changed. A renumber changes nothing about
the decision, and every citation would still point at the old record.

## Related

- [ADR-3001](3001-decision-records-live-in-the-hub.md)
