// Check an exported session (JSONL or JSON) against the receiver's workflow rules.
// Usage: node tests/check-event-workflow.cjs <session.jsonl|session.json> [condition]
//
// This mirrors studyProgress() in server-common.php (v27: ten-Run budget,
// solution sets from task-solutions.json, seven comprehension answers): it
// reports every event the server would reject (422) and why. It does not
// replace a real Bococo QA run. If server-common.php changes, update this file.
const fs = require('node:fs');
const path = require('node:path');

const [file, conditionArg] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node tests/check-event-workflow.cjs <session.jsonl|session.json> [condition]');
  process.exit(2);
}
const text = fs.readFileSync(file, 'utf8');
const events = text.trim().startsWith('{') && !text.includes('\n{')
  ? JSON.parse(text).events
  : text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

const condition = conditionArg || events.find(e => e.assigned_condition)?.assigned_condition || 'jump-2';
const suffix = { 'all-local': ['A', 'B', 'C', 'D', 'E', 'F'], 'jump-2': ['F', 'E', 'D', 'C', 'B', 'A'], 'jump-5': ['B', 'C', 'D', 'E', 'F', 'A'] }[condition];
if (!suffix) { console.error('Unknown condition: ' + condition); process.exit(2); }
const order = ['T1', 'T2', 'T3', 'T4', 'T5', ...suffix];
const TRIALS = order.length;
const STAGES = ['consent', 'reminder', 'tutorial', 'comprehension', 'task', 'debrief', 'completion'];
const ANSWERS = { check1: 'b', check2: 'c', check3: 'a', check4: 'd', check5: 'b', check6: 'a', check7: 'c' };
const MAX_RUNS = 10;
const solutions = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'task-solutions.json'), 'utf8'));

let consent = false, reminder = false, tutorial = false, answers = false, comprehension = false;
let sequence = false, debrief = false, completed = false;
const tasks = new Map();
const attempts = new Map();
const runIds = new Set();
const successful = new Set();
const rejections = [];

for (const event of events) {
  const { stage, event_type: type } = event;
  const detail = event.detail || {};
  const reasons = [];
  if (typeof type !== 'string' || type.length > 100) reasons.push('event_type missing or over 100 characters');
  if (typeof stage !== 'string' || stage.length > 40) reasons.push('stage missing or over 40 characters');
  if (!STAGES.includes(stage)) reasons.push('Unknown stage');
  if (stage !== 'consent' && !consent) reasons.push('Consent required');
  if (['tutorial', 'comprehension', 'task', 'debrief', 'completion'].includes(stage) && !reminder) reasons.push('Reminder required');
  if (['comprehension', 'task', 'debrief', 'completion'].includes(stage) && !tutorial) reasons.push('Tutorial required');
  if (['task', 'debrief', 'completion'].includes(stage) && !comprehension) reasons.push('Comprehension required');
  if (['debrief', 'completion'].includes(stage) && !sequence) reasons.push('All tasks must be completed');
  if (type === 'consent_agreed') { if (stage !== 'consent') reasons.push('Invalid consent stage'); consent = true; }
  else if (type === 'reminder_acknowledged') { if (stage !== 'reminder') reasons.push('Invalid reminder stage'); reminder = true; }
  else if (type === 'tutorial_completed') { if (stage !== 'tutorial') reasons.push('Invalid tutorial stage'); tutorial = true; }
  else if (type === 'comprehension_submitted' && detail.passed === true) {
    if (stage !== 'comprehension') reasons.push('Invalid comprehension stage');
    if (Object.entries(ANSWERS).some(([k, v]) => detail.responses?.[k] !== v)) reasons.push('Invalid comprehension answers');
    answers = true;
  } else if (type === 'comprehension_passed') {
    if (stage !== 'comprehension' || !answers) reasons.push('Comprehension answers required');
    comprehension = true;
  } else if (type === 'run_completed') {
    const trial = event.trial_index;
    if (stage !== 'task' || !Number.isInteger(trial) || trial < 1 || trial > TRIALS ||
      event.task_item_id !== order[trial - 1] || detail.task_item_id !== order[trial - 1] ||
      typeof detail.ok !== 'boolean' || !Array.isArray(detail.frames) || detail.frames.length < 1 ||
      typeof detail.run_id !== 'string') reasons.push('Invalid task result');
    for (const key of ['movement_mask', 'role_mask']) {
      if (!Number.isInteger(detail[key]) || detail[key] < 0 || detail[key] > 255) reasons.push('Invalid rule mask');
    }
    for (let i = 1; i < trial; i++) if (!tasks.has(i)) { reasons.push('Previous task incomplete'); break; }
    if (tasks.has(trial) || (attempts.get(trial) || 0) >= MAX_RUNS) reasons.push('Trial already resolved');
    if (runIds.has(detail.run_id)) reasons.push('Repeated Run identifier');
    runIds.add(detail.run_id);
    const attempt = (attempts.get(trial) || 0) + 1;
    attempts.set(trial, attempt);
    if (event.attempt_index !== attempt || detail.shift_attempt_index !== attempt ||
      detail.outcome_protocol !== 'ten-run-budget-v1') reasons.push('Invalid attempt counter');
    const family = detail.active_rule_family;
    if (!['role', 'move_dir'].includes(family) || (family === 'role' && detail.movement_mask !== 0) ||
      (family === 'move_dir' && detail.role_mask !== 0)) reasons.push('Pure family required');
    const mask = family === 'role' ? detail.role_mask : detail.movement_mask;
    const correct = !!solutions[order[trial - 1]]?.[family]?.includes(mask);
    if (detail.ok !== correct) reasons.push('Result disagrees with verified solution set');
    const outcome = correct ? 'success' : attempt === MAX_RUNS ? 'failed' : null;
    if ((detail.trial_outcome ?? null) !== outcome) reasons.push('Invalid outcome');
    if (outcome !== null) tasks.set(trial, outcome);
    if (correct) successful.add(trial);
  } else if (type === 'trial_resolved') {
    const trial = event.trial_index;
    if (stage !== 'task' || !tasks.has(trial) || detail.outcome !== tasks.get(trial) ||
      detail.attempts !== attempts.get(trial)) reasons.push('Unverified trial outcome');
  } else if (type === 'task_sequence_completed') {
    if (stage !== 'task' || tasks.size !== TRIALS) reasons.push('All trials must be resolved');
    if (detail.successful_tasks !== successful.size || detail.failed_tasks !== TRIALS - successful.size) reasons.push('Incorrect score');
    sequence = true;
  } else if (type === 'debrief_responses_submitted') {
    if (stage !== 'debrief' || !Number.isInteger(detail.age) || detail.age < 18 || detail.age > 100 ||
      !['woman', 'man', 'nonbinary', 'other', 'prefer_not_to_say'].includes(detail.gender) ||
      !['movement', 'robot_type', 'both', 'no_consistent_strategy', 'unsure'].includes(detail.feature_use) ||
      typeof detail.strategy !== 'string' || detail.strategy.length > 4000) reasons.push('Invalid debrief responses');
    for (const key of ['engagement', 'difficulty']) {
      if (!Number.isInteger(detail[key]) || detail[key] < 1 || detail[key] > 10) reasons.push('Invalid questionnaire rating');
    }
    debrief = true;
  } else if (type === 'study_completed') {
    if (stage !== 'debrief' || !debrief) reasons.push('Submitted debrief required');
    completed = true;
  }
  if (stage === 'debrief' && type === 'ui_value_changed' && detail.value != null) reasons.push('Unsubmitted draft is not permitted');
  if (reasons.length) rejections.push(`#${event.event_index} ${type} [${stage}]: ${reasons.join('; ')}`);
}

console.log(`${events.length} events, condition ${condition}.`);
console.log(`Reached: consent ${consent}, reminder ${reminder}, tutorial ${tutorial}, comprehension ${comprehension}, ` +
  `tasks resolved ${tasks.size}/${TRIALS} (${successful.size} solved), sequence ${sequence}, debrief ${debrief}, completed ${completed}.`);
if (rejections.length) {
  console.log(`The server would reject ${rejections.length} event(s); the first rejected batch stops the upload:`);
  rejections.slice(0, 50).forEach(line => console.log('  ' + line));
  process.exit(1);
}
console.log('No event would be rejected by the workflow rules.');
