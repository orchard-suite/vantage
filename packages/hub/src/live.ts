/**
 * Live fan-out: one LISTEN per document channel on this pod, any number of
 * SSE subscribers behind it. A worker on any pod NOTIFYs when a version
 * renders; every open viewer of that document refreshes. A second Live on
 * the presence prefix carries who has the document open the same way.
 */
import type { Db } from './db/db.ts';
import { channelName } from './db/db.ts';
import type { Logger } from './log.ts';
import { DOC_CHANNEL_PREFIX } from './worker/render.ts';

export interface Live {
  /** `close` ends the subscriber's stream; `closeAll` calls it when the pod drains. */
  subscribe(documentId: string, send: (payload: string) => void, close?: () => void): Promise<() => Promise<void>>;
  /** Ends every open stream, so its client reconnects to another pod. */
  closeAll(): number;
  /** Subscribers across all documents, for health and tests. */
  size(): number;
}

interface Channel {
  readonly handlers: Set<(payload: string) => void>;
  unlisten: () => Promise<void>;
}

export function createLive(db: Db, log: Logger, prefix: string = DOC_CHANNEL_PREFIX): Live {
  const channels = new Map<string, Channel>();
  const closers = new Set<() => void>();
  return {
    async subscribe(documentId, send, close) {
      const name = channelName(prefix, documentId);
      let ch = channels.get(name);
      if (!ch) {
        const handlers = new Set<(payload: string) => void>();
        const unlisten = await db.listen(name, (payload) => {
          log.debug('live.notify', { prefix, documentId, subscribers: handlers.size });
          for (const h of handlers) h(payload);
        });
        ch = { handlers, unlisten };
        channels.set(name, ch);
        log.info('live.channel.open', { prefix, documentId });
      }
      ch.handlers.add(send);
      if (close) closers.add(close);
      log.debug('live.subscribe', { documentId, subscribers: ch.handlers.size });
      return async () => {
        if (close) closers.delete(close);
        ch.handlers.delete(send);
        log.debug('live.unsubscribe', { documentId, subscribers: ch.handlers.size });
        if (ch.handlers.size === 0) {
          channels.delete(name);
          await ch.unlisten();
          log.info('live.channel.close', { prefix, documentId });
        }
      };
    },
    size: () => [...channels.values()].reduce((n, c) => n + c.handlers.size, 0),
    closeAll() {
      const n = closers.size;
      for (const close of [...closers]) close();
      closers.clear();
      log.info('live.closed', { prefix, streams: n });
      return n;
    },
  };
}
