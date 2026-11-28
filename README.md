# Vantage

Vantage's mission is to be an organization's source of truth for intent,
hierarchy, and exceptions. It holds what the organization decided and what
must hold: its decision records, the standards built from them, the
procedures that explain them, the checks that test them, and the
exceptions to them, arranged by who each rule binds and who stewards it.
Agents read and write all of it at the cost of a local disk; people read,
steer, and approve. Vantage judges nothing and enforces nothing: a judge
checks the rules, the systems they guard enforce them, and a catalog shows
them. It holds diagrams, pages, decision records, tracked work, the
standards built from the records in editions, the conflicts between their
lines, and the exceptions to them.

At its heart is a diagram engine: code-first software and infrastructure
diagrams with human-grade layout. Built for agents to write, built for
people to read.

One YAML file holds a model (what exists, as a tree of boundaries), the
relations (what talks to what, tagged), and any number of views. Each view
answers one question with arrows: a relation view, a sequence, a flowchart
with swimlanes, a lifecycle, a timeline, a page of panels, a walkthrough over another
view, or a doc: a page of prose that names the model's boxes and embeds its
pictures instead of copying them. Vantage lays the views
out, scores them, and renders SVG, PNG, or a self-contained interactive HTML
with a view picker, hover and focus, and guided walkthroughs.

```yaml
nodes:
  - name: Shoppers
    type: users
  - name: Azure
    type: cloud
    children:
      - { name: Orders API, type: api, subtitle: ASP.NET 10 }
      - { name: Orders DB, type: database, subtitle: Azure SQL }
relations:
  - { from: shoppers, to: orders-api, label: places orders, tags: [requests] }
  - { from: orders-api, to: orders-db, label: reads and writes, kind: data, tags: [data] }
views:
  - id: requests
    title: Requests
    question: How does an order travel through the system?
    include: { tags: [requests, data] }
```

## Why it exists

Every code-to-diagram tool before this one ran a generic graph layout and
drew boxes around the result. The output reads like a dependency graph, not
like a picture a person would draw. The research behind this project
(`docs/research/`) traced that to a few shared causes, and the engine is
built against each of them:

| Earlier tools | Vantage |
|---|---|
| One global graph layout; containers bolted on | Each container lays out its own children; the canvas is composed bottom-up |
| Rank by graph distance | Flow by meaning: entry points first, exits last, actors lead, stores trail, text order breaks ties |
| Cycles deleted or ignored | Fewest arrows reversed, drawn as back edges |
| Every edge drawn | Sibling fan-in lifted to one trunk from the container, with a count |
| Text clipped or wrapped after layout | Text measured first with real font metrics; labels get their own room |
| Spline or straight edges through boxes | Orthogonal routing that avoids boxes and prefers gutters |
| One master diagram | Views: participants and their ancestors only; the rest becomes a "+3 more" badge |
| No feedback to the author | Every render returns a score and notes: crossings, arrows through boxes, label overlaps, aspect ratio |
| Layout depends on the window | Deterministic pixel layout; same file, same picture, in every export |

## Use it

```bash
bun install
bun run build                      # builds the viewer bundle once

bun packages/cli/src/main.ts lint   examples/shop/shop.vantage.yaml
bun packages/cli/src/main.ts render examples/shop/shop.vantage.yaml --format png --out out/shop
bun packages/cli/src/main.ts render examples/shop/shop.vantage.yaml --format html --out out/shop
bun packages/cli/src/main.ts render examples/shop/shop.vantage.yaml --format html --observed examples/shop/live.batch.json --out out/shop-live
bun packages/cli/src/main.ts import drawing.drawio --out out/imported
bun packages/cli/src/main.ts serve  examples/shop/shop.vantage.yaml   # live viewer, reloads on save
bun packages/cli/src/main.ts icons key vault --pack azure
```

### For agents

Install the Claude Code plugin. It brings the MCP tools and its skills
(`vantage-brief` finds the story, `vantage-author` writes and iterates,
`vantage-review` audits a set, `vantage-connect` and `vantage-publish` keep
a set fresh, `decide` writes and migrates decision records,
`vantage-work` takes tracked items from the queue and finishes them,
`roadmap` plans a roadmap at its level and the levels above and below, and
`vantage-onboard` gives a repository living docs). A session hook says,
in one line, when a repository has no `vantage.yaml` or nothing maps it
to a hub. A repository's `vantage.yaml` names its document; the hub and
workspace come from the estate's `~/.config/vantage/repos.yaml`
(`docs/agent-guide.md`, "A repository's pointer"). Install it:

```text
/plugin marketplace add orchard-suite/vantage
/plugin install vantage@vantage
```

The marketplace is this public repository. The
plugin needs `bun` on the path; it installs its own dependencies and builds
the viewer on first start. Update it later with `/plugin marketplace update
vantage` then `/plugin update vantage@vantage`.

Every release also publishes the plugin on its own, as a zip pushed to the
public package `ghcr.io/orchard-suite/vantage:plugin-<version>` (an OCI artifact,
signed like the image). That zip carries the remote MCP wiring: it connects
to a hosted hub's `/mcp` at `VANTAGE_HUB_URL`, sending your hub token, the
plugin's `hub_token` setting. Make a token on the hub: open your name at the foot of the sidebar, then Account and tokens. Claude Code
asks for it when you turn the plugin on from `/plugin`; to set or change it
later, run `/plugin configure vantage@<marketplace>` in Claude Code. It is kept
in the system's secure store, never in a settings file. From a script, pipe
`{"hub_token": "..."}` to `claude plugin configure vantage@<marketplace>
--values-stdin`. `VANTAGE_HUB_TOKEN` wins over the setting, and with neither
the plugin sends the token `vantage login` saved in `~/.config/vantage/hub.json`.
The hub's `/mcp` serves the authoring tools and the hub's own, so the remote
plugin needs no bun and no checkout. An estate that must not point its
marketplace at this repository pulls the zip with `oras pull`, hosts it where
its own people fetch from, and lists it as an `archive` source pinned by
`sha256`; the zip's sha256 is the artifact's single layer digest.

Any other MCP client points at the server directly:

```json
{
  "mcpServers": {
    "vantage": { "command": "bun", "args": ["/path/to/vantage/packages/cli/src/main.ts", "mcp"] }
  }
}
```

The agent is the first consumer (VAN-0002), so the server
shows it a small core and keeps the rest one call away. Always listed:
`vantage_outline` and `vantage_read` (the guide and the schema, by topic),
`vantage_validate`, and `vantage_render` (the PNG and the quality notes;
with `out`, the picture goes to a file and only the notes come back).
`vantage_tool` lists and calls the others: `vantage_explore` (the same
view laid out several ways, side by side, with the hints to paste),
`vantage_export` (interactive HTML), `vantage_import` (draw.io and Visio
drawings in, a pinned document out), `vantage_icons`. A host that loads
tools on demand itself can set `VANTAGE_TOOLS=all` to list every tool. The
HTTP API at `vantage serve` offers the same operations under `/api/`.

#### Working with a hub

The same server reaches a hub once this machine signs in to it:

```sh
bun packages/cli/src/main.ts login https://vantage.example.com
```

It opens the hub's approve page; approve the code it shows. The token is
kept in `~/.config/vantage/hub.json` (mode 600). From then on the MCP
server is a bridge to the hub. Everything the hub holds is text at an
address (`platform/shop`, `platform/shop/pages/overview.md`, `SHOP-2001`),
and five tools reach all of it:

| Tool | What it does |
|---|---|
| `vantage_outline` | What is at an address, as names and sizes |
| `vantage_find` | The lines that match, each with its address and line |
| `vantage_read` | One part, or several: `platform/shop#views.context` |
| `vantage_patch` | Swap one exact string, or set YAML by path; many in one call |
| `vantage_write` | The whole text of something new |

On the laptop the bridge adds a working copy. `vantage_checkout` writes a
document, a registry, or a workspace into a folder as files; the agent
edits them with its own tools; `vantage_sync` sends what changed and
brings back what moved. Wherever a tool takes content it takes a path, so
no file passes through the model. Rendering, export, and import stay on
the laptop with its files, and `vantage_render` and `vantage_validate`
take the `address` of a saved document. Comments, history, connectors,
publishing, and the record tools are listed and called through
`vantage_tool`. Restart the agent's MCP server after signing in. `logout`
forgets the hub. `VANTAGE_HUB_URL` and `VANTAGE_HUB_TOKEN` override the
file.

`bun scripts/bench/agent-cost.ts` prints what each task costs an agent on
the hub beside the same task on a disk, and what an agent holds before it
works. The check gate fails on a number over its budget
(`packages/mcp/src/budget.ts`).

### Decision records

Architecture decision records live in the hub, beside the diagrams of the
systems they decide about. A workspace holds registries (`SHOP`), each a
numbered set of records with a category scheme; a record is cited as
`SHOP-2001` or by its id, `adr:<ULID>`. A record links to the boxes it
governs, and each of those boxes shows it in the viewer. Records are
refined in place, with every revision kept, or superseded by a new record.
The hub indexes every citation, so a record's page lists what cites it,
and a record can be renumbered, recategorized, or moved to another
registry with every citation following and its old number kept as an
alias. The workspace's Decisions tab lists them; each has its own page.
A record is text at its citation: an agent finds, reads, patches, and
writes it with the five tools above, one sentence at a time. The record
tools behind `vantage_tool` do what is not text: `vantage_registries`,
`vantage_decision_supersede`, `vantage_decision_move`,
`vantage_decision_discard`, `vantage_decision_next`, and
`vantage_decision_import`, which brings a
folder of a repository's Markdown records in by its path, with their
numbers, dates, status, decision makers, and supersede links.

The `decide` skill writes them. It reads the estate's registries from
`~/.config/vantage/decisions.yaml` (or the file `VANTAGE_DECISIONS_CONFIG`
names); `skills/decide/decisions.example.yaml` shows every key.

### Tracked work and roadmaps

A hub tracks work as items of a kind: a document with a `kind` block,
built on a kind the hub ships (`work-item`, `roadmap-item`, or
`milestone`). A roadmap item moves by its proof, never by a typed status.
Items keep an order inside each horizon (`place`), carry a `start` and an
`end`, and a parent's span is worked out from its parts. A milestone is a
dated point that items of any kind link `toward`; it ships when they all
have, and says whether it is on track. The workspace's Work tab shows a
kind as a list, a board a person reorders by dragging, and a timeline of
bars, points, and milestone markers. `docs/agent-guide.md`, "Kinds and
items", has the details.

### Telling a story

A view is a question with a one-sentence answer, and the sentence has a
shape. Boxes carry `facts`, a `value`, `bullets`, a `note`. Containers take
a gesture: `flow`, `grid`, `mirror`, `ring`, `outline`, `matrix`, explicit
`layers`. Views add numbered `paths` with a narrative, `highlights` around
sets (across containers when something is in both), `annotations` as
stickies, callouts, headings, and prose, a `legend`, and `kind: page` to
compose several views on one canvas. None of it is a diagram type; the
guide's gesture table maps sentences to primitives, and `vantage_explore`
shows alternatives when a view looks mechanical.

The authoring guide is `docs/agent-guide.md`. The design and the research
that shaped it are in `docs/design.md` and `docs/research/`. Decision
records live in a Vantage hub, in the registry `vantage.yaml` names, and are
cited as `VAN-NNNN`.

## Layout of the repository

| Package | Job |
|---|---|
| `packages/model` | The language: zod schema, YAML parser with line numbers, resolver, JSON Schema |
| `packages/layout` | The engine: visible set, flow, grid, and gesture arrangements, compositor, orthogonal router, labels, story pass (notes, highlights, paths, legend), page composition, metrics, explorer, sequence and flow layouts |
| `packages/render` | SVG renderer, themes, icon packs (generic, Azure, AWS, Kubernetes, brand), PNG export, interactive HTML bundle |
| `packages/viewer` | The browser viewer: picker, pan and zoom, hover and focus, walkthroughs, morphing transitions, and in the hub who is here and follow the presenter |
| `packages/export` | PDF (vector), draw.io, VSDX, clipboard SVG and PNG, title blocks |
| `packages/import` | draw.io and VSDX (Visio, Lucidchart export) drawings in, pinned, plus Ilograph, Mermaid, PlantUML, and Markdown diagram blocks laid out fresh: nodes, relations, views, inferred hints, a report |
| `packages/connectors` | Sources of truth: the push shape with open items, Backstage conversion, Orrery (with firing alerts), kubectl, Cloudflare, Azure Resource Graph, Jira, GitHub, git history from GitHub or GitLab, generic HTTP, mappings, merge, bind, freshness, drift |
| `packages/publish` | Publications and targets: fs, Azure Blob, git, webhook, SharePoint, Confluence, Teams |
| `packages/server` | Shared operations plus the Hono HTTP API and live reload |
| `packages/mcp` | The MCP server |
| `packages/cli` | The `vantage` command |
| `examples/` | Three made-up example sets that cover every view kind and story primitive |
| `packages/hub` | The self-hosted hub: Postgres, OIDC or proxy auth, workspaces, versions, worker, web viewer, REST, remote MCP, guest links, comments on boxes with @mentions, reactions for review sessions, YAML editing in the browser with a live picture, revisions from comments and diagrams from a description on the organization's model API, live presence and follow, voice walkthroughs, audit |
| `deploy/`, `Dockerfile` | The image and the Helm chart; see `docs/deploy.md` |
| `skills/`, `.claude-plugin/`, `.mcp.json` | The Claude Code plugin: skills and MCP wiring. `.mcp.json` runs the local bridge from a checkout; `.claude-plugin/mcp.remote.json` and `scripts/mcp-headers.sh` are the remote wiring the released zip carries |

## Fonts and icons

Inter (SIL OFL 1.1) is embedded for measurement and rendering. The chrome
adds Bricolage Grotesque for the brand voice and JetBrains Mono for ids and
code (both SIL OFL 1.1, in `packages/render/assets/fonts`); the hub serves
them under `/assets/fonts/`, and they never appear inside a picture. The
shared interface kit (buttons, fields, menus and the rest) lives in
`packages/render/src/kit.ts`; a signed in hub reader sees every part at
`/kit`. Icon packs
and their licenses are documented in `packages/render/src/icons/README.md`.
The `azure`, `aws`, and `k8s` profiles in `packages/model/profiles` give
infrastructure diagrams their vendor icons; a document adds its own icons
and pictures as files beside it (`docs/agent-guide.md`).

## License

MIT, `Copyright (c) 2026 The Orchard authors`. See `LICENSE`. The fonts and
icon packs keep their own licenses, listed above.
