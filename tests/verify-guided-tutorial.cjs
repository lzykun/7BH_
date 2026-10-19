// Checks the guided tutorial config against the real simulator, the approved
// participant text, both first-task modes and both dimLocked values.
// Run: node tests/verify-guided-tutorial.cjs
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name)).toString();
// Compare across vm realms by value.
const same = (actual, expected, message) => assert.equal(JSON.stringify(actual), JSON.stringify(expected), message);

// Loads the guided tutorial (and optionally the task runtime) for a page query.
function load(query = '', { runtime = false } = {}) {
  // A query starting with "?" replaces the default preview query.
  const location = new URL('http://localhost/routes/task.html' + (query.startsWith('?') ? query : '?preview=1&schedule=jump-2' + query));
  const styles = [];
  const bodyClasses = new Set();
  const document = {
    body: { dataset: { stage: 'task' }, classList: {
      add: name => bodyClasses.add(name),
      toggle: (name, on) => (on ? bodyClasses.add(name) : bodyClasses.delete(name)),
    } },
    head: { appendChild: style => styles.push(style.textContent) },
    readyState: 'loading', addEventListener() {}, getElementById: () => null, createElement: () => ({}), querySelector: () => null,
  };
  const context = vm.createContext({
    URL, URLSearchParams, structuredClone, location, console, document,
    history: { replaceState() {} },
    window: { location, addEventListener() {} },
  });
  const files = runtime ? ['shared-pool.js', 'study-config.js', 'shuffle-bootstrap.js', 'engine.js'] : ['study-config.js'];
  for (const name of [...files, 'guided-tutorial/steps.js', 'guided-tutorial/comprehension.js', 'guided-tutorial/engine.js']) {
    vm.runInContext(read(name), context, { filename: name });
  }
  if (runtime) vm.runInContext('window.api = { normalizeTask, simulateLocalContinuation };', context);
  // start() installs the lock styles, then stops at the missing task host.
  const installStyles = () => { try { context.window.GuidedTutorial.start({ host: {}, phase: 'tutorial' }); } catch {} return styles.join('\n'); };
  return { window: context.window, installStyles, bodyClasses };
}

const page = load('', { runtime: true });
const { normalizeTask, simulateLocalContinuation } = page.window.api;
const config = page.window.GuidedTutorialConfig;
const guide = page.window.GuidedTutorial;
const pool = page.window.SHARED_POOL;
const study = page.window.STUDY_CONFIG;

// 1. Real simulator: map 1 needs no rule; map 2 collides without one and is solved
//    by Movement west alone and by Type D alone, as T1 is.
const norms = (family, values) => values.map(v => ({ action: 'MOVE', conds: [{ p: family, v, negated: false }] }));
const sim = (scene, family, values) => simulateLocalContinuation(scene, norms(family, values), new Set());
const map = id => normalizeTask(structuredClone(config.maps[id]));
assert.ok(sim(map('m1'), 'role', []).ok, 'Map 1 with no rule: every robot arrives');
const clash = sim(map('m2'), 'role', []);
assert.equal(clash.ok, false, 'Map 2 with no rule fails');
assert.equal(clash.reason, 'collision', 'Map 2 with no rule: the robots collide');
assert.equal(config.maps.m2.id, 'tutorial_conflict_practice');
assert.equal(config.maps.m2.layout_source, 'v23-practice-mirrored-swapped-bays');
same(config.practice, { family: 'move_dir', value: 'W' }, 'Practice answer is Movement west');
same(config.alternative, { family: 'role', value: 'loader' }, 'Alternative-feature answer is Type D');
for (const value of pool.vocabulary.movement) {
  assert.equal(sim(map('m2'), 'move_dir', [value]).ok, value === 'W', `Movement ${value} alone ${value === 'W' ? 'solves' : 'fails'} map 2`);
}
for (const value of pool.vocabulary.role) {
  assert.equal(sim(map('m2'), 'role', [value]).ok, value === 'loader', `Type ${value} alone ${value === 'loader' ? 'solves' : 'fails'} map 2`);
}
// The practice map and T1 have the same solution sets in both families, so either carried rule solves T1.
const t1 = normalizeTask({ ...structuredClone(pool.bank[pool.sequences['jump-2'].materials[0]]), label: 'T1' });
const valuesOf = family => (family === 'role' ? pool.vocabulary.role : pool.vocabulary.movement);
const solving = (scene, family) => Array.from({ length: 256 }, (_, mask) => mask)
  .filter(mask => sim(scene, family, valuesOf(family).filter((_, bit) => mask & (1 << bit))).ok);
const canonical = JSON.parse(read('task-solutions.json'));
for (const family of ['move_dir', 'role']) {
  same(solving(t1, family), canonical.T1[family], `T1 ${family} solution set matches task-solutions.json`);
  same(solving(map('m2'), family), canonical.T1[family], `Practice ${family} solution set == T1 ${family} solution set`);
}
for (const mode of config.firstTaskModes) {
  const carry = config.carryFor(mode);
  assert.ok(sim(t1, carry.family, [carry.value]).ok, `${mode}: the carried rule solves T1 with no edits`);
}
for (const id of ['m1', 'm2']) {
  for (const [row, col] of config.maps[id].world.agents.flatMap(agent => [agent.start, agent.goal.target])) {
    assert.ok(row >= 2 && row <= 7 && col >= 2 && col <= 7, `${id}: robots and bays stay in rows/cols 2-7`);
  }
}

// 2. firstTaskOpens: the carried rule and T1's opening family are derived from it.
same(config.firstTaskModes, ['type', 'movement']);
assert.equal(config.firstTaskOpens, 'type', 'Default: T1 opens on Type');
same(config.carryFor('type'), config.alternative, 'Type mode carries Type D');
same(config.carryFor('movement'), config.practice, 'Movement mode carries Movement west');
same(config.carryIntoFirstTask, config.carryFor(config.firstTaskOpens));
assert.equal(config.initialActiveFamily, config.carryIntoFirstTask.family);
assert.equal(study.initial_active_family, config.initialActiveFamily, 'STUDY_CONFIG.initial_active_family matches firstTaskOpens');
for (const rule of [config.practice, config.alternative]) {
  assert.ok(valuesOf(rule.family).includes(rule.value), `Vocabulary has ${rule.family}:${rule.value}`);
}

// 3. Step sequences per mode and gadget switch (preview query parameters).
const ids = query => { const g = load(query).window.GuidedTutorial; return { steps: g.stepsFor(g.enabledGadgets()).map(s => s.id), settings: g.settings(), errors: g.validate(g.enabledGadgets()) }; };
const head = ['welcome', 'fullscreen', 'map', 'badges', 'run-1', 'replay', 'run-2', 'clash', 'task', 'rules', 'features',
  'pick-movement', 'select-value', 'match-outline', 'current-rule', 'practice-run', 'good-job'];
const alt = ['alt-intro', 'pick-type', 'select-type', 'type-run', 'type-good'];
const budgetSteps = ['budget-intro', 'budget-cost', 'budget-replay', 'budget-last', 'budget-out', 'budget-bonus'];
const tail = ['both-kept', ...budgetSteps, 'end'];
const sequences = {
  '': [...head, ...alt, ...tail],
  '&guide_off=alternative-feature': [...head, ...alt, ...tail], // forced on in Type mode
  '&guide_first_task=movement': [...head, ...alt, 'back-to-movement', ...tail],
  '&guide_first_task=movement&guide_off=alternative-feature': [...head, ...tail],
  '&guide_first_task=bogus': [...head, ...alt, ...tail],
};
for (const [query, expected] of Object.entries(sequences)) {
  const result = ids(query);
  same(result.steps, expected, `Steps for "${query || 'default'}"`);
  same(result.errors, [], `No config errors for "${query || 'default'}"`);
}
same(ids('&guide_first_task=movement').settings.carryIntoFirstTask, config.practice, 'Preview Movement mode carries west');
same(ids('').settings.carryIntoFirstTask, config.alternative, 'Default carries Type D');
assert.equal(load('?schedule=jump-2&guide_first_task=movement').window.GuidedTutorial.settings().firstTaskOpens, 'type', 'Only the preview can change the mode');

// 4. Approved participant text and wait notes. Changing any of these needs approval;
//    update this table in the same commit.
const TEXT = {
  welcome: ["Welcome to the Robot Warehouse! This is the screen you will work on. Let's walk through it together."],
  fullscreen: ['For the best view, please make your browser window full screen now.'],
  map: ['The robots are heading back to their charging bays. Each robot and its bay share the <em>same number and colour</em>.'],
  badges: ['The <em>arrow</em> shows which way a robot will move next. The <em>letter</em> is its Type. You will use these later.'],
  'run-1': ['Robots always take the shortest route to their bay. Press <em>Run rule</em> to watch them move.', 'Press Run rule to continue'],
  replay: ['Use the <em>← →</em> buttons to replay a run one step at a time.'],
  'run-2': ['Sometimes the layout gets more complicated. Press <em>Run rule</em> and see what happens on this map.', 'Press Run rule to continue'],
  clash: ['The two robots tried to enter the <em>same square</em> at the same time and collided. Robots in a collision stop; <em>other robots keep moving</em>.'],
  task: ["<span class='key'>Your task is to coordinate the robots and prevent them from colliding.</span>"],
  rules: ['You coordinate them with a <em>waiting rule</em>. When two robots meet, your rule decides which one waits.'],
  features: ['A rule can use one of two robot features: <em>Type</em> (the letter) or <em>Movement</em> direction (the arrow).'],
  'pick-movement': ["Let's use Movement for this map. Click the <em>Movement</em> tab.", 'Click Movement to continue'],
  'select-value': ['Robot 1 is moving <em>west ←</em>. Select <em>west</em> so that robot waits when the two meet.', 'Select west to continue'],
  'match-outline': ['Robots that match your rule get a <em>green outline</em>. It shows who would wait. It does not mean the rule works yet.'],
  'current-rule': ['Your current rule is written out here in words.'],
  'practice-run': ['Press <em>Run rule</em> to test your rule.', 'Get both robots to their bays to continue'],
  'good-job': ["<span class='key'>Good job!</span> Robot 1 waited, robot 2 passed, and both reached their bays in the same Run."],
  'alt-intro': ["You can always try the other feature. Let's solve the same map with <em>Type</em>."],
  'pick-type': ["Click <em>Type</em>. Your Movement selection is kept separately and won't change.", 'Click Type to continue'],
  'select-type': ['Robot 1 is <em>Type D</em>. Select <em>D</em> so it waits.', 'Select D to continue'],
  'type-run': ['Press <em>Run rule</em>. Only the open tab is used, so this Run uses your Type rule.', 'Get both robots to their bays to continue'],
  'type-good': [{ type: 'Both robots are home! Keep <em>Type D</em> selected for your first task.', movement: 'That works too! Both features can solve a map.' }],
  'back-to-movement': ['Click <em>Movement</em>. Your <em>west</em> selection is still there.', 'Click Movement to continue'],
  'both-kept': ['Each tab keeps its own selections, and both are carried into the next task. You can change them at any time. The open tab is the rule every robot follows when you press Run.'],
  // {maxRuns} and {bonus} are filled from STUDY_CONFIG (max_runs_per_trial, payment.per_success_pence).
  'budget-intro': ['Each task gives you <em>{maxRuns} Runs</em>. This counter shows how many you have left. Here it is just for practice.'],
  'budget-cost': ["Every press of <em>Run rule</em> uses one Run, even if you haven't changed your selections. Press it now and watch the counter.", 'Press Run rule to continue'],
  'budget-replay': ['Replaying with the <em>← →</em> buttons is free. It never uses a Run. Try it.', 'Press ← or → to continue'],
  'budget-last': ['On your last Run, the counter turns red. If every robot gets home on <em>Run {maxRuns}</em>, the task still counts as solved.'],
  'budget-out': ['If some robots are still not home after Run {maxRuns}, you move on to the next task. Your <em>last selections stay selected</em>.'],
  'budget-bonus': ['Each task you solve earns a <em>{bonus} bonus</em>, on top of your base payment. A solved task shows a green tick here.'],
  end: [{ type: 'Next come a few quick questions, then your first task. <em>Type D</em> will stay selected.', movement: "That's it! Next come a few quick questions, then your first task on the full warehouse map." }],
};
same(config.steps.map(step => step.id), Object.keys(TEXT), 'Every step has approved text, in order');
for (const step of config.steps) {
  const [text, wait] = TEXT[step.id];
  same(step.text, text, `Approved text: ${step.id}`);
  assert.equal(step.wait ?? null, wait ?? null, `Approved wait note: ${step.id}`);
  if (step.gate) assert.ok(step.wait, `Gated step ${step.id} has a wait note`);
}
// Amounts are never literals: no "£", no Run count in the text; {maxRuns} and {bonus} only.
for (const item of config.steps) {
  const text = JSON.stringify([item.text, item.wait ?? '']);
  assert.ok(!/£|\b10\b/.test(text), `${item.id}: no literal amounts`);
  for (const name of text.match(/\{(\w+)\}/g) || []) assert.ok(['{maxRuns}', '{bonus}'].includes(name), `${item.id}: known placeholder ${name}`);
}
same(config.budgetTags, { practice: 'Practice', example: 'Example' }, 'Approved counter tags');
assert.equal(config.practiceRetryText, 'Try again: select west on the Movement tab, then press Run rule.');

// 5. Step structure.
const step = id => config.steps.find(item => item.id === id);
for (const id of alt) assert.equal(step(id).gadget, 'alternative-feature', `${id} is in alternative-feature`);
assert.equal(step('back-to-movement').gadget, 'core');
assert.equal(step('back-to-movement').needs, 'alternative-feature');
same(step('back-to-movement').modes, ['movement']);
assert.equal(step('type-run').gate, 'run-type-success');
assert.ok(step('good-job').celebrate && step('type-good').celebrate, 'Both success steps celebrate');
assert.ok(!config.steps.some(item => item.rule === 'move-N'), 'move-N is renamed move-W');
for (const id of ['match-outline', 'current-rule', 'practice-run', 'good-job', 'alt-intro', 'pick-type']) assert.equal(step(id).rule, 'move-W');
for (const id of tail) assert.equal(step(id).rule, 'final', `${id} shows the rule T1 opens with`);
same(config.steps.filter(item => item.budget).map(item => item.id), budgetSteps, 'Budget steps');
for (const item of config.steps.filter(item => item.budget)) assert.equal(item.map, 'm2');
same(budgetSteps.map(id => step(id).budget), [
  { used: 0, tag: 'practice' }, { used: 0, count: true, tag: 'practice' }, { used: 1, tag: 'practice' },
  { left: 1, tag: 'example' }, { left: 0, tag: 'example', runLabel: 'Next task' }, { solved: true, tag: 'example' },
], 'Counter demo states: 10, 10 -> 9 on the Run, 9 while replaying, last Run, none left, solved');
assert.equal(step('budget-cost').gate, 'run-any');
assert.equal(step('budget-replay').gate, 'replay-step');

// 6. Gadget switches: each can be turned off unless a step needs it; core cannot.
const all = Object.fromEntries(Object.keys(config.gadgets).map(id => [id, true]));
same(guide.validate(all), [], 'Every gadget on is valid');
for (const id of Object.keys(config.gadgets).filter(id => id !== 'core')) {
  const errors = guide.validate({ ...all, [id]: false });
  const needed = Object.values(config.gadgets).some(gadget =>
    gadget.requires && config.steps.find(item => item.id === gadget.requires)?.gadget === id);
  assert.equal(errors.length > 0, needed, `Turning off ${id}`);
}
assert.ok(guide.validate({ ...all, core: false }).length > 0, 'core cannot be turned off');

// 7. dimLocked: locked parts are never clickable; the grey-out only with dimLocked.
assert.equal(config.dimLocked, false, 'dimLocked is off by default');
for (const [query, dim] of [['', false], ['&guide_dim=1', true], ['&guide_dim=0', false]]) {
  const run = load(query);
  const css = run.installStyles();
  assert.equal(run.window.GuidedTutorial.settings().dimLocked, dim, `dimLocked for "${query || 'default'}"`);
  assert.equal(run.bodyClasses.has('guided-dim-locked'), dim, `Body class for "${query || 'default'}"`);
  for (const part of Object.keys(config.parts)) {
    assert.ok(css.includes(`body.guided-active:not([data-guide-unlock~="${part}"])`), `${part} is locked`);
    assert.ok(new RegExp(`body\\.guided-active\\.guided-dim-locked:not\\(\\[data-guide-unlock~="${part}"\\]\\)[^{]*\\{opacity:\\.22;filter:grayscale\\(1\\);\\}`).test(css), `${part} greys out only under guided-dim-locked`);
  }
  assert.ok(!/body\.guided-active:not[^{]*\{[^}]*opacity/.test(css.replace(/body\.guided-active\.guided-dim-locked[^}]*\}/g, '')), 'No grey-out without guided-dim-locked');
}
assert.equal(load('?schedule=jump-2&guide_dim=1').window.GuidedTutorial.settings().dimLocked, false, 'Only the preview can change dimLocked');

// 8. Every highlighted or greyed element exists on the task page (static) or is drawn by app.js.
const taskHtml = read('routes/task.html');
const appJs = read('app.js');
const drawnByApp = {
  '.simple-current-rule': /current\.className = "simple-current-rule"/,
  '.simple-rule-context': /context\.className = "simple-rule-context"/,
  '.simple-rule-intro': /intro\.className = "simple-rule-intro"/,
  '.rule-family-tabs': /tabs\.className = "rule-family-tabs"/,
  '.simple-family-sections': /familySections\.className = "simple-family-sections/,
  '#rule-family-tab-move_dir': /tab\.id = `rule-family-tab-\$\{field\.predicate\}`/,
  '#rule-family-tab-role': /tab\.id = `rule-family-tab-\$\{field\.predicate\}`/,
};
const selectors = [...Object.values(config.parts).flat(), ...Object.values(config.targets)];
for (const selector of selectors) {
  const name = selector.slice(1);
  const inPage = selector.startsWith('#')
    ? taskHtml.includes(`id="${name}"`)
    : new RegExp(`class="[^"]*\\b${name}\\b`).test(taskHtml);
  assert.ok(inPage || drawnByApp[selector]?.test(appJs), `Selector ${selector} exists`);
}
for (const id of ['guided-layer', 'guided-spot', 'guided-bubble', 'guided-message', 'guided-wait', 'guided-back', 'guided-next', 'guided-count',
  'guided-comprehension', 'guided-config-error', 'run-budget', 'run-budget-number', 'run-budget-label', 'run-budget-tag',
  'comprehension-bonus', 'comprehension-bonus-amount', 'comprehension-start']) {
  assert.ok(taskHtml.includes(`id="${id}"`), `task.html has #${id}`);
}

// 9. Runs-left counter and confetti styles.
assert.ok(taskHtml.includes('href="../run-budget.css"'), 'task.html links run-budget.css');
const budgetCss = read('run-budget.css');
for (const state of ['low', 'last', 'empty', 'solved']) assert.ok(budgetCss.includes(`.run-budget[data-state="${state}"]`), `Counter state ${state}`);
assert.match(budgetCss, /width:206px;\s*height:44px;/, 'Counter is 206x44');
assert.match(budgetCss, /content:"\/" attr\(data-limit\)/, 'Counter shows "/limit" from data-limit');
assert.match(budgetCss, /\.run-budget\[hidden\]\{display:none;\}/, 'Hidden counter is not drawn');
assert.equal(taskHtml.match(/<span class="run-budget-track"[^>]*>(.*?)<\/span>/)[1].match(/<i><\/i>/g).length, study.max_runs_per_trial, 'One pip per Run');
assert.match(read('guided-tutorial/guided.css'), /body > \.task-success-confetti\{position:fixed;inset:0;/, 'Tutorial confetti covers the window');
assert.match(read('guided-tutorial/engine.js'), /host\.confetti\(document\.body, window\.innerWidth, window\.innerHeight\)/, 'Confetti spreads over the window');

// 10. Comprehension pass screen (approved wording; amounts filled from STUDY_CONFIG).
const comprehensionJs = read('guided-tutorial/comprehension.js');
assert.match(comprehensionJs, /passed \? "You're ready" : "Please try again"/);
assert.match(comprehensionJs, /`All \$\{Object\.keys\(COMPREHENSION_ANSWERS\)\.length\} answers are correct\.`/);
assert.match(comprehensionJs, /per_success_pence/);
assert.match(comprehensionJs, /max_runs_per_trial/);
for (const text of ['<small>bonus</small>', '<p>for every task you solve, on top of your base payment.</p>',
  '<li><strong><span data-max-runs></span> Runs per task</strong>Every Run counts. Replays are free.</li>',
  '<li><strong>Run <span data-max-runs></span> counts</strong>Solving the task on your last Run still earns the bonus.</li>',
  '<li><strong>Your rule stays</strong>Your selections carry over to the next task.</li>',
  'id="comprehension-start" type="button" hidden>Start the first task</button>']) {
  assert.ok(taskHtml.includes(text), `Pass screen: ${text}`);
}
assert.ok(!/£|\b10 Runs/.test(taskHtml.slice(taskHtml.indexOf('id="comprehension-bonus"'), taskHtml.indexOf('id="comprehension-start"'))), 'Pass screen has no literal amounts');

// 11. Comprehension answers match the receiver's.
const server = read('server-common.php').match(/foreach \(\[('check1'[^\]]*)\] as \$key=>\$value\)/)[1];
const serverAnswers = Object.fromEntries([...server.matchAll(/'(check\d)'=>'([a-d])'/g)].map(match => [match[1], match[2]]));
same(page.window.GuidedComprehension.answers, serverAnswers, 'Comprehension answers match server-common.php');
for (const name of Object.keys(serverAnswers)) assert.ok(taskHtml.includes(`name="${name}"`), `task.html asks ${name}`);

console.log(`Verified guided tutorial: ${config.steps.length} steps with approved text, both first-task modes, ` +
  `gadget switches, dimLocked on and off, practice = T1 solution sets in both families, ${selectors.length} selectors, ` +
  `the Runs-left counter, window confetti and ${Object.keys(serverAnswers).length} comprehension answers.`);
