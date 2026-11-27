/**
 * Record numbers: four digits, the first the category, the last three in
 * order within it. The next number follows the highest taken in the
 * category, so a gap left by a record that was never moved over stays a
 * gap. A number is handed out again only after its record is discarded.
 */
import { formatNumber } from '@vantage/model';
import type { Category } from './types.ts';

export const PER_CATEGORY = 999;

export function categoryOf(number: number): number {
  return Math.floor(number / 1000);
}

export function categoryName(categories: readonly Category[], digit: number): string | undefined {
  return categories.find((c) => c.digit === digit)?.name;
}

/** The number after the highest taken in the category; throws when the category is full or unknown. */
export function nextNumber(categories: readonly Category[], category: number, taken: readonly number[]): number {
  if (categoryName(categories, category) === undefined) throw new Error(`category ${category} is not in this registry's scheme (${schemeText(categories)})`);
  const inCategory = taken.filter((n) => categoryOf(n) === category);
  const high = inCategory.length ? Math.max(...inCategory) : category * 1000;
  const next = high + 1;
  if (next > category * 1000 + PER_CATEGORY) throw new Error(`category ${category} is full: every number up to ${formatNumber(high)} is taken`);
  return next;
}

/** Why a number someone brings (an import) cannot be kept, or undefined when it can. */
export function numberProblem(categories: readonly Category[], number: number, taken: readonly number[]): string | undefined {
  if (!Number.isInteger(number) || number < 0 || number > 9999) return `${number} is not a four-digit number`;
  if (number % 1000 === 0) return `${formatNumber(number)} is a category's zero; numbers start at ${formatNumber(number + 1)}`;
  if (categoryName(categories, categoryOf(number)) === undefined) return `${formatNumber(number)} starts with ${categoryOf(number)}, which is not a category in this registry (${schemeText(categories)})`;
  if (taken.includes(number)) return `${formatNumber(number)} is already taken`;
  return undefined;
}

export function schemeText(categories: readonly Category[]): string {
  return categories.map((c) => `${c.digit} ${c.name}`).join(', ');
}
