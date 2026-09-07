import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

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
  return context.AstraLearningActivityCatalog.entries().map((entry) => {
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
}

export function catalogPlugin(root) {
  return {
    name: 'astra-official-catalog',
    resolveId(id) {
      if (id === 'virtual:astra-catalog') return '\0astra-catalog';
    },
    load(id) {
      if (id === '\0astra-catalog') return `export default ${JSON.stringify(loadCatalog(root))};`;
    },
  };
}
