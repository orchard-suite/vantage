# Field survey: diagram-as-code tools, layout engines, and the literature on good architecture diagrams

Research date: 2026-10-26. Prepared for a new code-first diagramming product whose target is Ilograph-grade interactive, multi-perspective, nested-box diagrams with Lucidchart-grade layout, authored by AI agents, plus flowcharts and sequence diagrams.

How this report was built: six parallel research passes (D2/Mermaid/PlantUML; Ilograph and C4 tools; layout engines; canvas and commercial cloud products; niche DSLs and infra visualizers; academic literature) plus a direct verification pass over npm, GitHub, and the ELK docs. Every factual claim cites a URL inline. Guesses are labelled. Where two passes disagree the discrepancy is noted in Part 9.

Two headline facts that change the landscape as of this month:

1. TALA, the one layout engine purpose-built for nested software architecture boxes, went open source under MPL-2.0 on 2026-09-07 and is bundled in D2 v0.9.0 (https://d2lang.com/blog/tala-is-open-source/). Terrastruct is shutting down; D2 is now a Hack Club non-profit with one part-time maintainer (https://d2lang.com/blog/d2-non-profit/).
2. draw.io has replaced its legacy auto layouts with Eclipse ELK and added libavoid orthogonal routing as a position-preserving pass, exposed through a JSON layout spec (https://www.drawio.com/docs/reference/json-layout-specification/). Mermaid 12 made ELK its default engine. elkjs plus libavoid-js is therefore a production-proven browser stack.

## Contents

- Part 1. D2, Mermaid, PlantUML
- Part 2. Ilograph, Structurizr DSL, LikeC4, IcePanel, Multiplayer
- Part 3. Layout engines: Graphviz, ELK, dagre, yFiles, Cytoscape.js, others
- Part 4. Canvas SDKs, AI diagram generators, commercial cloud-diagram products
- Part 5. Niche DSLs, ASCII tools, Terraform and Kubernetes visualizers, icon standards, Wardley, ArchiMate
- Part 6. Academic and algorithmic survey (aesthetics, layered layout, constraints, routing, compound graphs, LLM diagram generation)
- Part 7. Verified TypeScript library landscape and the ELK options that matter
- Part 8. Synthesis: (a) what makes a diagram good or bad, (b) what makes diagram-as-code good or bad for agents, (c) ranked ideas to combine, (d) library recommendation
- Part 9. Discrepancies and open questions

