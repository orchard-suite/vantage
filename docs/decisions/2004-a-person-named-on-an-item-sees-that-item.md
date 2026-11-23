# ADR-2004: A Person Named on an Item Sees That Item

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-21 |

## Status

Accepted

## Audience

Anyone writing an access check for tracking, or a list, search, feed, or
agent tool that returns items.

## Purpose

Settles who may see an item, so a person in another team can follow their
own request without being let into the workspace that works it.

## Context

Access in the hub is by workspace: a grant makes a person a viewer or an
author of everything in it. Tracked work crosses that line. A person asks
a team for something; the item lives in the team's workspace; the person
who asked must see how it stands. Granting them the workspace shows them
every other item, diagram, and decision in it.

## Decision

An item is seen by the people its workspace lets in, and by the people
named on it.

- **Named means** the person who asked for it, a person who holds it or a
  part of it, and a person a role on it resolves to while a move waits for
  that role.
- **Being named shows that item only**: its state, labels, notes, files,
  history, and its links as keys. It shows nothing else in the workspace,
  and a linked item is seen only if the person may see that one too.
- **Being named grants the moves the lifecycle gives that person**, and no
  other write.
- **Every way out judges the caller**: a list, a search, a count, the
  change feed, an agent tool, a page that shows an item's live state. A
  count never includes an item the caller may not see.
- **The text verbs and a working copy are ways out too**
  ([ADR-5002](5002-agents-reach-everything-through-one-text-space.md)).
  An outline, a find, and a checkout hold only what the caller may see.
- **A page of a list is filled after the check.** Access is judged in
  the query, so a caller asking for twenty rows gets twenty it may see,
  and never pages through rows it may not.
- **A workspace grant still works as before.** This adds a way in; it
  removes none.

## What this means for the code

- Item access is one function that every route, tool, and feed read
  calls. No route checks on its own.
- The feed is filtered per reader. A reader with an app role for a set of
  kinds reads those kinds whole.
- A page that embeds an item's state hides it from a reader who may not
  see the item.
- The check is part of the list's query. No route fetches rows and
  filters them after.

## Verification

Built in phase 10. `packages/hub/src/tracking/proof.test.ts` reads two
items through every read path that exists (get, list, search, count,
feed, the agent tools' read and outline, the item page) as a person a
waiting move's role names and as a person named nowhere. The first sees
the one item that waits for them and nothing else; the second sees
nothing, and every answer is the answer an item that does not exist
gets. A page that embeds an item's state is not built yet; it comes with
the roadmap views in phase 11 and gets the same test.

## Consequences

- A requester follows their own work with no workspace grant.
- Access is no longer answered by the workspace alone, so every item read
  costs one more check.
- Removing a person from a role or a part removes their sight of the item
  from then on. What they already read is not taken back.

## Related

- [ADR-2005](2005-a-module-acts-on-an-item-as-the-person-who-acted.md):
  how the hub knows who is asking when a module calls.
- [ADR-3008](3008-a-kind-and-its-lifecycle-are-data.md): the roles a
  kind declares.
- `docs/spec.md`, Tenancy and access.
