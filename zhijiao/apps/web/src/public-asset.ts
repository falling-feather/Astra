/** Keep authored public assets usable at both an origin root and a Pages subpath. */
declare const __PUBLIC_ASSET_MAP__:Readonly<Record<string,string>>|undefined;
export function publicAsset(path: string, base = import.meta.env.BASE_URL): string {
  const variant=typeof __PUBLIC_ASSET_MAP__==='undefined'?path:__PUBLIC_ASSET_MAP__?.[path]??path;
  return variant.startsWith('/assets/') ? `${base}${variant.slice(1)}` : variant;
}
