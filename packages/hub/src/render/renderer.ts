import pkg from '../../../../package.json' with { type: 'json' };

/** The release that draws pictures. Bumped by every release, so a new renderer redraws what an old one drew. */
export const RENDERER = pkg.version;
