# ADR-3009: A Roadmap Is a Layer of the Model, and Its Status Is Read From Proof

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone building roadmap views, writing a roadmap with an agent, or asked
to add a status field someone types.

## Purpose

Settles what a roadmap is in Vantage, where its items live, and how an
item's status is known.

## Context

Agents write roadmaps today as hand-typed tables and timelines on pages. A
status is a word someone typed, with a "checked on" date beside it. The
plan and the architecture picture are kept apart, so neither shows what
the system will be. Roadmap tools do not know the architecture. Diagram
tools do not know the plan.

## Decision

The model gains a fourth layer, planned: what the system will be.

- **A roadmap item is an item**, of the kind roadmap item, held as a hub
  record ([ADR-3005](3005-the-hub-tracks-the-item-and-its-owner-keeps-the-content.md)).
  It is not text in the document's file. It has a title, the outcome, who
  owes it, a horizon (now, next, later), what it waits on, and the
  decision it came from. A date is set only for a real promise.
- **One item, many pictures.** A board, a timeline, and a table are views
  of the same items. A page names an item by its key and shows its live
  state. Nothing copies an item.
- **An agent reads a roadmap as rows.** One line per item: its key,
  title, state, horizon, who owes it, and the age of its proof. It asks
  by horizon, state, or owner and gets a page with a total. It never
  reads a board, a timeline, or a page to learn where the plan stands.
- **A change names what changes.** An item's fields are set by name and
  its outcome is patched
  ([ADR-5002](5002-agents-reach-everything-through-one-text-space.md)).
  Several items change in one call. No roadmap is one text that is sent
  again to move one line of it.
- **A page that names an item holds no copy of it.** Read by an agent,
  the page answers its prose and the keys. The agent asks for the items
  it wants.
- **An existing roadmap comes in by path.** A table or a list in a
  Markdown file becomes items through an import that reads the file from
  the disk
  ([ADR-5003](5003-an-agent-with-a-disk-works-in-a-working-copy.md)). The
  model does not write the rows out.
- **Status is read, never typed.** An item names its proof: the tickets
  that track it, the release that ships it, the thing a catalog should
  see. The hub works out the state from that proof and shows how old the
  proof is.
- **Done lands by itself only on proof a machine read.** When an agent
  says an item is done and no machine proof exists, the item shows as
  reported done.
- **The plan is on the picture.** An item names the boxes and arrows it
  adds, changes, or retires. The hub draws those as planned on the real
  diagram, with no hand styling, and a view can show the system today or
  after a horizon.
- **The planned layer never overrides what is.** Observed, declared, and
  narrative values keep their precedence. Planned says only what will
  change.
- **Outside trackers are read, never written.** An item's parts may be
  work items in the hub or tickets in another tracker, read through a
  connector and shown with their age.

## What this means for the code

- No roadmap view, page block, or tool takes a typed status.
- No tool answers a roadmap as a rendered view or as one document. The
  row list is `find` with the fields named.
- Proof kinds are connector work: a new source of proof is a connector,
  never a special case in the hub.
- The nightly review job that recomputes freshness also recomputes every
  item's worked-out state.

## Verification

Built in phase 11 (`packages/hub/src/tracking/roadmap.test.ts`). Parts
move a roadmap item to building, shipped, and back, each step an event the
hub makes; a person's move to a worked state is refused and the item can
only be reported done; a box named as proof ships the item when a
connector sees it, and a box bound to nothing is never proof; a Markdown
roadmap comes in once, a done row reported. The planned box and the
horizon switch were looked at on a running hub. The benchmark of
ADR-0002 moves one item's horizon and changes one sentence of its outcome,
each well under the same edit to a Markdown table. A ticket a connector
reads is proof too: open while the connector reports it, done once it
drops out of what is open, and the item moves when the run lands.

## Consequences

- A roadmap cannot claim more than its proof shows.
- A plan and its architecture are one model, so a status report and a
  picture agree.
- An item with no proof named can only ever be reported done.
- An estate needs connectors for its trackers and releases before its
  roadmap reads itself.

## Related

- [ADR-3008](3008-a-kind-and-its-lifecycle-are-data.md): the roadmap
  item kind and its lifecycle.
- [ADR-3001](3001-decision-records-live-in-the-hub.md): the decisions an
  item comes from.
- [ADR-0002](0002-the-agent-is-the-first-consumer.md): the bar a
  roadmap's reads and changes are held to.
- `docs/spec.md`, Vocabulary: the model's layers.
