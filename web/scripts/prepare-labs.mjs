import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { loadCatalog } from '../../qianduan/scripts/catalog.mjs';
import { packagePublicLabs } from '../../qianduan/scripts/package-resources.mjs';

const project = path.resolve(import.meta.dirname, '..');
const spaces = [{key:'englab',title:'工科实验室'},{key:'code-space',title:'代码空间'},{key:'future-galaxy',title:'未来星系'}];

export function validateActivityHref(href) {
  if (typeof href !== 'string' || !href.startsWith('labs/') || /[\\\s]/.test(href)) throw new Error('实验入口必须位于本地 labs 目录。');
  const decoded = decodeURIComponent(href.split(/[?#]/)[0]);
  if (decoded.split('/').some(part => part === '..') || decoded.includes('\\')) throw new Error('实验入口不能越出 labs 目录。');
  return href;
}

export function buildSnapshot({activities,config,codeCourses,futureCourses,source}) {
  const seen = new Set();
  for (const item of activities) {
    if(seen.has(item.key)) throw new Error('实验身份重复：'+item.key);
    seen.add(item.key);validateActivityHref(item.href);
    if(!spaces.some(space=>space.key===item.galaxy))throw new Error('未知学习空间：'+item.galaxy);
  }
  const groupsFor = key => {
    if(key==='englab')return Object.keys(config.experiments).map(id=>({id,title:config.pages[id].label,summary:config.pages[id].desc,objectives:[]}));
    const courses=key==='code-space'?codeCourses:futureCourses;
    return courses.map(course=>({id:course.course_key,title:course.title,summary:course.goal||course.objective,objectives:[course.goal||course.objective]}));
  };
  const activityDetails = new Map([...codeCourses,...futureCourses].flatMap(course=>course.activities).map(item=>[item.activity_key,item]));
  const snapshot = {
    schemaVersion:1,source,
    spaces:spaces.map(space=>({...space,topics:groupsFor(space.key).map(group=>({...group,
      activities:activities.filter(item=>item.galaxy===space.key&&item.subject===group.id).map(item=>{
        const detail=activityDetails.get(item.key);
        const experiment=config.experiments?.[item.subject]?.find(entry=>item.key===item.subject+'.'+entry.id);
        return {key:item.key,title:item.title,summary:detail?.goal||detail?.prompt||experiment?.description||'',href:item.href};
      }),
    }))})),
  };
  const total=snapshot.spaces.flatMap(space=>space.topics).flatMap(topic=>topic.activities).length;
  if(total!==activities.length)throw new Error('部分活动未分配到已登记学科。');
  return snapshot;
}

/** Adapt only the host navigation; public-mode filtering belongs to Astra's common packager. */
async function connectHostNavigation(labs) {
  const entry = path.join(labs, 'index.html');
  const searchButton = '<button type="button" id="nav-search-trigger"';
  const starLink = '<a href="#planets" class="nav-item nav-item--galaxy" data-page="planets"><i data-lucide="orbit"></i><span>星序</span></a>';
  const html = await fs.readFile(entry, 'utf8');
  if (!html.includes(searchButton)) throw new Error('实验导航模板已变化，请核对星序返回入口。');
  await fs.writeFile(entry, html
    .replace(searchButton, starLink + searchButton)
    .replaceAll('class="nav-item nav-item--galaxy" data-page="planets"', 'class="nav-item nav-item--galaxy" data-page="planets" aria-label="星序" title="返回星序主页面"')
    .replace('</body>', '<script src="../labs-host/bridge.js"></script></body>'), 'utf8');
  const codeEntry = path.join(labs, 'codevis', 'index.html');
  const code = await fs.readFile(codeEntry, 'utf8');
  await fs.writeFile(codeEntry, code.replace('</body>', '<script src="../../labs-host/bridge.js"></script></body>'), 'utf8');
}

async function checkGeneratedDirectory(labs) {
  const stat = await fs.lstat(labs).catch(error => {
    if (error.code === 'ENOENT') return null;
    throw error;
  });
  if (!stat) return false;
  if (!stat.isDirectory() || stat.isSymbolicLink() || await fs.realpath(labs) !== labs) {
    throw new Error('实验输出必须是本工作树 public/labs 下的普通目录。');
  }
  // Both the migration baseline and subsequent generated copies carry this manifest.
  const previous = JSON.parse(await fs.readFile(path.join(labs, 'import-manifest.json'), 'utf8'));
  if (!Array.isArray(previous.spaces) || !Number.isInteger(previous.activities)) throw new Error('拒绝覆盖没有实验清单的目录。');
  return true;
}

export async function prepareLabs() {
  const web = await fs.realpath(project);
  const repo = path.dirname(web);
  const publicDir = path.join(web, 'public'), labs = path.join(publicDir, 'labs');
  if (await fs.realpath(publicDir) !== publicDir) throw new Error('public 不能链接到当前工作树以外。');
  const previousCopy = await checkGeneratedDirectory(labs);
  const context = vm.createContext({ console }); context.window = context;
  for (const filename of ['shared/js/config.js', 'codevis/shared/js/course-manifest.js', 'pages/frontier/frontier-manifest.js']) {
    vm.runInContext(await fs.readFile(path.join(repo, filename), 'utf8'), context, { filename });
  }
  const git = (...args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8', windowsHide: true }).trim();
  const source = { directory: '.', commit: git('rev-parse','HEAD'), importedAt: new Date().toISOString(),
    dirty: Boolean(git('status','--porcelain','--','codevis','pages','shared','UI','index.html','LICENSE.md','extensions',
      'backend/app/catalogue','qianduan/scripts','qianduan/public/resource-explorer.css','web/scripts/prepare-labs.mjs')) };
  const snapshot = buildSnapshot({ activities: loadCatalog(repo), config: vm.runInContext('CONFIG', context),
    codeCourses: context.CvCourseManifest.courses, futureCourses: context.FrontierCourseManifest.courses, source });
  const groups = snapshot.spaces.map(space => ({ key: space.key, groups: space.topics.length,
    activities: space.topics.reduce((n, topic) => n + topic.activities.length, 0) }));

  // Build in this worktree first. A failed copy leaves the previous public bundle available.
  const stage = await fs.mkdtemp(path.join(web, '.tmp-labs-'));
  const next = path.join(stage, 'next'), previous = path.join(stage, 'previous');
  let restorePrevious = false;
  try {
    const counts = await packagePublicLabs(next);
    await connectHostNavigation(next);
    await fs.copyFile(path.join(repo, 'LICENSE.md'), path.join(next, 'LICENSE.md'));
    const summary = { ...source, activities: groups.reduce((n, space) => n + space.activities, 0), spaces: groups, ...counts };
    await fs.writeFile(path.join(next, 'import-manifest.json'), JSON.stringify(summary, null, 2) + '\n', 'utf8');
    const catalog = path.join(web, 'src', 'data', 'lab-catalog.json'), stagedCatalog = path.join(stage, 'catalog.json');
    await fs.mkdir(path.dirname(catalog), { recursive: true });
    await fs.writeFile(stagedCatalog, JSON.stringify(snapshot, null, 2) + '\n', 'utf8');
    if (previousCopy) { await fs.rename(labs, previous); restorePrevious = true; }
    await fs.rename(next, labs);
    restorePrevious = false;
    await fs.rename(stagedCatalog, catalog);
    return summary;
  } finally {
    if (restorePrevious) await fs.rename(previous, labs);
    if (path.dirname(await fs.realpath(stage)) !== web) throw new Error('临时打包目录不在当前 web 工作树。');
    await fs.rm(stage, { recursive: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { activities, files } = await prepareLabs();
  console.log('已从当前 Astra 工作树生成公开资源：' + activities + ' 项活动，' + files + ' 个运行文件。');
}
