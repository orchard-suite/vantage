# ADR-2005: A Module Acts on an Item as the Person Who Acted

| | |
|---|---|
| **Decision Date** | 2026-11-21 |
| **Decision Maker** | The Vantage maintainers |
| **Last Updated** | 2026-11-22 |

## Status

Accepted

## Audience

Anyone building the tracking API's sign-in, or a module that moves items
for the people who use it.

## Purpose

Settles whose name is on a move when a module makes the call, so the
lifecycle's rule about who may move an item is judged on the real person.

## Context

A lifecycle says who may make each move
([ADR-3008](3008-a-kind-and-its-lifecycle-are-data.md)). People will
mostly act in a module's own screens, not in the hub. Today only
connectors hold app tokens, and an app token names the app. If a module
moved items as itself, every move would be allowed or refused for the
module, and the history would say the module approved everything.

## Decision

A call that a person caused carries that person. A call nobody caused
carries the module.

- **A person's act is made as the person.** The module presents the
  signed-in person's identity to the hub, from the same identity provider
  the hub trusts. The hub judges the move against that person and writes
  them on the event, with the module as the surface.
- **A module's own work is made as the module.** Reading the change feed,
  publishing labels, loading kinds files, and a migration run under the
  module's app role. An app role is scoped to the kinds it names.
- **An app role alone never makes a move that a lifecycle gives to a
  person.** The hub refuses it.
- **An agent is a holder like any other.** It acts under its own identity
  and holds the roles a kind gives it.

### How a module gets the person's token

The issuer makes it. The hub never mints a token for a module to use as a
person, and takes any token the issuer signs for it with its scope.

- **A module that signs the person in itself** asks the issuer for the
  hub's scope on that sign-in, and renews it as it renews its own.
- **A module whose own API sits between the person and the hub** trades
  the token its front end sent for one for the hub: Entra's on-behalf-of
  grant, or token exchange (RFC 8693) at another issuer.
- **The module's app holds the hub's delegated scope**, consented by an
  admin. It proves itself to the issuer with a workload identity where
  the platform has one, never a stored secret where it does not need one.
- **The token names the module.** Its `azp` is the module's client, and
  the hub writes it on every event the person makes through it.
- **The person is the same user everywhere**
  ([ADR-2006](2006-a-person-is-one-user-whichever-way-they-sign-in.md)).
- **Access ends with the issuer.** A token lasts about an hour. A person
  who loses access at the issuer gets no new one.

## What this means for the code

- The tracking routes accept a person's token, an agent's token, or an
  app's token, and the event records which.
- The module never sends a person's name as a field for the hub to
  believe.
- A kind's roles resolve to people, teams, and agents the hub already
  knows.

## Verification

Built in phase 13 (`packages/hub/src/tracking/modules.test.ts`). A module's
app token with the module role does nothing until an admin registers its
client with its kinds; then it loads its kinds file into its own
workspace, puts items by its own key with no asker, reads its kinds whole
and nothing else, and is refused every move and every hold. A person's
move comes with the person's own token, and the event records the client
it came through. The same test puts and moves an item with a token the
issuer gave the module for the person: the feed names the person and the
module's client, and the hub has one user for them.

## Consequences

- History says who really decided.
- A module is an app at the hub's issuer, with the hub's delegated
  scope. A module in another estate's issuer cannot act for a person here.
- A background job in a module cannot make a person's move. It asks a
  person, or the lifecycle gives the move to a role an agent holds.

## Related

- [ADR-2001](2001-agents-sign-in-through-the-hub.md): how agents sign in.
- [ADR-2004](2004-a-person-named-on-an-item-sees-that-item.md): who may
  see an item.
- Platform standard 2026.1120.2003: follows
  `name-an-approval-s-approvers-where-it-is-asked-and-never-let` and
  `a-chat-card-s-button-acts-as-the-person-who-clicked-it-with-` (the
  on-behalf-of grant).
