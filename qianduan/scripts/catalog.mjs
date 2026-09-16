import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { loadLearningSpaces, loadTemplateSeeds } from './learning-spaces.mjs';

/** Derive from the existing authorities; do not maintain another 127-entry catalogue. */
export function loadCatalog(root) {
  const context = vm.createContext({ console });
  context.window = context;
  for (const filename of [
    'shared/js/config.js',
    'shared/js/experiment-registry.js',
    'shared/js/learning-activity-catalog.js',
    'codevis/shared/js/course-manifest.js',
    'pages/frontier/frontier-manifest.js',
  ])
    vm.runInContext(fs.readFileSync(path.join(root, filename), 'utf8'), context, { filename });
  const config = vm.runInContext('CONFIG', context);
  const extended = new Map(
    [...context.CvCourseManifest.courses, ...context.FrontierCourseManifest.courses]
      .flatMap((course) => course.activities)
      .map((activity) => [activity.activity_key, activity.title]),
  );
  const activities = context.AstraLearningActivityCatalog.entries().map((entry) => {
    const [subject, id] = entry.activity_key.split('.');
    const experiment = config.experiments?.[subject]?.find((item) => item.id === id);
    const design = config.learningDesign?.[subject];
    const title =
      experiment?.name ||
      experiment?.title ||
      extended.get(entry.activity_key) ||
      design?.activities?.find((item) => item.id === id)?.title ||
      entry.activity_key;
    const href = context.AstraLearningActivityCatalog.recoveryHref(entry, {
      activity_key: entry.activity_key,
      content_slug: `${subject}/${id}`,
    });
    return {
      key: entry.activity_key,
      title,
      galaxy: entry.galaxy_key,
      subject: entry.subject_key,
      href: `labs/${href.startsWith('#') ? 'index.html' : ''}${href}`,
    };
  });
  for (const space of loadLearningSpaces(root).spaces.filter((item) => item.kind === 'bundle')) {
    const directory = path.join(root, 'extensions', space.key, 'public');
    const registered = JSON.parse(fs.readFileSync(path.join(directory, 'astra-activities.json'), 'utf8'));
    if (registered.schema_version !== 'astra-activities-v1' || !Array.isArray(registered.activities)) throw new Error('Imported activity catalogue is missing or unsupported.');
    for (const activity of registered.activities) {
      if (!/^[a-z0-9][a-z0-9.-]{0,119}$/.test(activity.key) || !activity.title || !activity.subject)
        throw new Error('Imported activities require a stable key, title and subject.');
      const entry = String(activity.entry || 'index.html');
      const decodedPath = decodeURIComponent(entry.split(/[?#]/)[0]);
      if (/^(?:[a-z]+:|\/)/i.test(entry) || /[\\\s]/.test(entry) || decodedPath.split('/').includes('..') || decodedPath.includes('\\'))
        throw new Error('Imported activity paths must stay inside their own bundle.');
      activities.push({ key: activity.key, title: activity.title, galaxy: space.key, subject: activity.subject, href: `labs/spaces/${space.key}/${entry}` });
    }
  }
  if (new Set(activities.map((item) => item.key)).size !== activities.length)
    throw new Error('Activity keys collide across registered learning spaces.');
  return activities;
}

export function catalogPlugin(root) {
  return {
    name: 'astra-official-catalog',
    resolveId(id) {
      if (['virtual:astra-catalog', 'virtual:astra-spaces', 'virtual:astra-templates'].includes(id)) return '\0' + id.slice('virtual:'.length);
    },
    load(id) {
      if (id === '\0astra-catalog') return `export default ${JSON.stringify(loadCatalog(root))};`;
      if (id === '\0astra-spaces') return `export default ${JSON.stringify(loadLearningSpaces(root))};`;
      if (id === '\0astra-templates') return `export default ${JSON.stringify(loadTemplateSeeds(root))};`;
    },
  };
}
