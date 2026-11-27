import { Capacitor } from '@capacitor/core';

const DEFAULT_NATIVE_API_ORIGIN =
  'https://ais-pre-xl3vku4tna4c7pbrbylaub-954547289175.asia-southeast1.run.app';

export function getApiBaseOrigin(): string {
  const envBase = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/+$/, '');
  if (envBase) {
    return envBase;
  }
  try {
    if (Capacitor.isNativePlatform()) {
      return DEFAULT_NATIVE_API_ORIGIN;
    }
  } catch {
    // Ignore non-Capacitor context
  }
  return '';
}

export function apiUrl(path: string): string {
  if (!path) return path;
  if (/^https?:\/\//i.test(path) || path.startsWith('blob:') || path.startsWith('data:')) {
    return path;
  }
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  const origin = getApiBaseOrigin();
  return origin ? `${origin}${normalizedPath}` : normalizedPath;
}
