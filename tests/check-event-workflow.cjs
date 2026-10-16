// Check an exported session (JSONL or JSON) against the receiver's workflow rules.
// Usage: node tests/check-event-workflow.cjs <session.jsonl|session.json> [condition]
//
// This mirrors studyProgress() in server-common.php: it reports every event the
// server would reject (422) and why. It does not replace a real Bococo QA run.
// If server-common.php changes, update this file to match.
const fs = require('node:fs');

const [file, conditionArg] = process.argv.slice(2);
if (!file) {
  console.error('Usage: node tests/check-event-workflow.cjs <session.jsonl|session.json> [condition]');
  process.exit(2);
}
const text = fs.readFileSync(file, 'utf8');
const events = text.trim().startsWith('{') && !text.includes('\n{')
  ? JSON.parse(text).events
  : text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));

const condition = conditionArg || events.find(e => e.assigned_condition)?.assigned_condition || 'all-local';
const suffix = { 'all-local': ['A', 'B', 'C', 'D', 'E', 'F'], 'jump-2': ['F', 'E', 'D', 'C', 'B', 'A'], 'jump-5': ['B', 'C', 'D', 'E', 'F', 'A'] }[condition];
if (!suffix) { console.error('Unknown condition: ' + condition); process.exit(2); }
const order = ['T1', 'T2', 'T3', 'T4', 'T5', ...suffix];
const TRIALS = order.length;
const STAGES = ['consent', 'reminder', 'tutorial', 'comprehension', 'task', 'debrief', 'completion'];
const ANSWERS = { check1: 'b', check2: 'c', check3: 'a', check4: 'd' };

let consent = false, reminder = false, tutorial = false, answers = false, comprehension = false;
let sequence = false, debrief = false, completed = false;
const tasks = new Set();
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
    if (detail.ok) tasks.add(trial);
  } else if (type === 'task_sequence_completed') {
    if (stage !== 'task' || tasks.size !== TRIALS) reasons.push('Eleven successful tasks required');
    sequence = true;
  } else if (type === 'debrief_responses_submitted') {
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
  `tasks passed ${tasks.size}/${TRIALS}, sequence ${sequence}, debrief ${debrief}, completed ${completed}.`);
if (rejections.length) {
  console.log(`The server would reject ${rejections.length} event(s); the first rejected batch stops the upload:`);
  rejections.slice(0, 50).forEach(line => console.log('  ' + line));
  process.exit(1);
}
console.log('No event would be rejected by the workflow rules.');
