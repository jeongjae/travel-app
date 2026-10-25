export const staticHosting = import.meta.env.VITE_STATIC_HOSTING === 'true';

export function appAssetUrl(path: string) {
  return import.meta.env.BASE_URL + path.replace(/^\/+/, '');
}
