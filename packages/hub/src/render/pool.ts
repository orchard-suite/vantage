/**
 * The render pool: a few threads that run render tasks, so drawing never
 * holds the event loop that answers requests, renews job leases, and runs
 * connectors. Tasks wait in one queue; a thread that crashes or runs past
 * the deadline is replaced and its task fails with a reason. Each task
 * runs in a lane: what a person waits for first, then a source refresh's
 * draws, then a new release's redraws, so a save never queues behind
 * either. With no threads the tasks run in this process, for tests and
 * small tools.
 */
import type { Logger } from '../log.ts';
import { runTask, type TaskInput, type TaskKind, type TaskOutput } from './tasks.ts';

export interface RunOptions {
  /** This task's deadline, when it should be shorter or longer than the pool's. */
  readonly timeoutMs?: number;
  /** Who waits for it; a person when absent. */
  readonly lane?: Lane;
}

/** Who waits for a task, first to last: a person, a source refresh, a new release redrawing what an older one drew. */
export type Lane = 'person' | 'refresh' | 'release';
const LANE_ORDER: Readonly<Record<Lane, number>> = { person: 0, refresh: 1, release: 2 };

export interface RenderPool {
  run<K extends TaskKind>(kind: K, input: TaskInput<K>, opts?: RunOptions): Promise<TaskOutput<K>>;
  /** Threads, tasks running, and tasks waiting, for health and metrics. */
  stats(): { readonly threads: number; readonly running: number; readonly queued: number };
  close(): Promise<void>;
}

export interface PoolOptions {
  readonly threads: number;
  /** A task running longer than this is stopped and its thread replaced. */
  readonly timeoutMs: number;
  /** Tasks allowed to wait; past it `run` refuses with a PoolBusyError. */
  readonly maxQueue: number;
  readonly log: Logger;
}

/** The pool has more waiting than it takes; the caller answers 503 and the client tries again. */
export class PoolBusyError extends Error {
  constructor(readonly queued: number) {
    super(`render pool is busy: ${queued} tasks waiting`);
    this.name = 'PoolBusyError';
  }
}

interface Pending {
  readonly id: number;
  readonly kind: TaskKind;
  readonly input: unknown;
  readonly resolve: (v: unknown) => void;
  readonly reject: (e: Error) => void;
  readonly queuedAt: number;
  readonly timeoutMs: number;
  readonly lane: number;
}

interface Slot {
  worker: Worker;
  task: Pending | undefined;
  timer: ReturnType<typeof setTimeout> | undefined;
  startedAt: number;
}

interface Reply {
  readonly id: number;
  readonly ok: boolean;
  readonly output?: unknown;
  readonly error?: { readonly name?: string; readonly message: string; readonly stack?: string };
}

export function createRenderPool(opts: PoolOptions): RenderPool {
  if (opts.threads <= 0) return inlinePool(opts);
  const log = opts.log.child({ component: 'render-pool' });
  const queue: Pending[] = [];
  const slots: Slot[] = [];
  let nextId = 1;
  let closed = false;

  const settle = (slot: Slot, fn: (task: Pending) => void): void => {
    const task = slot.task;
    if (!task) return;
    if (slot.timer) clearTimeout(slot.timer);
    slot.task = undefined;
    slot.timer = undefined;
    fn(task);
  };

  const spawn = (index: number): Slot => {
    const worker = new Worker(new URL('./thread.ts', import.meta.url).href);
    const slot: Slot = { worker, task: undefined, timer: undefined, startedAt: 0 };
    worker.onmessage = (e: MessageEvent<Reply>) => {
      const reply = e.data;
      if (slot.task?.id !== reply.id) return;
      const ms = Date.now() - slot.startedAt;
      settle(slot, (task) => {
        log.debug('pool.task.end', { kind: task.kind, ms, ok: reply.ok, waitedMs: slot.startedAt - task.queuedAt });
        if (reply.ok) task.resolve(reply.output);
        else task.reject(Object.assign(new Error(reply.error?.message ?? 'render task failed'), { name: reply.error?.name ?? 'Error', stack: reply.error?.stack }));
      });
      dispatch();
    };
    worker.onerror = (e: ErrorEvent) => replace(index, `render thread crashed: ${e.message}`);
    return slot;
  };

  /** Stops a thread, fails its task with `reason`, and starts a fresh one in its place. */
  const replace = (index: number, reason: string): void => {
    const slot = slots[index];
    if (!slot) return;
    log.warn('pool.thread.replaced', { index, reason, kind: slot.task?.kind ?? null });
    settle(slot, (task) => task.reject(new Error(reason)));
    slot.worker.terminate();
    if (!closed) slots[index] = spawn(index);
    dispatch();
  };

  const dispatch = (): void => {
    for (let i = 0; i < slots.length && queue.length; i++) {
      const slot = slots[i]!;
      if (slot.task) continue;
      const task = queue.shift()!;
      slot.task = task;
      slot.startedAt = Date.now();
      slot.timer = setTimeout(() => replace(i, `render task ${task.kind} exceeded ${task.timeoutMs} ms`), task.timeoutMs);
      slot.worker.postMessage({ id: task.id, kind: task.kind, input: task.input });
    }
  };

  for (let i = 0; i < opts.threads; i++) slots.push(spawn(i));
  log.info('pool.start', { threads: opts.threads, timeoutMs: opts.timeoutMs, maxQueue: opts.maxQueue });

  return {
    run<K extends TaskKind>(kind: K, input: TaskInput<K>, runOpts: RunOptions = {}): Promise<TaskOutput<K>> {
      if (closed) return Promise.reject(new Error('render pool is closed'));
      const busy = slots.every((s) => s.task);
      if (busy && queue.length >= opts.maxQueue) {
        log.warn('pool.busy', { kind, queued: queue.length });
        return Promise.reject(new PoolBusyError(queue.length));
      }
      return new Promise<TaskOutput<K>>((resolve, reject) => {
        const task: Pending = { id: nextId++, kind, input, resolve: resolve as (v: unknown) => void, reject, queuedAt: Date.now(), timeoutMs: runOpts.timeoutMs ?? opts.timeoutMs, lane: LANE_ORDER[runOpts.lane ?? 'person'] };
        // A task goes ahead of every waiting task of a later lane; each lane keeps its own order.
        const at = queue.findIndex((t) => t.lane > task.lane);
        if (at < 0) queue.push(task);
        else queue.splice(at, 0, task);
        dispatch();
      });
    },
    stats: () => ({ threads: slots.length, running: slots.filter((s) => s.task).length, queued: queue.length }),
    async close() {
      closed = true;
      for (const t of queue.splice(0)) t.reject(new Error('render pool is closed'));
      for (const s of slots) {
        settle(s, (task) => task.reject(new Error('render pool is closed')));
        s.worker.terminate();
      }
      log.info('pool.stop', {});
    },
  };
}

/** Runs each task in this process, one at a time, on the next turn of the loop. */
function inlinePool(opts: PoolOptions): RenderPool {
  let tail: Promise<unknown> = Promise.resolve();
  let running = 0;
  let queued = 0;
  return {
    run<K extends TaskKind>(kind: K, input: TaskInput<K>): Promise<TaskOutput<K>> {
      if (queued >= opts.maxQueue) return Promise.reject(new PoolBusyError(queued));
      queued++;
      const next = tail.then(async () => {
        queued--;
        running++;
        try {
          return await runTask(kind, input);
        } finally {
          running--;
        }
      });
      tail = next.catch(() => undefined);
      return next;
    },
    stats: () => ({ threads: 0, running, queued }),
    close: async () => undefined,
  };
}
