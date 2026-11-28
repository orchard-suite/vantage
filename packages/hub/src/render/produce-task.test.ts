import { describe, expect, test } from 'bun:test';
import { renderPng } from '@vantage/render';
import { SAMPLE_YAML } from '../testing.ts';
import { produce, type ProduceInput } from './produce-task.ts';
import { NO_RESOURCES } from './resources.ts';

const enc = new TextEncoder();
const box = (width: number): string => `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${width / 2}"><rect width="${width}" height="${width / 2}"/></svg>`;
const input = (stored: ProduceInput['stored']): ProduceInput => ({ yaml: SAMPLE_YAML, imports: {}, observed: { entities: {}, relations: {} }, resources: NO_RESOURCES, thresholdDays: 7, slug: 'sample', formats: ['png'], views: ['context'], titleBlock: false, stamp: { title: 'Sample', version: 'v1', publishedAt: '2026-11-01T00:00:00.000Z' }, publishedOn: '2026-11-01', refreshUrl: 'https://hub.example.com/r', stored });

describe('produce', () => {
  test('a stored PNG drawn smaller than 2x by the pixel budget is reused with a warning', async () => {
    const out = await produce(input({ 'context.svg': enc.encode(box(400)), 'context.png': renderPng(box(200), { scale: 1 }).bytes }));
    expect(out.reused).toBe(1);
    expect(out.warnings).toEqual(['view context is large, so its PNG is drawn at 0.50x instead of 2x (200 by 100 pixels)']);
  });

  test('a stored PNG at full scale is reused without a warning', async () => {
    const out = await produce(input({ 'context.svg': enc.encode(box(100)), 'context.png': renderPng(box(100), { scale: 2 }).bytes }));
    expect(out.reused).toBe(1);
    expect(out.warnings).toEqual([]);
  });
});
