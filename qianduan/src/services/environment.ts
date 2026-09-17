export const DEMO_MODE = import.meta.env.MODE === 'demo';
export const API_BASE = import.meta.env.VITE_API_BASE || '/api';
export const VOCATIONAL_APP_URL =
  import.meta.env.VITE_VOCATIONAL_APP_URL || 'http://127.0.0.1:4173/';
export const LOCAL_DEMO_ACCOUNTS =
  typeof window !== 'undefined' &&
  window.location.hostname === '127.0.0.1' &&
  window.location.port === '9002';
export function frontendAsset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
