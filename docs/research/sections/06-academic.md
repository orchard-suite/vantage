# 06. Academic and algorithmic literature survey

Scope: what the graph-drawing, HCI, and LLM literature says about producing architecture diagrams whose
layout reads like a skilled human drew it, and which pieces compose into a TypeScript layout engine.

Conventions. Each entry gives title, authors, year, venue, URL, what it contributes, and how a TypeScript
engine would use it. "Verified" means I fetched the paper or page. "Abstract only" means I confirmed the
bibliographic record and abstract but not the body. "Unverified" means a search-result summary I could not
fetch; treat those claims as guesses. Note: the web search budget for this session ran out partway through
section F, so some G items rest on fetches of known URLs rather than fresh searches; gaps are flagged.

---

## A. Diagram aesthetics and readability

### A.1 Purchase, "Which aesthetic has the greatest effect on human understanding?" (GD 1997)

- Helen C. Purchase. Graph Drawing 1997, LNCS 1353, pp. 248-261.
  https://eprints.gla.ac.uk/35804 (verified, abstract).
- Tested five aesthetics on abstract graphs: edge crossings, bends, symmetry, minimum angle between
  edges at a node, orthogonal grid placement. Result: reducing crossings is "by far the most important";
  bends and symmetry have a lesser effect; minimum angle and orthogonal grid had no statistically
  significant effect.
- Caveat for us: these were small abstract graphs with meaningless labels, tested with path-finding tasks.
  Later work (Storrle, HOLA, Marriott 2012 below) shows orthogonality and alignment matter more for
  real notations and for recall. Do not read "grid had no effect" as "grid does not matter."
- Engine use: crossing count is the primary objective in any scoring function; bends and symmetry are
  secondary terms. The earlier companion paper is Purchase, Cohen, James, "Validating graph drawing
  aesthetics," GD 1995, LNCS 1027, pp. 435-446, https://eprints.gla.ac.uk/35822 (verified, abstract).

### A.2 Purchase, "Metrics for graph drawing aesthetics" (JVLC 2002)

- Helen C. Purchase. Journal of Visual Languages and Computing 13(5), 2002.
  https://innovis.cpsc.ucalgary.ca/innovis/uploads/Courses/InformationVisualizationDetails2009/Purchase2002.pdf
  (abstract only via search result).
- Defines seven aesthetics as normalized [0,1] metrics: edge crossings, bends, symmetry, orthogonality
  (node and edge), minimum angle, edge length uniformity (search summary; the exact seventh I did not
  verify).
- Engine use: this is the template for a "layout score" module. Normalize each metric to [0,1] so a
  weighted sum can compare candidate layouts across seeds (what TALA does, see E.9).

### A.3 Ware, Purchase, Colpoys, McGill, "Cognitive measurements of graph aesthetics" (Information Visualization 2002)

- Information Visualization 1(2), pp. 103-110.
  https://research.monash.edu/en/publications/cognitive-measurements-of-graph-aesthetics (verified, abstract).
- Introduces "good continuity" (multi-edge paths kept as straight as possible) as a neglected aesthetic.
  For shortest-path tasks, continuity and crossings were the two most important factors after path
  length; the number of branches on the path also mattered.
- Engine use: when routing a multi-hop flow (A to B to C), keep the segments collinear. In a layered
  layout this means prefer straight long edges (Brandes-Köpf does this, B.4) and align the nodes of a
  chain. This is also the formal basis for "the flow should read as one line."

### A.4 Huang, Hong, Eades on crossing angles (2008-2014)

- "Larger crossing angles make graphs easier to read" (Huang, Eades, Hong, JVLC 2014),
  https://figshare.utas.edu.au/articles/journal_contribution/Larger_crossing_angles_make_graphs_easier_to_read/22912889
  and "Effects of crossing angles" (PacificVis 2008) (abstract only).
- Eye-tracking: crossings at angles above roughly 70 degrees have little effect on reading; response
  time falls as angle rises and levels off near 90 degrees.
- Engine use: for orthogonal routing all crossings are 90 degrees, which is the main reason orthogonal
  routing reads well. If polyline routing is ever used, penalize shallow-angle crossings, not just the
  count. greadability.js hard-codes idealAngle = 70 for this reason (F.4).

### A.5 Bennett, Ryall, Spalteholz, Gooch, "The aesthetics of graph visualization" (Computational Aesthetics 2007)

- Eurographics Workshop on Computational Aesthetics 2007, pp. 57-64, DOI 10.2312/COMPAESTH/COMPAESTH07/057-064.
  https://diglib.eg.org/handle/10.2312/COMPAESTH.COMPAESTH07.057-064 (abstract only).
- Survey that ties each layout heuristic to its perceptual basis (Gestalt principles, Norman's emotional
  design) and its evaluation status. Useful as a checklist of which heuristics have evidence and which
  are folklore.
- Engine use: reference for the rule base; no algorithm.

### A.6 Gestalt principles and Sun & Wong, "On evaluating the layout of UML class diagrams for program comprehension" (IWPC 2005)

- Dabo Sun, Kenny Wong. IWPC 2005, pp. 317-326. Full text verified:
  https://www.cs.kent.edu/~jmaletic/cs69995-PC/papers/sun05.pdf
- Maps 14 concrete criteria onto Gestalt laws. Verified list:
  - Law of good figure: C1 join inheritance arcs; C2 represent association (label mid-arc); C3 be selective.
  - Law of similarity: C4 use colors to group.
  - Law of continuation: C5 minimize crossings and bends.
  - Law of proximity: C6 center parents over children; C7 reduce edge length (not too long, not too short).
  - Law of familiarity: C8 superclasses above subclasses.
  - Law of connectedness and contour: C9 avoid overlapping (edge over node, label over edge).
  - Law of symmetry: C10 improve symmetry.
  - Law of orientation: C11 choose vertical or horizontal orientation; C12 draw arcs orthogonally;
    C13 draw labels horizontally; C14 horizontal arcs for non-inheritance relationships.
- The paper notes criteria conflict (crossings vs bends) and that semantics (domain knowledge) should
  drive grouping, which tools ignore.
- Engine use: C6/C7/C8/C12/C13/C14 translate directly into constraints: parent centered over children
  (alignment constraint), edge length band (ideal edge length with upper bound), typed edges get a
  preferred direction, labels always horizontal. The "common region" Gestalt law (enclosure) is what
  nested containers exploit; the paper calls it contour.

### A.7 Storrle, "On the impact of layout quality to understanding UML diagrams" (VL/HCC 2011) and "Size matters" (MODELS 2014)

- Harald Storrle. VL/HCC 2011, pp. 135-142, DOI 10.1109/VLHCC.2011.6070390. Full text verified:
  https://backend.orbit.dtu.dk/ws/files/6282242/PID1910517.pdf
- MODELS 2014. Full text verified: https://backend.orbit.dtu.dk/ws/files/120654649/VL_4d_Size.pdf
- Why it matters: this is the one study that tests compound "good layout" (many heuristics at once) on
  realistic software diagrams (use case, activity, class), 78 subjects, rather than isolated metrics on
  abstract graphs. Earlier isolated-metric studies found tiny effects; Storrle found large ones.
- His four levels of layout rules (verified quote structure):
  1. General graphic design: no obscuring, Gestalt principles, readable text, alignment on a grid,
     sparing color and font variation.
  2. Graph rules: minimize crossings, bends, edge length.
  3. Notation rules: "diagrams with some inherent ordering of elements should maintain and highlight
     that ordering as visual flow"; introduce symmetry; join similar edges; align and group similar
     elements (subclasses grouped, aligned, inheritance arcs joined; decision branches aligned).
  4. Pragmatics: highlight by color, size, or position to serve "the message and telling whatever story
     the diagram designer intends to tell"; lower rules may be set aside for this.
- Fig. 1 of the 2014 paper labels the manipulated features. Elements of good layout: join/cluster similar
  elements, orthogonal arrangement, place elements in flow. Elements of bad layout: crossings and bends,
  overlapping/obscuring, variation of visual variables.
- 2011 results (verified table): correct answers +6.5%, wrong/missing -12.7%, perceived quality +31.3%,
  perceived clarity +28.2%, response time per answer -7.3%, per correct answer -17.4%. Novices and
  experts both benefit about +6.7%.
- 2014 results: effect of layout grows with diagram size; "small diagrams are easy to use anyway, so bad
  layout can be easily compensated. For larger diagrams... layout quality matters more." Conclusion:
  high layout quality is particularly helpful for large diagrams and low-expertise readers.
- Engine use: this is the strongest evidence for the brief's thesis. The features that worked are exactly
  "flow direction + grouping + alignment + orthogonality," not crossing count alone. Any engine for
  architecture diagrams should treat flow direction and grouping as first-class objectives, not
  post-processing.

### A.8 Eichelberger, "Aesthetics and automatic layout of UML class diagrams" (Dissertation, Wurzburg 2005) and Eichelberger & Schmid guidelines

- https://opus.bibliothek.uni-wuerzburg.de/frontdoor/index/index/year/2005/docId/1260 (abstract only).
- Combines aesthetic criteria from four disciplines into a hierarchical (Sugiyama-based) layout called
  SugiBib. Eichelberger & Schmid (2009) later published "Guidelines on the aesthetic quality of UML
  class diagrams" and found no significant comprehension effect from isolated criteria, which is what
  Storrle set out to explain.
- Engine use: confirms that a Sugiyama core with notation-specific rules (inheritance up, associations
  horizontal, labels horizontal) is the established design for software diagrams.

### A.9 Gutwenger et al., "A new approach for visualizing UML class diagrams" (SoftVis 2003)

- Gutwenger, Junger, Klein, Kupke, Leipert, Mutzel. SoftVis 2003, pp. 179-188.
  https://kups.ub.uni-koeln.de/54872/1/zaik2003-451.pdf (abstract verified).
- Criteria: crossing and bend minimization, uniform direction within each class hierarchy, no nesting of
  one hierarchy inside another, orthogonal layout, merging multiple inheritance edges, good edge labels.
  Implemented in GoVisual; treats directed and undirected edges together rather than in two phases.
- Related: Eiglsperger, Eppinger, Kaufmann, "An approach for mixed upward planarization," JGAA 7(2),
  2003, pp. 203-220, https://www.jgaa.info/index.php/jgaa/article/download/paper67/2901 (verified
  bibliographic; full text fetched but not read in depth). Mixed graphs: directed edges must point
  consistently, undirected edges are free.
- Engine use: typed edges. "Depends on" or "calls" edges carry flow direction; "associated with" or
  "shares DB" edges are free. The layering phase should only see the directed subset.

### A.10 Moody, "The Physics of Notations" (IEEE TSE 2009)

- Daniel L. Moody. IEEE Transactions on Software Engineering 35(6), 2009. Nine principles: semiotic
  clarity, perceptual discriminability, semantic transparency, complexity management, cognitive
  integration, visual expressiveness, dual coding, graphic economy, cognitive fit.
  https://homepages.uc.edu/~niunn/courses/RE-refs\PoN-RE09.pdf (search summary; principle list verified
  from secondary sources).
- Engine-relevant principles: complexity management (split into views, which is what perspectives do),
  cognitive integration (consistent cues across views, so a node must look and sit the same across
  perspectives), dual coding (icon plus text), perceptual discriminability (distinct shapes for distinct
  kinds). Criticism in later work: principles are unevenly operationalized.
- Engine use: cognitive integration argues for mental-map preservation across perspectives (A.14), not
  just across edits.

### A.11 Marriott, Purchase, Wybrow, Goncu, "Memorability of visual features in network diagrams" (TVCG 2012)

- IEEE TVCG 18(12), pp. 2477-2485. https://users.monash.edu/~mwybrow/papers/marriott-infovis-2012.pdf
  (abstract verified).
- Recall-and-redraw study. Symmetry, collinearity, and orthogonality strongly improved recall. Node
  alignment and parallel edges showed no significant effect in this task.
- Engine use: collinearity (chains in a straight line) and orthogonality are cheap and measurable; put
  them in the score.

### A.12 Label placement

- Christensen, Marks, Shieber, "An empirical study of algorithms for point-feature label placement,"
  ACM TOG 14(3), 1995, pp. 203-232. https://dash.harvard.edu/bitstream/1/2032678/2/AnEmpiricalStudy.pdf
  (abstract verified). Label placement is NP-hard; they compare greedy, gradient descent, simulated
  annealing; simulated annealing wins at modest cost.
- Kakoulis, Tollis, "On the edge label placement problem," GD 1997; "Edge labeling in the graph layout
  toolkit" (Dogrusoz, Kakoulis, Madden, Tollis, GD 1998); Kakoulis & Tollis "Algorithms for the multiple
  label placement problem" (2006) and "Modifying orthogonal drawings for label placement" (Algorithms
  2016, https://doaj.org/article/63977f0e53e34ee3b38e3b86027f2067). Edge label placement is NP-hard;
  the practical rule set (from Imhof's cartography principles): no overlap, unambiguous association with
  the edge, best among acceptable positions.
- Schulze, Wechselberg, von Hanxleden, "Edge label placement in layered graph drawing" (Diagrams 2018),
  https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/diagrams18cds.pdf. Places labels inside
  the Sugiyama pipeline by turning them into label dummy nodes in the layering, so labels reserve space
  and are never overlapped. This is what ELK Layered does (LABEL_DUMMY_INSERTER in the processor list,
  verified in the ELK paper).
- Engine use: do not place labels after layout. Reserve label boxes as dummy nodes (layered) or as
  obstacles (routing). For edge labels on orthogonal routes, prefer the longest straight segment, offset
  from the line, horizontal text.

### A.13 Reading order, narrative, and C4 guidance

- Simon Brown, C4 model FAQ, https://c4model.com/faq (verified). The guidance is about splitting into
  levels and not cramming: "you're likely to run out of room on the diagram canvas or find it difficult
  to discover a layout that isn't cluttered by a myriad of overlapping lines" and "an unread diagram is
  useless." I did not find a c4model.com page that states "diagrams should tell a story" verbatim; the
  phrasing is in Brown's talks and book (unverified wording).
- Storrle's level 4 (pragmatics) is the academic statement of "tell a story": position and size are used
  to direct attention, and lower rules yield to it.
- I found no peer-reviewed study of Z-pattern or F-pattern reading for node-link diagrams (search budget
  ran out before a dedicated query). Gansner et al. (B.2) A1 "aim edges in the same general direction"
  and Storrle's "maintain and highlight ordering as visual flow" are the evidence we have for a single
  dominant reading direction.
- Engine use: one global flow direction per view (left-to-right or top-to-bottom), chosen by the author
  and respected by every container (ELK and TALA both allow per-container direction, which breaks the
  single reading order; the default should inherit).

### A.14 Mental map preservation

- Misue, Eades, Lai, Sugiyama, "Layout adjustment and the mental map," JVLC 6, 1995, pp. 183-210
  (bibliographic verified via multiple indexes; full text not fetched). Defines the mental map as three
  invariants: orthogonal ordering (relative left/right and above/below of node pairs), proximity
  (clusters stay clusters), topology (dual graph of regions). Earlier version: "Preserving the mental
  map of a diagram," Compugraphics 1991.
- Engine use: incremental relayout should preserve orthogonal ordering of existing nodes when a node is
  added. In a layered engine this is "interactive" mode (ELK's INTERACTIVE crossing minimization and
  layering keep previous positions as the order); in a constraint engine it is a set of separation
  constraints derived from the previous layout. Also the basis for consistent placement across
  perspectives (Moody's cognitive integration).

---

## B. Layered (Sugiyama) layout and constrained variants

### B.1 Sugiyama, Tagawa, Toda (1981)

- "Methods for visual understanding of hierarchical system structures," IEEE Trans. SMC 11(2), 1981.
  The four-phase framework: cycle removal, layer assignment, crossing minimization (barycenter), coordinate
  assignment. Everything below is a refinement of one of these phases.
- Engine use: the phase structure is the right modular backbone; ELK's "phases plus intermediate
  processors" (B.7) is the mature form of it.

### B.2 Gansner, Koutsofios, North, Vo, "A technique for drawing directed graphs" (IEEE TSE 1993)

- IEEE TSE 19(3), pp. 214-230. Full text verified (fetched PDF).
  https://graphviz.org (canonical dot paper; also US patent 4953106).
- Aesthetic principles stated up front (verified): A1 expose hierarchy, aim edges in the same direction;
  A2 avoid visual anomalies that convey nothing (crossings, sharp bends); A3 keep edges short; A4 favor
  symmetry and balance. Four passes: network simplex rank assignment (minimizes total weighted edge
  length), ordering by weighted median plus transposition, coordinate assignment by solving an auxiliary
  graph with network simplex (priority to straight long edges), splines.
- Engine use: network simplex ranking with per-edge weights and minimum lengths is the right layering
  primitive because it accepts author hints cheaply (weight 0 edges do not pull layers; minlen forces
  separation). TALA's open-source ranker follows this exact formulation (E.9). dagre's rank is a
  reimplementation.

### B.3 Eiglsperger, Siebenhaller, Kaufmann, "An efficient implementation of Sugiyama's algorithm for layered graph drawing" (JGAA 2005)

- JGAA 9(3), pp. 305-325. https://jgaa.info/index.php/jgaa/article/view/paper111 (abstract verified).
- Replaces per-layer dummy chains with a sparse representation; time drops from O(|V||E| log|E|) to
  O((|V|+|E|) log|E|) with no increase in crossings.
- Engine use: only needed at scale (hundreds of nodes with long edges). For architecture diagrams under
  ~200 nodes per view, plain dummies are fine; keep this as the upgrade path.

### B.4 Brandes, Köpf, "Fast and simple horizontal coordinate assignment" (GD 2001)

- LNCS 2265, pp. 31-44. Erratum: Brandes, Walter, Zink, arXiv 2008.01252 (2020), two flaws in the
  alignment subroutine, fixed in the erratum. https://arxiv.org/pdf/2008.01252 (verified).
- Linear time. Vertical alignment to make long edges straight, then compaction, run in four
  orientations and averaged (or median). Used by dagre and ELK.
- Engine use: implement from the erratum, not the original. Its "align with median neighbor" step is
  what produces straight chains (Ware's continuity). Balanced mode gives centered parents (Sun & Wong C6).

### B.5 Healy, Nikolov: layering with constraints

- "A branch-and-cut approach to the directed acyclic graph layering problem," GD 2002, LNCS 2528.
  "Hierarchical drawing algorithms," Handbook of Graph Drawing and Visualization (Tamassia ed., CRC
  2013), pp. 409-453. https://pure.ul.ie/en/publications/hierarchical-drawing-algorithms (bibliographic
  verified).
- ILP for layering that minimizes dummy nodes under width and height bounds. The Handbook chapter is the
  standard survey of all four phases, including constrained variants.
- Engine use: reference text. Width-bounded layering is relevant because architecture views have a page
  aspect ratio; see B.9 (wrapping) for the practical alternative.

### B.6 Forster, "A fast and simple heuristic for constrained two-level crossing reduction" (GD 2004)

- LNCS 3383, pp. 206-216. Forster dissertation (Passau):
  https://opus4.kobv.de/opus4-uni-passau/files/44/Dissertation+Michael+Forster.pdf (abstract via search).
- Barycenter crossing reduction where some vertex pairs on a layer have a fixed relative order; quadratic
  time. Also Forster, "Applying crossing reduction strategies to layered compound graphs," GD 2002,
  LNCS 2528, pp. 276-284: respect subgraph (container) membership from the start rather than fix up after.
- Engine use: this is the primitive for "author order wins" and for "nodes in the same container stay
  contiguous within a layer." ELK's model order (B.8) is the modern descendant.

### B.7 Schulze, Spönemann, von Hanxleden, "Drawing layered graphs with port constraints" (JVLC 2014) and the ELK overview

- JVLC 25(2), pp. 89-106. Full text verified:
  https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/jvlc13.pdf
- Port constraint levels FREE, FIXED_SIDE, FIXED_ORDER, FIXED_RATIO, FIXED_POS; the algorithm relaxes
  from FREE to stricter levels as it runs. Inverted ports (an input on the east side) are handled with
  in-layer dummy edges; north/south ports via "layout units." Reported fewer crossings and bends than
  prior port-aware algorithms (example in Fig. 1: 3 crossings/30 bends to 1 crossing/14 bends). Also
  introduces the "intermediate processors" architecture: phases with slots before, between, and after.
- Domrös, von Hanxleden, Spönemann et al., "The Eclipse Layout Kernel," arXiv 2311.00533 (2023) and GD
  2024 software abstract. Full text verified: https://arxiv.org/pdf/2311.00533. Confirms: ELK Layered
  supports model order, node and port constraints, node size constraints, compaction, edge wrapping,
  label placement, self-loops; compound graphs laid out bottom-up by default, with the inner graph fixing
  hierarchical port order (which causes cross-hierarchy crossings unless model order is consistent);
  elkjs is a GWT transpile and "not as performant" as Java; ELK is EPL-2.0 (not LGPL). Related: Zink,
  Walter, Baumeister, Wolff, "Layered drawing of undirected graphs with generalized port constraints,"
  arXiv 2008.10583 (2020), port groups, 10-30% fewer crossings than ELK on their benchmark (secondary
  claim from the ELK paper and the arXiv abstract).
- ELK hierarchyHandling option verified: https://eclipse.dev/elk/reference/options/org-eclipse-elk-hierarchyHandling.html
  INHERIT (default, behaves as SEPARATE_CHILDREN at root), INCLUDE_CHILDREN (one layout run for the
  whole subtree, "may help cross-hierarchical edges route properly"), SEPARATE_CHILDREN.
- Engine use: ports are needed for architecture diagrams more than people expect: a load balancer with
  "in" on the left and "out" on the right, a database with all edges entering from the top. FIXED_SIDE
  is enough for 90% of cases. The processor-slot architecture is the right way to add notation rules
  without forking the core.

### B.8 Model order: Domrös & von Hanxleden (2022, 2023, 2024)

- "Preserving order during crossing minimization in Sugiyama layouts," IVAPP 2022, pp. 156-163,
  https://www.scitepress.org/Papers/2022/108338/108338.pdf (abstract verified; tech report 2103).
- "Model order in Sugiyama layouts," IVAPP 2023, https://www.scitepress.org/Papers/2023/116567/116567.pdf.
- "Diagram control and model order for Sugiyama layouts," Diagrams 2024, arXiv 2406.11393. Full text
  verified via HTML: https://arxiv.org/html/2406.11393v1
- Findings (verified from the 2024 paper): textual order of elements is "secondary notation" carrying
  intent (initial state first, grouped branches). Model order is applied in cycle breaking (which edges
  reverse), in crossing minimization (as a pre-ordering that sweeps may revise, or as a strict
  pre-processor that skips sweeps), and should apply to port order. Strict order increases crossings and
  developers preferred fewer crossings, so the recommendation is: model order as tie-breaker by default,
  strict order only for documentation and presentations. In a 36-model industrial study, strategy 1
  (tie-breaker) had been the default for a year with no reported "obviously not ordered" layouts.
- Engine use: this is the single most important idea for an agent-authored language. The agent writes
  nodes in narrative order; the engine treats that order as a soft ordering constraint in every phase.
  Expose a per-view knob: `order: hint | strict`.

### B.9 Rüegg, Ehlers, Spönemann, von Hanxleden, "A generalization of the directed graph layering problem" (GD 2016) and Rüegg, von Hanxleden, "Wrapping layered graphs" (Diagrams 2018)

- GLP: arXiv 1608.07809. Full text verified. Solves cycle breaking and layering as one ILP (weights on
  reversed edges vs dummy nodes), plus a heuristic. On their benchmark the ILP reduced dummy nodes
  substantially (table: 34 vs 48-72 average depending on method) and improved aspect ratio on tall
  graphs. The paper does not introduce in-layer edges; ELK's in-layer edges come from the port
  constraints paper (B.7) and Klauske et al. The brief's "layering with in-layer edges" is not this
  paper; treat as unverified.
- Wrapping: Kiel report 1803, https://rtsys.informatik.uni-kiel.de/~biblio/downloads/papers/report-1803.pdf.
  Full text verified. Problem: tall layerings (long programs, long call chains) have bad aspect ratio.
  Solution: cut the layering into chunks placed side by side with a few backward "wrapping" edges.
  Two heuristics (ARD aspect-ratio-driven, MSD max-scale-driven), single-edge and multi-edge cut
  variants, "lookback" validification. On 135 graphs (10-227 nodes) wrapping gave up to 4x larger
  usable scale at target aspect ratio 4.0 and never worse at ratio 1.0 or above. Implemented in ELK
  Layered (org.eclipse.elk.layered.wrapping).
- Engine use: a long flow (12-step pipeline) should snake, like a comic strip, not run off the page.
  Wrapping is the mechanism; the author should be able to say where the break is (a cut hint) or
  accept the heuristic.

### B.10 Chimani, Gutwenger, Mutzel, Wong, "Upward planarization layout" (GD 2009, JGAA 2011)

- JGAA 15(1), pp. 127-155, https://jgaa.info/index.php/jgaa/article/view/paper220 (abstract verified).
- Criticizes Sugiyama's separation of layering and crossing reduction: an unlucky layering forces
  crossings. Layer-free upward crossing minimization, then a drawing step. Fewer crossings than Sugiyama
  on benchmarks (numbers not fetched). In OGDF as UpwardPlanarizationLayout.
- Engine use: too heavy for a first engine, but the argument is right: when crossings matter more than
  layer discipline (dense dependency graphs), consider a layer-free pass. Not needed for typical
  architecture views where layers are the story.

---

## C. Constraint-based layout

### C.1 Cassowary and kiwi

- Badros, Borning, Stuckey, "The Cassowary linear arithmetic constraint solving algorithm," ACM TOCHI
  8(4), 2001. https://constraints.cs.washington.edu/solvers/cassowary-tr.html (verified).
  Incremental dual simplex over linear equalities and inequalities with strengths (required, strong,
  medium, weak). Basis of Apple Auto Layout.
- kiwi.js: TypeScript rewrite by Chris Colbert, https://github.com/cacaodev/kiwi (npm `kiwi.js`), MIT.
  `@lume/kiwi` is a maintained fork (not independently verified this session; search found no record).
- Engine use: Cassowary is for box geometry, not for graph topology. Use it for the final "metrics"
  phase: container padding, label slots, equal widths in a row, min gaps, aspect targets. It is not a
  substitute for crossing minimization or stress. Keep the solver behind an interface so VPSC (C.3) can
  replace it for the one-dimensional cases where VPSC is faster.

### C.2 Dwyer, Koren, Marriott, IPSep-CoLa (TVCG 2006) and "Constrained graph layout by stress majorization and gradient projection" (Discrete Mathematics 2009)

- TVCG 12(5), pp. 821-828 (bibliographic verified). Stress majorization (nodes placed so Euclidean
  distance tracks graph distance) with separation constraints (x_u + gap <= x_v) solved by gradient
  projection with VPSC. Graphviz's `neato -Gmode=ipsep` implements it (source verified in Graphviz tree).
- Engine use: the general recipe for "stress plus constraints": any constraint expressible as a
  separation on one axis (ordering, alignment via two separations, containment, flow direction) can be
  added to a force layout without breaking convergence.

### C.3 Dwyer, "Scalable, versatile and simple constrained graph layout" (EuroVis 2009)

- Computer Graphics Forum 28(3), pp. 991-998. https://diglib.eg.org/items/545c5550-8230-4ce1-bd60-7024d71b948a
  (abstract verified). O(n log n + m + c) per iteration; inspired by position-based dynamics; supports
  Euclidean distance equality and inequality constraints. This is the algorithm inside WebCola.
- Engine use: this is cola.js. For a TS engine, it is the only mature constraint layout already in
  JS/TS.

### C.4 WebCola / cola.js

- Tim Dwyer, https://github.com/tgdwyer/WebCola, MIT (README badge verified). Features per the API (the
  README itself is thin; the feature names below come from the library's documented API and the SetCoLa
  paper, which calls it "a JavaScript library based on libcola"): `flowLayout(axis, gap)` directed flow
  as separation constraints, `alignment` constraints, `groups` with padding (compound nodes),
  `avoidOverlaps`, `jaccardLinkLengths` / `symmetricDiffLinkLengths` (ideal edge length from
  neighborhood similarity), `powerGraph` grouping, straight-line and simple orthogonal-ish routing via
  `vpsc`. Maintenance: 88 open issues; last commit date not verified this session (ELK paper's npm
  comparison chart lists it as a lower-download peer of elkjs).
- Engine use: either embed cola for the "core" force phase (as HOLA does) or port only VPSC (small,
  self-contained) and write stress majorization fresh in TS. VPSC alone is a few hundred lines.

### C.5 Hoffswell, Borning, Heer, "SetCoLa: High-level constraints for graph layout" (EuroVis 2018)

- Computer Graphics Forum 37(3). Full text verified: https://idl.cs.washington.edu/files/2018-SetCoLa-EuroVis.pdf
- Constraint catalogue (verified from section 4): sets are defined by partition (by attribute), predicate,
  collection (by key expressions), or composition of named sets. Constraints per set: alignment (compiles
  to one WebCola alignment constraint), position left/right/above/below of a guide or another set
  (compiles to n.x + gap < g.x separation constraints; one per node, or one per pair when relative to a
  set), order along an axis by a property (adjacent-pair separation constraints with optional band),
  circle (approximated with a hidden center node and links; not native), cluster (tight grouping,
  approximated), hull (enclosing boundary, compiled to a WebCola group), padding (inflates node
  geometry for non-overlap). Guides become hidden nodes. Ratio of generated low-level constraints to
  SetCoLa constraints ranges from ~10x to ~50x in the examples (e.g., 18 SetCoLa constraints to 939
  WebCola constraints). Limitations stated: contradictions are not detected (reverse orders, x and y
  alignment on the same set), padding is global.
- Engine use: this is the design for the authoring language's layout vocabulary. An agent should say
  "all `database` nodes aligned, below the services" and never emit coordinates. The compiler from set
  constraints to node constraints is small and the paper gives the exact rules.

### C.6 Dunnart and topology-preserving layout (Dwyer, Marriott, Wybrow, GD 2008)

- "Dunnart: a constraint-based network diagram authoring tool," GD 2008, LNCS 5417, pp. 420-431;
  "Topology preserving constrained graph layout," GD 2008, pp. 230-241. https://github.com/mjwybrow/dunnart
  (verified; "alpha software that is being rewritten"). Also "Interactive, constraint-based layout of
  engineering diagrams," ECEASST 2009, https://www.eceasst.org/index.php/eceasst/article/download/1475/1600.
- Semi-automatic: the user places and constrains, the system keeps edges routed and constraints
  satisfied continuously, and relayout never changes the crossing structure the user has (topology
  preservation via libtopology).
- Engine use: the "hybrid" the brief asks about (F). The author pins a few things; the engine does the
  rest and never undoes what was pinned. Topology preservation is the formal version of "do not
  reshuffle my diagram when I add one box."

### C.7 Kieffer, Dwyer, Marriott, Wybrow, "Incremental grid-like layout using soft and hard constraints" (GD 2013)

- arXiv 1308.6368. Full text verified: https://arxiv.org/pdf/1308.6368
- Three methods for grid-likeness on top of stress with constraints: Node-Snap (NS-stress term pulls
  connected node pairs into horizontal or vertical alignment within a snap distance sigma), Grid-Snap
  (GS-stress pulls nodes to virtual grid lines), and Adaptive Constrained Alignment (ACA), a greedy
  algorithm that repeatedly picks the edge whose hard alignment constraint least increases stress and
  does not create an edge coincidence (Theorem 1: a coincidence test over aligned node pairs, O(|V|) per
  check), adding it as a hard VPSC constraint. ACA keeps degree-2 chains straight and prefers aligning
  non-leaf nodes. User constraints are never removed. Evaluation on graphs of 10-244 nodes: ACA (hard)
  beat both soft methods on grid metrics; ACA then Grid-Snap gives rectangular layouts.
- Engine use: ACA is the piece that turns a force layout into something that looks drawn. It is simple
  (greedy over edges, one stress estimate per candidate) and composes with VPSC. This is the natural
  "alignment" phase for non-layered views (peer-to-peer meshes, hub-and-spoke).

### C.8 Kieffer, Dwyer, Marriott, Wybrow, "HOLA: Human-like orthogonal network layout" (TVCG 2016)

- IEEE TVCG 22(1), pp. 349-358. Paper PDF at https://ialab.it.monash.edu/~dwyer/papers/hola2015.pdf
  returned 403 this session; details verified from a course presentation of the paper
  (https://www.cs.ubc.ca/~tmm/courses/547-15/slides/emily-hola.pdf, fetched) and from the Adaptagrams
  libdialect docs (https://www.adaptagrams.org/documentation/namespacedialect.html).
- Method: Stage A, 17 participants hand-edited 8 orthogonal networks until they "looked good"; Stage B,
  66 participants ranked human, original, and yFiles layouts tournament-style. Findings, verified:
  R1 (new) trees placed on the outside; R2 (new) "aesthetic bend points" (deliberate, regular bends);
  R3 compactness; R4 "gridiness"; R5 symmetry; and users dislike R6 crossings, R7 bends, R8 long edges,
  R9 stress. yFiles (topology-shape-metrics) optimizes crossings, bends, compactness and "does not care
  about symmetry or edge-length regularity."
- Pipeline (verified at the level of the four steps; sub-step names from the ACA paper and libdialect):
  1. Decompose into "core" (2-connected-ish remainder) and peeled subtrees.
  2. Lay out the core with stress plus constraints, then ACA for alignment.
  3. Lay out subtrees as symmetric trees and attach them on the outside, facing away.
  4. Fine tune: orthogonal routing (libavoid), "neighbour stress" and compaction, bend tuning.
- Results (verified table): on large networks, path-finding error 0.162 (HOLA) vs 0.548 (yFiles), time
  12.3 s vs 29.2 s; neighbor finding error 0.159 vs 0.349, time 10.1 s vs 13.0 s. On the eight small
  networks HOLA was preferred over yFiles and comparable to the best human layout.
- Implementation: libdialect in Adaptagrams (C++, LGPL-2.1), Python wrapper pyhola. No JS port found.
- Engine use: HOLA is the closest thing in the literature to "draw it like a person would" for
  non-hierarchical graphs. Its decomposition (trees out, core in) is directly reusable: in architecture
  diagrams the "trees" are leaf clusters (a service and its three queues) and the core is the main
  flow. The ACA + libavoid + compaction tail is the same tail a layered core would use.

### C.9 Orthogonal connector routing: libavoid (Wybrow, Marriott, Stuckey)

- "Incremental connector routing," GD 2005, LNCS 3843, pp. 446-457; "Orthogonal connector routing,"
  GD 2009, LNCS 5849, pp. 219-231; "Orthogonal hyperedge routing," Diagrams 2012, LNCS 7352, pp. 51-64;
  "Seeing around corners: fast orthogonal connector routing," Diagrams 2014.
  https://www.adaptagrams.org/documentation/libavoid.html (verified).
- Orthogonal routing over an orthogonal visibility graph, minimizing a monotonic function of length and
  bends, with nudging to separate parallel segments and shared-path handling; fast enough for interactive
  rerouting. Hyperedges (one connector joining many endpoints) are what "bus" edges in architecture
  diagrams are.
- JS port: libavoid-js, https://github.com/Aksem/libavoid-js. Emscripten/WebIDL build, runs in browser
  and Node, TypeScript types shipped (`dist/index.d.ts`). package.json on master says version 0.4.5,
  license `LGPL-2.1-or-later` (verified raw file). npm shows 0.5.0-beta.5 published Feb 2026 and
  libraries.io reports the npm license field as SSPL-1.0 for that beta (verified page; conflict with the
  repo). Treat the beta's license as unresolved; 0.4.5 is LGPL. Used by react-flow-avoid-nodes-routing
  (Web Worker). A TU Wien bachelor thesis ported it for Sprotty
  (https://model-engineering.info/publications/theses/thesis-hnatiuk.pdf).
- No JS/WASM port of libcola or libdialect found (webcola is a rewrite, not a port; webcola-wasm is a
  partial Rust rewrite).
- Engine use: either (a) ship libavoid-js 0.4.5 under LGPL in a worker, or (b) write an orthogonal
  visibility-graph router in TS (the GD 2009 paper is a complete spec: build horizontal and vertical
  visibility segments from obstacle edges, A* with bend penalty, then nudge). Option (b) is a few
  thousand lines and avoids the WASM and LGPL questions. Hyperedge routing from the 2012 paper is the
  spec for bus-style edges.

### C.10 Adaptagrams as a whole

- https://www.adaptagrams.org/ (verified). libvpsc (variable placement with separation constraints),
  libcola (stress majorization with separation constraints, non-overlap, clusters, directed layout,
  topology preservation), libavoid, libtopology, libdialect (HOLA). C++, LGPL-2.1, commercial license
  available. No official bindings beyond Python wrappers.
- Engine use: the architecture of these five libraries is the right decomposition for a TS engine:
  a 1-D separation solver, a stress core, an alignment layer, a router, and an orchestrator.

---

## D. Orthogonal drawing and routing

### D.1 Batini, Nardelli, Tamassia, "A layout algorithm for data flow diagrams" (IEEE TSE 1986)

- IEEE TSE SE-12(4), pp. 538-546. https://www.mat.uniroma2.it/~nardelli/publications/IEEE-TSE-86.pdf
  (abstract verified). Defines a grid standard and aesthetics for DFDs and the three-phase
  topology-shape-metrics scheme: topology (few crossings), shape (angles along edges), metrics (grid
  dimensions).
- Engine use: historical root of the orthogonal pipeline. The idea that DFD boxes snap to a coarse grid
  is the "dot-grid aesthetic."

### D.2 Tamassia, "On embedding a graph in the grid with the minimum number of bends" (SIAM J. Comput. 1987); Kandinsky (Fößmeier, Kaufmann 1996); Eiglsperger, Fekete, Klau survey

- SIAM J. Comput. 16(3), pp. 421-444. Bend-minimal orthogonal representation of an embedded planar
  4-graph via min-cost flow, polynomial. Kandinsky generalizes to degree > 4 (nodes as boxes with many
  edges on a side); bend minimization in Kandinsky is NP-complete (Bläsius, Brückner, Rutter, verified
  via arXiv search). Survey: Eiglsperger, Fekete, Klau, "Orthogonal graph drawing," in Drawing Graphs:
  Methods and Models, LNCS 2025, 2001 (not fetched).
- Engine use: full TSM (planarize, then flow-based bend minimization, then compaction) is what yFiles
  Orthogonal and OGDF do. HOLA's user study found yFiles' output less liked than stress-plus-alignment
  (C.8). For architecture diagrams with fixed node sizes and containers, TSM's planarization step is
  the hard part and the payoff is small. Prefer "placement then routing" (HOLA, TALA, ELK) over TSM.

### D.3 Edge bundling

- Holten, "Hierarchical edge bundles," TVCG 12(5), 2006, pp. 741-748 (verified via course copy). Bundles
  adjacency edges along the hierarchy path. Lhuillier, Hurter, Telea, "State of the art in edge and
  trail bundling techniques," CGF 36(3), 2017, pp. 619-645,
  https://webspace.science.uu.nl/~telea001/uploads/PAPERS/EuroVis17/star.pdf (abstract verified).
- Marriott et al., "Towards unambiguous edge bundling" (Bach, Riche, Hurter, Marriott, Dwyer, TVCG
  2017) argues bundling hides which edge goes where; not fetched this session.
- Engine use: for architecture diagrams, do not use curved bundling. Use orthogonal bus routing
  (shared trunk, libavoid hyperedges or yFiles-style bus) so each edge stays traceable.

### D.4 yFiles EdgeRouter and BusRouter

- https://docs.yworks.com/yfiles-html/dguide/layout/bus_router.html and EdgeRouter API (verified).
  EdgeRouter: orthogonal, octilinear, or curved routes with nodes fixed; bus style via
  EdgeRouterBusDescriptor. Bus routing is two-phase: pick good backbone segments, then connect backbones
  and nodes with short orthogonal paths. Older BusRouter is deprecated in favor of EdgeRouter.
  "Channel routing" as a named algorithm is not in the public docs; yFiles' internals are closed.
- Engine use: the backbone-then-stubs structure is the practical bus algorithm: pick the long shared
  horizontal or vertical trunk, then route short stubs to it.

### D.5 Grid and "sketch" layouts

- Kieffer et al. 2013 (C.7) is the grid-likeness paper. Marriott 2012 (A.11) gives the memorability
  evidence for orthogonality. "Placing nodes on a grid" and "Orthogonal layout with optimal face
  complexity" were not searched (budget). Unverified.
- Engine use: snap final coordinates to a coarse grid (e.g., 8 or 16 px) after constraint solving; the
  snap is a weak Cassowary constraint or the Grid-Snap stress term, applied last so it cannot create
  overlaps.

---

## E. Compound and nested graph layout

### E.1 Sugiyama, Misue, "Visualization of structural information: automatic drawing of compound digraphs" (IEEE SMC 1991)

- IEEE Trans. SMC 21(4), pp. 876-892, DOI 10.1109/21.108304 (bibliographic verified). First compound
  Sugiyama: hierarchy of inclusion plus adjacency edges, layered with "compound levels."
- Sander, "Layout of compound directed graphs," Saarland tech report A03/96, 1996,
  https://jahrbib.sulb.uni-saarland.de/bitstream/20.500.11880/25862/1/tr-A03-96.pdf (abstract verified).
  Global layering across the whole compound graph (not per container), implemented in VCG; the ancestor
  of ELK's INCLUDE_CHILDREN.
- Forster 2002 (B.6) crossing reduction that keeps container members contiguous.
- Bertault, Miller, "An algorithm for drawing compound graphs," GD 1999, pp. 197-204 (bibliographic
  only).
- Engine use: two families exist. Bottom-up (lay out each container, treat it as a box, lay out the
  parent) is simple and gives clean containers but routes cross-container edges badly. Global layering
  (Sander, ELK INCLUDE_CHILDREN) gives straight cross-container edges but containers stretch to span
  the layers they touch. A good engine needs both and a rule to choose: global layering when
  cross-container edges carry the flow, bottom-up when containers are the story.

### E.2 Dogrusoz et al., CoSE (2009) and Balci, Dogrusoz, fCoSE (TVCG 2021/2022)

- CoSE: Information Sciences 179(7), 2009, pp. 980-994, DOI 10.1016/j.ins.2008.11.017 (abstract
  verified). Force-directed compound layout: nested containers of arbitrary depth, inter-level edges,
  varying node sizes; containers are springs' rigid bodies. Shipped as cytoscape.js cose-bilkent.
- fCoSE: IEEE TVCG 28(12), pp. 4582-4593, DOI 10.1109/TVCG.2021.3095303 (abstract verified;
  https://github.com/iVis-at-Bilkent/cytoscape.js-fcose). Spectral draft, then constraint enforcement,
  then force polishing. Constraints: fixed position, vertical/horizontal alignment, relative placement.
  MIT, JavaScript.
- Engine use: the only JS compound layout with constraints that is maintained. Its output is organic
  (force-directed), not orthogonal or grid-like, so it is a "core" candidate (like cola) that still
  needs the ACA and routing tail. Its constraint API (align, relative placement, fixed) is a good
  minimal set.

### E.3 ELK compound handling, rectpacking, and top-down layout

- ELK paper (B.7): compound graphs bottom-up by default; INCLUDE_CHILDREN for one global run.
- ELK Rectangle Packing, https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-rectpacking.html
  (verified): lays out edge-less boxes in the given order, left to right; width approximation then row
  placement grouping similar heights into blocks, then compaction and expansion to a target aspect ratio
  (default 1.3); "the given order is always preserved."
- ELK Top-down Packing, https://eclipse.dev/elk/reference/algorithms/org-eclipse-elk-topdownpacking.html
  (verified): fixed-size boxes, widened to fill whitespace; part of ELK's top-down layout where a
  parent's size is decided first and children are scaled (options topdown.hierarchicalNodeAspectRatio
  1.414, hierarchicalNodeWidth 150, scaleFactor, scaleCap). The Kasperowski/von Hanxleden report on
  top-down compound layout was a 404 at the URL I guessed; the ELK GD 2024 abstract confirms top-down
  mode exists.
- Rüegg dissertation, "Sugiyama layouts for prescribed drawing areas," Kiel 2018,
  https://macau.uni-kiel.de/servlets/MCRFileNodeServlet/dissertation_derivate_00007865//uru-diss.pdf
  (table of contents verified: "Layout of Compound Graphs in KLay Layered," "Flat Representation of
  Compound Graphs").
- Schulze dissertation, "Text in diagrams: challenges to and opportunities of automatic layout," Kiel
  2018/2019 (referees von Hanxleden and Purchase) covers labels and comments in layout.
- Engine use: rectpacking with order preservation is the containment-first primitive. Top-down (decide
  the frame, then fit children) is the right model for a "page" with fixed aspect ratio and for
  zoomable perspectives: outer view fixes container boxes; inner view fills them.

### E.4 Treemaps for ordered packing

- Bruls, Huizing, van Wijk, "Squarified treemaps," VisSym 2000, pp. 33-42,
  https://diglib.eg.org/handle/10.2312/VisSym.VisSym00.033-042 (abstract verified). Shneiderman,
  Wattenberg, "Ordered treemap layouts," InfoVis 2001 (strip/pivot variants, ordered, smoother updates
  than squarified). Bederson, Shneiderman, Wattenberg, "Ordered and quantum treemaps," ACM TOG 2002.
- Engine use: when a container holds only unconnected children (a resource group with twelve
  resources), strip treemap in author order is a good, stable packing. Squarified gives better aspect
  ratios but reorders; ordered keeps the narrative. Prefer strip.

### E.5 OGDF

- ClusterPlanarizationLayout and SugiyamaLayout with cluster graphs (C++, GPL v2/v3 with exceptions).
  Not fetched this session. Reference implementations of E.1 ideas; not a candidate for a TS engine.

### E.6 D2 TALA (now open source, verified October 2026)

- https://d2lang.com/tour/tala/ (verified): orthogonal engine "like a human would on a whiteboard,"
  prefers symmetry, first-class containers, per-container `direction`, dynamic label placement, own
  grid-cell router, `top`/`left` pins, `near`, randomness (a label change can cascade).
- https://d2lang.com/blog/tala-is-open-source/ (verified, dated September 7, 2026): TALA is now
  MPL-2.0, bundled in D2 v0.9.0 (`--layout=tala`); "optimizes for symmetry, median distance, flow,
  clustering of similar nodes"; runs 3 seeds by default and keeps the best-scoring layout; deterministic
  for the same seeds; nonlinear runtime; "handles long, flowing DAGs less well than Dagre or ELK."
  The old https://github.com/terrastruct/TALA repo is archived (read-only since Sep 7, 2026).
- Code: https://github.com/terrastruct/d2/tree/master/d2layouts/d2talalayout, ARCHITECTURE.md fetched
  and verified. Pipeline per seed on a cloned graph: (1) discover structures: clusters, sequences,
  proximity relations, trees, DAG hierarchies; (2) place and pack; (3) route edges and place labels;
  (4) validate and score. Packages: grouping, hierarchy (DAG discovery, ranking, layered placement),
  trees, placement with placementcost (objective functions), packing (disconnected components and
  containers), routing (visibility graphs, path search, route cleanup), loops, labeling, labelgeom,
  nodeshape. Ranking follows Gansner et al. 1993 network simplex (cited in source), Bland's rule for
  degenerate pivots. Seeds: at most 16 attempts, ranked by exact penalty then area; concurrency does not
  change the result.
- Engine use: TALA's structure is independent confirmation of the stack in section I: structure
  discovery (trees out, DAG core, clusters), placement with a scored cost, pack containers, route, label,
  score across seeds. Its weakness on long DAGs is why the layered core must stay the default for flow
  views. Now that it is MPL-2.0 Go code, its cost terms and router are readable reference material.

---

## F. Layout from author intent, rule bases, and learned metrics

### F.1 Hybrids: Dunnart, yFiles "from sketch," HOLA's "incremental improvements like a human"

- Dunnart (C.6) and topology-preserving layout: author pins, engine fills, topology never changes.
- yFiles has a "from sketch" mode for its layouts (OrthogonalLayout, HierarchicLayout fromSketchMode)
  that treats the current drawing as the initial order; not fetched this session, unverified detail.
- ELK's INTERACTIVE strategies for cycle breaking, layering, and crossing minimization read previous
  coordinates as the order (ELK paper, B.7, processor list includes SEMI_INTERACTIVE_CROSSMIN_PROCESSOR).
- Engine use: three levels of author intent, in increasing strength: model order (B.8, free), set
  constraints (C.5, cheap), pins (C.6, absolute). The language should expose all three, and the engine
  should never violate a stronger one to satisfy a weaker one.

### F.2 Draco: a constraint knowledge base for visualization design

- Moritz, Wang, Nelson, Lin, Smith, Howe, Heer, "Formalizing visualization design knowledge as
  constraints: actionable and extensible models in Draco," IEEE TVCG 25(1), 2019 (InfoVis 2018 best
  paper), https://idl.uw.edu/papers/draco (verified). Hard and soft constraints in Answer Set Programming
  (Clingo); soft-constraint weights learned from perception studies; recommends Vega-Lite specs.
- Engine use: the analogy for a diagram rule base: hard rules (no overlap, containment, flow direction)
  and soft rules with learned weights (symmetry, edge length, alignment, order preservation). We do not
  need ASP; a weighted score over candidate layouts (seeds, as TALA does) is the pragmatic form. Draco's
  contribution is the idea that weights should come from user studies (Storrle, HOLA), not intuition.

### F.3 Multicriteria and learned graph drawing

- Ahmed, De Luca, Devkota, Kobourov, Li, "Graph drawing via gradient descent, (GD)^2," GD 2020,
  arXiv 2008.05584. Full text verified. Nine criteria optimized by SGD with auto-differentiation and
  surrogates for non-smooth ones: stress, vertex resolution, ideal edge lengths, neighborhood
  preservation (Jaccard surrogate), crossing angle, angular resolution, aspect ratio, Gabriel graph
  property, edge crossings. Notes that weight scheduling matters (stress first, then angles).
  Follow-up (SGD)^2, arXiv 2112.01571. SmartGD (Wang et al., arXiv 2206.06434): GAN that learns a
  layout style from examples, including non-differentiable goals. DeepGD: GNN predicting layouts
  (not fetched).
- Engine use: for an architecture engine, differentiable layout is a research path, not a product
  path: node sizes, containers, and orthogonal routing are discrete. The reusable part is the list of
  normalized criteria and the lesson that a scheduled, weighted sum works.

### F.4 Readability metrics as code

- Dunne, Shneiderman, "Improving graph drawing readability by incorporating readability metrics: a
  software tool for network analysts," UMD HCIL-2009-13,
  https://www.cs.umd.edu/users/ben/papers/Dunne2009Improving.pdf (abstract verified; also Dunne, Ross,
  Shneiderman, Martino, IBM J. R&D 2015). Metrics on [0,1]: node occlusion, edge crossings, crossing
  angle, edge tunneling (edge passing through a node), plus node- and edge-level versions.
- greadability.js, https://github.com/rpgove/greadability (R. Gove): edge crossings, crossing angle
  (ideal 70 degrees), two angular resolution measures, recomputed live. Python graphreadability package
  cites the 2015 paper.
- Engine use: implement these four plus Purchase's seven as a `score` module used (a) to pick among
  seeds and (b) as a regression test on fixture diagrams ("no fixture may get worse").

### F.5 Stress and neighborhood preservation

- Stress (Kamada-Kawai / Gansner-Koren-North stress majorization) measures global distance fidelity;
  neighborhood preservation (Jaccard of k-nearest in layout vs graph) measures local structure. Both in
  (GD)^2 and in the Kieffer ACA paper (P-stress variant that does not penalize unconnected nodes being
  far apart).
- Engine use: use P-stress, not stress, so unrelated subsystems may sit far apart without penalty.

---

## G. LLM-driven diagram generation

Search budget ran out during this section. Items marked "fetched" were read directly; items marked
"not searched" are gaps the next pass should fill.

### G.1 Wei et al., "From words to structured visuals: a benchmark and framework for text-to-diagram generation and editing" (DiagramAgent / DiagramGenBenchmark, CVPR 2025)

- arXiv 2411.11916, CVPR 2025. Full HTML fetched: https://arxiv.org/html/2411.11916v1
- Targets LaTeX (TikZ-style) and DOT; eight diagram categories (flowcharts, model architecture, mind
  maps, ...). Four agents: Plan, Code, Check, Diagram-to-Code. The Check Agent does two things: compile
  the code and send compile errors back; after a successful compile, GPT-4o checks completeness of
  elements. It does not look at rendered pixels and has no layout check. Baseline failure modes named:
  text-to-code approaches "struggle with hierarchical relationships, color coding, and layered
  structures." Pass@1 generation: DiagramAgent (7B, fine-tuned) 58.15, DeepSeek-Coder 33B 55.56,
  GPT-4o 49.81, Gemini 43.23, Llama-3.1-8B 33.58, Code-Llama 34B 8.89. Editing Pass@1 98.00.
- Takeaway: roughly half of frontier-model outputs fail to even compile in TikZ/DOT, and the fix in
  the paper is a compile-check loop, not a better prompt. Nobody in this benchmark measures layout
  quality.

### G.2 MermaidSeqBench (Shbita, Ahmed, DeLuca, 2025)

- arXiv 2511.14967, full PDF fetched. 132 NL-to-Mermaid sequence diagram samples; LLM judges
  (DeepSeek-V3, GPT-OSS-120B) score Syntax, Mermaid-only, Logic, Completeness, Activation Handling,
  Error & Status Tracking on [0,1]. Verified numbers: Llama-3.1-8B syntax 92.0 (DeepSeek judge) / 68.9
  (GPT-OSS judge); Qwen-2.5-7B 91.3 / 86.0; Qwen-2.5-72B 88.6 / 87.1; 1B-class models 59-69. Syntax and
  Mermaid-only are the easiest dimensions; activation handling and error/status tracking are the
  hardest at every scale. Absolute scores differ up to 24 points between judges; only rankings are
  stable.
- Takeaway: even 7B models get Mermaid sequence syntax mostly right; what they get wrong is structured
  control flow (activations, alt/else, error paths). The syntax tax is small for sequence diagrams
  because the grammar is line-oriented and regular.

### G.3 Practitioner data on Mermaid syntax failures

- FSoft-AI4Code/CodeWiki issue #141, https://github.com/FSoft-AI4Code/CodeWiki/issues/141 (search
  summary, not fetched): 23 of 872 generated Mermaid blocks (2.6%) failed to render; causes were label
  text containing parser-special characters (parentheses, brackets, quotes, pipes) in flowchart node
  labels; the LLM retry often reproduces the same mistake.
- Takeaway: the dominant LLM failure in Mermaid flowcharts is not graph structure, it is delimiter
  collisions in free text. A language whose node labels are always quoted strings (or where the
  identifier is separate from the label) removes this class entirely.

### G.4 Grammar-constrained decoding

- Park et al., "Grammar-aligned decoding," NeurIPS 2024 (ASAp): constrained decoding can distort the
  model's distribution; their method keeps grammaticality with higher-likelihood outputs.
  Geng et al., "Grammar-constrained decoding for structured NLP tasks without finetuning" (EMNLP 2023,
  arXiv 2305.13971): GCD beats unconstrained few-shot. Schmidt & Cimiano, Frontiers in AI 2025:
  domain-specific grammar guidance for extraction; "validity rates even of the most recent language
  models are far from perfect for strict-format applications." ACL Industry 2025 (2025.acl-industry.34):
  GCD "ensures syntactic validity, but semantic errors not captured by context-free grammars continue
  to pose challenges." (All abstract-level via search; none fetched.)
- Takeaway: syntax can be made a non-problem by constrained decoding or by a regular grammar with few
  special characters; semantics (which nodes, which edges, which container) remain the model's job. For
  an API-driven agent you cannot constrain the decoder, so grammar simplicity and a validating parser
  with precise error messages are the levers.

### G.5 LLMs doing 2D layout directly: LayoutGPT, LayoutPrompter

- LayoutGPT (Feng et al., NeurIPS 2023, arXiv 2305.15393), ar5iv fetched. Serializes boxes as CSS
  rules (`object {width; height; left; top}`) on a normalized canvas; CSS format and normalization
  both raise accuracy. Spatial relation accuracy with GPT-4: 91.7% (humans 91.2%); numerical reasoning
  (counting) 86.3% (humans 92.6%). Failure modes: counting degrades with more categories (66-78%),
  boxes shrink to fit everything, overlaps in dense scenes, out-of-bounds in 3D. Heavily dependent on
  in-context exemplars.
- LayoutPrompter (Lin et al., NeurIPS 2023, arXiv 2311.06495): performance drops as element count
  grows; "more elements lead to more failure cases." A 2025 two-stage paper (arXiv 2511.06888) reports
  recall falling to 57% above 15 objects for direct LLM layout, recovered to 99% by staging.
- Takeaway: LLMs can order and relate things ("A left of B," "C inside D") but should not emit pixel
  coordinates for more than a handful of elements. The language must let the agent state relations
  and order, and the engine must own geometry.

### G.6 Chart and plot code generation benchmarks

- ChartMimic (arXiv 2406.09961, abstract fetched): 4,800 chart-to-code triplets; GPT-4o 82.2 on Direct
  Mimic, best open model 61.6 on Customized Mimic; multi-level metrics on code and rendered chart.
- Plot2Code (arXiv 2405.07990, abstract fetched): 132 matplotlib plots, 14 MLLMs; metrics are code pass
  rate, text-match ratio, GPT-4V rating of rendered image; models "struggle with text-dense plots and
  rely heavily on the textual instruction rather than the visual input."
- Takeaway: rendered-image judging (Plot2Code's GPT-4V rating) is the closest thing in the literature to
  "LLM as layout critic," and even there the vision model is weak at dense text. A VLM critic will
  catch gross problems (overlap, spaghetti) but not subtle ones; a metric-based critic (F.4) is more
  reliable and cheaper.

### G.7 Auto-diagram-from-code projects

- GitDiagram, https://github.com/ahmedkhaleel2004/gitdiagram, MIT, 18.5k stars (fetched).
  docs/architecture.md (fetched): the model never writes Mermaid. The server asks for a strict graph
  (groups, nodes, edges, shapes, labels, repository paths) as structured output, validates identifiers,
  connectivity, limits, and every linked path against the repo, retries invalid output "with focused
  feedback," and a deterministic compiler emits Mermaid with full text escaping. Mermaid's parser is
  used only in tests as a compiler contract. Layout quality is not discussed.
- Eraser DiagramGPT, https://www.eraser.io/diagramgpt (fetched): text prompt to diagram, "leveraging
  OpenAI's models," output editable in Eraser's diagram-as-code syntax; no accuracy or layout claims;
  API and MCP on paid plans.
- Mermaid ecosystem page (fetched): lists HueHive (text to Mermaid), hustcc/mcp-mermaid (MCP server
  that renders Mermaid), Mermaid Studio MCP (JetBrains). These render; they do not improve layout.
- Terrastruct: D2 blog (fetched) has no LLM or agent posts; its 2026 posts are "D2 is non-profit" and
  "TALA is open-source."
- Takeaway: the one production system with a measured pipeline (GitDiagram) converged on exactly the
  design the LLM-layout literature implies: structured graph output, server-side validation with
  feedback, deterministic compilation to the diagram language. The agent never touches syntax or
  coordinates.

### G.8 Penrose and program synthesis of diagrams

- Penrose, https://github.com/penrose/penrose (fetched): MIT, ~8.0k stars; Domain, Substance, Style
  languages; Style has `ensure` (hard) and `encourage` (soft) constraints solved by numerical
  optimization (WASM optimizer since 2023, "layout in stages" since 2023; blog fetched). Edgeworth
  (Penrose team, problem generation for math diagrams) and any "Penrose + LLM" work: not searched
  (budget). Unverified.
- Takeaway: Penrose is the purest "declarative constraints, optimizer owns geometry" system and shows
  that a Style layer with ensure/encourage is expressive enough for textbook diagrams. Its optimizer is
  continuous and does not do orthogonal routing or containers well, so it is a design reference, not a
  component.

### G.9 Gaps not searched this session

- Vision-model-in-the-loop diagram repair papers (2025-2026), "agentic diagramming," MCP diagram server
  comparisons, Anthropic/OpenAI cookbook diagram examples, Gestalt perception studies specific to node
  containment, Kasperowski's top-down compound layout report, Purchase 2002 metric list verification.

---

## H. What the literature says a human-quality architecture layout needs

1. One global flow direction per view, and every element placed in it. Storrle's "place elements in
   flow" and Gansner's A1 are the two strongest findings for software diagrams (A.7, B.2).
2. Crossings minimized first, bends second, then everything else (Purchase 1997, HOLA R6/R7), but for
   real notations the compound effect of flow, grouping, and alignment beats crossing count alone
   (Storrle 2011: +7% accuracy, -17% time, +30% preference).
3. Orthogonal edges with 90-degree crossings only; shallow crossings are what hurt (Huang; Marriott
   2012 orthogonality aids recall).
4. Collinear chains: a multi-hop flow should read as one straight line (Ware 2002 continuity; ACA
   degree-2 chains; Brandes-Köpf straight long edges).
5. Grouping by enclosure, with similar things aligned and clustered inside the group (Gestalt common
   region and proximity; Sun & Wong C6/C7; Storrle "join/cluster similar elements").
6. Symmetry and balance as secondary objectives, especially for sibling fan-outs (Gansner A4, HOLA R5,
   Marriott 2012).
7. Grid-likeness and compactness, which users rate highly and which hand drawings have (HOLA R3/R4;
   Kieffer ACA), but applied after the structure is right, never before.
8. Trees and leaf clusters on the outside, facing away from the core (HOLA R1, the one genuinely new
   finding of that study).
9. Short, uniform edge lengths; long edges are disliked (HOLA R8/R9; Sun & Wong C7). Wrapping a long
   flow is better than a long thin page (Rüegg wrapping).
10. Typed edges with typed directions: hierarchy or dependency edges carry layering; association edges
    do not (Gutwenger 2003, mixed upward planarization).
11. Labels placed inside the layout, horizontal, never overlapping, with unambiguous association
    (Kakoulis-Tollis rules; ELK label dummies; Storrle "no obscuring").
12. Author order as secondary notation: textual order is intent and should be a tie-breaker in every
    phase, with a strict mode for presentations (Domrös 2022-2024).
13. Author constraints at three strengths: order (free), set constraints (align, position, order,
    hull; SetCoLa), pins (Dunnart). Stronger never yields to weaker.
14. Mental map preservation across edits and across perspectives: orthogonal ordering and proximity
    of existing nodes survive a relayout (Misue 1995; Moody cognitive integration).
15. Layout quality matters more as diagrams get bigger and readers get less expert (Storrle 2014);
    the engine must stay good at 50-150 nodes, which is exactly where force layouts degrade into hairballs.
16. Pragmatics override aesthetics: position and size may be spent on the story (Storrle level 4; C4
    "an unread diagram is useless"), so the language needs an "emphasis" or "hero" affordance the
    engine honors.
17. Determinism with a seed and a score: the same input must give the same drawing, and when the engine
    has choices it should score candidates with normalized metrics and pick the best (TALA seeds,
    Purchase metrics, Dunne-Shneiderman, Draco-style weights from user studies).
18. The agent must never emit coordinates or syntax-sensitive free text: LLM 2D placement collapses
    above ~15 elements (LayoutGPT, LayoutPrompter) and Mermaid failures are delimiter collisions
    (G.3); structured graph plus deterministic compiler is the proven pipeline (GitDiagram).

---

## I. Algorithm stack recommendation from the literature

Composable phases, each with a literature anchor and a TS implementation note. Order is the order of
execution for one view.

1. Parse and normalize to a compound graph with model order. Nodes, typed edges (flow vs association),
   containers, ports with FIXED_SIDE where declared, labels as sized boxes, author constraints (order,
   sets, pins). Anchor: Domrös model order (B.8), SetCoLa set language (C.5). TS: plain data model;
   compile set constraints to per-node constraints exactly as SetCoLa section 4 specifies.

2. Structure discovery. Split into connected components; peel trees and leaf clusters off the core
   (HOLA step 1, TALA "discover layout structures"); find the directed flow subgraph (typed edges);
   detect sequences (chains of degree-2). Anchor: HOLA (C.8), TALA ARCHITECTURE.md (E.6). TS: a few
   hundred lines of graph utilities.

3. Containment-first frame. Decide container boxes top-down when the view has a prescribed area
   (page, perspective zoom level) and bottom-up otherwise. Pack edge-less children with ordered strip
   treemap or ELK-style rectpacking (order preserved, target aspect ratio). Anchor: ELK rectpacking and
   top-down packing (E.3), strip treemap (E.4). TS: rectpacking is simple (width approximation, rows,
   compaction); keep author order.

4. Layered core with model order inside each flow region. Cycle breaking with model order as tie-break;
   network simplex ranking with edge weights and minlen (Gansner); crossing minimization by barycenter
   with Forster-style fixed pairs for container contiguity and model order pre-ordering; Brandes-Köpf
   coordinate assignment from the 2020 erratum; label dummies in the layering; port sides respected;
   wrapping when the layering exceeds the frame's aspect. Use INCLUDE_CHILDREN-style global layering
   when cross-container edges carry the flow, otherwise per-container runs. Anchor: B.2, B.4, B.6, B.7,
   B.8, B.9, A.12. TS: dagre's structure is a starting point but it has no model order, ports, labels
   in layering, or wrapping; write the four phases fresh with ELK's processor-slot architecture so
   notation rules plug in between phases.

5. Constraint core for non-flow regions. For peer meshes, hub-and-spoke, and association-only
   subgraphs: P-stress with separation constraints (VPSC gradient projection, Dwyer 2009), then ACA
   greedy alignment to make it grid-like, then Grid-Snap. Trees attached outside the core as symmetric
   subtrees. Anchor: C.2, C.3, C.7, C.8. TS: port VPSC (small), write stress majorization, implement
   ACA from the paper's pseudocode.

6. Separation and alignment pass over the whole view. All author set constraints (align, position,
   order, hull), parent-centered-over-children, equal row heights, min gaps, container padding, snap
   to grid, solved as one constraint system per axis. Anchor: SetCoLa compile rules (C.5), Sun & Wong
   C6 (A.6), Kieffer Grid-Snap (C.7). TS: kiwi.js (Cassowary) for 2-D linear constraints with strengths,
   or VPSC per axis when all constraints are separations; Cassowary's strength ladder maps directly to
   order < set < pin.

7. Orthogonal routing with obstacles, nudging, and hyperedges. Visibility-graph orthogonal router
   minimizing length plus bend penalty, nudging parallel segments apart, bus-style trunks for fan-in
   and fan-out, label boxes as obstacles, container borders as obstacles with ports at crossing points.
   Anchor: Wybrow GD 2009 and Diagrams 2012 (C.9), yFiles bus two-phase structure (D.4). TS: either
   libavoid-js 0.4.5 (LGPL, WASM, worker) or a native TS router from the GD 2009 spec; prefer native to
   keep the engine one language and MIT-clean.

8. Integrated label placement. Node labels sized before layout; edge labels placed on the longest
   straight segment of the final route, horizontal, offset, collision-checked against nodes and other
   labels; simulated annealing fallback only when greedy fails. Anchor: Kakoulis-Tollis rules, Schulze
   2018 label dummies, Christensen 1995 (A.12). TS: greedy slot scoring; labels were already reserved
   in phase 4 so this is adjustment, not search.

9. Score and select. Compute normalized metrics (crossings, bends, crossing angle, occlusion,
   tunneling, edge length variance, alignment count, symmetry proxy, order violations, stress) and a
   weighted sum; run 2-4 seeds where the pipeline has stochastic choices (crossing-minimization sweeps,
   tie-breaks) and keep the best; expose the score for regression tests. Anchor: Purchase 2002,
   Dunne-Shneiderman 2009, greadability.js, TALA seeds, Draco weights (A.2, F.4, E.6, F.2). TS: pure
   functions over the final geometry.

10. Incremental relayout with mental-map preservation. On edit, derive orthogonal-ordering and
    proximity constraints from the previous layout and feed them as INTERACTIVE orderings in phase 4
    and as weak separations in phases 5-6, so new nodes slot in and old nodes keep their relative
    positions. Across perspectives, share the same node ordering so the same element sits in the same
    relative place. Anchor: Misue 1995 (A.14), ELK interactive strategies (B.7), Dunnart topology
    preservation (C.6). TS: a small module that diffs the previous geometry and emits constraints;
    no new solver.

What this stack deliberately leaves out, and why: full topology-shape-metrics orthogonalization
(users preferred HOLA's stress-plus-alignment over yFiles TSM; planarization of fixed-size containers
is the hard part with little payoff), curved edge bundling (hides edge identity), differentiable or
learned layout (discrete containers and routing; no gain for 50-150 node diagrams), and any step where
an LLM emits coordinates (G.5).
