import fs from 'node:fs';
import path from 'node:path';

/** One reviewed registration supplies both the portal and the backend catalogue. */
export function loadLearningSpaces(root) {
  const file = path.join(root, 'backend/app/catalogue/learning-spaces.v1.json');
  const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (manifest.schema_version !== 'astra-learning-spaces-v1' || !Array.isArray(manifest.spaces))
    throw new Error('Unsupported learning-space registration.');
  const keys = new Set(), views = new Set();
  for (const space of manifest.spaces) {
    if (!/^[a-z][a-z0-9-]{0,31}$/.test(space.key) || keys.has(space.key) || views.has(space.view))
      throw new Error('Learning spaces require unique stable identities.');
    if (!['lab', 'code', 'future'].includes(space.view) && space.view !== `space:${space.key}`)
      throw new Error('An additional space must use its own space: route.');
    if (!['legacy', 'bundle'].includes(space.kind) || !space.title || !/^#[0-9a-f]{6}$/i.test(space.accent))
      throw new Error('Learning-space metadata is incomplete.');
    if (!space.entry.startsWith('labs/') || /(?:^|\/)\.\.(?:\/|$)|[\\\s]/.test(decodeURIComponent(space.entry.split(/[?#]/)[0])))
      throw new Error('A learning-space entry must stay inside reviewed public labs.');
    if (space.kind === 'bundle' && space.entry.split('#')[0] !== `labs/spaces/${space.key}/index.html`)
      throw new Error('An imported bundle must use its declared isolated directory.');
    keys.add(space.key); views.add(space.view);
  }
  return manifest;
}

export function loadTemplateSeeds(root) {
  const initial = JSON.parse(fs.readFileSync(path.join(root, 'backend/app/catalogue/templates.v1.json'), 'utf8')).templates;
  const updates = JSON.parse(fs.readFileSync(path.join(root, 'backend/app/catalogue/resource-updates.v1.json'), 'utf8')).resources;
  return [...initial, ...updates];
}
