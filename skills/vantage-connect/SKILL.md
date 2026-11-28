---
name: vantage-connect
description: "Connect a source of truth so a document stays true: Orrery, Azure, Kubernetes, Cloudflare, Backstage, Jira, git, or any API. Use to bind boxes to real resources, set up a mapping, watch a repository for stale docs, or explain a dim or stale box."
---

# Vantage connect

Truth is observed, stories are written. A connector produces a batch of
entities and relations with provenance; a mapping turns the source's types
into a profile's types; `bind: <source>:<id>` on a node pulls the observed
facts, freshness, and drift checks into a hand-written diagram without
touching anything the author wrote.

## How a connector works

A connector belongs to one workspace; only that workspace's readers see it
and what it found. It runs outside the hub, as its own app (an OAuth
client), and reads exactly what that app may read. Scope the app to the
smallest set of resources the diagram needs; that is the boundary.

- **Kinds the runner knows** (`orrery`, `kubectl`, `cloudflare`,
  `azure-resource-graph`, `http`, `jira`, `github`, `git`): an author adds the connector to the
  workspace with its kind, settings, the app's client id, and `every`
  (minutes between runs), with `vantage_connector_save` (the connector
  tools are called through `vantage_tool`); the same tool
  changes one, naming only the fields that change. The hub's shared pool runs it on that interval,
  as its app. A `kubectl` connector reads as the machine it runs on, so it
  takes no interval and runs on a runner of its own (`connector run <id>`).
- **Push**: kind `push`. Anything that signs in as the app and POSTs the
  batch shape to `/api/v1/connector/<id>/batches`. Pipelines, scripts,
  webhooks. A Backstage catalog document is accepted as is.
- **Generic HTTP**: a URL, headers, a JSONPath or GraphQL selection, and a
  mapping with `{{path}}` templates. Most APIs need no code.

### Open items

A batch may carry what is open against entities: issues, firing alerts,
pull requests, incidents (`kind`, `title`, `url`, `severity`, `status`,
`updated`). On an entity they ride in its `items`; a source that tracks
work rather than things sends top-level `items`, each with a `target`: an
observed key (`{ key: <slug>:<id> }`, any connector of the workspace) or a
fact (`{ fact: repository, value: acme/shop }`, every bound entity whose
fact equals it or is a URL ending in it). A full batch replaces every item
of its source; an item it leaves out is closed.

- `orrery` reports firing alerts on the entity each is attached to
  (`alerts: false` turns it off). `filter` is an Orrery filter every
  blueprint is read with, and `filters` gives a blueprint its own; scope a
  workspace's connector to what the workspace is about, such as one
  program, rather than reading the whole catalog and narrowing each picture.
  `subtitle` names the field shown under a box instead of the key, and
  facts read by the hub's field titles and formats. `edges` turns a
  blueprint whose records link two things (a connection) into arrows with
  the evidence in their description; a record that reaches nothing runs to
  an amber `unresolved` stub. Containment relations stay relations too, so
  a picture can nest by another one (`observe.nest`). The guide has the
  settings and an example.
- `jira` runs one JQL query per mapping against Jira Cloud (REST v3); an
  issue names its thing by a label prefix (`label: "svc:"`) or a field
  (`field: components`), and points by `key` (a template with `{value}`) or
  by `fact`. `email` plus a `token` secret reference is basic auth; a token
  alone is a bearer token. Priorities map to severities; `severities`
  overrides.
- `github` reads open pull requests and issues of `repositories`
  (owner/name) and points them at the `repository` fact (`fact` renames it).
  Labels named for a severity, or mapped in `severities`, set it.
- `github`, and `git` on GitHub, sign in the same way. Prefer `app`: `{ id, privateKey,
  installation? }`, the GitHub App's id and its private key as a secret
  reference. Each run mints a one-hour token per repository, for that
  repository alone, asking for issues, pull requests, and metadata
  (`github`) or contents and metadata (`git`); install the app with those
  read-only. Without `installation`, each owner's installation is looked
  up, so one app installed on two owners serves both. `token`, a stored
  token by secret reference, is for an estate with no app. Never both.

### Code history

`git` reads the recent history of `repositories` on their default branch
(or `branch`): each commit and the files it changed, with the start of
each diff, `depth` commits back (200 by default), narrowed to `paths`
when given. It draws nothing. The hub keeps the history per repository,
and every document whose `docs.repository` names it reads
`workspace/document/stale`: the boxes and page sections whose evidence
files a later commit changed, with the diffs. Set `every` to how often
merges land (60 is usual). `guide#docs-that-stay-true` has the evidence
format.

- `forge` is `github` (the default; github.com, or an Enterprise server
  with `url: https://host/api/v3`) or `gitlab` (gitlab.com, or a
  self-hosted server with `url: https://host/api/v4`). A GitHub
  repository is owner/name; a GitLab project is its full path, groups
  included.
- On GitHub, sign it in as an app installed with read-only Contents and
  Metadata on only these repositories. On GitLab, `token` is a secret
  reference to a project, group, or personal access token with
  `read_api`; there is no app.
- Each commit's `Work: SW-12` trailers link it to those items as proof.
  A key no item has shows as a warning on the connector's run: read the
  run, fix the key in the commit rules, never guess it.

The boxes show a count and the panel lists the items. When a box should
show items and does not, check that its entity carries the fact the items
point at, or that the key matches its `bind` exactly. Exported pictures
draw the counts only for views with `openItems: true`.

Another workspace that wants the same data adds its own connector; it may
reuse the name and the app. With `CONNECTOR_APPROVAL`, an admin approves a
connector before its pushes are taken.

## Steps

1. Ask what the operator wants true: which boxes, which facts. Pick the
   smallest source that knows that. One source per concern.
2. Read the source's shape (an entity list, a resource type, a page of
   results) and write the mapping: source type to profile type, dotted field
   paths to fact labels, the parent template for containment. With the
   `azure` or `k8s` profile the common Azure resource types and Kubernetes
   kinds map on their own; name only the rest. Unknown types pass through
   with a warning; name them in the mapping rather than dropping them.
3. Run the connector now (`vantage_connector_run`, or Run now on the
   workspace's Connectors tab) and read the run with
   `vantage_sources` (workspace and connector): entities seen, appeared,
   vanished, mapping warnings, or the error it reported.
4. Bind the diagram: add `bind:` to the nodes that should follow the source.
   Validate. The side panel now shows source, observed time, the link, and
   what is open against it. `vantage render <file> --observed batch.json`
   draws the same overlay on a laptop from saved batches.
5. Set the freshness threshold for the workspace and look at the drift view.
   Declared but never observed, observed but never declared, facts that
   disagree: each is a sentence to act on, not a number.

## Rules

- Secrets by reference only. Never paste a token into YAML or a message.
  A pool connector's secret is a Key Vault secret URL its app may read
  (`https://<vault>.vault.azure.net/secrets/<name>`); never the hub.
- Narrow a picture with `observe.where` (subscription, resource group, any
  fact), not by widening or sharing the connector.
- Draw a logical or environment tree with `observe.nest` over the same
  connector, not with a second connector or a hand-drawn copy.
- Draw what connects to what from the catalog's connection records
  (`edges`), never as hand-drawn arrows the catalog already knows.
- Do not bind what the source does not actually know; a wrong bind is worse
  than none.
- When a connector and the author disagree, the author's narrative wins on
  the picture and the drift view says so. Do not silently overwrite.
