# ADR-3001: Decision Records Live in the Hub

| | |
|---|---|
| **Decision Date** | 2026-11-19 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-20 |

## Status

Accepted

## Audience

Anyone changing how the hub stores, shows, or imports decision records,
and anyone writing the `decide` skill.

## Purpose

Settles where an architecture decision record lives once it leaves a code
repository, and what shape it has there.

## Context

Decision records kept as Markdown in each repository drift from the
diagrams of the systems they decide about, and a decision that spans
programs has no home. Pages in a document could hold records by
convention, but a convention gives no numbering, no status, no supersede
links, and no way for a box to show the decisions that govern it.

A record also lives longer than any one picture. It is refined in place
many times, cited from many documents, and governs boxes across several
documents and workspaces.

## Decision

A decision record is a first-class hub record, not a document.

- A **registry** is a row held by a workspace: a prefix unique in the
  organization (`SHOP`), a name, and a category scheme that maps a leading
  digit to a name. An organization registry sits in a shared workspace;
  each program's registry sits in the workspace its diagrams live in.
- A **record** is a row with a ULID and a four-digit number. The first
  digit is the category; the next number is one past the highest ever
  taken there, under a per-registry lock. Records are never deleted, so a
  number is never reused. A record may move to a new number, category, or
  registry; its old number stays reserved as an alias (ADR-3002).
- A record **governs** boxes and views through link rows to documents, so
  any document in any workspace the writer can read can be governed.
- Each write keeps the whole record as a **revision**, the way a document
  keeps versions, and an audit entry.
- **Citations** are `SHOP-2001` everywhere, `ADR-2001` only inside a record
  of the same registry, and `adr:<ULID>` as the machine form. The grammar
  lives in `@vantage/model`, so the engine and the hub read it the same way.
- A box's YAML and a page may cite records. The engine reports what a
  document cites; the hub checks the citations exist on every save
  (`3004`).

## What this means for the code

- `packages/hub/src/decisions/` holds the service: `read.ts` and
  `write.ts` for access and writes, `numbering.ts` for numbers,
  `import.ts` and `import-apply.ts` for Markdown records. The API in
  `api/decisions.ts` and the tools in `mcp/decision-tools.ts` call it and
  nothing else.
- Registries and records never sit in a document's YAML. A document cites
  them; it does not hold them.

## Verification

`packages/hub/src/decisions/*.test.ts` cover numbering, import, and the
API, tools, a save that refuses an unknown citation, search, and pages
end to end.
`packages/model/src/decision-ref.test.ts` covers the citation grammar.

## Consequences

Records keep their own history and links without churning document
versions, and a box shows the decisions that govern it in every view.
Search and the workspace page see them. The cost is a second kind of
thing in the hub beside documents, with its own tables, pages, and tools.

## Alternatives Considered

### A document that is a registry

Every refinement would be a new version of one large file, two writers
would conflict on unrelated records, and a record could not be linked to
boxes in other documents without a second mechanism.

### Records as doc views by convention

No numbering, status, or supersede links, and nothing a box can show.

## Related

- [ADR-2001](2001-agents-sign-in-through-the-hub.md)
- [ADR-3002](3002-citations-are-indexed-and-records-move.md)
