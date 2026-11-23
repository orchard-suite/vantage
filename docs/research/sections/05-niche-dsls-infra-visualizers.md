# 05. Niche DSLs, ASCII tools, and infra/k8s visualizers

Scope: twelve smaller or adjacent tools. Each is covered concisely but concretely. Facts were checked by fetching the cited page on 2026-10-26 unless labelled as a guess. Star counts and release dates are as shown on the cited GitHub page that day.

---

## Penrose

Site: https://penrose.cs.cmu.edu. Repo: https://github.com/penrose/penrose (MIT, about 8.0k stars). npm: `@penrose/core`. Latest release v3.3.1 (https://github.com/penrose/penrose/releases), with minor releases roughly every 2 to 8 weeks in the v3 line.

### 1. Language

Three programs per diagram (https://penrose.cs.cmu.edu/docs/ref/):

- **Domain**: types, predicates, functions. `type Set`, `type Hydrogen <: Atom`, `symmetric predicate Bond (Atom, Atom)` (https://penrose.cs.cmu.edu/docs/ref/style/selectors).
- **Substance**: the objects and relations, no visuals. `Set A, B, C` / `Subset (A, B)` / `Subset (B, C)` / `AutoLabel All`.
- **Style**: selectors over Substance that attach shapes and layout rules.

```
forall Set x {
    x.icon = Circle { strokeWidth : 0.0 }
}
forall Set x; Set y
where Subset (x, y) {
    ensure contains(y.icon, x.icon)
    encourage near(x.icon, y.icon)
}
```

The `forall ... where ...` shape is quoted from the selectors page; the `ensure contains` / `encourage near` lines are composed from the function-library names (https://penrose.cs.cmu.edu/docs/ref/style/functions). Style has three block kinds: namespaces (constants like canvas size), selector blocks, and collector blocks that aggregate matches (https://penrose.cs.cmu.edu/docs/ref/style/overview).

### 2. Layout

Layout is numerical optimization. Each `ensure` is a hard constraint (penalty), each `encourage` is a soft objective; the whole thing is differentiated and minimized by gradient descent (the docs call it "symbolic differentiation", https://penrose.cs.cmu.edu/docs/ref/). Built-in constraints include `disjoint`, `contains`, `overlapping`, `touching`, `onCanvas`, `distributeHorizontally`, `distributeVertically`, `lessThan`, `inRange`; objectives include `near`, `repelPt`, `above`, `below`, `leftwards`, `rightwards`, `sameCenter`, `notTooClose`, `centerLabelAbove` (https://penrose.cs.cmu.edu/docs/ref/style/functions). Shape-vs-shape constraints use the Minkowski penalty scheme: the signed distance of the Minkowski difference between two shapes, which gives robust penalties even from badly infeasible starts and supports containment and padding (Minarcik, Estep, Ni, Crane, "Minkowski Penalties: Robust Differentiable Constraint Enforcement for Vector Graphics", SIGGRAPH 2024, https://dl.acm.org/doi/fullHtml/10.1145/3641519.3657495). The original system paper is Ye, Ni, Krieger, Ma'ayan, Wise, Aldrich, Sunshine, Crane, "Penrose: from mathematical notation to beautiful diagrams", ACM TOG 39(4), SIGGRAPH 2020 (https://penrose.cs.cmu.edu/siggraph20). Edgeworth (Ni et al., L@S 2024) builds on Penrose to generate diagram variants for practice problems, about 15 lines per problem (https://par.nsf.gov/biblio/10542035).

Layouts are sampled: the editor's "resample" button and a "variation" string pick a new random start, so the same program yields different diagrams by design (https://penrose.cs.cmu.edu/docs/ref/using).

### 3. Interactivity

Static SVG output; the web editor supports resampling and step-by-step optimization viewing. No collapse/expand, no multi-view.

### 4. Agent friendliness

Three coordinated files and a custom constraint vocabulary is a lot for an LLM to emit correctly. The Substance layer alone is terse and declarative, which is the LLM-friendly part. No MCP server found.

### 5. Does well

Mathematical and geometric diagrams where "A inside B, C disjoint from both" is the whole spec. The constraint vocabulary is the best-articulated declarative layout language in the survey.

### 6. Where it fails, and why

- **Slow and non-deterministic.** Issues: #607 "certain file triples take several seconds to optimize", #504 "disjoint constraint (non-continuous fn on rectangle) causes big optimizer slowdown", #1454 "Compilation ultra-slow even when code is commented out", #1258 "Full moon example is unstable" (https://github.com/penrose/penrose/issues). A 2025 paper notes Penrose targets a 500 ms budget for exploratory use (https://arxiv.org/pdf/2509.15834).
- **Local minima and weight tuning in box-and-arrow diagrams.** Issue #354: the author "manually tuned weights" and "the optimizer settled into poor local minima, such as an endpoint staying on the wrong side of a box"; a maintainer called the weighting problem "quite interesting and generally unexplored"; closed in 2022 after the offending constraints were removed from the standard library (https://github.com/penrose/penrose/issues/354). This is the domain our product cares about.
- **Unsatisfiable constraints still render.** "While layout is unsatisfiable, Penrose still generates a (misleading) diagram" (https://arxiv.org/pdf/2412.03310).
- No notion of flow direction, layers, ports, or orthogonal routing. Edges are geometric objects, not routed.

### 7. License and maturity

MIT. Academic team (CMU), active releases, 8k stars.

### 8. Ideas to steal

- The `ensure` / `encourage` split: hard layout rules vs soft preferences, both stated in the diagram's own vocabulary ("A contains B", "C left of D", "disjoint").
- Selector-driven styling: `forall Service s where DependsOn(s, db)` applies layout and style rules by relation, not by node.
- Minkowski-difference penalties if we ever need a differentiable "fit this inside that with padding" step after discrete layout.

---

## diagrams (mingrammer)

Repo: https://github.com/mingrammer/diagrams (MIT, about 42.8k stars). Latest release v0.25.1 (https://github.com/mingrammer/diagrams/releases). Providers: AWS, Azure, GCP, IBM, Kubernetes, Alibaba, Oracle, OpenStack, Firebase, DigitalOcean, Elastic, Outscale, OnPrem, Generic, Programming, SaaS, C4. Requires Graphviz and Python 3.9+.

### 1. Language

Python with context managers for containers and `>>` / `<<` / `-` for edges (https://diagrams.mingrammer.com/docs/guides/cluster):

```python
with Diagram("Event Processing", direction="LR"):
    source = EKS("k8s source")
    with Cluster("Event Flows"):
        with Cluster("Event Workers"):
            workers = [ECS("worker1"), ECS("worker2")]
        queue = SQS("event queue")
    source >> workers >> queue >> Lambda("proc") >> RDS("events")
```

"There is no depth limit to nesting." Edge attributes pass through to Graphviz via `Edge(color=, style=, label=, tailport=, headport=, minlen=)`.

### 2. Layout

Pure Graphviz `dot`: Sugiyama layering, clusters become `subgraph cluster_*`. No position control except what Graphviz offers through `graph_attr`/`node_attr`. `Cluster(direction=...)` exists but does not work: maintainer comment in the source, "Cluster direction does not work now. Graphviz couldn't render correctly for a subgraph that has a different rank direction" (issue #44, open since Feb 2020, https://github.com/mingrammer/diagrams/issues/44).

### 3. Interactivity

None. PNG/SVG/PDF/DOT output.

### 4. Agent friendliness

Very high. It is plain Python with an obvious vocabulary, every provider icon is an importable class, and LLMs emit it reliably. Errors are Python errors. This is why it is the most common "AI generated architecture diagram" backend. Output is not deterministic on every platform (see #440 below).

### 5. Does well

Icon-rich cloud pictures in five minutes. Huge icon catalogue. Nesting is natural.

### 6. Where it fails, and why

Every complaint is a Graphviz complaint surfacing through a wrapper that hides the knobs:

- **Ordering inside clusters.** #891 "Node ordering nightmare when doing cluster diagrams": "the ordering becomes much more complicated once you have a hand or two of nodes"; the author remapped indices per diagram, then "recreated the diagram in D2, where the problem doesn't occur" (https://github.com/mingrammer/diagrams/issues/891, open). #350 "Ordering of nodes", #968 "make cluster ranks the same in for loop", both open.
- **Non-deterministic nested cluster order.** #440: over five runs the order of three nested clusters came out "BAC, ACB, CBA, ACB, BCA"; reproduced on Windows with Graphviz 2.44.1, not on Linux; workaround is invisible edges `Edge(penwidth="0")`, which the reporter said "does not fix the underlying issue" (https://github.com/mingrammer/diagrams/issues/440, open). Docs state "The order of rendered diagrams is the reverse of the declaration order", a long-standing Graphviz cluster quirk also reported on the Graphviz forum (https://forum.graphviz.org/t/how-to-prevent-the-subgraph-cluster-alignment-order-from-being-reversed/1361).
- **No position or size control.** #276 "cluster width, and position": users resort to transparent spacer nodes and zero-width edges, "a pain", or switch to `neato` with pinned `pos`; two users moved to D2 (https://github.com/mingrammer/diagrams/issues/276, open since 2020, no maintainer reply). #522 "re-arrange the diagram componentes", #762 "quadrants for object placement", open.
- **Mixed direction impossible** (#44 above), so a left-to-right flow cannot contain a top-to-bottom stack.
- Edge spaghetti: the #891 workaround of a zero-size hub node with `concentrate="true"` exists only to tame crossing lines.

### 7. License and maturity

MIT, very popular, releases slow (v0.24.4 to v0.25.0 spanned most of a year), long-open layout issues with no maintainer engagement.

### 8. Ideas to steal

- `with Cluster():` nesting as code structure. Nesting in the host language's block structure is the most LLM-legible container syntax in the survey.
- Icon classes as a typed catalogue (`from diagrams.aws.compute import EKS`). Autocomplete and validation for free.
- Lists as fan-out (`source >> [a, b, c]`).

---

## Kroki

Repo: https://github.com/yuzutech/kroki (MIT, about 4.4k stars). Latest v0.34.0, released 25 October (https://github.com/yuzutech/kroki/releases).

### What it is

One HTTP server that renders many text diagram languages: BlockDiag family (SeqDiag, ActDiag, NwDiag, PacketDiag, RackDiag), BPMN, Bytefield, C4 (via PlantUML), D2, DBML, Diagrams.net (experimental), Ditaa, Erd, Excalidraw, GoAT, GraphViz, Lini, Mermaid, Nomnoml, Pikchr, PlantUML, SvgBob, Symbolator, UMLet, Vega, Vega-Lite, WaveDrom, WireViz.

API: `GET /{engine}/{format}/{deflate+base64 source}`, or `POST /` with JSON `{diagram_source, diagram_type, output_format}`, or `POST /{engine}/{format}` with the source as the body. Docker image `yuzutech/kroki` on port 8000; Mermaid, BPMN, Excalidraw and diagrams.net need companion containers wired by `KROKI_*_HOST` env vars.

### Why it matters here

- It is a ready-made benchmark harness. One compose file gives us D2, Graphviz, Mermaid, PlantUML, Nomnoml, Pikchr and Svgbob behind one URL, so a corpus of test diagrams can be rendered through every engine and compared side by side.
- It is also the integration target: if our language ships a Kroki engine, every wiki and docs pipeline that already speaks Kroki (Asciidoctor, GitLab, Confluence plugins) picks it up.
- Notable absence: no engine with a layout model beyond Graphviz/dagre/ELK. Nothing in the catalogue does nested-box, multi-perspective diagrams. That gap is the product.

---

## ZenUML and sequence-diagram specialists

### ZenUML

Product site https://zenuml.com: "diagram-as-code solution for sequence diagrams", claims "2 to 3 times less lines" than PlantUML, renders in the browser to HTML/DOM (not an image), and sells Confluence, JetBrains, VS Code, Chrome and Mac apps. Core engine: the original `ZenUml/core` repo is MIT (copyright 2022 Peng Xiao, https://github.com/zenuml/core/blob/main/LICENSE) but was archived read-only on July 8, 2023 (https://github.com/zenuml/core). Development continues at https://github.com/mermaid-js/zenuml-core (69 stars, "The render is based on React19"), which Mermaid loads as an external diagram via `mermaid.registerExternalDiagrams([zenuml])` with the warning that it "relies on the experimental lazy loading & async rendering features" (https://mermaid.js.org/syntax/zenuml.html).

Syntax (https://raw.githubusercontent.com/mermaid-js/zenuml-core/main/docs/DSL_SYNTAX.md):

```
@Actor Shopper
@Database OrderDB
group "Backend" { @Control CheckoutService }
@Starter(Shopper)
Shopper -> CheckoutService: submit(cartId)
if (cart.isEmpty()) {
  return error("Empty")
} else {
  id = new OrderService(cart)
}
par {
  CheckoutService.notify()
  OrderDB.write(id)
}
```

`A.method()` is a sync call whose caller is the enclosing block; braces nest calls, so the activation structure is the code structure. `A -> B: msg` is async. `new`, `return`, `if/else`, `while`/`loop`, `par`, `opt`, `try/catch/finally` (multiple catches) map one-to-one onto UML fragments. `@Actor`, `@Database`, `@Control` set icons. This is the most LLM-native sequence syntax in the survey: it is just imperative pseudo-code.

### The others, briefly

- **js-sequence-diagrams** (https://github.com/bramp/js-sequence-diagrams): BSD-2-Clause, about 7.8k stars, Snap.svg or Raphael, `simple` and `hand` (Daniel font) themes, syntax credited to WebSequenceDiagrams, copyright ends 2017, effectively frozen.
- **WebSequenceDiagrams** (https://www.websequencediagrams.com/examples.html): the syntax ancestor (`A->B: text`, `A-->B`, `A->+B` activate, `alt/else`, `loop`, `opt`, `par`, `note over`). Commercial: `autonumber`, `parallel { }`, `ref`, `include`, `state` are Premium. Accepts Mermaid and PlantUML input and "silently" maps unsupported features.
- **SequenceDiagram.org** (https://sequencediagram.org/instructions.html): richest free feature set. `autoactivation on/off`, `autonumber N`, `participantgroup`, nested groups, `parallel` (same vertical position for following entries), `linear` chaining, `space N` and negative space, `entryspacing`, `participantspacing equal`, `expandable-`/`expandable+` collapsible fragments, `A->(n)B` delayed arrival, `bottomparticipants`. Proprietary web app.
- **Mermaid sequence** (https://mermaid.js.org/syntax/sequenceDiagram.html): participants "render in order of first appearance" unless declared; `+`/`-` activation shorthand, stacking activations; fragments `loop`, `alt/else`, `opt`, `par/and`, `critical/option`, `break`, `rect` for shading; `box ... end` participant groups; `autonumber <start> <increment>`; `create`/`destroy`; `mirrorActors`.
- **PlantUML sequence** (https://plantuml.com/sequence-diagram): `order N` on participants; `++`/`--`/`**`/`!!` shorthand; `autoactivate on` plus `return`; `autonumber` with DecimalFormat patterns and multi-level `inc A`; `box ... end box` (nested boxes need `!pragma teoz true`); `ref over`; `...` delays; teoz adds `&` parallel messages and `{anchor}` duration markers.
- **D2 sequence** (https://d2lang.com/tour/sequence-diagrams/): `shape: sequence_diagram`; "order matters here, unlike elsewhere in D2"; spans are nested objects on an actor; groups are unconnected containers; connections in a group must reference top-level actors.

### Why sequence layout is the easy case

A sequence diagram has no graph layout problem. Columns are participants in a given order (first appearance or explicit), rows are messages in source order, so placement is a fixed grid computed in one pass. The only choices are participant order (crossing reduction on a line, which the Kiel paper treats as the one real optimization, https://macau.uni-kiel.de/receive/macau_mods_00002025), activation nesting, and fragment box sizing. Every tool above is deterministic and fast for that reason. The good ones add: activation bars from call nesting (ZenUML, PlantUML `autoactivate`), fragments as syntax blocks, auto-numbering, participant groups, and collapsible fragments (SequenceDiagram.org). Lesson for us: a sequence view should be a separate, grid-based renderer, not a special case of the graph layout.

---

## nomnoml

Repo: https://github.com/skanaar/nomnoml (MIT, about 2.8k stars). Latest v1.7.0, 14 December (https://github.com/skanaar/nomnoml/releases). Site https://nomnoml.com.

### 1. Language

```
#direction: right
[<actor>User] -> [Web|login();logout()]
[Web] -> [<database>DB]
[Engine|
  [Cylinder]->1[Piston]
  [Cylinder]->2[Valve]
]
```

Classifiers `[<abstract>]`, `[<database>]`, `[<frame>]`, `[<package>]`, `[<state>]`, `[<choice>]`, `[<actor>]`, `[<note>]`, `[<hidden>]`, `[<table>]`; about 30 association kinds (`->`, `-->`, `<:-`, `+-`, `o-`). Nesting is a compartment inside brackets. Directives: `#direction: down|right`, `#ranker: network-simplex|tight-tree|longest-path`, `#acyclicer: greedy`, `#spacing`, `#padding`, `#edges: hard|rounded`, `#fill`, `#stroke`, `#font`, `#zoom` (https://nomnoml.com/).

### 2. Layout

"The only dependency is graphre", a fork of dagre (https://github.com/skanaar/graphre, MIT, 29 stars). So: Sugiyama layered layout, one global direction, nested compartments laid out recursively as sub-graphs. Edge routing is dagre's polyline. No ports, no manual positions.

### 3. Interactivity

None; canvas or SVG.

### 4. Agent friendliness

Very terse, easy to emit. Few validation messages. Deterministic.

### 5 and 6. Strengths and failures

Strength: hand-drawn feel, tiny footprint, nesting in one bracket pair. Failure: everything dagre fails at, with less control than D2 (no `near`, no constraints). Cross-compartment edges are drawn after layout and do not influence it.

### 8. Ideas to steal

- `[Parent|child graph]` nesting a sub-diagram inline. Compact and legible.
- Exposing `#ranker` and `#acyclicer` as one-line knobs, not an API.

---

## Pikchr and the PIC / ASCII lineage

Site https://pikchr.org. License: zero-clause BSD (https://pikchr.org/home/doc/trunk/homepage.md). Single C89 file built with Lemon, by the SQLite/Fossil author; used for SQLite's syntax diagrams, which are Pikchr source files in `art/syntax/` rendered through a Tcl build (https://pikchr.org/home/doc/trunk/doc/sqlitesyntax.md). In Kroki.

### 1. Language

PIC descendant with relative placement (https://pikchr.org/home/doc/trunk/doc/userman.md):

```
B1: box "Client"
arrow
B2: box "API" fit
arrow right 150%
C1: circle "DB" with .w at 2cm right of B2.e
arrow from B2.s down 1cm then right until even with C1
down; box "Cache" at 1cm below B2
```

Objects: box, circle, ellipse, oval, cylinder, file, diamond, line, arrow, spline, dot, arc, text, move. Anchors `.n .s .e .w .c .start .end`; `with .w at`, `right of previous`, `until even with`, `fit`, `same as`, units cm/mm/px/pt/in, `[ ... ]` containers.

### 2. Layout model

Procedural, author-controlled. "By default, each block object is placed relative to the previous one: with .start at previous.end." Single pass: "Objects can refer only to earlier objects" and "There is no 'solver' that has to work through forward and backward layout constraints." Once a statement ends its position is fixed. No auto-layout at all; no edge routing (an arrow goes where you say). Differences from PIC (https://pikchr.org/home/doc/trunk/doc/differences.md): no `for`/`if`/subblocks ("Generating scripts externally, for example with Python or Tcl, is recommended"), no `sh`/`copy` for safety, text size is estimated because there is no font engine, token limit 100,000.

### 4. Agent friendliness

Attractive for LLMs: deterministic, incremental ("add a box right of the last one" is a local edit), and the author's intent is the layout, so a model that thinks in terms of "put the database to the right of the API" can say exactly that. Where it fails: no routing, so an LLM must compute every corner of every polyline; adding a node in the middle shifts nothing automatically; collisions are the author's problem; and there is no container that grows to fit children except `[ ]` blocks which cannot be targeted by later edges from outside in the way nested clusters can. Pikchr is a drawing language, not a model.

### The ASCII tools

LLMs draw ASCII boxes natively, so these matter as a baseline for "does a 2D grid tell the story":

- **svgbob** (https://github.com/ivanceras/svgbob): Rust, Apache-2.0, about 4.2k stars; turns ASCII scribbles into SVG; used by Asciidoctor, Typst, Zola, mdBook, Kroki. Input is the picture; no layout.
- **asciiflow**: browser editor for drawing ASCII diagrams by hand. No layout.
- **Graph::Easy** (https://github.com/ironcamel/Graph-Easy): Perl, GPL-2, `[ A ] -> [ B ]` syntax, outputs ASCII, boxart, HTML, or hands off to Graphviz; copyright 2004 to 2008, 25 commits, effectively unmaintained. It has its own grid-based layouter that places nodes on a cell grid and routes orthogonal edges through free cells.
- **dot-to-ascii** (https://github.com/ggerganov/dot-to-ascii): MIT, 513 stars; a PHP wrapper that runs Graph::Easy on DOT input with a `boxart` flag.
- **Diagon** (https://github.com/ArthurSonzogni/Diagon): C++/WASM, MIT, about 2.2k stars; sequence, tree, DAG, planar graph, flowchart, table, math to ASCII; uses Boost Graph for layout.
- **Monodraw**: paid macOS ASCII editor, Unicode box drawing, SVG export.

Verdict: ASCII tools prove that a coarse integer grid plus orthogonal routing yields very readable diagrams at small scale, because every element snaps to lanes and edges have only two directions. That is a layout lesson (grid snapping, orthogonal lanes), not a product direction; none of them handle nesting beyond one level or scale past a few dozen nodes.

---

## Sketchviz

https://sketchviz.com: free hosted Graphviz editor by Code 402, Inc. Renders with viz.js, adds a "Sketchy Engine" mode and three fonts (Tinos, Handlee, Sedgwick Ave); credits RoughJS, so the sketchy look is almost certainly RoughJS post-processing of the SVG (inferred, the About page does not say so explicitly, https://sketchviz.com/about). Engines circo, dot, fdp, neato, osage, twopi; PNG export, GitHub gist save, embed. Not open source. Layout is unchanged Graphviz, so nothing to learn except that a hand-drawn skin makes Graphviz output feel intentional instead of mechanical, which is a cheap trick worth keeping in mind for "sketch" views.

---

## Terraform graph visualizers

`terraform graph` emits DOT of the full dependency graph including providers, variables and locals, which is why every tool below exists: to prune it to the resources a human cares about and to group them by VPC/subnet.

| Tool | What it does | Grouping | Layout | License, status |
|---|---|---|---|---|
| **Rover** (https://github.com/im2nguyen/rover) | Runs `terraform plan`, parses to resource overview, map and graph, serves an interactive React UI on :9000 or static `rover.zip`/SVG | By module and resource type; no VPC/subnet semantics | Graph library not named on the README | MIT, about 3.4k stars, last release v0.3.2; issues #125 "Was Rover Development Dropped?" (2023) and #143 "Is this project dead?" (Dec 2025) with a Feb 2026 reply "definitely looks like it"; #141 "Very busy graphic - option to hide relationships", #140 "Firefox/Chromium incredibly slow" (https://github.com/im2nguyen/rover/issues) |
| **Inframap** (https://github.com/cycloidio/inframap) | Reads tfstate (v3/v4) or HCL and "shows only the resources that are most important/relevant" per provider; `prune` strips secrets | AWS grouping marked WIP, IAM edges not supported (#11); GCP/Azure/OpenStack no grouping | Emits DOT; `dot` or graph-easy renders it | MIT, about 2.1k stars |
| **Terravision** (https://github.com/patrickchugh/terravision) | Draws from `terraform plan` (so `count`/`for_each`/modules resolve), from JSON, or from English via an AI assistant; outputs PNG/SVG/draw.io/interactive HTML; ships as Claude Desktop extension, Claude Code plugin, ChatGPT plugin and MCP server; 427 AWS, 267 GCP, 263 Azure resource types | Places every resource "in its VPC, subnet, zone or resource group"; JSON model is `aws_vpc.main` containing `aws_subnet.public~1` | Graphviz (needs `libgvplugin-neato-layout8`, so uses neato too) | AGPL-3.0, about 1.7k stars, PRs only from invited collaborators |
| **Pluralith** (https://github.com/Pluralith/pluralith-cli) | CLI plus hosted dashboard, "Alpha", needs API key; "dedicated in-house algorithm" that "intelligently hides and groups resources"; `pluralith.yml` offers `hide/show`, `groups/ungroup`, `relations: connected|nested`, `unrelate` (https://docs.pluralith.com/docs/more/diagram-customization) | Manual groups; no automatic VPC/subnet convention documented | Proprietary | MPL-2.0 CLI, 861 stars; last commit March 23, 2023; website still sells a $250/month CI plan with a 2023 copyright; no shutdown notice found, but no activity in three years. Treat as dormant |
| **Brainboard** (https://docs.brainboard.co/cloud-architectures/cloud-resource) | SaaS drag-and-drop canvas where each node is a Terraform resource, data source, module, container, or icon; dropping a subnet inside a VPC infers the parent; generates Terraform on close; imports .tf to diagram | Containers are the convention: VPC contains subnet contains instance | Manual | Commercial, about $99/user/month per third-party trackers |
| **terraform-visual** (https://github.com/hieven/terraform-visual) | Renders `terraform show -json plan.out` as an HTML plan report | None | List, not a graph | MIT, 674 stars, 19 commits |
| **blast-radius** (https://github.com/28mm/blast-radius) | Interactive d3 view of `terraform graph` output | None | Graphviz layout, d3 interaction | MIT, about 2.2k stars, 120 commits, no recent activity |
| **Cloudgram** (https://github.com/dedalusj/cloudgram) | JS diagram-as-code for cloud | | | Last push over two years ago, about 100 stars |
| **awslabs/diagram-as-code** (https://github.com/awslabs/diagram-as-code) | YAML with CloudFormation-style types, `Children`, `Direction`, `AWS::Diagram::HorizontalStack`/`VerticalStack`, `Links` with `SourcePosition: S` / `TargetPosition: N`; no Graphviz, no browser | AWS Cloud > VPC > Subnet by nesting | Own stack-based layouter; "the default value for the Direction property is horizontal" (https://raw.githubusercontent.com/awslabs/diagram-as-code/main/doc/introduction.md) | Apache-2.0, about 1.6k stars |
| **hava.io** (https://www.hava.io/blog/aws-vpc-diagrams) | SaaS, read-only role, auto-diagrams; one diagram set per VPC; columns are AZs with subnets inside; load balancers shown routing to subnets; hourly sync; export PNG/Visio/CSV/JSON/PDF | VPC > AZ column > subnet > resource | Proprietary, grid-like | Commercial |
| **cartography** (https://github.com/cartography-cncf/cartography) | Pulls assets from AWS, GCP, Azure, K8s, GitHub, Okta and 30+ others into Neo4j; query with Cypher | None, it is a graph DB | Neo4j browser | Apache-2.0, about 4.2k stars, CNCF sandbox |

Readability notes: the Graphviz-based tools (Rover, Inframap, blast-radius, Terravision) all produce the layered-graph look the brief complains about; Rover's own issue tracker asks for a way to hide relationships because the picture is "very busy". The two that read well, hava.io and awslabs/diagram-as-code, both abandon general graph layout for a fixed cloud > region/AZ > VPC > subnet nesting with stacks, and route only a few links between them. That is the pattern to copy: in cloud diagrams the containment hierarchy is the layout, and edges are secondary.

---

## Kubernetes visualizers

- **KubeDiagrams** (https://github.com/philippemerle/KubeDiagrams): Apache-2.0 (moved from GPL-3.0 in June 2025), about 2.7k stars, v0.8.0 (July 2026). Generates diagrams from manifests, kustomize, Helm charts, helmfile, or a live cluster; kubectl plugin, GitHub Action, Nix flake. Built on `diagrams` + Graphviz, so clustering is Graphviz subgraphs: `metadata.namespace` is the top cluster, then label keys `app.kubernetes.io/instance`, `app.kubernetes.io/name`, `helm.sh/chart`, `app.kubernetes.io/component` form subclusters with preset titles and colours; `--config` redefines mappings and edge styles; `.kd` declarative files add custom clusters/nodes/edges. Outputs DOT, dot_json, D2, Mermaid, draw.io, PNG, SVG. A bundled interactive viewer takes dot_json and supports zoom, tooltips, "opening and closing clusters", moving nodes, filtering by kind (https://github.com/philippemerle/KubeDiagrams/blob/main/README.md). Inherits every `diagrams` layout limitation; no direction option is documented.
- **KubeView** (https://github.com/benc-uk/kubeview): MIT, about 1.2k stars, v2.2.1 (14 Sep). Live read-only graph of a namespace with derived relationships, SSE updates, side panel, logs. v2 moved from Cytoscape.js to AntV G6 for rendering; layout algorithm not stated.
- **k8sviz** (https://github.com/mkimuram/k8sviz): Apache-2.0, 338 stars. Live namespace to DOT/PNG via Graphviz, using the community icon set in the style of the official "Exposed Pod with 3 replicas" example. Maintenance unclear.
- **Headlamp Map view** (https://kinvolk.io/blog/2025/01/making-sense-of-kubernetes-with-headlamps-map-view): introduced in Headlamp 0.26; model is nodes, directed edges (ownership), and "sources" (named groups); plugins register sources for CRDs; v0.45.0 exports `GraphView` and `KubeIcon` so plugins reuse the renderer (https://newreleases.io/project/github/kubernetes-sigs/headlamp/release/v0.45.0). Headlamp is now the successor to Kubernetes Dashboard (https://kubernetes.io/blog/2026/06/01/dashboard-to-headlamp/).
- **Argo CD resource tree**: `application-resource-tree.tsx` imports `dagre` and lays the app's resources out as a left-to-right ownership tree (https://github.com/argoproj/argo-cd/blob/master/ui/src/app/applications/components/application-resource-tree/application-resource-tree.tsx). Readable because it is a tree, not a graph: one root, ownership edges only, no cross links.
- **Lens**, **Octant** (archived), **Komodor**: dashboards with per-resource relationship panels rather than whole-cluster drawings. Not fetched this pass.
- **Kubernetes icons** (https://github.com/kubernetes/community/tree/master/icons): official set "to standardize Kubernetes architecture diagrams", SVG and PNG, labeled and unlabeled variants, control plane components, infrastructure (control plane, node, etcd), and about 40 resource kinds. License Apache-2.0 or CC-BY-4.0 at your choice; the Kubernetes logo itself is a Linux Foundation trademark outside that license.

Lesson: the Kubernetes tools that read well (Argo, Headlamp) show an ownership tree per application with a fixed direction. The ones that draw the whole namespace as one Graphviz graph (KubeDiagrams, k8sviz) get the label-based nesting right but inherit edge spaghetti between Services, Ingresses and Pods across clusters.

---

## Icon standards and vendor diagram conventions

### Azure

- Official icons: https://learn.microsoft.com/en-us/azure/architecture/icons/. SVG only, no Visio stencils. Terms: permitted "in architectural diagrams, training materials, or documentation"; "Don't crop, flip, or rotate icons. Don't distort or change icon shape in any way. Don't use Microsoft product icons to represent your product or service." Latest update November 2025 (13 new icons).
- Diagram guidance, Well-Architected "Create architecture design diagrams" (https://learn.microsoft.com/en-us/azure/well-architected/architect-role/design-diagrams, updated 2025-08-13): "Use directional arrows", "Avoid bidirectional arrows" (show two flows), "Label everything clearly" including every "grouping container", "Provide a legend" when "solid is a synchronous call while dash is asynchronous", "Layer, don't overload" with progressive disclosure context > container > component > sequence, "Version control" diagram sources, "Design for accessibility" by pairing colour with pattern. It enumerates diagram types: context, high-level/container, block, component, deployment, data-flow, sequence, user-flow, ERD, network, state, flowchart. Reference architectures in the Architecture Center follow a left-to-right flow with numbered step callouts and dashed boundary boxes; that style claim is from reading the architectures, not from a written rule I could cite.

### AWS

- Official icons: https://aws.amazon.com/architecture/icons/. Released quarterly (Q1, Q2, Q3; "No releases occur in Q4"); current package file names carry `07312026`. Formats: PowerPoint toolkit and an asset zip (SVG/PNG inside). AWS "allow[s] customers and partners to use these toolkits and assets to create architecture diagrams" and warns third-party libraries may ship "legacy icon sets". The deck states that all icon colours "have been accessibility tested and should not be altered" and uses 2pt lines for groups (2023 deck copy, https://www.slideshare.net/slideshow/awsarchitectureiconsdeckforlightbg04282023-2pptx/258567384).
- Group conventions, as encoded by AWS's own `aws-icons-for-plantuml` from the deck (https://raw.githubusercontent.com/awslabs/aws-icons-for-plantuml/main/dist/Groups/all.puml), border colour and line style:
  - AWS Cloud: foreground colour (#000000 light / #FFFFFF dark), plain
  - AWS Account: #E7157B, plain
  - Region: #00A4A6, dotted
  - Availability Zone: #00A4A6, dashed
  - VPC: #8C4FFF, plain
  - Public subnet: #7AA116, plain
  - Private subnet: #00A4A6, plain
  - Security group: #DD344C, plain
  - Auto Scaling group: #ED7100, dashed
  - Corporate data center / Server contents: #7D8998, plain
  - Generic group: #7D8998, dashed
  - Spot Fleet / EC2 instance contents / Elastic Beanstalk: #ED7100, plain
  - Step Functions workflow: #E7157B, plain
  - Category palette: #C925D1 (Nebula), #7AA116 (Endor, green), #ED7100 (Smile, orange), #E7157B (Cosmos, pink), #8C4FFF (Galaxy, purple), #DD344C (Mars, red), #01A88D (Orbit, turquoise), #7D8998 (Gray, borders) (https://github.com/awslabs/aws-icons-for-plantuml/blob/main/AWSSymbols.md).
  - The same library notes "Diagrams that required Groups which overlap across other groups are not possible using PlantUML", which is exactly the Auto Scaling group spanning two subnets case the deck shows. Overlapping groups are a real need in cloud diagrams that tree-shaped containment cannot express.
- AWS reference architecture diagrams use numbered circle callouts along a left-to-right request path with a legend; same caveat as Azure, this is the observed house style.

### Google Cloud

- Icons at https://cloud.google.com/icons (page body did not fetch; terms not verified this pass).
- The "Google Cloud Architecture Diagramming Tool" announced February 2022 was an Excalidraw-based editor with reference architectures hosted at googlecloudcheatsheet.withgoogle.com/architecture; Excalidraw's README still lists Google Cloud as an integrator linking to that URL (https://github.com/excalidraw/excalidraw/blob/master/README.md). That URL now redirects to https://cloud.google.com/products/, and a Google developer forum thread reports it "under maintenance for months" with an upgraded version promised for Q1 2025 (https://discuss.google.dev/t/google-cloud-architecture-diagramming-tool/164977). Status today: effectively gone; the announcement blog post is also a 404.

### Why this matters

Containment colour and line style are a vendor-documented vocabulary. A language that says `vpc "prod" { subnet "public-a" { ... } }` should render AWS-correct purple/green/teal borders and dashed AZs without the author choosing anything. That is a cheap, high-credibility win that none of the DSLs above do out of the box (diagrams and Terravision use the icons but not the group conventions).

---

## Wardley maps and ArchiMate

### OnlineWardleyMaps

Text DSL with explicit 2D coordinates where both axes carry meaning (visibility on y, evolution on x) (https://docs.onlinewardleymaps.com/docs/dsl-overview):

```
component Customer [1, 0.4]
component Server [0.5, 0.8]
pipeline PaymentSystem [0.15, 0.65]
evolve Server 0.9 label [66, 99]
Customer->Server
Customer+>Server; flow with context
note This is a note [0.9, 0.1]
submap Order [0.11, 0.31] label [-15, 30]
anchor Business []
```

`evolve X 0.9 (buy)` adds build/buy/outsource decorators; `accelerator`/`deaccelerator`, `url`, `size`, `style wardley`. Runs in browser, VS Code and Obsidian with syntax highlighting and live render. The interesting idea: coordinates are not pixels, they are semantic positions on named axes, so an author or LLM writes `[visibility, evolution]` and the layout is a direct consequence. A product could offer the same trick for other axes (tier, trust zone, lifecycle stage) as a layout mode.

### ArchiMate

- **Archi** (https://github.com/archimatetool/archi): MIT, about 1.3k stars, desktop editor; views are hand-placed. **jArchi** (https://github.com/archimatetool/archi-scripting-plugin): MIT source, JavaScript scripting of models and views; no built-in auto layout found this pass. Third parties fill the gap: pyArchimate offers force-directed and Sugiyama layouts for ArchiMate views (https://pyarchimate.readthedocs.io/features/layout.html), and `archimate-mcp` on PyPI gives agents "full ArchiMate 3.x authoring" with import/export to Archi (https://pypi.org/project/archimate-mcp/0.9.0/). The ArchiMate Open Exchange Format is XML with element coordinates per view, so it is a reasonable interchange target but not a layout engine.
- **Archinsight** (https://archinsight.org): "code-driven architecture modeling tool for distributed systems" by Alexey Zaytsev; the "Insight" language is typed and C4-oriented, "you describe the architecture once, and the views you need are derived from that single connected model", and it pitches agents that "navigate, change, and validate that model against deterministic rules". The c4model.com tooling list carries it (https://c4model.com/tooling/diagramming). I could not confirm its GitHub repo, license, or layout engine this pass (search budget exhausted); the "Russian ArchiMate-ish DSL" framing in the brief is unverified, what I saw is C4, not ArchiMate.

No ArchiMate tooling found that is code-first with good automatic layout; LikeC4 and Structurizr remain the code-first options and are covered in other sections.

---

## Obsidian graph views and JSON Canvas

Force-directed graph views are not architecture diagrams. Obsidian users say so themselves: "the position of each note changes on every load" and the graph "becomes crowded and unreadable due to overlapping nodes" (https://forum.obsidian.md/t/whats-the-point-of-the-graph-view-how-are-you-using-it/71316/19); a feature request asks for real node and arrow shapes so "real world project diagrams (for example, UML diagrams)" could be built (https://forum.obsidian.md/t/customize-arrow-and-bubbles-in-graph-view/112020). Non-deterministic placement with no semantics is the opposite of what the brief wants.

**JSON Canvas** (https://jsoncanvas.org/spec/1.0/) is worth a look as an interchange format: MIT, spec 1.0, maintained in `obsidianmd/jsoncanvas`. Nodes have `id, type, x, y, width, height, color`; types `text`, `file`, `link`, `group` (with `label`, `background`, `backgroundStyle`); edges have `fromNode, fromSide (top|right|bottom|left), fromEnd, toNode, toSide, toEnd, color, label`; six preset colours plus hex; z-order is array order. It is a laid-out-result format, so our layout engine could emit it for hand-tweaking in Obsidian or any canvas app, and read it back as pinned positions. It has no nesting beyond groups-by-bounding-box and no semantics, so it is an export, not a source.

---

## Cross-cutting takeaways from this section

1. The only tools in this group whose cloud diagrams read like a human drew them (hava.io, awslabs/diagram-as-code, Brainboard) treat containment as the layout and relegate edges. Every Graphviz wrapper (diagrams, Terravision, Rover, Inframap, KubeDiagrams, k8sviz, blast-radius) inherits cluster-order nondeterminism, no mixed directions, and spaghetti.
2. Penrose gives the vocabulary for declarative layout intent (`ensure contains`, `encourage leftwards`, `disjoint`) but proves that continuous optimization alone is slow, seed-dependent, and prone to local minima for box-and-arrow work. Use the vocabulary; do not use gradient descent as the primary layouter.
3. Pikchr and the ASCII tools show the appeal of deterministic, author-ordered, grid-snapped placement for LLM authoring, and their ceiling: no routing, no growth, no containers.
4. Sequence diagrams are a solved, grid-based problem; ZenUML's code-shaped syntax is the most LLM-native form.
5. Vendor group colours and line styles (AWS hex and dashed/dotted rules above, Azure's arrow and legend rules) are documented and should be defaults, not options.
6. Wardley's semantic coordinates and JSON Canvas's pinned-position export are two cheap, distinctive features to borrow.
