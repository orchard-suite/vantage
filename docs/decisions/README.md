# Decisions

This folder is Vantage's record of decisions: one decision per record, with
the reasons, so the next change builds the same way or knows which record
to supersede.

| Prefix | Category |
|---|---|
| 0xxx | Governance |
| 1xxx | Infrastructure |
| 2xxx | Security |
| 3xxx | Data |
| 4xxx | Compute |
| 5xxx | Development |
| 6xxx | Operations |

## Records

### Governance

| Number | Title | Status | Last updated |
|---|---|---|---|
| [0001](0001-tracking-is-proven-on-our-own-work-first.md) | Tracking is proven on our own work before a business depends on it | Accepted | 2026-11-21 |
| [0002](0002-the-agent-is-the-first-consumer.md) | The agent is the first consumer, and a local disk sets the bar | Accepted | 2026-11-21 |

### Security

| Number | Title | Status | Last updated |
|---|---|---|---|
| [2001](2001-agents-sign-in-through-the-hub.md) | Agents sign in through the hub | Accepted | 2026-11-19 |
| [2002](2002-connectors-read-secrets-as-their-own-app.md) | A connector reads its secrets as its own app | Accepted | 2026-11-19 |
| [2003](2003-the-hub-signs-in-to-postgres-as-its-workload-identity.md) | The hub signs in to Postgres as its workload identity | Accepted | 2026-11-21 |
| [2004](2004-a-person-named-on-an-item-sees-that-item.md) | A person named on an item sees that item | Accepted | 2026-11-21 |
| [2005](2005-a-module-acts-on-an-item-as-the-person-who-acted.md) | A module acts on an item as the person who acted | Accepted | 2026-11-22 |
| [2006](2006-a-person-is-one-user-whichever-way-they-sign-in.md) | A person is one user whichever way they sign in | Accepted | 2026-11-22 |

### Data

| Number | Title | Status | Last updated |
|---|---|---|---|
| [3001](3001-decision-records-live-in-the-hub.md) | Decision records live in the hub | Accepted | 2026-11-20 |
| [3002](3002-citations-are-indexed-and-records-move.md) | Citations are indexed, and a record can move | Accepted | 2026-11-20 |
| [3003](3003-a-page-embeds-its-documents-files.md) | A page embeds its document's own files | Accepted | 2026-11-20 |
| [3004](3004-every-save-refuses-a-document-with-errors.md) | Every save refuses a document with errors | Accepted | 2026-11-20 |
| [3005](3005-the-hub-tracks-the-item-and-its-owner-keeps-the-content.md) | The hub tracks the item, and its owner keeps the content | Accepted | 2026-11-21 |
| [3006](3006-an-items-event-log-is-the-truth.md) | An item's event log is the truth | Accepted | 2026-11-21 |
| [3007](3007-every-tracking-action-commits-in-one-place.md) | Every tracking action commits in one place | Accepted | 2026-11-21 |
| [3008](3008-a-kind-and-its-lifecycle-are-data.md) | A kind and its lifecycle are data, and the hub enforces the lifecycle it draws | Accepted | 2026-11-21 |
| [3009](3009-a-roadmap-is-a-layer-of-the-model-and-its-status-is-read-from-proof.md) | A roadmap is a layer of the model, and its status is read from proof | Accepted | 2026-11-21 |
| [3010](3010-agents-work-items-through-a-queue-and-a-claim-that-expires.md) | Agents work items through a queue and a claim that expires | Accepted | 2026-11-21 |
| [3011](3011-a-document-keeps-artifacts-it-never-draws.md) | A document keeps artifacts it never draws | Accepted | 2026-11-22 |
| [3012](3012-a-documents-docs-contract-lives-in-the-document.md) | A document's docs contract lives in the document | Accepted | 2026-11-22 |
| [3013](3013-evidence-ties-docs-to-code-and-staleness-is-read-not-stored.md) | Evidence ties docs to code, and staleness is read, not stored | Accepted | 2026-11-22 |
| [3014](3014-a-topic-document-keeps-a-decision-log.md) | A topic document keeps a decision log, and only a decision changes it | Accepted | 2026-11-22 |

### Compute

| Number | Title | Status | Last updated |
|---|---|---|---|
| [4001](4001-connectors-run-in-a-shared-pool.md) | Connectors run in a shared pool | Accepted | 2026-11-19 |

### Development

| Number | Title | Status | Last updated |
|---|---|---|---|
| [5001](5001-tracking-is-reached-through-a-port-its-caller-owns.md) | Tracking is reached through a port its caller owns | Accepted | 2026-11-21 |
| [5002](5002-agents-reach-everything-through-one-text-space.md) | Agents reach everything through one text space and five verbs | Accepted | 2026-11-21 |
| [5003](5003-an-agent-with-a-disk-works-in-a-working-copy.md) | An agent with a disk works in a working copy | Accepted | 2026-11-21 |
| [5004](5004-an-agent-holds-a-small-core.md) | An agent holds a small core and learns the rest when it needs it | Accepted | 2026-11-21 |
| [5005](5005-a-repository-points-at-its-document.md) | A repository points at its document, and a hook offers onboarding once | Superseded by 5006 | 2026-11-22 |
| [5006](5006-the-estate-maps-a-repository-to-its-hub.md) | The estate maps a repository to its hub | Accepted | 2026-11-22 |

## Adding and changing a record

Copy `0000-template.md` to the next free number in its category. A number
is never reused. Status is Proposed, Accepted, Deprecated, or Superseded.
Strengthen a record in place while its decision stands, and update Last
Updated; when a decision is reversed, write a new record and mark the old
one Superseded by it. Update this index in the same commit.
