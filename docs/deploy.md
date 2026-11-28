# Deploying the hub

One image, `ghcr.io/orchard-suite/vantage`, four commands: `web`, `worker`,
`migrate`, and `connector`. One Postgres. One blob location (a shared volume, or Azure Blob).
Web and worker pods are stateless; replicas are a number. The Helm chart in
`deploy/helm/vantage` installs all of it.

## Configuration

Every setting is an environment variable, validated at start. A missing or
malformed value stops the process with the variable named.

| Variable | Meaning |
|---|---|
| `DATABASE_URL` | Postgres connection string (the primary) |
| `DATABASE_AUTH` | `password` (default): the password in `DATABASE_URL`. `azure`: an Entra token for the pod's workload identity is the password, so the URL carries the user and no password |
| `DATABASE_READ_URL` | Optional; a read replica or a service over all instances, for reads that tolerate a moment of lag |
| `PUBLIC_URL` | The URL readers use; links, embeds, and OIDC redirects are built from it |
| `AUTH_MODE` | `oidc` (Entra or any issuer), `proxy` (trusted `X-Forwarded-User` and `X-Forwarded-Groups` from a front door), `none` (local development only) |
| `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_GROUPS_CLAIM` | Required when `AUTH_MODE=oidc`; groups map to teams |
| `OIDC_CLIENT_ASSERTION_FILE` | Instead of `OIDC_CLIENT_SECRET`: a file holding a signed token the issuer trusts as the client's credential, read on every use (Entra workload identity) |
| `OIDC_API_SCOPE` | Optional; the scope the hub exposes at the issuer (Entra: `access_as_user`). Set with `OIDC_ISSUER`, every bearer route also takes access tokens the issuer signs for the hub, under `oidc` or `proxy` sign-in, so an agent or a module acts as the person (see "Agents that sign in with the issuer" and "Modules") |
| `OIDC_API_AUDIENCE` | Optional; the hub's application URI, accepted as an audience beside `OIDC_CLIENT_ID`. Default `api://<OIDC_CLIENT_ID>`. A front door hub with no `OIDC_CLIENT_ID` names itself with this alone |
| `OIDC_PERSON_CLAIM` | The claim that names a person the same in every app's tokens. Default `sub`; set `oid` on Entra, whose `sub` differs per app. A browser sign-in, a front door, and every app's token then reach one user (VAN-2006) |
| `SIGN_IN_GROUPS` | Optional, comma separated; only people in one of these groups (the OIDC groups claim, or the front door's groups header) may sign in |
| `TEAM_WORKSPACES` | `everyone` (default) or `granted`: only admins and the people an admin lets make team workspaces |
| `PUBLICATION_APPROVAL` | `true` runs a publication only once an admin approves it; default `false` |
| `CONNECTOR_APPROVAL` | `true` takes a connector's pushes only once an admin approves it, and again after its kind, app, or settings change; default `false` |
| `CONNECTOR_ISSUER` | Optional; the issuer that signs connectors' app-only tokens. Default `OIDC_ISSUER`. A hub in proxy mode sets it to let connectors sign in (see "Connectors") |
| `CONNECTOR_AUDIENCE` | Optional; the audience a connector's token must name. Default `OIDC_API_AUDIENCE`, else `api://<OIDC_CLIENT_ID>` |
| `CONNECTOR_ROLE` | The app role a connector's token must carry; default `Vantage.Connector` |
| `GUEST_LINKS` | `false` turns guest links off across the hub: none are made and none open; default `true` |
| `SESSION_SECRET` | At least 32 characters; seals the session cookie |
| `SECRETS_KEY` | At least 32 characters; seals publication target secrets at rest |
| `BLOB_DRIVER`, `BLOB_PATH`, `AZURE_BLOB_URL` | `fs` with a path, or `azure` with a container URL |
| `WORKER_EMBEDDED` | `true` runs the worker inside the web process. A render holds the process for as long as it takes, so only use it where nobody reads while it runs (local development) |
| `PORT` | Default 4848 |
| `LOG_LEVEL` | `debug`, `info`, `warn`, `error`; JSON lines on stdout |
| `TIME_ZONE` | The estate's time zone, an IANA name (`Europe/Berlin`); default `UTC`. Every day the hub works out for itself is the day in this zone: a record's Last updated when a write leaves it out, an imported record's date, a published copy's date, and the dates on pages and outlines. A day a person gives is kept as given. The hub refuses to start on a name that is not a zone. Schedules (`REVIEW_CRON`) and the AI token windows stay in UTC |
| `FRESHNESS_DAYS` | Default 7; boxes observed longer ago are dimmed |
| `RETENTION_VERSIONS` | Versions kept per document; older ones and their artifacts are collected |
| `PURGE_GRACE_DAYS` | Days a disabled workspace waits before purge |
| `RENDER_THREADS` | Render threads per process; unset, one per core the container may use (its CPU limit), at most 8. Drawing runs on them, never on the event loop, and a worker draws one document's views across all of them. `0` draws in place (tests) |
| `RENDER_TIMEOUT_SECONDS` | Default 300; a render task past it fails and its thread is replaced |
| `RENDER_QUEUE` | Default 200 render tasks waiting per process; past it a request answers 503 with `retry-after` and a job retries |
| `WORKER_CONCURRENCY` | Default 4 jobs one worker runs at once; merging pushed batches keeps going while renders draw |
| `JOB_LEASE_SECONDS` | Default 120; a worker renews the lease on what it runs, and another worker takes back a job whose lease lapsed |
| `SHUTDOWN_GRACE_SECONDS` | Default 20; a stopping worker waits this long for its jobs, then puts them back in the queue. Keep the pod's termination grace above it |
| `HISTORY_DAYS` | Default 30; finished jobs, connector and publication runs, and notifications older than this are pruned. The audit log is kept |
| `OBSERVED_RETENTION_DAYS` | Default 3; an entity or relation a connector stopped reporting is dropped after this many days |
| `DB_POOL` | Default 10 database connections per process, to each of the primary and the read URL |
| `DRAIN_SECONDS` | Default 5; a stopping web pod answers 503 on `/readyz` this long before it closes |
| `FARO_URL`, `FARO_API_KEY` | The Grafana Faro collector the hub pages' browser telemetry is relayed to, as `vantage-web`, through `POST /api/telemetry`; the browser never holds the key. Without both, batches are accepted and dropped, counted in `vantage.browser.batches` by outcome. Exported and embedded copies carry no telemetry |
| `DISPATCH_URL`, `DISPATCH_TOKEN` | Dispatch's API base and a token its desk issued; together they deliver notifications through Dispatch (see Notifications). Unset, notifications are stored only |
| `AI_BASE_URL` | The model API the organization pays for, ending in its version (`https://gateway.example/v1`). Set, authors may revise a document from its open comments and draw a new diagram from a description on the New page; unset, both are off. Claude models are called on `/messages`, the rest on `/responses`, and `/models` lists the models offered |
| `AI_API_KEY`, `AI_MODEL` | Required with `AI_BASE_URL`: the organization's one key, and the model a revision or a generation uses unless the author picks another |
| `AI_KEY_HEADER` | Default `x-api-key`; the header the key goes in. `Authorization` sends it as a bearer token |
| `AI_DAILY_TOKENS` | Default 1000000; each person's daily token limit for revisions and generations until an admin sets the limits on the admin console's AI spend page, which then replace them. The page also shows each person's use by month, model, and kind |
| `RECORDING_MAX_SECONDS` | Default 900 (15 minutes); the longest voice walkthrough an author may save |
| `RECORDING_MAX_MB` | Default 50; the largest voice walkthrough an author may save. The front door must let a request body this size through (for ingress-nginx, `nginx.ingress.kubernetes.io/proxy-body-size`); a take is about 4 MB per 15 minutes. Saved, refused, and deleted recordings are counted in `vantage.recordings` by outcome, and their bytes in `vantage.recording.bytes` |
| `AGENT_SETUP` | Optional; how readers connect an agent, as a JSON array of ways the sidebar's "Let an agent draw it" box shows. Each way names a `client` (`claude-code`, `claude-desktop`, `copilot`, `other`) and one of `run` (a command to copy, such as a plugin install) or `open` (an https link, such as the Copilot agent's chat in Teams), with an optional `name`, `hint`, and `label`. A `claude-desktop` way with neither shows the hub's address to paste as a custom connector, which signs in through the hub. Unset, the box shows the MCP address. The chart sets it from `agents` |
| `OTEL_*` | Standard OpenTelemetry exporter variables; spans cover requests and jobs |

Health: `GET /healthz` (liveness; the body names the running release as `version`, the same release the reader's menu at the sidebar's foot shows), `GET /readyz` (503 only while the pod is stopping; the database and blob checks are reported in the body and logged as `readyz.degraded`, because a shared outage is not a reason to take every pod out).

## Install with Helm

The chart in `deploy/helm/vantage` is the install package. Its defaults are
the recommended setup: two web pods and two worker pods that roll one at a
time, a Postgres cluster with a primary and a standby, and one volume for
rendered files that every pod mounts.

1. Install the CloudNativePG operator once per cluster (or set
   `database.mode=external` and bring your own Postgres):
   `helm install cnpg cloudnative-pg --repo https://cloudnative-pg.github.io/charts -n cnpg-system --create-namespace`.
2. Make the hub's secret: `SESSION_SECRET` and `SECRETS_KEY`, 32 or more
   characters each, plus `OIDC_CLIENT_SECRET` with OIDC, and `DATABASE_URL`
   with an external database. Name it in `secrets.existingSecret`.
3. Install: `helm install vantage deploy/helm/vantage -n vantage --create-namespace -f my-values.yaml`.
   Pods wait for the database on first start; each pod's init container runs
   the migrations under a lock.

With Argo CD, point an Application at this repository's `deploy/helm/vantage`
with `targetRevision: released`: every release reaches the cluster on its
own, chart and image together. The release workflow moves the branch
`released` to a release's commit only after the hub image that commit's
chart names is published and signed, so Argo never renders a chart whose
image is not there yet. Never follow a range over the release tags: a tag
is cut before its image is built. To hold the cluster at one release, set
`targetRevision` to its tag, such as `v3.3.0`. Argo renders without the
cluster, so use `secrets.existingSecret`, never `secrets.generate`.

### What the defaults buy

| Part | Default | Why |
|---|---|---|
| Web | 2 pods, rolling `maxUnavailable: 0`, disruption budget 1, spread across nodes | An upgrade, a drained node, or a lost node never takes the site down |
| Worker | 2 pods, 4 jobs each, 2 render threads each | Renders and source runs go on through an upgrade; a dead worker's jobs come back to the queue when their lease lapses |
| Database | CloudNativePG, 2 instances on different nodes | The standby takes over when the primary's node goes; it also serves reads |
| Files | One `ReadWriteMany` volume | Every pod reads and writes the same rendered files; a render swaps its files in one transaction |

### Storage

`storage.driver=fs` mounts a volume at `/data/blobs`. It must be
`ReadWriteMany` for more than one pod per tier: Longhorn, NFS, CephFS,
Azure Files, or EFS. `storage.driver=azure` uses an Azure Blob container
signed in with workload identity (`serviceAccount.annotations`). Pictures
and icons people uploaded live there and cannot be rebuilt; back it up.

### Database

`database.mode=cnpg` makes a `Cluster` in the release's namespace. With two
or more instances and `readReplicas` on, reads that tolerate a moment of
lag (page lists, search, the bundle) go to the `-r`
service, which reaches every instance, and writes, jobs, and anything read
right after a write go to the primary. `database.cnpg.import` copies another
Postgres in at the first start, for a move. `database.dumps` writes a
nightly `pg_dump` to its own volume for a backup tier that copies files.

`database.mode=external` uses a Postgres you bring: one server can hold the
hub's database beside other services', each with a database and a role of
its own. With `database.auth=azure` the hub signs in to an Azure Database
for PostgreSQL as the pods' workload identity, with no password anywhere:

1. On the server, make the identity a role and give it the database:
   `select * from pgaadauth_create_principal('<identity name>', false, false);`
   then `grant all on database vantage to "<identity name>";` and, in that
   database, `grant all on schema public to "<identity name>";`.
2. Set `database.external.url` to
   `postgresql://<identity name>@<server>.postgres.database.azure.com:5432/vantage?sslmode=require`.
3. Give the pods the identity: `azure.workload.identity/client-id` in
   `serviceAccount.annotations`, and the label
   `azure.workload.identity/use: "true"` in `web.podLabels` and
   `worker.podLabels`.

The hub asks for a new token each time it opens a connection, so an expired
token never stops it. Connect to the server itself, never through its
built-in pooler: live updates use `LISTEN`, which a pooler in transaction
mode drops. The managed server keeps the backups, so `database.dumps` is
refused with this sign-in.

What grows and where it stops:

- Observed items are one row each, keyed by source; a run writes only the
  rows whose content changed, so writes and replication follow the changes
  of a source, not its size.
- The job table holds what is queued and running plus `HISTORY_DAYS` of
  history; it is pruned daily.
- Connections: each process opens up to `DB_POOL` (default 10) to the
  primary and as many to the read service. Keep
  `max_connections` (default 200) above `2 x DB_POOL x (web + worker pods)`
  plus headroom; past that, add a pooler in session mode, because live
  updates use `LISTEN`.
- Past one primary's write capacity, the next step is a bigger primary
  (`database.cnpg.resources`) or a managed Postgres; the hub's schema has
  no cross-row writes that would stop a move.

### Capacity and sizing

Measured on a small self-hosted cluster (VMs on older server-class cores)
with the chart's defaults: two web pods, two worker pods, and a
two-instance database. Each step ran 60 seconds of mixed load from
`scripts/bench/load.ts`: readers opening bundles and views (each pauses 200
to 500 ms between requests), live streams, MCP clients reading and
rendering, authors saving one shared document, and sources of 10,000
entities pushing every 10 seconds, over 61 documents.

| Readers / streams / MCP / authors / sources | Requests a second | Bundle p50 / p95 | MCP read p50 / p95 | Save p50 / p95 | Errors |
|---|---|---|---|---|---|
| 25 / 50 / 4 / 2 / 2 | 60 | 65 / 160 ms | 65 / 145 ms | 145 / 438 ms | 0 |
| 50 / 100 / 8 / 4 / 4 | 77 | 156 / 383 ms | 149 / 390 ms | 477 ms / 4.6 s | 0 |
| 100 / 200 / 16 / 6 / 6 | 129 | 538 ms / 1.3 s | 566 ms / 1.4 s | 770 ms / 6.3 s | 0 |
| 200 / 400 / 24 / 8 / 8 | 124 | 1.5 / 2.6 s | 1.7 / 3.0 s | 2.0 / 3.9 s | 0 |

Two web pods top out near 125 requests a second; past that, answers slow
down and nothing fails. The slow saves are authors racing on one document:
each conflicting save is merged or refused, by design. A rolling restart of
the web pods, a rolling restart of the workers, and killing the database
primary under the first step's load failed no request; the slowest answers
took about 30 seconds while the standby took over.

What each container used at the busiest step:

| Container | CPU | Memory | Default request / limit | For a busy install |
|---|---|---|---|---|
| Web | up to 1.6 cores | up to 350 MiB | 200m, 384Mi / 2, 1Gi | request 1 CPU, 512Mi |
| Worker | up to 1.75 cores | up to 1.5 GiB | 250m, 512Mi / 2, 2Gi | request 1 CPU, 1.5Gi; limit 2Gi |
| Database (primary) | up to 1.3 cores | up to 600 MiB | 250m, 512Mi / 2, 2Gi | request 1 CPU, 1Gi |

The defaults suit a quiet install, which idles near 20m CPU and 250 MiB per
web pod. Add web pods for more readers (`web.autoscaling` scales on CPU);
add worker pods or `worker.renderThreads` when pushes and saves queue
renders (`vantage.jobs.due` climbs). To repeat a run, give the load
client room for every connection: Bun holds at most
`BUN_CONFIG_MAX_HTTP_REQUESTS` requests open (256 by default), and the
script refuses a run that needs more.

### Upgrades without downtime

A release rolls the web pods one at a time: the new pod migrates, starts,
and turns ready before an old one stops. A stopping web pod answers 503 on
`/readyz` for `drainSeconds`, ends its live streams with a reconnect hint
(the viewer reconnects to another pod and fetches anything it missed), and
lets requests in flight finish. A stopping worker waits
`shutdownGraceSeconds` for its jobs, then hands the rest back to the queue.
The database's own upgrades restart the standby first, then switch the
primary role over.

A migration must keep the previous release working, because its pods serve
until the rollout replaces them: add columns and tables, never drop or
rename in the same release that stops using them.

## Local

```sh
export DATABASE_URL=postgres://localhost:5432/vantage PUBLIC_URL=http://localhost:4848 AUTH_MODE=none \
  SESSION_SECRET=$(openssl rand -hex 32) SECRETS_KEY=$(openssl rand -hex 32) BLOB_PATH=./data/blobs WORKER_EMBEDDED=true
bun packages/hub/src/main.ts migrate
bun packages/hub/src/main.ts web
```

Sign the laptop's MCP server in with `vantage login http://localhost:4848`;
it then serves the hub's tools beside the local ones. Any other MCP client
connects to `/mcp` with a bearer token from `POST /api/v1/tokens
{"name":"agent"}`. The hub never runs a model.

## Keeping a hub inside the organization

A hub only an organization's own people use sets four things. In the
chart they are `auth.signInGroups` and the `governance` block.

| Rule | Setting | What it does |
|---|---|---|
| Only our people sign in | `SIGN_IN_GROUPS` | The issuer signs a person in; the hub then refuses anyone in none of the named groups, and makes no account for them |
| Team workspaces stay few | `TEAM_WORKSPACES=granted` | Everyone still gets a personal workspace. Admins make team workspaces from the sidebar, and give the right to others on a person's page in the admin console |
| Nothing leaves on its own | `PUBLICATION_APPROVAL=true` | Authors set publications up; each one runs only after an admin approves it on the Admin page, and again after its destination changes |
| Nothing comes in on its own | `CONNECTOR_APPROVAL=true` | Authors add connectors to their workspace; each one's pushes are refused until an admin approves it on the Admin page, and again after its app or what it reads changes |
| No guest links | `GUEST_LINKS=false` | Nobody makes a link for people without an account. To show a diagram outside, a person exports a copy |

The first person to sign in becomes the admin; sign in first yourself.
Admins see every publication across the organization on the admin
console (`/admin`), with where it sends what, and stop any of them. A stopped
publication runs again only when an admin lets it.

With Entra ID, also lock the door on the Entra side, so a person outside
the groups never gets a token for the hub at all:

1. Register a single-tenant app with the redirect `<PUBLIC_URL>/auth/callback`.
   `OIDC_ISSUER` is `https://login.microsoftonline.com/<tenant id>/v2.0`.
   Give it a client secret, or, where the tenant allows none, a federated
   credential for the web pods' service account
   (`system:serviceaccount:<namespace>:<service account>`, issuer the
   cluster's OIDC issuer). With the federated credential, put the app's
   client id on the service account (`azure.workload.identity/client-id`),
   label the web pods `azure.workload.identity/use: "true"`, and set
   `OIDC_CLIENT_ASSERTION_FILE=/var/run/secrets/azure/tokens/azure-identity-token`:
   the hub then signs in to Entra with the pod's own token, and there is no
   secret to keep or rotate.
2. On its enterprise application, set "Assignment required" to yes and
   assign the group of people who may use it. A dynamic group on member
   accounts (`user.userType -eq "Member"` or a rule on employee fields)
   keeps invited guests of the tenant out.
3. Send the groups claim as "Groups assigned to the application", with the
   group's display name for cloud groups (`cloud_displayname`). The claim
   then holds only the assigned groups, by name, so it never overflows, and
   teams in the hub carry readable names. Put the same name in
   `SIGN_IN_GROUPS`.

A person removed from the group cannot sign in again, but a session they
already hold lasts its seven days, and personal tokens last until they
expire or an admin disables the person. Disable a leaver on the Admin page.

## Agents that sign in with the issuer

An agent platform that signs each person in with OAuth itself, such as
Microsoft Copilot Studio, needs no Vantage token. Expose a scope on the
hub's app and set `OIDC_API_SCOPE`; `/mcp` then takes the issuer's access
token for that scope as the person who signed in, the same user their
browser sign-in made, under the same `SIGN_IN_GROUPS` rule.
The agent platform is set up by hand with the values below; the hub's
resource metadata names the hub itself (see "Agents that sign in through
the hub").

With Entra ID:

1. On the hub's app, set the application ID URI to `api://<client id>`,
   add a delegated scope `access_as_user`, and set the access token version
   to 2 (`requestedAccessTokenVersion: 2`).
2. Add the `groups` (with `cloud_displayname`) and `email` optional claims
   to the access token as well as the ID token, so the hub sees the same
   groups an agent's token carries. Set `OIDC_PERSON_CLAIM=oid`: Entra
   gives each app its own `sub` for a person, and `oid` is the same in
   all of them.
3. Register the agent as its own app: a confidential client with the
   agent platform's callback as its redirect, given the delegated
   permission `access_as_user` on the hub's app, admin consented. Give the
   agent its client id and secret, the authorization URL
   `https://login.microsoftonline.com/<tenant id>/oauth2/v2.0/authorize`,
   the token and refresh URL `.../oauth2/v2.0/token`, and the scopes
   `api://<client id>/access_as_user offline_access`.

When an agent connects, `/mcp` sends it a few lines of instructions: how to climb from an outline to one part, to save every diagram a person asks for with `vantage_write`, and to answer with the link the write gives, `<PUBLIC_URL>/w/<workspace>/<document>`. It lists seven tools and `vantage_tool`, which lists and calls the rest; `/mcp?tools=all` lists every tool, for a client that loads tools on demand itself. Each call is logged as `mcp.tool` with the characters it took and answered, and counted in `vantage.agent.calls` and `vantage.agent.chars` by tool. Some clients, Copilot among them, never show a picture a tool returns, so the link is how the person sees the diagram.

The token lasts about an hour and the agent refreshes it. A person removed
from the assigned group gets no new token, so they lose access within the
hour.

## Modules

A module is an app that keeps its own content and tracks its items in the
hub through the nine verbs (VAN-5001). It calls the hub two ways
(VAN-2005):

- **As itself**, for its own work: loading its kinds file from its
  pipeline (`PUT /api/v1/kinds/<prefix>`), putting items by its own key,
  and reading the change feed. An app-only token from the issuer with the
  role `Vantage.Module`, scoped to the kinds an admin registers for it.
  It never moves or holds an item.
- **As the person**, for what a person does in its screens: a move, a
  hold, a note. A token the issuer gives the module for that person, for
  the hub's scope. The hub judges the move against the person and writes
  the module's client on the event.

With Entra ID:

1. Set up the hub's app as in "Agents that sign in with the issuer"
   (`OIDC_API_SCOPE`, `OIDC_PERSON_CLAIM=oid`), and add the app role
   `Vantage.Module` to it.
2. Register the module as its own app. Give it the role `Vantage.Module`
   and the delegated permission `access_as_user` on the hub's app, and
   consent both as an admin. Give it a workload identity (a federated
   credential for its service account) rather than a secret.
3. An admin registers its client and kinds on the hub:
   `POST /api/v1/apps` with `clientId`, `name`, the `workspace` its kinds
   live in, and `kinds`.
4. The module gets the person's token from Entra. A module that signs the
   person in asks for `api://<hub client id>/access_as_user` on that
   sign-in. A module whose own API sits between the person and the hub
   trades the token its front end sent with the on-behalf-of grant
   (`grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`,
   `requested_token_use=on_behalf_of`) for the same scope.

The token lasts about an hour. A person who loses access at the issuer
gets no new one.

## Agents that sign in through the hub

An MCP client that signs people in with OAuth, such as a custom connector in
Claude, needs nothing set up: the hub is the authorization server for its
own `/mcp`. The client finds the hub from `/mcp`'s 401 and
`/.well-known/oauth-protected-resource/mcp`, registers itself at
`/oauth/register`, sends the person to `/oauth/authorize` to approve it (they
sign in there the way they sign in to every page), and trades the code at
`/oauth/token`. It gets an hour-long personal token and a refresh token that
rotates on every use and lapses after 30 days unused. Each person sees the
apps they connected on their Account page and can disconnect any of them.
To offer it in the sidebar, add `{ client: claude-desktop }` to `agents`: it
shows the hub's address to paste, with the steps.

## Connectors

A connector belongs to one workspace and runs outside the hub, as its own
app. Only that workspace's readers see it and what it observed. The hub
holds no credential for it: the issuer vouches for the app, and the hub
matches the app's client id to the connector. What a connector can read is
exactly what its app can read, so scope the app, not the hub.

On the hub, with Entra ID:

1. On the hub's app, add an app role `Vantage.Connector` (allowed member
   type: applications). Keep the application ID URI `api://<client id>`,
   and set the app's access token version to 2 (`requestedAccessTokenVersion`
   in the manifest), so its tokens name the `/v2.0` issuer.
2. Connector sign-in uses `OIDC_ISSUER` and `api://<OIDC_CLIENT_ID>` (or
   the bare client id) by default. A hub in proxy mode sets
   `CONNECTOR_ISSUER` (`https://login.microsoftonline.com/<tenant id>/v2.0`)
   and `CONNECTOR_AUDIENCE`: the hub app's client id, which a version 2
   token names as its audience (a version 1 token names the application ID
   URI instead, with the issuer `https://sts.windows.net/<tenant id>/`).
3. For the shared pool, add a second app role, `Vantage.ConnectorPool`
   (allowed member type: applications; `CONNECTOR_POOL_ROLE` renames it).
   Register one app for the pool and grant it only that role, admin
   consented. The pool's app reads nothing; it leases runs.

### The shared pool

A connector with an interval (`every`, in minutes) runs in the shared
pool: a few runners beside the hub that run every such connector in the
organization. Memory follows how many runs happen at once (`replicas` x
`concurrency`), not how many connectors exist, so adding connectors never
adds pods. The hub's worker queues each connector's run when its interval
comes round, spread over the interval so connectors do not all start in
the same minute; an author's **Run now** (the Connectors tab,
`POST /api/v1/workspaces/<ws>/connectors/<id>/run`, or the
`vantage_connector_run` tool) queues one at once. At most one run of a
connector waits and only one runs, so a burst of clicks costs one run. The
pool leases each run over `/api/v1/connector-pool/` with its own app, and
runs it as the connector's own app: every connector app trusts the pool's
service account with a federated credential, so the pool's one projected
token signs in as any of them, and a connector reads exactly what its app
may read. The hub holds no credential either way.

A secret a pool connector names is a Key Vault secret URL
(`https://<vault>.vault.azure.net/secrets/<name>`), which the run reads as
the connector's app, so grant each app `Key Vault Secrets User` on its
secrets alone. The pool reads no environment variable for a connector: in
a shared runner every connector would see every other one's. A kind that
reads as the machine it runs on (`kubectl`) cannot run in the pool; it
keeps a runner of its own.

`CONNECTOR_MIN_EVERY_MINUTES` (default 5) is the shortest interval, and
`CONNECTOR_MAX_PER_WORKSPACE` (default 20) the most connectors a workspace
holds.

For each connector:

1. Register an app for it. Grant it the application permission
   `Vantage.Connector` on the hub's app, admin consented, and only the
   reads it needs (for Azure Resource Graph, Reader on the subscriptions or
   resource groups it covers; for a secret, Key Vault Secrets User on that
   secret). In a cluster, give it a federated credential for the pool's
   service account (`system:serviceaccount:<namespace>:connector-pool`,
   audience `api://AzureADTokenExchange`) instead of a secret.
2. An author adds the connector to the workspace:
   `POST /api/v1/workspaces/<ws>/connectors` with `name`, `connector` (the
   kind), `config`, `clientId` (the app's client id), and `every` (minutes
   between runs in the pool). With `CONNECTOR_APPROVAL`, an admin approves
   it on the Admin page. That is all; the pool runs it.
3. Only a connector with no interval (a `kubectl` one, or one you run from
   a pipeline) runs on a schedule of its own, with the same image:
   `connector run <connector id>`, with `VANTAGE_HUB`, `VANTAGE_TOKEN_URL`
   (`https://login.microsoftonline.com/<tenant id>/oauth2/v2.0/token`),
   `AZURE_CLIENT_ID`, `VANTAGE_SCOPE` (`api://<hub client id>/.default`),
   and either the workload identity token file (`AZURE_FEDERATED_TOKEN_FILE`,
   set by the workload identity webhook) or `VANTAGE_CLIENT_SECRET`. The
   Azure connector reads Azure with the same identity. A secret the
   connector's settings name by reference (the Orrery `token`, the
   Cloudflare `token`) is the runner's environment variable of that name.
   The chart runs it for you: list it under `connectors.runners` with its
   connector id, its app's client id, and its secrets as `env`, and set
   `connectors.tokenUrl` and `connectors.scope` once. Turn the pool on with
   `connectors.pool.enabled` and `connectors.pool.clientId` (the pool's
   app). Each runner of its own is a
   CronJob with the hub's image and its own service account,
   `connector-<name>`, whose projected token is the assertion; federate the
   app with `system:serviceaccount:<namespace>:connector-<name>`, audience
   `api://AzureADTokenExchange`, and it needs no secret at all.

Another workspace that wants the same data adds its own connector, with the
same name and the same app if it likes; the two never share what they
observed. A run that fails before it pushes shows on the workspace's
Connectors tab with its error.

## Notifications

The hub stores every notification (drift found, a review changed
something, a publication failed, a person mentioned) and delivers none
itself. Dispatch delivers them: email, Teams, a person, a group, or an
escalation chain. Give the hub `DISPATCH_URL` and `DISPATCH_TOKEN` (a
token the Dispatch desk issued, named for this hub, which Dispatch shows
as the producer). Without both, notifications are stored only. Workers and
web pods both send: workers for drift, reviews, and publications, web
pods for mentions.

Each notification is one event, `POST <DISPATCH_URL>/v1/events`:

| Kind | Sent when | Severity | To |
|---|---|---|---|
| `vantage.drift` | A source disagrees with a document anew | warning | The workspace's `to` |
| `vantage.review` | The scheduled review changed documents | info | The workspace's `to` |
| `vantage.publication_failed` | A publication run failed | warning | The workspace's `to` |
| `vantage.mention` | A comment mentioned a person | info | That person's email alone |

The event's `key` is the notification's id, its link opens Vantage, and
every event carries the label `workspace` (the workspace's slug). A Dispatch
subscription can take a workspace's events by that label with no `to` at
all; `to` addresses them directly. A workspace sets it under
`settings.notifications` (`PATCH /api/v1/workspaces/<ws>`):

| Setting | What it holds |
|---|---|
| `to` | Up to 20 of `{"person": "<email>"}`, `{"group": "<slug>"}`, `{"chain": "<slug>"}`; groups and chains are Dispatch's |
| `kinds` | Any of `drift`, `review`, `publication-failed`, `mention`; default all |

Dispatch's answer, or its refusal, is stored on the notification
(`GET /api/v1/workspaces/<ws>/notifications`), so a refused event (a group
Dispatch does not know) shows where it happened.

## Behind a front door

With `AUTH_MODE=proxy` every page and the browser API take the person from
the front door's headers, so only the door may reach them. Agents never
pass the door: route these paths around it, and strip any
`X-Forwarded-User`, `X-Forwarded-Email`, and `X-Forwarded-Groups` a caller
sent on them.

| Path | Why it skips the door |
|---|---|
| `/mcp` | Bearer tokens only (Vantage tokens, or the issuer's with `OIDC_API_SCOPE`) |
| `/auth/device`, `/auth/device/token` | Start and poll of `vantage login`; the approve page stays behind the door |
| `/.well-known/oauth-protected-resource`, `/.well-known/oauth-protected-resource/mcp`, `/.well-known/oauth-authorization-server`, `/oauth/register`, `/oauth/token` | Agents that sign in through the hub call these from their own servers; `/oauth/authorize` stays behind the door, where the person approves |
| `/api/v1/` and below, with `Authorization: Bearer` | Modules, the laptop's working copy, and scripts; bearer tokens only, and a request without one stays behind the door |
| `/api/v1/connector/` and below | Connector runners; only connectors' app tokens from the issuer |
| `/api/v1/connector-pool/` and below | The shared pool; only the pool app's token from the issuer |
| `/healthz`, `/readyz` | Health checks |

## Telemetry

With `OTEL_EXPORTER_OTLP_ENDPOINT` set the hub exports spans and metrics.
Every request is a span named by its route pattern. The metrics are
`http.server.request.duration` (by `http.route`, `http.request.method`,
`http.response.status_code`), `vantage.build_info` (1, with `version`),
`vantage.jobs` (by `task` and `outcome`), `vantage.job.duration` (by
`task`), and `vantage.jobs.due` (queued jobs whose time has passed).

## Scaling notes

- Rate limits are per pod. Two web pods double the effective guest-link and
  push limits; set them with that in mind.
- Live updates fan out through Postgres `LISTEN` and `NOTIFY`; no extra
  service is needed.
- Rendering is CPU bound and runs on the worker's render threads, once per
  version and again when a bound source changes what the picture shows; an
  overlay whose inputs match the last render draws nothing. One document's
  views are drawn across all the worker's render threads, so a worker's
  CPU limit is how fast a large save draws. A view's SVG and PNG and the
  standalone HTML are made on first request. Readers get the stored
  bundle's shell as written, with a 304 when their copy is current, and
  each view's entry from `/api/bundle/view`, which their browser keeps for
  the entry's digest. Opened, folded,
  zoomed, and depth pictures are laid out by the reader's browser from the
  bundle's layout kit, in a worker loaded from `/engine.js`.
- A render records the release that drew it. Opening a document drawn by
  an older release queues its redraw, so after an upgrade every document
  a reader opens is drawn again by the new release, even when an old
  worker took the upgrade's own redraw jobs during the rollout.
- A save lays out only the views it changed: every other view is taken from
  the document's last render. Until the new version's pictures are stored,
  readers see the last drawn version with a "Drawing your change" note,
  and the view on their stage laid out by their own browser from the new
  version's kit (`/api/bundle/kit`).
- `render.picture` logs `ranges` (views drawn side by side) and `redrawn`
  (ranges drawn again because the last render's centres no longer held).
- Watch `vantage.render.first_picture.duration` (from a save until its first
  picture is stored) against the 4 s target and the 1 s objective, and
  `vantage.render.pass.duration` by `trigger` for each render.
- Throughput scales with worker threads and pods; the job table hands each
  job to one worker, and one queued overlay per document absorbs a burst of
  source runs.
- `scripts/bench/save.ts` saves a document, then edits its views one at a
  time, and prints each save's time to its picture and to its whole render;
  `scripts/bench/render.ts` measures a render at a given number of observed
  entities through the hub itself; `scripts/bench/load.ts` runs readers,
  live streams, MCP clients, authors on a shared document, and pushing
  sources against a running hub at once; `scripts/bench/load-saves.ts`
  saves a 160-view document from several agents while readers fetch its
  bundle, and prints each save's time until a reader is served its picture.
  CI runs a small version through `scripts/bench/load-compare.ts`: the last
  release and this build take turns on the same runner, three rounds each,
  and the build fails when the median of its rounds' p95 passes 1.25 times
  the release's. A shared runner's speed swings from run to run, so a fixed
  limit in seconds would judge the machine, not the change. A speed target
  is measured on a copy of real data, not on CI.
