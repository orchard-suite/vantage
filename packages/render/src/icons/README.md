# Icon packs

Icon files live in `packages/render/icons/<pack>/<name>.svg`. This directory holds the
catalog the renderer reads (`index.json`) and the Lucide mapping for the generic pack
(`generic-map.json`).

## Layout

- `packages/render/icons/<pack>/<name>.svg`: one icon per file.
- `packages/render/icons/<pack>/LICENSE.txt`: license or terms for that pack, with the source URL and download date.
- `packages/render/src/icons/index.json`: `{ packs: { <pack>: [<name>...] }, aliases: { "<pack>/<alias>": "<pack>/<name>" } }`.
  `packs` lists real icon files. `aliases` lists extra files that duplicate a real icon under a friendlier name.
- `packages/render/src/icons/generic-map.json`: generic icon name to Lucide icon name.

An icon reference is `<pack>/<name>`. Both real names and aliases resolve to a file on disk, so a
renderer can read `icons/<pack>/<name>.svg` directly without consulting `aliases`.

## File format

Every file is normalized so it can be inlined into a larger SVG:

- Single root `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">`, no `width` or `height`.
- Sources with a different viewBox are wrapped in `<g transform="translate(...) scale(...)">`, scaled uniformly to fit 24 and centered.
- No `<script>`, `<title>`, `<desc>`, `<metadata>`, comments, editor namespaces, `<image>`, or external references.
- Every `id` (and, where a `<style>` block exists, every class name) is prefixed with the icon name so many icons can be inlined in one document.
- Brand-colored packs (azure, aws, k8s) keep their original colors. `generic` keeps `stroke="currentColor" fill="none"`. `brand` uses `fill="currentColor"`.

## Packs

| Pack | Icons | Aliases | Source | Version / date | License |
| --- | ---: | ---: | --- | --- | --- |
| `generic` | 100 | 0 | [lucide-static](https://www.npmjs.com/package/lucide-static) | 1.61.0, npm, 2026-10-26 | ISC (some icons MIT via Feather); see `icons/generic/LICENSE.txt` |
| `azure` | 642 | 43 | [Azure architecture icons](https://learn.microsoft.com/en-us/azure/architecture/icons/) | Azure_Public_Service_Icons_V24.zip, 2026-10-26; plus [Microsoft Entra architecture icons](https://learn.microsoft.com/en-us/entra/architecture/architecture-icons) Oct 2023 | Microsoft icon terms: permitted in architecture diagrams, training materials, documentation; see `icons/azure/LICENSE.txt` |
| `aws` | 318 | 18 | [AWS Architecture Icons](https://aws.amazon.com/architecture/icons/) | Icon-package_07312026.zip (2026-07-31 release), 2026-10-26 | AWS permits customers and partners to use them in architecture diagrams; see `icons/aws/LICENSE.txt` |
| `k8s` | 39 | 21 | [kubernetes/community icons](https://github.com/kubernetes/community/tree/master/icons) | master @ 6c7f904744192325668db7629e98c114cba15e0a, 2026-10-26 | Apache-2.0 (or CC-BY-4.0); see `icons/k8s/LICENSE.txt` |
| `brand` | 21 | 0 | [simple-icons](https://www.npmjs.com/package/simple-icons) | 16.36.0, npm, 2026-10-26 | CC0-1.0; brands keep their own trademark rights; see `icons/brand/LICENSE.txt` |

### generic

Lucide outline icons. Names are Vantage concepts; the mapping to Lucide is below and in `generic-map.json`.

| Vantage name | Lucide icon |
| --- | --- |
| `user` | `user` |
| `users` | `users` |
| `system` | `server-cog` |
| `service` | `cog` |
| `app` | `layout-grid` |
| `browser` | `app-window` |
| `mobile` | `smartphone` |
| `desktop` | `monitor` |
| `terminal` | `terminal` |
| `api` | `plug` |
| `gateway` | `door-open` |
| `loadbalancer` | `split` |
| `cdn` | `waypoints` |
| `dns` | `signpost` |
| `firewall` | `brick-wall` |
| `tunnel` | `cable` |
| `function` | `square-function` |
| `job` | `briefcase` |
| `worker` | `hard-hat` |
| `agent` | `bot-message-square` |
| `model` | `brain` |
| `database` | `database` |
| `cache` | `zap` |
| `storage` | `archive` |
| `queue` | `list-ordered` |
| `topic` | `rss` |
| `search` | `search` |
| `key` | `key` |
| `identity` | `fingerprint` |
| `monitoring` | `activity` |
| `config` | `sliders-horizontal` |
| `registry` | `library` |
| `repo` | `folder-git-2` |
| `pipeline` | `route` |
| `gitops` | `git-merge` |
| `cloud` | `cloud` |
| `subscription` | `receipt` |
| `folder` | `folder` |
| `region` | `map` |
| `zone` | `map-pin` |
| `network` | `network` |
| `subnet` | `square-dashed` |
| `cluster` | `boxes` |
| `namespace` | `folder-tree` |
| `pod` | `hexagon` |
| `vm` | `pc-case` |
| `host` | `server` |
| `device` | `monitor-smartphone` |
| `container` | `container` |
| `package` | `package` |
| `component` | `component` |
| `class` | `braces` |
| `interface` | `puzzle` |
| `file` | `file` |
| `socket` | `plug-zap` |
| `external` | `external-link` |
| `note` | `sticky-note` |
| `mail` | `mail` |
| `calendar` | `calendar` |
| `lock` | `lock` |
| `shield` | `shield` |
| `globe` | `globe` |
| `server` | `server` |
| `cpu` | `cpu` |
| `disk` | `hard-drive` |
| `chip` | `microchip` |
| `bell` | `bell` |
| `clock` | `clock` |
| `link` | `link` |
| `settings` | `settings` |
| `tag` | `tag` |
| `box` | `box` |
| `layers` | `layers` |
| `workflow` | `workflow` |
| `bot` | `bot` |
| `sparkles` | `sparkles` |
| `wifi` | `wifi` |
| `router` | `router` |
| `printer` | `printer` |
| `camera` | `camera` |
| `phone` | `phone` |
| `home` | `house` |
| `building` | `building` |
| `factory` | `factory` |
| `truck` | `truck` |
| `bank` | `landmark` |
| `credit-card` | `credit-card` |
| `chart` | `chart-bar` |
| `table` | `table` |
| `image` | `image` |
| `video` | `video` |
| `music` | `music` |
| `map` | `map-pinned` |
| `flag` | `flag` |
| `star` | `star` |
| `heart` | `heart` |
| `check` | `check` |
| `warning` | `triangle-alert` |
| `info` | `info` |
| `help` | `circle-help` |

### azure

Names are the service name from the zip, slugified: lowercase, non-alphanumerics to `-`, numeric id prefix dropped
(`10023-icon-service-Kubernetes-Services.svg` becomes `kubernetes-services`). The same icon shipped in several
category folders is kept once. Two distinct icons share a service name in the source; the lower id keeps the plain
name and the other gets a `-2` suffix: `workspaces` / `workspaces-2`, `load-balancer-hub` / `load-balancer-hub-2`.

The V24 zip has no standalone Microsoft Entra ID icon, so `entra-id`, `entra-id-governance`, `entra-workload-id`
and `entra-product-family` come from the Microsoft Entra architecture icons set (same Microsoft terms).

Aliases:

| Alias | Icon |
| --- | --- |
| `aks` | `kubernetes-services` |
| `app-service` | `app-services` |
| `function-app` | `function-apps` |
| `key-vault` | `key-vaults` |
| `storage-account` | `storage-accounts` |
| `cosmos-db` | `azure-cosmos-db` |
| `service-bus` | `azure-service-bus` |
| `event-grid` | `event-grid-topics` |
| `container-registry` | `container-registries` |
| `container-apps` | `container-apps-environments` |
| `virtual-network` | `virtual-networks` |
| `vpn-gateway` | `virtual-network-gateways` |
| `application-gateway` | `application-gateways` |
| `front-door` | `front-door-and-cdn-profiles` |
| `load-balancer` | `load-balancers` |
| `firewall` | `firewalls` |
| `dns-zone` | `dns-zones` |
| `private-endpoint` | `private-endpoints` |
| `log-analytics` | `log-analytics-workspaces` |
| `managed-identity` | `managed-identities` |
| `subscription` | `subscriptions` |
| `resource-group` | `resource-groups` |
| `management-group` | `management-groups` |
| `api-management` | `api-management-services` |
| `redis-cache` | `cache-redis` |
| `bastion` | `bastions` |
| `nat-gateway` | `nat` |
| `static-web-app` | `static-apps` |
| `cdn` | `cdn-profiles` |
| `openai` | `azure-openai` |
| `data-factory` | `data-factories` |
| `synapse` | `azure-synapse-analytics` |
| `databricks` | `azure-databricks` |
| `automation` | `automation-accounts` |
| `backup` | `backup-vault` |
| `defender` | `microsoft-defender-for-cloud` |
| `sentinel` | `azure-sentinel` |
| `devops` | `azure-devops` |
| `blob-storage` | `blob-block` |
| `azure-files` | `storage-azure-files` |
| `virtual-machines` | `virtual-machine` |
| `sql-db` | `sql-database` |
| `active-directory` | `entra-id` |

`sql-database`, `event-hubs`, `application-insights`, `monitor`, `subnet`, `app-configuration`, `virtual-machine`,
`machine-learning`, `logic-apps` and `policy` are real icon names, so they need no alias. `files` is the generic
"Files" icon from the set; the Azure Files service icon is `storage-azure-files` (alias `azure-files`).

### aws

Architecture-Service-Icons at 48px, named by service: strip `Arch_`, the `_48` suffix and a leading `Amazon-` or
`AWS-`, then slugify (`Arch_Amazon-EC2_48.svg` becomes `ec2`). Two services ship under two categories with
different category colors (`compute-optimizer`, `kinesis-video-streams`); the first category alphabetically wins.
Architecture-Group-Icons are included as `group-<slug>` (`group-region`, `group-public-subnet`, ...).
Resource icons and category icons are not included.

Aliases:

| Alias | Icon |
| --- | --- |
| `s3` | `simple-storage-service` |
| `sqs` | `simple-queue-service` |
| `sns` | `simple-notification-service` |
| `ses` | `simple-email-service` |
| `eks` | `elastic-kubernetes-service` |
| `ecs` | `elastic-container-service` |
| `ecr` | `elastic-container-registry` |
| `ebs` | `elastic-block-store` |
| `elb` | `elastic-load-balancing` |
| `vpc` | `virtual-private-cloud` |
| `iam` | `identity-and-access-management` |
| `kms` | `key-management-service` |
| `msk` | `managed-streaming-for-apache-kafka` |
| `cdk` | `cloud-development-kit` |
| `glacier` | `simple-storage-service-glacier` |
| `group-vpc` | `group-virtual-private-cloud-vpc` |
| `group-account` | `group-aws-account` |
| `group-cloud` | `group-aws-cloud` |

### k8s

`svg/resources/labeled`, `svg/infrastructure_components/labeled` and `svg/control_plane_components/labeled`,
named by the upstream abbreviation (`c-role` is renamed `crole`). Long-form aliases point at the abbreviations.

| Alias | Icon |
| --- | --- |
| `deployment` | `deploy` |
| `service` | `svc` |
| `ingress` | `ing` |
| `configmap` | `cm` |
| `statefulset` | `sts` |
| `daemonset` | `ds` |
| `replicaset` | `rs` |
| `namespace` | `ns` |
| `serviceaccount` | `sa` |
| `rolebinding` | `rb` |
| `clusterrolebinding` | `crb` |
| `clusterrole` | `crole` |
| `endpoints` | `ep` |
| `storageclass` | `sc` |
| `volume` | `vol` |
| `networkpolicy` | `netpol` |
| `api-server` | `api` |
| `kube-proxy` | `k-proxy` |
| `scheduler` | `sched` |
| `controller-manager` | `c-m` |
| `cloud-controller-manager` | `c-c-m` |

### brand

Monochrome logos from simple-icons with `fill="currentColor"`: `android`, `anthropic`, `apple`, `argo`, `claude`, `cloudflare`, `docker`, `github`, `gitlab`, `grafana`, `helm`, `kafka`, `linux`, `nginx`, `postgresql`, `prometheus`, `proxmox`, `rabbitmq`, `redis`, `terraform`, `traefik`.
simple-icons no longer ships `loki`, `windows`, `slack`, `microsoftteams` or `openai`, so those are absent.

## Rebuilding

The packs were produced by a one-off normalizer run outside the repo (sources downloaded to a temp dir, parsed with
`@xmldom/xmldom`, rewritten as described above). To refresh a pack, download the new source, apply the same rules,
regenerate `index.json`, and update the version and date in the table above and in the pack's `LICENSE.txt`.
