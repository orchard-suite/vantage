# Layout engine notes

Pipeline for a relation view (`packages/layout/src/relation.ts`):

1. `visible.ts` computes the visible set: participants of the view's
   relations (after `hide`, `collapse` retargeting, `include`, `subtree`,
   `detail`, `expand`) and their ancestors. Relations become hops; a `via`
   chain becomes several hops sharing a relation.
2. `lift.ts` lifts sibling fan-in and fan-out to the parent container when
   at least two siblings and at least half of the visible children share
   the same far end, label, and kind.
3. `compose.ts` sizes leaves from text, icons, facts, bullets, and value
   (`compose-size.ts`), chooses an arrangement per container
   (`arrange/flow.ts`, `arrange/grid.ts`, or a gesture in
   `arrange/gesture.ts`), keeps highlight members adjacent, places children
   (`arrange/place.ts`), and sizes the container from its children and its
   header. Roots are arranged the same way on the canvas.
4. `story.ts` pins notes and callouts beside boxes; they become obstacles.
5. `ports.ts` chooses sides and spreads ports.
6. `route.ts` routes each bundle orthogonally, longest first.
7. `labels.ts` places labels.
8. `story.ts` again: path badges and colors, highlight frames, then the
   footer (prose, narrative, legend).
9. `metrics.ts` scores the picture (the footer is not scored).

`page.ts` lays out page views by embedding other layouts (`shift.ts` moves
them). `explore.ts` produces scored candidates for a view.

Sequence views (`sequence.ts`) and flow views (`flowchart.ts`) have their
own layouts; flow views reuse the flow arrangement and the router.

Every constant is in `style.ts`. Text metrics are in `text/inter-metrics.json`
(generated from Inter 4.1 with fontkit; regenerate with the script described
in `packages/render/src/icons/README.md` if the font changes).

## Steering from YAML

| Symptom | Lever |
|---|---|
| Wrong sibling order | `arrange: [{ node: x, order: [...] }]` or reorder the file |
| Too wide | `direction: down` on the view or on a container hint |
| Container should be a grid | `arrange: [{ node: x, as: grid, columns: 3 }]` |
| Too much detail | `collapse: [x]` |
| Not enough | `expand: [x]` or `detail: 1` |
| Noise | `hide: [x]` in that view only |
| Two halves should face each other | `arrange: [{ node: x, as: mirror, order: [a, b], divider: true }]` |
| One thing in the middle | `arrange: [{ node: x, as: ring, center: hub }]` |
| Explicit tiers | `arrange: [{ node: x, layers: [[a, b], [c]] }]` |
| Tree or file listing | `arrange: [{ node: x, as: outline }]` with `style: { frame: none }` on x |
| Rows and columns by tag | `arrange: [{ node: x, as: matrix, matrix: { rows: [...], columns: [...] } }]` |
| Not sure | `vantage explore <file> --view <id>` and look |
