# Vantage examples

Three made-up diagram sets. `shop` is the toy that shows every view kind,
`harbor` is the toy that shows every story primitive, and `requests` is a
kind of tracked item with a lifecycle of its own. Each view answers one
question; the picker reads as an arc: Context, then requests and platform,
then slices, then processes.

## Render

```sh
bun packages/cli/src/main.ts lint examples/<set>/<file>.vantage.yaml
bun packages/cli/src/main.ts render examples/<set>/<file>.vantage.yaml --format png --out out/<set>
bun packages/cli/src/main.ts serve examples/<set>/<file>.vantage.yaml   # live viewer on :4747
```

`--view <id>` renders one view. `--format svg|html|json` are also available.

## shop

`examples/shop/shop.vantage.yaml`. A made-up store on Azure. One of every
view kind: relation, sequence, flow with lanes, walkthrough. A few boxes are
bound; `live.batch.json` holds made-up batches (a catalog with firing
alerts, Jira issues, GitHub pull requests) to lay over them with
`render --observed examples/shop/live.batch.json`. The Data view opts its
exports into the open item counts.

## harbor

`examples/harbor/harbor.vantage.yaml`. A made-up retailer moving a monolithic
storefront (web, API, SQL, a nightly worker, an identity server) from a
colocation datacenter to an Azure landing zone: two subscriptions with a
monthly budget each, a hub and spoke network with a site-to-site VPN back to
the datacenter, Front Door with a rules engine that redirects the legacy
hostname, Terraform delivered by GitHub Actions through two service
principals, and people in roles scoped to resource groups. Every story
primitive appears once where it fits: facts, value cards, bullets, icon
inventories, stickies and callouts, outline, mirror, ring, tiers, matrix,
highlights, numbered paths with a narrative and legend, and a page.

| View | Question |
|---|---|
| Context | Who uses Harbor, where does it run today, and where is it going? |
| Subscriptions | What does each subscription hold, and how much may it spend each month? |
| Network | How do the spokes and the datacenter hang off the hub? |
| Requests | How does a shopper's request reach the storefront in prod, and what runs beside it? |
| Public Services | Which services face the internet, in prod and in test alike? |
| Hostnames | Which URL does each environment answer, and who terminates it? |
| Legacy Redirect | What happens when a shopper opens the old address, shop.harbor.example? |
| Access | Who may touch which resource group, and through which role? |
| Delivery | How does a Terraform change reach each subscription? |
| Shared Services | What does every environment lean on, and who gets paged? |
| Cutover Night (sequence) | What happens, in order, on the night the storefront moves? |
| Landing Zone Poster (page) | One page for the steering meeting: what are we building, how is it wired, and who may touch what? |

## requests

`examples/requests/requests.vantage.yaml`. A kind of tracked item: an access
request. Saved in a hub, it becomes the kind `ACC`, and the hub refuses any
move its lifecycle view does not draw.

| View | Question |
|---|---|
| How an access request moves (lifecycle) | Who decides an access request, and what does each move need? |

## Authoring rules used here

- Every relation has a verb-phrase label, the way a real set would read it
  from a repository (a manifest, a Terraform file, an ADR, a workflow).
- Names are two or three words; the machine name is the `subtitle`.
- Relations are tagged; each relation view includes by tag, then uses
  `collapse`, `hide`, `direction`, and `arrange` to steer the picture.
- No secrets, GUIDs, or personal emails.
