'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '../..');
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8');
const compact = (value) => String(value || '').replace(/>\s+</g, '><').replace(/\s+/g, ' ').replace(/\s+>/g, '>').trim();

function testRegistrationAndMarkup() {
  const html = read('index.html');
  const moduleSource = read('pages/engineering/robot-arm-ik/module.html');
  const styles = read('pages/engineering/robot-arm-ik/styles.css');
  const moduleStart = html.indexOf('<section class="content-section" data-module="robot-arm-ik"');
  const moduleEnd = html.indexOf('</section>', moduleStart) + '</section>'.length;
  assert.ok(moduleStart > 0 && moduleEnd > moduleStart, 'production robot-arm module mirror is missing');
  assert.equal(compact(html.slice(moduleStart, moduleEnd)), compact(moduleSource));
  assert.equal((html.match(/data-module="robot-arm-ik"/g) || []).length, 1);
  assert.match(html, /href="#engineering\/robot-arm-ik"[^>]*>机械臂实验<\/a>/);
  assert.match(html, /robot-arm-ik\/styles\.css\?v=20260825v834Show04P0/);
  assert.doesNotMatch(moduleSource, /课程目标|学习任务|学习证据|先预测|章节/);
  assert.match(styles, /> \.frontier-hero\[hidden\][\s\S]*display: none !important/);
  assert.match(styles, /engineering-activity-view[^}]*box-sizing: border-box;[^}]*width: 100%/);
  assert.match(styles, /content-section\[data-module="robot-arm-ik"\][^{]*\{[^}]*display: block;[^}]*padding: 0;/);
  assert.match(styles, /\.astra-exp--robot-arm-ik \{[^}]*box-sizing: border-box;/);

  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(read('pages/frontier/frontier-manifest.js'), context, { filename: 'frontier-manifest.js' });
  const courses = Array.from(context.window.FrontierCourseManifest.courses);
  const engineering = courses.find((course) => course.page === 'engineering');
  const robot = Array.from(engineering.activities).find((activity) => activity.activity_key === 'engineering.robot-arm-ik');
  assert.ok(robot);
  assert.equal(robot.route_slug, 'robot-arm-ik');
  assert.equal(robot.input_control, 'robot-arm-ik-parameter');

  const catalogContext = {
    window: null,
    AstraExperimentRegistry: {
      entries: () => Array.from({ length: 90 }, (_, index) => ({
        subject: index === 0 ? 'physics' : `subject-${Math.floor(index / 10)}`,
        id: index === 0 ? 'mechanics' : `activity-${index}`
      }))
    }
  };
  catalogContext.window = catalogContext;
  vm.createContext(catalogContext);
  vm.runInContext(read('shared/js/learning-activity-catalog.js'), catalogContext, { filename: 'learning-activity-catalog.js' });
  const verification = catalogContext.AstraLearningActivityCatalog.verify();
  assert.deepEqual(
    Object.fromEntries(Object.entries(verification).map(([key, value]) => [key, value.actual])),
    { englab: 90, 'code-space': 18, 'future-galaxy': 19 }
  );
  assert.equal(verification.englab.valid, true);
  assert.equal(verification['code-space'].valid, true);
  assert.equal(verification['future-galaxy'].valid, true);
}

function testSolver() {
  const context = {
    window: null,
    document: { querySelector: () => null },
    requestAnimationFrame: () => 1,
    cancelAnimationFrame() {},
    ResizeObserver: class { observe() {} disconnect() {} },
    AbortController,
    console,
    Math,
    Object
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('pages/engineering/robot-arm-ik/index.js'), context, { filename: 'robot-arm-ik/index.js' });
  const robot = context.RobotArmIk;
  assert.ok(robot);
  assert.equal(typeof context.initRobotArmIk, 'function');
  assert.equal(typeof context.destroyRobotArmIk, 'function');

  robot.parameter = 50;
  robot.target = { x: 1.55, y: 0.9 };
  const reachable = robot.solveTarget({ resetAngles: true, trace: false });
  assert.equal(reachable.status, 'reachable');
  assert.ok(reachable.residual <= 0.008);
  assert.ok(reachable.iterations <= 28);

  robot.target = { x: 2.76, y: 0.52 };
  const outside = robot.solveTarget({ resetAngles: true, trace: false });
  assert.equal(outside.status, 'outside');
  assert.ok(outside.residual > 0.008);
  assert.equal(robot.snapshot().link_lengths.length, 3);
  context.destroyRobotArmIk();
  assert.equal(robot.debugSnapshot().state, 'detached');
  assert.equal(robot.debugSnapshot().resources.animation_frames, 0);
  assert.equal(robot.debugSnapshot().resources.resize_observers, 0);
}

async function testRouteOwner() {
  const hero = { hidden: false };
  const bridgeView = { hidden: false };
  const robotView = { hidden: true };
  const classes = new Set();
  const page = {
    querySelector(selector) {
      if (selector === ':scope > .frontier-hero') return hero;
      if (selector === ':scope > .engineering-shell') return bridgeView;
      if (selector === '[data-engineering-view="robot-arm-ik"]') return robotView;
      return null;
    },
    classList: {
      toggle(name, enabled) {
        if (enabled) classes.add(name);
        else classes.delete(name);
      }
    }
  };
  const calls = [];
  const context = {
    window: null,
    location: { hash: '#engineering' },
    document: { getElementById: () => page, scripts: [] },
    addEventListener() {},
    scrollTo() {},
    AbortController,
    console,
    initBridgeTruss: () => { calls.push('bridge:init'); },
    destroyBridgeTruss: () => { calls.push('bridge:destroy'); },
    initRobotArmIk: () => { calls.push('robot:init'); },
    destroyRobotArmIk: () => { calls.push('robot:destroy'); }
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read('pages/engineering/engineering-page.js'), context, { filename: 'engineering-page.js' });

  await context.EngineeringPage.init();
  assert.equal(context.EngineeringPage.snapshot().current_view, 'bridge-truss');
  assert.equal(hero.hidden, false);
  assert.equal(bridgeView.hidden, false);
  assert.equal(robotView.hidden, true);

  context.location.hash = '#engineering/robot-arm-ik';
  await context.EngineeringPage.init();
  assert.equal(context.EngineeringPage.snapshot().current_view, 'robot-arm-ik');
  assert.equal(hero.hidden, true);
  assert.equal(bridgeView.hidden, true);
  assert.equal(robotView.hidden, false);
  assert.ok(classes.has('engineering-page--robot-arm-ik'));

  context.EngineeringPage.destroy();
  assert.deepEqual(calls, ['bridge:init', 'bridge:destroy', 'robot:init', 'robot:destroy']);
  assert.equal(context.EngineeringPage.snapshot().active, false);
  assert.equal(hero.hidden, false);
  assert.equal(bridgeView.hidden, false);
  assert.equal(robotView.hidden, true);
}

(async () => {
  testRegistrationAndMarkup();
  testSolver();
  await testRouteOwner();
  console.log('robot-arm-ik-show04-contract: registration, solver, route switching and cleanup PASS');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
