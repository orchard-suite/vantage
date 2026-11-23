/** The JSON Schema handed to agents and editors; generated from the zod definitions. */
import { z } from 'zod';
import { DocumentSchema } from './schema.ts';

export function documentJsonSchema(): Record<string, unknown> {
  return z.toJSONSchema(DocumentSchema, { target: 'draft-2020-12', io: 'input', unrepresentable: 'any' }) as Record<string, unknown>;
}
