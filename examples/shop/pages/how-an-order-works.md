## The shopper arrives {#arrive}

Every request from [[shoppers]] lands on [[front-door]] first. It is the only public entry point, and it carries the web application firewall and the content cache. The [[dns-zone]] resolves `shop.example.com` to it.

## The web app calls the APIs {#apis}

The [[web-app]] renders pages and calls two services. The [[catalog-api]] answers what can be bought. The [[orders-api]] takes the order.

| Service | Owns | Store |
|---|---|---|
| [[catalog-api]] | Products and prices | [[catalog-db]] |
| [[orders-api]] | Orders | [[orders-db]] |

Prices are cached in the [[cache]] for a short time, so a price change can take a minute to show.

## Orders go async {#async}

The [[orders-api]] writes the order to [[orders-db]] and publishes to [[order-events]]. The [[order-worker]] picks the event up and takes payment through [[stripe]].

```text
POST /orders        -> 201 Created
order.placed event  -> Order Worker
capture payment     -> Stripe
```

Payment is idempotent on the order id, so a retried event never charges twice. The step by step is in the [purchase sequence](view:purchase), and the release path is in the [runbook](view:runbook#release).

## Where to look when it breaks {#breaks}

Start at [the Orders API on the request picture](view:requests/orders-api). Then read [what the workloads lean on](view:platform).
