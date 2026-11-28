# Vantage platform specification

Vantage is a self-hosted diagramming platform. Diagrams are code; the engine
draws them; agents and people author them; connectors keep the facts true;
the hub serves, shares, versions, and publishes them. It replaces Lucidchart
and Visio as the place diagrams are made and read, and replaces Ilograph as
the interactive multi-view format, for one person and for a whole
organization alike. It also holds an estate's plan and its work: roadmaps
drawn on the architecture they change, and tracked items that people and
agents work, for any module that brings a kind.

This document is the plan of record. Every section below is a requirement.
Phases say in what order they land. The decisions section lists the choices
that were made for the operator to confirm or overturn.

## Decisions

| Decision | Choice | Why |
|---|---|---|
| Database | Postgres only, everywhere | One dialect, one migration path, one set of bugs |
| Identity | OIDC (Entra or any issuer), plus proxy mode behind an estate's front door | One sign-in model; proxy mode matches Orrery |
| Push shape | Vantage batch, a superset of Backstage catalog entities | Existing providers feed it; our extensions ride along |
| Hub location | This repository, `packages/hub`, `packages/connectors`, `packages/publish` | Engine and hub release together; one check gate |
| Deployment | One image, two deployments (web, worker) and an optional connector pool, one Postgres, one blob store | Stateless web pods scale by replica count; workers absorb bursts |
| Agents | Bring your own, over MCP on HTTP with OAuth; in the browser, revisions from comments and diagrams drawn from a description, on a model API the organization configures | The hub never provides a model; it calls one only with the organization's key and counts each person's use |
| Editing | YAML (in the browser's code editor or any agent) plus steering, never coordinates; pins for imports | Layout survives change; imports keep fidelity |
| Open source | The repository is public and estate-neutral; interfaces (push shape, connector, target) are its public surface | Any estate runs the same hub |
| Name | Vantage, to be checked before any external link carries it | Common product name |
| Decision records | A first-class hub record, in registries held by workspaces, beside the diagrams they govern | Records and diagrams kept apart go stale apart; VAN-3001 |
| Roadmaps | A fourth layer of the model, planned; items are hub records; status is read from proof, never typed | A plan kept apart from the picture shows neither what will be; VAN-3009 |
| Tracking | The hub tracks the item (kind, state, holders, history); the item's owner keeps the content | One layer for states and "my work" without becoming every module's database; VAN-3005 |
| Consistency with a module | Every action commits in one store; writes carry a key; the hub never calls a module | No distributed write, so no saga; VAN-3007 |
| Tracking API | Nine verbs over plain HTTP, keyed by the caller's own id, behind a port the caller owns | A module is never built around Vantage; VAN-5001 |
| First consumer | The agent; reading or changing anything costs it no more than a file on a disk, measured by the hub and held by a benchmark in the check gate | Agents do the work, and whole-thing tools made the hub dearer than a folder; VAN-0002 |
| Agent door | Everything is text at an address, reached by five verbs: outline, find, read, patch, write | A change sends what changed, and a new kind of content needs no new tool; VAN-5002 |
| Working copy | On a machine with a disk the agent edits files and the bridge syncs them; a path is always enough | No file passes through the model on its way to the hub; VAN-5003 |
| Standing cost | A core of seven tools and a few lines of instructions; other tools, the guide, and the schema are read by name when needed | A conversation that reads one record does not pay for the product; VAN-5004 |

## Vocabulary

- **Model**: entities, relations, containment, events, facts. One per
  diagram set. Three layers say what is: observed (connectors), declared
  (parsed from code), narrative (written by people and agents). Precedence
  narrative over declared over observed, per field, with provenance kept
  for every value. A fourth layer, planned, says what will be: the boxes
  and arrows roadmap items add, change, or retire. It never overrides the
  other three.
- **Set**: one `.vantage.yaml` document (with imports) and its views. Lives in
  one workspace. Versioned.
- **View**: one picture over the model. Kinds: relation, sequence, flow,
  page, lifecycle, and later entity, state, timeline. Every kind emits the same layout
  (boxes, edges, extras), so rendering, viewing, scoring, and export never
  depend on the kind.
- **Profile**: a vocabulary of types with roles, shapes, icons, and defaults.
  Data, not code. Built in: `bpmn`, `uml`, and the vendor profiles `azure`,
  `aws`, `k8s`. The built-in catalog applies to every document.
- **Gesture**: an arrangement a container takes: flow, grid, row, column,
  mirror, ring, outline, matrix, tiers. Primitives, not diagram types.
- **Pins**: per-view geometry for nodes and edge waypoints. Imported diagrams
  are pinned. Pinned boxes never move unless unpinned.
- **Connector**: produces a batch of observed entities and relations with
  provenance. Push, pull plugin, or generic fetch.
- **Mapping**: YAML that maps a source's types and fields to a profile's
  types and facts.
- **Bind**: a narrative node linked to an observed entity by stable id; it
  inherits facts, freshness, and drift checks.
- **Publication**: a set, views, formats, a target, a trigger, an audience.
- **Target**: a publish destination plugin.
- **Workspace**: the unit of ownership and sharing. Personal or team.
- **Item**: one piece of tracked work: a kind, a state, holders, dates,
  notes, links, and a history. A work item, a roadmap item, and a module's
  request are all items.
- **Kind**: a file that declares a sort of item: its key prefix, its
  labels, its roles, its parts, and its lifecycle. Data, not code.
- **Lifecycle**: a view whose boxes are states and whose arrows are moves.
  The hub refuses a move it does not draw.
- **Owner** (of an item): the system whose business the item is. It keeps
  the content; the hub keeps the item.
- **Label**: a flat display value an owner publishes on its item. Shown,
  sorted, and filtered, never understood.
- **Roadmap**: the items of the kind roadmap item in a workspace, and the
  views over them.

## Day-one guards

These are built in the first phase they can apply to and never deferred.

1. **Exit and backup.** Every workspace exports as a folder of YAML plus
   artifacts and imports from the same. Postgres holds versions and indexes
   of git-shaped truth, never the only copy.
2. **Audit log.** Every write records who, what, when, from which surface
   (browser, MCP, CLI, worker). Every publication run and every guest-link
   open is recorded.
3. **Secrets.** Connector and target credentials come from workload identity
   or external secrets where possible. Stored secrets are encrypted per org
   with a key from the environment, never logged, never returned by any API.
   The hub signs in to a managed Postgres as its workload identity when the
   server takes it (VAN-2003), so no database password exists.
4. **Safe rendering.** Markdown and connector text are sanitized before they
   reach the viewer, the standalone HTML, or an export. The viewer sets a
   content security policy. Standalone HTML embeds no remote script.
5. **Retention.** Versions and artifacts have a retention rule per workspace.
   A garbage collector removes unreferenced blobs. Deleted workspaces are
   disabled first and purged after a grace period.
6. **Observability.** Health endpoints, OpenTelemetry spans and metrics,
   structured logs, one JSON line per event: task start and end, key
   resolutions, branch decisions, outcomes with counts. Every job run has a
   readable history.
7. **Search.** Full-text across names, subtitles, facts, descriptions,
   questions, and view titles, scoped to what the reader may see.
8. **Notifications.** Drift found, review changed something, publication
   failed, comment addressed to you. Stored by the hub and delivered by
   Dispatch as events: a workspace addresses its own to people, Dispatch
   groups, or escalation chains, and every event carries the workspace's
   label for Dispatch subscriptions.
9. **Layout regression tests.** Golden renders of every example set compared
   in CI. A layout change that alters a golden fails the build unless the
   golden is updated in the same commit.
10. **Plugin evals.** Eval cases for the skills so the agent surface stays
    sharp as the language grows.
11. **Accessibility and mobile.** Keyboard navigation, labelled SVG elements,
    contrast in both themes, a reading layout on a phone.
12. **Language versioning.** `vantage: 1`. A breaking change bumps it and
    ships a migrator. The JSON Schema is published per version.
13. **Lifecycle of people.** When a person is disabled, their personal
    workspace gets an owner transfer and their guest links expire. Nothing
    is deleted on departure.
14. **Rate limits.** Guest links and the push endpoint are rate limited per
    token and per address.
15. **Stateless pods.** No local disk that matters, sessions in signed
    cookies, live fan-out through Postgres LISTEN and NOTIFY.

## The engine (packages model, layout, render)

Present: model with types, relations, views (relation, sequence, flow,
walkthrough, page, timeline, doc), story layer (facts, value, bullets, size, note, frames,
gestures, layers, paths, annotations, highlights, legend), compositor,
orthogonal router, labels, metrics, explore, SVG, PNG, standalone HTML.

Readability is the engine's job, not the author's. Without new authoring,
the engine keeps labels off box text, headers, chips, and other lines and
beside their own line, draws facing boxes with a straight line, straightens
kinks, keeps different lines a lane apart and off borders and swimlane
dividers, routes around container titles and count chips, widens boxes
instead of cutting text, draws a closed story path as a loop, adds a legend
when line styles mix (in as many columns as fit the view), narrows pages too wide to read, and opens every view
whole or at full width, or readable on its first story step when it is too
wide for either. The metrics count each of these, so a score reflects
what a reader sees.

Doc views are pages of prose in the same document: Markdown in a file the
version carries, or in the view. A page names boxes, views, and headings by
id and the viewer fills them in from the bundle, so a page's HTML depends
on its Markdown and the files it embeds: a save that changes a page redraws
no picture. A page embeds a picture from the web, or a file attached to its
own document by a path inside the document folder; the file reaches the
page as a data URL, so the viewer, the interactive HTML export, and an HTML
publication show it with nothing more to fetch. A path that leaves the
folder is refused. A page that names what does not exist, a file included,
is an error, and so is a doc view whose `file` the document does not
carry. Edits bring no files, so an edit that leaves a doc view reading a
file the document does not carry is refused (400) and saves nothing. Raw HTML in a page is shown as text. Exports and publications
of pictures (PNG, SVG, PDF, draw.io, Visio) leave doc views out. The check
also reads how well the pages cover the model and answers notes no save
refuses: a section that types a fact a box carries, a section of prose that
names no box and shows no view, and boxes no page names.

Required additions:

- **Provenance.** Every node, relation, and fact may carry `source`,
  `sourceId`, `observed`, `url`. The layer (`observed`, `declared`,
  `narrative`) is derived from the source. The viewer and the renderer read
  `observed` to draw freshness.
- **Bind.** `bind: <source>:<id>` on a node merges the observed entity's
  facts and provenance into the node. A source may send how a person reads
  each fact (`display`: the source's own label and its value formatted, such
  as "Cost last month: $1,152"); the box then shows that list, while filters,
  colors, and drift still read the raw facts. An author fact wins over the
  observed one it names, by key or by label.
- **Pins.** `pins:` per view: `{ node: {x, y, w, h} }` and
  `{ edge: [points] }`. Pinned nodes skip arrangement; unpinned nodes are
  placed in free space nearest their relations; pinned edges keep waypoints
  unless an endpoint moved.
- **Mental map.** When a node appears in two views and both are unpinned,
  the later view prefers a placement near the earlier one when the score is
  within a tolerance.
- **Shapes.** Ellipse, circle, diamond, parallelogram, triangle.
- **Edge styles.** `style: orthogonal | straight | curved`; arrowheads
  `open | filled | diamond | circle | none` per end for UML and ER.
- **Free text and images.** `kind: text` and `kind: image` nodes; images
  stored with the version and embedded in every export (SVG, PNG, PDF,
  draw.io, VSDX).
- **Custom icons.** A document's `icons:` block names picture files (SVG,
  PNG, JPG, GIF, WebP) as `pack/name` ids; a workspace in the hub holds an
  icon pack of its own. Lookup order: the document, the workspace, the
  shipped packs. A custom icon renders as one embedded picture, so an
  uploaded SVG never reaches the page as markup. Validation warns on an
  icon no source has and a file that is missing.
- **Title block.** Optional on SVG, PNG, PDF: title, subtitle, author, dates,
  version, live link, freshness stamp.
- **Palettes.** Per org brand palette and font; a color blind safe palette;
  a print palette.
- **View kinds.** `entity` (attribute rows, cardinality marks), `state`
  (flowchart shapes for states, guards on edges), `timeline` (lanes by
  owner, bars by date, milestones). Each is one layout module emitting the
  common layout.
- **Sequence.** Lifeline create and destroy; parallel columns.
- **Profiles.** `profiles/*.yaml` with types; `bpmn` and `uml` profiles
  with their shapes. Vendor profiles `azure`, `aws`, and `k8s` restyle the
  generic types with the vendor's icons and add one type per common
  service; a type may list the source types it `matches` (Azure resource
  types, Kubernetes kinds) so mappings and bound nodes find it without a
  table. A qualified name (`azure.keyvault`) reaches any profile type
  without listing the profile, for diagrams that mix vendors.
- **Exports.** PDF (page size, orientation, multi view, title block);
  draw.io XML and VSDX from the layout geometry; clipboard-ready PNG and SVG.
  A PNG holds at most 32 million pixels, so a render never takes more
  memory than a pod has: a larger view is drawn at a smaller scale with a
  warning, and one that would need less than half scale is refused with a
  clear error. SVG and PDF have no such limit.
- **Imports.** draw.io, VSDX, Lucid via VSDX: extract text, containment,
  connectors, colors, images into a narrative set with pins, inferred
  gestures and highlights as hints, and the original image attached as a
  reference. Vendor library icons (draw.io Azure, AWS, Kubernetes) match
  shipped icon ids by name; embedded pictures become files beside the
  document, as icons when small and picture nodes when large; the report
  lists what matched, what was kept, and what could not be.
- **Observe.** A node's `observe` block is filled from the observed layer
  on every render: the source's entities of the named types, nested by
  their containment or, per type, by a relation the block names (`nest`),
  so one source draws a physical, a logical, and an environment tree,
  bound, counted, and colored by a health fact. It can
  add a placement view and one failure view per domain, with what the loss
  takes down, whether a voting group keeps a majority, and which data kept
  in copies loses them, and a boundaries view that colors what no policy
  guards and lists the gaps per direction. It draws the relations it names,
  by label or tag, as arrows that keep the source's description, each
  relation in a color of its own when asked, and can keep
  only the boxes those arrows touch. Roles name the source's types; the
  engine names no vendor.
- **Drift view.** A view kind `drift` over the merged model: declared versus
  observed with highlights on disagreements and a narrative of the
  differences.
- **Visual diff.** Given two versions of a set, a diff layout per view:
  appeared, vanished, moved, relabelled, with a narrative.

## Connectors (package connectors)

### Push shape

```yaml
source: orrery              # source id, unique per org
observed: 2026-10-28T10:00:00Z
entities:
  - id: k8s-deployment:relay          # stable within the source
    type: workload                         # profile type, or a source type the mapping resolves
    name: Relay
    parent: k8s-namespace:relay        # optional containment
    facts: { image: ghcr.io/acme/relay:1.4.2, replicas: 1 }
    display:                               # optional: how a box shows the facts, in order
      - { fact: image, label: Image, value: ghcr.io/acme/relay:1.4.2 }
      - { fact: replicas, label: Replicas, value: '1' }
    url: https://orrery.example.com/e/k8s-deployment:relay
    tags: [workload]
    items:                                 # optional: what is open against it now
      - { id: a1f0c2, kind: alert, title: Relay has no ready replicas, severity: critical, status: firing }
relations:
  - from: k8s-deployment:relay
    to: k8s-service:relay
    label: serves through
    kind: sync
    description: 'Evidence: setting, telemetry. Calls in 7 days: 2,043.'   # optional: what a reader sees on click
items:                                     # optional: open items that point elsewhere
  - id: OPS-412
    kind: issue                            # issue | alert | pr | incident
    title: OPS-412 Relay drops long-lived connections
    url: https://example.atlassian.net/browse/OPS-412
    severity: high                         # critical | high | medium | low | info
    status: In Progress
    updated: 2026-10-28T08:15:00Z
    target: { key: orrery:k8s-deployment:relay }   # or { fact: repository, value: acme/relay }
```

Open items are what is open against an entity right now. On an entity they
ride in its `items`; a source that tracks work rather than things (Jira,
GitHub) sends top-level `items`, each pointed by `target` at an observed
key of any connector of the workspace, or at every bound entity whose fact
carries a value (equal, or a URL or path ending in it). Every field is
optional at the batch level, so a Backstage document and an older batch
stay valid.

A Backstage `Entity` document (`apiVersion: backstage.io/v1alpha1`) is
accepted by the same endpoint and converted: `kind` and `spec.type` become
the source type, `metadata.name` the id, `metadata.annotations` facts,
`relations` relations.

### Connector interface

```ts
export interface Connector {
  readonly id: string;                       // orrery, azure-resource-graph, kubectl, cloudflare, http
  readonly configSchema: ZodType;            // validated per instance; secrets referenced, not inlined
  keepFields?(config, fields): config;       // the config that also keeps these fields of these kinds
  discover(ctx: ConnectorContext): AsyncIterable<Batch>;   // pull; push connectors are the HTTP endpoint
}
```

A kind that reads only some fields answers `keepFields`: the connector
that feeds the scope tree is served a config that also keeps each scope
kind's facets and profile fields, so its own field list never hides them.

`ConnectorContext` gives the instance config, a secret resolver, a logger, a
clock, a cancellation signal, and what the connector kept from its last
run (`kept`, by key). A batch is the push shape. `fetchJsonTagged` keeps a
GET's answer with the tag its source named and sends the tag back next
time: a `304` reuses the kept answer, so a source that names tags is read
in full only when it moved.

A connector runs outside the hub. A connector with an interval (`every`,
in minutes) runs in the shared pool (`vantage connector pool`, the same
image): the hub's worker queues a `connector-run` job when the interval
comes round (spread over the interval by the connector's id), an author
queues one now (`POST /workspaces/:ws/connectors/:id/run`), and the pool
leases it over `/connector-pool/` as its own app, which carries the pool
role (`CONNECTOR_POOL_ROLE`) and acts as no connector. One run of a
connector waits and one runs at a time. The pool runs each lease as the
connector's own app, signing in with its workload identity token, which
every connector app trusts, so what a run reads is still exactly what its
app may read; the hub's own worker never claims a connector run. A kind
that reads as its machine (`hostIdentity`, such as in-cluster `kubectl`)
never runs in the pool. Memory follows runs at once, not connectors, and a
workspace holds at most `CONNECTOR_MAX_PER_WORKSPACE` connectors on
intervals of at least `CONNECTOR_MIN_EVERY_MINUTES`.

A runner of its own (`vantage connector run <id>`,
the same image) signs in to the issuer as the connector's own OAuth client
with the client credentials grant (a workload identity token file, or a
client secret), reads the connector's settings from the hub, runs
`discover` with the same identity, and pushes the folded batch. What a
connector may read is exactly what its app may read; the hub holds no
credential for it and never runs one. Secrets a kind names by reference
resolve as a Key Vault secret URL read as the connector's app, or, on a
runner of its own, from its environment. The hub's worker merges a pushed
batch into the observed layer, marks entities not seen as missing since,
and records the run. A runner that fails before it pushes reports the
failure, which is recorded as a failed run; a blocked connector's run is
one. A pooled run that fails where it cannot report, such as an app that
cannot sign in, is recorded as a failed run from the pool's word on how
the run ended, so every pooled run that fails leaves exactly one. Before a run the runner reads
what the connector kept (`GET /connector/:id/kept`), and after it pushes it
stores what the run read or wrote, gzipped, when it changed (`PUT`); the
hub keeps those bytes as one blob per connector, never reads them, and
removes them with the connector. An entry the run did not ask for is let
go. The runner's own scheduler (a
Kubernetes CronJob, a pipeline) decides when it runs.

First connectors: Orrery (`/v1/entities`, `/v1/entities/:bp/:key/related`,
bearer token on the machine surface; per blueprint, a type, a containment
relation (kept as a relation too, so a diagram can nest by another), the
fields kept as facts, which are the only fields it asks for, a subtitle
field shown instead of the key, and the hub's own filter, so a workspace
about one program reads that program alone; outgoing relations only, since
an arrow joins two entities it read; every page asked again with the hub's
tag; each fact labelled and formatted by the field's `title` and `format`
from `/v1/blueprints/:id`; an edge blueprint, whose records say one thing
reaches another, drawn as arrows instead of boxes, records between one
pair folded into one arrow whose description lists the evidence, and a
record that reaches nothing in the catalog drawn to an amber `unresolved`
stub named by what it tried to reach; each box linked to its entity's
page on the web address the hub names in `/v1/whoami`, or on the machine
address when an older hub names none), Azure Resource Graph (KQL per
subscription scope, workload identity), kubectl (in-cluster or kubeconfig;
Deployments, StatefulSets, Services, Ingresses, Namespaces, Nodes),
Cloudflare (zones, DNS records, tunnels, access applications), and the
generic HTTP connector (URL, headers, JSONPath or GraphQL, mapping).

Connectors for open items: Orrery also reads `/v1/alerts` and reports each
firing alert on the entity the Orrery hub matched it to; Jira (Cloud REST
v3, `POST /rest/api/3/search/jql`, one JQL per mapping; an issue names its
thing by a label prefix or a field and points by a key template or a fact;
basic auth with an email and an API token, or a bearer token, by secret
reference); GitHub (the open issues list of each repository, pull requests
and issues, pointed at the `repository` fact; it reads with a token by
secret reference, or as a GitHub App, minting an installation token per
repository each run from the app's private key, scoped to that repository
and to issues, pull requests, and metadata, so nothing is rotated by hand;
VAN-2007).

### Mapping

```yaml
source: azure-resource-graph
profile: infra
types:
  microsoft.web/sites: app
  microsoft.sql/servers/databases: database
  microsoft.network/virtualnetworks: network
facts:
  location: Region
  sku.name: SKU
parent:
  resourceGroup: azure:resourcegroup:{subscriptionId}/{resourceGroup}
```

Mappings are per org, editable in the hub, versioned.

## Publishing (package publish)

### Target interface

```ts
export interface Target {
  readonly id: string;                      // azure-blob, sharepoint, git, confluence, s3, webhook, teams, email
  readonly configSchema: ZodType;
  publish(ctx: TargetContext, artifacts: Artifact[]): Promise<PublishResult>;
}
```

An artifact is a rendered file (HTML, PNG, SVG, PDF, draw.io, VSDX) with its
view id, version, content type, and freshness stamp. `PublishResult` lists
what was written and where, for the run log.

Triggers: on save, schedule (cron, read on the wall clock in the hub's
`TIME_ZONE`), on demand from the viewer, MCP tool
`vantage_publish`, CI through the API.

Self-refreshing HTML: the standalone file carries the hub URL, set id, and
version. When the hub is reachable and the reader may view the set, the
viewer fetches the current bundle and swaps it in, updating the stamp.
Otherwise it shows the embedded copy and its publish date.

Embeds: `GET /embed/:workspace/:set/:view` serves the viewer in read-only
mode for iframes, with the org's allowed origins: its `frame-ancestors` is
the hub and the origins `EMBED_ORIGINS` lists, so no other site can frame
it. With none listed, only the hub frames it.

Voice walkthroughs are hub only: the standalone and self-refreshing HTML,
embeds, and exports carry no audio and no play control.

SharePoint note: modern pages do not run script from uploaded HTML. The
SharePoint target writes PNG, SVG, and PDF to a library and, for interactive
diagrams, points an embed at a storage account static site or at the hub.

## The hub (package hub)

### Surfaces

- **Web**: the viewer across every set the reader may see, the picker across
  workspaces, search, the steer panel, comments, versions and diff,
  publications, connectors, mappings, workspace administration.
- **API**: REST under `/api/v1`, OpenAPI published at `/api/v1/openapi.json` and readable at `/api`. Everything the web does. `GET /api/v1/guide` answers the authoring guide, so a writer over HTTP reads the same language agents get from `vantage_guide`.
- **MCP**: `/mcp` streamable HTTP with OAuth. The local tools plus workspace
  tools: list, read, save, edit, render, explore, history, diff, comments,
  people to mention, mentions, reactions, publish, search, connectors
  status. Edit applies a list of set, add, and
  remove operations by path to one version and saves once; the API has it
  as `POST .../documents/:doc/edits`.
- **Embed**: read-only viewer for iframes.
- **Connectors**: `GET /api/v1/connector/me` and `/connector/:id` return a
  connector's settings to its own client, and `POST /connector/:id/batches`
  takes its batch; `GET` and `PUT /connector/:id/kept` read and replace
  what the connector keeps between runs. The client presents an app-only access token from the
  issuer for the hub's audience carrying the connector app role
  (`CONNECTOR_ROLE`, default `Vantage.Connector`); the hub matches the
  token's client id (`azp`, `appid`) to the connector's.

### Tenancy and access

- Organization: one per deployment in phase 1; the schema carries `org_id`
  everywhere so a second org is a row, not a migration.
- Teams: from identity provider groups or managed in the hub.
- Workspaces: personal (one per person, created on first sign-in) and team.
  `TEAM_WORKSPACES=granted` keeps team workspaces to admins and the people
  an admin lets, so a hub for a whole organization does not sprawl. The
  sidebar offers a new team workspace to the people who may make one.
- Grants on a workspace: viewer or author, to a person, a team, or the org.
- Scopes (VAN-3017): the organization's tree of owners. A scope has one
  parent, a kind in the estate's own word (organization, division,
  department, team, program), a steward, and facets. The hub never invents
  levels; it only follows parents. A workspace names one owner scope, and
  one with none belongs to the whole estate. Where the tree comes from is
  the organization's setting: `source: hub`, where an admin keeps it, or
  `source: catalog`, where the catalog connector it names
  (`workspace/connector`) reads the organization's kinds (by default
  organization, department, team, and program), each one's parent by its
  containment relation, its steward by the relation the setting names per
  kind, and its facets from one field. Each run that stores what the
  connector read refills the hub's copy, and the hub refuses edits to it.
  Leaving the catalog keeps the copy for authors to keep. A scope carries
  its profile: the fields the setting names under `profile:` (by default
  `description`), read from its catalog entry or kept on the hub's scopes,
  each optional; one a scope leaves empty shows its nearest ancestor's,
  marked as inherited. The connector that feeds the tree is served a
  config that keeps those fields and the facets of each scope kind.
  `scopes/<id>` reads one scope with its profile, and
  a workspace's outline and page show its scope's. The tree is text
  at the address `scopes`, read and changed through the five verbs and
  the REST text routes; `GET` and `PUT /api/v1/scopes` and
  `PUT /api/v1/workspaces/:workspace/scope` answer and take the same. The
  tree and its source are an admin's to change; a workspace's scope is its
  owner's.
- Roles: org admin (everything), workspace author, workspace viewer, and
  a flag an admin sets on a person: may make team workspaces.
- A person's library (sidebar, home, Shared with you, search, the API's
  and MCP's workspace lists) holds the workspaces they own or were shared,
  the same for an org admin as for anyone. An admin reaches every other
  workspace from the admin console, and opening one says they are there as
  an admin. The API (`?all=true`) and MCP (`all`) list every workspace
  for an admin who asks.
- Moving a diagram to another workspace: the person must be able to
  delete it where it is and author where it goes (org admins always may).
  It keeps its id, versions, comments, stars, guest links, and
  walkthroughs; its publications follow it; it leaves its folder; the
  workspace icons it names are copied; it is drawn again with the new
  workspace's connectors. A slug the new workspace already holds is
  refused. Both workspaces' activity records the move.
- Deleting a diagram: an author may, as the workspace's delete rule says.
  `makers` (the default) lets the person who made the diagram; `authors`
  lets every author; `owner` lets no one else. The workspace owner and org
  admins always may, and only they change the rule. A delete takes the
  diagram's versions, comments, guest links, publications, and voice
  walkthroughs (their audio too) with it and cannot be undone; the audit log keeps it in the workspace's activity.
- Guest links: signed URL to one set or one view, with expiry, optional
  passcode, revocation, and an org policy that allows or forbids them:
  `GUEST_LINKS=false` makes none and opens none anywhere on the hub; a
  workspace may also turn them off for itself.
- Sign-in: `SIGN_IN_GROUPS` admits only people in one of the named groups,
  for an issuer that also signs in outsiders (an organization's invited
  guests).
- Publications: with `PUBLICATION_APPROVAL` a publication runs only once an
  admin approves it, and a change to what it sends or where takes the
  approval back. An admin may stop any publication; a stopped one never
  runs until an admin approves it again. Every run path (manual, MCP,
  on-save, schedule, and the job itself) asks the same rule. Exports by
  hand are not publications and need no approval.
- Connectors: each belongs to one workspace. Its authors add, change, and
  remove it; its readers see it and what it observed; nobody else does. A
  second workspace that wants the same data adds its own connector, which
  may use the same name and the same OAuth app; the two never share an
  observed model. With `CONNECTOR_APPROVAL` a connector's pushes are
  refused until an admin approves it, and a change to its kind, client, or
  settings takes the approval back. An admin may stop any connector.
- Admin console at `/admin`, built on what the hub keeps on disk: the
  version YAML with its imports and pins, the rendered pictures of every
  version kept, what connectors observed, voice walkthroughs, and
  workspace icons, summed per diagram, workspace, and owner.
  - The deployment: its bytes by kind, a map of every workspace sized by
    its bytes and colored by kind (team, personal, disabled), every
    workspace ranked by bytes with its owner, diagrams, views, and the
    people who can open it, every person with what they own on disk, the
    diagrams they own and made, and the other workspaces they can open,
    every connector coming in and publication going out (approve or stop
    each), what needs an admin, and the deployment's rules. A search
    finds workspaces, people, and diagrams by name.
  - A workspace (`/admin/w/:slug`): its bytes and share of the
    deployment, its diagrams as a map, who can do what (each grant
    against open and comment, edit, share, connectors and publications,
    delete under the workspace's delete rule, and set the rule), every
    diagram with its bytes, views, score, versions, comments, and who it
    reaches (move or delete each), its connectors and publications, its
    settings, and its latest versions. Open it, go to its Members page,
    disable or enable it.
  - A person (`/admin/people/:id`): what they own, the workspaces a grant
    lets them into with the role and the grant, and their rights (admin,
    team workspaces, disabled).
  - AI spend (`/admin/revisions`).
- Observed model: workspace scoped, through the workspace's connectors.

### Identity

- `AUTH_MODE=oidc`: authorization code with PKCE, Entra or any OIDC issuer;
  groups claim to teams; session in a signed, encrypted cookie. The client
  signs in with a secret or with a token file (a workload identity token
  the issuer trusts), for tenants that allow no client secrets.
- `AUTH_MODE=proxy`: trusted headers from the front door
  (`X-Forwarded-User`, `X-Forwarded-Groups`), as Orrery does behind an
  estate's sign-in.
- A browser opening a page never gets JSON. Signed out under OIDC, any
  page sends the reader through sign-in and back to the same address. No
  access, a missing diagram, or a fault shows a short page that says so.
  Scripts, API and MCP clients keep the JSON error.
- Tokens: personal access tokens (act as the person) and automation tokens
  (scoped to a workspace, author or viewer). A connector has no hub token;
  it signs in with its own OAuth client (Connectors, above). Agents obtain a personal token through device code flow, by
  signing in through the hub (below), or by pasting one. All tokens are hashed at rest, named, listed, revocable. A person
  makes, sees, and revokes their own on the Account page (`/account`),
  which also shows the ID their sign-in service gave them.
- The person's menu: their name and email at the foot of the sidebar open
  one menu with Account and tokens, the look (Auto, Light, Dark), sign
  out, and the release the hub runs.
- Connecting an agent: the sidebar's "Let an agent draw it" box shows the
  ways the hub's operators set in `AGENT_SETUP`, one per assistant the
  organization offers: a command to copy (a plugin install for Claude Code)
  or a link to open (the Copilot agent in Teams), or, for Claude Desktop,
  the hub address to paste as a custom connector. With none set it shows
  the MCP address.
- Agents sign in through the hub: the hub is the OAuth authorization
  server for its own `/mcp`, so an MCP client that signs people in (Claude's
  custom connectors) needs no registration at the identity provider. The
  resource metadata at `/.well-known/oauth-protected-resource/mcp` names the
  hub; `/.well-known/oauth-authorization-server` describes it. A client
  registers itself (RFC 7591) as a public client with https or loopback
  redirects; the person approves it on `/oauth/authorize`, behind the hub's
  own sign-in; the client trades the code and its PKCE (S256) verifier at
  `/oauth/token` for a personal access token that lasts an hour and a
  refresh token that rotates on every use and lapses after 30 days unused.
  A refresh token shown by another client revokes the grant. The person
  sees and disconnects each app under Connected apps on the Account page.
- Issuer tokens: with `OIDC_API_SCOPE`, `/mcp` also takes an access token
  the OIDC issuer signed for the hub with that scope, acting as the person,
  so an agent platform set up by hand to sign people in with the issuer
  (Copilot Studio) needs no Vantage token.

### Documents and versions

- A set is a document: YAML text, imports, attachments (the pictures,
  icon files, and Markdown pages the YAML names, and the pictures those
  pages embed, content addressed in blob storage), pins. A
  save lays new files over the head's by path and drops files neither the
  YAML nor a page names any longer. A file the save itself brings that
  nothing names is refused (400 naming its paths) and nothing is saved:
  a page needs a doc view whose `file` is its path; retention deletes a file when the last version holding it
  goes. Export writes the files beside the YAML; import reads them back.
- Every save creates a version with author, surface, message, and the parent
  version. Optimistic concurrency with a YAML-aware merge when the base
  differs; conflicts are returned as a diff.
- Pages save with the YAML (`pages`, path to Markdown) or alone
  (`PUT .../documents/:doc/pages`, `vantage_page`). When the head moved
  since the version the caller read, a page both sides changed is merged
  line by line like the YAML; the same lines changed on both sides is a
  409 that names the page. So a person's edit survives a generator that
  rewrites the page from an older read.
- Every save passes one gate (VAN-3004): the hub checks the
  document whole, pages included, as the version would hold it after any
  merge, and saves nothing when it has errors. The answer is 422 with each
  error's code, message, path, and line. Warnings save. Create, save,
  source save, edits, steer, page saves, restore, revision accept, drawing
  import, and the MCP save tools all write through it; a zip import names
  each refused file and imports the rest. `POST
  /workspaces/:workspace/check` runs the same check without saving and can
  answer each view's layout score.
- The head version's page text joins the document's search index when it
  is drawn: every heading, and the body up to a bound.
- An edit is a list of path operations applied in order to the version it
  names and saved as one version; if one fails, nothing is saved and the
  answer names it. Lines the operations do not touch keep their text and
  comments.
- A save queues a draw of the document's head; saves and source refreshes
  while one waits share it, so a burst draws once, and one document never
  draws on two workers at once. A version a burst passed over is drawn when
  a reader first asks for its artifacts.
- Every drawn version is rendered by a worker into artifacts keyed by version hash:
  the bundle's shell and one entry per view. The shell carries a layout
  kit (the relation views, their nodes, and the icons and pictures they
  draw) and lists the views by id and digest; the viewer reads each view's
  entry from its own address, which names its digest, so a browser keeps
  an entry it has and a save sends only the views it changed. The viewer
  lays out opened, folded, zoomed, and depth pictures from the kit in a
  worker in the browser.
  A render writes into its own folder and swaps its rows in one
  transaction. A view's SVG and PNG and the standalone HTML are made on
  first request. Serving reads artifacts, never lays out again.
- A render records the release that drew it; a reader opening a document
  drawn by an older release queues its redraw. Every view's digest names
  the release, so a new release would make the next save of each document
  lay out every view again. Instead the first worker of a new release
  redraws every document an older one drew, one at a time, in the
  background, before people save; it runs once per release and goes on
  where it stopped after a restart.
- A render takes the last render of the document as a cache: each view has
  a digest of what its picture reads, and a view whose digest matches is
  taken as it was, its stored entry and all. A save lays out only the views
  it changed. A relation view's digest reads the boxes it draws in full and
  the boxes it only holds by their place in the tree, so a source refresh
  lays out only the views whose pictures it changed.
- A save's draw goes ahead of a source refresh's, and both go ahead of a
  new release's redraw: the worker claims them in that order, and the
  render threads run their tasks in that order.
- A render is drawn in ranges of views side by side, one per render thread.
  A relation view breaks layout ties with the box centres the relation
  view before it left, so a range that starts mid-document starts from the
  centres the last render stored there; the render checks that guess
  against the centres that view has now and draws the range again where
  they differ. The pictures are always those one pass in order draws. A
  document drawn for the first time is one range.
- A save is heard by open viewers as it commits. While the hub draws it, a
  viewer reads the new version's layout kit and lays the view on its stage
  out itself, and the hub's picture replaces it when stored.
- **Target:** after a save, a reader sees the new picture within 4 s, and
  the objective is 1 s, on a hub's own workers. While a version draws,
  readers get the newest drawn version, marked as drawing, never a blank
  page. `vantage.render.first_picture.duration` measures it.
- Editing in the browser: an author opens Edit YAML in the viewer and
  the document's text opens in a code editor (CodeMirror, its own bundle,
  `editor.js`, loaded only when an author opens it) in place of the view
  list, with YAML highlighting, line numbers, and the checker's problems
  marked at their lines. A moment after typing stops, the hub draws the
  view from the edited text with the document's imports, pictures, and
  workspace icons (`POST /documents/:id/preview`, on the web's render
  threads), and the stage morphs to it; the editor shows the view's score
  and layout notes. Save makes a version with a message from the version
  the editor loaded (`POST /documents/:id/source`): a head that moved is
  merged, and when both changed the same lines the text comes back with
  conflict markers, which the author clears before the next save. A save
  heard from elsewhere while the author has changes is offered to merge
  into theirs (`POST /documents/:id/merge`) or to load; with no changes it
  loads. Readers never see the editor; the routes are for authors only.
  The New page uses the same editor.
- History shows versions with scores per view (a version a burst of saves
  passed over is scored once something draws it); diff shows YAML and the visual
  diff.
- Export: a workspace or a set as a zip of YAML and artifacts. Import: the
  same zip, or any `.vantage.yaml`.

### Collaboration

- Comments on a view or on any number of its boxes (nodes and groups):
  author, text, resolved by whom and when. In the viewer a person points a
  comment at the selected box, or picks boxes on the diagram; a click in
  empty space picks the nearest box, never a spot, because the layout moves
  after every edit. Agents list, add, and resolve comments through MCP.
- Mentions: typing `@` in the comment box offers the people who can read
  the document (the workspace's owner, its grants with teams expanded, the
  organization when it is granted, and org admins). A mention is stored in
  the text as `<@id>`, the person's stable user id, and shown as their name;
  a writer may send `<@email>`, which is stored as the id. A mention of
  anyone who cannot read the document refuses the comment with a 400 that
  names them. On add, and on edit for the people the edit newly mentions,
  each mentioned person gets a `mention` notification addressed to them
  alone, with a deep link to the view and the first box; when the workspace
  is connected to Dispatch it is sent there as a `vantage.mention` event
  addressed to their own email, without the request waiting on it. Workspace
  notification lists leave person-addressed rows out. The Mentions page
  (`/?show=mentions`, `GET /api/v1/me/mentions`, `vantage_mentions`) lists
  where the signed-in person was mentioned, in documents they may still
  read.
- Reactions for review sessions: a reader puts a thumbs up, "looks wrong",
  or a question on a box (a node or a group) in a view; one of each per
  person per box, toggled. The hub viewer draws the counts as a small badge
  on the box with who on hover; exported pictures never carry them. "Looks
  wrong" takes an optional sentence and files a comment on the box, so it
  enters the comment and revise flow. The Comments panel sums up the view's
  most flagged boxes. A box a later save drops keeps its reactions, marked
  orphaned. Reactions go to open viewers on the document's live channel.
  REST under `.../reactions` (list, add, remove) and `vantage_reactions`.
- Revisions from comments: with `AI_BASE_URL`, `AI_API_KEY`, and
  `AI_MODEL` set, an author ticks open comments on a view, picks a model
  the key may use, and sends them in one go. A worker job asks the model
  for edit operations through a forced tool call (Anthropic Messages for
  Claude models, OpenAI Responses for the rest), applies them to the base
  version as `vantage_edit` does, and asks once more when they do not apply
  or add errors. The proposal shows as a visual diff; accept saves it as a
  version, merged when the head moved, and resolves the comments it carried
  out; reject saves nothing. One revision runs per document at a time.
- Diagrams from words: with the same model API, the New page offers
  Describe it: the system in words, optional pasted notes, a model, and
  Generate (`POST /generations`). A worker job asks the model for a whole
  `.vantage.yaml` through a forced tool call, with the authoring guide the
  MCP server hands agents as its system context, checks the file and lays
  out every view, and asks once more with the errors and the layout notes
  when it has errors or a view scores under 60. The better answer opens in
  the editor as an unsaved draft for the author to adjust and create. One
  generation runs per person at a time.
- Spend on the shared key: every revision and generation records who
  asked, the model, its kind, and its tokens (fresh input, output, cached
  input read, cached input written), and the rows outlive their documents. The admin
  console's AI spend page shows a 12-month trend against the organization's monthly
  limit and each person's use in a picked month, split by model and
  kind (revise or drawn), with a
  CSV of it (`/api/v1/admin/ai-usage`, `/api/v1/admin/ai-usage.csv`).
  Admins set the limits there (`/api/v1/admin/ai-limits`): each person's
  daily and monthly tokens, the organization's monthly tokens, and any
  person's own limits or a block. Until an admin sets them,
  `AI_DAILY_TOKENS` is each person's daily limit and nothing else is
  capped. A day starts at midnight and a month on the first, in the
  hub's `TIME_ZONE`. A person sees what they have used, a warning past
  80% of any limit, and why a spent limit stops them.
- Steer panel: reorder, collapse, expand, hide, pick a gesture, pin or unpin,
  add a note or callout, write the question, bind to an observed entity.
  Each action is a YAML edit saved as a version.
- Live: browsers subscribe to the set; a save anywhere updates every open
  viewer in place through SSE fanned out by Postgres NOTIFY.
- Presence: the viewer header shows who else has the document open, as
  avatars with each reader's name and the view they are on. Each open tab
  posts a beat (`POST /api/presence?file=`) when it joins, when it moves to
  another view, step, or set of opened groups, and every 10 seconds; the
  hub stamps the reader's name on it and NOTIFYs the document's presence
  channel, a sibling of the save channel, so every pod passes it down its
  event streams as `presence` events. Nothing is stored. A tab that is not
  heard from for 30 seconds is gone; a tab hidden for 15 seconds leaves and
  joins again when shown; a closing tab sends a final leave. A tab that
  joins is answered by everyone, so it sees the room at once.
- Follow: clicking a reader follows them. The follower takes the leader's
  view, zoomed container, walkthrough or path step, opened and shut groups,
  and the region of the picture the leader sees, fitted to the follower's
  screen. The leader sends its camera at most five times a second, and
  only while someone follows it or it presents. A pan, a zoom, a step, or
  another view picked by hand stops following, and so does the leader
  leaving. A bar over the stage says whom the reader follows, with Stop.
- Present mode: full screen, one view per slide, walkthrough steps advance.
  A presenter's avatar is marked, and everyone else is offered "Follow".
- Guests on a guest link appear as Guest and may follow. They see display
  names only (a member without one shows as Member), and a link limited to
  one view hides where readers on other views are.
- Voice walkthroughs: on a walkthrough, or a view with numbered paths, an
  author presses Record on the story card and steps through while
  talking. The browser records the microphone with MediaRecorder (opus in
  WebM, or AAC in MP4 where WebM is not offered, as on Safari) and marks
  each step change against the audio. The author previews the take, records
  it again, or saves it. A saved recording is the audio in blob storage
  under `recordings/<org>/<id>` and a row naming the document, the view,
  the author, the length, the type, the version it was made on, and the
  step timeline (each mark: when, which path, which step, and the boxes it
  lit). `RECORDING_MAX_SECONDS` (default 900) and `RECORDING_MAX_MB`
  (default 50) bound a recording. Readers, guests included, see a play
  control on that story: the audio drives the steps, the seek bar moves
  both, and a step the reader picks moves the audio to the moment it was
  shown. A recording made on an older version still plays and says so; a
  step finds its place by the boxes it lit, and a step whose boxes are all
  gone is skipped, so the step before it stays up. A guest link limited to
  one view lists only that view's recordings. Authors delete them; deleting
  the document deletes them and their audio, and retention drops audio no
  recording names (a purged workspace's). REST: `GET` and `POST
  /api/v1/documents/:id/recordings`, `GET .../recordings/:rec/audio` (single
  byte ranges, 206), `DELETE .../recordings/:rec`; the viewer lists and
  streams beside its bundle (`/api/bundle/recordings?file=`) so guest links
  work; MCP `vantage_recordings` lists them. No transcript.

### Decision records

Architecture decision records live in the hub, next to the diagrams of
the systems they decide about (VAN-3001).

- **Registry.** A named, numbered set of records held by a workspace
  (`decision_registries`). Its prefix is two to twelve upper-case letters
  and digits, unique in the organization, and never changes; `ADR` is
  never a prefix. Its category scheme maps a leading digit to a name;
  the default is 0 Governance, 1 Infrastructure, 2 Security, 3 Data, 4
  Compute, 5 Development, 6 Operations. A category in use cannot leave the
  scheme. An organization registry sits in a shared workspace; each
  program's registry sits in the workspace its diagrams live in. Two
  registries may use the same number.
- **Record.** An immutable id (a ULID) and a four-digit number whose first
  digit is the category; the next number is one past the highest taken in
  the category (a record's number or one it held before it moved), under
  a per-registry lock. No number is handed out twice, except one freed by
  a discard (VAN-3023). A title; a status (Proposed,
  Accepted, Deprecated, Superseded) with supersedes and superseded-by
  links; the decision date, Last updated (today in the hub's `TIME_ZONE`
  when a write leaves it out), and the decision makers by name;
  Context, Decision, Consequences, and Alternatives considered (each with
  why it was rejected) as Markdown; related records; an optional position,
  the line it sets for its scope's standard (VAN-3018); and links to the
  boxes and views it governs (`decision_links`). The old `alignment`
  field is retired: a migration moved what it said into Context.
- **Living records.** A refinement is an edit in place that moves Last
  updated (`minor` keeps it, for a date or wording fix). A pivot is a new
  record that supersedes the old one, which keeps its body. Every write
  keeps the whole record as a revision (`decision_revisions`) and an audit
  entry, shown in the workspace's activity.
- **Discard.** A record's writer may take it back while nothing points to
  it (VAN-3023): no citation in a document or another record, no record
  that names it in Related or a supersede link, no item link, no alias,
  and no revision by anyone else. The record goes with its governs links,
  its revisions, and its own citations, and its number is free for the
  next record in its category. The audit log keeps an entry with its whole
  text, who discarded it, and when. Anything that points to it refuses the
  discard (409) with the list, and the record is deprecated or superseded
  instead. A dry run answers the same list and writes nothing.
- **Citations.** `SHOP-2001` everywhere; `ADR-2001` only inside a record
  of the same registry; `adr:<ULID>` as the machine form. A box cites
  records with `decisions:` in the YAML, and a page with
  `[[decision:SHOP-2001]]`; a save refuses a citation that names no
  record in the organization.
- **Citation index.** The hub keeps where each record is cited from
  (`decision_citations`, VAN-3002): every document save
  indexes the boxes and pages of the head it writes, every record write
  indexes the record's prose and Related, and each row names its target
  by ULID. A record's citation of a number nobody holds yet waits until a
  record takes it; a document cannot save one. Migrations backfill documents and records the index has not
  read.
- **Cited by.** A record's page, its REST read, and `vantage_decision`
  list each document (with its boxes and pages), each record, and what it
  governs. A reader sees only sources in workspaces and registries they
  can open; the rest are a count, never a name.
- **Moves.** A record takes a new number, the next number in another
  category, or a number in another registry, and keeps its ULID. Its old
  citation stays an alias that resolves (`decision_aliases`): old links
  redirect, search finds it, and a save accepts it and answers the
  citation it names now. No other record ever takes an old number. A move
  rewrites every citation the index knows of, as new document versions and
  record revisions by the mover, with an audit entry; a source the mover
  cannot write is reported and keeps resolving. A record that leaves its
  registry qualifies its own `ADR-NNNN` citations, and records left behind
  cite it qualified. A dry run reports and writes nothing.
- **Surfaces.** The workspace's Decisions tab lists a registry, filtered by
  category, status, and words; each record has a page at
  `/w/:workspace/decisions/:ref`, where body citations link their records
  and Cited by lists what cites it.
  The viewer badges each governed box with its count and lists the records
  in the box's panel. Search covers records. REST under
  `/api/v1/registries` and `/api/v1/decisions/:ref` (read, refine,
  supersede, history, `citations`, `move`, `discard`),
  `/api/v1/registries/:prefix/next` and `/import`, and
  `/api/v1/documents/:id/decisions`. MCP: `vantage_registries`,
  `vantage_decisions`, `vantage_decision`, `vantage_decision_create`,
  `vantage_decision_update`, `vantage_decision_supersede`,
  `vantage_decision_move`, `vantage_decision_discard`,
  `vantage_decision_next`, `vantage_decision_import`.
- **Import.** Markdown records (Nygard, MADR, a metadata table, front
  matter) come in with their number, dates, status, decision makers, and
  supersede and related links. A title loses the citation it starts
  with (`ADR-0007:`, `SHOP-2001:`). Nothing the author wrote is dropped:
  text between the title and the first section and a note under Status
  open the Context; alternatives come one per `###` heading or one per
  bullet; Related keeps its prose and links under its own heading when
  it says more than which records, and References always does. A
  section it cannot place is kept under Decision as a heading of its
  own; everything it could not map is reported per file. A dry run writes nothing; a second run skips records
  already there.

### Standards

A scope's standard is built from the positions of its records, never kept
by hand, and published in editions (VAN-3018). The code is
`packages/hub/src/standards/`.

- **Position.** A record's `position:` block: the line (at most 200
  characters), a binding word and who it binds from the estate's lists,
  whether it is locked, its reach (`below`, `facets`, `paths`), and what
  enforces and checks it. Only an accepted record in a team workspace
  brings its line in, to the scope of its registry's workspace; one with
  no scope gives the whole estate's (`standard/estate`).
- **Build.** A scope holds its own lines, every line its parent's edition
  passes down (all but `below: false`), and every line whose facets it
  carries, each with its path; a record that reaches twice keeps its
  nearest path. Lines group by area, the record's category name. Packs
  reach down the same way. Every write that can change a build rebuilds
  every scope, parents first: a record (in its own transaction), the tree,
  a workspace's scope or state, a registry's categories or workspace, the
  settings, or a page that cites a line.
- **Editions** (`standard_editions`). A version per scope counting from 1,
  a SHA-256 hash over the body (lines, packs, exceptions, pages), a change
  list against the last, and a manifest (scope, name, kind, steward, the
  editions it built on). A published edition never changes. Packs travel
  as pins (id, version, hash, `starter` or `estate`, parameters, on or
  off), never their bodies; procedure pages travel by address.
- **Gates.** The machine gate runs on every build: lists, line length,
  every `checked_by` covered by a pack that reaches, a pack reaching once,
  no personal workspace, no withheld word. A failed build is kept as a
  refused edition with its reasons; the last stays in force. With the
  steward gate on, a scope's own changes wait as a pending edition for its
  steward or an admin (`vantage_standard_publish`); what comes from above
  publishes at once.
- **Surfaces.** `standard` is the estate's settings (bindings, binds,
  `steward_gate`, `withhold`, `packs` per scope) as YAML; the lists are an
  admin's and a scope's packs its steward's. `standard/<scope>` is the
  newest edition as Markdown and `standard/<scope>@<n>` edition n; both
  are read-only. REST: `GET` and `PUT /api/v1/standards`,
  `GET /api/v1/standards/:scope`, `POST /api/v1/standards/:scope/publish`.

### Roadmaps and work

The hub holds an estate's plan and its work. Phases 10 to 13 built the
core, the roadmaps, agents on items, and modules through a port; phase 10
built
kinds, items, their events, the move gate, access for people named on an
item, the nine verbs, the change feed, the agent's text form and action
tool, and the work pages. Phases 11 to 13 land the rest, in the order
VAN-0001 sets. The code is `packages/hub/src/tracking/`.

- **Item.** An immutable id (a ULID) and a key people say: the kind's
  prefix and a number (`ER-31`), unique in the organization. A kind, a
  workspace, a state, who asked, who holds it, dates, notes, files about
  the work, links (came from, part of, a box, a view, a decision), and a
  history. For an item another system owns: that system's own key, the
  content revision the state is about, and the labels it published. The
  hub never reads a module's content (VAN-3005).
- **Events.** Every change to an item is one appended event; a
  current-state table is written in the same transaction and can be
  rebuilt from the events. History, the change feed, and the audit trail
  read the events. Each event has a position that only moves forward
  (VAN-3006).
- **One commit point.** Content commits in its owner; state commits in
  the hub. A submit is a saved, numbered, unchanging revision and then
  one keyed call to the hub. Every write carries an idempotency key. The
  hub never calls a module and sends nothing when an item moves; what
  follows a move reads the feed from its own bookmark
  (VAN-3007).
- **Kinds and lifecycles.** A kind is a file: a Vantage document with a
  `kind` block (prefix, labels of text, number, money, date, or choice,
  roles, parts, the lifecycle view, and an optional shipped base), and
  saving the document registers it. A lifecycle is a
  view of kind `lifecycle`: states in four classes (not started, in
  progress, done, parked), and moves that name who may make them and what
  they need. One gate refuses every move the view does not draw. A parent
  state can be worked out from its parts. A state can have a page, and
  the view shows a live count per state. The hub ships work item,
  roadmap item, and milestone (VAN-3015).
- **Roadmaps.** A roadmap item names its outcome, who owes it, a horizon
  (now, next, later), its place in that horizon, a start and an end, what
  it waits on, the milestone it works toward, the decision it came from,
  the boxes and arrows it adds, changes, or retires, and its proof. Every
  list, board, and outline of a kind shows its items by horizon, then by
  place (a fractional rank, so a move rewrites one row), then newest
  first; a person drags a card to its place. An end before a start is
  refused. A parent's span is worked out from its parts and never stored.
  A milestone is a dated item that items of any kind link toward; it ships
  when they all have, and its card rolls them up with the items at risk
  of its date. Board, timeline, and table views read the same items; the
  timeline draws bars, points, and milestone markers. The hub works out each
  item's state from its proof and shows the proof's age; no surface takes
  a typed status. Planned boxes draw on the real views, and a view can
  show today or after a horizon. Outside trackers are read through
  connectors and never written (VAN-3009).
- **Agents.** A queue an agent asks for what it may pick up; a claim that
  expires and is renewed while the run works; one run record per run on
  the item, with proof and reported cost; a handoff note; a question that
  makes the item wait for a person (VAN-3010).
- **Access.** A workspace grant, or being named on the item: the person
  who asked, a holder, or a person a waiting move's role resolves to.
  Being named shows that item only, and a role's person may also claim
  it and finish its run. Every list, search, count, feed read,
  tool, and page embed judges the caller (VAN-2008). A
  module makes a person's move as that person, with a token the issuer
  gives it for them, and its own reads and writes under an app role
  scoped to its kinds (VAN-2005). The hub knows a person by
  the issuer's id for them, so a browser, a front door, and every
  module's token reach one user (VAN-2006).
- **API.** Nine verbs over HTTP: describe, put, move, hold and release,
  note and attach, get, find, changes, link. Each names an item by the
  caller's own key. An agent's work is forms of them: a claim and its
  renewal are holds, a question is a move, finishing a run is a release
  that carries the run record, the queue is a find, and a Markdown
  roadmap is a put of many. get and find take the fields wanted; a put
  changes a body by edits. Versioned and never broken; the web pages and
  agent tools call the same verbs (VAN-5001).
- **Agent cost.** An item reads as a card of a fixed size, with its
  notes, history, and links as parts. An event never carries a body. A
  roadmap is read as rows and changed by naming what changes; several
  items change in one call. A list is asked for by field and by page and
  is filled after the access check. A refused move answers the moves that
  are open. A claim is renewed by the bridge and by the run's own calls,
  never by a turn of the model. Finishing an item is one call. The guard
  on each is in the record that decides it (VAN-0002).
- **Catalog.** The hub pushes an inventory of its workspaces, members,
  documents, and items to the estate's catalog. The catalog lists them;
  the hub stays their home.
- **Not in the hub.** A module's fields, layouts, and exports; notices to
  people about work; anything that runs because an item moved.

### Docs that stay true

- A document's `docs` block is its contract: `kind` (system, standard,
  concept), `repository` (host/owner/name), `audience`, required `pages`,
  `checks` every save enforces as errors (no-copied-facts,
  sections-name-boxes, name-every-box, evidence), and `rules` for the
  writer. VAN-3012, VAN-3014.
- `artifacts:` lists files under `artifacts/` the document keeps and
  versions and never draws, any type, up to the file limit; renders skip
  the folder. Read back as text at `workspace/document/artifacts/<file>`
  or as bytes from `GET /api/v1/text/file`. VAN-3011.
- `evidence:` ties a box, view, page, or page section to repository files
  at a commit. A `git` connector reads a repository's recent history
  (`changes` on a batch), signed in the way the `github` connector is,
  with an app token scoped to contents and metadata (VAN-2007); the
  hub keeps the latest per repository, and
  `workspace/document/stale` lists every tie a later commit touched, with
  diffs, worked out on read. VAN-3013.
- A repository points at its document with `vantage.yaml` (document,
  decisions, roadmap, work, watch; `vantage: false` declines). The estate
  maps the repository to its hub and workspace in
  `~/.config/vantage/repos.yaml`, by its remote, most specific match
  first; a hub and workspace in `vantage.yaml` win, for an estate's own
  repositories. It keeps no records, roadmap, or diagrams of its own. The
  plugin's session-start hook offers onboarding once in every repository
  that is not wired, and `vantage-onboard` does it; the import package
  reads Mermaid and PlantUML for brownfield projects. VAN-5005 and
  VAN-5006.
- A program keeps its documents, registry, and kinds in a workspace of its
  own. `vantage_workspaces` makes one; `vantage_move` moves a document (with
  the kind it defines and its items) or a registry there. The same move
  gives a document a new slug, in its own workspace or the new one. A moved
  or renamed document's old address is kept in `document_aliases`: its
  page redirects, and a tool that names it is told the new address.

### Freshness, drift, review

- Every observed value carries `observed`. The viewer dims boxes older than
  the workspace's freshness threshold and badges declared-but-never-observed
  and observed-but-never-declared.
- Open items are stored per connector (`observed_items`, one row each). A
  full batch replaces every item of its source; an item it leaves out is
  closed and its row goes. A document reads the items of every connector
  of its workspace that point at a key it binds or a fact a bound entity
  carries, and a push whose items point past its own entities queues an
  overlay for every bound document of the workspace. The overlay copies
  them onto the bound node, worst first, each marked stale when its last
  report is past the threshold; a render digest keeps the stale mark, not
  the time.
- The drift view renders disagreements with highlights and a narrative.
- Scheduled review: a worker job that re-validates every
  set, computes score and drift deltas, and files notifications. When an
  agent is connected and the workspace allows it, the job hands the review
  to the agent through MCP as a comment thread it can act on.
- A connector has a slug, unique in its workspace; every observed key is
  `slug:id`, and a document binds to a connector of its own workspace by
  that prefix. A push queues an overlay for every document of the
  connector's workspace whose head binds to it; the overlay re-renders the
  head version in place, dims past the workspace threshold, and stores the
  drift report. An `observe` block may narrow what it draws with `where`
  (facts an entity must carry).
- One mapping is in effect per connector: the first by name that validates.
  A connector's secrets stay with its app (Key Vault) or its own runner;
  publication secrets live in
  the sealed store by name (`PUT /api/v1/secrets/:name`).
- A publication run that fails is a recorded run and a notification, not a
  retry; the schedule or a person queues the next one.
  `REVIEW_CRON` sets the nightly review minute; `TIME_ZONE` names the
  estate's zone, in which every day the hub fills in falls, every
  schedule reads its wall clock, every time the hub shows a person is
  given with the zone's short name, and an AI token limit's day and
  month reset; `EMBED_ORIGINS` lists the
  organization's allowed origins: the sites that may frame an embed, and
  that a published HTML copy may fetch the live bundle from.

### Scalability

- Web pods stateless; the chart runs 2, and a larger estate runs 3 or more.
- Workers are their own deployment, never inside the web process, because
  a render stalls every request in that process. `WORKER_EMBEDDED` runs one
  in the web process for local development only. Job table in Postgres with `SKIP LOCKED`.
- Artifacts belong to one render; a client revalidates them by a tag that
  names the render.
- Live fan-out through Postgres LISTEN and NOTIFY; Redis is a later option.
  Presence rides the same mechanism on its own channel per document, with
  no state on the pods: beats are rate limited per tab session, and an
  expired tab is dropped by the viewers that stop hearing it.
- Rendering is CPU bound and runs on render threads in workers, once per
  version and per change in what its sources show. Every other drawing the
  hub does (drift views, visual diffs, previews, publications, the MCP
  render, explore, and validate tools) runs on the web's render threads,
  with a deadline and a bounded queue, never on the event loop.
- Jobs hold a lease while they run; a job whose worker died goes back to the
  queue. A document has at most one queued overlay. Run history is pruned
  by age; observed items a source stopped reporting are dropped after a
  retention.

### Deployment

- One image: `ghcr.io/orchard-suite/vantage`. Entrypoint selects `web`, `worker`,
  `migrate`, or `connector`.
- Helm chart in `deploy/helm/vantage`: web, worker, and connector pool
  deployments, service, ingress, network policy, disruption budget,
  autoscaler, a secret the estate brings or the chart generates, Postgres
  through CloudNativePG or an external one, nightly dumps, and blob storage
  on a shared volume or in Azure Blob.
- Health: `/healthz` (liveness), `/readyz` (ready unless the pod is stopping; reports the database and blob checks).
- Configuration by environment variables, validated at start with a schema;
  the process refuses to start on a missing or malformed value.

## Viewer

Present: an overview page at the bare route (the description as Markdown
and a card per view), picker, search, pan and zoom, hover, focus by
reachability, side panel, cross-view links, walkthroughs, hash routing,
light and dark, SVG export, morphing. On the hub, light or dark is a setting on the person's
account (Auto follows the system): the hub pages and every diagram they
open wear it on any device, and flipping it in the viewer changes it
there too.

Required additions, in order:

1. Open or fold a group where it stands (click its title): the rest of the
   picture keeps the reader's other changes, so groups open side by side.
   Zoom into a group (the panel's Zoom in, or Z): the view re-resolves with
   that group open and the rest folded to stubs; back returns, and the
   reader's changes are as they were. The viewer lays these out itself, in
   a worker, from the bundle's layout kit. None of it is saved.
2. Runtime detail control: collapse depth below the participants, per view,
   not saved.
3. Per view re-parenting: `parent` overrides in a view, and a contexts
   switch in the viewer when a set defines them.
4. Step through a path: badges become a stepper; the rest dims.
5. Facts, notes, provenance, and freshness in the side panel; a bound box's
   open items as a count on its corner, colored by the worst severity, and
   listed with links in the panel. Static exports (SVG, PNG, PDF,
   publications, the viewer's SVG download) draw the counts only for a
   relation view with `openItems: true`.
6. Present mode.
7. Minimap on large views.
8. Steer panel, comments with mentions, and reactions on boxes (hub only);
   Edit YAML beside the picture for authors (hub only).
9. Visual diff display (hub only).
10. Accessibility: focus order, ARIA labels from the bundle, contrast check.
11. Presence and follow (hub only): avatars of the readers here in the
    header, follow a reader or the presenter, a bar to stop, a frame in the
    leader's color around the stage while following.

## Agent surface

- The plugin ships one MCP server, on the laptop. Alone it serves the local
  tools with file access. After `vantage login <hub url>` (the device code
  flow) it also lists the hub's own tools and passes their calls to the
  hub's `/mcp` with that machine's token; the local tools keep working
  when the hub cannot be reached.
- Skills: `vantage-brief`, `vantage-author`, `vantage-review`, plus
  `vantage-connect` (configure a connector and mapping from a description
  of a source), `vantage-publish` (set up a publication), `decide`
  (write and migrate decision records, reading the estate's registries
  from its config), `vantage-work` (take an item from the queue,
  claim it, ask a person when stuck, and finish the run), and `roadmap`
  (plan a roadmap at its level and the ones above and below it, reading
  the estate's rules from its config).
- Eval cases per skill under `evals/`.

### Agent cost

The agent is the first consumer, and a local disk sets the bar
(VAN-0002). Phase 9 built it. Before it, at v2.29.0 on a
hub in use: the tool list was 40 tools and 40,163 characters, the guide was
52,157 sent whole, the connect instructions were 1,907, and the largest
document was 88,596, read whole to change one box. After it: the tool list
is 8 tools and 7,351 characters, the instructions 878, and the guide is
read by topic.

Every MCP host in use passes the connect instructions to the model:
Claude Code puts them in the conversation, VS Code attaches them to the
server's tools, and Codex reads them and asks that the first 512
characters stand alone. The first paragraph is that self-contained lead.

- **Measured.** One wrapper runs every tool and records the tool, the
  characters it took, and the characters it answered, as a log line and
  as metrics by tool. No conversation is named.
- **Benchmark.** Fixed tasks, kept as data under `scripts/bench/`, run
  against the hub and against a disk and are counted in characters and
  calls: find one fact; change one sentence in a box, a view, a page, a
  record, and an item; look at one view; bring in a folder of records;
  take an item and finish it; answer a plain question across the hub;
  find the standard that binds a repository; read a scope's built
  standard, one area of it, and check the one held is current. A task's
  budget is its disk cost. The check
  gate runs it.
- **Budgets.** One file holds them (`packages/mcp/src/budget.ts`). The
  standing budgets were set at what the rebuilt surface measured; a change
  may lower one, and raising one changes VAN-0002. The
  benchmark is `scripts/bench/agent-cost.ts`, and the check gate runs it
  as `agent-cost.test.ts`.
- **Dashboard.** An estate's Vantage board shows agent calls and
  characters in and out by tool, from `vantage.agent.calls` and
  `vantage.agent.chars`.
- **Text space.** Every thing has an address and one text form that loses
  nothing: `workspace/document` (YAML), `workspace/document/pages/x.md`,
  `SHOP-2001`, `SHOP`, `~` (the person's own workspace), `scopes`,
  `scopes/<id>`, `standard`, `standard/<scope>`, `guide`, `schema` (a workspace never takes
  one of the hub's own words as its slug); a part after `#` is a heading,
  a YAML path, or a line range. Registry prefixes, kind prefixes, and
  workspace slugs share one namespace (VAN-5002).
- **Five verbs.** `outline` (names and sizes, never text), `find` (lines
  with address and line number under each thing's link, or a count;
  across the hub records first, then documents and pages, personal
  workspaces left out unless named, and a miss answered as counts per
  thing with the call that reads more, VAN-5008), `read` (one or many
  addresses or parts, bounded, with the version held answered as
  unchanged), `patch` (an exact string replaced once, or set, add, and
  remove by path; many edits across many things in one call; one version
  per document), `write` (the whole text of a new thing or a rewrite).
  Every write passes the strict save. Render, validate, explore, export,
  and drift take an address.
- **Text routes.** `GET /api/v1/text/list`, `text/read`, and `text/file`,
  and `POST /api/v1/text/write`, read and write the same text for a
  program; the working copy syncs through them.
- **Working copy.** On the laptop, checkout writes a document, a
  registry, or a workspace to a folder as files, with their versions kept
  in one file beside them (`.vantage.json`). The agent edits with its own tools. Sync sends
  what changed, pulls what moved, and writes a conflict into the file
  with markers. Every content argument also takes a path, and every tool
  that makes a file can write it to one (VAN-5003).
- **Small core.** Always listed: the five verbs, render, and validate,
  and on a laptop checkout and sync. Every other tool is listed and called
  through `vantage_tool`, by group (`packages/mcp/src/catalog.ts`). A host
  that loads tools on demand itself asks for every tool:
  `/mcp?tools=all`, or `VANTAGE_TOOLS=all` on the laptop. The
  connect instructions teach the climb in a few lines. The guide and the
  schema are text at addresses, read by topic. Every error names the
  guide topic that explains it. No two tools carry the same field list
  (VAN-5004).
- **Removed in the same release:** `vantage_workspaces`,
  `vantage_documents`, `vantage_read` by workspace and document,
  `vantage_save`, `vantage_page`, `vantage_edit`, `vantage_search`,
  `vantage_guide`, `vantage_schema`, `vantage_decisions`,
  `vantage_decision`, `vantage_decision_create`, and
  `vantage_decision_update`. `vantage_edit`'s operations are patch's path
  form; `vantage_history` takes an address.

## Phases

Each phase lands green, releases, and leaves a working product. Status as
of v0.0.8: phases 1 through 6 and 8 are landed; phase 7 is landed except the
steer panel, comments UI, and visual diff display, which are in review.
Known gaps are listed under each phase.

1. **Engine: truth and fidelity.** Provenance, bind, pins, mental map, title
   block, shapes, edge styles, text and image nodes, profiles as data,
   palettes. Golden render tests. Language versioning and migrator skeleton.
2. **Hub core.** Postgres schema and migrations, config schema, logging and
   telemetry, OIDC and proxy auth, tokens, org, teams, workspaces, grants,
   documents, versions, artifacts in blob, render worker, job table, web
   viewer across workspaces, search, audit log, retention and GC, export and
   import of workspaces, health, image, Kustomize base. Remote MCP. Live
   updates. Document files and workspace icon packs. Gap: workspace icons
   are managed through the API and MCP; no web page yet.
3. **Connectors.** Push endpoint with the push shape and Backstage
   conversion, connector interface and worker scheduling, mappings, Orrery,
   kubectl, Cloudflare, Azure Resource Graph, generic HTTP. Freshness in the
   viewer. Drift view. Notifications. Gap: sources, mappings, and
   publications are set up through the API and MCP; admins approve and
   stop publications on the Admin page.
   Rate limits are per pod.
4. **Publishing.** Publication records, stamp, self-refreshing HTML, embed
   route, targets: Azure Blob, git, webhook, SharePoint, Confluence, Teams,
   email. Scheduled review job.
5. **Viewer completion.** Open and fold groups in place, zoom into a group,
   detail control, re-parenting, path stepper, side panel facts and freshness, present mode, minimap,
   accessibility. Gap: re-parenting is a view field (`reparent`), not yet a
   runtime switch in the viewer.
6. **Diagram families.** Entity, state, timeline view kinds; bpmn and uml
   profiles; sequence create, destroy, parallel; PDF; draw.io and VSDX
   export; clipboard. Entity and state diagrams are relation views with the
   `uml` profile and ER arrowheads rather than separate kinds. Gap: parallel
   columns in sequences beyond the `par` fragment.
7. **Collaboration.** Comments on boxes, steer panel, visual diff, guest
   links, notifications for comments, revisions from comments, voice
   walkthroughs.
8. **Imports.** draw.io, VSDX, Lucid via VSDX, with pins, inferred hints,
   and reference images. Bulk import of a folder. Gap: sequence pages
   import as text.

9. **Agent cost.** The door that measures every call, the benchmark and
   its budgets in the check gate, the address module and the five verbs
   over documents, pages, and records, tools that take an address, the
   working copy and paths on the bridge, the small core with tools on
   demand, the guide and schema by topic, and errors that name their
   topic. The whole-thing tools went in the same release. Phases 10 to 13
   build on it: each kind of content they add brings a text form, an
   outline, and its benchmark tasks. Landed.
10. **Tracking core.** Items, events and the current-state table, kinds
    as documents with a `kind` block, lifecycle views with the move gate,
    the nine verbs with idempotency keys, access for people named on an
    item, the change feed, the item text form and `vantage_item`, and the
    Work tab and item page. Landed.
11. **Roadmaps.** The roadmap item kind moved only by its proof (parts,
    proof items, and proof boxes a connector sees), reported done without
    machine proof, the proof's age on cards and rows, board, timeline, and
    list views, rows by horizon for agents, import from Markdown by path,
    the plan on the picture (`adds`, `changes`, `retires`) with the horizon
    switch, the live count on each state of a lifecycle view, and an
    item's live state in a page (`[[item:KEY]]`). Then an order inside a
    horizon (`place`), a start and an end with a parent's span from its
    parts, and milestones that items link `toward`. Landed.
12. **Agents on items.** The queue, claims that expire and renew on any
    call and from the laptop's bridge, finishing a run in one call (run
    record, move, release), handoff notes, questions that make an item
    wait for a person, items in the working copy, `vantage_queue` and the
    item actions, and the `vantage-work` skill. Landed.
13. **Modules through a port.** App roles scoped to kinds (`POST
    /api/v1/apps`, the `Vantage.Module` role), a person's act recorded
    with the module's client it came through, kinds files loaded from a
    pipeline (`PUT /api/v1/kinds/:prefix`), tickets in an outside tracker
    read as proof through a connector, and a hard delete as an event.
    Landed, except the pusher to the catalog, which needs the catalog's
    blueprints for workspaces and items first. A module in production
    moves only after the six gates in VAN-0001.

## Blind spots

- Lucid bulk export: whether the account has an admin bulk export or needs
  per document VSDX export. Unverified.
- Lucid import of draw.io files: believed supported, unverified.
- SharePoint embed policy: which origins a tenant allows in the embed web
  part. Unverified per tenant.
- The product name.
- Tracking: speed of lists and the feed at size. Unmeasured until the
  gate in VAN-0001.
- Tracking: how long events of closed items are kept. Not decided.

