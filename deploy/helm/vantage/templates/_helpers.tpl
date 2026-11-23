{{/* Names, labels, and the parts web and worker pods share. */}}

{{- define "vantage.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 50 | trimSuffix "-" -}}
{{- else if contains .Chart.Name .Release.Name -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name .Chart.Name | trunc 50 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}

{{- define "vantage.labels" -}}
app.kubernetes.io/name: vantage
app.kubernetes.io/instance: {{ .Release.Name }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
helm.sh/chart: {{ printf "%s-%s" .Chart.Name .Chart.Version }}
{{- end -}}

{{- define "vantage.selector" -}}
app.kubernetes.io/name: vantage
app.kubernetes.io/instance: {{ .root.Release.Name }}
app.kubernetes.io/component: {{ .component }}
{{- end -}}

{{- define "vantage.image" -}}
{{- printf "%s:%s" .Values.image.repository (default (printf "v%s" .Chart.AppVersion) .Values.image.tag) -}}
{{- end -}}

{{- define "vantage.serviceAccount" -}}
{{- if .Values.serviceAccount.create -}}{{ default (include "vantage.fullname" .) .Values.serviceAccount.name }}{{- else -}}{{ default "default" .Values.serviceAccount.name }}{{- end -}}
{{- end -}}

{{/* The Secret holding SESSION_SECRET and SECRETS_KEY (and the rest the operator provides). */}}
{{- define "vantage.secretName" -}}
{{- if and (not .Values.secrets.existingSecret) (not .Values.secrets.generate) -}}
{{- fail "set secrets.existingSecret to a Secret with SESSION_SECRET and SECRETS_KEY (see values.yaml), or secrets.generate=true with helm install" -}}
{{- end -}}
{{- default (printf "%s-secrets" (include "vantage.fullname" .)) .Values.secrets.existingSecret -}}
{{- end -}}

{{- define "vantage.dbCluster" -}}
{{- printf "%s-db" (include "vantage.fullname" .) -}}
{{- end -}}

{{- define "vantage.claim" -}}
{{- default (printf "%s-files" (include "vantage.fullname" .)) .Values.storage.fs.existingClaim -}}
{{- end -}}

{{/* Settings the chart owns, then the database addresses. */}}
{{- define "vantage.env" -}}
- name: PUBLIC_URL
  value: {{ .Values.publicUrl | quote }}
- name: AUTH_MODE
  value: {{ .Values.auth.mode | quote }}
{{- if eq .Values.auth.mode "oidc" }}
- name: OIDC_ISSUER
  value: {{ required "auth.oidc.issuer is required with auth.mode oidc" .Values.auth.oidc.issuer | quote }}
- name: OIDC_CLIENT_ID
  value: {{ required "auth.oidc.clientId is required with auth.mode oidc" .Values.auth.oidc.clientId | quote }}
- name: OIDC_GROUPS_CLAIM
  value: {{ .Values.auth.oidc.groupsClaim | quote }}
{{- with .Values.auth.oidc.clientAssertionFile }}
- name: OIDC_CLIENT_ASSERTION_FILE
  value: {{ . | quote }}
{{- end }}
{{- with .Values.auth.oidc.apiScope }}
- name: OIDC_API_SCOPE
  value: {{ . | quote }}
{{- end }}
{{- with .Values.auth.oidc.apiAudience }}
- name: OIDC_API_AUDIENCE
  value: {{ . | quote }}
{{- end }}
{{- end }}
{{- with .Values.dispatch.url }}
- name: DISPATCH_URL
  value: {{ . | quote }}
{{- end }}
{{- with .Values.dispatch.tokenSecret.name }}
- name: DISPATCH_TOKEN
  valueFrom: { secretKeyRef: { name: {{ . }}, key: {{ $.Values.dispatch.tokenSecret.key }} } }
{{- end }}
- name: SIGN_IN_GROUPS
  value: {{ join "," .Values.auth.signInGroups | quote }}
- name: TEAM_WORKSPACES
  value: {{ .Values.governance.teamWorkspaces | quote }}
- name: PUBLICATION_APPROVAL
  value: {{ .Values.governance.publicationApproval | quote }}
- name: CONNECTOR_APPROVAL
  value: {{ .Values.governance.connectorApproval | default false | quote }}
- name: GUEST_LINKS
  value: {{ .Values.governance.guestLinks | quote }}
- name: BLOB_DRIVER
  value: {{ .Values.storage.driver | quote }}
{{- if eq .Values.storage.driver "fs" }}
- name: BLOB_PATH
  value: /data/blobs
{{- else if eq .Values.storage.driver "azure" }}
- name: AZURE_BLOB_URL
  value: {{ required "storage.azure.containerUrl is required with storage.driver azure" .Values.storage.azure.containerUrl | quote }}
{{- else }}
{{- fail "storage.driver must be fs or azure" }}
{{- end }}
- name: DB_POOL
  value: {{ .Values.database.pool | quote }}
- name: WORKER_EMBEDDED
  value: "false"
{{- with .Values.ai.baseUrl }}
- name: AI_BASE_URL
  value: {{ . | quote }}
- name: AI_MODEL
  value: {{ required "ai.model is required with ai.baseUrl" $.Values.ai.model | quote }}
- name: AI_KEY_HEADER
  value: {{ $.Values.ai.keyHeader | quote }}
- name: AI_DAILY_TOKENS
  value: {{ $.Values.ai.dailyTokens | int | quote }}
{{- end }}
{{- with .Values.agents }}
- name: AGENT_SETUP
  value: {{ toJson . | quote }}
{{- end }}
{{- range $k, $v := .Values.config }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- range $k, $v := .Values.otel }}
- name: {{ $k }}
  value: {{ $v | quote }}
{{- end }}
{{- if eq .Values.database.mode "cnpg" }}
{{- $cluster := include "vantage.dbCluster" . }}
- name: DATABASE_URL
  valueFrom: { secretKeyRef: { name: {{ $cluster }}-app, key: uri } }
{{- if and .Values.database.cnpg.readReplicas (gt (int .Values.database.cnpg.instances) 1) }}
- name: DB_USER
  valueFrom: { secretKeyRef: { name: {{ $cluster }}-app, key: username } }
- name: DB_PASSWORD
  valueFrom: { secretKeyRef: { name: {{ $cluster }}-app, key: password } }
- name: DATABASE_READ_URL
  value: postgresql://$(DB_USER):$(DB_PASSWORD)@{{ $cluster }}-r:5432/{{ .Values.database.cnpg.database }}
{{- end }}
{{- else if eq .Values.database.mode "external" }}
{{- with .Values.database.external.url }}
- name: DATABASE_URL
  value: {{ . | quote }}
{{- end }}
{{- else }}
{{- fail "database.mode must be cnpg or external" }}
{{- end }}
{{- if eq .Values.database.auth "azure" }}
{{- if ne .Values.database.mode "external" }}
{{- fail "database.auth azure needs database.mode external" }}
{{- end }}
- name: DATABASE_AUTH
  value: azure
{{- else if ne .Values.database.auth "password" }}
{{- fail "database.auth must be password or azure" }}
{{- end }}
{{- end -}}

{{- define "vantage.envFrom" -}}
- secretRef:
    name: {{ include "vantage.secretName" . }}
{{- end -}}

{{- define "vantage.volumes" -}}
{{- if eq .Values.storage.driver "fs" }}
- name: files
  persistentVolumeClaim:
    claimName: {{ include "vantage.claim" . }}
{{- end }}
- name: tmp
  emptyDir: {}
{{- end -}}

{{- define "vantage.mounts" -}}
{{- if eq .Values.storage.driver "fs" }}
- name: files
  mountPath: /data/blobs
{{- end }}
- name: tmp
  mountPath: /tmp
{{- end -}}

{{/*
Migrations run in every pod before it starts. A lock in the database lets
one apply them and the rest find them done, so pods may start in any order
and an upgrade needs no separate job. A migration must keep the previous
release working, because its pods serve until the rollout replaces them.
*/}}
{{- define "vantage.migrate" -}}
- name: migrate
  image: {{ include "vantage.image" . }}
  imagePullPolicy: {{ .Values.image.pullPolicy }}
  args: ["migrate"]
  env:
    {{- include "vantage.env" . | nindent 4 }}
  envFrom:
    {{- include "vantage.envFrom" . | nindent 4 }}
  securityContext:
    {{- toYaml .Values.securityContext | nindent 4 }}
  resources:
    requests: { cpu: 50m, memory: 128Mi }
    limits: { memory: 512Mi }
  volumeMounts:
    {{- include "vantage.mounts" . | nindent 4 }}
{{- end -}}

{{/* Spread a tier across nodes, so one node going down never takes all of it. */}}
{{- define "vantage.spread" -}}
topologySpreadConstraints:
  - maxSkew: 1
    topologyKey: kubernetes.io/hostname
    whenUnsatisfiable: ScheduleAnyway
    labelSelector:
      matchLabels:
        {{- include "vantage.selector" . | nindent 8 }}
{{- end -}}
