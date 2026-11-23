/**
 * The compact layout: a phone in either hand. A narrow screen gets it, and
 * so does a short one, because a phone held sideways is wide enough for the
 * desktop chrome but too short to give it the room. The stylesheets and the
 * shell read this one query so they always agree.
 */
export const COMPACT = '(max-width:900px),(max-height:500px)';

/** A phone held sideways: the compact layout with no bars at all, only a few buttons floating over the picture. */
export const SHORT = '(max-height:500px) and (orientation:landscape)';
