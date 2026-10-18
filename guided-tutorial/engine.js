/* Guided tutorial engine: walks the steps in guided-tutorial/steps.js over the
 * real task screen. app.js draws everything through window.TaskHost; this file
 * only greys and unlocks parts, cuts the spotlight, places the bubble, gates
 * the Next button, records tutorial events and resumes after a reload.
 */
(function(){
"use strict";

const CONFIG = window.GuidedTutorialConfig;
const PROTOCOL = CONFIG?.protocol || null;
const CHECKPOINT = "guided_tutorial";
const BUBBLE_WIDTH = 380;
const SPOT_PAD = 6;
const GATES = new Set(["run-any", "run-success", "run-type-success", "family-move", "family-type", "value", "type-value"]);
const RULE_STATES = new Set(["none", "move-tab", "move-W", "type-tab", "type-D", "move-both", "final"]);

const $ = id => document.getElementById(id);
const data = () => window.StudyData;

let host = null;
let onFinished = () => {};
let seq = [];
let pos = 0;
let done = new Set();
let round = 1;
let celebrated = new Set();
let startedAt = 0;
let stepViewedAt = 0;
let viewedStepId = null;
let lastPracticeRule = null;
let lastAlternativeRule = null;
let active = false;
let placeTimer = null;

function record(type, detail={}){
  return data()?.record(type, {tutorial_protocol:PROTOCOL, ...detail});
}

function previewMode(){
  return (data()?.params || new URLSearchParams(location.search)).get("preview") === "1";
}

function previewParam(name){
  if(!previewMode()) return null;
  return new URLSearchParams(location.search).get(name) || data()?.params.get(name) || null;
}

// Which tab T1 opens on. The preview can override it with &guide_first_task=type|movement.
function firstTaskOpens(){
  const requested = previewParam("guide_first_task");
  return CONFIG.firstTaskModes.includes(requested) ? requested : CONFIG.firstTaskOpens;
}

// Effective settings: app.js reads the carried rule from here.
function settings(){
  const mode = firstTaskOpens();
  const carry = CONFIG.carryFor(mode);
  const dim = previewParam("guide_dim");
  const dimLocked = dim === "1" ? true : dim === "0" ? false : CONFIG.dimLocked === true;
  return {firstTaskOpens:mode, carryIntoFirstTask:carry, initialActiveFamily:carry.family, dimLocked};
}

// &guide_off=a,b turns gadgets off, in preview only. When T1 opens on Type,
// alternative-feature stays on: the Type rule must be tested before it is carried.
function enabledGadgets(){
  const enabled = Object.fromEntries(Object.keys(CONFIG.gadgets).map(id => [id, true]));
  const off = previewParam("guide_off") || "";
  off.split(",").map(id => id.trim()).filter(Boolean).forEach(id => { enabled[id] = false; });
  if(firstTaskOpens() === "type" && "alternative-feature" in enabled) enabled["alternative-feature"] = true;
  return enabled;
}

const textOf = step => typeof step.text === "string" ? step.text : step.text?.[firstTaskOpens()] || "";

function validate(enabled){
  const errors = [];
  const stepIds = new Set(CONFIG.steps.map(step => step.id));
  if(enabled.core === false) errors.push('The "core" gadget cannot be turned off.');
  if(!CONFIG.firstTaskModes.includes(CONFIG.firstTaskOpens)) errors.push(`Unknown firstTaskOpens "${CONFIG.firstTaskOpens}".`);
  Object.keys(enabled).forEach(id => {
    if(!CONFIG.gadgets[id]) errors.push(`Unknown gadget "${id}".`);
  });
  Object.entries(CONFIG.gadgets).forEach(([id, gadget]) => {
    if(!gadget.requires || !enabled[id]) return;
    const required = CONFIG.steps.find(step => step.id === gadget.requires);
    if(!required) errors.push(`Gadget "${id}" requires step "${gadget.requires}", which does not exist.`);
    else if(!enabled[required.gadget]) errors.push(`Gadget "${id}" requires step "${gadget.requires}", but its gadget "${required.gadget}" is off.`);
  });
  if(stepIds.size !== CONFIG.steps.length) errors.push("Step ids must be unique.");
  CONFIG.steps.forEach(step => {
    if(!CONFIG.gadgets[step.gadget]) errors.push(`Step "${step.id}" uses unknown gadget "${step.gadget}".`);
    if(step.needs && !CONFIG.gadgets[step.needs]) errors.push(`Step "${step.id}" needs unknown gadget "${step.needs}".`);
    (step.modes || []).forEach(mode => {
      if(!CONFIG.firstTaskModes.includes(mode)) errors.push(`Step "${step.id}" has unknown mode "${mode}".`);
    });
    if(typeof step.text !== "string" && !CONFIG.firstTaskModes.every(mode => typeof step.text?.[mode] === "string")){
      errors.push(`Step "${step.id}" needs text for every first-task mode.`);
    }
    if(!CONFIG.maps[step.map]) errors.push(`Step "${step.id}" uses unknown map "${step.map}".`);
    if(!RULE_STATES.has(step.rule)) errors.push(`Step "${step.id}" has unknown rule state "${step.rule}".`);
    if(step.gate && !GATES.has(step.gate)) errors.push(`Step "${step.id}" has unknown gate "${step.gate}".`);
    if(step.budget && !(Number.isInteger(step.budget.used ?? 0) && (step.budget.used ?? 0) >= 0)) errors.push(`Step "${step.id}" has an invalid budget.`);
    step.unlock.forEach(part => {
      if(!CONFIG.parts[part]) errors.push(`Step "${step.id}" unlocks unknown part "${part}".`);
    });
    [step.target, step.targetAlso].filter(Boolean).forEach(target => {
      if(!/^(robot|value):/.test(target) && !CONFIG.targets[target]) errors.push(`Step "${step.id}" targets unknown "${target}".`);
    });
  });
  const sequence = stepsFor(enabled);
  if(!sequence.length) errors.push("No steps are enabled.");
  return errors;
}

// A step runs when its gadget is on, the gadget it "needs" (if any) is on, and
// its "modes" (if any) include the current first-task mode.
function stepsFor(enabled, mode=firstTaskOpens()){
  return CONFIG.steps.filter(step => enabled[step.gadget] && (!step.needs || enabled[step.needs]) &&
    (!step.modes || step.modes.includes(mode)));
}

function showConfigError(errors){
  console.error("[guided tutorial] Not started:\n" + errors.join("\n"));
  const box = $("guided-config-error");
  if(!box) return;
  box.textContent = previewMode()
    ? "Guided tutorial config error: " + errors.join(" ")
    : "The study could not load. Please refresh the page.";
  box.hidden = false;
}

/* ---------- locking ---------- */

// CSS rules per part, keyed on body[data-guide-unlock], survive app.js re-renders.
// Locked parts are never clickable; the grey-out needs body.guided-dim-locked (dimLocked).
function installLockStyles(){
  if($("guided-lock-styles")) return;
  const style = document.createElement("style");
  style.id = "guided-lock-styles";
  const locked = (part, prefix) => CONFIG.parts[part].map(selector =>
    `${prefix}:not([data-guide-unlock~="${part}"]) ${selector}`).join(",\n");
  style.textContent = Object.keys(CONFIG.parts).map(part =>
    `${locked(part, "body.guided-active")}{pointer-events:none;}\n` +
    `${locked(part, "body.guided-active.guided-dim-locked")}{opacity:.22;filter:grayscale(1);}`
  ).join("\n");
  document.head.appendChild(style);
  document.body.classList.toggle("guided-dim-locked", settings().dimLocked);
}

function applyLock(){
  document.body.dataset.guideUnlock = (seq[pos]?.unlock || []).join(" ");
}

/* ---------- choice lock: only the asked-for tab or value responds ---------- */

// The step's own action is the only rule choice that can be clicked. Every
// other tab and value (including already selected ones) ignores clicks and
// keys and records nothing.
// What a gate step asks for: a tab, or a value on a tab.
function gateChoice(step){
  const practice = CONFIG.practice;
  const alternative = CONFIG.alternative;
  switch(step?.gate){
    case "family-move": return {tab:practice.family};
    case "family-type": return {tab:alternative.family};
    case "value": return {family:practice.family, value:practice.value};
    case "type-value": return {family:alternative.family, value:alternative.value};
    default: return null;
  }
}

const hasValue = (state, family, value) => (state.values[family] || []).map(String).includes(String(value));

function allowedChoice(){
  const step = seq[pos];
  if(!active || !step) return {};
  const want = gateChoice(step);
  if(!want) return {};
  const state = host.getRuleState();
  if(want.tab) return state.family !== want.tab ? {tab:want.tab} : {};
  if(state.family === want.family && !hasValue(state, want.family, want.value)) return want;
  return {};
}

function choiceAllowed(control){
  const allowed = allowedChoice();
  if(control.classList.contains("rule-family-tab")) return !!allowed.tab && control.dataset.family === allowed.tab;
  return !!allowed.value && control.dataset.family === allowed.family &&
    String(control.dataset.value) === String(allowed.value);
}

function updateChoiceLock(){
  let style = $("guided-choice-styles");
  if(!style){
    style = document.createElement("style");
    style.id = "guided-choice-styles";
    document.head.appendChild(style);
  }
  const allowed = allowedChoice();
  const tab = allowed.tab ? `:not([data-family="${allowed.tab}"])` : "";
  const value = allowed.value ? `:not([data-family="${allowed.family}"][data-value="${allowed.value}"])` : "";
  style.textContent = `body.guided-active .rule-family-tab${tab},body.guided-active .simple-value-button${value}{pointer-events:none;cursor:default;}`;
}

// Window capture runs before the data collector's document listeners and the buttons' own handlers.
function blockOtherChoices(event){
  if(!active) return;
  const control = event.target.closest?.(".rule-family-tab,.simple-value-button");
  if(!control || choiceAllowed(control)) return;
  event.preventDefault();
  event.stopImmediatePropagation();
}

/* ---------- rule state per step (storyboard setupStep) ---------- */

function stepRuleState(step){
  const practice = CONFIG.practice;
  const alternative = CONFIG.alternative;
  const values = {move_dir:[], role:[]};
  const withPractice = () => { values[practice.family] = [practice.value]; };
  const withAlternative = () => { values[alternative.family] = [alternative.value]; };
  // Type D stays in its tab after the participant selected it (none if the steps were turned off).
  const alternativeChosen = seq.some(item => item.gate === "type-value" && done.has(item.id));
  let family = "role";
  // "final": both tested rules, with the tab T1 opens on.
  const rule = step.rule === "final" ? (firstTaskOpens() === "type" ? "type-D" : "move-both") : step.rule;
  if(rule === "move-tab") family = practice.family;
  if(rule === "move-W"){ family = practice.family; withPractice(); }
  if(rule === "type-tab"){ family = alternative.family; withPractice(); }
  if(rule === "type-D"){ family = alternative.family; withPractice(); withAlternative(); }
  if(rule === "move-both"){ family = practice.family; withPractice(); if(alternativeChosen) withAlternative(); }
  if(done.has(step.id)){
    if(step.gate === "family-move") family = practice.family;
    if(step.gate === "family-type") family = alternative.family;
    if(step.gate === "value") withPractice();
    if(step.gate === "type-value") withAlternative();
  }
  return {family, values};
}

function requirementMet(state, rule){
  const values = state.values[rule.family] || [];
  return state.family === rule.family && values.length === 1 && String(values[0]) === String(rule.value);
}

const practiceRequirementMet = state => requirementMet(state, CONFIG.practice);
const alternativeRequirementMet = state => requirementMet(state, CONFIG.alternative);

function setupStep(){
  const step = seq[pos];
  if(host.sceneId() !== CONFIG.maps[step.map].id) host.showScene(CONFIG.maps[step.map]);
  host.setRuleState(stepRuleState(step));
  host.resetRun();
  const completed = done.has(step.id);
  if(step.shown === "end" || (step.gate && completed && step.gate.startsWith("run"))) host.showRunEnd();
  showBudget();
  applyLock();
}

/* ---------- Runs-left counter (demo only) ---------- */

// Steps with a "budget" field show the task's Runs-left counter in a demo
// state. A "count" step uses one demo Run when the participant presses Run;
// trial counts are never touched.
function budgetUsed(step){
  const budget = step.budget;
  return (budget.used || 0) + (budget.count && done.has(step.id) ? 1 : 0);
}

function showBudget(){
  const step = seq[pos];
  host.showRunBudget?.(step?.budget ? {used:budgetUsed(step), solved:!!step.budget.solved} : null);
}

/* ---------- spotlight and bubble ---------- */

function wrapGeometry(){
  const wrap = document.querySelector(".wrap");
  const box = wrap.getBoundingClientRect();
  const scale = box.width / wrap.offsetWidth || 1;
  return {wrap, box, scale, width:wrap.offsetWidth, height:wrap.offsetHeight};
}

function relative(rect, geometry){
  return {
    x:(rect.left - geometry.box.left) / geometry.scale,
    y:(rect.top - geometry.box.top) / geometry.scale,
    w:rect.width / geometry.scale,
    h:rect.height / geometry.scale,
  };
}

const padded = (rect, pad=SPOT_PAD) => ({x:rect.x - pad, y:rect.y - pad, w:rect.w + pad * 2, h:rect.h + pad * 2});

function robotRect(number, geometry){
  // Use the current frame, not the DOM, so a robot still sliding back is boxed at its start.
  const board = relative($("board").getBoundingClientRect(), geometry);
  const agents = CONFIG.maps[seq[pos].map].world.agents;
  const agent = agents[Number(number) - 1];
  if(!agent) return null;
  const frame = host.currentFrame();
  const cell = frame.pos?.[agent.id] || frame.pos?.[String(agent.id)] || agent.start;
  const size = host.cellSize;
  return padded({x:board.x + cell[1] * size, y:board.y + cell[0] * size, w:size - 4, h:size - 4});
}

function targetRects(){
  const step = seq[pos];
  if(!step.target) return [];
  const geometry = wrapGeometry();
  const element = selector => document.querySelector(CONFIG.targets[selector] || selector);
  const rects = [];
  if(step.area){
    const board = relative($("board").getBoundingClientRect(), geometry);
    const size = host.cellSize;
    const [[r0, c0], [r1, c1]] = step.area;
    rects.push(padded({x:board.x + c0 * size, y:board.y + r0 * size, w:(c1 - c0 + 1) * size - 4, h:(r1 - r0 + 1) * size - 4}));
  }else if(step.target.startsWith("robot:")){
    const rect = robotRect(step.target.slice(6), geometry);
    if(rect) rects.push(rect);
  }else{
    // "value:V" is a value on the practice tab; "value:FAMILY:V" names the tab.
    const [family, value] = step.target.split(":").length === 3
      ? step.target.split(":").slice(1) : [CONFIG.practice.family, step.target.slice(6)];
    const node = step.target.startsWith("value:")
      ? document.querySelector(`.simple-value-button[data-family="${family}"][data-value="${value}"]`)
      : element(step.target);
    if(node) rects.push(padded(relative(node.getBoundingClientRect(), geometry)));
  }
  if(step.targetAlso){
    const node = element(step.targetAlso);
    if(node) rects.push(padded(relative(node.getBoundingClientRect(), geometry)));
  }
  return rects;
}

function drawSpots(rects, geometry){
  // One dark layer with a cut-out per highlighted area, so separate parts can be lit at once.
  const {width, height} = geometry;
  const svg = $("guided-spot");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  const holes = rects.map(q => `<rect x="${q.x}" y="${q.y}" width="${q.w}" height="${q.h}" rx="6" fill="#000"/>`).join("");
  svg.innerHTML = `<defs><mask id="guided-spot-mask"><rect width="${width}" height="${height}" fill="#fff"/>${holes}</mask></defs>` +
    `<rect width="${width}" height="${height}" fill="rgba(14,26,38,.52)" mask="url(#guided-spot-mask)"/>` +
    rects.map(q => `<rect x="${q.x - 2}" y="${q.y - 2}" width="${q.w + 4}" height="${q.h + 4}" rx="8" fill="none" stroke="#ffd257" stroke-width="3"/>`).join("");
}

function placeGuide(){
  if(!active) return;
  const step = seq[pos];
  const bubble = $("guided-bubble");
  const geometry = wrapGeometry();
  const {width, height} = geometry;
  const rects = targetRects();
  drawSpots(rects, geometry);
  const bh = bubble.offsetHeight || 170;
  const bw = BUBBLE_WIDTH;
  if(!rects.length){
    bubble.style.left = `${width / 2 - bw / 2}px`;
    bubble.style.top = `${height / 2 - bh / 2}px`;
    return;
  }
  const x1 = Math.min(...rects.map(q => q.x));
  const y1 = Math.min(...rects.map(q => q.y));
  const x2 = Math.max(...rects.map(q => q.x + q.w));
  const y2 = Math.max(...rects.map(q => q.y + q.h));
  const r = {x:x1, y:y1, w:x2 - x1, h:y2 - y1};
  let x;
  let y;
  if(r.x + r.w + 20 + bw < width - 10){ x = r.x + r.w + 20; y = r.y; }
  else if(r.x - 20 - bw > 10){ x = r.x - 20 - bw; y = r.y; }
  else{
    x = Math.min(width - 10 - bw, Math.max(10, r.x));
    y = r.y + r.h + 16 + bh < height - 10 ? r.y + r.h + 16 : r.y - 16 - bh;
  }
  x += step.bubbleDx || 0;
  y = Math.min(height - 10 - bh, Math.max(10, y));
  bubble.style.left = `${x}px`;
  bubble.style.top = `${y}px`;
}

function schedulePlace(){
  clearTimeout(placeTimer);
  placeTimer = setTimeout(placeGuide, 150);
}

/* ---------- bubble content and navigation ---------- */

function gateMet(){
  const step = seq[pos];
  return !step.gate || done.has(step.id);
}

function render(){
  const step = seq[pos];
  $("guided-message").innerHTML = textOf(step);
  const ok = gateMet();
  const wait = $("guided-wait");
  wait.hidden = ok || !step.wait;
  wait.textContent = step.wait || "";
  const next = $("guided-next");
  next.disabled = !ok;
  next.classList.toggle("pulse", !!step.gate && ok);
  next.textContent = pos === seq.length - 1 ? CONFIG.labels.finish : CONFIG.labels.next;
  const back = $("guided-back");
  back.disabled = pos === 0;
  back.style.visibility = pos === 0 ? "hidden" : "visible";
  $("guided-count").textContent = `${pos + 1} / ${seq.length}`;
  updateChoiceLock();
  placeGuide();
}

function saveCheckpoint(phase="tutorial"){
  data()?.saveCheckpoint(CHECKPOINT, {
    protocol:PROTOCOL, phase, step_id:seq[pos]?.id || null, done:[...done], round,
    celebrated:[...celebrated], started_at:startedAt, last_practice_rule:lastPracticeRule,
    last_alternative_rule:lastAlternativeRule,
  });
}

function go(index, direction){
  if(index < 0 || index >= seq.length) return;
  const now = Date.now();
  const previousId = viewedStepId;
  const previousMs = stepViewedAt ? now - stepViewedAt : null;
  pos = index;
  const step = seq[pos];
  setupStep();
  // Going back shows "Run rule" even where the earlier Run succeeded (decision B3).
  if(direction === "back") host.resetRunButton();
  render();
  requestAnimationFrame(placeGuide);
  let celebrate = false;
  // Each celebrating step fires once per participant, going forward only (decision B4).
  if(step.celebrate && direction === "forward" && !celebrated.has(step.id)){
    celebrated.add(step.id);
    celebrate = true;
    // Over the whole window, as in the task (outside the scaled task surface).
    host.confetti(document.body, window.innerWidth, window.innerHeight);
  }
  stepViewedAt = now;
  viewedStepId = step.id;
  record("tutorial_step_viewed", {
    step_id:step.id, step_number:pos + 1, step_count:seq.length, direction,
    previous_step_id:direction === "resume" ? null : previousId,
    previous_step_ms:direction === "resume" ? null : previousMs,
    gadget:step.gadget, round, celebrated:celebrate || undefined,
  });
  saveCheckpoint();
  $("guided-next").focus({preventScroll:true});
}

function complete(step, gate){
  if(done.has(step.id)) return;
  done.add(step.id);
  record("tutorial_step_completed", {step_id:step.id, gate, step_ms:Date.now() - stepViewedAt, round});
  saveCheckpoint();
}

function next(){
  if(!gateMet()) return;
  if(pos === seq.length - 1){
    finishTutorial();
    return;
  }
  go(pos + 1, "forward");
}

function back(){
  if(pos > 0) go(pos - 1, "back");
}

function onKeydown(event){
  if(!active || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey) return;
  if(event.target.closest?.("input,textarea,select")) return;
  const control = event.target.closest?.(".rule-family-tab,.simple-value-button");
  if(control && !choiceAllowed(control) && ["Home", "End", "Enter", " "].includes(event.key)){
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  if(event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
  // The guide's paging wins over the rule tabs' own arrow-key switching.
  event.preventDefault();
  event.stopPropagation();
  if(event.key === "ArrowLeft") back();
  else next();
}

/* ---------- reactions to the task UI ---------- */

function onRuleEvent(type, detail){
  const step = seq[pos];
  if(!active || !step) return;
  if(type === "rule_family_changed"){
    record("tutorial_rule_family_changed", {
      from_family:detail.from_family, to_family:detail.to_family, trigger:detail.trigger || null,
      step_id:step.id, round,
    });
    const want = gateChoice(step);
    if(want?.tab && detail.to_family === want.tab) complete(step, step.gate);
  }else if(type === "rule_value_added" || type === "rule_value_removed"){
    record("tutorial_rule_value_toggled", {
      family:detail.family, value:detail.value, selected:type === "rule_value_added",
      step_id:step.id, round,
    });
    const state = host.getRuleState();
    const want = gateChoice(step);
    if(want?.value && state.family === want.family && hasValue(state, want.family, want.value)) complete(step, step.gate);
    // As in the formal tasks, a rule edit leaves the board as it is (decision B2).
  }
  render();
  requestAnimationFrame(placeGuide);
}

function onRunComplete(result, feedback, trigger){
  const step = seq[pos];
  if(!active || !step) return;
  const state = host.getRuleState();
  const practiceMet = result.ok && practiceRequirementMet(state);
  const alternativeMet = result.ok && alternativeRequirementMet(state);
  record("tutorial_run", {
    step_id:step.id, scene_id:host.sceneId(), layout_source:CONFIG.maps[step.map].layout_source || null,
    ok:!!result.ok, reason:result.reason || null,
    active_family:state.family, selected_values:state.values,
    practice_requirement_met:practiceMet, alternative_requirement_met:alternativeMet, trigger,
    budget_demo:step.budget ? true : undefined, frame_total:Math.max(0, (result.frames?.length || 1) - 1),
    feedback_title:feedback?.title || null, feedback_observation:feedback?.observation || null, round,
  });
  if(step.gate === "run-any") complete(step, step.gate);
  if(step.budget) showBudget();
  if(step.gate === "run-type-success" && alternativeMet){
    lastAlternativeRule = {family:state.family, values:state.values};
    complete(step, step.gate);
  }
  if(step.gate === "run-success"){
    if(practiceMet){
      lastPracticeRule = {family:state.family, values:state.values};
      complete(step, step.gate);
    }else{
      const status = $("status");
      const retry = document.createElement("span");
      retry.className = "guided-retry";
      retry.textContent = " " + CONFIG.practiceRetryText;
      status.appendChild(retry);
    }
  }
  render();
}

/* ---------- start, finish, resume ---------- */

function showGuide(visible){
  active = visible;
  $("guided-layer").hidden = !visible;
  document.body.classList.toggle("guided-active", visible);
  if(!visible) delete document.body.dataset.guideUnlock;
}

function finishTutorial(){
  const step = seq[pos];
  record("tutorial_completed", {
    step_id:step.id, steps:seq.map(item => item.id), duration_ms:Date.now() - startedAt, round,
    first_task_opens:firstTaskOpens(),
    practice_rule:lastPracticeRule, alternative_rule:lastAlternativeRule, last_step_ms:Date.now() - stepViewedAt,
  });
  // Kept from the v23 stage pages for analysis continuity (decision B9).
  record("tutorial_stage_completed", {round});
  showGuide(false);
  saveCheckpoint("comprehension");
  openComprehension();
}

function openComprehension(){
  showGuide(false);
  host.resetRun();
  window.GuidedComprehension.open({
    protocol:PROTOCOL,
    round,
    onPassed(){
      data()?.saveCheckpoint(CHECKPOINT, {protocol:PROTOCOL, phase:"done", round});
      document.removeEventListener("keydown", onKeydown, true);
      window.removeEventListener("click", blockOtherChoices, true);
      window.removeEventListener("resize", schedulePlace);
      $("guided-choice-styles")?.remove();
      host.showRunBudget?.(null);
      onFinished();
    },
    onFailed(){
      // Back to step 1. Actions already done stay done, so Next skips through.
      // Confetti stays once per participant and step (decision B4).
      round += 1;
      data()?.setStage("tutorial");
      showGuide(true);
      stepViewedAt = 0;
      viewedStepId = null;
      pos = 0;
      go(0, "restart");
    },
  });
}

function phase(){
  const events = data()?.snapshot().events || [];
  if(events.some(event => event.event_type === "comprehension_passed")) return "task";
  const saved = data()?.checkpoint(CHECKPOINT);
  if(saved?.protocol === PROTOCOL && (saved.phase === "tutorial" || saved.phase === "comprehension")) return saved.phase;
  const completed = events.some(event => event.event_type === "tutorial_completed" &&
    event.detail?.tutorial_protocol === PROTOCOL);
  return completed ? "comprehension" : "tutorial";
}

function start(options){
  host = options.host;
  onFinished = options.onFinished || (() => {});
  const enabled = enabledGadgets();
  const errors = validate(enabled);
  installLockStyles();
  if(errors.length){
    showConfigError(errors);
    data()?.record("tutorial_config_invalid", {tutorial_protocol:PROTOCOL, errors});
    document.body.classList.add("guided-active");
    return false;
  }
  seq = stepsFor(enabled);
  data()?.setStage(options.phase === "comprehension" ? "comprehension" : "tutorial");
  data()?.setContext({task_id:null, task_item_id:null, attempt_index:null, rulebook_revision:null});
  host.onRuleChange(onRuleEvent);
  host.onRunComplete(onRunComplete);
  $("guided-back").onclick = back;
  $("guided-next").onclick = next;
  document.addEventListener("keydown", onKeydown, true);
  window.addEventListener("click", blockOtherChoices, true);
  window.addEventListener("resize", schedulePlace);

  const saved = data()?.checkpoint(CHECKPOINT);
  const resume = saved?.protocol === PROTOCOL ? saved : null;
  if(resume){
    done = new Set(resume.done || []);
    round = resume.round || 1;
    celebrated = new Set(Array.isArray(resume.celebrated) ? resume.celebrated : []);
    startedAt = resume.started_at || Date.now();
    lastPracticeRule = resume.last_practice_rule || null;
    lastAlternativeRule = resume.last_alternative_rule || null;
  }else{
    startedAt = Date.now();
    record("tutorial_started", {
      gadgets_enabled:Object.keys(enabled).filter(id => enabled[id]),
      gadgets_disabled:Object.keys(enabled).filter(id => !enabled[id]),
      steps:seq.map(step => step.id), step_count:seq.length,
      practice:{...CONFIG.practice}, alternative:{...CONFIG.alternative},
      first_task_opens:firstTaskOpens(), carry_into_first_task:settings().carryIntoFirstTask,
      dim_locked:settings().dimLocked,
    });
  }
  if(options.phase === "comprehension"){
    pos = Math.max(0, seq.length - 1);
    host.showScene(CONFIG.maps[seq[pos].map]);
    host.setRuleState(stepRuleState(seq[pos]));
    showGuide(false);
    openComprehension();
    return true;
  }
  showGuide(true);
  const index = resume ? seq.findIndex(step => step.id === resume.step_id) : 0;
  pos = Math.max(0, index);
  go(pos, resume ? "resume" : "forward");
  return true;
}

window.GuidedTutorial = {phase, start, validate, enabledGadgets, settings, stepsFor};
})();
