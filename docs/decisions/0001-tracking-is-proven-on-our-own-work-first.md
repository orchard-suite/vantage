# ADR-0001: Tracking Is Proven on Our Own Work Before a Business Depends on It

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone planning what tracking is built next, or proposing to move a
module that people use every day onto it.

## Purpose

Settles the order in which tracking takes on real work, and the gates a
module in production must wait for.

## Context

Once a module's approvals run on the hub, a business runs on Vantage. A
module that has just reached production should not be rebuilt on a layer
nobody has used. Building the layer and moving the module at the same
time puts both at risk, and a failed move with no way back loses trust in
both.

## Decision

Tracking is built, used, and tightened on small work of our own first. A
module in production is not touched until every gate passes.

The order:

1. **The maintainers' own roadmaps**, worked by agents.
2. **One estate's platform roadmap.**
3. **One small existing board**, moved through a port
   ([ADR-5001](5001-tracking-is-reached-through-a-port-its-caller-owns.md)).
4. **A module with approvals**, only after the gates.

The gates, all of them:

- **The port holds.** The module's port passes the same tests against
  Vantage and against a second adapter that keeps items in memory.
- **The lifecycle is data.** The module's states and approval stages run
  as a lifecycle file with no change to hub code.
- **Speed is measured, not claimed.** On a copy of the busiest hub's real
  data, at ten times the moving module's size.
- **A restore is proven once.** The hub's data is restored from its
  backup and counted.
- **The move is rehearsed.** The migration runs twice in a test
  environment and the counts match both times.
- **There is a way back.** The module keeps its own store, so it can
  switch back.

Step 1 is worked through the agent door
[ADR-0002](0002-the-agent-is-the-first-consumer.md) sets. It ends when
the benchmark's tracking tasks (take an item, read what it needs, change
it, finish it) are inside their budgets.

Each step ends with what it taught written into the records it changes.

## Verification

A release note for each step names the work that moved. Before step 4, a
page lists the six gates with the evidence for each: a test run, a
benchmark report, a restore count, two migration counts.

## Consequences

- The first people to hit a tracking bug are the maintainers.
- The first three steps have no approval stages, so the gates carry that
  proof.
- A module waits longer for the shared layer than it would if both were
  built together.

## Related

- [ADR-3007](3007-every-tracking-action-commits-in-one-place.md): why
  the module keeps its own store.
- [ADR-0002](0002-the-agent-is-the-first-consumer.md): the bar step 1
  must meet.
- `docs/spec.md`, Phases.
- Platform standard 2026.1120.2003: follows
  `one-time-imports-planned-item-by-item-provenance-kept-verifi` and
  `prove-scale-out-by-benchmarking-the-deployed-shape-replicas-`.
