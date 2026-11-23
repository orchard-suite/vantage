---
name: vantage-review
description: "Review a Vantage document's pictures and pages for story and accuracy: copied facts, unnamed boxes, claims with no evidence. Use to check, audit, or refresh diagrams or docs, or before publishing."
---

# Vantage review

## Steps

1. Read `guide#quality-loop` and `guide#finding-the-story` once. Outline
   the document for its views and pages. Run `vantage_validate` (by
   `address` for a saved document, by `file` for a file): it lists errors,
   a score and notes per view, and notes on the pages. Render every
   picture view with `vantage_render` and look at it.
2. For each view, write three lines: the question it claims to answer, the
   sentence the picture actually says, and the gap. A picture with no
   first thing to look at, no facts, and uniform boxes is a mechanical
   layout, not a story: say so.
3. For each page, outline it for its sections and read the ones you
   check. Report what the validate notes found (a section that types a
   fact a box carries, a section of prose that names no box, boxes no page
   names) and what only reading finds: a step that no longer matches the
   code, a section that answers no reader's question, a view the page
   should embed and does not.
4. Check accuracy against the sources named in the document and the
   repository: every arrow and every claim on a page should trace to a
   manifest, config, workflow, ADR, or code. Flag what has no evidence
   and what the evidence shows that nothing says.
5. Check the arc: does the picker read context, flow, structure, slices,
   processes, then the pages? Are there views that answer the same
   question twice? Is a page missing where three small views make one
   argument, or where a reader needs to do a task?
6. For each gap, give the exact change: the YAML or Markdown to add or
   edit, or the gesture to switch to, with `vantage_explore` output when
   the fix is a layout choice. Apply the changes when asked; otherwise
   hand them over as a list the author can paste.

## Report

Per view: question, what it says, gap, change. Per page: reader, what it
answers, gaps (copied facts, sections with no boxes, stale steps), change.
Then set-level findings: arc, duplicates, missing views or pages, boxes
nothing explains, facts missing from boxes, names or secrets that must not
be in the document. Keep it short; the pictures and the pages are the
evidence.
