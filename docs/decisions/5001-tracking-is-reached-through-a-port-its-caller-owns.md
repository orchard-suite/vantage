# ADR-5001: Tracking Is Reached Through a Port Its Caller Owns

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone shaping the tracking API, or building a platform whose modules
track work in Vantage.

## Purpose

Settles the shape of the tracking API so that a module is never built
around Vantage and a platform could put another tracker behind the same
calls.

## Context

A platform's modules will track their work in the hub. A module that
imports a Vantage library, stores Vantage ids, or calls Vantage routes is
tied to it for good. The platform, not Vantage, should own the few calls
its modules make, and one adapter behind those calls should be the only
code that knows Vantage. That only works if the hub's API is small and
plain enough for such a port to wrap.

## Definitions

- **Port**: a small interface a platform owns. Its modules call it and
  nothing else.
- **Adapter**: the one piece of code behind a port that knows the real
  tracker.

## Decision

The tracking API is nine verbs, and nothing a caller needs lies outside
them.

| Verb | What it does |
|---|---|
| describe | A kind's states, and the moves this caller may make |
| put | Make or update an item by the caller's own key; safe to send twice |
| move | Change state; refused if the lifecycle forbids it |
| hold, release | Who has it now |
| note, attach | Notes and files on the item |
| get | Read one or many, by the caller's own keys |
| find | Lists: mine, waiting, late |
| changes | Everything that changed since a bookmark, in order |
| link | Came from, part of |

- **The caller's own key is the key.** Every verb that names an item
  takes the key the caller already has.
- **Kinds and lifecycles are plain files** the caller keeps in its own
  repository and hands to the hub from its pipeline.
- **No client library is required.** The verbs are plain HTTP with a
  published description. Vantage may ship a client; nothing may need it.
- **The verbs are versioned and not broken.** A change that would break a
  caller is a new version served beside the old one.
- **The port and its adapters belong to the caller.** A platform proves
  its port is not shaped like Vantage by running the same tests against a
  second adapter that keeps items in memory.
- **A read is asked for by field and by page.** get and find take the
  fields wanted and a limit. They answer a total and name what reads the
  rest. get takes the version the caller holds and answers an unchanged
  item with nothing.
- **find counts.** A count, or a count by state, kind, or holder, is one
  call. No caller pages through a list to add it up.
- **put changes what it names.** Fields it does not name stay as they
  are. A body is changed by a patch, never sent whole to change a line.
- **changes takes a limit and the kinds wanted.**
- **One request may carry several calls**, each committing alone
  ([ADR-3007](3007-every-tracking-action-commits-in-one-place.md)).
- **The agent tools add no verb.** Reading goes through the text verbs of
  [ADR-5002](5002-agents-reach-everything-through-one-text-space.md),
  which call get, find, and describe. Acting is one tool that carries
  move, hold, release, note, attach, and link.
- **The hub's own surfaces use the same verbs.** The web pages and the
  agent tools for tracking call what a module calls.

## What this means for the code

- A tracking feature that cannot be reached through the nine verbs is a
  change to this record first.
- The API description is generated from the routes and published with
  each release.
- The hub's tests drive tracking over HTTP only, so they prove what a
  caller gets.
- No list route answers without a limit, and none defaults to all.

## Verification

Built in phase 10. The verbs are served under `/api/v1/kinds`,
`/api/v1/items`, and `/api/v1/changes`, and the web pages and the agent
tools call the same service. A contract test fails the build when an
item route's method, path, parameters, or body fields change
(`packages/hub/src/tracking/contract.json`); moving the contract on
purpose is a new version beside the old one. The doors test drives the
verbs over HTTP; the service tests read internals to prove the fold and
the gate.

## Consequences

- A platform can leave Vantage by writing one adapter.
- Vantage cannot offer a module a richer call than the nine without
  widening every port built on them.
- Two versions of a verb may be served at once for a time.

## Related

- [ADR-3007](3007-every-tracking-action-commits-in-one-place.md): the
  keys and the feed the verbs rely on.
- [ADR-2005](2005-a-module-acts-on-an-item-as-the-person-who-acted.md):
  whose name a call carries.
- [ADR-0002](0002-the-agent-is-the-first-consumer.md): why every read
  is bounded and every change is the size of what changed.
- `docs/spec.md`, Decisions: interfaces written as if public.
- Platform standard 2026.1120.2003: follows
  `ask-a-list-read-only-for-the-rows-and-values-you-map-in-the-` and
  `have-every-reader-send-a-list-s-tag-back-and-answer-an-uncha`.
