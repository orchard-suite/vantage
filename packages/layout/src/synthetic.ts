/** A ModelNode for things that are drawn like nodes but are not in the model: flow steps and sequence participants. */
import type { ModelNode } from '@vantage/model';

export function syntheticNode(id: string, name: string, extra: Partial<ModelNode> = {}): ModelNode {
  return { id, name, typeName: 'step', role: 'compute', shape: 'rounded', color: 'blue', tags: [], style: {}, childIds: [], depth: 0, facts: [], bullets: [], size: 'normal', ...extra };
}
