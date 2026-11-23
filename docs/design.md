# Design

## The problem, stated precisely

A diagram is a picture that tells a story. Code-to-diagram tools produce
pictures that list facts. The gap is not the renderer, the icons, or the
language. It is that the layout has no idea what the story is, and the
author has no channel to tell it that survives a relayout.

The research in `research/` looked at every tool in the space, the layout
engines under them, the academic work on what makes a diagram readable, and
the way agents fail when they write diagrams. The findings that shaped this
design:

1. **Every open source code-to-diagram tool runs a Sugiyama layered engine
   with containers bolted on.** D2's default, Mermaid, PlantUML, Structurizr,
   LikeC4, diagrams. Nodes land by graph rank; boxes get drawn around them.
   That is why they all look like dependency graphs.
2. **The auto layouts people like use no graph layout at all.** Lucidscale
   and Cloudcraft pick a containment order, pack each container as a sorted
   grid, collapse repeats into counts, and keep edges off until asked.
3. **Ilograph's cleanliness is a rule, not an algorithm.** A view shows the
   participants of its relations and their ancestors, nothing else. Its
   engine orders siblings by first mention in the file and has no crossing
   minimisation, so authors reorder YAML to fix pictures; cycles lose their
   edges; routing is "bow the curve and fade it"; layout depends on the
   window size; text is shrunk after layout.
4. **Humans want flow, grouping, and alignment** (Storrle 2011, 2014; HOLA
   2016): entry on one side, exit on the other, peers aligned, trees on the
   outside, straight lines where the eye follows. yFiles is best in class
   because of extra passes for exactly these: integrated labels, bus routing,
   group insets, critical path straightening, swimlanes, stability.
5. **Textual order is intent** (Domrös 2022 to 2024). Use it as the
   tiebreaker in every phase and the author can always steer.
6. **Agents must never emit coordinates.** LLM placement collapses above
   fifteen elements. The proven pipeline is: structured model, deterministic
   compile, feedback loop with metrics and a picture.

## What Vantage does about it

### Model and views

One model, many views, Ilograph's visibility rule. The model is a tree of
nodes (every container is a boundary with meaning) and a list of tagged
relations. A view selects relations by tag, by id, or inline, inherits from
other views, and may collapse, expand, hide, or deepen. What is drawn is the
participants and their ancestors; hidden siblings become a count badge.

### The compositor

There is no global graph layout. Each visible container lays out its own
children with an arrangement:

- **flow** when the children have relations among themselves. A layered
  layout per container: cycles broken by a greedy feedback arc set and the
  reversed arrows drawn as back edges; longest-path layering, then sinks
  pulled next to their predecessors unless they are exits or stores; children
  that receive from outside the container pulled to the first layer and
  children that send out pushed to the last; isolated children placed by
  their type role; barycenter sweeps and a transpose pass to reduce
  crossings with the author's order as the tiebreaker; a straightening pass
  that pulls each child toward the centre of its neighbours.
- **grid, row, column** when they do not. Uniform cells, sorted by the
  author's order.
- **gestures** when the sentence has another shape (`arrange/gesture.ts`):
  `mirror` sets halves face to face by flipping the direction of every other
  child; `ring` puts one child in the middle of an ellipse of the others;
  `outline` stacks and indents like a tree; `matrix` places by two tag axes
  with axis labels and dividers; explicit `layers` pin children to tiers of
  a flow.
- hints per container override any of it: `as`, `direction`, `columns`,
  `order`, `layers`, `center`, `matrix`, `divider`, `gap`, `align`.

### The story pass

Boxes carry content beyond a name: `facts` (label and value lines), one big
`value`, `bullets`, a presentation `size` (compact, large, icon-only), and a
`note`. After boxes are placed, `story.ts` pins notes and callouts beside
their boxes on the least busy side and registers them as obstacles so arrows
go around them; frames highlighted sets (members are kept adjacent by the
compositor, and a set across two containers draws across both); marks path
steps with numbered badges along the arrows and colors the arrows; writes
prose annotations, the path narrative, and the legend under the picture.
`page.ts` composes several views with headings and prose on one canvas. None
of these is a diagram type. They are primitives; the guide maps the shape of
a sentence to the primitive and the author combines them.

### Taste as search

`explore.ts` lays a view out several ways (the other direction, the biggest
container flowing the other way, as a grid, mirrored, as a ring, or
collapsed), scores each, and the server renders them into one captioned
contact sheet. The agent chooses by eye and pastes the hints. The engine
proposes; the author decides.

Sizes come bottom-up from measured text (Inter advance widths) and children;
positions go top-down. Layer gaps grow to fit the widest label between two
layers, so labels never clip.

### Edges

Relations lift: when several children of a container talk to the same box
outside with the same label, one arrow is drawn from the container with a
"3 of 4" note and the members are kept for hover. Relations between the same
visible pair bundle. Ports are chosen per direction (forward edges leave the
flow-facing side), spread along the side, and sorted by the far end so edges
never cross at the box. Routing is orthogonal A* over a sparse grid of box
edges, centres, and ports, with a bend penalty, a heavy penalty for passing
through a box, a lighter one for passing through a foreign container, and a
corridor penalty that keeps routes in the middle of gutters. Labels sit on
the longest segment and slide to avoid boxes and other labels.

### Quality loop

Every layout returns metrics: crossings, bends, arrows through boxes, label
overlaps, back edges, unconnected boxes, area, aspect ratio, and a score
with notes written for an agent. The MCP render tool returns the PNG with
the notes, so the agent looks, reads, and iterates. Never does the tool
delete content to improve a number.

### Viewer

The SVG carries data attributes; the viewer adds a grouped picker, pan and
zoom, hover highlighting of neighbours, click focus by reachability (dim the
rest), a side panel with description, relations, and cross-view links,
walkthroughs with camera moves, URL state, light and dark, and morphing
transitions between views because ids are stable. Exports are deterministic
SVG and PNG from the same layout, and a single HTML file with everything
inside.

### Look

The chrome, the hub pages, and the picture share one set of tokens
(`packages/render/src/tokens.ts`). The look is a drafting room: stone
neutrals so the canvas reads as paper and the colored families stay the only
hue in the picture; one ink accent, a Prussian blue, for the selected thing
and the primary action; technical values (facts, counts, eyebrows, keys) in
monospace, like a drawing's title block; hairlines and soft shadows for
depth; a faint grid of plus marks on the canvas. Light and dark are tuned
separately: dark is warm graphite, not an inversion. Every text color clears
WCAG AA on every surface it sits on, and the render tests hold that line for
the picture.

## What is deliberately not here

- No free-form canvas and no manual coordinates. Author control is through
  order, hints, and views.
- No second layout engine. ELK and TALA were considered and are documented
  in the research; their constraint vocabularies informed the hints, but the
  compositor is small enough to own and that is what makes the output
  predictable.
- No LLM in the layout path.

## Where to push next

- Mental-map preservation across views: anchor a node near where the previous
  view had it when both views are close.
- Free placement for notes that should float in empty canvas rather than
  hug a box.
- Sequence diagrams: lifeline destruction, parallel fragments in columns.
- An ELK-backed `as: layered` option for very large, flat containers.
