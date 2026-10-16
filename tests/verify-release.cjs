const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const manifest = JSON.parse(read('release-manifest.json'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
assert.equal(manifest.version, '7bh-formal-v27');
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.equal(hash(read(name)), expected, 'Release hash: ' + name);
  if (name.endsWith('.js')) new vm.Script(read(name).toString(), { filename: name });
}

function runtime(condition, inspectAllMaterials = false) {
  const location = new URL('http://localhost/routes/task.html?preview=1&schedule=' + condition);
  const context = vm.createContext({
    URL, URLSearchParams, structuredClone, location,
    history: { replaceState() {} },
    document: { body: { dataset: { stage: 'task' } }, readyState: 'loading', addEventListener() {} },
    window: { location },
  });
  for (const name of ['shared-pool.js', 'study-config.js', 'shuffle-bootstrap.js', 'engine.js']) {
    vm.runInContext(read(name).toString(), context, { filename: name });
    // Only the offline material audit enables the non-published conditions.
    if (name === 'study-config.js' && inspectAllMaterials) {
      vm.runInContext('window.STUDY_CONFIG = {...window.STUDY_CONFIG, preview_only:true};', context);
    }
  }
  vm.runInContext('window.api = { TASKS, simulateLocalContinuation };', context);
  return { pool: context.window.SHARED_POOL, config: context.window.STUDY_CONFIG, ...context.window.api };
}

function rules(pool, family, mask) {
  const values = family === 'role' ? pool.vocabulary.role : pool.vocabulary.movement;
  return values.flatMap((v, i) => mask & (1 << i)
    ? [{ action: 'MOVE', conds: [{ p: family, v, negated: false }] }] : []);
}

const base = runtime('all-local', true);
const pool = base.pool;
assert.deepEqual(Array.from(base.config.enabled_conditions), ['jump-2']);
assert.equal(base.config.initial_active_family, 'role');
assert.equal(base.config.max_runs_per_trial, 10);
assert.equal(base.config.payment.per_success_pence, 10);
assert.equal(base.config.payment.base_pence, null);
assert.equal(hash(JSON.stringify({ bank: pool.bank, sequences: pool.sequences,
  vocabulary: pool.vocabulary, design_revision: pool.design_revision })), manifest.material_bank_sha256);
const expected = { T1: 8, T2: 10, T3: 10, T4: 26, T5: 90, A: 90, B: 88, C: 89, D: 73, E: 77, F: 13 };
const solutions = {};
const canonical = JSON.parse(read('task-solutions.json'));
for (const task of base.TASKS) {
  for (const family of ['role', 'move_dir']) {
    const valid = [];
    for (let mask = 0; mask < 256; mask++) {
      const result = base.simulateLocalContinuation(task, rules(pool, family, mask), new Set());
      if (result.ok) {
        assert.equal(result.completedAgentIds.length, task.agents.length);
        valid.push(mask);
      }
    }
    assert.deepEqual(valid, canonical[task.itemId][family], 'Server solution set: ' + task.itemId + '/' + family);
    if (family === 'role') solutions[task.itemId] = valid;
  }
  const valid = solutions[task.itemId];
  assert.ok(valid.includes(expected[task.itemId]), 'Reference Type rule: ' + task.itemId);
  if (['T5','A','B','C','D','E','F'].includes(task.itemId)) {
    assert.deepEqual(valid, [expected[task.itemId]], 'Unique Type rule: ' + task.itemId);
  }
}

const popcount = value => value.toString(2).replaceAll('0', '').length;
for (const condition of ['all-local', 'jump-2', 'jump-5']) {
  assert.deepEqual(Array.from(runtime(condition).TASKS, task => task.itemId),
    ['T1','T2','T3','T4','T5','F','E','D','C','B','A'], 'Published runtime remains Early jump only');
  const current = runtime(condition, true);
  const order = Array.from(current.TASKS, task => task.itemId);
  const seq = pool.sequences[condition];
  assert.equal(order.length, 11);
  assert.deepEqual(order.slice(0, 5), ['T1', 'T2', 'T3', 'T4', 'T5']);
  assert.deepEqual(order.slice(5).sort(), ['A', 'B', 'C', 'D', 'E', 'F']);
  let previous = 8;
  const distances = order.map((item, index) => {
    const distance = Math.min(...solutions[item].map(mask => popcount(mask ^ previous)));
    assert.equal(distance, seq.reference[index].D);
    previous = seq.reference[index].selected_mask;
    assert.equal(previous, expected[item]);
    return distance;
  });
  assert.deepEqual(distances.slice(0, 5), [0, 1, 0, 1, 1]);
  if (condition === 'all-local') assert.deepEqual(distances.slice(5), [0, 1, 1, 1, 1, 1]);
  else {
    const critical = seq.critical_trial;
    assert.equal(distances[critical - 1], 5);
    assert.ok(distances.slice(0, critical - 1).every(value => value <= 1));
    const task = current.TASKS[critical - 1];
    const result = current.simulateLocalContinuation(task, rules(pool, 'move_dir', 1), new Set());
    assert.ok(result.ok, 'North alternative: ' + condition);
    assert.equal(result.completedAgentIds.length, task.agents.length);
  }
}

const tutorial = {window:{}};
vm.runInNewContext(read('guided-tutorial/steps.js').toString(), tutorial);
const steps = tutorial.window.GuidedTutorialConfig.steps;
const typeRun = steps.findIndex(step => step.id === 'type-run');
assert.ok(typeRun > steps.findIndex(step => step.id === 'practice-run'));
assert.equal(steps[typeRun].gate, 'run-type-success');
assert.ok(steps.slice(typeRun).every(step => step.rule === 'type-D'));
assert.ok(!steps.some(step => /bonus|payment/i.test(step.text)));
assert.ok(!steps.some(step => step.id === 'back-to-movement'));
assert.deepEqual(JSON.parse(JSON.stringify(tutorial.window.GuidedTutorialConfig.carryIntoFirstTask)), {family:'role',value:'loader'});
const comprehension = {window:{}};
vm.runInNewContext(read('guided-tutorial/comprehension.js').toString(), comprehension);
assert.deepEqual(JSON.parse(JSON.stringify(comprehension.window.GuidedComprehension.answers)),
  {check1:'b',check2:'c',check3:'a',check4:'d',check5:'b',check6:'a',check7:'c'});
const policy = require('../trial-policy.js');
let state = policy.empty();
for (let i=0;i<9;i++) state = policy.apply(state,false);
assert.equal(state.outcome,null);
assert.equal(policy.apply(state,true).outcome,'success');
const failed = policy.apply(state,false);
assert.equal(failed.outcome,'failed');
assert.throws(() => policy.apply(failed,true), /already resolved/);
const events = Array.from({length:11},(_,i)=>({stage:'task',event_type:'run_completed',trial_index:i+1,detail:{run_id:'test-'+i,ok:true}}));
const score = policy.summarize(events,11,base.config.payment);
assert.equal(score.bonus_pence,110);
assert.equal(score.total_pence,null);
assert.equal(policy.summarize([],11,base.config.payment).bonus_pence,0);
console.log('Verified v27: deployed hashes, syntax, 5,632 pure-rule simulations, all three schedules, Type-D tutorial finish, seven comprehension questions, ten-Run boundaries and bonus accounting.');
