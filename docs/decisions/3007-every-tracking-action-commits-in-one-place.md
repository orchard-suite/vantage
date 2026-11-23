# ADR-3007: Every Tracking Action Commits in One Place

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone designing a write to tracking, building a module on it, or tempted
to add a callback from the hub into a module.

## Purpose

Settles how a module's own store and the hub stay consistent with no
transaction across them, so no saga, no two-phase commit, and no undo
step is ever needed.

## Context

A module keeps its content and the hub keeps the item
([ADR-3005](3005-the-hub-tracks-the-item-and-its-owner-keeps-the-content.md)).
Two stores invite a distributed write: one action that must change both,
where a failure between them leaves the work half done. The repair for
that is a saga, a chain of steps with an undo for each. Sagas are hard to
get right and harder to keep right, so this design must not need one.

## Decision

Each fact has one owner, and each action commits in exactly one store.

| Action | Commits in | The other store |
|---|---|---|
| Save or edit content | The module | Not touched |
| Approve, reject, assign, claim, note, close | The hub | Not touched |
| Submit | The hub | The module saved a revision first |
| Attach a file | The hub | The file was stored first |

- **The module owns what the work says. The hub owns where it stands and
  who has it.** Nothing is the truth in two places. A module keeps no
  copy of an item's state.
- **A content revision is numbered and never changes.** A state is about
  one revision. A later edit makes a new revision and cannot change what
  was approved.
- **Submit is two steps and one commit.** The module saves a revision. A
  saved revision that nothing points at is harmless. Then one call tells
  the hub the item now waits, on that revision. That call is the commit.
- **Every write to the hub carries a key.** Sent twice, it answers the
  same and changes nothing the second time. A failed call is sent again;
  there is never a step to undo.
- **A model never writes a key.** On a laptop the bridge makes the key
  and sends the same one when it retries. On the hub's own agent door the
  door makes it.
- **One request may carry several actions.** Each commits alone, with its
  own key and its own event. The answer says in a line each which landed.
- **A write answers one line.** Sent twice, it answers the same line.
- **The hub never calls a module.** A module that acts after a move reads
  the change feed, in order, from its own bookmark. After an outage it
  carries on from where it stopped.
- **The item is found by the module's own key.** A module never stores a
  hub id as its key.
- **Drift is counted.** The hub answers which items exist for a module's
  keys, so the module's own check job can compare the two lists. The
  count should stay at zero.

## What this means for the code

- The tracking API has no call that changes an item and a module in one
  request, and the hub holds no address of any module.
- Every write route takes an idempotency key and stores it on the event.
- A request of several actions is a list of single actions. It is never
  one transaction, and no action in it waits on another.
- A move names the content revision when its lifecycle says the move is
  about one.
- Nothing in the hub sends mail, calls a webhook, or starts work in
  another system because an item moved. The feed is the only way out.

## Verification

Built in phase 10. Every write route is sent twice with one key and
writes one event, answering the same line the second time, even when the
first write moved the item out of the sender's sight; a key another
caller used is refused (`proof.test.ts`). The feed is read from a
bookmark and carries on with nothing missed (`doors.test.ts`). A submit
killed between its two steps leaves the item unchanged by construction:
the hub hears nothing until the one call.

## Consequences

- No saga, no two-phase commit, no outbox table in a module.
- What follows a move lands a moment later, never in the same instant.
- If the hub is down, nothing can be submitted, approved, or assigned.
  Content can still be saved. An outage is accepted; a loss is not.
- A module that edits content in place, with no numbered revisions, must
  gain them before it moves onto tracking.

Ways not taken:

- **Each module keeps its own state.** No cross write. A list across
  modules then needs a copy of every state, and that copy is the
  distributed write, done worse.
- **Tracking as a library inside each module's database.** One real
  transaction. The engine must then run on every database a module uses,
  and an agent's claim must reach every store.
- **The hub holds the whole record.** One store, no cross write. The hub
  then understands every module's content, which ADR-3005 rules out.

## Related

- [ADR-3006](3006-an-items-event-log-is-the-truth.md): the events the
  feed reads.
- [ADR-5001](5001-tracking-is-reached-through-a-port-its-caller-owns.md):
  the calls a module makes.
- [ADR-0002](0002-the-agent-is-the-first-consumer.md): why one request
  carries many and a turn is counted.
