# ADR-3010: Agents Work Items Through a Queue and a Claim That Expires

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone building the agent tools for tracking, running agents against a
hub, or reading what an agent did on an item.

## Purpose

Settles how an agent takes work from the hub, how two agents never take
the same item, and what an agent leaves behind.

## Context

Agents do most of the work on the items the hub will track. A list made
for a person does not tell an agent what it may pick up, and nothing stops
two runs from taking one item. An agent run that dies holds its work
forever unless something lets go for it. What a run did is scattered
across chat logs unless the item keeps it.

## Decision

An agent holds an item the way a person does, with a claim that runs out.

- **A queue to ask.** An agent asks what it may pick up, given what it
  can do. The hub answers items whose lifecycle lets that agent's role
  hold them, and what to read first: the state's page, the item's files,
  the last handoff note.
- **A claim that expires.** Taking an item is a claim with an end time.
  The run renews it while it works. A run that stops renewing loses the
  item, and the queue offers it again. Two claims on one item cannot both
  hold.
- **The queue answers cards and addresses.** What to read first comes
  as addresses with their sizes, never as text. The last handoff note is
  short enough to come with the card.
- **Renewing never costs a turn.** Any call a run makes on its item
  renews the claim. On a laptop the bridge renews while the session
  lives. No model is asked to send a heartbeat.
- **Finishing is one call.** The move or the release, the run record, the
  proof, and the handoff note go together. Each lands as its own event
  ([ADR-3007](3007-every-tracking-action-commits-in-one-place.md)).
- **A run record and a handoff note have size limits.** A longer account
  is a file on the item, sent by path.
- **One run record per run, on the item.** It says what the run did, its
  proof, how long it took, and what it cost as the runtime reported it.
- **A handoff note** says what the next run must know.
- **A question is a state.** An agent that needs a person asks on the
  item, and the item waits. The hub sends no notice itself; whoever sends
  notices reads the feed.
- **A person and an agent hold parts side by side.** Nothing in an item
  says a holder must be one or the other.

## What this means for the code

- Claims use the hub's one queue pattern: a row is taken for a set time,
  and other workers pass it over.
- A claim, a renewal, a release, a run record, and a question are events
  on the item like any other change.
- The agent tools answer in small pieces and name the call that reads
  more.

## Verification

Built in phase 12. On a real Postgres, eight agents on their own
connections claim one item at once and exactly one claim holds
(`proof.test.ts`, run with `VANTAGE_TEST_DATABASE_URL`). A claim that runs
out leaves the item in the queue again, and the next claim lets the lapsed
claimant go first; a claimant's own call renews a half-spent claim; the
bridge renews its session's claims while it lives and stops when the
session ends; finishing writes the run record, the move, and the release,
and the next run reads the handoff in the queue; a question takes the
item out of the queue until it is answered; an agent takes an item, reads
it, and finishes it in four calls (`agents.test.ts`). The fleet benchmark
across replicas is not run yet; it runs with the gates of
[ADR-0001](0001-tracking-is-proven-on-our-own-work-first.md).

## Consequences

- No item is stuck behind a dead run for longer than one claim.
- Anyone can read on the item what each run did, and send an agent to
  correct it.
- A long task must renew its claim. The bridge, or the run's own calls
  on the item, are that heartbeat.
- A run that loses its claim mid-task may have left partial work in the
  owner's store; the handoff note and the run record are how the next run
  finds it.

## Related

- [ADR-3006](3006-an-items-event-log-is-the-truth.md): claims and run
  records as events.
- [ADR-3008](3008-a-kind-and-its-lifecycle-are-data.md): the roles a
  lifecycle lets hold an item.
- [ADR-0002](0002-the-agent-is-the-first-consumer.md) and
  [ADR-5004](5004-an-agent-holds-a-small-core.md): the bar and the list
  these tools are held to.
- Platform standard 2026.1120.2003: follows
  `make-the-work-item-the-live-record-of-every-agent-run`,
  `keep-each-agent-run-s-runtime-reported-spend-on-the-work-ite`, and
  `prove-scale-out-by-benchmarking-the-deployed-shape-replicas-`.
