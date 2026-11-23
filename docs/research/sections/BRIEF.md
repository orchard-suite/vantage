# Shared brief for field-survey section researchers

Context: we are researching for a NEW diagramming product. Goal: a code-first ("diagram as code") language
that AI agents can author easily, producing interactive, multi-perspective software and cloud-infrastructure
diagrams whose LAYOUT QUALITY matches what a skilled human would draw in Lucidchart (clean, story-telling,
flow reads left-to-right/top-to-bottom, grouped by boundary/nested boxes, aligned, no spaghetti), plus
flowcharts and sequence diagrams. The owner loves Ilograph (interactive, multi-perspective, nested-box
layouts) and hates every other code-to-diagram tool because they "always have terrible layouts, hard to read,
don't paint a picture or tell a story; they turn out like hierarchy graphs or flow charts."

For EACH tool you are assigned, research with WebSearch (use mode "extended" when a standard result is thin)
and WebFetch (official docs, GitHub README/source, issues, blog posts, HN threads, papers). Cover:
1. Language / model design (syntax sample of ~5-10 lines if code-based; how nesting/containers, edges,
   styles, views/perspectives are expressed).
2. Layout engine and algorithm (what engine, which algorithm family, hierarchy/compound handling, edge
   routing, port constraints, grid, manual positioning hooks).
3. Interactivity (zoom, collapse/expand, multiple views, hover, links, navigation).
4. Agent / LLM friendliness (how learnable/terse the syntax is, whether an LLM reliably emits valid code,
   APIs/MCP servers, validation/error messages, deterministic output, known LLM failure modes).
5. What it does well.
6. Where it fails and WHY -- be specific about LAYOUT failure modes (e.g. long edges across layers, nodes
   placed by rank not by meaning, containers blowing up, edge spaghetti, labels colliding, no flow story,
   random ordering between runs, poor compound-graph handling, etc.). Quote GitHub issues / user complaints.
7. License (exact SPDX if open source; commercial terms otherwise) and maturity (stars, release cadence,
   maintainers, last release).
8. Notable ideas to steal.

Rules:
- Cite URLs inline for every factual claim. Verify facts by fetching; label guesses as guesses.
- Be concrete and exhaustive. Prefer specifics (algorithm names, option names, issue numbers) over
  generalities.
- No em-dashes or en-dashes; use commas or periods.
- Write your output as Markdown to the file path you were given (one file). Use `## <Tool name>` as the
  heading for each tool and `### 1. Language`, `### 2. Layout` ... subheadings. Aim for 150-400 lines per
  tool depending on importance.
- When done, reply with a short (10 line) summary of the most important findings. Do not paste the file.
