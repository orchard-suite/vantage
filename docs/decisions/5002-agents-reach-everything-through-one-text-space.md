# ADR-5002: Agents Reach Everything Through One Text Space and Five Verbs

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone adding or changing an agent tool, adding a kind of content to the
hub, or writing a skill that reads or writes the hub.

## Purpose

Settles the shape of the hub's agent door, so reading and changing
anything costs what it costs on a disk
([ADR-0002](0002-the-agent-is-the-first-consumer.md)), and a new kind of
content needs no new tools.

## Context

Each kind of content grew its own tools. A document has read, save, edit,
and page. A decision record has nine. Items, roadmaps, state pages, notes,
and run records are coming, and each would add more.

The tools are whole-thing tools. `vantage_read` answers the whole YAML or
a whole page. `vantage_page` takes a whole page. `vantage_decision_update`
takes a whole section. `vantage_render` and `vantage_validate` take the
whole YAML as `text`, even for a document the hub already holds. Only
`vantage_edit` sends what changed, and only for YAML.

An agent already knows how to work cheaply. On a disk it lists a folder,
searches for a line, reads a range, and replaces one string. Those four
moves are why a disk is cheap. The hub offers none of them.

## Definitions

- **Address**: the name of one thing in the hub. `platform/shop` is a
  document. `platform/shop/pages/overview.md` is a page. `SHOP-2001` is a
  record. `ER-31` is an item. `SHOP` and `platform` are a registry and a
  workspace. `guide` and `schema` are the guide and the schema.
- **Part**: a piece of a thing, named after `#`. A heading in Markdown
  (`SHOP-2001#decision`), a path in YAML (`platform/shop#views.context`),
  or a line range.
- **Text form**: the one way a thing reads and writes as text. YAML for a
  document, Markdown for a page, a record, and an item.

## Decision

Everything an agent reads or writes in the hub is text at an address, and
five verbs reach all of it.

| Verb | What it does | On a disk |
|---|---|---|
| outline | What is at an address, with sizes: views, boxes by group, pages and their headings, a record's sections, a registry's records | list, word count |
| find | The lines that match words or a pattern, each with its address and line | search |
| read | The text of one or many addresses or parts | read a range |
| patch | Replace one exact string with another, or set, add, and remove by path | edit |
| write | The whole text of a new thing, or a rewrite | write |

- **One name, one thing.** A registry's prefix, a kind's prefix, and a
  workspace's slug never collide, so an address needs no type beside it.
- **Every thing has one text form, and it loses nothing.** Reading a thing
  and writing it back unchanged changes nothing. A record and an item
  keep their fields in a short header above their sections.
- **Outline first.** An outline never sends text. It gives an agent the
  names and sizes to pick the part it needs.
- **A read is bounded.** It answers the part asked for. Past its size
  limit it stops at a line and names the call that reads on. It takes the
  version the agent holds and answers an unchanged thing with one line.
- **Find answers lines an agent can use.** Each match is an address, a
  line, and the text, ready to read around or to patch. A count is
  answered as a count.
- **Patch is the way to change.** The old string must match the head
  exactly once. That match is the guard, so a patch needs no read first
  and no version. A miss saves nothing and shows the nearest lines.
- **One call, many things.** A read takes many addresses. A patch takes
  many edits across many things. Edits to one document, its pages
  included, save as one version. Each thing saves whole or not at all,
  and the answer names each one in a line.
- **Every write passes the strict save.** A write that leaves a thing
  with errors saves nothing and answers each error with its line and the
  part of the guide that explains it.
- **Tools that take a document take its address.** Render, validate,
  explore, export, and drift read what the hub holds. None asks for text
  the hub already has.
- **A new kind of content brings a text form and an outline.** It gets
  the five verbs with no new tool. A read or write tool for one kind of
  content is a change to this record first.
- **Actions stay typed.** A move, a claim, a comment, a publish, a
  connector run are not text. They are tools of their own
  ([ADR-5004](5004-an-agent-holds-a-small-core.md)).

## What this means for the code

- One module resolves an address to a thing, checks the caller may see
  it, and hands back its text form and outline. The five verbs and the
  working copy
  ([ADR-5003](5003-an-agent-with-a-disk-works-in-a-working-copy.md)) call
  it and nothing else.
- A patch to a document goes through `saveDocument`, and a patch to a
  record through the decision service's write, so the citation index and
  the audit entry hold as they do today.
- `vantage_edit`'s path operations are patch's path form. The whole
  thing tools (`vantage_save`, `vantage_page`, `vantage_edit`,
  `vantage_read` by workspace and document, `vantage_decision_update`)
  went in the same release as the verbs.
- The code is `packages/hub/src/text/`: `address.ts`, `things.ts` (the
  one module), `outline.ts`, `find.ts`, `read.ts`, `change.ts`, and
  `record-text.ts` for a record's text form. The verbs' names and
  arguments are shared with the laptop in `packages/mcp/src/verbs.ts`.
- The record tools in
  [ADR-3001](3001-decision-records-live-in-the-hub.md) that are actions
  (supersede, move, import) stay. Its read, list, create, and update
  become the verbs.

## Verification

`packages/hub/src/mcp/mcp.test.ts` reads a document and a page and
writes them back unchanged with no new version, patches the YAML by text
and by path and a page in one call into one version, and shows a patch
that misses or matches twice saves nothing.
`packages/hub/src/decisions/decisions.test.ts` does the same for a record,
whose patch changes only the fields it touched. The benchmark of ADR-0002
runs finding, reading, and changing one sentence for a box, a view, a
page, and a record, each at no more than its disk cost.

## Consequences

- Changing one sentence sends one sentence, in a page, a record, or a
  diagram.
- The tool list stops growing with the product. Items and roadmaps arrive
  with no new read or write tools.
- An agent no longer needs to read a document to change it. It finds the
  line and patches it.
- A thing's text form is a contract. Changing it is versioned like the
  diagram language.
- Agents and skills written against today's tools change once, when the
  verbs land.

Ways not taken:

- **Keep a tool per kind and add a patch argument to each.** Cheaper to
  build. The list grows by a handful of tools for every kind, and each
  one invents its own way to name a part.
- **Send JSON objects and field masks.** Exact for fields. Prose is where
  the cost is, and an agent edits prose as text.

## Related

- [ADR-3004](3004-every-save-refuses-a-document-with-errors.md): the
  strict save every write passes.
- [ADR-5001](5001-tracking-is-reached-through-a-port-its-caller-owns.md):
  the verbs an item's text is read and written through.
- Platform standard 2026.1120.2003: follows
  `bound-every-answer-an-agent-reads-and-let-each-answer-name-t`,
  `have-every-reader-send-a-list-s-tag-back-and-answer-an-uncha`, and
  `design-agent-authored-formats-for-low-syntax-risk-and-a-fast`. One
  address space for every kind of content is new ground.
