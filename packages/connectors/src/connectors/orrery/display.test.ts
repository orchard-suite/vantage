import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { displayOf, fieldLabel, fieldWords, valueText, type OrreryBlueprintDef } from './display.ts';

const app = JSON.parse(readFileSync(`${import.meta.dir}/fixtures/estate-blueprint-azure_app_service.json`, 'utf8')) as OrreryBlueprintDef;
const defs = app.fields ?? {};

describe('orrery display', () => {
  test('reads money stored in cents as the currency, whole from a hundred up', () => {
    expect(valueText(115207, defs['cost_last_month_cents'])).toBe('$1,152');
    expect(valueText(4250, defs['cost_last_month_cents'])).toBe('$42.50');
    expect(valueText(1500, { format: { kind: 'currency', currency: 'JPY', minor: true } })).toBe('¥1,500');
    expect(valueText(12.5, { format: { kind: 'currency', currency: 'EUR' } })).toBe('€12.50');
  });

  test('groups plain numbers, says yes or no, and lists a list', () => {
    expect(valueText(120345.5, defs['requests_7d'])).toBe('120,345.5');
    expect(valueText(true, defs['always_on'])).toBe('yes');
    expect(valueText(['a', 'b'], undefined)).toBe('a, b');
    expect(valueText(null, undefined)).toBe('');
  });

  test('labels a field by its title, else its name in words', () => {
    expect(fieldLabel('cost_last_month_cents', defs['cost_last_month_cents'])).toBe('Cost last month');
    expect(fieldLabel('requests_7d', defs['requests_7d'])).toBe('Requests 7d');
    expect(fieldWords('last-seen_at')).toBe('Last seen at');
  });

  test('shows every fact in order with its label and text, and leaves out empty ones', () => {
    expect(displayOf({ cost_last_month_cents: 115207, always_on: false, health: 'green', notes: null }, defs)).toEqual([
      { fact: 'cost_last_month_cents', label: 'Cost last month', value: '$1,152' },
      { fact: 'always_on', label: 'Always on', value: 'no' },
      { fact: 'health', label: 'Health', value: 'green' },
    ]);
  });
});
