/** Review URLs select a separately prefixed database, never an arbitrary existing database. */
export function reviewWorkspace(search: string) {
  const value = new URLSearchParams(search).get('review');
  return value && /^[a-z0-9-]{1,40}$/.test(value) ? value : undefined;
}

export function workspaceUrl(workspace: 'content' | 'legacy', search: string) {
  const review = reviewWorkspace(search);
  return `?workspace=${workspace}${review ? `&review=${encodeURIComponent(review)}` : ''}`;
}
