import type { ContextActivityBlockRead } from '../portal/study-types';

/** Resolve one pinned block; visiting another experiment must never borrow its results. */
export function matchingExperimentBlock(
  blocks: ContextActivityBlockRead[],
  current: URL,
  base: URL,
  blockId: string | null,
): ContextActivityBlockRead | undefined {
  const matches = blocks.filter(block => {
    if (block.adapter !== 'numeric-controls-v1' || !block.controls.length || !block.entry?.startsWith('labs/')) return false;
    if (blockId && block.block_id !== blockId) return false;
    const entry = new URL(block.entry, base);
    return entry.origin === current.origin && entry.pathname === current.pathname && entry.hash === current.hash
      && [...entry.searchParams].every(([key, value]) => current.searchParams.get(key) === value);
  });
  return matches.length === 1 ? matches[0] : undefined;
}
