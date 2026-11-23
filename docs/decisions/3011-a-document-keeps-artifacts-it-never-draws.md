# ADR-3011: A Document Keeps Artifacts It Never Draws

| | |
|---|---|
| **Decision Date** | 2026-11-22 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-22 |

## Status

Accepted

## Audience

Anyone changing what a version keeps, how renders read a version's files,
or how a tool reads a file back.

## Purpose

Settles where a file lives that belongs to a document and is never drawn,
such as a code analyzer's raw specification.

## Context

A code analyzer writes a specification of about 1.2 MB, and its next run
needs the last one to compare against. Kept on the analyzer's own storage
it has no history and no tie to the pages written from it. A version kept
only files the YAML or a page named as a picture or a page, and every
render read every file the version carried.

## Decision

A document lists its artifacts under `artifacts:`, and each lives in the
document's `artifacts/` folder.

- **Any type, never drawn.** An artifact may be any file up to the 2 MB
  file limit. No picture, page, export, or publication reads it.
- **Kept like any file.** A save keeps it while `artifacts:` lists it, and
  versions it with the document. One listed and not attached, or a path
  outside `artifacts/`, is an error every save refuses (`3004`).
- **Read back from the head.** A Markdown artifact is text at
  `workspace/document/artifacts/<file>`, read by part like a page; any
  artifact is bytes from `GET /api/v1/text/file`.
- **The folder is the rule.** Renders skip `artifacts/` by path, so the
  render path needs no model to know which files to leave unread.

## What this means for the code

- `ArtifactSchema` and `ARTIFACT_DIR` live in the model package;
  `assetRefs` includes artifacts, so the save keeps them.
- The hub's `assets.ts` stores any type under `artifacts/` and leaves
  artifacts out of every render's files, standing in an empty file so the
  check sees them attached.

## Verification

`packages/hub/src/documents/artifacts.test.ts` saves a Markdown and a JSON
artifact, reads one by part and one as bytes, and refuses a missing one
and one outside the folder.

## Consequences

- An analyzer's specification has the document's history and sits beside
  the pages written from it.
- A version can carry up to 20 MB, so a specification past 2 MB needs the
  file limit raised.

## Related

- [ADR-3003](3003-a-page-embeds-its-documents-files.md)
- Platform standard 2026.1120.2003: follows
  `keep-a-system-s-documentation-in-the-diagram-hub-tied-to-the` (the
  specification attached to the document it describes).
