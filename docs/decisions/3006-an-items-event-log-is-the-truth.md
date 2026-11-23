# ADR-3006: An Item's Event Log Is the Truth

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone writing the tables behind tracking, adding a kind of change to an
item, or reading an item's history or the change feed.

## Purpose

Settles where the truth about an item lives, so history, the change feed,
and the audit trail can never disagree with the item itself.

## Context

Tracked work needs four things from one change: the new state, a line of
history, an entry in the feed other systems read, and an audit record.
Kept as four writes, they drift. A state table with a history table beside
it is the usual shape, and the usual bug is a state nobody can explain.

## Decision

Every change to an item is one event, appended and never edited. The
events are the truth.

- **One store.** Events live in Postgres, the hub's only database.
- **A current-state table** holds each item as it stands. It is written in
  the same transaction as the event, and it can be rebuilt from the
  events.
- **An event records** the item, what kind of change it was, who made it,
  when, from which surface, the values it set, and the key that made the
  write safe to send twice.
- **History, the change feed, and the audit trail read the events.** None
  of them is a second write.
- **Each event has a position that only moves forward.** A reader that has
  seen a position never later finds an event before it.
- **An event says one thing.** A change that happened and a change someone
  asked for are different kinds of event.
- **A kind of event is versioned and never removed.** A reader ignores a
  kind it does not know.
- **An event is small.** It holds the values it set. A change to a body
  names the body's new revision; the event never carries the text.
- **History is read in pages, newest first.** No read answers a whole
  log.
- **The feed is for systems, not for questions.** A reader gives a limit
  and the kinds it wants. An agent that needs a count or a list asks the
  current-state table, and never works one out from events.
- **A hard delete is an event too.** It blanks the values of the earlier
  events it names and keeps their place in the order.

## What this means for the code

- No code path updates the current-state table without appending an
  event in the same transaction.
- A migration that changes the current-state table ships with the rebuild
  that proves the table still comes from the events.
- Adding a kind of change means adding an event kind, never a column that
  history cannot explain.
- Body revisions are kept in their own table, the way a decision record
  keeps revisions. The rebuild reads the revision an event names.
- Every read of events takes a limit. None defaults to all.

## Verification

Built in phase 10. One pure fold turns an event into the next state, and
the store writes only what it answers; a test rebuilds an item from its
log and finds it equal to the table (`tracking.test.ts`). On a real
Postgres, eight writers on their own connections append while a reader
pages the feed from its bookmark, and the reader sees every position in
order; without the feed lock the same test fails (`proof.test.ts`, run
with `VANTAGE_TEST_DATABASE_URL`). A hard delete (`DELETE
/api/v1/items/:item`, admins only) blanks what every earlier event said,
keeps their order, appends its own event, and the item still folds from
its log (`modules.test.ts`).

## Consequences

- Any state can be explained: the events that led to it are all there.
- The feed costs nothing extra to keep true.
- Event kinds are kept forever, old versions included.
- A hard delete is more work than deleting a row.
- The events table grows with every change and needs its own retention
  rule for closed items.

## Related

- [ADR-3007](3007-every-tracking-action-commits-in-one-place.md): the
  key that makes a write safe to send twice.
- [ADR-0002](0002-the-agent-is-the-first-consumer.md): why an event and
  a history read stay small.
- `docs/spec.md`, Decisions: Postgres only, everywhere.
- Platform standard 2026.1120.2003: follows
  `an-event-reports-a-state-transition-or-a-workflow-proposal-n` and
  `drive-usage-events-from-the-audit-log-sent-only-after-commit`.
