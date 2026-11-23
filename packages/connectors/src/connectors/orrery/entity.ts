/** The shape of an Orrery entity as `/v1/entities` answers it, and the id the connector files it under. */

export interface OrreryRef {
  blueprint: string;
  key: string;
  title?: string;
  restricted?: boolean;
}

export interface OrreryEntity {
  blueprint: string;
  key: string;
  title: string;
  state: string;
  fields: Record<string, unknown>;
  relations: Record<string, OrreryRef[]>;
  updatedAt?: string;
  lastSeenAt?: string | null;
}

export function orreryEntityId(ref: Pick<OrreryRef, 'blueprint' | 'key'>): string {
  return `${ref.blueprint}:${ref.key}`;
}

/** The targets of a relation the reader may see. */
export function visibleRefs(e: OrreryEntity, relation: string): OrreryRef[] {
  return (e.relations[relation] ?? []).filter((r) => !r.restricted);
}
