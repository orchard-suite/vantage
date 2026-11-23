# ADR-3003: A Page Embeds Its Document's Own Files

| | |
|---|---|
| **Decision Date** | 2026-11-19 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-20 |

## Status

Accepted

## Audience

Anyone changing how doc pages render pictures, what a save keeps
attached, or how the checker reads pages.

## Purpose

Settles where a doc page's pictures come from, which files a version
keeps, and how a page's picture reaches each place a page is read.

## Context

A page could embed a view or a picture from the web. A screenshot attached
to the document drew a blank, and a save dropped any file the YAML did not
name, so authors listed every screenshot under `icons:` to keep it. A
knowledge base moved into pages carries hundreds of screenshots; they need
to show, and the files need to stay without a workaround.

## Decision

A page embeds a file attached to its own document by a relative path, and
that file belongs to the document like any file the YAML names.

- **The path.** `![alt](assets/x.png)` or `./assets/x.png`, a path inside
  the document folder. A path with a `.` or `..` part, a leading `/`, or a
  scheme is refused and draws nothing. A page reads only its own
  version's files: there is no reference to another document.
- **What a version keeps.** The files a document reads are the files the
  YAML names and the files its pages embed. A save keeps those and drops
  the rest, so a picture only a page names stays while a page names it.
  Import from a zip reads the same set.
- **The check.** A page that embeds a file the version does not carry, or
  a file that is not a picture, is an error like a page that names a
  missing box; a path that leaves the folder is an error of its own.
  Every save refuses both (`3004`).
- **How it is drawn.** The picture is inlined into the page's HTML as a
  data URL when the bundle entry is built, the way a box's picture is
  inlined into its SVG. The hub viewer, the interactive HTML export, and
  an HTML publication carry it with nothing more to fetch. A file route
  in the hub was weighed and not taken: it would need its own access
  rules for guests and single-view shares, which the bundle entry already
  has.

## What this means for the code

- `renderDoc` lists a page's files and refused paths and takes a resolver
  that turns a path into an href; `docEntry` resolves from the version's
  files.
- `documentFiles(model, assets)` in the render package is the one list of
  files a document reads; the hub's save and import keep exactly that.
- The path rule is `isDocumentPath` in the model package, shared by the
  hub's attachment check and the page renderer.

## Verification

Tests cover a page's picture in the viewer entry and in the interactive
HTML export, a save that keeps a file only a page embeds, a save that
refuses a missing file, and a path that leaves the folder.

## Consequences

- A page's entry grows by its pictures, about a third more than their
  bytes. The version limits (2 MB a file, 20 MB a version) bound it.
- A picture change redraws the pages as well as the pictures, since both
  share the version's file key.
- PDF, PNG, SVG, draw.io, and Visio exports draw pictures only; a page is
  not in them, so neither are its files.

## Related

None.
