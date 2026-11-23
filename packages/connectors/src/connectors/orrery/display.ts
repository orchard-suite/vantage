/**
 * How a person reads an Orrery entity's fields on a box: each by the title
 * the hub gives the field, and each value as the field's format says. Money
 * stored in minor units (cents) reads as the currency, whole above a hundred
 * because the cents say nothing at that size on a box. A field the hub
 * gives no title reads as its name in words.
 */
import type { DisplayFact, FactValue } from '../../batch.ts';

/** The part of an Orrery field definition a box reads. */
export interface OrreryFieldDef {
  readonly type?: string;
  readonly title?: string;
  readonly format?: { readonly kind: 'currency'; readonly currency: string; readonly minor?: boolean };
}

/** The part of `/v1/blueprints/:id` a box reads. */
export interface OrreryBlueprintDef {
  readonly id: string;
  readonly title?: string;
  readonly fields?: Record<string, OrreryFieldDef>;
}

/** Above this many major units, a box drops the cents. */
const WHOLE_FROM = 100;

/** A field's name in words: cost_last_month reads "Cost last month". */
export function fieldWords(name: string): string {
  const words = name.replace(/[_-]+/g, ' ').trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function money(value: number, f: NonNullable<OrreryFieldDef['format']>): string {
  const digits = new Intl.NumberFormat('en-US', { style: 'currency', currency: f.currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const amount = f.minor ? value / 10 ** digits : value;
  const shown = Math.abs(amount) >= WHOLE_FROM ? 0 : digits;
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: f.currency, minimumFractionDigits: shown, maximumFractionDigits: shown }).format(amount);
}

/** One value as a person reads it, by its field's format. */
export function valueText(value: FactValue, def: OrreryFieldDef | undefined): string {
  if (value === null) return '';
  if (typeof value === 'number') return def?.format?.kind === 'currency' ? money(value, def.format) : value.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (typeof value === 'boolean') return value ? 'yes' : 'no';
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return value.map((v) => valueText(v, def)).filter((v) => v !== '').join(', ');
  return JSON.stringify(value);
}

/** The label a field reads under: its title, else its name in words. */
export function fieldLabel(name: string, def: OrreryFieldDef | undefined): string {
  return def?.title?.trim() || fieldWords(name);
}

/** The facts of an entity as a box shows them, in the order the facts hold them. */
export function displayOf(facts: Record<string, FactValue>, defs: Record<string, OrreryFieldDef>): DisplayFact[] {
  const out: DisplayFact[] = [];
  for (const [fact, v] of Object.entries(facts)) {
    const value = valueText(v, defs[fact]);
    if (value !== '') out.push({ fact, label: fieldLabel(fact, defs[fact]), value });
  }
  return out;
}
