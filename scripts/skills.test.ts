import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

// The plugin's skills are read by strict YAML parsers downstream (marketplace
// catalogs), so each SKILL.md frontmatter must be valid YAML with a name and
// a description.
const SKILLS = join(import.meta.dir, '..', 'skills');

function frontmatter(text: string): string {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!match?.[1]) throw new Error('no frontmatter');
  return match[1];
}

describe('skill frontmatter', () => {
  for (const skill of readdirSync(SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    test(skill.name, () => {
      const parsed = Bun.YAML.parse(frontmatter(readFileSync(join(SKILLS, skill.name, 'SKILL.md'), 'utf8')));
      expect(parsed).toMatchObject({ name: skill.name, description: expect.any(String) });
    });
  }
});
