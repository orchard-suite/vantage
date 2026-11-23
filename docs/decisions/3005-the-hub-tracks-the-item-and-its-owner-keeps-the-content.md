# ADR-3005: The Hub Tracks the Item, and Its Owner Keeps the Content

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone building tracking in the hub, adding a field to an item, or writing
a module that puts its work in front of people through Vantage.

## Purpose

Settles what the hub holds about a piece of work and what it never holds,
so tracking serves every module without becoming any module's database.

## Context

An estate has many things that have a state and a holder: a request that
waits for approval, a finding, a risk, a task, a roadmap item. Each tool
that owns one builds its own states, history, notes, and "my work" list.
Vantage will hold an estate's plan and its work, so that layer is built
once. The first design had the hub hold the whole record: every field and
file of a form. That makes the hub understand what a form or an estimate
is, and every schema change in a module becomes a change in Vantage.

## Definitions

- **Item**: one piece of tracked work. It has a kind, a state, and a
  history.
- **Owner**: the system whose business the item is. A module outside the
  hub, or the hub itself for the kinds it ships.
- **Content**: what the work is about. The answers on a form, the lines of
  an estimate, a drawing.
- **Label**: a small display value the owner publishes on its item.

## Decision

The hub tracks the item. The owner keeps the content.

- **An item holds** an id that never changes, a key people say (`ER-31`),
  its kind, its workspace, its state, who holds it, who asked for it, its
  dates, its notes, its links to other items, boxes, and decisions, and
  its history.
- **An item points at its content.** It carries the owner's own key
  (`forms/1842`) and the content revision the state is about. The hub
  never reads through that pointer.
- **Labels are shown and sorted, never understood.** A kind declares a few
  flat labels: a name and a type from text, number, money, date, and
  choice. The owner publishes their values. The hub lists, sorts, and
  filters by them. No rule in the hub depends on what a label means.
- **Files about the work may sit on the item**: proof, a note's
  attachment. The owner's content files stay with the owner.
- **The hub's own kinds** (work item, roadmap item) are items whose owner
  is the hub. They add a Markdown body. They use the same labels as any
  other kind.
- **A change to a module's schema changes nothing in the hub.**
- **An item reads as a card.** A read answers its key, kind, state,
  holders, labels, and a count of its notes, files, links, and events,
  inside a fixed size. Notes, history, and links are read as parts
  ([ADR-5002](5002-agents-reach-everything-through-one-text-space.md)).
- **A body is patched.** The Markdown body of a hub kind is text at the
  item's address. An edit sends what changed, never the body.

## What this means for the code

- No table, route, or tool in the hub is named for a module's content
  type. A new module is a kinds file, never a hub change.
- A label has a declared type and a size limit. A request to store a
  nested value or a document as a label is refused.
- A list across kinds is one query on the hub's own tables.
- No read of an item grows with its history. A note has a size limit like
  a label; a longer text is a file on the item.

## Verification

Built in phase 10. A kind is saved as a file and its items are tracked
with no hub change (`tracking.test.ts`, `doors.test.ts`); a label that is
not a declared flat value, and a nested value, are refused. An item with
a thousand events reads as a card within a few characters of one with a
single event (`proof.test.ts`).

## Consequences

- One "my work" list covers every module, and no module builds states,
  history, or notes again.
- Opening one full record reads two places: the content from its owner and
  the state from the hub, by key, at the same time.
- A label can be a moment older than the content it was read from.
- If the hub is down, state cannot change. Content can still be edited.

## Related

- [ADR-3007](3007-every-tracking-action-commits-in-one-place.md): how
  the two stores stay consistent with no shared transaction.
- [ADR-3008](3008-a-kind-and-its-lifecycle-are-data.md): what a kind
  declares.
- [ADR-0002](0002-the-agent-is-the-first-consumer.md): the bar an item's
  reads and writes are held to.
- Platform standard 2026.1120.2003: follows
  `one-due-list-that-every-module-feeds` and
  `bound-every-answer-an-agent-reads-and-let-each-answer-name-t`.
