// Checks the guided tutorial config against the real simulator, the storyboard
// spec and the task page. Run: node tests/verify-guided-tutorial.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name)).toString();

const location = new URL('http://localhost/routes/task.html?preview=1&schedule=all-local');
const context = vm.createContext({
  URL, URLSearchParams, structuredClone, location, console,
  history: { replaceState() {} },
  document: { body: { dataset: { stage: 'task' } }, readyState: 'loading', addEventListener() {} },
  window: { location },
});
for (const name of ['shared-pool.js', 'study-config.js', 'shuffle-bootstrap.js', 'engine.js',
  'guided-tutorial/steps.js', 'guided-tutorial/comprehension.js', 'guided-tutorial/engine.js']) {
  vm.runInContext(read(name), context, { filename: name });
}
vm.runInContext('window.api = { normalizeTask, simulateLocalContinuation };', context);
const { normalizeTask, simulateLocalContinuation } = context.window.api;
const config = context.window.GuidedTutorialConfig;
const guide = context.window.GuidedTutorial;
const pool = context.window.SHARED_POOL;

// 1. Real simulator: no rule -> map 1 succeeds, map 2 collides; the practice answer solves map 2.
const norms = (family, values) => values.map(v => ({ action: 'MOVE', conds: [{ p: family, v, negated: false }] }));
const run = (map, family, values) => simulateLocalContinuation(normalizeTask(structuredClone(config.maps[map])), norms(family, values), new Set());
const m1 = run('m1', 'role', []);
assert.ok(m1.ok, 'Map 1 with no rule: every robot arrives');
// Map 2 is the v23 practice layout mirrored left-right with the bays swapped.
const m2 = run('m2', 'role', []);
assert.equal(m2.ok, false, 'Map 2 with no rule fails');
assert.equal(m2.reason, 'collision', 'Map 2 with no rule: the robots collide');
assert.equal(config.maps.m2.id, 'tutorial_conflict_practice');
assert.equal(config.maps.m2.layout_source, 'v23-practice-mirrored-swapped-bays');
assert.equal(config.practice.family, 'move_dir');
assert.equal(config.practice.value, 'W', 'Practice answer is Movement west');
assert.deepEqual({ ...config.carryIntoFirstTask }, { ...config.practice }, 'T1 starts with the practice rule');
const practice = run('m2', 'move_dir', ['W']);
assert.ok(practice.ok, 'Movement west alone solves map 2');
assert.equal(practice.completedAgentIds.length, config.maps.m2.world.agents.length);
for (const value of pool.vocabulary.movement.filter(v => v !== 'W')) {
  assert.equal(run('m2', 'move_dir', [value]).ok, false, `Movement ${value} alone fails on map 2`);
}
assert.ok(run('m2', 'role', ['loader']).ok, 'Type D alone also solves map 2 (as in v23)');
// Every Movement rule (all 256 value sets) that solves map 2 also solves T1, and vice versa.
const t1 = normalizeTask({ ...structuredClone(pool.bank[pool.sequences['all-local'].materials[0]]), label: 'T1' });
const movementSet = mask => pool.vocabulary.movement.filter((_, bit) => mask & (1 << bit));
const solving = scene => Array.from({ length: 256 }, (_, mask) => mask)
  .filter(mask => simulateLocalContinuation(scene, norms('move_dir', movementSet(mask)), new Set()).ok);
const practiceSet = solving(normalizeTask(structuredClone(config.maps.m2)));
const t1Set = solving(t1);
assert.deepEqual(practiceSet, t1Set, 'Practice Movement solution set == T1 Movement solution set');
const bit = value => 1 << pool.vocabulary.movement.indexOf(value);
assert.ok(t1Set.includes(bit('W')), 'T1 solution set includes west alone');
assert.ok(t1Set.every(mask => mask & bit('W')), 'Every solving Movement rule includes west');
assert.ok(t1Set.every(mask => !(mask & bit('N'))), 'No solving Movement rule includes north');
assert.ok(simulateLocalContinuation(t1, norms('move_dir', ['W']), new Set()).ok, 'The carried rule solves T1 with no edits');
for (const map of ['m1', 'm2']) {
  for (const [row, col] of config.maps[map].world.agents.flatMap(agent => [agent.start, agent.goal.target])) {
    assert.ok(row >= 2 && row <= 7 && col >= 2 && col <= 7, `${map}: robots and bays stay in rows/cols 2-7`);
  }
  assert.equal(config.maps[map].world.rows, 19);
  assert.equal(config.maps[map].world.cols, 19);
}

// 2. Practice and carried rule use real vocabulary values.
for (const rule of [config.practice, config.carryIntoFirstTask]) {
  const values = rule.family === 'role' ? pool.vocabulary.role : pool.vocabulary.movement;
  assert.ok(values.includes(rule.value), `Vocabulary has ${rule.family}:${rule.value}`);
}

// 3. Steps, gadgets and participant text match the storyboard spec.
const storyboard = read('docs/guided-tutorial-storyboard.html');
const block = (start, end) => storyboard.slice(storyboard.indexOf(start), storyboard.indexOf(end, storyboard.indexOf(start)) + end.length);
const spec = vm.runInNewContext(`${block('const GADGETS = {', '\n};')}\n${block('const STEPS = [', '\n];')}\n({GADGETS, STEPS})`);
assert.deepEqual(Object.keys(config.gadgets), Object.keys(spec.GADGETS), 'Same gadgets as the storyboard');
for (const [id, gadget] of Object.entries(spec.GADGETS)) {
  assert.equal(config.gadgets[id].requires, gadget.requires, `Gadget ${id} dependency`);
}
assert.equal(config.steps.length, spec.STEPS.length, 'Same number of steps as the storyboard');
// Approved deviations from the storyboard: west instead of north, robot 1 waits,
// and highlight areas fitted to the mirrored v23 practice map.
const practiceArea = [[2, 2], [6, 6]];
const deviations = {
  'run-2': { area: practiceArea },
  'select-value': {
    target: 'value:W',
    text: 'Robot 1 is moving <em>west ←</em>. Select <em>west</em> so that robot waits when the two meet.',
    wait: 'Select west to continue',
  },
  'match-outline': { target: 'robot:1' },
  'practice-run': { area: practiceArea },
  'good-job': {
    area: practiceArea,
    text: "<span class='key'>Good job!</span> Robot 1 waited, robot 2 passed, and both reached their bays in the same Run.",
  },
};
const fields = ['id', 'gadget', 'map', 'rule', 'shown', 'target', 'area', 'targetAlso', 'unlock', 'gate', 'bubbleDx', 'celebrate', 'text', 'wait'];
spec.STEPS.forEach((expected, index) => {
  const actual = config.steps[index];
  for (const field of fields) {
    const want = deviations[expected.id]?.[field] ?? expected[field];
    assert.deepEqual(JSON.parse(JSON.stringify(actual[field] ?? null)), JSON.parse(JSON.stringify(want ?? null)),
      `Step ${index + 1} (${expected.id}) ${field} matches the storyboard`);
  }
});
assert.ok(storyboard.includes(config.practiceRetryText.replace('west', 'north')), 'Retry text is the storyboard wording (with west)');

// 4. Gadget dependencies: everything on is valid; each gadget off is valid unless something needs it.
const all = Object.fromEntries(Object.keys(config.gadgets).map(id => [id, true]));
assert.deepEqual([...guide.validate(all)], [], 'Config with every gadget on is valid');
for (const id of Object.keys(config.gadgets).filter(id => id !== 'core')) {
  const errors = guide.validate({ ...all, [id]: false });
  const needed = Object.values(config.gadgets).some(gadget =>
    gadget.requires && config.steps.find(step => step.id === gadget.requires)?.gadget === id);
  assert.equal(errors.length > 0, needed, `Turning off ${id}`);
}
assert.ok(guide.validate({ ...all, core: false }).length > 0, 'core cannot be turned off');

// 5. Every highlighted or greyed element exists on the task page (static) or is drawn by app.js.
const taskHtml = read('routes/task.html');
const appJs = read('app.js');
const drawnByApp = {
  '.simple-current-rule': /current\.className = "simple-current-rule"/,
  '.simple-rule-context': /context\.className = "simple-rule-context"/,
  '.simple-rule-intro': /intro\.className = "simple-rule-intro"/,
  '.rule-family-tabs': /tabs\.className = "rule-family-tabs"/,
  '.simple-family-sections': /familySections\.className = "simple-family-sections/,
  '#rule-family-tab-move_dir': /tab\.id = `rule-family-tab-\$\{field\.predicate\}`/,
};
const selectors = [...Object.values(config.parts).flat(), ...Object.values(config.targets)];
for (const selector of selectors) {
  const name = selector.slice(1);
  const inPage = selector.startsWith('#')
    ? taskHtml.includes(`id="${name}"`)
    : new RegExp(`class="[^"]*\\b${name}\\b`).test(taskHtml);
  assert.ok(inPage || drawnByApp[selector]?.test(appJs), `Selector ${selector} exists`);
}
for (const id of ['guided-layer', 'guided-spot', 'guided-bubble', 'guided-message', 'guided-wait', 'guided-back', 'guided-next', 'guided-count', 'guided-comprehension', 'guided-config-error']) {
  assert.ok(taskHtml.includes(`id="${id}"`), `task.html has #${id}`);
}

// 6. Comprehension answers are the existing ones.
const answers = vm.runInNewContext(`(${read('tutorial.js').match(/const COMPREHENSION_ANSWERS = (\{[^}]*\});/)[1]})`);
assert.equal(JSON.stringify(context.window.GuidedComprehension.answers), JSON.stringify(answers), 'Comprehension answers match tutorial.js');

console.log(`Verified guided tutorial: ${config.steps.length} steps match the storyboard, real-simulator maps, ` +
  `gadget dependencies, ${selectors.length} selectors and comprehension answers.`);
