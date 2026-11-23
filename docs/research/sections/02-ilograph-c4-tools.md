# Section 02: Ilograph and the C4 model tools

Researched 2026-10-26. Sources are cited inline, from public pages only. Anything I could not verify is marked as a guess. The web search budget for this run was exhausted
near the end, so a couple of items (an HN or Reddit thread on LikeC4, a Structurizr "vNext" announcement post)
were not found; they are noted where relevant.

---

## Ilograph

Closed-source, single-founder product (Billy Pilger, Ilograph LLC; the brief's "Billy Whyte" is a mix-up, every
blog post and the X account are Billy Pilger: https://x.com/ilographs). Web app at https://app.ilograph.com,
Desktop app, Confluence Cloud plugin. The owner's favourite, so this section is the longest.

### 1. Language

Ilograph is a YAML document with four top-level keys: `resources`, `perspectives`, `contexts`, `imports`,
plus `description` and `defaultContextDisplayName` (https://www.ilograph.com/docs/spec/).

Minimal diagram (shape taken from https://www.ilograph.com/docs/editing/resources/ and
https://www.ilograph.com/docs/editing/perspectives/relation-perspectives/):

```yaml
resources:
- name: My Company's AWS Instance
  subtitle: AWS Instance
  children:
  - name: getOrder
    icon: AWS/Compute/Lambda.svg
    subtitle: Lambda function
  - name: Order
    subtitle: DynamoDB table
    icon: AWS/Database/DynamoDB_Table.svg
- name: Customer
  subtitle: Person

perspectives:
- name: Runtime
  defaultArrowLabel: calls
  relations:
  - from: Customer
    to: getOrder
    label: GET /order
  - from: getOrder
    to: Order
    label: Reads
- name: Place Order
  sequence:
    start: Customer
    steps:
    - to: getOrder
      label: GET /order
    - toAndBack: Order
      label: Query
```

**Resource tree.** A resource has `name` (required, unique among siblings; `id` substitutes when the name has
`/ ^ * [ ] ,`), `subtitle` (one line, no markdown), `description` (markdown, multiline, or a key/value map that
renders as a table and is inherited and mergeable), `icon` and `iconStyle` (`default` or `silhouette`),
`color` (text colour, default `dimgray`), `backgroundColor`, `style` (`default`, `plural` for stacked boxes,
`dashed`, `outline`, `flat`), `url`, `children`, `abstract` and `instanceOf`, and `layout`
(https://www.ilograph.com/docs/spec/). `instanceOf` inherits all properties and children of an `abstract: true`
resource; local children override inherited ones by id; no multiple inheritance; abstract resources cannot
appear in perspectives (https://www.ilograph.com/docs/editing/resources/). The founder describes this as
TypeScript-inspired: declare a typed model first, then perspectives are checked against it, with model-aware
autocomplete in the editor (https://www.ilograph.com/blog/posts/how-typescript-inspired-ilograph).

**Relation perspectives.** `relations:` is a list of `{from, to, via, label, description, arrowDirection,
color, secondary}`. `from` and `to` accept comma-separated lists. `via` draws the relation passing through
intermediaries (chain by comma). `arrowDirection` is `forward` (default), `backward`, or `bidirectional`,
relative to the perspective orientation. `secondary: true` draws the arrow but "does not affect layout"
(https://www.ilograph.com/docs/spec/, https://www.ilograph.com/docs/editing/perspectives/relation-perspectives/).
Perspective-level `defaultArrowLabel`, `defaultArrowColor`, `color` (tray colour, default `royalblue`),
`orientation` (`leftToRight` default, `topToBottom`), `notes` (markdown shown in the notes panel).

**Sequence perspectives.** `sequence: {start, steps}`. Each step is one of `to`, `toAndBack` (adds the return
step), `toAsync` (dashed arrow, control stays), `restartAt` (no arrow), or `subSequence` (named, coloured,
nestable box with its own `steps` and `notes`). Steps take `label`, `description`, `color`, `bidirectional`.
`none` means off-screen (https://www.ilograph.com/docs/editing/perspectives/sequence-perspectives/). Sub-sequences
arrived Sep 2025 (https://www.ilograph.com/blog/posts/new-in-ilograph-sub-sequences/).

**References.** `Parent/Child` path, `Ancestor//Descendant` any-depth, `[Port *]` multi-match with wildcards,
`../` relative to the other end of the same relation (only one end may be relative; in `via`, `../` is relative
to `from` and `.../` to `to`), `Resource *2` clones so one resource appears twice, `Perspective::Name` embeds a
whole perspective as a box, `Namespace::Name` for imports, and `aliases: [{alias: RACK_A, for: "a, b, c"}]`
(https://www.ilograph.com/docs/editing/perspectives/references/,
https://www.ilograph.com/docs/editing/perspectives/advanced-references/). Ambiguous references "resolve to one
of the referenced resources", undefined which.

**Composition.** `extends: A, B` merges relations (later wins; a sequence replaces the extended one entirely);
`Perspective::X` embedding; `hidden: true` for helper perspectives; perspective groups via `Group//Sub//Name`
(https://www.ilograph.com/docs/editing/perspectives/extending-and-embedding/,
https://www.ilograph.com/docs/editing/perspectives/perspective-groups/).

**Overrides (per perspective).** `overrides: [{resourceId, parentId, scale, detail}]`. `parentId` re-parents for
that perspective only (or `none`); `scale` is a size multiplier; `detail: minimize|maximize` pins expansion
(https://www.ilograph.com/docs/editing/perspectives/parent-overrides/,
https://www.ilograph.com/docs/editing/perspectives/resource-sizes-and-positions/).

**Contexts.** Top-level `contexts: [{name, roots: [{resourceId, children: [...]}], extends, hidden}]` define an
alternate containment tree (for example by AWS region instead of by service) that the viewer picks from a
drop-down; arrows stay the same, the boxes around them change
(https://www.ilograph.com/docs/editing/contexts/). The founder's rationale: overrides were a flat list, mixing in
hidden "context" perspectives via `extends` cluttered the tray, and walkthroughs could not change context
(https://www.ilograph.com/blog/posts/why-ilograph-added-contexts).

**Walkthroughs.** `walkthrough: [{text, select, expand, highlight, detail, hide, context}]`; omitted values carry
over from the previous slide; `^` clears (https://www.ilograph.com/docs/editing/walkthroughs/).

**Imports.** `imports: [{from: user/diagram, namespace: NS}]`; imported perspectives and contexts are hidden
and must be extended; chained imports allowed, circular not (https://www.ilograph.com/docs/editing/imports/).
The built-in library `ilograph/aws` lives at https://github.com/billy-pilger/ilograph-standard-libraries, MIT,
24 stars, last push 2024-10-11 (gh api). This is the "small part that is open source" the founder mentioned on
HN (https://news.ycombinator.com/item?id=41264198 summary).

**Perspective options.** `options: {additionalContext: all|none|super-only|sub-only, unwrapContext,
initialDetailLevel, hideEmbedded, hidden, deduplicateImportedResources, defaultArrowColor, defaultArrowLabel,
arrowDirection, extendWalkthrough}` (https://www.ilograph.com/docs/spec/#perspective-options).

**Layout keys in the spec.** Only two exist, under a resource's `layout`: `compactness` (0.1 to 1, "only affects
context resources with more than one child") and `sizes: proportional|uniform|auto`
(https://www.ilograph.com/docs/spec/). Plus `orientation`, `unwrapContext`, `secondary`, `scale`, `detail`,
and relation ordering. There are no coordinates anywhere in the format.

### 2. Layout

**Engine.** Proprietary and in-house. No blog post or doc describes the
algorithm; the founder has only said "diagrams are 100% laid out by machine" and "Trees work best in
perspectives of course, but there is some support for loops... There's no perfect way to display generic graphs
with loops, so I'm still experimenting with the algorithm to lay them out"
(https://news.ycombinator.com/item?id=20390560, Show HN 2019).

**What the docs do say about placement** (https://www.ilograph.com/docs/editing/perspectives/resource-sizes-and-positions/):

- "While the Ilograph layout engine determines the sizes, positions, and detail levels of resources
  automatically, these properties can be adjusted by diagram editors on a per-perspective basis."
- Size: "Resources with more relations generally render larger", overridable with `scale`; "Whether a resource
  scales horizontally, vertically, or both depends on how it is laid out relative to its neighbors."
- Horizontal position (relation perspectives): placed left to right "based on their relations and their parent
  (context) resources". `from` is the left side, `to` the right side (spec: "from: the dependent (left-side)
  resource(s)", "to: the independent (right-side) resource(s)").
- Vertical position: "Top-to-bottom order follows the order in which resources are first referenced in the
  perspective's relations." Comma lists read left to right as earlier to later. The documented trick to control
  order is a from-only relation at the top of the list: `- from: Service B, Service X, Service Y`.
- Detail level: the slider collapses or expands children; `detail: minimize|maximize` pins.
- `unwrapContext: false` (default): "context resources stay grouped inside their parent, even if that makes
  relation arrows point backward"; `true`: "context resources may be left out so that relation arrows always
  flow in one direction" (https://www.ilograph.com/docs/editing/perspectives/perspective-options/).
- `additionalContext: none` makes the perspective "appear very flat".

**What the release notes say** (https://www.ilograph.com/desktop/releaseNotes.txt):

- Sequence perspectives gained an ordering pass in 2.4.3: "Sequence resources
  will now be ordered left-to-right to make the sequence flow more natural with less backtracking"
  (https://www.ilograph.com/desktop/releaseNotes.txt).
- Width budget depends on the window: "Layout engine is now more responsive to window size" (1.5.6). The layout
  is therefore not a fixed-coordinate graph; it reflows to the viewport, which is why exported HTML is "mobile
  friendly".

**Why Ilograph layouts "tell a story" (owner's phrasing). My characterisation, partly verified:**

1. Containment first, relations second. The parent tree (or the chosen context) defines the boxes; relations
   only decide left/right order within and across boxes. The docs state both the parent-driven boxes ("By
   default, all perspectives will render context resources based on the resource hierarchy",
   https://www.ilograph.com/docs/editing/resources/) and the relation-driven horizontal placement. The
   `unwrapContext` option is the explicit knob for the one conflict between the two (an arrow that would have
   to go backward to stay inside its box). Verified from docs.
2. A single flow axis. Everything flows `from` (left) to `to` (right), or top to bottom with `orientation`.
   There is no notion of rank independent of the author's `from/to` choice, and backward arrows are a
   first-class, labelled exception (`arrowDirection: backward`) instead of something the engine decides.
   Verified from spec.
3. Deterministic, author-controlled vertical order. Top-to-bottom order is "the order in which resources are
   first referenced", so the author's narrative order in the YAML becomes the reading order on screen. Nothing
   is randomised, there is no stochastic crossing minimisation, and small edits do not reshuffle the picture.
   Verified from docs; and the release note 1.2.1 "Fixed resource order not always respecting relation order"
   shows this is an intended invariant.
4. Nothing is placed by graph rank alone. Because placement is by containment plus author order, two services
   in the same box stay side by side even if one has twice the fan-in. Graphviz or dagre would spread them
   across ranks.
5. Sizing carries meaning. Boxes grow with relation count and with selection (20x boost while selected),
   `scale` lets the author emphasise; the detail slider collapses by depth ("Detail slider now hides and shows
   resources based on their depth", 1.4.5). The picture reads as "big important thing, small supporting
   things".
6. The author is pushed to split. The founder's guidance is "many simple perspectives" over one master diagram,
   and the engine enforces it in practice: "The layout engine has to omit many arrow labels because so many
   overlap" (https://www.ilograph.com/blog/posts/breaking-up-the-master-diagram). Small perspectives with one
   concern each are what make the flow readable.
7. Guess: the engine is a recursive box-packing layout (each parent lays out its children in columns by
   from/to depth, then stacks within a column in first-reference order), not a general graph drawer. The
   founder's "trees work best" comment points that way. Loops are handled by reversing one edge, and `via` chains are drawn as
   merged pass-through arrows ("Fixed via arrows not merging in low-detail scenarios", 2.1.4).

**Manual positioning.** None. No x/y anywhere. The only hooks are `orientation`, relation order, from-only
relations, `secondary`, `unwrapContext`, `additionalContext`, `scale`, `detail`, `compactness`, `sizes`, and
re-parenting via overrides or contexts.

**Edge routing.** Arrows are straight or curved between box edges; since 1.7.6 "arrows will now route around
resources instead of jumping over them when space permits" and before that they drew "jump" arcs; intersecting
arrows fade (toggleable since 1.9.4); multiple relations between the same pair are merged unless label,
description or colour differ (1.4.4, 1.8.9); long labels wrap (1.4.6) then truncate with ellipsis (1.6.9);
labels avoid each other "in more cases" since 1.5.7 (https://www.ilograph.com/desktop/releaseNotes.txt).

### 3. Interactivity

From https://www.ilograph.com/docs/getting-started/browsing-diagrams/ and https://www.ilograph.com/features.html:

- Click a resource to select it: "When a resource is selected, unrelated resources are hidden", its description
  and relations are shown, arrows to it get labels. Click again to select the parent. Dots on a selected resource
  switch perspective while keeping the selection.
- Detail slider (top right) expands or collapses children by depth; `initialDetailLevel` per perspective.
- Fullscreen (zoom into) any resource with children, via button or Ctrl/Alt-click; "Exit fullscreen" returns.
- Perspective tray at the bottom, grouped; notes panel on the right (resizable since 2.2.3); contexts drop-down;
  Source tab with the YAML and in-place editing for editors.
- Walkthroughs: "Start Walkthrough" plays slides with Next, Back (added 2.1.0), Finish.
- Sequence perspectives: zoom into sub-sequences; unrelated arrows fade when something is selected (2.0.8).
- Resource finder (search), dark mode, screen reader and keyboard navigation, "Bold arrows" and "Hide arrows"
  toggles, deep links to perspective and resource in exported HTML (1.3.4).
- Hover on an arrow shows its `description`; a `*` marks arrows that have one.

**Embedding and export.** HTML export produces "100% self-contained HTML files that can be hosted anywhere"
(https://www.ilograph.com/features.html). There is no documented iframe snippet or "Ilograph Live" product; I
found no page using that name. Export paths: Desktop CLI `./Ilograph\ Desktop diagram.ilograph --output out.html
--perspectives Code,Region` (https://www.ilograph.com/docs/cli-and-export-api/); the hosted Export API via
`npm install -g export-ilograph` then `export-ilograph PATH OUTPUT -k KEY`, priced $99.99/month for 750 exports
then 10 cents each, or $399.99/month for 5,000 (https://www.ilograph.com/export-api-online/). Only HTML is
documented as an output; an "Export to Image" menu item exists since 1.0.4 (release notes) but no SVG or PNG
CLI output is documented. The Team Workspace API (Team+ only) is GET/PUT/HEAD of diagram YAML by path with an
`accessKey` header and an IP allow-list; it cannot create or delete diagrams
(https://www.ilograph.com/docs/team-workspace-api/).

### 4. Agent and LLM friendliness

- Official: "Ilograph Agent Skills" announced 2026-09-09, repo https://github.com/ilograph/skills (Apache-2.0,
  14 stars, created 2026-08-13, gh api). Installs as a Claude Code plugin (`/plugin marketplace add
  ilograph/skills`, `/plugin install ilograph-skills`) or via `npx skills add ilograph/skills`; commands
  `/generate-ilograph` and `/update-ilograph` write `ilograph.yaml` sequence diagrams of a codebase with code
  citation links. The README's pitch: "Ilograph diagrams are defined in a declarative syntax (YAML), allowing
  both humans and agents to iterate on existing diagrams instead of re-creating them from scratch" and
  "Sequence flows in Ilograph diagrams can be nested, meaning there is practically no limit to how large and
  detailed they can be." The skills only generate sequence perspectives, not relation perspectives.
- No official MCP server. An unofficial one exists, https://github.com/QuincyMillerDev/ilograph-mcp-server
  (MIT, 3 stars, 12 tools: fetch docs and spec, list and fetch examples, `validate_diagram_tool`, icon search).
- No public JSON schema or validator CLI from Ilograph; validation happens in the app editor (autocomplete and
  error markers). The founder's own view on LLMs: generic whiteboard diagrams work, "system diagrams from source
  code" produce vague, hallucinated output; he recommends sequence diagrams and multiple perspectives
  (https://www.ilograph.com/blog/posts/diagrams-ai-can-and-cannot-generate/, and mistake #7 in
  https://www.ilograph.com/blog/posts/more-common-diagram-mistakes/).
- Terseness: the YAML is flat and regular (name, subtitle, children; from, to, label), with no coordinates and no
  identifiers other than names, so an LLM has little to get wrong. Known failure modes (guess, from the spec's
  rules): names with `/`, `,`, `*`, `[`, `]` or `^` need an explicit `id`; ambiguous duplicate names silently
  resolve to one match; `abstract` resources cannot be referenced; sequences cannot reference non-leaf context
  boxes meaningfully. Determinism: layout is deterministic for a given YAML and viewport width.

### 5. What it does well

- One model, many perspectives, with the containment tree shared and swappable via contexts.
- Nested boxes with a single left-to-right flow and author-ordered rows; no coordinates to maintain; the
  picture reflows to the viewport.
- Selection-driven hiding of unrelated resources, so a 200-node perspective remains explorable.
- Sequence perspectives drawn on the same resource boxes (not lifelines), nestable sub-sequences, walkthroughs.
- Export to a single interactive HTML file.
- Users: "what all these diagram-as-code tools should aspire to" and "next gen" in the D2 and Mermaid HN threads
  (https://news.ycombinator.com/item?id=33704254, https://news.ycombinator.com/item?id=41264198 summaries);
  "I love how it shows dependencies" and "The walkthrough was extremely well put together"
  (https://news.ycombinator.com/item?id=21999734); a G2 reviewer titled it "the best diagramming tool for
  communicating complex distributed systems" and complained only about site-licence cost
  (https://www.g2.com/products/ilograph/reviews, via search summary; the page itself returned 403).

### 6. Where it fails and why

- Loops and dense graphs. Founder: "There's no perfect way to display generic graphs with loops"
  (https://news.ycombinator.com/item?id=20390560). Guess: the engine reverses one edge per cycle, so in a
  cyclic perspective one arrow goes backward and the author did not choose which. Fan traps collapse into one
  intermediary; the fix is modelling (topics inside the broker) or `via`
  (https://www.ilograph.com/blog/posts/avoid-fan-traps-in-system-diagrams/).
- Label omission under density: "The layout engine has to omit many arrow labels because so many overlap"
  (https://www.ilograph.com/blog/posts/breaking-up-the-master-diagram). Labels truncate with ellipsis; the full
  text only on hover.
- Text collisions on hover in Firefox: "It's not a great look for Ilograph's first example diagram to smash text
  on top of one another" (mdaniel, https://news.ycombinator.com/item?id=41264198); founder: "a known issue with
  FireFox... at least it only happens on hover"; reply: "That's... not better."
- Information overload on first open: "A bit disorienting due to information paralysis"; suggestion to show
  only top-level blocks by default (https://news.ycombinator.com/item?id=21999734). The detail slider exists
  but was missed by the commenter.
- Layout churn history: the release notes show the engine being patched continuously for width inconsistency,
  arrows clipped at margins, labels not appearing, via arrows not merging, sequence mis-alignment (for example
  2.2.3, 2.4.0, 2.1.7, 2.1.6, 1.9.8, 1.9.0). Layout quality is good but the algorithm is hand-tuned, not
  principled, and no spec guarantees anything.
- No manual nudge at all; when the auto layout is wrong the only tools are reordering relations, `secondary`,
  `scale`, re-parenting, or splitting the perspective.
- Closed source, single vendor, no self-hosted server (Desktop is the offline option). Pricing
  (https://www.ilograph.com/pricing.html): Free $0 (unlimited public and private diagrams, built-in icons, 14 days
  history, 2 viewers per private diagram per an older search snapshot); Pro $18 or $22/month (custom icons,
  unlimited history, 20 private viewers, share links, HTML export); Team $25 or $30 per editor/month (unlimited
  viewers, workspace); Team+ contact sales (SAML SSO, Workspace API); Desktop $11.99/month yearly or $14.99
  monthly, org tiers down to $6.49 (https://www.ilograph.com/desktop/); Confluence priced by team size.
  Desktop 2.4.8 released 2026-10-03; roughly two releases a month since 2021
  (https://www.ilograph.com/desktop/releaseNotes.txt).
- No SVG or PNG export path in the CLI, no API in the free or Pro tiers, no MCP server, no JSON schema.
- Not a flowchart or general-purpose tool: no decision diamonds, no free-form shapes, every node must be a
  resource in the tree.

### 7. License and maturity

Proprietary. Launched Show HN 2019
(https://news.ycombinator.com/item?id=20390560), 1.0.0 Desktop 2021-02-09, 2.4.8 on 2026-10-03. Only the AWS
standard library (MIT) and the agent skills (Apache-2.0) are open.

### 8. Ideas to steal

- The layout contract itself: containment tree first, `from` left and `to` right, rows in first-reference order,
  `secondary` for arrows that must not move anything, `unwrapContext` as the one escape hatch, `via` for
  pass-through, `scale` and `detail` as emphasis rather than coordinates.
- Selection hides unrelated nodes; perspective dots on a selected node; detail slider by depth.
- `contexts` as swappable containment trees over the same model; `overrides.parentId` per view.
- `abstract` plus `instanceOf` with child inheritance; key/value descriptions that inherit and merge.
- `Perspective::X` embedding (a whole view as a node); `extends` with later-wins merge.
- Sequence steps as `to`, `toAndBack`, `toAsync`, `restartAt`, `subSequence` drawn over the same boxes.
- Walkthrough slides with carry-forward properties; self-contained HTML export with deep links.
- The founder's content rules worth encoding as linter warnings: unconnected resources, master diagrams, fan
  traps, conveyor belts, missing names or types
  (https://www.ilograph.com/blog/posts/more-common-diagram-mistakes/).

---

## Structurizr DSL

Simon Brown's C4 reference implementation. Big change in 2026: the `java`, `dsl`, `cli`, `lite`, `onpremises`,
`ui` and `puppeteer` repos are archived and consolidated into https://github.com/structurizr/structurizr
(Apache-2.0, 501 stars, pushed 2026-10-26, tags `v2026.10.26`, `v2026.09.19`, `v2026.06.28`; gh api). The
`structurizr/dsl` repo no longer exists (404). "Local" replaces Lite and "Server" replaces on-premises
(https://structurizr.com/).

### 1. Language

One `workspace` with `model` and `views` (https://docs.structurizr.com/dsl/language):

```
workspace "Shop" "Online book store" {
    model {
        customer = person "Customer"
        shop = softwareSystem "Online Book Store" {
            web = container "Web Application" "" "Spring Boot"
            db  = container "Database" "" "PostgreSQL" {
                tags "Database"
            }
        }
        customer -> web "Browses and makes purchases using"
        web -> db "Reads from and writes to" "JDBC"
    }
    views {
        systemContext shop "Context" { include * autoLayout lr }
        container shop "Containers" { include * autoLayout lr 300 300 }
        dynamic shop "PastOrders" { customer -> web "Requests past orders"  web -> db "Queries" autoLayout }
        styles { element "Database" { shape cylinder } }
    }
}
```

Elements: `person`, `softwareSystem`, `container`, `component`, `group` (nested boundaries), `element` (custom),
and deployment `deploymentEnvironment`, `deploymentNode`, `infrastructureNode`, `softwareSystemInstance`,
`containerInstance`. Relationships `a -> b "desc" "tech"`, implied source via `this`, archetypes like
`--https->`, `-/>` to remove. Views: `systemLandscape`, `systemContext`, `container`, `component`, `dynamic`,
`deployment`, `filtered` (by tag over a base view), `custom`, `image` (PlantUML, Mermaid, Kroki). Expressions:
`include *`, reluctant `*?`, `include "a -> b"`, `exclude`, tag expressions. `autoLayout [tb|bt|lr|rl]
[rankSeparation] [nodeSeparation]`, defaults 300 px and 300 px. `styles { element <tag> { shape icon colours
border } relationship <tag> { thickness colour routing } }`, `theme`, `!include`, `!docs`, `!adrs`,
`!identifiers hierarchical|flat`, `workspace extends <file|url>`
(https://docs.structurizr.com/dsl/language).

Philosophy: one model, many views; the model enforces C4 hierarchy (containers inside systems, components
inside containers), so views cannot drift from each other (https://docs.structurizr.com/ai). Dynamic views are
an ordered list of relationship instances describing one feature; the same static relationship may appear in
many steps (https://docs.structurizr.com/dsl/cookbook/dynamic-view/).

### 2. Layout

Two engines, neither Structurizr's own:

- Dagre in the browser UI: "The Dagre library is used for automatic layout. It generally does a good job, but
  isn't perfect and may fail on diagrams that include lots of nested elements" (editor docs,
  https://docs.structurizr.com/server/diagrams/editor, verified in the docs repo
  `commands/03-server/21-diagrams/02-editor.md`).
- Graphviz `dot` on the server side via `structurizr-autolayout`: "Export the view to a DOT file. Run Graphviz
  (via the dot command), with the output format set to SVG. Parse the generated SVG to extract layout
  information, and apply this to the Structurizr view (element x,y positions, relationship vertices, and paper
  size)" (https://github.com/structurizr/structurizr/blob/main/structurizr-autolayout/README.md). Graphviz must
  be installed unless the Docker image is used.

Users cannot tell which runs when: "the layout engine is coming from either GraphViz or a library called Dagre...
I can't quite tell when it uses one or the other yet" (https://github.com/structurizr/ui/discussions/98).

Manual layout is the default and the product's tagline now says "manual layout" (https://structurizr.com/).
Drag elements in the browser editor, align left/centre/right/top/middle/bottom, distribute, add vertices to
relationships, `r` toggles routing between direct, orthogonal and curved, `j` toggles line jumps; positions are
saved into the workspace JSON. "You will not be able to modify the diagram layout if automatic layout is
enabled", and the magic-wand button runs Dagre once on a manual view
(https://docs.structurizr.com/server/diagrams/editor). Explicit view keys matter: auto-generated keys "are not
guaranteed to be stable over time, and you will likely lose manual layout information"
(https://docs.structurizr.com/dsl/language).

Nested boundaries are drawn as boxes around elements, but the layout engines treat them as afterthoughts: dagre
has no compound support and Graphviz clusters are known to be weak (see LikeC4 section for the same root cause).

### 3. Interactivity

Viewer: zoom in/out/fit, fullscreen, diagram navigator (above, beside, below), keyboard navigation between
views, "double-click diagram elements to zoom-in and navigate to the diagram at the next level of detail",
documentation or decisions; dynamic views animate step by step (`.` and `,`), with play/stop controls
(https://docs.structurizr.com/server/diagrams/viewer, docs repo `01-viewer.md`). A sequence-diagram rendering
toggle for dynamic views is something I recall but could not confirm in the fetched docs. Embedding via iframe
and image embeds exists on the server. No hover-hiding of unrelated elements; no detail slider; views are fixed
pictures.

### 4. Agent and LLM friendliness

Strong. The official position: "LLMs excel at generating text - the Structurizr DSL is text-based, version
controllable, and diff-friendly" (https://docs.structurizr.com/ai), with a DSL-generation walkthrough that admits
"a little cleanup is required" (https://docs.structurizr.com/ai/dsl-generation). An official MCP server
(`structurizr-mcp` module, hosted at `mcp.structurizr.com`, Docker `structurizr/mcp`) offers DSL validate,
parse to JSON, inspect, export to Mermaid and PlantUML, and CRUD against a server; Claude Desktop needs
`mcp-remote` because the transport is HTTP (https://docs.structurizr.com/ai/mcp). Inspections flag missing
descriptions or technology (https://docs.structurizr.com/workspaces/inspections). The DSL is verbose but very
regular; the parser gives line-numbered errors. LLM failure mode (guess, from the grammar): identifier scoping
under `!identifiers hierarchical`, and the rule that containers must be declared inside their system.

### 5. What it does well

- The model is the product: C4 rules enforced, views derived, one source for context, container, component,
  deployment and dynamic diagrams.
- Mature export surface: PlantUML, C4-PlantUML, Mermaid, WebSequenceDiagrams, static HTML site, PNG, SVG, JSON,
  themes, custom exporters (https://docs.structurizr.com/export), plus a separate `structurizr-ilograph`
  exporter that emits a "Static Structure" perspective and one perspective per dynamic and deployment view, with
  `ilograph.icon` and `ilograph.imports` properties (https://docs.structurizr.com/export/ilograph, via search
  summary; the page itself 404s now, the Maven artifact `structurizr-ilograph` exists).
- Open core: Apache-2.0 DSL and libraries; Local (Docker) is free; the playground is free.

### 6. Where it fails and why

- Auto layout is the number-one complaint. "the resulting layouts often end up with relationships crossing over
  elements or other relationthips... I find myself needing to manually reposition elements... I believe this is
  an area where Structurizr could improve significantly" (juanrferia, Apr 2025,
  https://github.com/structurizr/ui/discussions/98; no maintainer reply). "Overlapping Relationship Lines"
  (https://github.com/structurizr/ui/discussions/49). Graphviz "doesn't work well with multiple relations between
  two elements" (https://github.com/structurizr/java-extensions/issues/27). "system overlap layout in component
  diagram (using Graphviz)" (https://github.com/structurizr/onpremises/issues/191). "autoLayout not working in
  Deployment Diagrams with relationship between deployment nodes" (https://github.com/structurizr/dsl/issues/25).
- Why: dagre is a plain layered DAG layouter with no compound nodes, so C4 boundaries (system, container,
  group) are drawn after the fact around elements that were ranked without regard to their box; Graphviz
  clusters rank nodes globally and only wrap boxes around them. Neither places "by meaning"; both place by
  rank. Default 300 px rank and node separation spread small diagrams into sparse grids.
- Filtered views share one layout by design, so a filtered diagram keeps the gaps of the elements it hides:
  "Graphviz leaves components spread apart, while Dagre moves the components based on the filter, which looks
  a lot better"; maintainer: "This is actually how it's supposed to work, with all filtered views sharing the
  same layout" (https://github.com/structurizr/ui/issues/57).
- Manual positions live in `workspace.json`, not the DSL, so round-tripping with a code generator or an LLM
  loses them, and "things can get messy if you have many diagrams, or multiple people contributing"
  (https://github.com/bensmithett/structurizr-mini). Community exporters add PlantUML direction hints "because
  by default, Structurizr doesn't care much about layout"
  (https://github.com/matdurand/structurizr-c4plantuml-layout-exporter).
- Interactivity is view-to-view navigation only. No in-view focus, no hiding unrelated elements, no detail
  slider.
- Commercial: server pre-built binaries need a licence, £300/month for 1 to 20 unique users up to £2,400/month
  for 1001+, annual, non-refundable (https://docs.structurizr.com/server/pricing). The former cloud service is
  not mentioned on the homepage any more (https://structurizr.com/).

### 7. License and maturity

Apache-2.0 for `structurizr/structurizr` (DSL, core, export, import, inspection, MCP, autolayout, application);
archived `lite` and `ui` were MIT. Active: tags monthly in 2026. Single maintainer (Simon Brown). C4 book
published 2026.

### 8. Ideas to steal

- C4 hierarchy enforced by the model, with views as include/exclude expressions over it.
- `filtered` views that share positions, done right (stable positions across views when the author wants).
- Official MCP with validate, parse, inspect, and export tools, plus inspections as lint.
- The Ilograph exporter shows the mapping is straightforward: system/container nesting to `children`, views to
  perspectives.
- Keyboard-driven navigation and a diagram navigator (above, beside, below).

---

## LikeC4

https://likec4.dev, https://github.com/likec4/likec4. MIT, 5,972 stars, 187 open issues, pushed 2026-10-26,
v1.60.0 released 2026-10-15 with releases roughly monthly (v1.59.0 Jul 19, 1.59.1 Jul 20, 1.59.2 Jul 22,
1.59.3 Sep 2, 1.59.4 Sep 21; gh api). Author Denis Davydkov; several community contributors appear as
maintainers in 2026 (AndersHogqvist, yubrshen).

### 1. Language

A Langium-based DSL with `specification`, `model`, `views` (and `deployment`). From
https://likec4.dev/dsl/model/, https://likec4.dev/dsl/views/, https://likec4.dev/dsl/views/predicates/,
https://likec4.dev/dsl/views/dynamic/, https://likec4.dev/dsl/styling/:

```
specification {
  element actor { style { shape person } }
  element system
  element component
  relationship async { line dashed }
}
model {
  customer = actor 'Customer'
  cloud = system 'Cloud' {
    backend = component 'Backend' {
      api = component 'API' { technology 'Node.js'; style { icon tech:nodejs } }
      db  = component 'Database' { style { shape cylinder } }
      api -> db 'reads/writes'
    }
    ui = component 'Web UI'
    ui -> backend.api 'HTTPS'
  }
  customer -> cloud.ui 'opens in browser'
  events <-[async]- cloud.backend.api            // backward hint, PR #3457, not yet merged
}
views {
  view index { include *; autoLayout LeftRight 120 110 ortho }
  view backend of cloud.backend {
    include *, -> cloud.backend.* ->
    exclude * where tag is #legacy
    rank same { api, db }
    style * { color muted }
    include cloud.backend.api with { color amber; navigateTo apiView }
  }
  dynamic view checkout {
    customer -> cloud.ui 'submit'
    cloud.ui -> cloud.backend.api 'POST /order'
    parallel { cloud.backend.api -> cloud.backend.db; cloud.backend.api -> events }
  }
}
```

You define your own element kinds (so it is "C4-like", not C4-bound). Elements nest arbitrarily and are
namespaced by parent. `description` and `summary` take markdown; `metadata { }` key/values with arrays; `link`;
`#tags`; `technology`; `extend element` to add children elsewhere. Relations `->`, `-[kind]->`, nested
relations inside blocks, `this`/`it`. Predicates: `*`, `el.*` (children), `el.**` (connected descendants),
`el._` (expand), `-> el`, `el ->`, `-> el ->`, `<->`, `where kind is ... and tag is not ...`,
`source.metadata.x`, `with { }` overrides applied last, `style` rules in order, `group 'Name' { include ... }`
boundaries, `predicateGroup` reuse, `extends` views, `view X of Y` scoping and default navigation targets,
`navigateTo`. Dynamic views: steps `a -> b 'label'`, `<-`, chains `a -> b -> c`, self-calls, `include` for
context, experimental `parallel|par`, `opt`, `loop`, `break`, `alt/when/else`, `try/catch/finally`; variant
`diagram` (default) or `sequence` (classic lifelines, leaf elements only, actor order from `include`). Views
organise into folders with `/` in titles and an `order` key (https://likec4.dev/dsl/views/organize/).

### 2. Layout

`@likec4/layouts` (v1.60.0): Graphviz `dot` via `@hpcc-js/wasm-graphviz` by default, or a local `dot` binary
(https://www.npmjs.com/package/@likec4/layouts, https://doubleslashde.github.io/mkdocs-likec4/ notes the WASM
has "known memory issues"). Verified in source (`packages/layouts/src/graphviz/DotPrinter.ts`,
`ElementViewPrinter.ts`, gh api):

- Graph attributes: `compound=true`, `rankdir`, `TBbalance=min`, `splines=spline|ortho`,
  `outputorder=nodesfirst`, `nodesep` default 110 px, `ranksep` default 120 px, cluster `margin`;
  `newrank=true` when any subgraph has a rank.
- Compounds become `cluster_` subgraphs; edges that end on a compound use `lhead`/`ltail` with `xlabel`.
- Edge weights encode hierarchy distance (`weight = maxDistance - hierarchyDistance + 1`), orphans inside a
  compound are chunked into `rank=same` subgraphs to tile them, a heuristic sets `minlen=0` on some edges to
  stop them forcing ranks, back-edges between the same pair skip the weight.
- `rank same|min|max|source|sink { fqn, ... }` blocks are forwarded to dot (docs
  https://likec4.dev/dsl/views/predicates/#rank-constraints; "Use rank constraints sparingly").
- Routing: `routing ortho` or `autoLayout LeftRight 120 110 ortho`, new in 1.60.0; docs warn "Graphviz can route
  an orthogonal relationship through an unrelated group box. It can also place parallel routes so close
  together that they are hard to distinguish."
- Sequence variant uses its own Cassowary layouter (`@lume/kiwi`) in `packages/layouts/src/sequence/layouter.ts`
  with constants ACTOR_GAP, COLUMN_GAP, PORT_HEIGHT.
- Deployment and "projects" views have their own printers.
- An experimental AI layout pass (`packages/layouts/src/graphviz/ai/`): an LLM is given nodes, compounds, edges
  and direction as JSON and asked to return `ranks`, `edgeWeight`, `edgeMinlen`, `reverseRank`,
  `excludeFromRanking`, and `invisibleEdges`, which are applied to the DOT (`AiLayoutPrinter.ts`, prompt in
  `prompt-system.md`: "Suggest layout hints to produce readable and visually balanced diagram"; "Reduce rank
  separation, as AI tends to spread nodes too far apart"). This is LLM-as-layout-advisor over Graphviz.
- ELK was tried in a draft PR (https://github.com/likec4/likec4/pull/1629, open since 2025, "The arrows are not
  being rendered properly when using ELK"). TALA is requested (https://github.com/likec4/likec4/issues/3245).

Manual layout: drag nodes and edge control points in the VS Code preview or web editor; "Manual changes are
supported in VSCode extension, but functionality is limited" (https://likec4.dev/dsl/views/predicates/#auto-layout).
Positions are saved as overrides and reapplied; the maintainer tested `fdp` to keep manual positions when the
model changes but "edges with compounds are not supported" so manual layout is ignored in that case
(https://github.com/likec4/likec4/discussions/1142). Open requests: "Better tools for manual layouts" (no
align with children, no distribute, no equal size, https://github.com/likec4/likec4/issues/3282), "snap to grid"
(#1447), "View refreshing and loosing custom layout edits" (#2975), "codegen react doesn't respect manual
layouts" (#2553).

### 3. Interactivity

`@likec4/diagram` is a React library on `@xyflow/react` (React Flow): `LikeC4View` and `ReactLikeC4` with
`pannable`, `zoomable`, `showNavigationButtons`, `onNavigateTo`, `enableDynamicViewWalkthrough`,
`enableElementDetails`, `enableRelationshipDetails` (https://likec4.dev/tooling/react/). The built-in app adds
search (Ctrl+K), element details dialog, relationship browser and relationship details, navigate-to between
views (scoped views are default targets), dynamic view step-through, and a new "Graph" display variant with
physics simulation (1.60.0, which "flattens the view hierarchy"). `likec4 start` dev server, `likec4 build`
static site, `likec4 export png|json`, Vite plugin, MkDocs plugin. VS Code extension with language server,
live preview, rename, go-to-definition (https://likec4.dev/tooling/vscode/).

### 4. Agent and LLM friendliness

Official MCP server with 20 tools (list-projects, search-element, read-element, read-view, render-view,
preview-view which renders DSL text without saving, find-relationship-paths, query-graph, query-by-tags,
element-diff, subgraph-summary, open-view in the editor), via the VS Code extension, `likec4 mcp [--http]`, or
`npx -y @likec4/mcp`; Claude Code: `claude mcp add likec4 -- npx -y @likec4/mcp`
(https://likec4.dev/tooling/mcp/). The repo ships an `AGENTS.md`. The language server validates every
reference, so LLM mistakes surface as errors; the DSL generator can now emit views and dynamic views (1.60.0).
LLM failure modes (guess, from the grammar): dotted FQN scoping inside `view of`, predicate order sensitivity
("an exclude only affects elements included earlier"), `#tag` block must come first, and the `where` must
precede `with`.

### 5. What it does well

- Custom notation (your own kinds, shapes, colours, icons from AWS, Azure, GCP, tech packs).
- Powerful view predicates; `extends`, `predicateGroup`, `group` boundaries; `navigateTo` drill-down.
- First-class React component and static site; MCP; VS Code; fast iteration (monthly releases, 6k stars).
- Dynamic views with both an on-diagram and a true sequence rendering, with par/opt/loop/alt frames.

### 6. Where it fails and why

- Graphviz clusters are the structural weakness. "Graphviz/dot layout algorithm does not support the layout of
  cluster (sub-graph), but only the nodes layout" (maintainer yubrshen on
  https://github.com/likec4/likec4/issues/2465, where a `rank` on a nested element "moves it outside the box").
  "Specifying Rank for nested elements moves it outside the box" is open; "Support rank via predicate" (#2812)
  has no reply.
- Long edges and crossings: "automatic layout produced either very long edges or many edge crossings";
  "LikeC4 seems to orient things more strongly top-bottom somehow which produces quite long edges"; root cause
  found by the user: `TBbalance=min` which Graphviz leaves unset by default
  (https://github.com/likec4/likec4/discussions/1142).
- Upstream elements pushed the wrong way because `a -> b` always means rank(a) < rank(b): the motivation for the
  unmerged `<-` back-edge hint PR (https://github.com/likec4/likec4/pull/3457).
- Ortho routing through unrelated boxes and merged parallel routes (docs, above). Dense views lose or overlap
  labels ("Dense views can still contain label overlaps if no clear position is available").
- Groups are a boundary drawn by predicates, not by the model; users expect model containment: "the group frames
  are rendered, but the grouped elements are not placed inside them"; answer: "by design"
  (https://github.com/likec4/likec4/issues/2107).
- Stability: "Sporadic build errors (graphviz problem?)" with WASM out-of-bounds and hangs
  (https://github.com/likec4/likec4/issues/660); "Graphical issues for views with many connected elements"
  (#1624).
- Manual layout is fragile (issues above) and lives outside the DSL.
- Why, in one line: Graphviz ranks leaf nodes globally and then wraps clusters around them, so containment is
  an afterthought, rank is decided by edge direction not by meaning, and every fix is another hint (`rank`,
  `minlen`, `weight`, invisible edges, back edges, an LLM advisor) layered on top of a general graph drawer.

### 7. License and maturity

MIT. 5,972 stars, 409 forks, 187 open issues, monthly releases, active maintainer plus contributors; v1.60.0
2026-10-15.

### 8. Ideas to steal

- Predicate language for views (`*`, `.*`, `.**`, `._`, `-> x ->`, `where`, `with`) and `predicateGroup`.
- `view X of Y` sets both scope and default drill-down target; `navigateTo` on elements and steps.
- `rank same|source|sink` as author hints; `<-` as a semantic-preserving layout hint; `direction back` on a
  relationship kind.
- The AI-hints shape (ranks, weights, minlen, invisible edges, reverse) is a useful vocabulary even if we do not
  use Graphviz.
- Dynamic view flow blocks (`par`, `opt`, `loop`, `alt`, `try`) and the dual rendering.
- MCP tool set, especially `preview-view` (render unsaved DSL) and `element-diff`.
- React Flow for the viewer: pan, zoom, custom nodes, edge tracks; avoid its layout.

---

## IcePanel

https://icepanel.io. Closed-source SaaS, C4 modelling with manual diagrams. Launch HN Jan 2023
(https://news.ycombinator.com/item?id=34339387).

### 1. Language / model

No code. A model tree of Organization, Landscape, Domain, Actor/Group/System, App/Store, Component; diagrams
at C4 levels 1 to 3 only ("Level 4 code diagrams aren't drawn in IcePanel; link model objects to code
instead"). Objects are reused across diagrams: "Make a change anywhere, and it will auto-sync everywhere"
(https://docs.icepanel.io/core-features/modelling). Model objects carry type, status (live, future,
deprecated, removed), technology choices, tags (tag groups as overlays), teams, links, decision records.
Imports: file import in IcePanel's own `LandscapeImportData` YAML/JSON, REST API and SDK; Structurizr via
"export your workspace as JSON with Structurizr's CLI, then upload" (JacobShadbolt on HN and the blog), and
only model objects are imported: "does not create the corresponding diagrams"
(https://docs.icepanel.io/core-features/imports). Export of flows as text, PlantUML, Mermaid.

### 2. Layout

Entirely manual. Objects are added by double-click or toolbar and dragged into place; connections choose
among curved (default), straight, square-edged lines, with 12 connection points per object and movable labels
(https://docs.icepanel.io/core-features/diagramming.md). The IcePanel comparison page itself states "IcePanel
offers manual layout but no auto-layout" (https://icepanel.io/blog/icepanel-vs-structurizr). A public feature
request asks for auto-layout because "manual layout adjustments can be time-consuming, especially for complex
models"; a merged request asks for auto-spacing of selected items
(https://feedback.icepanel.io/feature-requests/p/request-for-auto-layout-feature). No alignment or distribute
tools are documented on the diagramming page.

### 3. Interactivity

Zoom through levels: a magnifier icon on an object opens its nested diagram, a counter shows how many objects
are inside, a custom landing diagram can be set; diagram groups and versions. Flows: eight step types
(introduction, message, process, alternate paths, parallel paths, go to another flow, information,
conclusion), played with Back/Next/arrow keys, the current step's objects and connections are highlighted on
the diagram, pin tags overlay cost or risk, alternate paths cycle with Tab; Free gets 3 flows, paths need
Growth (https://docs.icepanel.io/visual-storytelling/flows.md). The brief's "animated sequence" is this
highlight-by-step playback, not an arrow animation.

### 4. Agent and LLM friendliness

Hosted MCP server at `https://mcp.icepanel.io/mcp` (paid plans only, OAuth, MIT-licensed server code):
read model objects, domains, connections, diagrams, flows, teams, tags, ADRs; write objects, connections, ADRs;
"Diagram creation ... not supported" (https://docs.icepanel.io/experiments/mcp-server-beta). Other AI: OpenAI
based description generation and "Get insights", opt-in (https://docs.icepanel.io/other-information/ai-in-icepanel).
An agent therefore cannot draw a diagram; it can only populate the model.

### 5. What it does well

Approachable for mixed audiences, reusable model objects, level drill-down, flows as guided stories, tag
overlays, decision records, Structurizr and Backstage import.

### 6. Where it fails and why

- No diagrams-as-code and no auto-layout, so every diagram is hand-positioned and the MCP cannot create one.
- Only three levels, fixed C4 vocabulary.
- Pricing: Free (1 editor, 100 objects, 3 flows), Growth $40 per editor/month annual ($50 monthly), Scale $80
  per editor/month for 20+ editors, Enterprise custom for 50+, $10,000 training package
  (https://icepanel.io/pricing). HN founders framed stale diagrams as "more of a human/organizational problem
  rather than a technical one" (https://news.ycombinator.com/item?id=34339387).

### 7. License and maturity

Proprietary SaaS; launched 2023; active docs and blog in 2025 and 2026; MCP server code MIT.

### 8. Ideas to steal

- Flow step types, especially alternate and parallel paths and go-to-flow, played over a static picture.
- Object status (live, future, deprecated) and tag overlays as perspectives on one model.
- Nested-diagram counter badge and custom landing diagram per object.

---

## Multiplayer.app

https://www.multiplayer.app. The product has pivoted: the homepage and docs now describe "the open-source
debugging agent for developers" that routes production issues to Claude Code, Codex and Copilot
(https://github.com/multiplayer-app/multiplayer, MIT, 43 stars, pushed 2026-10-27; https://www.multiplayer.app/docs/).
I found no product or doc page named "System Sketch". The platform page still lists "Architecture sketches",
"Auto-generated architecture diagrams", "Architecture version control" and ADRs under "Platform Design"
(https://www.multiplayer.app/platform-design/).

### 1. Language / model

None. The system map is built from OpenTelemetry traces: "integrates with OpenTelemetry to map your system
architecture in real time" and "those auto-detected components and dependencies can be used to instantly
generate your system map" (https://www.multiplayer.app/blog/no-more-whiteboards-multiplayer-auto-generates-architecture-diagrams/,
beta auto-documentation announced 2024-06-21,
https://www.multiplayer.app/blog/multiplayer-launches-ga-with-new-system-architecture-observability-features/).
A CSV import is mentioned. Sketches are the whiteboard side; no DSL.

### 2. Layout

Undocumented. The blog mentions "smart layouts" without describing them. Guess: a force or layered service
map like any APM service graph; nothing suggests nested boundaries or story-telling layout.

### 3. Interactivity

"Zoom out, Explore, Collaborate" walkthrough; tracing a request across services from session recordings;
real-time collaboration (https://www.multiplayer.app/system-dashboard/). Interactive API notebooks.

### 4. Agent and LLM friendliness

Core product is now an AI debugging agent with an MCP server (`/docs/ai/mcp-server/`) and VS Code extension;
diagrams are a by-product of telemetry, not something an agent authors.

### 5. What it does well

Diagrams that cannot go stale because they are derived from runtime data; dependency and API discovery.

### 6. Where it fails and why

- No authored meaning: a trace graph shows what called what, not boundaries, ownership, deploy-time or
  intent. Their own taxonomy admits diagrams-as-code "don't auto-update when the system changes" while
  auto-documentation "covers only infrastructure" in some tools
  (https://www.multiplayer.app/blog/the-four-kinds-of-software-architecture-diagramming-tools/).
- Auto-documentation is "available on the Enterprise plan"; the pricing page redirects to the homepage, so no
  public prices (https://www.multiplayer.app/system-dashboard/).
- Closed source for the platform; only the agent is MIT.

### 7. License and maturity

Platform proprietary; agent MIT (43 stars, very new). Observability features were "still in beta" per
GamesBeat (https://gamesbeat.com/multiplayer/). Direction of the company has moved to debugging.

### 8. Ideas to steal

- Seeding a model from OpenTelemetry service and dependency data, then letting the author add boundaries and
  perspectives on top (the "link to reality" idea IcePanel also has).
- Diagrams versioned alongside ADRs.

---

## Cross-tool takeaways for the new product

- Only Ilograph places by containment and author order; all three C4 code tools hand the picture to a
  rank-based graph drawer (dagre, Graphviz) and then fight it with hints. Every layout complaint quoted above
  (long edges, crossings, elements pushed out of their box, filtered views with holes, ortho lines through
  unrelated boxes) traces to that choice.
- Ilograph's weak spots are exactly what a new engine can address with a principled algorithm: explicit cycle
  handling chosen by the author, deterministic label placement, and a documented layout contract instead of
  two years of "fixed inconsistent widths" patches.
- Agent support in 2026 is table stakes: Structurizr, LikeC4 and IcePanel all ship MCP servers; Ilograph ships
  Claude Code skills. A validator, a renderer-preview tool, and line-numbered errors are what the agents need.
