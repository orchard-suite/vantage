/**
 * The hub's metrics, named by OpenTelemetry's semantic conventions where
 * one exists and `vantage.<what>` where none does. Instruments come from
 * the global meter, which is a no-op until `startTelemetry` registers an
 * exporting provider, so tests and local runs record nothing.
 */
import { monitorEventLoopDelay } from 'node:perf_hooks';
import { metrics, type Counter, type Histogram, type Meter } from '@opentelemetry/api';
import type { Db } from './db/db.ts';
import { HUB_VERSION } from './version.ts';

export interface HubMetrics {
  /** One per request, in seconds, by route pattern, method, and status. */
  readonly requestDuration: Histogram;
  /** One per finished job, by `task` (the job kind) and `outcome`. */
  readonly jobs: Counter;
  /** One per finished job, in seconds, by `task`. */
  readonly jobDuration: Histogram;
  /** One per telemetry batch a browser posts, by `outcome`. */
  readonly browserBatches: Counter;
  /** One per render, in seconds from its start until its picture is stored, by `pass` (`picture`) and `trigger`. */
  readonly renderPass: Histogram;
  /** One per saved version, in seconds from the save until its first picture is stored. */
  readonly firstPicture: Histogram;
  /** One per revision that ends, by `outcome` (ready, failed, accepted, rejected). */
  readonly revisions: Counter;
  /** One per diagram drawn from a description that ends, by `outcome` (ready, failed). */
  readonly generations: Counter;
  /** Tokens revisions and generations spent on the organization's model API, by `model` and `direction` (input, output, cache_read, cache_write). */
  readonly aiTokens: Counter;
  /** One per presence beat a viewer posts, by `outcome` (sent, limited, too_large). */
  readonly presenceBeats: Counter;
  /** One per presence change a viewer reports, by `event` (join, leave, follow, unfollow) and `reader` (member, guest). */
  readonly presence: Counter;
  /** One per voice walkthrough saved, refused, or deleted, by `outcome`. */
  readonly recordings: Counter;
  /** Audio bytes voice walkthroughs put in the blob store and gave back, by `action` (stored, released). */
  readonly recordingBytes: Counter;
  /** One per person a comment newly mentions and tells, by `surface`. */
  readonly mentions: Counter;
  /** One per reaction put on or taken off a box, by `kind` and `change` (add, remove). */
  readonly reactions: Counter;
  /** One per agent tool call, by `tool`, `outcome` (ok, error), and `listed` (core, on_demand). */
  readonly agentCalls: Counter;
  /** Characters agent tool calls took and answered, by `tool` and `direction` (in, out, binary_out). The cost an agent pays to work here. */
  readonly agentChars: Counter;
}

const SECONDS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];
/** Render times, with edges at the 4 s target a person waits for a picture and the 1 to 2 s objective. */
const RENDER_SECONDS = [0.5, 1, 1.5, 2, 3, 4, 6, 10, 30, 60, 120, 300];

export function hubMeter(): Meter {
  return metrics.getMeter('vantage-hub', HUB_VERSION);
}

export function createHubMetrics(meter: Meter = hubMeter()): HubMetrics {
  meter.createObservableGauge('vantage.build_info', { description: 'Always 1; the version label is the running release.' }).addCallback((r) => r.observe(1, { version: HUB_VERSION }));
  return {
    requestDuration: meter.createHistogram('http.server.request.duration', { unit: 's', description: 'Duration of HTTP server requests.', advice: { explicitBucketBoundaries: SECONDS } }),
    jobs: meter.createCounter('vantage.jobs', { description: 'Worker jobs finished, by task and outcome.' }),
    jobDuration: meter.createHistogram('vantage.job.duration', { unit: 's', description: 'How long a worker job ran.', advice: { explicitBucketBoundaries: SECONDS } }),
    browserBatches: meter.createCounter('vantage.browser.batches', { description: "Telemetry batches from readers' browsers, by outcome." }),
    renderPass: meter.createHistogram('vantage.render.pass.duration', { unit: 's', description: 'How long one render pass took until its picture was stored.', advice: { explicitBucketBoundaries: RENDER_SECONDS } }),
    firstPicture: meter.createHistogram('vantage.render.first_picture.duration', { unit: 's', description: 'From a save until the first picture of the new version was stored.', advice: { explicitBucketBoundaries: RENDER_SECONDS } }),
    revisions: meter.createCounter('vantage.revisions', { description: 'Revisions from comments that ended, by outcome.' }),
    generations: meter.createCounter('vantage.generations', { description: 'Diagrams drawn from a description that ended, by outcome.' }),
    aiTokens: meter.createCounter('vantage.ai.tokens', { unit: '{token}', description: "Tokens revisions and generations spent on the organization's model API, by model and direction." }),
    presenceBeats: meter.createCounter('vantage.presence.beats', { description: 'Presence beats viewers posted, by outcome.' }),
    presence: meter.createCounter('vantage.presence.events', { description: 'Readers joining, leaving, and following each other in a document, by event and reader kind.' }),
    recordings: meter.createCounter('vantage.recordings', { description: 'Voice walkthroughs saved, refused, or deleted, by outcome.' }),
    recordingBytes: meter.createCounter('vantage.recording.bytes', { unit: 'By', description: 'Audio bytes voice walkthroughs stored in and released from the blob store, by action.' }),
    mentions: meter.createCounter('vantage.mentions', { description: 'People a comment newly mentioned and told, by surface.' }),
    reactions: meter.createCounter('vantage.reactions', { description: 'Reactions put on or taken off boxes, by kind and change.' }),
    agentCalls: meter.createCounter('vantage.agent.calls', { description: 'Agent tool calls, by tool, outcome, and whether the tool is in the core list.' }),
    agentChars: meter.createCounter('vantage.agent.chars', { unit: '{character}', description: 'Characters agent tool calls took and answered, by tool and direction.' }),
  };
}

/**
 * The process's own health under OpenTelemetry's runtime names: CPU time by
 * state, memory by kind, and how late the event loop ran (high means a
 * render or a parse held it) since the last export.
 */
export function observeProcess(meter: Meter = hubMeter()): void {
  const loop = monitorEventLoopDelay({ resolution: 10 });
  loop.enable();
  meter.createObservableCounter('process.cpu.time', { unit: 's', description: 'CPU time the process used, by state.' }).addCallback((r) => {
    const cpu = process.cpuUsage();
    r.observe(cpu.user / 1e6, { 'process.cpu.state': 'user' });
    r.observe(cpu.system / 1e6, { 'process.cpu.state': 'system' });
  });
  meter.createObservableGauge('process.memory.usage', { unit: 'By', description: 'Memory the process holds, by kind.' }).addCallback((r) => {
    const m = process.memoryUsage();
    r.observe(m.rss, { 'process.memory.kind': 'rss' });
    r.observe(m.heapUsed, { 'process.memory.kind': 'heap_used' });
    r.observe(m.heapTotal, { 'process.memory.kind': 'heap_total' });
    r.observe(m.external, { 'process.memory.kind': 'external' });
  });
  const p99 = meter.createObservableGauge('nodejs.eventloop.delay.p99', { unit: 's', description: 'How late the event loop ran since the last export, 99th percentile.' });
  const max = meter.createObservableGauge('nodejs.eventloop.delay.max', { unit: 's', description: 'The longest the event loop was held since the last export.' });
  // One callback reads both before the window resets, so neither sees the other's reset.
  meter.addBatchObservableCallback((r) => {
    r.observe(p99, loop.count > 0 ? loop.percentile(99) / 1e9 : 0);
    r.observe(max, loop.count > 0 ? loop.max / 1e9 : 0);
    loop.reset();
  }, [p99, max]);
}

/** Reports the jobs that are due and not yet claimed, read at each export. */
export function observeQueue(db: Db, meter: Meter = hubMeter()): void {
  meter.createObservableGauge('vantage.jobs.due', { description: 'Queued jobs whose run time has passed.' }).addCallback(async (r) => {
    // A failed read (the database is down, or closed at shutdown) skips one
    // export; readiness and the request metrics report the outage.
    const rows = await db.query<{ n: string }>("select count(*)::text as n from jobs where state = 'queued' and run_at <= now()").catch(() => undefined);
    if (rows) r.observe(Number(rows[0]?.n ?? '0'));
  });
}
