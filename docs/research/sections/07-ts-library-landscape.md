## TypeScript-usable layout library landscape (verified 2026-10-26)

Verified by `npm view` and `gh api` on 2026-10-26 unless noted.

| Library | npm | Version | License | Stars | Last push | What it gives you |
|---|---|---|---|---|---|---|
| Eclipse ELK (elkjs) | `elkjs` | 0.12.0 (2026-07-17) | EPL-2.0 OR GPL-3.0-or-later | 2,854 | 2026-10-19 | Layered (Sugiyama) with model order, partitions, layer constraints, port constraints, orthogonal routing, compound graphs (INCLUDE_CHILDREN), rectpacking, box, stress, force, mrtree, radial, top-down layout. GWT-transpiled Java, runs in a worker. |
| dagre | `@dagrejs/dagre` | 3.1.3 (2026-10-24) | MIT | 5,838 | 2026-10-24 | Layered only. Network simplex ranking, barycenter ordering, Brandes-Koepf placement. Weak compound support, no orthogonal routing. |
| WebCola | `webcola` | 3.4.0 (2022-06-28) | MIT | 2,099 | 2026-04-30 | Stress majorization with separation constraints (VPSC), alignment constraints, groups with padding, `flowLayout`, overlap removal, power-graph bundling. Effectively unmaintained since 2022 release. |
| MSAGL.js | `@msagl/core` | 1.1.24 (2026-04-24) | MIT | 175 | 2026-10-26 | Sugiyama, pivot MDS, IPSepCola; routing modes Spline, SplineBundling, Rectilinear, Sleeve (CDT + funnel). Sugiyama constraints "not implemented yet" (docs). Subgraphs via nested Graph nodes. Microsoft maintained, ships an "agent skill". |
| libavoid-js | `libavoid-js` | 0.5.0-beta.5 (2026-02-23) | LGPL-2.1-or-later | 46 | 2026-09-06 | Emscripten/WASM build of Adaptagrams libavoid: obstacle-avoiding orthogonal and polyline connector routing with fixed nodes, hyperedges, penalties. Used by JointJS `@joint/router-avoid`, Sprotty, and draw.io's MCP server. |
| libavoid-rust | (wasm-pack) | n/a | Apache-2.0 | 9 | 2025-11-25 | Rust port of libavoid with wasm bindings. Tiny, unproven. |
| Adaptagrams (C++) | n/a | n/a | LGPL-2.1-or-later (commercial license available) | 323 | 2025-10-29 | libvpsc, libcola, libavoid, libtopology, libdialect (HOLA). SWIG bindings for Java/Python. No official WASM. |
| @lume/kiwi | `@lume/kiwi` | 0.4.4 (2024-09-17) | BSD-3-Clause | 214 | n/a | Cassowary linear constraint solver in TS. 2x faster than cassowary.js. Good for "A left of B", "align tops", "contain" constraints after topology is fixed. |
| d3-dag | `d3-dag` | 1.2.2 (2026-07-05) | MIT | 1,500 | n/a | Sugiyama with pluggable layering/decross (incl. ILP-optimal)/coord operators; zherebko; grid. No compound graphs. |
| Cytoscape.js | `cytoscape` | 3.34.4 (2026-10-15) | MIT | 11,253 | 2026-10-21 | Graph model + canvas renderer with first-class compound nodes; layouts via extensions (fcose, cose-bilkent, dagre, elk adapters). |
| cytoscape.js-fcose | `cytoscape-fcose` | n/a | MIT | 187 | 2026-04-17 | Compound-aware force layout with alignment/relative-placement constraints (Balci and Dogrusoz 2021). |
| Graphviz WASM | `@hpcc-js/wasm` | 2.36.0 (2026-10-21) | Apache-2.0 (wrapper; Graphviz is EPL-1.0) | n/a | n/a | dot/neato/fdp/sfdp/osage in WASM. Used by LikeC4. |
| OGDF | `ogdfjs` 0.2.0 (unmaintained Emscripten build) | n/a | OGDF is GPL-2.0/3.0 | 404 | 2026-04-21 | Sugiyama with clusters, planarization, orthogonal (Kandinsky) layout. GPL makes it unattractive; no maintained JS build. |
| AntV layout | `@antv/layout` | 2.0.0 (2026-09-21) | MIT | n/a | n/a | G6's layouts (dagre port, compact box, mindmap, combos, force). `@antv/layout-wasm` exists for force layouts. |
| xyflow (React Flow / Svelte Flow) | `@xyflow/react` | n/a | MIT | 38,791 | n/a | The de facto interactive canvas. No layout; docs recommend elkjs/dagre/d3-hierarchy. |

Notes:
- elkjs has shipped 0.10.0 (2025-03), 0.10.1, 0.10.2, 0.11.0 (2025-09), 0.11.1 (2026-03), 0.12.0 (2026-07). Cadence is roughly two releases a year. Source: https://github.com/kieler/elkjs/releases
- draw.io has replaced its legacy mxGraph auto layouts with ELK (`elkLayered`, `elkTree`, `elkRadial`, `elkOrganic`, `elkStress`, `elkDisco`, `elkBox`) and added libavoid as `orthogonalEdge`, exposed through a JSON layout spec that is also used for CSV import and the desktop `--layout` flag. This is strong evidence elkjs plus libavoid-js is a production-proven browser stack. Source: https://www.drawio.com/docs/reference/json-layout-specification/
- ELK's own libavoid integration (`org.eclipse.elk.alg.libavoid`) runs libavoid as a separate native process over stdio and is Java-only; it is not part of elkjs. Source: https://eclipse.dev/elk/blog/posts/2022/22-11-17-libavoid.html
- MSAGL.js docs state: "The constraint functionality for Sugiyama scheme is not implemented yet." Source: https://microsoft.github.io/msagljs/docs/api
- A 2026 paper (Nachmanson and Chen, arXiv:2605.17498) describes MSAGLJS's sleeve routing and tile pyramids for large graphs in the browser. https://arxiv.org/abs/2605.17498

### ELK Layered options that matter for "author-controlled, story-telling" layouts

From the ELK reference and the 2023 "Layered: Constraining the Model" post (https://eclipse.dev/elk/blog/posts/2023/23-01-09-constraining-the-model.html) and the 2025 "Layered (overview)" post (https://eclipse.dev/elk/blog/posts/2025/25-08-21-layered.html):

- `elk.direction` RIGHT or DOWN: the reading direction.
- `elk.layered.cycleBreaking.strategy`: `GREEDY_MODEL_ORDER` (greedy, model order as tie break) or `MODEL_ORDER` (edges against textual order get reversed). Author order of declarations decides what is "forward".
- `elk.layered.layering.strategy`: `NETWORK_SIMPLEX` (default), `LONGEST_PATH_SOURCE`, `COFFMAN_GRAHAM`, experimental `BF_MODEL_ORDER` / `DF_MODEL_ORDER`.
- `elk.layered.layering.nodePromotion.strategy: MODEL_ORDER_LEFT_TO_RIGHT` with `LONGEST_PATH_SOURCE` fixes layers by model order.
- `elk.partitioning.activate: true` + `elk.partitioning.partition: n` on nodes: guarantees lower partition is left of higher partition (an author-declared column/tier). https://eclipse.dev/elk/reference/options/org-eclipse-elk-partitioning-activate.html
- `elk.layered.layering.layerConstraint: FIRST | LAST`.
- `elk.layered.considerModelOrder.strategy: NODES_AND_EDGES | PREFER_EDGES | PREFER_NODES`: "Preserves the order of nodes and edges in the model file if this does not lead to additional edge crossings." Plus `crossingCounterNodeInfluence`, `crossingCounterPortInfluence`, `forceNodeModelOrder`, and `considerModelOrder.components` for ordering disconnected components by model order. https://eclipse.dev/elk/reference/options/org-eclipse-elk-layered-considerModelOrder-strategy.html
- To enforce full model order: `crossingMinimization.strategy: NONE` and `greedySwitch.type: OFF`.
- `elk.hierarchyHandling: INCLUDE_CHILDREN` lays out a node and all descendants in one run so cross-hierarchy edges route properly; default is `SEPARATE_CHILDREN` (each container laid out alone, then treated as a box). https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html
- `elk.portConstraints: FIXED_SIDE | FIXED_ORDER | FIXED_POS` and `elk.port.side`.
- `elk.edgeRouting: ORTHOGONAL | POLYLINE | SPLINES`, `elk.layered.mergeEdges`, `elk.layered.unnecessaryBendpoints`, `elk.layered.compaction.postCompaction.strategy`, `elk.layered.nodePlacement.networkSimplex.nodeFlexibility` (straightens edges by stretching nodes), `elk.layered.thoroughness`.
- `elk.layered.wrapping.strategy` (multi-row wrapping of long chains), `elk.layered.layerUnzipping` (2024, splits very tall layers).
- Interactive / incremental: `cycleBreaking.strategy: INTERACTIVE`, `layering.strategy: INTERACTIVE`, `crossingMinimization.semiInteractive: true`, `elk.position` on nodes, `separateConnectedComponents: false`.
- `elk.rectpacking`: packs edgeless boxes into rows (and stacked subrows) preserving model order, left-to-right reading, target aspect ratio (default 1.3), whitespace elimination. https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-rectpacking.html and https://eclipse.dev/elk/blog/posts/2022/22-08-31-rectpacking.html
- `elk.topdownLayout`: root laid out first; each child gets an area assigned by its parent and its inner layout is scaled to fit, so sibling containers look uniform. Not compatible with INCLUDE_CHILDREN. https://eclipse.dev/elk/reference/options/org-eclipse-elk-topdownLayout.html
