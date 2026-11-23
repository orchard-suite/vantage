# Vantage

Code-first diagrams with human-grade layout. Read `README.md` for the shape
of the repository and `docs/agent-guide.md` for the language.

This repository is public and estate-neutral. Every name in a test, an
example, or a doc comes from the fixture world:
https://github.com/orchard-suite/hedge/blob/main/docs/fixtures.md.

## Docs and decisions

`vantage.yaml` at the root points at this repository's diagram set, its
pages, and its decision records in a Vantage hub; the estate's repository
map says which hub. Read the records in its `decisions` registry before
changing the code they govern; `VAN-NNNN` in a comment or a doc cites one.
A decision that shapes how Vantage is built gets a record there, never a
file here. A change to code a box's evidence cites moves that tie in the
same pass.

## Working here

- Bun monorepo. `bun install`, `bun run build` (viewer bundle), `bun run check`
  (typecheck, tests, file-size gate). Tests sit next to their source.
- The layout engine is the product. A change to `packages/layout` is verified
  by rendering `examples/*/*.vantage.yaml` to PNG and looking at the pictures,
  not only by the metrics. `bun packages/cli/src/main.ts render <file>
  --format png --out out/<name>`.
- The authoring guide in `docs/agent-guide.md` is what the MCP server hands to
  agents. Keep it true to the engine: a behaviour change lands with its guide
  change in the same commit.
- Every size lives in `packages/layout/src/style.ts`. Every color, radius,
  shadow, and motion value lives in `packages/render/src/tokens.ts` (the
  chrome and the hub pages) and `packages/render/src/theme.ts` (the
  picture). Do not scatter constants.
- Files stay under 600 lines; `scripts/check-file-sizes.sh` enforces it.
- Golden layouts: `packages/layout/goldens/*.json` hold a signature per
  example view. A layout change that moves anything fails `bun run test` until
  you look at the pictures and run `bun run goldens`. Refresh goldens in the
  same commit as the engine change.
- `docs/spec.md` is the plan of record for the platform. A requirement that
  changes lands with its spec change.
- The agent is the first consumer (VAN-0002). A tool, an
  answer, or a line of instruction is designed for the agent that pays
  for it: an answer has a size limit and names the call that reads more,
  a write sends what changed, and a file never passes through the model.
  A new kind of content brings a text form and an outline, never its own
  read and write tools (VAN-5002).
- Tracked work is `packages/hub/src/tracking/`. An item's state changes
  only by appending an event through `store.ts`, and one fold in
  `state.ts` turns events into state; a new kind of change is a new event
  type, never a column the history cannot explain (VAN-3006).
  Every move passes the one gate in `gate.ts`. A feature callers need is a
  change to the nine verbs (VAN-5001); moving an item route's
  shape means `VANTAGE_WRITE_CONTRACT=1` on purpose, with a new version.
- Connectors and publish targets are plugin interfaces
  (`packages/connectors/src/connector.ts`, `packages/publish/src/target.ts`).
  A new source or destination is one file plus fixture tests; never a special
  case in the hub.
- No em dashes or en dashes in text a person reads: docs, guide, viewer strings.

## Delivery

Agents push to main and land with `make land` (`make land BRANCH=<branch>`
from a worktree): it runs the full check on this machine, then
`release-damnit land`. CI runs the same check on GitHub's hosted runners
(`.github/workflows/test.yml`) before every release and on every pull
request.
