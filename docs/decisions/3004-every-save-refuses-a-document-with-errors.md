# ADR-3004: Every Save Refuses a Document With Errors

| | |
|---|---|
| **Decision Date** | 2026-11-20 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-20 |

## Status

Accepted

## Audience

Anyone adding a way to write a document version to the hub, changing
what the checker counts as an error, or writing a client that saves.

## Purpose

Settles that a version with errors is never stored, whichever route wrote
it, and what a refusal answers.

## Context

The hub checked a document only when the writer asked, with `strict`.
Every other save stored whatever it was given. Agents saved documents
whose boxes used types neither built in nor declared, and text a bad
replacement had broken. Each save answered `saved`. `vantage lint` on the
same text reported the errors, and every reader of the document saw an
error banner. An edit, a steer, or a merge could also turn a clean
document into a broken one, and none of those took `strict`.

## Decision

The check runs inside every save, on the text the version would hold.

- **One gate.** `saveDocument` checks the YAML, its imports, and the files
  the version keeps, after any merge with a head that moved, before it
  writes the version. No route checks on its own, and no route can skip
  it. `strict` is gone; a client that still sends it is ignored.
- **What it refuses.** Every error the check finds: text that does not
  parse, an unknown type, a name that points at nothing, a page that
  embeds a missing file, a citation of a record nobody holds. Warnings,
  layout quality among them, save.
- **The answer.** 422 and nothing saved. `details.errors` lists each
  error with its code, message, path, line, and hint. The message spells
  the first twenty out as `code at path, line N: message`, for a writer
  that sees only text, such as an MCP tool.
- **Writers that save for someone.** A zip import names each refused file
  with its errors and imports the rest; it answers 422 only when every
  file was refused. A decision move reports a document that cannot save,
  and its old citation keeps resolving.
- **What came before.** A version stored before this gate keeps its
  errors until someone saves a fixed one. Restoring it is refused like
  any save.

## What this means for the code

- `packages/hub/src/documents/check.ts` holds the gate (`requireClean`)
  and the text each route's API description uses for it.
- `packages/hub/src/documents/save.ts` calls it inside the save's
  transaction, so its reads see the same database the save writes.
- The check's errors and warnings are findings with a code and a place,
  not sentences, in the check route and in a refusal alike.
- The viewer's editor no longer offers to save anyway; a refusal says how
  many problems to fix, and its notes list them.

## Verification

`packages/hub/src/documents/check.test.ts` has one test per write path:
create, full save, source save, edits, steer, page save, restore,
revision accept, and the MCP save, page, and edit tools. Each is refused
with its error's code, path, and line, and saves nothing. A save with only
warnings still saves.

## Consequences

- A reader never sees a version the checker knew was broken.
- An agent fixes what it wrote before anything is published.
- A document saved broken before this gate must be fixed in one save: a
  partial fix that leaves any error is refused too.
- Every save pays for a check; it is the same check a strict save ran.

## Related

- [ADR-3001](3001-decision-records-live-in-the-hub.md): citations the
  check refuses.
- [ADR-3003](3003-a-page-embeds-its-documents-files.md): page files the
  check refuses.
