# 04. Canvas, AI-generation, and commercial cloud-diagram products

Scope: whiteboard and canvas SDKs (Excalidraw, tldraw, draw.io), the commercial cloud-diagram products (Lucidchart and Lucidscale, Cloudcraft), the isometric open-source editors (Isoflow and FossFLOW), the AI-first "diagram as code" product (Eraser), and short notes on FigJam, Miro, Whimsical, Gliffy, Creately, Visio, OmniGraffle, and D2 Studio.

The common thread, stated up front: none of the canvas SDKs has a native auto-layout. Every one of them places elements only where the author (human or LLM) puts them by x and y. The only ones that produce clean layouts without a human are the ones that ingest a live cloud account and lay out by containment (Lucidscale, Cloudcraft), and draw.io, which bolts the Eclipse Layout Kernel on top of a manual canvas. That gap is the opening for the product this research supports.

Research date: 2026-10-26. Star counts and release dates were read from the GitHub API on that day unless a URL is cited.

---

## Excalidraw

### 1. Language / model

Excalidraw has no language. Its model is a flat JSON array of elements in the open `.excalidraw` format, with `type`, `x`, `y`, `width`, `height`, style fields, and for arrows a `points` array plus `startBinding` and `endBinding` (https://github.com/excalidraw/excalidraw). There is no nesting in the element model except `frame` elements, which hold a `children` list of element ids, and text containers, which link a shape to a text element by `containerId`.

For programmatic authoring Excalidraw exposes a simplified "skeleton" format through `convertToExcalidrawElements(elements, { regenerateIds })` (https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/excalidraw-element-skeleton). The skeleton lets you write `label: { text }` on a shape and `start: { id }` / `end: { id }` (or `start: { type: "rectangle" }` to create the endpoint shape inline) on an arrow, and `type: "frame", children: [...]` for a frame. Minimal sample (verbatim shape from the docs page):

```js
convertToExcalidrawElements([
  { type: "rectangle", id: "box", x: 100, y: 100, label: { text: "Start" } },
  { type: "ellipse", id: "circle", x: 400, y: 100, label: { text: "End" } },
  { type: "arrow", x: 255, y: 140, label: { text: "next" }, start: { id: "box" }, end: { id: "circle" } },
  { type: "frame", children: ["box", "circle"], name: "Flow" },
], { regenerateIds: false });
```

Everything is positioned by absolute `x`/`y`. The docs state plainly that "Position comes only from x and y, with no automatic layout engine" (same page). The skeleton API is marked beta.

There are no views or perspectives. One file is one canvas; frames are the closest thing to a scoped view (you can export a frame on its own).

### 2. Layout engine

None. The only layout path is the Mermaid bridge: `@excalidraw/mermaid-to-excalidraw` calls `mermaid.render` to get an SVG, reads element positions and sizes from that SVG, then separately parses the Mermaid definition with `mermaid.mermaidAPI.getDiagramFromText` to recover edges and bindings, because "connections and bindings aren't possible from SVG alone" (https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/codebase/parser/). So positions are whatever Mermaid's dagre layout produced. Only flowcharts are converted to native elements; subgraphs are supported; subroutine, cylinder, hexagon, parallelogram, and trapezoid shapes fall back to rectangles; every other Mermaid diagram type (sequence, ER, gitGraph) is rasterised to an image element (https://docs.excalidraw.com/docs/@excalidraw/mermaid-to-excalidraw/api). The package is MIT with 905 stars.

Edge routing: elbow arrows shipped in `@excalidraw/excalidraw` 0.18.0 on 2025-03-11 (https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/excalidraw/CHANGELOG.md). Excalidraw Plus published an engineering series on them; part one (2025-10-06) says the first naive greedy router "satisfied few of the design goals" and produced "needlessly complex or odd routes", with the stated goals being shortest route, minimal segments, arrowheads that point at the target rather than entering it, and avoidance of the bound shapes along the whole length; part two promises "an algorithm we borrowed from video game development" (https://plus.excalidraw.com/blog/building-elbow-arrows-part-one). That is almost certainly A* on a grid (a guess from the phrasing, not confirmed).

The Obsidian Excalidraw plugin community has an "Auto Layout" script that runs elkjs over a selected group of elements; it is a plugin script, not a core feature, and needs network access (https://sjgknight.com/Excalidraw/Scripts/Downloaded/Auto-Layout).

### 3. Interactivity

Infinite canvas, zoom and pan, frames, element links, arrow binding, labelled arrows, undo/redo, PNG/SVG/clipboard export, real-time collaboration with end-to-end encryption on excalidraw.com (https://github.com/excalidraw/excalidraw). No collapse/expand, no multiple views, no hover detail, no semantic navigation. It is a drawing surface, not a model viewer.

### 4. Agent / LLM friendliness

Two official AI surfaces:

- "Text to diagram" in the TTDDialog. The app calls `${VITE_APP_AI_BACKEND}/v1/ai/text-to-diagram/chat-streaming` with the chat messages and `extractRateLimits: true` (https://raw.githubusercontent.com/excalidraw/excalidraw/master/excalidraw-app/components/AI.tsx). The dialog's Mermaid tab uses `parseMermaidToExcalidraw` (https://raw.githubusercontent.com/excalidraw/excalidraw/master/packages/excalidraw/components/TTDDialog/TTDDialog.tsx). Independent write-ups confirm the AI output is Mermaid that is then converted, and that self-hosters can point it at any OpenAI-compatible endpoint (https://smcleod.net/2024/10/generating-diagrams-with-with-ai-/-llms/). So the "AI diagram" has exactly Mermaid's layout quality and only Mermaid flowchart's expressiveness.
- `excalidraw/excalidraw-mcp` (5,574 stars, hosted at `https://mcp.excalidraw.com`, MIT per README, no SPDX file detected by GitHub). It registers `read_me` (returns a cheat sheet with element format, palettes, and coordinate tips) and `create_view` (takes `elements`, a JSON string of standard Excalidraw elements, streams them in with draw-on animation, and returns a `checkpointId`), plus `save_checkpoint` and `read_checkpoint` for round-tripping user edits made in fullscreen (https://github.com/excalidraw/excalidraw-mcp, file `CLAUDE.md` and `src/server.ts`). The design notes are instructive: they deliberately rejected the skeleton API ("Needs font metrics at conversion time", "Non-standard format") and so the LLM must emit separate text elements with hand-computed centred coordinates using `x = shape.x + (shape.width - text.width) / 2`. The server also checks `cameraUpdate` elements and nudges the model toward 4:3 viewports, and captures a 512 px PNG of the result back into model context so the model can look at what it drew. There is an input byte limit and the error text tells the model to "use checkpoints to build incrementally".

Net: the format is trivially learnable (flat JSON), LLMs emit it reliably, but the LLM is doing the layout by arithmetic. Overlaps, misaligned labels, and arrows crossing boxes are the normal failure mode; the screenshot-back-to-model loop exists precisely because the model cannot know what it drew.

### 5. What it does well

Zero-friction look and feel; the hand-drawn aesthetic (rough.js) hides small alignment errors, which is a real reason it is so popular for LLM output. Open MIT format, huge community (134,617 stars, latest package release v0.18.1 on 2026-04-21), React embeddable, good export, frames for scoping, elbow arrows now exist.

### 6. Where it fails and why

- No layout engine at all. Any "auto" path is Mermaid's dagre, so you inherit rank-based placement with no containment story beyond subgraphs.
- No model: a box is a box. Nothing knows that a rectangle "is" a VPC, so there is nothing to lay out by meaning.
- No views. One canvas per story.
- Programmatic text sizing needs a DOM `measureText`; the MCP authors gave up on it and made the LLM guess text widths.
- Elbow arrows are a routing primitive, not a routing pass over a whole diagram; nothing prevents two elbows from overlapping.

### 7. License and maturity

MIT (https://github.com/excalidraw/excalidraw). Very active (pushed 2026-10-26). Excalidraw+ is the paid hosted tier. `@excalidraw/mermaid-to-excalidraw` MIT, 905 stars, pushed 2026-10-21. `excalidraw-mcp` 5,574 stars, pushed 2026-03-24.

### 8. Ideas to steal

- The skeleton API shape: `label: { text }` on a container and `start: { id } / end: { id }` on edges is the right level of terseness for an LLM-facing element format.
- The MCP "screenshot back into model context" loop and the checkpoint id for incremental edits.
- The elbow-arrow design goals list is a good acceptance spec for an edge router: shortest, fewest bends, arrowhead points at target, never crosses the bound shapes.
- Frames as exportable sub-views.

---

## tldraw

### 1. Language / model

tldraw is a React infinite-canvas SDK. The model is a record store: shapes are typed records (`geo` for rectangles and ellipses chosen by `props.geo`, `arrow`, `text`, `frame`, `note`, custom shapes), with text held in a `richText` prop built with `toRichText()`, ids created by `createShapeId()`, and relationships (arrow-to-shape attachment) stored as separate `binding` records rather than on the shape (https://tldraw.dev/blog/20-things-i-wish-ai-chatbots-knew-about-tldraw). Shapes render as DOM elements via React, not to a 2D canvas, which is why real web content (iframes, buttons) can sit on the canvas. Parent-child nesting exists (frames and groups; v4.0 added "shapes can clip their children, which supports container-style shapes", https://tldraw.dev/releases/v4.0.0).

No text language. For agents the model is reduced to a simplified JSON "FocusedShape" / "BlurryShape" format (see section 4).

### 2. Layout engine

None native. The AI use-case page says developers "Implement custom layout logic" themselves (https://tldraw.dev/use-cases/ai-enabled-canvas). I found no official ELK or dagre integration; the only auto-routing claim is the Workflow starter kit's "automatic connection routing" between port-bearing nodes (same page).

Edge routing: elbow arrows arrived in v3.13.0, "straight lines joined at right angles rather than curved paths", exposed as an arrow line-style option (https://tldraw.dev/releases/v3.13.0). The route is exposed through `ElbowArrowRoute` (vertices and total distance in arrow-space pixels) and `ElbowArrowInfo` reference types (https://tldraw.dev/reference/tldraw/ElbowArrowRoute). Snapping to grid and to other shapes is built in. The binding model (bindings as first-class records with their own util) is cleaner than Excalidraw's.

### 3. Interactivity

Full editor: zoom, pan, frames, groups, embeds, rich text, multiplayer via `@tldraw/sync` (server-authoritative, not a CRDT), export with `editor.toImage()` (https://tldraw.dev/blog/20-things-i-wish-ai-chatbots-knew-about-tldraw). No collapse/expand of containers, no multi-view model, no semantic hover. Again a drawing surface.

### 4. Agent / LLM friendliness

This is where tldraw is furthest ahead of the other canvases.

- `@tldraw/ai` was the first-generation module (a `useTldrawAi` hook with `transforms` and a `generate` function returning changes); it was removed in v4.0.0: "@tldraw/ai module removed. Use the agent starter kit instead" (https://tldraw.dev/releases/v4.0.0).
- The Agent starter kit (`npm create tldraw@latest -- --template agent`) is the current pattern (https://tldraw.dev/starter-kits/agent). What the model sees: a screenshot of its viewport, a list of `BlurryShape` records in view (bounds, id, type, text), `PeripheralShapeCluster` summaries for off-screen shapes (bounds and counts), `FocusedShape` records for shapes added to context, the selection, recent user actions, and session history. What it does: emits typed actions defined by zod schemas in `shared/schema/AgentActionSchemas.ts`; each action has an `AgentActionUtil` with `applyAction`, and a `sanitizeAction` step that repairs model mistakes with helpers like `ensureShapeIdExists()`, `ensureShapeIdIsUnique()`, `ensureValueIsVec()`. Positions the model emits are relative to the chat's starting point and converted back with `removeOffsetFromVec`. Actions stream and are applied as each completes. There are modes (what the agent can see and do), prompt parts, managers (chat, model, context, todo), "canvas linting" that flags shape issues back to the agent, and a `note` field on shapes the agent uses to leave itself notes. v4.4.0 restructured it around managers, modes, action schema registries, and user action tracking (https://tldraw.dev/releases/v4.4.0). Providers: Anthropic, OpenAI, Google; the docs recommend Anthropic.
- tldraw's own warning about LLMs: "Models often produce v2-era APIs, invented packages, and false claims about the license and architecture"; they publish `tldraw.dev/llms.txt` and `llms-full.txt`, and state there is no official MCP server as of June 2026 (https://tldraw.dev/blog/20-things-i-wish-ai-chatbots-knew-about-tldraw).
- Products on the SDK: Make Real (sketch to working HTML, 2023), tldraw computer (natural-language workflow graphs built with the Google AI team, presented at AI Engineer World's Fair 2025), tldraw teach (the experiment whose tech became the Agent kit) (https://tldraw.dev/use-cases/ai-enabled-canvas, https://www.ai.engineer/talks/1C2TdPkj6aQ-tldraw-computer).

Layout is still the model's job. The viewport-only visibility ("Shapes outside it appear only as approximate clusters") means an agent cannot reason about the whole diagram at once, and the docs acknowledge actions "may contain invalid data, especially if the canvas changed since the model last saw it" (https://tldraw.dev/starter-kits/agent).

### 5. What it does well

Best-in-class canvas engineering (DOM shapes, bindings, snapping, elbow arrows, frames with clipping), a serious agent architecture (sanitise, stream, lint, modes, memory), multiplayer. 51,105 stars, release v5.5.2 on 2026-10-02, pushed 2026-10-26.

### 6. Where it fails and why

- No layout engine; no graph semantics; agent output is pixel coordinates.
- The agent sees a viewport, not a model. Large diagrams are "clusters".
- License blocks a free product (next section).

### 7. License and maturity

Not open source. "The SDK is source available but not open source under any OSI definition"; production use requires a license key (trial 100 days, commercial, or hobby); hobby keys must show the "made with tldraw" watermark; keys are validated client-side and work offline; trial keys ping tldraw with a hash of the key (https://tldraw.dev/community/license). The license text forbids disabling the watermark or the key validation and forbids redistributing the SDK "as a standalone product" (https://tldraw.dev/legal/tldraw-license). Watermark-based licensing started at v3.0.0 and the key requirement at v4.0 (September 2025) (https://tldraw.dev/releases/v3.0.0, https://tldraw.dev/releases/v4.0.0). GitHub reports the license as `NOASSERTION`. Starter kits are MIT (https://github.com/tldraw/tldraw). Commercial pricing is quote-based via a form; no public price.

### 8. Ideas to steal

- The whole agent loop: typed zod action schemas, `sanitizeAction` repair before apply, streamed application, canvas lints fed back as agent input, per-shape agent notes.
- Bindings as first-class records.
- `llms.txt` / `llms-full.txt` plus a "things chatbots get wrong" page as a deliberate LLM-facing doc surface.
- `BlurryShape` / `PeripheralShapeCluster` as a level-of-detail scheme for feeding a large canvas to a model.

---

## draw.io / diagrams.net

### 1. Language / model

draw.io's native format is mxGraph XML: an `<mxGraphModel>` (optionally wrapped in `<mxfile>` for multi-page), a root with two structural cells `id="0"` and `id="1"`, then one `<mxCell>` per vertex or edge with a `style` string and an `<mxGeometry>` child (https://www.drawio.com/docs/reference/diagram-generation/, https://raw.githubusercontent.com/jgraph/drawio-mcp/main/shared/xml-reference.md). Nesting is by `parent="<containerId>"` with coordinates relative to the container; containers are `group;` (invisible), `swimlane;startSize=24` (titled), or any shape with `container=1`. Edge routing is a style flag: `edgeStyle=orthogonalEdgeStyle`, `rounded=1`, `curved=1`, and optional `exitX/exitY/entryX/entryY` ports. Layers are cells with `parent="0"`. A representative vertex and edge:

```xml
<mxCell id="web" value="Web" style="rounded=1;html=1;" vertex="1" parent="vpc">
  <mxGeometry x="40" y="40" width="140" height="60" as="geometry"/>
</mxCell>
<mxCell id="e1" style="edgeStyle=orthogonalEdgeStyle;html=1;" edge="1" parent="1" source="web" target="db">
  <mxGeometry relative="1" as="geometry"/>
</mxCell>
```

There is also CSV import, where a header comment block declares columns, label templates, connection rules, and a `# layout:` line (https://drawio-app.com/wp-content/uploads/2018/03/drawio-example-csv-import.txt), and Insert > Advanced > Mermaid and PlantUML. Multiple pages exist; multiple "views" of one model do not.

### 2. Layout engine

draw.io is the one canvas here with a real layout stack. Arrange > Layout presets (Flow, Tree, Radial Tree, Organic) now run on the Eclipse Layout Kernel; the June 2026 post says the updated dialogs "use the Eclipse Layout Kernel (ELK) and its layering algorithms" (https://www.drawio.com/blog/auto-layouts/). The JSON layout specification documents the engine table: `elkLayered` (Sugiyama, flowcharts and DAGs), `elkTree` (mrtree), `elkRadial`, `elkOrganic` (force), `elkStress`, `elkDisco` and `elkBox` (pack already-positioned groups); legacy mxGraph `mxCircleLayout`, `mxParallelEdgeLayout`, `mxOrgChartLayout`, `mxStackLayout`; `libavoid` `orthogonalEdge` for routing connectors orthogonally around shapes without moving them. `mxHierarchicalLayout`, `mxCompactTreeLayout`, `mxRadialTreeLayout`, `mxFastOrganicLayout` are mapped to ELK equivalents. Options pass through as `elk.*` keys (`elk.direction`, `elk.spacing.nodeNode`, `elk.layered.spacing.nodeNodeBetweenLayers`, `elk.edgeRouting` ORTHOGONAL | POLYLINE | SPLINES, `elk.layered.layering.strategy`) plus editor keys `edgeStyle`, `corners`, `resizeNodes`, `preserveOrigin`, `rootCellIds`, `respectFixedPosition`, `siblingOrder`, `nonTreeEdges`. CSV `# layout:` accepts `auto`, `none`, `circle`, `verticaltree`, `horizontaltree`, `verticalflow`, `horizontalflow`, `organic`, `orgchart`, `elkRadial`, `elkOrganic`, `elkStress`, `libavoid`, `parallels` (https://www.drawio.com/docs/reference/json-layout-specification/).

Compound handling is the weak point. Containers can carry a `childLayout` style (`flowLayout`, `treeLayout`, `organicLayout`, now run as ELK) with `parentPadding` and `resizeParent`, and a diagram-wide layout "doesn't rearrange their internal elements"; layout containers are excluded from diagram-wide layouts (https://www.drawio.com/blog/auto-layouts/). In other words draw.io does not run one hierarchical ELK layout over the whole compound graph; it runs a flat layout and leaves containers to lay themselves out. That is why nested cloud diagrams laid out automatically in draw.io look like boxes dropped on a layered graph rather than a story.

The desktop CLI exports headlessly: `drawio -x -f png|svg|pdf|xml|html -o out --layout verticalFlow|horizontalFlow|verticalTree|horizontalTree|radialTree|organic|<json>` with `--scale`, `--embed-diagram`, `--all-pages`, `--layers`, `--transparent` (https://linuxcommandlibrary.com/man/drawio).

### 3. Interactivity

Pages, layers (show/hide), collapsible containers, links on shapes, tooltips, embed via the viewer library, `#create` URL that opens the editor with XML and an optional layout. No multi-perspective model and no drill-down beyond collapse.

### 4. Agent / LLM friendliness

jgraph has invested here. `jgraph/drawio-mcp` (5,716 stars, Apache-2.0, pushed 2026-10-26) offers four approaches: a hosted MCP App Server at `https://mcp.draw.io/mcp` with tools `create_diagram` (XML or Mermaid, rendered inline), `search_shapes`, `get_drawio_reference`; a `@drawio/mcp` npm Tool Server with `open_drawio_xml` (XML, CSV, Mermaid); assistant plugins (a `drawio` skill for Claude Code, Codex CLI, Copilot CLI, Cursor, OpenCode) that write `.drawio` files and export via the Desktop CLI; and "Project Instructions" where Claude generates a `#create` URL using Python so the base64 is never typed token by token (https://cdn.jsdelivr.net/gh/jgraph/drawio-mcp@main/README.md). Two optional post-passes: `postLayout: "elk"` (full relayout) or `routing: "libavoid"` (keep positions, reroute edges), "use one or the other".

The shared XML reference is a very honest LLM style guide: "Don't hand-route edges. Skip waypoints"; place nodes on a grid "column x = col × 180 + 40, row y = row × 120 + 40"; standard sizes 140×60 rectangles, 160×90 diamonds; "Give every node its own grid cell"; "Don't spend effort on exact coordinate math"; file each edge in the innermost container holding both endpoints; "use a single hub or gateway node when many edges converge, rather than drawing many long cross-canvas connections" (https://raw.githubusercontent.com/jgraph/drawio-mcp/main/shared/xml-reference.md). An `mxfile.xsd` validates structure but not style strings; the diagram-generation reference forbids compressed base64 and XML comments (https://www.drawio.com/docs/reference/diagram-generation/).

Python wrappers: `drawpyo` (413 stars, MIT, manual placement only) and `N2G` (177 stars, MIT, layout via igraph `diagram.layout(algo="kk")`) (https://github.com/merrimanind/drawpyo, https://n2g.readthedocs.io/en/latest/diagram_plugins/DrawIo%20Module.html).

Failure modes are the obvious ones: the XML is verbose (an LLM spends most tokens on boilerplate), the model is still computing coordinates (hence the grid cheat sheet), and relative coordinates inside containers are an easy place to go wrong. jgraph's own guidance of "put it on a coarse grid and then run ELK or libavoid" is an admission that the LLM should not be the layout engine.

### 5. What it does well

The widest shape libraries (AWS, Azure, GCP, Cisco, Kubernetes), ELK with exposed options, libavoid edge routing as a separate pass, container `childLayout`, CSV import with layout, headless CLI, a serious MCP with validation and a style guide, a plain Apache-2.0 editor (9,005 stars, v32.6.1 on 2026-10-23).

### 6. Where it fails and why

- Layout is flat-first. Containers opt out of the global layout, so compound diagrams are laid out piecewise and nesting breaks the flow story.
- The model is geometry plus style strings. There is no semantic type, so "group by VPC" is a human act.
- Auto layout is a destructive one-shot (undo to revert); re-running after edits re-flows everything.
- Rank-based presets (vertical/horizontal flow) produce the familiar hierarchy-graph look.
- Repo accepts no pull requests ("The project is developed entirely by the core team") and some sources were replaced with minified versions in December 2024 (https://github.com/jgraph/drawio, https://en.wikipedia.org/wiki/Diagrams.net).

### 7. License and maturity

draw.io source: Apache-2.0, with icon sets and templates under separate terms that bar use in Atlassian products without permission; an Atlassian-exclusion clause was added to the license in 24.7.8 (August 2024) and reverted by 25.0.2 (December 2024) (https://github.com/jgraph/drawio, https://en.wikipedia.org/wiki/Diagrams.net). mxGraph: Apache-2.0, end of life 2020-11-09. maxGraph (TypeScript successor): Apache-2.0, 1,152 stars, v0.25.1 on 2026-10-21, "stronger focus on automatic layout algorithms" (https://github.com/maxGraph/maxGraph).

### 8. Ideas to steal

- The two-pass split: a layout pass (ELK) and an edge-only routing pass (libavoid) that respects existing positions. A product that lets a human nudge nodes and then only re-routes edges is much friendlier than a full re-flow.
- `childLayout` per container with `parentPadding` and `resizeParent` as the vocabulary for per-container layout policy.
- `rootCellIds` and `respectFixedPosition` as pinning hooks.
- The LLM XML guide's rule "hub node when many edges converge".
- `#create` URLs and `--layout` on the CLI as a shareable artifact format.

---

## Lucidchart and Lucidscale (Lucid Software)

### 1. Language / model

Lucidchart is a manual diagram editor. Its programmatic surface is Standard Import: a JSON document uploaded once through the Import Document REST endpoint, where each shape needs an `id`, `type`, and `boundingBox`, with optional style, text, actions, `customData`; containers are not nested in the JSON but "calculated by which shapes are within the container's bounding box", with `magnetized: true` to move children with the container; z-order is JSON order, and either all shapes are above all lines or vice versa; supported libraries are Standard, Flowchart, Containers (including swimlanes), Sticky Notes, Spark shapes; tables, mind maps, and Lucid Cards are not supported; and "there is no REST API endpoint to update shapes/lines/etc. already on the canvas" (https://developer.lucid.co/standard-import, https://community.lucid.co/developer-community-6/lucid-standard-import-a-k-a-json-import-api-faq-5982). So Lucidchart as a target is write-once, absolute coordinates, containment by geometry.

Lucidscale is being folded into Lucidchart as "cloud frames" under the Cloud Accelerator add-on (https://community.lucid.co/product-questions-3/legacy-lucidscale-documentation-13861). A cloud frame "automatically turns cloud infrastructure data imported from AWS, Azure, or Google Cloud into an interactive diagram"; one cloud frame per document, many views per frame (https://help.lucid.co/hc/en-us/articles/49028445463060-Use-cloud-frames-to-visualize-cloud-infrastructure-in-Lucidchart).

### 2. Layout engine: what makes the auto-generated layouts good

Lucid does not publish its algorithm, but the exposed controls describe it precisely, and the description matches the brief's hypothesis. From the cloud frames article (https://help.lucid.co/hc/en-us/articles/49028445463060-Use-cloud-frames-to-visualize-cloud-infrastructure-in-Lucidchart):

- Structure is a chosen containment hierarchy, not a graph. Under Layout > Current view > Structure you "+ Add Group" from a provider-specific list. AWS: Accounts, Regions, VPCs, Availability Zones, Security Groups, ECS Clusters, Subnets. Google Cloud: Projects, Networks, Subnetworks, GKE Clusters, Node Pools, Instance Groups. Azure: Subscriptions, Resource Groups, Virtual Networks, Subnets. The order you add them is the nesting order.
- Inside each container the layout is a grid. Container layout options: "adjust grid settings (spacing, number of columns, sort order)", "group non-contained resources into columns", "Group resources by type", and reorder groups. Resource options: "Summarize shapes" (collapse all resources of a type into one badge-labelled shape), display position, and which text fields show.
- Edges are opt-in. "Lines show relationships between resources. Toggle them under Layout by checking or unchecking a category", per line type, and "a line appears only when both connected resources are visible". Summarised resources hide their lines.
- Views are named combinations of structure, filter, and layout over the same data; new documents open in "Summarized Infrastructure"; templates include Summarized, Condensed, Resource inventory, Security, Compliance, Cost savings, Detailed infrastructure, VPC topology, Serverless, ECS, Shared network infrastructure, GKE clusters. Views can be exported and imported as configuration.
- Filters hide resources by rule ("For" resource type, "If" conditions or a formula, "Apply to all views"); filtering a container hides its contents. Conditional formatting recolours by metadata without hiding.
- Template views use automatic layout; manual-layout views let you drag containers and resources from the Cloud resources panel, and you choose auto or manual when duplicating a view.

So the recipe that makes Lucidscale output readable is: pick a containment hierarchy by meaning, pack each container's children in a sorted, typed grid with consistent icon size, collapse repeats into counted badges, draw almost no edges by default, and let the user turn on exactly the relation categories that tell the story. Lucid markets this directly as going "from overwhelming and useless to focused and actionable" by filtering and saving views (https://lucid.co/blog/cloud-architecture-custom-views). A community thread notes the hierarchy only renders when the data supports it (adding Availability Zones did nothing in an unsupported region) (https://community.lucid.co/product-questions-3/how-can-i-use-lucidscale-to-create-a-aws-vpc-diagram-5208).

Lucidchart proper has "Assisted Layout": content "organized into an adjustable grid pattern within Frames, Containers, and swim lanes, automatically adjusting space as needed", a Tidy Up for bulk selections, a hierarchy auto-layout for org charts and sitemaps whose line attachment cannot be changed, and no way to keep auto layout inside page margins (https://community.lucid.co/ideas/how-are-you-using-assisted-layout-12540, https://community.lucid.co/product-questions-3/how-to-get-auto-layout-to-stay-within-margins-4007). Line routing "automatically finds the best route for a line to take between two shapes, so there isn't any overlap" (https://lucid.co/blog/11-lucidchart-features-to-increase-productivity). A user complaint: "auto layout messes up line connecters" (https://community.lucid.co/product-questions-3/auto-layout-messes-up-line-connecters-918).

### 3. Interactivity

Cloud frames: views, filters, conditional formatting, collapse/expand containers, resource metadata under Data, line toggles by category, shared links with per-view visibility, and Cloud Version Compare for drift between syncs (legacy doc titles at https://community.lucid.co/product-questions-3/legacy-lucidscale-documentation-13861). Lucidchart: layers, hotspots and links, presentation mode.

### 4. Agent / LLM friendliness

Lucid AI generates flowcharts, mind maps, ERDs, class, sequence, and BPMN diagrams from a prompt, reached via the sparkles icon or right-click, with prompt enhancement and file attachment; "all AI-generated diagrams will automatically have assisted layout features applied" (https://lucid.co/blog/lucid-ai-features, https://help.lucid.co/hc/en-us/articles/30324063850516). A Lucid Custom GPT in ChatGPT returns an editable Lucidchart diagram (https://lucid.co/marketplace/f4db4a1f/lucid-custom-gpt). Lucid says AI is available to all users now "but may be subject to a paid subscription model in the future" (https://lucid.co/create/ai-diagram-generator). A May 2025 community post reports little luck getting even basic output for a custom-styled format (https://community.lucid.co/product-questions-3/can-you-train-the-lucid-ai-chatbot-10595). There is no public MCP; the only programmatic write path is Standard Import (create-only). No cloud-frame API was found.

### 5. What it does well

The best-looking auto-generated cloud diagrams in the field, because the layout is containment plus grid plus optional lines, not graph layout. Views as saved structure+filter+layout. Summarise-by-type badges. Conditional formatting. Multi-cloud (AWS, Azure, GCP; Cloudcraft lacks GCP, https://lucid.co/alternative/lucidscale-vs-cloudcraft).

### 6. Where it fails and why

- It only works from live cloud data. You cannot write a Lucidscale model by hand or from code; the recipe is locked to imported inventories.
- It is a cloud inventory view, not a software architecture view. Application-level relations (service calls, queues) are not first-class.
- Lucidchart's AI is flowchart-shaped Mermaid-grade output plus assisted layout; no story-telling layout for architecture.
- Closed, per-seat SaaS; Lucidchart Individual roughly $7.95 to $9 per month and Team $9 to $10 per user per month on annual billing, Enterprise quoted; Lucidscale/Cloud Accelerator has no public list price (https://www.larksuite.com/en_us/blog/lucidchart-pricing, https://www.brex.com/tools/charge-finder/lucid-software; verify on https://lucid.app/pricing/lucidchart, which did not render for me).

### 7. License and maturity

Proprietary SaaS. Lucidscale as a separate product is being retired into Lucidchart cloud frames (legacy docs page above). Standard Import API is stable but create-only.

### 8. Ideas to steal

This is the single most important set in this section:

- Structure as an ordered list of containment groups chosen by the author ("Add Group": Account > Region > VPC > AZ > Subnet), with the engine nesting by data.
- Per-container grid policy: column count, spacing, sort order, group by type, group order.
- "Summarize shapes" into a single badge with a count.
- Edges off by default, toggled per relation category, and only drawn when both ends are visible.
- Views = structure + filter + layout over one model, exportable as configuration.
- Conditional formatting by metadata as a layer on top of layout.

---

## Cloudcraft (Datadog)

### 1. Language / model

Cloudcraft is a closed web app. A "blueprint" holds a diagram, a budget, and documentation. The REST API (rate limit 20 requests per 10 seconds) lists and manages blueprints and AWS accounts with team/customer access lists, and third-party catalogues describe snapshotting a connected account to PNG, SVG, JSON, or MxGraph (https://docs.datadoghq.com/cloudcraft/api/, https://jentic.com/apis/api.cloudcraft.co/cloudcraft). Components carry separate colours for 2D and 3D views; an Icon component's 2D/3D projection toggle only applies "when the diagram itself is in 3D view" (https://docs.datadoghq.com/cloudcraft/components-common/icon/). Export to Terraform existed via a third-party path (modules.tf) and was removed: the feature "relied on a third-party provider, which limited our ability to support and improve its capabilities" (https://docs.datadoghq.com/cloudcraft/faq/why-cant-export-diagram-to-terraform/); the related open-source `modules.tf-lambda` was last pushed 2021-08-20. Enterprise admins can disable export to Draw.io and Modules.tf (https://docs.datadoghq.com/cloudcraft/faq/restrict-export-options/).

### 2. Layout engine

Isometric grid, manual placement, plus an "Auto layout" that reads the account. From the getting-started guide: connect AWS or Azure, pick account and region, "Scan now", then "Auto layout adds all scanned components with their connections" with Replace / Include / Leave existing components, or "Filtered layout" by tag (`Environment=demo`) or state (`ec2 !running`). "Components are placed within VPCs, subnets, and security groups"; a resource with no API link to the network (a WAF with matching tags) "sat outside the VPC" (https://docs.datadoghq.com/cloudcraft/getting-started/create-your-first-cloudcraft-diagram/). The September 2024 "Live experience" rewrote the engine: group by region, VPC, subnet, security group, and NACL for AWS (region, VNet, subnet for Azure), multiple regions on one diagram with cross-region links (VPC peering, Transit Gateway), saved presets, tag filters (https://blog.cloudcraft.co/produce-clear-easy-to-understand-diagrams-instantly-with-cloudcrafts-new-live-experience/). Internals are not published. From the published controls the model is the same recipe as Lucidscale: containment groups chosen from the network/security perimeter, packing inside, and service-dependent connections ("How components connect to each other is service dependent").

### 3. Interactivity

Live mode keeps the diagram in sync with the account ("if you remove an EC2 instance from your AWS account, the change will be reflected"); Snapshot freezes it. Selecting a component opens a live feed of its current data; Datadog integration overlays monitors, logs, cost, and security (https://www.cloudcraft.co/pricing). 2D/3D toggle.

### 4. Agent / LLM friendliness

No AI generation, no MCP, no text format. The blueprint JSON is importable only through the API and is not documented as an authoring format.

### 5. What it does well

The isometric look is distinctive and sells well in slides; live sync; cost overlay; grouping by network perimeter.

### 6. Where it fails and why

- AWS and Azure only, no GCP.
- No code path; no software-architecture semantics.
- Isometric projection makes long edges and label placement worse, not better; it is a presentation style, not a layout aid.
- Terraform export removed.

### 7. License and maturity

Closed. Pricing page now says Cloudcraft is "free with any Datadog subscription, with unlimited users and unlimited diagrams"; old listings showed Pro at $49 per user per month (https://www.cloudcraft.co/pricing, https://www.g2.com/products/cloudcraft/reviews). Acquired by Datadog (https://www.datadoghq.com/blog/introducing-cloudcraft/).

### 8. Ideas to steal

- Grouping presets (security preset = security groups, network preset = subnets) as named structures.
- "Leave existing components" on re-layout: incremental layout that respects what the human already placed.
- Live-data overlays on a stable layout.

---

## Isoflow and FossFLOW (and Arcentry)

### 1. Language / model

Isoflow is a React component for isometric network diagrams with a documented JSON `initialData`: `icons` (`id`, `name`, `url`, `collection`, `isIsometric`), `colors`, `items` (`id`, `name`, markdown `description`, `icon`), and `views`, where each view has `items` (a `ViewItem` with a `tile: { x, y }` and `labelHeight`), `rectangles` (`from` and `to` tile corners, colour), `connectors` (`anchors` with `ref` to a `tile` or an `item`, style SOLID | DOTTED | DASHED, `width`), and `textBoxes` (https://isoflow.io/docs/api/initialData). Validation throws on dangling references, a rectangle with `from` but no `to`, or a connector with fewer than two anchors. Notably the model already separates items from views: one item can appear in many views at different tiles. Icons come from `@isoflow/isopacks` (AWS, Azure, GCP, Kubernetes) (https://github.com/markmanx/isoflow).

### 2. Layout engine

None. Every item has a tile. Rectangles are drawn regions, not containers; nothing is nested in the data. Connectors run tile to tile through anchor waypoints with no obstacle avoidance documented.

### 3. Interactivity

Pan, zoom, multiple named views, item descriptions in markdown, export as JSON and image (https://isoflow.io/docs).

### 4. Agent / LLM friendliness

The JSON is small and regular, so an LLM can emit it; a community "fossflow-diagrams" skill exists (https://claudskills.com/skills/fossflow-diagrams/SKILL.md). The LLM must pick tiles, and isometric tiles make "left-to-right flow" ambiguous.

### 5. What it does well

Pretty isometric output from a tiny model; items-versus-views separation; MIT.

### 6. Where it fails and why

No layout, no containment, no edge routing. Upstream Isoflow is open-core (Isoflow Pro for commercial use) and its GitHub pushed last on 2025-09-17 (1,729 stars, MIT). FossFLOW, the PWA built on it, was at stan-smith/FossFLOW with about 19.6k stars in April 2026 per Star History (https://star-history.com/stan-smith/fossflow), but that repository returns 404 from the GitHub API today; a continuation lives at Abrar74774/FossFLOW (225 stars, MIT, pushed 2026-10-07, description "A continuation of stan-smith/FossFLOW"). Sources disagree on FossFLOW's license (README said Unlicense, mirrors and forks say MIT) (https://github.com/akx/FossFLOW, https://ostechnix.com/create-isometric-diagrams-fossflow/). Treat the project as community-maintained with an unclear canonical home. Arcentry, the earlier commercial isometric tool, shut down in 2020 per a competitor's post (https://www.hava.io/blog/arcentry-alternative).

### 7. License and maturity

Isoflow MIT (community edition). FossFLOW MIT or Unlicense depending on fork. Isopacks under their own icon licences.

### 8. Ideas to steal

- The `items` versus `views` split with per-view placement; it is the cheapest multi-perspective model in this survey.
- Validation that names the dangling reference.

---

## Eraser.io (DiagramGPT, Eraser AI)

### 1. Language / model

Eraser has a real diagram-as-code DSL with four types selected by the first line of a `.eraserdiagram` file: `cloud-architecture-diagram`, `sequence-diagram`, `flowchart-diagram`, `entity-relationship-diagram` (https://docs.eraser.io/docs/using-the-vs-code-extension). The architecture syntax (https://docs.eraser.io/docs/architecture-diagram-syntax):

```
direction right
VPC Subnet {
  Main Server [icon: aws-ec2, color: blue] {
    Server [icon: aws-ec2]
    Data [icon: aws-rds]
  }
}
Storage [icon: aws-s3]
Storage > Server: Cache Hit [color: green]
Server > Worker1, Worker2, Worker3
legend {
  [connection: -->, label: Async]
  [icon: aws-lambda, label: Lambda]
}
```

Nodes are `name [icon: aws-ec2, color: blue, label: "x", link: "..."]`; groups are `name { }` and nest; connectors are `>`, `<`, `<>`, `-`, `--`, `-->` with `: label` and one-to-many on the right side; node-to-group and group-to-group edges are allowed; undefined names in a connection create blank nodes; `direction up|down|left|right` (default right); diagram-level `colorMode pastel|bold|outline`, `styleMode shadow|plain|watercolor`, `typeface rough|clean|mono`, `wrap on|off`; legends with position. Icons span AWS, GCP, Azure, tech logos, general. There are no views; one file, one picture.

### 2. Layout engine

Not published. Eraser says only "Layout is handled for you" (https://www.eraser.io/use-cases) and the syntax page documents `direction` as the only layout control. The output looks layered (ranked in `direction`) with groups drawn as clusters around their members, which is consistent with a dagre or ELK layered run over a compound graph (a guess from appearance; no source confirms the engine). Eraser's own FAQ says the team "is working to improve accuracy and layout customization" (https://www.eraser.io/git-diagrammer). Manual nudging requires signing in to the app.

### 3. Interactivity

Rendered in Eraser docs or VS Code; zoom; links on nodes via `link`; no collapse, no views.

### 4. Agent / LLM friendliness

This is Eraser's whole pitch. DiagramGPT generates from prompts or pasted code; Git Diagrammer generates from a GitHub repo (public, or private with an account) and recommends file-scoped prompts like "Draw a cloud architecture diagram from .tf files in /deployments/dev" (https://www.eraser.io/git-diagrammer). Agent integrations for Claude Code, Cursor, and Windsurf as an MCP server or agent skills call Eraser's API and return rendered images, editable afterwards as DSL (https://docs.eraser.io/docs/using-ai-agent-integrations). AI defaults to "freeform" output unless the team format is set to Code (DSL) (https://docs.eraser.io/docs/cloud-architecture-diagrams). The DSL is the tersest cloud-architecture syntax in this survey and the easiest for an LLM to emit correctly: no coordinates, no ids, nesting by braces, icons by name.

### 5. What it does well

Syntax design: braces for groups, bracket properties, bare `>` edges, `direction`, legends, `colorMode`/`styleMode` as whole-diagram themes. Repo-to-diagram. Agent integrations.

### 6. Where it fails and why

- Layout is a black box with one knob. When a group is big, edges from outside enter it at arbitrary points; long edges across ranks appear; there is no per-group layout policy, no grid packing, no edge-category toggles. Eraser's own FAQ concedes layout customisation is the open issue.
- No views, no model reuse; every diagram is its own text.
- API only on paid plans: Free $0 with 3 files and 3 AI credits; Business $45 per member per month annual or $60 monthly with 100 AI credits; Business Plus $42 annual, 10-seat minimum, 250 credits; Enterprise custom (https://www.eraser.io/pricing).

Holistics: I found no "Diagram GPT" product from Holistics. The only Holistics diagram feature is the 2023 Relationship Diagram in Holistics As-Code (https://docs.holistics.io/release-notes/2023-05-er-diagram). The generic "DiagramGPT" name belongs to Eraser.

### 7. License and maturity

Closed SaaS. The DSL is proprietary; there is no open renderer.

### 8. Ideas to steal

- The syntax almost wholesale: `name [icon: x, color: y] { children }`, `A > B: label`, `A > B, C, D`, `direction`, legends, theme keywords.
- "Names must be unique, labels can repeat" as a rule.
- Auto-creating a blank node for an undefined name is a nice forgiveness rule for LLM output, though it hides typos; a product should at least warn.

---

## Figma FigJam AI and Miro AI (short)

FigJam AI "Generate boards and diagrams" and Jambot are paid-plan features (Professional, Organization, Enterprise, Education), with the usual "AI results may be inaccurate" caveat (https://help.figma.com/hc/en-us/articles/23870272542231). The Figma MCP server's `generate_diagram` tool takes Mermaid syntax and produces an editable FigJam diagram; supported types are flowchart, sequenceDiagram, stateDiagram, gantt, erDiagram; unsupported include mindmap, class, C4, gitGraph; `classDef`/`class` styling is stripped (https://www.skills.sh/figma/mcp-server-guide/figma-generate-diagram). Whether the in-app prompt box also goes through Mermaid is not documented by Figma; the MCP path is confirmed Mermaid. So FigJam's layout quality is Mermaid's.

Miro AI generates flowcharts, process maps, org charts, architecture diagrams, user journeys, mind maps, and network diagrams from text on a credit system; Miro also has a Mermaid editor whose diagrams "use Miro's native auto-layout" and must be converted to free-form to move shapes (https://miro.com/ai/diagram-ai/ai-diagramming-generator-from-text/, https://help.miro.com/hc/es/articles/7004628130962-Crear-diagramas-Mermaid-Beta). A June 2026 community post says exporting Mermaid from Miro AI diagrams errors (https://community.miro.com/ideas/export-mermaid-code-from-diagrams-and-sequence-diagrams-using-miro-ai-28477). Both products are whiteboards with a Mermaid import; neither has a containment-first layout.

---

## Brief notes: Whimsical, Gliffy, Creately, Visio, OmniGraffle, D2 Studio

- Whimsical: a ChatGPT app invoked with `@whimsical` makes flowcharts, mind maps, wireframes, and sequence diagrams from the conversation and opens them in Whimsical; the older Diagrams GPT plugin is retired; in-app AI uses OpenAI with 100 AI actions per editor on Starter (https://whimsical.com/integrations/chatgpt, https://openai.com/business/plugins/whimsical/, https://help.whimsical.com/article/725-getting-started-with-whimsical-ai). Flowchart-grade layout.
- Gliffy (Confluence): "Create with AI" uses a distilled gpt-4o-mini, supports flowcharts, UML sequence, and class diagrams, outputs a template you refine in a Mermaid editor, no conversational refinement; launched April 30, 2025 (https://help.gliffy.com/confluence/Content/GliffyConfluence/gliffy-ai-faq.htm). Mermaid underneath.
- Creately: "Creately VIZ" generates from prompts and converts between diagram types (mind map to Kanban), paid plans only, template-based per review sites (https://creately.com/guides/ai-diagrams, https://creately.com/lp/viz/ai-flowchart/).
- Microsoft Visio: Data Visualizer built basic, cross-functional, and org flowcharts from Excel tables; Microsoft retired the add-in in March 2026 (https://support.microsoft.com/office/bee3b5aa-aaaf-4401-acc6-276b711c763c). Visio's own layout engines remain under Design > Layout > Re-Layout Page: Flowchart, Hierarchy, Compact Tree, Radial, Circular, applied to the selection or whole page (https://support.microsoft.com/en-US/Visio/re-layout-a-diagram-in-visio). Visio Plan 2 needed to edit.
- OmniGraffle: scriptable with Omni Automation (JavaScript Core) and a Mac AppleScript dictionary. `canvas.layoutInfo` exposes `automaticLayout`, `type` (LayoutType: Hierarchical, Circular, Radial, ForceDirected), `direction` (HierarchicalDirection: Top, Bottom, Left, Right), `objectSeparation`, `rankSeparation`, `circularLineLength`, `radialSeparation`, `forceDirectedLineLength`, `forceDirectedSeparation`; `canvas.layout()` and `canvas.layoutGraphics(graphics)` run it (https://omni-automation.com/omnigraffle/OG-API.html). A third-party MCP ("OmniGraffle BindCraft") wraps it (https://glama.ai/mcp/servers/Youn-17/omnigraffle-bindcraft). Mac only, layouts are the classic four.
- Terrastruct D2 Studio and TALA: Terrastruct is shutting down; D2 moved to Hack Club as a non-profit on 2026-09-05; D2 Studio (the closed IDE) "will be purely client-side, usable completely offline" and is to be open-sourced (https://d2lang.com/blog/d2-non-profit/). TALA, previously closed and watermarked without a key, was released under MPL-2.0 on 2026-09-07 bundled in D2 v0.9.0, enabled with `--layout=tala` (https://zeli.app/story/49604150, https://ecosistemastartup.com/?p=105463; secondary sources, verify against D2 release notes). TALA is covered in the D2 section of this survey; the relevance here is that the one layout engine purpose-built for nested software architecture boxes is now free to study and fork.

---

## Cross-cutting conclusions for the new product

1. No canvas SDK lays out. Excalidraw, tldraw, Isoflow, and the whiteboards all make the LLM compute pixels, and their AI features reduce to "generate Mermaid, convert". The one exception, draw.io, bolts ELK and libavoid onto a flat model and lets containers opt out, which is exactly why its nested diagrams do not tell a story.
2. The two products whose automatic output people actually like (Lucidscale cloud frames, Cloudcraft Live) do not run a graph layout at all. They choose a containment hierarchy, pack each container in a typed, sorted grid, collapse repeats into counted badges, and draw edges only on request. That recipe is the thing to build, generalised from cloud inventory to any model with types and parent relations.
3. The LLM-facing syntax to copy is Eraser's (braces, bracket properties, bare `>` edges, `direction`, legends), with Isoflow's items-versus-views split and Lucid's view = structure + filter + layout on top.
4. Edge routing should be a separate, position-preserving pass (draw.io's libavoid mode; Excalidraw's elbow-arrow goals as the acceptance criteria).
5. The agent loop to copy is tldraw's: typed action schemas, sanitise before apply, stream, lint the result back to the model, and a screenshot in context (Excalidraw MCP does this too).
6. Licensing: Excalidraw MIT, draw.io and maxGraph Apache-2.0, Isoflow MIT, TALA now MPL-2.0; tldraw is source-available with a mandatory key and watermark and is unsuitable as the base of a free product.
