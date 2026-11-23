# ADR-3013: Evidence Ties Docs to Code, and Staleness Is Read, Not Stored

| | |
|---|---|
| **Decision Date** | 2026-11-22 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-22 |

## Status

Accepted

## Audience

Anyone changing evidence, the git connector, or how an agent learns what
a code change made stale.

## Purpose

Settles how a change to code marks exactly which boxes and page sections
may now be wrong, with no model call.

## Context

Infrastructure boxes bind to a live source, so drift is visible. A code
box or a page section bound to nothing, so the only way to know whether
docs were current was to read everything again. Agents change code fast
enough that docs drift within a day.

## Decision

- **Evidence.** A document's `evidence` ties a box, a view, a page, or a
  page section (`page#anchor`) to repository files and the commit they
  were read at. A tie to a box covers the boxes inside it.
- **History from a connector.** A `git` connector reads a repository's
  recent commits on its branch, with each file changed and the start of
  its diff, and reports them as `changes` on a batch. The hub keeps the
  latest history per repository in the blob store. The hub never reads
  source.
- **Staleness is worked out on read.** `workspace/document/stale` folds
  the document's ties over the history its `docs.repository` names: a
  tie whose files a later commit changed is listed with the commits and
  diffs. A save that moves the tie's commit clears it. Nothing is stored
  that could disagree with the document.
- **One fold.** `staleTies` in the model package is the only code that
  decides staleness.

## What this means for the code

- `EvidenceSchema`, `staleTies`, and `staleMarkdown` in the model package.
- `gitConnector` in the connectors package; `ChangesSchema` on the batch.
- `sources/history.ts` keeps the history; `text/stale.ts` answers the
  address; the document outline counts what may be stale.

## Verification

`packages/hub/src/text/stale.test.ts` pushes a git batch, reads one stale
tie with its diff, moves the tie, and reads it clear.
`packages/connectors/src/connectors/git/git.test.ts` reads a branch once
and keeps each commit between runs.

## Consequences

- An agent asks one address and gets an exact, short list.
- A tie checked at a commit older than the history read lists every
  change in the history to its files.
- Only GitHub and GitHub Enterprise are read today; another forge is one
  more connector kind.

## Related

- [ADR-4001](4001-connectors-run-in-a-shared-pool.md)
- [ADR-3012](3012-a-documents-docs-contract-lives-in-the-document.md)
- Platform standard 2026.1120.2003: follows
  `check-diagrams-for-drift-by-diffing-names-from-code` and
  `draw-relations-only-from-evidence`.
