/**
 * A refusal teaches (VAN-5004): every refusal the five verbs answer
 * names the guide topic that explains the rule it broke. A refusal that
 * already names one keeps it; any other is taught by what it was about.
 */
import { HttpError } from '../http.ts';
import type { Address } from './address.ts';

/** The guide's topic for the rules of a kind of thing; its headings are its topics. */
export type Topic = 'working-in-a-hub' | 'decision-records-in-a-hub' | 'working-with-items';

/** The topic that explains what an address names. A document, a page, and the rest of the text space are working in a hub. */
export function topicOf(a: Pick<Address, 'kind'> | undefined): Topic {
  switch (a?.kind) {
    case 'record':
    case 'registry':
      return 'decision-records-in-a-hub';
    case 'item':
    case 'kind':
      return 'working-with-items';
    default:
      return 'working-in-a-hub';
  }
}

/** A refusal's words, ending with the guide topic it teaches. */
export function taught(err: unknown, topic: Topic): string {
  const message = err instanceof Error ? err.message : String(err);
  if (/guide#[a-z0-9-]+/.test(message)) return message;
  const own = err instanceof HttpError && typeof err.details?.['topic'] === 'string' ? err.details['topic'] : topic;
  return `${message} (guide#${own})`;
}

/** The same refusal, carrying its topic in its words, for a door that answers the message. */
export function teach(err: unknown, topic: Topic): unknown {
  if (!(err instanceof HttpError)) return err instanceof Error ? new HttpError(400, taught(err, topic)) : err;
  return new HttpError(err.status, taught(err, topic), err.details);
}
