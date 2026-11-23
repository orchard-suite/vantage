/** A render thread: runs one task per message and answers with its output or its error. */
import { runTask, type TaskKind } from './tasks.ts';

declare const self: Worker;

self.onmessage = async (e: MessageEvent<{ id: number; kind: TaskKind; input: never }>) => {
  const { id, kind, input } = e.data;
  try {
    const output = await runTask(kind, input);
    self.postMessage({ id, ok: true, output });
  } catch (err) {
    const error = err instanceof Error ? { name: err.name, message: err.message, ...(err.stack ? { stack: err.stack } : {}) } : { message: String(err) };
    self.postMessage({ id, ok: false, error });
  }
};
