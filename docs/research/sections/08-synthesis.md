## Part 8. Synthesis

### (a) What makes an architecture diagram good or bad

Principles, each with the strongest source behind it. Ordered by weight of evidence for software and cloud diagrams specifically, not for abstract graphs.

Good:

1. One reading direction per view, chosen by the author, and every element placed along it. Storrle 2011/2014 found compound "flow plus grouping plus alignment" layouts gave +6.5% correct answers, -17% time per correct answer, +31% perceived quality, with the effect growing with diagram size (Part 6, A.7). Gansner's A1 "aim edges in the same direction" is the same rule (B.2). Ilograph hard-codes it: `from` is left, `to` is right, backward arrows are a labelled exception (Part 2).
2. Containment is the layout; edges are secondary. The two products whose automatic output people like (Lucidscale cloud frames, Cloudcraft Live) run no graph layout at all: an author-chosen containment hierarchy (Account > Region > VPC > AZ > Subnet), a sorted typed grid inside each box, repeats collapsed into counted badges, edges off by default and toggled per category (Part 4). hava.io and awslabs/diagram-as-code do the same (Part 5). Gestalt common region and proximity are the perceptual basis (A.6).
3. Author order is narrative order. Top-to-bottom order of siblings follows first mention in the source (Ilograph docs; ELK model order, Domrös 2022-2024). Reordering the text reorders the picture and nothing else moves. This is what makes a diagram "tell a story" instead of reporting graph rank.
4. Nothing is placed by graph rank alone. Two services in the same box stay side by side even if one has twice the fan-in. Rank-based engines (dot, dagre, ELK layered without constraints) spread them across layers, which is the "hierarchy graph" look the owner hates (Parts 1, 2, 3).
5. Few crossings, then few bends, then symmetry (Purchase 1997). For orthogonal routing every crossing is 90 degrees, which is the angle readers tolerate best (Huang 2008-2014), so orthogonal routing is the default for architecture views.
6. Collinear chains. A multi-hop flow reads as one straight line (Ware 2002 continuity; Brandes-Köpf straight long edges; yFiles `criticalEdgePriorities`).
7. Alignment and grid-likeness, applied after structure is right. HOLA's user study: humans want gridiness, compactness, symmetry, deliberate bends, trees on the outside; HOLA beat yFiles orthogonal 3x on path-finding error (C.8). Marriott 2012: orthogonality and collinearity aid recall (A.11).
8. Short, uniform edges; long flows wrap like a comic strip instead of running off the page (Rüegg wrapping, B.9).
9. Labels placed inside the layout, horizontal, never overlapping, unambiguously attached (Kakoulis-Tollis; ELK label dummies; yFiles integrated labeling). Every tool that drops labels on edge midpoints after layout (Mermaid, dot ortho, PlantUML ortho) is complained about for exactly this (Part 1).
10. Typed edges with typed directions: dependency and call edges carry layering; association and "shares data with" edges do not (Gutwenger 2003; LikeC4's unmerged `<-` hint PR shows the need).
11. Size and emphasis carry meaning: important things are bigger (Ilograph scales by relation count and selection), and pragmatics may override aesthetics to serve the message (Storrle level 4).
12. Vendor container conventions rendered by default: AWS VPC purple, public subnet green, private subnet teal, AZ dashed, Region dotted; Azure's "directional arrows, no bidirectional arrows, label every container, provide a legend" (Part 5). Credibility for free.
13. Determinism with stability: same input, same picture; one added node does not reshuffle the drawing (mental map: Misue 1995; Dunnart topology preservation). TALA, Graphviz, PlantUML and diagrams all fail this and users say so (Parts 1, 5).
14. Small views, many of them. Ilograph's founder, C4's FAQ and Storrle all say the same: split into perspectives; a master diagram that needs omitted labels is unread.

Bad (the specific failure modes seen across the field, with cause):

- Rank-driven placement: dot, dagre, ELK-by-default, Structurizr, LikeC4, diagrams, Mermaid. Nodes land by graph distance, containers are drawn around them afterwards. Cause: Sugiyama layering with clusters bolted on.
- Cross-boundary edges forcing one global direction and killing per-container direction (Mermaid #2509 and duplicates; ELK elkjs#26 "not possible"; diagrams #44; PlantUML global `left to right direction`).
- Containers as islands: Graphviz `clusterrank=local` lays each cluster out alone and inserts it as a unit, so cross-cluster edges detour; LikeC4 users hit `TBbalance` and rank-outside-the-box bugs; dagre has no node-to-cluster edges (#238, open since 2018).
- Edge spaghetti in wide graphs: long edges through dummy chains, no bundling or bus routing (ELK #1174, Rover #141, diagrams #891).
- Labels as afterthoughts: Mermaid midpoint labels, dot `splines=ortho` cannot label, PlantUML #384 and #2326 open since 2018.
- Non-determinism and reshuffle: Graphviz cluster order reversed or random across runs (diagrams #440), PlantUML "adding more items made the layout tangled", TALA "adding one node can change the whole layout", Penrose seeds, fcose drift.
- Hints that fight the engine: PlantUML hidden links, `together`, `Lay_*` ("a last resort", "do not trust the first rendering"), Graphviz invisible nodes, LikeC4 `rank`/`minlen`/weight tricks plus an LLM advisor. Every one breaks on the next real edge.
- Overlapping groups unsupported everywhere code-first (an Auto Scaling group spanning two subnets): D2 discussion #328 "not in the near future", aws-icons-for-plantuml "not possible".
- Force layouts for architecture (Mermaid architecture-beta on fcose with overlapping siblings #6120, Obsidian graph, service maps): no flow, no story, changes every run.
- LLM-placed pixels: Excalidraw MCP, tldraw agent, draw.io XML. Overlaps and misaligned labels are the normal result; LLM 2D placement collapses above about 15 elements (LayoutGPT, LayoutPrompter, G.5).

### (b) What makes diagram-as-code software good or bad for agents

Good:

1. The agent authors structure and intent, never geometry or syntax-sensitive free text. GitDiagram (18.5k stars) converged on structured graph output, server validation with focused feedback, deterministic compile (G.7). yWorks "deliberately kept LLMs out of the layout and algorithm critical path" (Part 3). TALA's own pitch is "models can place nodes in 2D space but still struggle with routing", which is the weaker version of the same lesson.
2. Terse, regular grammar with few special characters. Mermaid's dominant LLM failure (2.6% of 872 blocks) is delimiter collision inside labels (G.3). Eraser's `name [icon: x, color: y] { children }` and `A > B: label` and diagrams' `with Cluster():` are the most LLM-legible container syntaxes found (Parts 4, 5). Ilograph's YAML has no ids and no coordinates, so there is little to get wrong (Part 2).
3. One model, many views. Structurizr, LikeC4, Ilograph (perspectives and contexts), Isoflow (items vs views), Lucid (view = structure + filter + layout). Views are include/exclude expressions over the model, not copies. LikeC4's predicate language (`*`, `.*`, `.**`, `-> x ->`, `where`, `with`) is the richest (Part 2).
4. Layout vocabulary at three strengths, stronger never yielding to weaker: source order (free), set constraints like "all databases aligned, below the services" (SetCoLa, C.5; yFiles `placeInSameLayer`, `placeNodeBeforeNode`, `placeAtTop`), and pins (Dunnart). Never x/y.
5. A validator with line-numbered, multi-error output and a render-preview tool. D2's multi-error parser and `--check`, LikeC4's language server and `preview-view` MCP tool, Structurizr's validate/inspect MCP, Mermaid's `parse()`. GenAIScript reports LLMs fix Mermaid from the error message in most cases.
6. Structural edit API with stable ids. d2oracle's `Create/Set/Delete/Rename/Move` with ID-delta maps is the best found (Part 1). Ilograph's "iterate on existing diagrams instead of re-creating them" skill pitch is the use case.
7. Deterministic, stable relayout. An agent adding one node must not get a different picture for everything else, or it cannot reason about its own edits across turns.
8. Feedback into the agent's context: tldraw's canvas lints and sanitize-before-apply, Excalidraw MCP's 512 px screenshot back into context, Ilograph's content lints (unconnected resources, fan traps, master diagrams). A metric-based critic (crossings, overlaps, order violations) is cheaper and more reliable than a vision critic (G.6, F.4).
9. Distribution where agents already write: a Markdown fence, GitHub rendering, Kroki engine, VS Code preview, MCP server with validate, render, and diff tools. In 2026 Structurizr, LikeC4, IcePanel, draw.io, Mermaid Chart, PlantUML and Eraser all ship MCP; Ilograph ships Claude Code skills.
10. `llms.txt`, a syntax cheat sheet tool (`read_me` in Excalidraw MCP, `get_drawio_reference`), and an honest "things LLMs get wrong" page (tldraw).

Bad:

- Coordinates in the format (Excalidraw, tldraw, draw.io XML, Isoflow tiles, Wardley). The LLM becomes the layout engine.
- Verbose boilerplate (draw.io mxCell XML, PlantUML `@startuml` plus skinparams, C4-PlantUML macros: lowest validity at 58% in one study, Part 1).
- Many grammars under one name (Mermaid's 20 diagram types each with its own parser) and breaking visual changes between minor versions (Mermaid 11.16, 11.17, 12.0).
- Silent no-ops for wrong option names (elkjs ignores a non-unique option suffix) and silent resolution of ambiguous references (Ilograph).
- Manual layout stored outside the source (Structurizr workspace.json, LikeC4 overrides) so a round trip through an agent loses it.
- Non-determinism (TALA seeds, fcose, Graphviz cluster order) and non-local effects (one added node reshuffles everything).
- Closed engines with no self-host (Ilograph, Eraser, Lucid, IcePanel) and APIs gated to paid tiers.
- Force or physics layouts: the agent has no vocabulary to say "this before that".

### (c) Ranked ideas to combine

1. Ilograph's layout contract as the core model: a resource tree shared by all perspectives; per-perspective relations with `from` left and `to` right; sibling order by first reference; `secondary` arrows that do not affect layout; `unwrapContext` as the single escape hatch; `contexts` as swappable containment trees; `scale` and `detail` for emphasis; sequence perspectives drawn over the same boxes with `to`, `toAndBack`, `toAsync`, `subSequence`; walkthroughs. Then replace its hand-tuned engine with a principled one (Part 2).
2. Lucidscale's containment-first recipe generalised: author-ordered group hierarchy, per-container grid policy (columns, sort, group by type), summarise-by-type badges, edges off by default and toggled per category, views as structure + filter + layout (Part 4). Implement with ordered rectpacking or strip treemap inside containers (E.3, E.4).
3. ELK model order and partitions as the layered core's constraint surface: `considerModelOrder NODES_AND_EDGES`, `forceNodeModelOrder`, `GREEDY_MODEL_ORDER` cycle breaking, `partitioning.partition` as author-named columns, `layerConstraint FIRST/LAST` as entry and exit, port `FIXED_SIDE` (Part 7, B.8). Expose as `order: hint | strict` per view.
4. Top-down compound layout instead of INCLUDE_CHILDREN: lay the parent out, give each child a box and scale, lay out inside (ELK topdown, Kasperowski 2023). Sidesteps the compound-graph bugs the ELK maintainers themselves call "a little bit buggy" (elk#891) and gives the Ilograph look (Part 3).
5. yFiles' polish passes as a checklist: integrated edge labeling, orthogonal routing with buses and grid snapping, groups with insets and compact layering, critical-path straightening, swimlanes with lane reordering, from-sketch stability, time budget (Part 3). None is magic; each is a pass.
6. SetCoLa's set-constraint vocabulary as the language's layout words (align, position relative to set or guide, order along axis, hull, padding), compiled to per-node separation constraints by the published rules (C.5); Penrose's `ensure`/`encourage` split for hard vs soft (Part 5); yFiles-sized words: same layer, before, first, last, critical, side.
7. Separate position-preserving edge-routing pass (draw.io's `orthogonalEdge`/libavoid mode; Excalidraw's elbow-arrow goals as the acceptance spec; Wybrow GD 2009 and hyperedge routing 2012 as the algorithm; yFiles bus backbone-then-stubs).
8. TALA's structure discovery and scoring: find trees, DAG core, clusters; place with a scored cost; pack; route; run a few seeds and keep the best by normalised metrics (E.6, F.4). Now MPL-2.0 Go at https://github.com/d2lang/d2/tree/master/d2layouts/d2talalayout, readable reference for cost terms and the grid router.
9. HOLA's decomposition for non-flow regions: peel leaf trees to the outside, stress-plus-constraints core, ACA greedy alignment, compaction (C.7, C.8). The "trees on the outside" finding is the one new empirical result about what humans draw.
10. D2's `layers`/`scenarios`/`steps` inheritance modes for boards, `_` parent reference, `near`, grid containers for things that must never be auto-laid-out, `d2oracle`-style structural edit API with ID deltas, multi-error parser plus `--check` (Part 1).
11. Eraser's syntax surface (`name [icon: x] { }`, `A > B, C: label`, `direction`, legends, `colorMode`/`styleMode`) and Ilograph/diagrams-style typed icon catalogue with validation and autocomplete (Parts 4, 5).
12. Sequence diagrams as a separate grid renderer, not a graph special case; ZenUML's code-shaped syntax (`A.method() { B.call() }`, `if/else`, `par`, `try/catch`) is the most LLM-native; LikeC4's dual rendering (on-diagram steps and classic lifelines) (Parts 2, 5).
13. Mental-map preservation across edits and across perspectives: derive ordering constraints from the previous layout (Misue 1995; ELK INTERACTIVE strategies; `generatePositionAndLayerIds`) so the same element sits in the same relative place in every view (A.14, I.10).
14. Interactivity from Ilograph and LikeC4: click to focus hides unrelated resources, perspective dots on a selected node, detail slider by depth, zoom into a container, relationship browser, `navigateTo`, self-contained HTML export with deep links, React Flow for the canvas only (Part 2).
15. Agent loop from tldraw and Excalidraw MCP: typed zod action schemas, sanitize before apply, streamed application, lints and a rendered screenshot fed back; plus Ilograph's content lints as warnings (Parts 2, 4).
16. Vendor group colours and line styles as defaults (AWS hex table and dashed/dotted rules, Azure arrow and legend rules), and overlapping groups (ASG across subnets) as a first-class model feature nobody code-first has (Part 5).
17. Wrapping for long flows (ELK wrapping, B.9) and Wardley-style semantic axes (tier, trust zone, lifecycle) as an optional layout mode (Part 5).
18. Kroki as the benchmark harness and distribution channel; JSON Canvas and draw.io XML as export targets for hand-tweaking (Part 5).

### (d) Open-source libraries a TypeScript implementation could build on

Verified on 2026-10-26 by `npm view` and the GitHub API (full table in Part 7).

| Library | Version | License | Verdict |
|---|---|---|---|
| elkjs | 0.12.0 (2026-07-17) | EPL-2.0 OR GPL-3.0-or-later | Use for the layered core now. Model order, partitions, layer constraints, ports, orthogonal routing, rectpacking, top-down layout, wrapping, all in one JSON call in a worker. Costs: 1.6 MB GWT bundle, no text measurement, silent no-op on bad option names, INCLUDE_CHILDREN fragile. EPL-2.0 is permissive for use as a library. |
| libavoid-js | 0.5.0-beta.5 (2026-02-23) | LGPL-2.1-or-later per npm registry (see Part 9 for a conflicting SSPL report) | Use for position-preserving orthogonal routing and hyperedges in a worker; draw.io, JointJS and Sprotty do. LGPL via WASM module is fine for a product if kept as a separate module. Alternative: write a native TS visibility-graph router from Wybrow GD 2009 (a few thousand lines). |
| @lume/kiwi | 0.4.4 (2024-09-17) | BSD-3-Clause | Use for the final metrics pass (alignment, equal widths, padding, snap, strength ladder order < set < pin). LikeC4 already uses it for its sequence layouter. |
| @dagrejs/dagre | 3.1.3 (2026-10-24) | MIT | Reference for a 50 KB layered pipeline; not a product engine (no ports, labels in layering, model order, routing; cluster edges broken). |
| webcola | 3.4.0 (2022-06-28) | MIT | Unmaintained since 2022. Port only VPSC (a few hundred lines) and write stress plus ACA fresh for non-flow regions. |
| @msagl/core | 1.1.24 (2026-04-24) | MIT | Only MIT JS with rectilinear routing and bundling; Sugiyama constraints "not implemented yet". Benchmark its router; do not build on its layered layout. |
| cytoscape + cytoscape-fcose | 3.34.4 / 2.2.0 | MIT | Compound-aware constrained force layout; organic output needs the alignment and routing tail. Canvas is mature but React Flow is the better interactive base. |
| @xyflow/react | 12.x | MIT | The canvas. No layout; that is the differentiator. |
| @hpcc-js/wasm-graphviz | 1.30.0 | Apache-2.0 (Graphviz EPL-2.0) | Benchmark baseline only. |
| d3-dag | 1.2.2 | MIT | Reference for an exact ILP decrossing option. |
| D2 TALA (Go) | d2 v0.9.0 | MPL-2.0 | Reference source, not a dependency (Go). Port its cost terms and grid router ideas. |
| Adaptagrams libdialect (HOLA) | C++ | LGPL-2.1 | Reference; no JS port exists. Implement ACA from the paper. |
| OGDF | C++ | GPL | Avoid. |
| tldraw | 5.x | source-available, key and watermark required | Avoid as a base. |

Recommendation: build the engine in TypeScript around a containment-first pipeline (Part 6, section I) and use elkjs as the first layered core behind an interface, with libavoid-js (or a native router) as the routing pass and kiwi for the metrics pass. Keep the layered core swappable: dagre's size shows a purpose-built core with model order, label dummies, ports and wrapping is tractable, and ELK's compound and label issues are where a custom core would pay for itself later. Never let the agent, or the LLM behind it, emit coordinates.

## Part 9. Discrepancies and open questions

- libavoid-js license: `npm view libavoid-js` on 2026-10-26 reports `LGPL-2.1-or-later` for 0.5.0-beta.5 and the repo package.json for 0.4.5 says the same; one research pass found libraries.io listing the beta as SSPL-1.0. Treat 0.4.5 as LGPL for certain and confirm the beta's LICENSE file before depending on it.
- Graphviz license: the brief said EPL-1.0; https://graphviz.org/license/ says EPL-2.0.
- Ilograph founder: Billy Pilger, not "Billy Whyte".
- Ilograph's layout algorithm is proprietary and undocumented; the characterisation in Part 2 (containment first, from-left to-right, first-reference order, relation-count sizing, cycle breaking by one reversed edge) is partly read from the public docs and partly inferred; the "recursive box packing by from/to depth" claim is a guess.
- The shared web-search budget ran out near the end of the run. Not searched: vision-model-in-the-loop diagram repair papers (2025-2026), an MCP diagram-server comparison, Penrose plus LLM work, Gestalt studies specific to containment, Kasperowski's top-down report body, Archinsight's repo and license, Google Cloud icon terms, HN and Reddit threads on LikeC4.
- Mermaid 12.0 release date was read as "roughly September 2026" from a release page; confirm against https://github.com/mermaid-js/mermaid/releases before quoting.
- yFiles pricing: the pricing page says per year; a separate license-types page describes a one-time purchase with maintenance. Unresolved.
- Lucid pricing figures come from third-party trackers; https://lucid.app/pricing/lucidchart did not render.
