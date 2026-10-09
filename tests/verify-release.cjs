const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name));
const manifest = JSON.parse(read('release-manifest.json'));
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
assert.equal(manifest.version, '7bh-formal-v23');
for (const [name, expected] of Object.entries(manifest.files)) {
  assert.equal(hash(read(name)), expected, 'Release hash: ' + name);
  if (name.endsWith('.js')) new vm.Script(read(name).toString(), { filename: name });
}

function runtime(condition) {
  const location = new URL('http://localhost/routes/task.html?preview=1&schedule=' + condition);
  const context = vm.createContext({
    URL, URLSearchParams, structuredClone, location,
    history: { replaceState() {} },
    document: { body: { dataset: { stage: 'task' } }, readyState: 'loading', addEventListener() {} },
    window: { location },
  });
  for (const name of ['shared-pool.js', 'study-config.js', 'shuffle-bootstrap.js', 'engine.js']) {
    vm.runInContext(read(name).toString(), context, { filename: name });
  }
  vm.runInContext('window.api = { TASKS, simulateLocalContinuation };', context);
  return { pool: context.window.SHARED_POOL, ...context.window.api };
}

function rules(pool, family, mask) {
  const values = family === 'role' ? pool.vocabulary.role : pool.vocabulary.movement;
  return values.flatMap((v, i) => mask & (1 << i)
    ? [{ action: 'MOVE', conds: [{ p: family, v, negated: false }] }] : []);
}

const base = runtime('all-local');
const pool = base.pool;
assert.equal(hash(JSON.stringify({ bank: pool.bank, sequences: pool.sequences,
  vocabulary: pool.vocabulary, design_revision: pool.design_revision })), manifest.material_bank_sha256);
const expected = { T1: 8, T2: 10, T3: 10, T4: 26, T5: 90, A: 90, B: 88, C: 89, D: 73, E: 77, F: 13 };
const solutions = {};
for (const task of base.TASKS) {
  const valid = [];
  for (let mask = 0; mask < 256; mask++) {
    const result = base.simulateLocalContinuation(task, rules(pool, 'role', mask), new Set());
    if (result.ok) {
      assert.equal(result.completedAgentIds.length, task.agents.length);
      valid.push(mask);
    }
  }
  solutions[task.itemId] = valid;
  assert.ok(valid.includes(expected[task.itemId]), 'Reference Type rule: ' + task.itemId);
  if (manifest.unique_type_materials.includes(task.itemId)) {
    assert.deepEqual(valid, [expected[task.itemId]], 'Unique Type rule: ' + task.itemId);
  }
}

const popcount = value => value.toString(2).replaceAll('0', '').length;
for (const condition of ['all-local', 'jump-2', 'jump-5']) {
  const current = runtime(condition);
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
    const critical = manifest.critical_trials[condition];
    assert.equal(distances[critical - 1], 5);
    assert.ok(distances.slice(0, critical - 1).every(value => value <= 1));
    const task = current.TASKS[critical - 1];
    const result = current.simulateLocalContinuation(task, rules(pool, 'move_dir', 1), new Set());
    assert.ok(result.ok, 'North alternative: ' + condition);
    assert.equal(result.completedAgentIds.length, task.agents.length);
  }
}
console.log('Verified v23: runtime hashes, JavaScript syntax, 2,816 Type simulations, all three schedules and both north alternatives.');
