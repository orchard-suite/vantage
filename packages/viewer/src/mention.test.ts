import { describe, expect, test } from 'bun:test';
import { encodeMentions, matchPeople, mentionQuery } from './mention.ts';

const PEOPLE = [
  { id: 'u1', label: 'First Reader' },
  { id: 'u2', label: 'Second Author' },
  { id: 'u3', label: 'Readwell' },
];

describe('mentions in the comment box', () => {
  test('an @ at the start or after a space starts a mention, up to the caret', () => {
    expect(mentionQuery('hi @se', 6)).toEqual({ start: 3, query: 'se' });
    expect(mentionQuery('@', 1)).toEqual({ start: 0, query: '' });
    expect(mentionQuery('ask @First R', 12)).toEqual({ start: 4, query: 'First R' });
    expect(mentionQuery('user@example.com', 16)).toBeUndefined();
    expect(mentionQuery('@first\nnext', 11)).toBeUndefined();
    expect(mentionQuery('no mention', 5)).toBeUndefined();
  });

  test('offers names that start with the query first, then names with a word that does', () => {
    expect(matchPeople(PEOPLE, 'read').map((p) => p.id)).toEqual(['u3', 'u1']);
    expect(matchPeople(PEOPLE, 'second a').map((p) => p.id)).toEqual(['u2']);
    expect(matchPeople(PEOPLE, '').length).toBe(3);
    expect(matchPeople(PEOPLE, 'zz')).toEqual([]);
  });

  test('a picked name becomes its id, a longer name winning over one inside it', () => {
    const picked = new Map([['First', 'u9'], ['First Reader', 'u1'], ['Readwell', 'u3']]);
    expect(encodeMentions('@First Reader and @Readwell, see', picked)).toBe('<@u1> and <@u3>, see');
    expect(encodeMentions('@Second typed by hand', picked)).toBe('@Second typed by hand');
  });
});
