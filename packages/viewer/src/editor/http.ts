/** Request headers for the hub pages' own calls: JSON, and the session's CSRF token from the page. */
export function headers(): Record<string, string> {
  const csrf = document.querySelector<HTMLMetaElement>('meta[name=csrf]');
  return { 'content-type': 'application/json', ...(csrf ? { 'x-csrf-token': csrf.content } : {}) };
}
