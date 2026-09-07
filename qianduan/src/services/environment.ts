export const DEMO_MODE = import.meta.env.MODE === 'demo';
export const API_BASE = import.meta.env.VITE_API_BASE || '/api';
export function frontendAsset(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
