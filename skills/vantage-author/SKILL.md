---
name: vantage-author
description: "Write or change a Vantage document, its diagram views and its pages (docs, a runbook, a guide, a wiki, documentation): render and look, iterate until each view tells its story, then save to the hub. Use to create or update diagrams or docs."
---

# Vantage author

A document holds a model, its views, and its pages. A page is a doc view:
Markdown beside the YAML that names the boxes instead of copying them. A
request for docs, a runbook, or a guide is a request for pages, and pages
are best beside the views they explain.

## Loop

1. The language is at the address `guide`. Outline it once
   (`vantage_outline guide`) and read only the topics this work needs:
   `guide#nodes`, `guide#relations`, the view kind you are about to write,
   and `guide#doc-a-page-of-prose` for pages. Never read it whole. For an
   exact field name, read one part of `schema`. If there is no brief, run
   the `vantage-brief` skill first. To change a document that exists,
   follow `guide#working-in-a-hub`: on a machine with a disk,
   `vantage_checkout` it, edit the files, and `vantage_sync`; otherwise
   find the line and `vantage_patch` it. Do not read a whole document to
   change one line of it.
2. Write the model: `nodes` as a tree of boundaries (cloud, subscription,
   resource group, cluster, namespace, tier, team), with `type`, a two or
   three word `name`, the machine name in `subtitle`, and `facts`,
   `value`, `bullets`, `note` where the brief asked for them. An
   infrastructure diagram uses vendor types: `profiles: [azure]` (or `aws`,
   `k8s`) for one cloud, qualified types such as `azure.keyvault` when it
   mixes vendors. Find other icons with `vantage_icons` (through
   `vantage_tool`); a logo the packs lack goes under `icons:` as a file
   beside the document.
3. Write `relations` with verb labels and `tags`. Relations come from
   evidence; cite the file in `description` when it helps the reader.
4. Write each view from its sentence: `question`, `include` by tag,
   `direction`, the gesture as `arrange` hints, `paths` for journeys,
   `highlights` for sets, `annotations` for notes and prose, `legend`
   when colors or kinds need explaining, `kind: page` to compose.
   When several views share a base, write it once as a part (`hidden:
   true`) and `extends` it; nest the picker with `group: A / B` when a set
   has more than a dozen views.
5. Write each page the brief asked for as a `kind: doc` view with its
   `file` under `pages/`, in the same save as the YAML that names it. Name
   every box you mention with `[[id]]`, embed a view where a picture
   answers faster than a paragraph, give `beside` to a page that walks one
   picture, and anchor every heading a reader may be sent to. Never type a
   fact a box carries (a SKU, an address, an owner): name the box.
6. Validate after every change: `vantage_validate` by `file` before you
   save, by `address` after. It checks the whole document, pages
   included, and every save refuses a document with errors, so fix each
   error at the line it names; the error names the guide topic that
   explains it. Its notes say where pages copy a box's fact, which
   sections of prose name no box, and which boxes no page names. Fix those
   too, unless the brief says why not.
7. Render each view you wrote or changed with `vantage_render` and look
   at the picture. The score and notes catch structure; only your eyes
   catch the story. Ask: can a reader say what happens first? Is the hero
   visible? Are the facts on the picture? Is anything there only because
   it exists?
8. When a view looks mechanical or scores under 80, call
   `vantage_explore` on it. It returns the same view laid out several
   ways, captioned and scored, with the hints to paste. Choose by eye.
   Steer with the levers in order: `direction` (canvas and per container,
   mixed), `order`, `collapse`, `hide`, the gesture, `layers`, `gap`.
   Reordering `nodes` and `relations` in the file is legitimate: text
   order breaks every tie. Never delete story content for a score.
9. Save to the hub and answer with the link the save gives, as
   `[Name](url)`: `vantage_sync` a working copy, `vantage_patch` a saved
   document, or `vantage_write` a new one (`~` is the person's own
   workspace). Only when no hub is connected (`vantage_outline` with no
   address says so), export with `vantage_export` (through
   `vantage_tool`) to a self-contained HTML and give the path.

## Rules

- No coordinates, ever. The engine places; you say what and in what shape.
- Never write a person's name or email into a document. Roles, not people.
  The operator's name goes in `author:` only when their standards ask for
  it.
- One package of meaning per view. Under 25 boxes. Split or page beyond.
- Every arrow has a verb. "connection", "link", "data" are not verbs.
- Report what you could not verify as a note on the view or a line on the
  page, not as a guess.
- When the document has a `docs` contract, its pages, audience, and rules
  are the bar. When it records `evidence`, tie what you write to the
  files you read it from at their commit, and move a tie to a newer
  commit only after you checked it (`guide#docs-that-stay-true`).
