# ADR-3008: A Kind and Its Lifecycle Are Data, and the Hub Enforces the Lifecycle It Draws

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone adding a kind of tracked work, drawing a process, or asked to make
the hub do something when an item moves.

## Purpose

Settles how a new kind of work reaches the hub, and where the line sits
between tracking work and running a workflow.

## Context

Every tool that tracks work hard-codes its states and its approval steps.
The picture of the process, drawn somewhere else, goes stale the day the
code changes. Vantage already draws flow pictures; they only draw. A
tracker that grows scripts on its moves turns into a workflow engine, and
then every module's business logic lives inside it.

## Decision

A kind is a file. Its lifecycle is a view. The hub enforces what the view
draws and does nothing else when an item moves.

- **A kind declares** its key prefix, its labels, the roles people and
  agents can hold on it, the kinds its parts may be, and the lifecycle it
  follows. An estate adds a kind by saving a file. The hub ships two:
  work item and roadmap item.
- **A lifecycle is a view of kind `lifecycle`.** States are boxes. Moves
  are arrows. It is written once, in the file that draws it.
- **Every state is one of four classes**: not started, in progress, done,
  parked. A roadmap, a list, or a report reads any kind the same way.
- **A move names who may make it and what it needs**: a role, a note, a
  label that must be set, a content revision to pin.
- **The hub refuses any move the picture does not draw.** So the picture
  of a process cannot go stale.
- **An approval is a move a named role may make.** The person who asked
  never makes it. A lifecycle can draw approve, decline, and send back
  with a note.
- **A parent's state can be worked out from its parts**, such as done when
  every part is done. A worked-out state is never typed.
- **Each state can have a page** that says how to do the work there. An
  agent that picks the item up reads it. The picture shows a live count
  on each state.
- **A state's page is small and read once.** It has a size limit. The
  queue names its address and version, and an agent that already holds
  that version is told so in a line.
- **A refusal names the way forward.** A refused move answers the moves
  that caller may make from that state and what each needs. An agent
  does not read the lifecycle before it moves.
- **Describe answers for one caller.** Asked about an item, it gives the
  moves open to that caller now, never the whole picture.
- **A kind's prefix is a name in the hub's one address space**
  ([ADR-5002](5002-agents-reach-everything-through-one-text-space.md)).
  It never equals a registry's prefix, so `ER-31` names one thing.
- **What follows a move is never in the hub.** No script, no mail, no call
  to another system. The hub writes the event, and whoever cares reads
  the feed.

## What this means for the code

- The lifecycle check is one gate every move passes, whichever route asked.
- A kinds file and a lifecycle view are plain data with a published
  schema. Nothing in them is code.
- A request for an "on move" hook is answered with the feed.
- The refusal's list of open moves comes from the same gate that refused,
  so the two cannot disagree.
- Saving a kind checks its prefix against registries and other kinds.
- The kind's file is a Vantage document with a `kind` block (prefix,
  name, labels, roles, parts, the lifecycle view's id, and an optional
  `base`). Saving the document registers the kind in the same
  transaction as the version, so a save that would break a kind saves
  nothing. A kind with items keeps its prefix and every state an item is
  in.
- The shipped kinds are files in `packages/hub/kinds/`. A kind that
  names `base: work-item` takes that file's labels, roles, and lifecycle
  unless it names its own. The roadmap item ships with phase 11, when its
  state is worked out from proof.
- A lifecycle view draws as a flow: each state shaped by its class, work
  reading from the first state, done states last.

## Verification

Built in phase 10. A lifecycle with an approval and a role roster is
loaded from a file and enforced with no hub change; every move the
lifecycle does not draw is refused; the person who asked cannot approve,
even when a role names them; a refusal names the moves open, and making
one of them succeeds (`tracking.test.ts`, `proof.test.ts`). A parent
state worked out from its parts and the live count on the picture come
with the roadmap views in phase 11.

## Consequences

- A new kind of work costs a file, and its process picture is always true.
- The hub stays a tracker. Business rules that fire on a move live with
  the module, behind the feed.
- A lifecycle file's format is a contract: a change to it is versioned
  like the diagram language.
- A process that needs logic on a move (compute a value, pick the next
  approver from data the hub does not hold) must do that in the module and
  then ask for the move.

## Related

- [ADR-3005](3005-the-hub-tracks-the-item-and-its-owner-keeps-the-content.md):
  what an item holds.
- [ADR-3007](3007-every-tracking-action-commits-in-one-place.md): the
  hub never calls a module.
- [ADR-0002](0002-the-agent-is-the-first-consumer.md): why a refusal
  teaches and a state's page is small.
- Platform standard 2026.1120.2003: follows
  `name-an-approval-s-approvers-where-it-is-asked-and-never-let` and the
  target of `give-every-approval-three-answers-approve-decline-send-back`.
