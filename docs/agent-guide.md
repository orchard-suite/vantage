# Vantage authoring guide

Vantage draws software and infrastructure diagrams from a YAML file. You write
the model and the stories. Vantage draws the pictures and tells you how good
they are. You never write coordinates.

## The three parts of a file

```yaml
title: Shop Architecture
author: Ada Example
updated: 2026-10-26
description: >-  # Markdown; leads the document's overview page
  What the set covers and who it is for, in a short paragraph.

nodes:          # the cast: everything that exists, as a tree of boundaries
relations:      # the truth: who talks to whom, tagged so views can pick
views:          # the stories: each view answers one question with arrows
```

## Nodes

A node is a box. Children make a boundary around their parent.

```yaml
nodes:
  - name: Shoppers           # human label, two or three words, title case
    type: users              # built-in type: sets icon, color, shape, role
  - id: azure                # optional; default is the slug of name (shop-api)
    name: Azure
    type: cloud
    subtitle: sub-shop-prod  # the machine name or technology, under the name
    children:
      - name: Orders API
        type: api
        subtitle: ASP.NET 10
        description: Owns orders. Shown on hover and in the side panel.
        icon: azure/app-service   # override the type's icon with pack/name
        tags: [tier-1]
```

Rules that make the picture good:

- Group by logical meaning, not by resource type. Show the seams: cloud,
  subscription, resource group, cluster, namespace, tier, team.
- Flat is unreadable. Three levels of nesting is normal. The engine lays out
  each container on its own, so nesting is free.
- `name` is for a human. The full machine name goes in `subtitle`.
- Use the right type. The icon is the type signal.
- `count: 3` draws a multiplicity badge instead of three boxes.
- `style: { frame: dashed }` marks a logical grouping that is not a real
  container; `frame: none` draws only the title and the children, for an
  outline or a loose group. `style: { emphasis: high }` thickens the border.

### What a box can say

A box is not only a name. It can carry the facts a reader would otherwise
have to look up, and that is what makes a view worth keeping open.

```yaml
  - name: Production
    type: subscription
    facts: ["Cost center: 3301", "Criticality: Medium", "Address space: 10.50.120.0/21"]
    note: Billing approval sits with the platform lead.   # a sticky beside the box, in every view
    children:
      - name: Budget
        type: note
        value: $3,000          # one big figure; the name becomes its caption
        subtitle: per month
      - name: Audit Logs
        type: storage
        bullets: [Append only, Seven year retention, No PII]
      - name: Key Vault
        type: secret
        size: icon             # a big icon with a caption and no box: the inventory look
```

- `facts` are `Label: value` lines inside the box. Use them for ids, cost
  centers, address ranges, SKUs, owners, dates.
- `value` is one big figure. A box with a value is a card: price, count,
  quota, a hostname.
- `bullets` are short lines. Three to five, never a paragraph.
- `size` sets the presentation: `compact` for inventories of many peers,
  `large` for the hero of a view, `icon` for an icon with a caption and no
  box.
- `note` pins a sticky beside the box wherever it appears.

Shapes come from the type; `shape:` overrides: box, rounded, pill, cylinder,
queue, hexagon, document, cloud, person, ellipse, circle, diamond,
parallelogram, triangle. Two content types draw no box: `type: text` is
free text on the canvas (long names wrap), `type: image` with
`image: logo.svg` (a path relative to the document, or a URL) and
`imageWidth` and `imageHeight` is a picture with the name as caption.

Built-in types: actor, users, system, service, app, web, mobile, desktop, cli,
api, gateway, loadbalancer, cdn, dns, firewall, tunnel, function, job, worker,
agent, model, database, cache, storage, queue, topic, search, secret, identity,
monitoring, config, registry, repo, pipeline, gitops, cloud, subscription,
resourcegroup, region, zone, network, subnet, cluster, namespace, pod, vm,
host, device, container, package, component, class, interface, file, socket,
external, group, note.

Local types extend built-ins, profile types, and qualified profile types:

```yaml
types:
  Edge: { extends: azure.frontdoor, color: violet }
```

Profiles add whole vocabularies. `profiles: [bpmn]` brings pool, lane,
task, usertask, servicetask, subprocess, gateway, exclusive, parallel,
event, startevent, endevent, timerevent, messageevent, dataobject,
datastore. `profiles: [uml]` brings class (facts are attributes, bullets
are operations), abstract, interface, enum, package, state, initial, final,
choice, actor, usecase, component, node, artifact. Local types may extend
profile types. A profile is a YAML file in the engine, not code.

### Infrastructure: vendor icons

An infrastructure diagram shows the real service icons. Three profiles carry
them:

- `azure`: managementgroup, tenant, policy, entraid, appregistration,
  enterpriseapp, managedidentity, entragroup, keyvault, appservice,
  appserviceplan, functionapp, staticwebapp, containerapp, containerappenv,
  containerinstance, aks, acr, virtualmachine, vmss, disk, logicapp, batch,
  storageaccount, blob, fileshare, sqlserver, sqldatabase, sqlmi, cosmosdb,
  postgres, mysql, redis, servicebus, eventgrid, eventhub, datafactory,
  databricks, synapse, aisearch, openai, appconfig, vnet, nsg,
  privateendpoint, privatelink, dnszone, publicip, natgateway, bastion,
  vpngateway, expressroute, virtualwan, appgateway, frontdoor, waf, apim,
  nic, routetable, loganalytics, appinsights, grafana, backupvault,
  recoveryvault, defender, sentinel, costbudget, automation, devops,
  signalr.
- `aws`: organization, account, iam, identitycenter, cognito, kms,
  secretsmanager, ec2, autoscaling, lambda, ecs, fargate, eks, ecr,
  apprunner, beanstalk, batch, stepfunctions, s3, efs, ebs, rds, aurora,
  dynamodb, documentdb, redshift, elasticache, sqs, sns, eventbridge,
  kinesis, msk, opensearch, glue, athena, bedrock, sagemaker, vpc,
  publicsubnet, privatesubnet, apigateway, elb, cloudfront, route53, waf,
  networkfirewall, transitgateway, directconnect, privatelink,
  globalaccelerator, cloudwatch, cloudtrail, xray, systemsmanager,
  cloudformation, codepipeline, backup, guardduty, securityhub.
- `k8s`: deployment, statefulset, daemonset, replicaset, cronjob, svc (a
  Kubernetes Service), ingress, configmap, pvc, pv, storageclass,
  serviceaccount, role, clusterrole, rolebinding, hpa, networkpolicy, crd,
  node.

Two ways to use them:

- A diagram of one cloud lists it: `profiles: [azure]`. Its types are then
  plain names (`type: keyvault`), and the generic types take that cloud's
  look too: `secret` draws a key vault, `database` an Azure SQL database,
  `subscription` and `resourcegroup` their Azure icons. A box that is not
  that cloud's service (an in-cluster secret operator, a GitHub repo) keeps
  its generic look with an explicit `icon: generic/key`.
- A diagram that mixes vendors lists no vendor profile and names each type
  with its profile: `type: azure.keyvault`, `type: aws.cloudfront`,
  `type: k8s.namespace`. Everything else stays generic.

Any node or type can still set `icon:` directly. Packs: `generic/*`
(Lucide), `azure/*` (Microsoft architecture icons), `aws/*`, `k8s/*`,
`brand/*` (logos: github, cloudflare, grafana, proxmox, and more). Ask the
icon search when unsure; validation warns about an icon no pack has.

A node bound to a source (`bind:`) with no `type` and no `icon` draws the
icon its source type matches, so an Azure resource or a Kubernetes object
shows its own icon without one written down.

### Your own icons and pictures

A logo, a product mark, or any picture the packs do not have is a file
beside the document, named under `icons:` with a pack name of your own:

```yaml
icons:
  acme/logo: assets/acme-logo.svg   # SVG, PNG, JPG, GIF, or WebP; a path relative to the document, or a URL
  acme/edge: assets/edge.png
nodes:
  - { name: Acme Portal, icon: acme/logo }
  - { name: Edge Box, icon: acme/edge, size: icon }   # the picture with a caption and no box
```

The id works everywhere an icon does: on a node, on a local type, with
`size: icon`. A workspace in the hub may also hold an icon pack every
document in it can name (the `vantage_workspace_icons` tool, through
`vantage_tool`); a document's own `icons:` win over the workspace's, and
both over the shipped packs. On a machine with a disk, put an icon by its
`file` path; with no disk, send its bytes as `data`.

In the hub, the files a document names travel with it. In a working copy
they are files in the document's folder, and `vantage_sync` sends a new one.
With no disk, pass them to `vantage_write` as `assets`. The document's
outline lists the files attached. A write without `assets` keeps the files
already attached; a file the YAML stops naming is dropped.

## Relations

A relation is an arrow. It is the only thing a diagram is made of. Nodes are
the cast; relations are the story.

```yaml
relations:
  - from: web-app
    to: [orders-api, catalog-api]   # lists fan out
    label: calls                    # a verb phrase. Never "connection", "link", "data"
    kind: sync                      # sync | async | data | deploy | auth | observe | manage
    tags: [requests]                # views include relations by tag
    description: REST over HTTPS, retried three times.
  - from: orders-api
    to: order-worker
    via: [order-events]             # drawn as hops through the via nodes
    kind: async
```

Arrow styles: `style: orthogonal` (default) bends at right angles,
`straight` draws a line centre to centre, `curved` bows. Arrowheads per
end for UML and ER: `heads: { from: diamond, to: open }` with `open`,
`filled`, `diamond`, `circle`, `none`. `weight: 2` thickens the line.

A relation between a container and something inside it is implied by the
box and is not drawn; the validator tells you. Point the arrow at a sibling
or at the outside thing instead.

Relations may connect containers, not only leaves. `apps -> platform:
"reads secrets"` is a real relation and often the most useful one.

Relations come from evidence (code, config, logs), never from plausibility.

## Views

Every view answers one question and answers it with arrows. A view with no
relations is an inventory, not a story, and the linter says so.

### Relation view

```yaml
views:
  - id: requests
    title: Requests
    group: Overview               # picker group; nest with " / "; views keep file order inside
    question: How does a purchase travel through the system?
    include: { tags: [requests] } # relations from the model by tag
    relations:                    # plus relations declared only here
      - from: shoppers
        to: front-door
        label: browse and buy
    direction: right              # or down
```

What is drawn: the participants of the view's relations and their ancestors.
Nothing else. Siblings that are not in the story become a "+3 more" badge on
their parent. That is what keeps views clean.

Controls, all optional:

- `extends: [requests, data]` composes other views into one picture: their
  relations, arrangements, and nodes join, so what they share is drawn once
  and connects them. A parent's `hide` or `collapse` carries over only where
  no other parent draws what it would remove; the view's own lists always
  apply.
- `hidden: true` makes the view a part: a building block other views
  `extends`, never a page of its own. Parts stay out of the picker, present
  mode, and whole-document exports until a reader turns on "Show parts".
  Build one part per concern (the identity edges, the billing edges, the
  base of a workload) and compose pages from parts. Name a part by what it
  carries, not where it is used.
- `include.nodes: [x]` shows a node without a relation; `include.subtree: [y]`
  shows everything inside y.
- `collapse: [data-tier]` draws a container as one box and retargets its
  relations to it. Use it for a high altitude view: in the interactive
  viewer a reader can still open any group where it stands, several side
  by side, or zoom into one. That never changes the file.
- `expand: [apps]` opens a container fully even when only one child is in the story.
- `detail: 1` shows one level below each participant.
- `hide: [x]` removes a node and its relations from this view only.
- `arrange:` per-container hints when the automatic choice is wrong:

```yaml
    arrange:
      - node: data-tier
        as: grid            # auto | flow | grid | row | column | mirror | ring | outline | matrix
        columns: 2
      - node: root          # the canvas itself
        direction: down
      - node: apps
        order: [web-app, orders-api]   # pin the first children; the rest follow
        gap: 80                        # the least space between children
```

`gap` is a floor. In a flow, grid, row, or column, the space between two
children grows to hold the arrows that cross it: a lane per arrow and room
for the widest label. Many arrows between two columns spread out on their
own; never raise `gap` to fix a crowded gutter.

### Gestures: the shape of the sentence

A view answers a question, and the answer has a shape. Say the sentence to
yourself and pick the gesture that matches it. These are the primitives;
combine them freely, one per container.

| The sentence sounds like | Gesture | What to write |
|---|---|---|
| "A goes to B goes to C" | flow | `as: flow` (the default when children have arrows) with `direction` |
| "these are the peers" | grid, row, column | `as: grid` with `columns`, or `row`, or `column` |
| "prod on one side, test on the other, the same shape" | mirror | `as: mirror` with `order: [prod, test]` and `divider: true`; the halves flow toward each other |
| "everything hangs off this one thing" | ring | `as: ring` with `center: hub`; the others sit around it |
| "first these, then those, then those" | tiers | `layers: [[a, b], [c], [d, e]]` on a flow; named children sit in the tier you say |
| "this folder has these, which have these" | outline | `as: outline`; children stack and indent; give the container `style: { frame: none }` |
| "every row is a category and every column is a stage" | matrix | `as: matrix` with `matrix: { rows: [tags], columns: [tags] }`; children land by their tags |
| "here is the catalogue" | inventory | `size: icon` on the children and `as: row` or `grid` on the parent |
| "these two belong together" | highlight | `highlights: [{ nodes: [a, b], label: Public }]` keeps them adjacent and frames them |
| "this is in both sets" | overlap | one highlight whose members live in two containers; the frame crosses the boundary |
| "it happens in this order" | path | `paths:` with numbered steps and a narrative (below) |
| "several small pictures make one argument" | page | a `kind: page` view with panels |

There is no diagram type. A network view might be a ring with a mirror
inside it and a path across it. A cost view might be a grid of cards with
values and one highlight. Pick the gesture the sentence wants, then look.

### Paths: numbered journeys

A path is a sequence of arrows with a number on each and a sentence for
each. The numbers go on the picture; the sentences go under it. A path can
name arrows the view already has, or add them.

```yaml
    paths:
      - title: A redirect from the legacy host
        color: blue                  # optional; each path gets its own
        steps:
          - { from: user, to: browser, text: The user opens the old address. }
          - { from: browser, to: dns, text: DNS resolves both hosts to Front Door. }
          - { from: dns, to: front-door, id: 3a, text: The rules engine matches the legacy host. }
          - { from: front-door, to: browser, id: 3b, text: It answers 301 to the new host. }
    narrative: true                  # default when paths exist
    legend: true                     # default: a legend of line styles appears when the view mixes them
```

Use `id` for branch steps (`4a`, `4b`). A first path that comes back to
where it started, through four or more top-level boxes, is drawn as a loop:
the box it passes through clearly most often sits in the middle, and the
rest go round it in path order. Give the canvas an `arrange` to keep a
layout of your own; `legend: false` turns the automatic legend off. The
legend sets its items in as many columns as fit the view, one under another
in a narrow one, and the canvas widens to hold it. Two paths on one view get two
colors and two narratives: the happy path and the failure path, or the
first request and the cached one.

### Notes, callouts, and prose

```yaml
    annotations:
      - { text: Only public entry point., at: front-door, kind: callout, side: top }
      - { text: Z: is a temporary drive for moving files in and out. Not for persistent storage., at: nfs-mount }
      - { text: Why two subscriptions, kind: heading }
      - { text: Test and prod are separate so budgets and blast radius stay apart. }
```

A note with `at` sits beside its box (the engine picks the free side and
arrows go around it). `side` is a preference: a note never sits on the
straight path an arrow wants, so it moves to the next free side rather than
bend the arrow around itself. A `callout` is plain text with a leader line. Text
without `at` becomes a heading or a paragraph under the picture, in order.

### Highlights

```yaml
    highlights:
      - { nodes: [test-rg, uat-rg], label: Deployment operator scope, color: red }
      - { nodes: [cmp-web, vog-web], label: Public, style: band, color: amber }
```

Members are kept next to each other and framed. `style` is `frame`
(outline), `band` (translucent fill), or `tint`. A highlight whose members
sit in two containers draws across both: that is how to say "in both sets".

### Pins: keeping an imported layout

A view may carry `pins`: exact geometry for boxes and waypoints for arrows,
written by an import or set on purpose. Pinned boxes never move. Unpinned
boxes are placed in free space beside the boxes they talk to, and a
container grows in place to hold what lands inside it. A pinned arrow keeps
its waypoints while both of its ends stay put. Remove a pin, or the whole
`pins` block, and the engine lays that part out again.

```yaml
    pins:
      nodes:
        browser: { x: 40, y: 200, w: 140, h: 60 }
        front-door: { x: 300, y: 80, w: 160, h: 60 }
      edges:
        "browser>front-door": [{ x: 180, y: 230 }, { x: 240, y: 230 }, { x: 240, y: 110 }, { x: 300, y: 110 }]
```

Never write pins by hand for a new diagram. They are for fidelity to a
picture that already exists.

### Importing from draw.io, Visio, and Lucidchart

`vantage import <file> --out <dir>` (or the `vantage_import` tool) reads a
draw.io file (`.drawio`, `.xml`, compressed pages included) or a Visio
`.vsdx` and writes `<name>.vantage.yaml` beside a copy of the original as
`<name>.original.<ext>`. Lucidchart has no reader of its own: in Lucid use
File, Export, VSDX, then import that file.

What comes out:

- Every box with text is a node. The first line is the name, a short
  second line the subtitle, `Label: value` lines are facts, lines that
  start with a bullet are bullets. Boxes drawn inside a bigger labelled box
  are its children, from the file's own parents or from geometry. Shapes
  without text are dropped and listed, unless they are a picture.
- Every connector between two kept boxes is a relation: its text is the
  label, dashed lines are `kind: async`, curved and straight lines keep
  their `style`, and arrowheads map to `heads` (crow's feet included).
- Every page is a relation view named after the page, with `pins` for every
  box and for every connector that bends. The picture stays as drawn.
- Gestures the picture suggests become hints the author reviews: `arrange`
  with `row`, `column`, `grid`, `mirror`, or `ring`, and `highlights` for
  frames drawn around siblings. Every inferred hint is in the report.
- A box that appears on several pages with the same name, subtitle, and
  parent is one node shown in several views.
- Vendor icons from draw.io's Azure, AWS, and Kubernetes libraries become
  our icon ids. An icon shape with a label becomes `size: icon` with that
  icon; a small picture drawn inside a labelled box becomes that box's
  icon.
- Embedded pictures (draw.io images, Visio pictures, which is how Lucid
  exports its icons) are written as files under `assets/` beside the
  document. A small one becomes an icon under `icons:`; a large one a
  `type: image` node.

The report lists pages, counts, hints to review, dropped decoration, the
vendor icons matched, the pictures kept as files and the ones that could
not be kept (Windows metafiles no browser draws), unmapped styles, and
warnings. Read it, then fix what the importer could only guess: node types
(it sets shapes, colors, and icons, never types),
relation labels that were missing in the drawing, and hints you disagree
with. Keep the pins while you want the old picture; remove them when the
model is good enough to be laid out on its own.

### Page

```yaml
  - id: dns-poster
    kind: page
    title: DNS, Routing, and Mappings
    columns: 2
    panels:
      - { heading: Public DNS, text: Public requests resolve in the global zone., view: public-dns, span: 2 }
      - { heading: Private DNS, text: One private zone per environment., view: private-dns }
      - { heading: Enterprise AD, view: ad-dns }
```

Panels sit in columns; each embeds a view under its heading and prose. A
page whose columns would be too wide to read drops columns and grows
longer instead.

### Doc: a page of prose

A doc view is a page a person reads: a guide, a runbook, a specification.
It is Markdown in a file beside the document, and it sits in the picker
with the pictures. A page never copies the model. It points at it, so a
renamed box renames itself in every page, and a box or view that goes away
is an error the checker reports, the way a relation to an unknown node is.

```yaml
  - id: how-an-order-works
    kind: doc
    title: How an Order Works
    group: Guides
    question: What happens between a shopper pressing Buy and the money moving?
    file: pages/how-an-order-works.md   # a path relative to the document; or `text:` for a short page
    beside: requests                    # optional: a view kept beside the prose
```

In the Markdown:

| Write | To |
|---|---|
| `[[orders-api]]` | name a box; it shows the box's name, its description on hover, and opens the picture that draws it |
| `[[orders-api\|the API]]` or `[the API](node:orders-api)` | name a box in your own words |
| `![How a purchase flows](view:requests)` | embed a view's picture as a figure |
| `![The sign-in screen](assets/sign-in.png)` | embed a picture attached to the document, by its path inside the document folder (`./assets/sign-in.png` works too) |
| `![The status page](https://example.com/status.png)` | embed a picture from the web |
| `[the request picture](view:requests)` | link a view |
| `[the API on the request picture](view:requests/orders-api)` | link a view with a box selected |
| `[rule R-0019](view:rules#R-0019)` | link a heading of any page |
| `[above](#arrive)` | link a heading of this page |
| `## The shopper arrives {#arrive}` | give a heading its anchor; without one it takes a slug of its words |
| `[[decision:SHOP-2001]]` or `[why](decision:SHOP-2001)` | cite a decision record; on a hub it links to the record |

Rules that make a page good:

- Name every box you mention with `[[id]]`. That is what ties the words to
  the pictures: with `beside`, the boxes a section names light up on the
  stage as the reader scrolls to it, and a box's panel lists the pages
  written about it.
- Embed a view where a picture answers faster than a paragraph. Use
  `beside` when the whole page walks one picture.
- Give every heading a reader may be sent to a stable `{#anchor}`. A
  generated page (a specification, a catalog) anchors each item by its id.
- Never type a fact a box already carries (a SKU, an address range, an
  owner). Name the box; the reader sees its facts on the picture.
- A screenshot or a photo is a file attached to the document: put it
  beside the document (an `assets/` folder is usual) and embed it by its
  path. Never list it under `icons:` to keep it: a file a page embeds is
  the document's own, and a save keeps it while any page names it. The
  path stays inside the document folder; `..` and a leading `/` are
  refused. A page that names a file the document does not carry, or one
  that is not a picture (svg, png, jpg, gif, webp), is an error.
- Pictures from the web embed as usual (`![alt](https://...)`). Raw HTML
  is shown as text.

`vantage_validate` reads how well the pages cover the model and answers
three notes. No save refuses them unless the document's contract says so.

| Note | What it found | The fix |
|---|---|---|
| `doc-copied-fact` | a section types a fact a box carries, such as its SKU or address range | name the box with `[[id]]` |
| `doc-section-unnamed` | a section of prose (25 words or more) names no box and shows no view | name the boxes it is about, or embed the view that answers it |
| `doc-box-unmentioned` | boxes with no children that no page names | name each in the page that explains it, or drop it |

In a hub, a page is text at its own address:
`workspace/document/pages/overview.md`. Outline it for its headings, read
one section with `#heading`, and change a sentence with `vantage_patch`. A
new page is written with `vantage_write`, in the same call as the YAML
that names it: a doc view whose `file` the document does not carry is an
error every save refuses, and so is a page no doc view names. A picture a
page embeds is a file in the working copy, or goes in `assets` once: one
already attached stays while a page still names it, and goes with the save
that stops naming it. A page someone else changed since you read it is
merged line by line; when both changed the same lines the conflict comes
back and nothing is saved.

### A second tree over the same resources

`reparent` moves nodes under other containers for one view only. The
model keeps its true tree; the view shows another one. Use it for the
"by team" view of a "by platform" model, or to lift one node onto the
canvas.

```yaml
  - id: by-team
    title: By Team
    reparent: { vault: platform-team, grafana: root }
```

### Drawn from a source: observe

A node with `observe:` is filled by the hub from a source (a connector of
the document's own workspace) on every render, so a picture of a fleet
stays true without anyone writing its boxes. It names roles over the
source's own types; nothing in it is vendor-specific.

```yaml
  - id: lab
    name: The lab
    observe:
      source: catalog                # the source slug
      types: [hv_cluster, hv_host, it_hardware, hv_vm, k8s_node, k8s_pod]   # outermost first
      prune: [it_hardware]              # drawn only when something sits inside
      names: { hv_vm: VM, k8s_pod: pod }   # words for the counts
      health: health                 # a red or amber fact colors the box
      closed: [k8s_node]             # start closed; default the type outside the innermost
      group: Live                    # picker group of every view it adds
      view: { title: Where everything runs }
      failure:
        domains: [hv_host, it_hardware]
        quorum: { type: k8s_node, fact: roles, contains: etcd, name: etcd }
        copies: { type: k8s_volume, relation: nodes }
```

Each entity becomes a box bound to it, so it carries facts and freshness
like any bound node, and sits inside its nearest drawn ancestor. A box
that holds only one box of the same name (a VM and the node it runs) is
drawn once. Boxes count what is inside them. `view` adds a placement view
(leave it out when another view draws the same boxes)
whose closed boxes open on click. `failure` adds one view per domain: the
domain is tinted, a note says what it takes down, and the text under the
picture says whether the voting group keeps a majority and which data
loses every copy or keeps one. `boundary` colors the innermost boxes by
the policies that apply to them, through the policy type's relation and the
fact listing the directions it governs: a member with no policy for the
`guard` direction is red, its container amber or red, and a boundaries
view lists the gaps for every direction. It shows intent, not traffic.

```yaml
      boundary: { policy: k8s_network_policy, relation: workloads, fact: policy_types, guard: Ingress, title: Network boundaries }
```

`relations` names the observed relations drawn as arrows between the
boxes. An entry is a relation label or a tag the relation carries, or
`{ label, color, only }`. A source tags an arrow by the kind of record it
came from: an Orrery edge blueprint (below) tags its arrows with the
blueprint id, so `relations: [sw_connection]` draws them all, each labelled
by what it is (`sql`, `storage`) and carrying the source's description,
which a reader sees on click. `color`
draws that relation's arrows in a palette family or hex, and with `only`
the block draws just the boxes those arrows touch and what holds them, so
a web of a large catalog shows only what is connected. An arrow whose two
ends are not both drawn draws nothing.

```yaml
      relations: [{ label: consumes, only: true }, { label: will_consume, color: amber, only: true }]
```

`where` narrows what the block draws to entities carrying the facts it
names: every key must match one of its values, case-insensitively, and
what holds a matched box is drawn too. A connector reads what its app may
read; `where` picks this picture's part of it.

```yaml
      where: { resourceGroup: [rg-app, rg-shared], location: centralus }
```

`nest` lets one source draw several trees. By default a box sits inside
its observed parent, the source's containment: subscription, group, app.
`nest` names, per type, a relation that holds it instead, by label or tag,
so the same source draws a logical tree or one by environment. A nested
type may be nested in turn, and an ancestor not drawn is skipped, as with
containment. A box of a nested type with no such relation stands at the
top, so a gap shows.

```yaml
      types: [repository, service, azure_app_service]      # logical: repository > service > app
      nest: { service: repository, azure_app_service: service }
```

```yaml
      types: [environment, azure_app_service]              # by environment
      nest: { azure_app_service: environment }
```

The source must read every type named, and every relation `nest` names.
Outside the hub the node draws empty.

An observed view can hold hundreds of boxes. A PNG holds at most 32
million pixels, so a view that large exports as a PNG drawn smaller than
2x, and the export says so in a warning. A view that would need less than
half scale is refused as a PNG; export it as SVG or PDF, or narrow it with
`where:`, `types:`, or `closed:`.

#### Orrery: arrows, subtitles, and readable facts

The Orrery connector reads three settings that shape what a box and an
arrow say:

- `subtitle: { <blueprint>: <field> }` shows that field under the name
  instead of the entity key, such as `app_name` or `host`.
- Every fact reads by the field's `title` and `format` in the hub, so
  `cost_last_month_cents: 115207` shows as "Cost last month: $1,152". A
  field with no title reads as its name in words. Filters, `where`, and
  `health` still use the field names.
- `edges: { <blueprint>: { from, to, label, health, unresolved } }` draws a
  blueprint whose records say one thing reaches another as arrows, not
  boxes. Each record runs from the first `from` relation with a target to
  every target of its `to` relations. Records between the same pair fold
  into one arrow: its label lists each value of the `label` field, and its
  description lists each field the blueprint keeps as facts over all of
  them (numbers summed), such as "Evidence: setting, telemetry. Setting
  names: SQL_CONNECTION. Calls in 7 days: 2,043." A record that reaches
  nothing in the catalog, or whose `health` field is amber or red, runs to
  an amber stub of type `unresolved` named by its `unresolved` field (the
  host it tried to reach), so the gap shows. Add `unresolved` to the
  block's `types` to draw the stubs.

```yaml
# connector settings
subtitle: { azure_app_service: app_name, azure_database: host }
facts: { sw_connection: [evidence, setting_names, calls_7d] }
relationKinds: { sw_connection: data }
edges:
  sw_connection:
    from: [app, gateway, service]
    to: [to_database, to_database_server, to_storage, to_messaging, to_config_store, to_app]
    label: kind
    health: health
    unresolved: host
```

```yaml
# the picture
    observe:
      source: orrery
      types: [environment, azure_app_service, azure_database, azure_storage, unresolved]
      nest: { azure_app_service: environment }
      health: health
      relations: [sw_connection]
```

### What is open against a box

A bound box shows what is open against the real thing right now: open
issues, firing alerts, open pull requests, incidents. A connector reports
them (Orrery's firing alerts, Jira issues by label or field, GitHub pull
requests and issues by repository), and the hub puts the ones that point at
a box's `bind` key, or at a fact its entity carries (a `repository`, a
`service`), on that box. You never write them.

In the hub viewer and the interactive HTML the box carries a small count on
its top right corner, colored by the worst severity (critical, high,
medium, low, info), and the side panel lists each item with its link,
status, source, and age. An item whose last report is older than the
workspace freshness threshold dims, like any observed value. The count
moves nothing: layout is the same with or without it.

Exported pictures (SVG, PNG, PDF, publications) leave the counts out, so a
slide does not date. A relation view that is about the live state asks for
them:

```yaml
  - id: data
    title: Data
    include: { tags: [data] }
    openItems: true     # exports draw the counts too
```

Bind the boxes a reader asks "is anything wrong with this?" about, and let
the counts answer. Do not copy issue titles into `facts` or `note`; they go
stale the moment they land.

### How the layout works, so you can steer it

Each container lays out its own children. If the children have relations
between them, they flow in `direction` (left to right by default): sources
first, sinks last, cycles broken by reversing the fewest arrows. Children
that receive from outside the container go first; children that send out go
last. Children with no relations sit in a grid or column. Edge labels get
their own room, so they never clip. Arrows from several siblings to the same
outside target with the same label are drawn once from the container with a
count. Text order in the file breaks every tie, so reordering `nodes` and
`relations` is a legitimate way to steer. `arrange.order` pins the order of
children that share a layer; it does not move a child across layers.

Direction is the strongest lever. Mix them: a canvas that flows `right`
with the big container flowing `down` (or the reverse) turns a long strip
into a compact picture. Try both before splitting a view.

Arrows between two children of one container stay inside it. Arrows from
several siblings to the same outside box with the same label are lifted to
one arrow from the container (fan-out from one box to several siblings
lifts the same way). Every arrow keeps its own label and its own
arrowhead. A box widens before its text is cut short, so write the facts you
need and let the box grow.

### Sequence view

```yaml
  - id: purchase
    kind: sequence
    title: Purchase
    participants: [shoppers, web-app, orders-api]   # optional explicit order
    steps:
      - from: shoppers
        to: web-app
        label: submit cart
        steps:                       # nested steps happen during this call
          - from: web-app
            to: orders-api
            label: POST /orders
            reply: 201 Created       # return arrow after the nested steps
        reply: confirmation page
      - loop: until settled          # alt | opt | loop | par
        steps:
          - from: order-worker
            to: stripe
            label: capture payment
      - alt: card accepted
        steps: [...]
        else: [...]
      - note: Payment is idempotent on order id.
        over: [order-worker, stripe]
      - { from: orders-api, to: order-worker, label: spawn, create: true }   # the worker's box appears here
      - { destroy: order-worker }                                           # its lifeline ends with a cross
```

### Flow view (flowchart, optional swimlanes)

```yaml
  - id: release
    kind: flow
    title: Release Flow
    lanes: [Developer, GitHub Actions, Cluster]
    steps:
      - { id: push, text: Push to main, shape: start, lane: Developer }
      - { id: pass, text: Tests pass?, shape: decision, lane: GitHub Actions }
      - { id: done, text: Live, shape: end, lane: Cluster }
    edges:
      - { from: push, to: pass }
      - { from: pass, to: done, label: yes }
```

Shapes: start, end, process, decision, io, subprocess, wait, document.

### Timeline

Roadmaps, migrations, sprints, incident timelines. Lanes by owner, bars by
date, diamonds for milestones, arrows for what waits on what.

```yaml
  - id: roadmap
    kind: timeline
    title: Migration Roadmap
    lanes: [Platform, Application, Data]
    items:
      - { id: lz, text: Landing zone, lane: Platform, start: 2026-11-03, end: 2026-11-28 }
      - { id: web, text: Storefront on App Service, lane: Application, start: 2026-12-01, end: 2027-01-23 }
      - { id: cut, text: Cutover weekend, lane: Data, start: 2027-02-14 }   # no end: a milestone
    dependencies:
      - { from: lz, to: web }
```

`scale: ordinal` uses the labels in `start` as equal steps when there is an
order but no calendar.

Every item gets a row of its own. A label sits inside its bar when it fits,
and to the right of it when it does not; it is never cut short. An arrow
leaves an item through its bottom or top edge and enters the next one at its
left end, so it never runs through a label. Inside a lane, rows follow start
dates unless another order keeps arrows off bars and labels. The axis ticks
every day for spans up to two weeks, every Monday up to four months, and
every month beyond.

### Entity and class diagrams

Use `profiles: [uml]` and `type: class` (facts are attributes, bullets are
operations), or any type with `shape: box`. Cardinality goes on the arrow
ends: `heads: { from: one, to: many }` with `one`, `many`, `one-or-many`,
`zero-or-one`; `open` for implements, `diamond` for composition.

### Walkthrough

A guided tour over a relation view. Each step lights up nodes and relations
and can move the camera.

```yaml
  - id: tour
    kind: walkthrough
    title: Follow an Order
    view: requests
    steps:
      - title: A shopper arrives
        text: Traffic lands on Front Door first.
        highlight: [shoppers, front-door]
        focus: front-door
```

### Importing from Ilograph

`vantage import model.ilograph` reads an Ilograph file and its imported
libraries. Resources become nodes, library resources become types (named
`Namespace.Name`), `instanceOf` becomes `type`, perspectives become relation
views, `extends` stays `extends`, `overrides.parentId` becomes `reparent`,
hidden perspectives become `hidden: true` parts, a `::` path in a perspective
name becomes the picker group and the last segment the title, sequences and
walkthroughs become sequence and walkthrough views, and perspective notes
become the view's `question` and `notes`. Ilograph has no geometry, so there
are no pins; the engine lays everything out. Bracket lists and globs in
references (`Api/[a, b]`, `[*]/Subscriptions`) are expanded. Icons are
matched by name to our packs; the report lists the ones that did not match.
Review the parts with "Show parts" on, then run the author skill to add the facts,
paths, and gestures Ilograph never had.

### Importing from Mermaid and PlantUML

`vantage import <file>` reads Mermaid (`.mmd`, `.mermaid`), PlantUML
(`.puml`, `.plantuml`, `.pu`, `.iuml`), and Markdown files with
`mermaid`, `plantuml`, or `puml` fenced blocks. Every diagram becomes one
view. A Markdown block takes its title from the nearest heading above it;
a file may mix both languages, and all of it lands in one document.
These formats have no geometry, so there are no pins; the engine lays
every view out.

What comes out:

- Mermaid `flowchart` and `graph`: a relation view, `direction` from the
  header. Node labels are names; ids are slugs of the names. A cylinder
  `[( )]` is `type: database`; circles, diamonds, hexagons, stadiums, and
  parallelograms keep their `shape`. `subgraph` is a container, nested as
  written, and `direction` inside one becomes an `arrange` hint. Every
  edge form is a relation, `&` fans out, chains split into one relation
  per hop. Dotted edges are `kind: async`; `---` has no arrowhead.
- Mermaid `sequenceDiagram` and PlantUML sequences: a sequence view.
  Participants keep their aliases as names; actors and databases are
  typed. Solid arrows are calls, dashed arrows are replies, `-)` and
  `->>` (PlantUML) are async. Notes, `alt`, `else`, `opt`, `loop`, and
  `par` come across; an `else` with a condition becomes an `alt` nested
  in the else branch. `critical`, `break`, and `group` become `alt` or
  `opt` with the keyword in the condition. PlantUML `return` answers the
  last activated call.
- Mermaid `C4Context`, `C4Container`, `C4Component`: typed nodes with the
  technology as subtitle, boundaries as containers, `Rel` as relations.
  `erDiagram`: entities with their attributes as facts, cardinality as
  crow's feet on the arrow ends.
- PlantUML component and deployment diagrams: a relation view.
  `component`, `node`, `database`, `queue`, `actor`, `cloud`,
  `interface`, and the `[Name]` shorthand are typed nodes; `{ ... }`
  nests; a stereotype is the subtitle. Dotted arrows are `kind: async`.
  `left to right direction` sets `direction: right`.

What does not come across is in the report, and the import never fails
on it: other Mermaid and PlantUML kinds (class, state, gantt, pie, and
the rest) are skipped by name, styling lines (`classDef`, `style`,
`skinparam`, `!include`) are counted, and lines the reader cannot parse
are listed. A box with the same name and parent in two diagrams is one
node shown in both views.

What to check after: an old diagram in a repository is usually stale.
Treat the import as the start of a migration. Check every box against
the code and rename, retype, or remove it. Every relation without a
label is listed in the hints; give each one a verb. Then run the author
skill to add the facts and gestures the source never had.

## Themes and versions

`theme:` at the top of the file picks the default palette: `light`, `dark`,
`print` (white paper, strong strokes, for PDF), or `colorblind` (eight hues
that stay apart for every common color vision deficiency). Renders and
exports accept the same names.

`vantage: 1` names the language version. A document written for a newer
engine is refused with a clear message; an older one is migrated forward
and the validator says what changed.

Views in a set are laid out in order, and a node that appears in two views
keeps its order among its siblings from the earlier view when nothing else
decides. Put the view whose shape matters most first.

## The arc of a diagram set

A document opens on its overview: the title, the description, and a card
per view with its picture and question, in picker order. Keep the
description to what the whole set covers; each view's question says the
rest. A document with one view and no description opens on that view.

Order the views so the picker reads as a story: Context (who and why, plain
verbs), then Requests, Platform, Code, then End to End, then cross cutting
slices (identity, DNS, networking, delivery, cost), then sequences and
flows for named processes. Wide, deep, wide again, then slices, then
processes. Pages go in groups of their own (Guides, Specification), after
the pictures they are read with.

## Docs that stay true

A document can say what its docs must be, keep files it never draws, and
record where each box and section came from, so a change to the code
shows exactly what may now be wrong.

### The contract

```yaml
docs:
  kind: system                       # system, standard, or concept
  repository: github.com/acme/shop   # host/owner/name; no scheme, no .git
  audience: engineers new to the shop
  pages: [overview, runbook]         # doc views it must have
  checks: [no-copied-facts, sections-name-boxes, name-every-box, evidence]
  rules:
    - Every runbook step names the box it acts on.
```

- A page `pages` names that the document lacks is an error every save
  refuses.
- Each check in `checks` turns its page note into an error every save
  refuses: `no-copied-facts`, `sections-name-boxes`, `name-every-box`
  (the notes in `guide#doc-a-page-of-prose`), and `evidence` (every box
  and every section of prose has a tie, below).
- `audience` and `rules` are for the writer: read them as the brief. No
  check reads them.
- Find a document by its repository or its kind from anywhere:
  `vantage_find "repository: github.com/acme/shop"`, or
  `vantage_find "kind: standard"` for every standard.

### Artifacts

```yaml
artifacts:
  - { file: artifacts/SPEC.md, title: Specification, about: Written by the code analyzer; do not edit by hand }
  - { file: artifacts/ties.json, title: Box to spec item ties }
```

An artifact is a file the document keeps and versions and never draws: an
analyzer's raw specification, a list of ties, a data export. It lives
under `artifacts/`, any type, up to 2 MB, sent with the save like a
picture (`assets`, or a file in the working copy). No picture or page
render reads it. Read it back from the head version: a Markdown one is
text at `workspace/document/artifacts/SPEC.md` (outline it, read one
part), any one as bytes from `GET /api/v1/text/file?address=...`. An
artifact listed and not attached, or a path outside `artifacts/`, is an
error.

### Evidence and what may be stale

```yaml
evidence:
  - { to: orders-api, files: [src/orders/], commit: 3f2a1bc }
  - { to: how-an-order-works#arrive, files: [src/checkout.ts, src/cart/*.ts], commit: 3f2a1bc }
```

A tie says a box (`to: orders-api`, which covers the boxes inside it), a
view, a whole page, or one section (`page#anchor`) was read from these
repository files at this commit. A folder ends in `/`; `*` is one path
segment and `**` any depth.

With `docs.repository` set and a `git` connector reading that repository,
`workspace/document/stale` lists every tie a later commit touched, with
the commits and the start of each diff; the document's outline counts
them. Work one: read its files at the head, fix the box or the section,
then move the tie: `{ address: platform/shop, op: set, path:
evidence.0.commit, value: <head> }`. The list is worked out on every read,
so the save clears it. A tie whose commit is older than the history read
lists every change in it.

In the session that changes the code, do not wait for the merge:
`vantage_find` the changed paths in the document (`in: platform/shop`)
and fix the ties they hit before you finish.

### A repository's pointer: vantage.yaml

A repository names its docs, decisions, and work in one file at its
root. It holds no secret, and it is the only thing about them the
repository keeps: no decision records, no roadmap, no diagram files. It
holds what is true in every estate that reads the repository:

```yaml
document: shop            # the diagram set and its pages
decisions: SHOP           # the registry its decision records are in
roadmap: SHOPR            # the kind its roadmap items are, when it has one
work: SHOPW               # the kind its work items are, when it has one
watch: [src/, deploy/]    # the code the docs describe; its git connector reads only these paths
```

`watch` names folders (`src/`), exact files (`Makefile`), or globs
matched from the repository root (`packages/**/*.ts`, `*.md`); the git
connector's `paths` takes the same list.

The hub and workspace are the estate's: `~/.config/vantage/repos.yaml`
maps a repository's key (its origin remote without scheme, user, port,
or `.git`, in lower case) to them. The most specific match wins, and a
`match` ending in `/*` is a prefix:

```yaml
- match: github.com/acme-tools/*
  hub: https://vantage.example.com
  workspace: tools
- match: github.com/acme-tools/special
  hub: https://vantage.example.com
  workspace: special
```

A `hub` and `workspace` in `vantage.yaml` win; only a repository that is
an estate's own keeps them there. The plugin's `scripts/pointer.sh`
prints the pointer as both files resolve it.

An agent reads it before changing the code: the records in `decisions`
govern the code, and work belongs to an item of `roadmap` or `work`.

`vantage: false` alone says the project declined: never offer Vantage in
it again. The contract stays in the document, where the hub enforces it.

### Documents with no repository

A standard, an estate's access model, or a concept gets its own document
with `docs.kind` set and no repository. It keeps a page named
`decision-log` with one entry per decision: the date, what was decided,
why, and when to undo it, citing a decision record where one exists. A
conversation changes such a document only when it decides something, and
then changes the smallest part that is now wrong, and adds the entry.

## Working in a hub

Everything the hub holds is text at an address. Five tools reach all of it.

| Address | What it is |
|---|---|
| `platform/shop` | a document: its YAML |
| `platform/shop/pages/overview.md` | one of its pages |
| `SHOP-2001` | a decision record |
| `SHOP`, `platform` | a registry, a workspace: they have an outline and no text |
| `~` | the person's own workspace |
| `scopes` | the organization's tree of owners, and each workspace's scope (guide#scopes-and-owners) |
| `guide`, `schema` | this guide and the JSON Schema |

A part comes after `#`: a heading (`SHOP-2001#decision`,
`guide#sequence-view`), a YAML path (`platform/shop#views.context`,
`#nodes.orders-api`), or lines (`#L120-180`).

Climb, and stop as soon as you can act:

1. `vantage_outline` says what is at an address, as names and sizes. With
   no address it lists the workspaces and registries.
2. `vantage_find` answers the lines that hold every word, as
   `address:line: text`, under a line that names each thing and its
   link. With no `in` it searches the whole hub: records come first, then
   documents and their pages, and personal workspaces are left out (name
   one, or `~`, in `in` to look there). When no line holds every word it
   answers how many lines in each thing hold some of them, and the call
   that reads more; it never answers loose lines.
3. `vantage_read` answers one part, or several in one call.
4. `vantage_patch` changes what is saved. `vantage_write` writes something
   new.

Never read a whole document to change one line of it. Never write a whole
page to change one sentence. Every answer has a size limit; a list answers
a page and names the call that reads the next.

A patch swaps one exact string. It needs no read first and no version: the
old text must be there exactly once, and that is the guard. Put every
change in one call. Edits to one document and its pages save as one
version; each thing saves whole or not at all, and the answer names each
in a line.

```yaml
# vantage_patch arguments
message: Rename the cache and say so on the page
edits:
  - { address: platform/shop, old: "subtitle: Redis 6", new: "subtitle: Redis 7" }
  - { address: platform/shop/pages/overview.md, old: "on Redis 6.", new: "on Redis 7." }
  - { address: SHOP-2001#decision, old: "one cache", new: "one cache per region" }
```

When the old text is there more than once, give more of the text around
it, name a part in the address, or set `all: true`. When it is not there,
the answer shows the nearest lines.

YAML also changes by path, which keeps comments and formatting and needs
no old text:

```yaml
edits:
  - { address: platform/shop, op: set, path: nodes.orders-api.subtitle, value: ASP.NET 11 }
  - { address: platform/shop, op: add, path: nodes.azure.children, value: { name: Cache, type: cache } }
  - { address: platform/shop, op: add, path: relations, value: { from: orders-api, to: cache, label: reads } }
  - { address: platform/shop, op: remove, path: relations.legacy-sync }
```

- `set` writes a key, creating it when it is missing, or replaces a list
  item.
- `add` appends to the list at the path, creating the list when it is
  missing, or adds the keys of a map value to the map at the path.
- `remove` deletes a key or a list item.

A path is dot separated keys. In a list, a segment finds the item whose
`id` it is, then a node by the slug of its name (its default id), then an
index: `relations.0`. A node id also finds the node at any depth below, so
`nodes.orders-api` reaches it inside `azure`. `facts` and `tags` are lists:
add to them, or set the whole list.

Every write is checked first. A version with errors (text that does not
parse, a `type` that is neither built in nor declared under `types:`, a
name that points at nothing) saves nothing; the answer lists each error as
`code at path, line N: message (guide#topic)`. Read that topic, fix them
all, and save again. Warnings save. Every other refusal ends the same
way, with the topic that explains its rule.

`vantage_write` takes whole texts. A document and its pages in one call
are one version. Write to `~` for a new diagram in the person's own
workspace, named after its title; never ask the person for a slug. Answer
with the link the write gives, as `[Name](url)`.

`vantage_render`, `vantage_export`, `vantage_explore`, and
`vantage_validate` take `address` for a saved document; the hub reads its
own copy, with its imports, pictures, and workspace icons, so an explored
layout is the one a render draws. A saved document draws in every format,
theme, and title block a file does: png, svg, pdf, drawio, and vsdx for
one view, html, pdf, drawio, and vsdx for the whole document. Send `text`
only for YAML that is saved nowhere.

### On a machine with a disk

Work on files. `vantage_checkout` writes a document, a registry, a record,
or a workspace into a folder: each document in `workspace/document/` with
its YAML, pages, and pictures, and each record in `decisions/REGISTRY/`.
Search, read, and edit them with your own tools; render and validate the
YAML by its `file`. Then `vantage_sync` the folder. It sends what changed,
answers one line per thing saved, and brings back what changed on the hub.
A new page or picture in a document's folder, and a new record file under
`decisions/REGISTRY/`, are sent too. When both sides changed the same
lines, both are written into the file between `<<<<<<<` and `>>>>>>>`: fix
the file and sync again.

Wherever a tool takes content, give its path: `file` on a write, a path
for each asset, a workspace icon's `file`, `dir` for a folder of records to
import. With `out`, a render, an export, or an explore writes its file to
that path and answers the notes, a saved document's too; open the picture
when the question is how the diagram looks.

### Every other tool

`vantage_tool` lists the rest by group (documents, review, records, live),
says how to call one, and calls it:
`{ tool: vantage_history, arguments: { address: platform/shop } }`.

To delete a diagram, `vantage_delete` takes the workspace and the
document. It cannot be undone, so use it only when the person asks to
delete that diagram by name; to start over, write a new version instead.
The workspace's rule may refuse: by default only the person who made the
diagram, the workspace owner, and org admins may delete it.

A program keeps its diagrams, decisions, roadmap, and work in a workspace
of its own; what several programs share goes in their platform's
workspace. `vantage_workspaces` lists the workspaces you may open and
makes a team workspace you author. `vantage_move` takes a document or a
registry prefix and the workspace it goes to (`to`). A document can also
take a new slug (`slug`), with or without a new workspace; a slug alone
renames it in place. The slug follows the rule a new document's does, and
a slug another document holds there is refused. A document keeps its id,
history, and every link to its boxes; when it defines a kind, the kind and
its items go with it; its old address sends people and tools to the new
one. A registry keeps its prefix, so its citations never change. Moving
follows the delete rule where the document is, and needs author where it
goes.

## Comments in a hub

The comment tools are called through `vantage_tool`. People leave
comments on a view, or on boxes in it. `vantage_comments`
lists the open ones, a page at a time (`from` reads the next); each line names its view and the ids of the boxes it
is about (`view=context boxes=orders-api,orders-db`). Carry a comment out
with `vantage_patch`, then resolve it with `vantage_resolve_comment`. To
leave one yourself, `vantage_comment` takes the view and, for boxes, their
ids in `targets`.

To mention a person, write `<@id>` in the text with an id from
`vantage_people`, which lists who can read the document. The hub tells
each one, through Dispatch when the hub is connected to it. A mention of anyone who
cannot read the document refuses the whole comment. In `vantage_comments`
a mention reads `@Name` in the text, and the line names each one with its
id (`mentions=Reviewer <@u_1>`). `vantage_mentions` lists where the person you
act for was mentioned.

In a review, people react to boxes: thumbs up (`up`), looks wrong
(`wrong`), and a question (`question`). `vantage_reactions` with
`action: list` shows each box with its counts and who, most flagged first.
"Looks wrong" also files a comment on the box, so carry those out like any
comment. A box marked orphaned is no longer in the view; its reactions are
kept for the record. `action: add` and `action: remove` put your own on or
take it off.

## Decision records in a hub

Architecture decision records live in a hub beside the diagrams of the
systems they decide about. A registry is a numbered set of records held by
a workspace: an organization keeps one for decisions that apply across
programs, and each program keeps one in the workspace its diagrams live
in. A registry's prefix (`ORG`, `SHOP`) never changes and is unique in the
organization.

A record is cited three ways:

| Form | Where |
|---|---|
| `SHOP-2001` | everywhere: a box's `decisions`, a page, another registry's record |
| `ADR-2001` | only inside a record body, for a record in the same registry |
| `adr:01JD3K5Q9W8X2Y4Z6A7B8C9D0E` | the machine form, the record's ULID; it never changes |

Numbers are four digits. The first is the category from the registry's
scheme (by default 0 Governance, 1 Infrastructure, 2 Security, 3 Data, 4
Compute, 5 Development, 6 Operations); the last three run in order inside
the category. The next number follows the highest taken there. A number
is never reused while its record lives, nor after a move; only a record
discarded by its writer gives its number back.

A record holds a title, a status (Proposed, Accepted, Deprecated,
Superseded), the decision date, Last updated, the decision makers by name,
Context, Decision, Consequences (benefits and costs), Alternatives
considered (each with why it was rejected), related records, an optional
position (the line it sets for its scope's standard, guide#standards),
and links to the boxes and views it governs. How a record stands against
another standard is said in its Context.

A record is text at its citation. Its text form is a header of fields,
then its sections:

```markdown
---
title: Orders go through one API
status: accepted
category: 2
decided: 2026-11-01
deciders: [Platform lead]
related: [SHOP-2002]
governs:
  - platform/shop box orders-api
---

## Context

## Decision

## Consequences

## Alternatives considered

### Shared database

Two writers drift.
```

A record you read also starts with `record:`, its citation, and `id:`, its
machine form (`adr:<ULID>`). Both are read-only: a write ignores them. The
`id` is what a record is known by outside the hub, for its whole life.

Relations have types. `related:` and `amends:` are lists of citations;
`inherits:` says how the record stands against the lines that reach its
scope (guide#standards); `supersedes:` and `superseded_by:` link a
replacement. The other record shows each one back as `amended_by:`,
`refined_by:`, `departed_by:`, or `superseded_by:`; only the record that
names the link changes it.

- Search first: `vantage_find` with `in: SHOP`, or `vantage_outline SHOP`
  for every record in a line each (`SHOP#3` for one category,
  `SHOP#accepted` for one status). One decision per record.
- Read one section: `vantage_read SHOP-2001#decision`. The record's
  outline lists its sections, what it governs, and what cites it.
- A refinement while the decision stands is a `vantage_patch`: one
  sentence swapped in place. Last updated moves to today in the hub's
  time zone; `minor: true`
  keeps it for a date or wording fix. The header is text too: swap
  `status: proposed` for `status: accepted`. Every revision is kept.
- A new record is a `vantage_write` to the registry (`SHOP`) with the text
  above. It takes the next number in its category, and the answer names
  it. `vantage_decision_next` says the number it would take.
- A reversal is `vantage_decision_supersede`: a new record that takes the
  next number and marks the old one Superseded by it. The old record keeps
  its body. Without `governs`, the new record governs what the old one did.
- When the record that replaced it already exists, link the two with a
  patch of either header: `superseded_by: SHOP-2002` on the old record, or
  `supersedes: SHOP-2001` on its successor. The successor is in the same
  registry. The old record is Superseded with no successor named, or the
  same patch marks it: `status: superseded` with `superseded_by:`. The
  hub sets both ends and keeps a revision of each. A link once set never
  changes or comes off, and the refusal names the record it keeps.
- `vantage_decision_discard` takes back a record you wrote by mistake.
  It removes the record and frees its number, so the next record in its
  category takes it when it was the highest there. It works only while
  nothing points to the record: no document or other record cites it, no
  record names it in `related` or a supersede link, no item links it, no
  old citation of it still resolves, and every revision of it is yours.
  What it governs, its revisions, and its own citations go with it, and
  the audit log keeps its whole text. Anything that points to it makes it
  real: the discard is refused with the list of what points to it, and
  you retire the record instead, with `status: deprecated` or
  `vantage_decision_supersede`. Run `dryRun: true` first: it answers the
  same list, or that the record can be discarded.
- The record tools that are not text (`vantage_decision_supersede`,
  `vantage_decision_move`, `vantage_decision_discard`, `vantage_decision_import`,
  `vantage_decision_next`, `vantage_registries`) are called through
  `vantage_tool`.
- Link each record to what it governs with `governs`, one line each:
  `workspace/document box node-id` or `workspace/document view view-id`.
  The viewer shows a badge with the count on each governed box and lists
  the records in the box's panel.
- A box may also cite records in the YAML, and a page in its prose:

  ```yaml
  - name: Orders API
    type: api
    decisions: [SHOP-2001, ORG-0003]
  ```

  A save refuses a citation that names no record. Cite every record
  from the boxes and pages it is about: the hub indexes each citation, and
  the record's Cited by (on its page and in its outline) is built from
  them.
- `vantage_decision_move` renumbers a record (`number`), moves it to
  another category (`category`: it takes the next number there), or to
  another registry (`registry`). It keeps its `adr:<ULID>`, and its old
  citation stays an alias that still resolves; no other record ever takes
  that number. Every document and record that cites it is rewritten as a
  new version or revision by you, and an `ADR-NNNN` citation never changes
  meaning: a record that leaves its registry qualifies its own local
  citations. A source you cannot write keeps the old citation, which still
  works, and the answer lists it. Run `dryRun: true` first and read what
  it would rewrite and what it cannot. A save that cites an old number
  succeeds and names the citation to use now; switch to it.
- `vantage_decision_import` brings a repository's Markdown records in.
  On a machine with a disk give it `dir`, the folder that holds them; the
  files never pass through you. Each keeps its number, dates, status,
  decision makers, and supersede links; the answer lists every file with
  its new citation and link, and what it could not map. `dryRun: true`
  writes nothing.
- `vantage_registries` lists, creates, and renames registries and changes
  their category scheme.

## Kinds and items

A hub tracks work as items. An item has a key people say (`SW-12`), a
kind, a state, who asked for it, one owner who answers for it, who holds
it, the scope it serves, a few labels, notes, files, links, and a
history. The system that keeps the work's content keeps the
content; the hub keeps where the work stands and who has it. An item the
hub keeps itself also has a Markdown body.

A kind is a document with a `kind` block. Saving it makes the kind:

```yaml
title: Shop work
kind:
  prefix: SW                  # keys are SW-1, SW-2; shares one namespace with registries
  name: Shop work
  base: work-item             # a shipped kind, or another kind's prefix: its labels, roles, parts, and lifecycle
  labels:
    - { name: area, type: choice, choices: [api, web] }
    - { name: points, type: number }
  roles:
    reviewer: [lead@example.com, team:platform]
  parts: [SW]                 # kinds whose items may be part of one of these
views: []
```

- A label is `text`, `number`, `money`, `date`, or `choice`. Labels are
  flat values the hub shows, sorts, and filters; a nested value or a
  document is never a label. A kind's labels and roles add to its base's;
  a label it names again takes the base label's place.
- `base` is a kind the hub ships (`work-item`, `roadmap-item`, or
  `milestone`), or another kind's prefix in any workspace you can read.
  An estate keeps one kind for many teams this way, and each team adds
  what it needs: `base: SW` takes SW's labels, roles, parts, and
  lifecycle, unless the file draws its own lifecycle. A chain of bases
  ends at a shipped kind; a loop, or a chain that ends at a kind built on
  nothing, is refused.
- A change to a base reaches every kind built on it when it is saved. A
  change that drops a state an item of one of those kinds is in, or a
  label one of their moves needs, is refused, naming the kinds and the
  items it would strand. A base keeps its prefix and its kind block while
  a kind builds on it.
- A kind built on the work item has a `due` date. The hub reads it: an
  item is overdue when its due day is before today, and due soon from
  today through the hub's window (3 days unless the estate sets
  another), both in the hub's time zone. A done or parked item is
  neither. Other date labels are shown and sorted, never read.
- `owner: forms` says another system keeps the content: its items have
  no body, and the system puts them by its own key.
- A kind with items keeps its prefix and every state an item is in. It
  lives in its document's workspace, and moves with it (`vantage_move`).

### Lifecycle: how a kind of item moves

A lifecycle is a view of kind `lifecycle` in the kind's file, named by
`kind.lifecycle`. States are boxes and moves are arrows. The hub refuses
every move the picture does not draw, so the picture of the process is
the process.

```yaml
kind: { prefix: REQ, name: Requests, roles: { approver: [lead@example.com] }, lifecycle: flow }
views:
  - id: flow
    kind: lifecycle
    title: How a request moves
    direction: down
    states:                    # the first is where a new item starts
      - { id: asked, text: Asked, class: not-started }
      - { id: approved, text: Approved, class: in-progress, page: pages/approved.md }
      - { id: done, text: Done, class: done }
      - { id: declined, text: Declined, class: parked }
    moves:
      - { from: asked, to: approved, label: approve, who: [approver], approval: true }
      - { from: asked, to: declined, label: decline, who: [approver], needs: [note] }
      - { from: approved, to: done, label: finish, who: [holder] }
```

- Every state is one of four classes: `not-started`, `in-progress`,
  `done`, `parked`. A list or a report reads any kind by them.
- `who` names `author` (anyone who writes the workspace, the default),
  `holder`, `asker`, `owner` (the person or team that answers for the
  item), or a role the kind declares.
- `needs` is `note`, `revision` (the content revision the move is about),
  or `label:<name>` (a label that must be set first).
- `approval: true`: the person who asked never makes the move.
- `people: true`: a person makes it themselves; an agent acting for them
  is refused.
- `independent: true`: a review by someone other than the worker. Anyone
  who held or claimed the item, and any agent acting for them, is refused.
  The shipped work item's `approve` says it, and is the owner's or an
  author's.
- Two moves never join the same two states; a move is named by where it
  goes. It draws as a flow: work reads from the first state, and done
  states sit last.
- Nothing runs because an item moved. A system that acts on a move reads
  the change feed.

### Working with items

- `vantage_outline SW` lists the kind: its states with a live count, its
  moves, its labels, and its items in the kind's order (`SW#doing` for one
  state, `SW#done` for one class). Every list, board, and outline of a
  kind shows the same order: by horizon in its choice order when the kind
  has one, then by each item's place, then newest first. An item nobody
  placed comes after the placed ones, so a kind nobody orders reads newest
  first.
- A kind that reads `due` has two more parts: `SW#overdue` and
  `SW#due-soon`. Its outline counts both, and a row says `OVERDUE` or
  `due soon`. The card has `due: 2026-11-30, overdue`; set the date in
  `labels.due`. The Work tab marks overdue cards and rows and filters by
  Overdue and Due soon.
- `vantage_read SW-12` is the item's card, then its body. The card names
  the moves open to you now. Its parts are read a page at a time:
  `SW-12#notes`, `SW-12#history`, `SW-12#links`, `SW-12#files`.
- A new item is a `vantage_write` to the kind's prefix:

  ```markdown
  ---
  title: Cache the price list
  labels:
    area: api
  parent: SW-3
  ---

  ## Done when

  The price list answers from the cache.
  ```

- An item has one owner, who answers for it: they approve it, answer its
  questions, and are told when it moves. In the text it is `owner:
  ada@example.com` (or `team:platform`, or `none`). It serves a scope from
  the scope tree, `scope: payments`; with none it serves its workspace's.
  A new item with no owner takes its scope's steward. A scope the tree
  does not have is refused.
- The title, the labels, the parent, the owner, the scope, and the body
  change with `vantage_patch`, like any text. The state, the holders, and the links
  are actions: `vantage_item` (through `vantage_tool`), several in one
  call, each landing alone:

  ```json
  {"actions": [{"item": "SW-12", "move": "doing"}, {"item": "SW-12", "hold": "me"},
               {"item": "SW-12", "note": "Cached behind the API."}]}
  ```

  A refused move names the moves open to you and what each needs.
  `link` takes `came-from`, `part-of`, `waits-on`, `toward` (a
  milestone), `box` or `view` (`workspace/document#id`), or `decision`
  (`SHOP-2001`). On a machine with a disk, `attach` takes the file's path.
- `place` puts an item in order among the items of its kind in its
  horizon: `{"item": "SW-12", "place": "first"}`, `"last"`, `{"before":
  "SW-9"}`, or `{"after": "SW-9"}`. It is an event on the item, and it
  needs the author role in the item's workspace. A place beside an item
  in another horizon is refused; over HTTP, a `put` with `labels.horizon`
  and `place` moves it there in one write. A horizon changed alone puts
  the item after the placed ones there. On the board a person drags a
  card, or uses its Up and Down buttons, which call the same put.
- People see an item when they can open its workspace, or when it names
  them: who asked, its owner, who holds it, the person whose agent it is
  delegated to, or a role a move out of its state waits for. Being named
  lets a person make the moves the lifecycle gives them. Its owner, the
  person whose agent it is delegated to, and a person a role on a move
  out of its state names may also work it: claim it, and finish the run.
  Nothing else.

### Agents on items

- `vantage_queue` (through `vantage_tool`) lists what you may pick up,
  oldest first, each with what to read first and the last handoff note:
  the items an owner delegated to agents acting for your person or to you
  by name, and the items a role you hold waits on. An item nobody
  delegated is never offered; you take work a person kept only when they
  ask you to.
- The owner delegates: `{"item": "SW-12", "delegate": true}` hands it to
  any agent acting for the owner; `"delegate": "agt_..."` (or the name of
  one of your person's agents) to that agent alone; `"delegate": false`
  takes it back. A new owner ends the old owner's delegation. The card
  says who owns it, who it is delegated to and by whom, and the live run:
  which agent works it, for whom, until when.
- `{"item": "SW-12", "claim": true}` takes the item for 20 minutes. Any
  call you make on it renews the claim, and on a laptop the bridge renews
  it while your session lives. A claim that runs out puts the item back
  in the queue. A claim's end, and every time in an item's history and
  notes, is given in the hub's time zone with its short name
  (`2026-11-27 19:20 CST`).
- You act as yourself, for your person. Your history reads `vantage on
  laptop-1 for ada@example.com`, and you can do what your person can.
  A claim belongs to your run: on a laptop, the bridge's session; over
  HTTP, the `X-Vantage-Run` header you send with each call; with none,
  your agent. Another run is refused the item while your claim lives,
  even a run for the same person, and only your run renews or finishes
  it. A move that says `people: true` is refused to you: ask your person
  to make it.
- `{"item": "SW-12", "ask": "..."}` moves the item to where it waits for a
  person, carrying the question. It leaves the queue until it is answered.
- `finish` ends a run in one action: `{"item": "SW-12", "finish": {"move":
  "review", "summary": "...", "proof": ["commit abc1234"], "handoff":
  "...", "seconds": 640, "cost": {"amount": 0.42, "currency": "USD"}}}`.
  The run record, the move, and the release each land as their own event.
  The skill `vantage-work` walks through it.
- `vantage_checkout` of a kind's prefix writes its items as files under
  `work/<KIND>/`; a new file there is a new item on sync.
- A module calls the same work over HTTP, as forms of the nine verbs
  under `/api/v1`: `GET /items?list=queue` is the queue; `POST
  /items/SW-12/hold` with `{"claim": true}` or `{"claim": 30}` claims and
  `{"renew": true}` renews; `POST /items/SW-12/move` with `{"ask": "..."}`
  asks; `POST /items/SW-12/release` with `{"run": {...}, "move": "review"}`
  finishes; `PUT /items/roadmap?kind=PLAN` brings a Markdown roadmap in.
  `get` and `find` take `fields=title,state` and answer only those; a
  `put` changes a body by `edits: [{"old", "new"}]`, never the whole body.
  A `put` takes `owner`, `scope`, and `delegate`; `find` takes
  `owner=me|<email>|team:<slug>`, `scope=<id>` (the scope and every scope
  under it), `delegated=true|false`, and `due=soon|overdue`. A row and a
  card carry `due: {date, overdue, soon}` for a kind that reads it.

### Roadmaps

A roadmap is items of a kind built on the shipped roadmap item:

```yaml
kind: { prefix: PLAN, name: Platform roadmap, base: roadmap-item, parts: [SW] }
views: []
```

- An item's outcome is its body. `horizon` is `now`, `next`, or `later`.
  `promised` is a date, set only for a real promise. `start` and `end` are
  the plan: when the work starts and ends, set from a person or from
  capacity the estate's rules state, never invented. An end before its
  start is refused. Who owes it holds it.
- A parent with parts has a span worked out from them, the earliest
  start to the latest end of every item under it. Its card and outline
  show it (`span: 2026-01-05 to 2026-03-20, from 3 parts`), and the
  timeline draws it as a bar over the parts. It is never the parent's own
  labels; set the dates on the parts.
- Nobody types its status. The hub moves it from its proof: its parts
  (items that are `part-of` it) and the items or boxes it names with a
  `proof` link. Building when any proof is under way, shipped when every
  piece is done and every proof box is seen by a connector. A box is proof
  only when it is bound to something a connector reads.
- A ticket in an outside tracker that a connector reads is proof too:
  `{"rel": "proof", "target": "ticket:ops/jira#OPS-12"}`. It counts as
  under way while the connector reports it open, and done once it drops
  out.
- With no machine proof, an item can only be reported done (`move` to
  `reported` with a note). It ships when proof lands.
- Link what the plan changes on the picture: `adds`, `changes`, or
  `retires` with `workspace/document#box-id`. The viewer draws a box still
  to be added as a dashed ghost and one still to be retired hatched, and a
  switch shows the system today or after a horizon.
- People see a kind's items as a board on the workspace's Work tab,
  `/w/<workspace>?tab=work&kind=PLAN`: give them that link. The kind's own
  document draws no items; opened, it points at the board.
- Read a roadmap as rows: `vantage_outline PLAN#now` (a state, a class, or
  a label choice narrows it). Move one item's horizon with a patch of
  `horizon: now`, and its order inside the horizon with `place`.
- The timeline draws an item with a start and an end as a bar, a parent
  as a bar over its parts' span, an item with one date as a point, and
  each milestone its items link toward as a marker at its date.
- A roadmap kept in Markdown comes in with `vantage_roadmap_import`: a
  table with an outcome column, or bullets under Now, Next, and Later. On a
  machine with a disk give `file`. Running it again makes nothing twice.
- An item that cannot start before another says so with a `waits-on`
  link to it. The build order is these links, never prose.
- A milestone is a dated point items gather to, a kind built on the
  shipped milestone:

  ```yaml
  kind: { prefix: PLANM, name: Platform milestones, base: milestone }
  views: []
  ```

  Its `date` label is when it is due; its body says what must be true by
  then. An item of any kind, in any workspace, links `toward` it; `toward`
  at an item that is not a milestone is refused. It follows the roadmap
  lifecycle and ships when every item toward it has shipped. Its card and
  outline roll up what links toward it: counts by class, the items at
  risk, and `on track`, `at risk`, or `done`. An item is at risk when it
  is not done and it ends after the milestone's date, has no end, or
  waits on an item that ends after it. A milestone with no date is at
  risk.
- A kind's outline says which kinds take it as a part (`part of: PLAN`),
  so a planner in one program climbs to the roadmap above it.
- A page names an item with `[[item:PLAN-3]]`; readers who may see the item
  see its live state there.

## Scopes and owners

A scope is an owner in the organization's tree: everyone, a department, a
team, a program. The tree is text at the address `scopes`:

```yaml
source: hub              # or catalog: read from a catalog connector, edits refused
profile: [description, mission]   # the fields a scope's profile has; description by default
scopes:
  - id: acme
    name: Acme
    kind: organization   # the estate's own word for the level
  - id: payments
    name: Payments
    kind: department
    parent: acme         # one parent; never a second
    steward: ada@example.com
    facets: [moves-money]
    profile:
      description: Payments moves money in and out.   # optional; one left out is inherited
workspaces:
  shop: payments         # a workspace not listed belongs to the whole estate
  risk-infra: { owner: platform, program: risk }   # an owner, and the program it serves
```

- `vantage_outline scopes` answers the tree indented by depth, with each
  scope's workspaces. A workspace's outline names its scope, the scopes
  above it, and its profile fields.
- `vantage_read scopes/<id>` reads one scope: its place in the tree, its
  steward, facets, and workspaces, then a section per profile field
  (`scopes/<id>#mission`). A field the scope leaves empty shows its
  nearest ancestor's value and says `Inherited from <scope>.` The address
  is read-only; change a field in the tree, or in the catalog.
- A profile field is optional, and only an admin names the fields under
  `profile:`. A tree kept in the hub refuses a field the list does not
  name.
- A workspace's owner sets its scope with one line under `workspaces`:
  `vantage_patch` with `op: set, path: workspaces.shop, value: payments`.
  Remove the line and the workspace belongs to the whole estate again.
- A workspace may also name the program it serves, as `{ owner, program }`.
  The program is a second axis, never a second parent: the owner's chain
  gives every line that reaches the owner, and the program adds its own
  lines and the lines that reach it by facet, never its ancestors'. Each
  part of a program with a different owner is its own workspace, so its
  infrastructure takes the platform's standard and its software the
  development department's, and both share the program's lines. The
  workspace's outline shows the program, its profile, and the edition
  that binds it: `standard/<owner>+<program>`.
- A facet is at most 100 characters, on a scope and in a line's
  `reach.facets` alike. A catalog facet past that is kept aside, and the
  tree's outline names it.
- Only an admin changes the tree or its source. A scope id is there once,
  a parent must be in the tree, and a scope is never its own ancestor.
- With `source: catalog`, the tree is the catalog's:

  ```yaml
  source: catalog
  catalog:
    connector: platform/catalog   # workspace/connector
    kinds: [organization, department, team, program]
    steward: { department: head, team: lead, program: team }
    facets: facets                # the field that holds facets
  ```

  The connector's containment relations give each scope its parent, and
  each field `profile:` names is read from the scope's entry; an entry
  without it leaves it empty. The hub has that connector keep these
  fields and the facets of each scope kind, whatever its own field list
  says. Each run of it refills the copy, and a
  change to the copy is refused; change the catalog. Changing `profile:`
  reads the copy again. A scope removed from the tree leaves its workspaces to the
  whole estate. Setting `source: hub` (and dropping `catalog:`) keeps the
  copy for authors to keep.

## Standards

A scope's standard is built from its records, never written by hand. A
record that sets a rule for its scope carries a `position:` in its header;
a one-off choice carries none.

```yaml
position:
  line: Every secret lives in the vault.   # the rule, at most 200 characters
  binding: must                            # from the estate's list: must, should, may
  binds: [people, agents]                  # from the estate's list: people, agents, systems
  locked: true                             # optional: no departures
  reach: { below: false, facets: [moves-money], paths: [infra/] }  # optional
  enforced_by: [policy:deny-public-keys]   # optional: what enforces it
  checked_by: [secrets.vault-only]         # optional: the judge's rules, pack.rule
```

- The line belongs to the scope of its registry's workspace, or to the
  whole estate when the workspace names none. Only an accepted record in a
  team workspace brings its line in.
- It reaches its own scope and, unless `below: false`, every scope below.
  `facets` reach every scope elsewhere in the tree that carries one.
- `vantage_read standard/<scope>` reads the scope's newest edition: a
  header (edition, hash, what it built on), one `##` section per area (the
  record's category), a line each with its record and how it got here
  (`own`, `from payments < acme`, `by facet moves-money from finance`),
  then `## Packs`, `## Procedures` (the pages that cite its lines), and
  what changed. `standard/estate` is the whole estate's.
  `standard/<scope>#security` reads one area; `standard/<scope>@3` reads
  edition 3. Hold the version you read and send it as `held`: an edition
  that has not changed answers one line.
- `vantage_outline standard` lists every scope's edition and any that
  wait or were refused; `vantage_outline standard/<scope>` lists its areas
  and its editions.
- Every write that changes what reaches a scope publishes its next
  edition at once. The machine gate refuses an edition whose binding word
  or binds are off the estate's lists, whose `checked_by` names a pack
  that does not reach the scope, that adopts a pack twice, or that holds a
  withheld word; the outline says why, and the last edition stays in
  force. Fix the record or the settings and the next write publishes.
- The settings are YAML at `standard`: `bindings`, `binds`,
  `steward_gate`, and `withhold` are an admin's; `packs.<scope>` (or
  `packs.estate`) is that scope's steward's. A pack is a pin the judge
  installs, never its body:

  ```yaml
  packs:
    acme:
      - pack: secrets
        version: 1.0.0
        hash: sha256:<64 hex>
        origin: starter      # a judge's built-in set, adopted; estate for the estate's own
        parameters: { days: 30 }
        on: true
  ```

- With `steward_gate: true`, a scope's own change waits as a pending
  edition; the outline names it. Read it at `standard/<scope>@<n>`, and the
  scope's steward or an admin publishes it with
  `vantage_standard_publish` (through `vantage_tool`). A change from
  above publishes at once.
- `standard/<scope>` is never written: change the record's position, or
  the packs at `standard`.

### Inherited lines, departures, and conflicts

Every line that reaches a scope applies at once: its own, every ancestor's,
and every line whose facets it carries. No chain outranks another, so a
local line never overrides a wider one.

- A record says how it stands against each inherited line it touches, with
  the edition that binds its workspace (its owner's, or
  `<owner>+<program>` when it serves a program; its outline says which):

  ```yaml
  inherits:
    - { line: ORG-2001, stance: builds, edition: checkout@4 }   # built to it
    - { line: FIN-3001, stance: refines, edition: checkout@4 }  # a stricter line of its own
    - { line: PAY-3001, stance: departs, edition: checkout@4 }  # needs an exception
  ```

  The line must be in that edition. A refinement carries a position whose
  binding word is at least as strict (no later in `bindings`); a weaker
  one is a departure. Both lines stay in force.
- A record that departs may be proposed. It is accepted only with an
  exception in force from that line's steward (see Exceptions below);
  until then the hub refuses the acceptance and says so. The machine gate refuses an edition whose
  line departs with no exception.
- Two lines that reach one scope and cannot both hold are a conflict. Flag
  it with a `vantage_write` to `conflicts`:

  ```markdown
  ---
  lines: [PAY-3001, FIN-3001]
  scope: payments
  ---

  A weekly settlement cannot be reconciled daily.
  ```

  The hub names the nearest scope at or above both lines' own scopes and
  its steward. In an `<owner>+<program>` edition, a clash between a line
  that came through the program and one that came through the owner goes
  to the steward of each line's own scope, and either rules. `vantage_outline conflicts` lists them, open first;
  `vantage_read conflicts/<n>` reads one. That steward or an admin rules
  with a `vantage_patch` of its header: add `ruling:` (`change`, `narrow`,
  or `exception`, with `exception:` naming it) and `note:`. A ruled
  conflict closes; nothing else of a conflict changes.
- Until the ruling, the setting `clash` at `standard` decides: `hold` (the
  default) keeps both lines, and a record of that scope or below that
  marks either line waits as proposed; `stricter` holds the line with the
  earlier binding word; `ranked` holds the line whose own scope or an
  ancestor of it comes first in `ranked:`. A line held back reads `held
  back by conflicts/<n>`, and the edition lists its open conflicts under
  `## Conflicts`.
- The hub files the checking when `checks:` at `standard` names a kind
  (built on `work-item`): an item for each record whose `inherits` marks a
  line its scope's new edition changed or took out, one for each line
  newly accepted, to check against the lines that reach the same scopes
  and facets, and one for each conflict, held by its steward. Take them
  from the queue; close one when the line holds, or flag a conflict.

### Exceptions

An exception lets a line bend in one place, for a while, with a reason and
a safeguard. Only the line's steward grants it.

- Ask with a `vantage_write` to `exceptions`:

  ```markdown
  ---
  line: PAY-3001
  covers:
    scope: checkout        # where it stands, and every scope below; owner+program or estate too
    records: [CHK-2003]    # optional: the departing records it lets stand; none is any record there
    things: [cloud:/accounts/acme/vaults/build]   # optional: what an engine exempts
  safeguard: What stands in for the line while the exception holds.
  ends: 2027-03-31         # the last day it is in force
  ---

  Why the line cannot hold here, for now.
  ```

  The answer names who grants it: the steward of the line's own scope.
  With `checks:` set, the hub files them an item.
- The steward grants with a `vantage_patch` of its header, `state: granted`,
  or refuses or withdraws it with `state: revoked`. They renew it by moving
  `ends` later. `vantage_read exceptions/<n>` shows its `steward:` line, who
  asked, who granted it, and its lasting `id` (`exception:<ULID>`).
- The rules are `exceptions` at `standard`, per kind of the line's scope
  (`rules.<kind>`, or `rules.default`): `longest_days` (365), `renews`
  (true), `separate` (true: the one who grants did not ask), `grantors`
  (people, or `scope:<id>` stewards, who may grant beside the steward).
  A locked line takes one only from the steward of `locked_by`; with none
  named, it takes no exception.
- In force means granted and not past its end. Then a record that departs
  from the line in that scope may be accepted, the edition carries it
  under `## Exceptions`, and each line says how many bend it. At the start
  of the day after `ends`, the hub ends it, files its steward an item to
  renew it or let the line hold, and files a re-check for each record
  that departed under it. A revoke does the same.
- `vantage_outline exceptions` lists them, newest first, with how many
  are in force on each line. Bring in another store's (a waiver file, a
  policy engine's exemptions, a catalog list) with
  `vantage_exceptions_import` through `vantage_tool`: read the store, then
  send one entry per exception. One with an owner, a reason, and an end
  arrives granted; one without arrives `incomplete`, for its steward.
- The code that deploys policy reads `GET /api/v1/exceptions?inForce=true`:
  each with its id, the line with its `enforcedBy` and `checkedBy`, the
  covered things, and its end. Write an engine's exemption from one, with
  the same end, named by its id; a judge counts no exemption without one.

## Voice walkthroughs in a hub

People record their voice over a walkthrough or a view's paths in the hub
viewer, and readers play it with the steps following the audio.
`vantage_recordings` lists them per view, with length, step count, and
whether each was made on an older version. A recording marks each step by
the boxes it lit, so keep step order and box ids steady once a view has
one: a step whose boxes all vanish is skipped on playback, and renaming an
id without keeping it as `id` drops that step from the recording. Agents
cannot record or play audio; recordings stay in the hub and are not part
of an HTML export.

A node without an `id` takes the slug of its name. Before you rename one,
give it `id` with its current id, so the relations and views that name it
still find it.

## Quality loop

After every change to a view, validate and render. A change to a fact or
a sentence needs neither: the write itself checks it. The result carries a score and
notes per view: crossings, arrows through boxes, label overlaps, extreme
aspect ratio, boxes without arrows, and what a reader trips on: labels away
from their line or as near another, labels on a frame or cut by a line,
lines running a few pixels apart or on top of each other, lines along a
border, short kinks, arrowheads that touch, badges on labels, cut-off text,
lines through a container's title, and long detours.
Read the notes and act on them:

- Many crossings: split the view into two questions, or pin an `order`.
- Arrows through boxes: collapse a container, or move the relation to a view
  where its endpoints are closer.
- Extreme aspect ratio: `direction: down`, or collapse the widest container.
- Unconnected boxes: remove them from the view or give them a relation.
- Never delete content to improve a score. Report the real number instead.
- A page that names a box, a view, or a heading that does not exist is an
  error. Fix the name or remove the reference.

When a view looks mechanical, ask the engine for alternatives. `explore`
lays the same view out several ways (other direction, the biggest container
as grid, mirror, ring, or collapsed) and returns one picture with every
candidate captioned and scored, plus the hints to paste for each. Choose by
eye, paste the hints, render again.

Always look at the rendered picture before you are done. The metrics catch
structure; only the picture catches the story.

## Finding the story

Before writing a view, write its question and its one-sentence answer. The
sentence tells you the gesture (above), the participants (only what the
sentence names), and the facts the boxes must carry (what the reader would
ask next). A view that needs a second sentence is two views, or a page.

Signs a view tells a story: a reader can say what happens first; every box
is there for a reason the sentence gives; the numbers a decision needs are
on the picture; one thing is visibly the point (a hero box, a colored path,
a highlight) and the rest is quiet.

Signs it is a mechanical layout: everything is the same size; every arrow
is the same color; boxes appear because they exist, not because the
question needs them; the reader has to look elsewhere for the facts.
