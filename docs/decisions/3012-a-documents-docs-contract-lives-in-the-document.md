# ADR-3012: A Document's Docs Contract Lives in the Document

| | |
|---|---|
| **Decision Date** | 2026-11-22 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-22 |

## Status

Accepted

## Audience

Anyone changing what a save enforces about pages, or how agents find a
document by its repository or its kind.

## Purpose

Settles where a project's bar for its docs is written and who enforces it.

## Context

An agent asked to keep docs current cannot tell done from not done
without a stated bar. The bar could live in the repository's pointer file
or in the document. A document about a standard or a concept has no
repository, and the hub can only enforce what it holds.

## Decision

The contract is the document's `docs` block: `kind` (system, standard,
concept), `repository`, `audience`, the `pages` it must have, the
`checks` every save enforces, and `rules` in words for the writer.

- A page the contract names and the document lacks is an error.
- The page checks (copied facts, sections that name no box, boxes no page
  names, evidence) are notes by default; each one the contract lists is an
  error every save refuses.
- `audience` and `rules` are read by the writer, never by a check.
- `vantage_find "repository: host/owner/name"` and `vantage_find "kind:
  standard"` find documents across the hub. No index of its own.

## What this means for the code

- `DocsSchema` in the model package; `docCoverage` in the render package
  reads `docs.checks` and sets each finding's severity.

## Verification

`packages/render/src/doc-coverage.test.ts` turns a note into an error by
the contract and checks evidence coverage.

## Consequences

- One copy of the bar, enforced where it is written.
- The repository's `vantage.yaml` stays a pointer (`5006`).

## Related

- [ADR-3004](3004-every-save-refuses-a-document-with-errors.md)
- [ADR-5005](5005-a-repository-points-at-its-document.md)
