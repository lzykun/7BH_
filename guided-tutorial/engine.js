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
const GATES = new Set(["run-any", "run-success", "family-move", "value"]);
const RULE_STATES = new Set(["none", "move-tab", "move-N"]);

const $ = id => document.getElementById(id);
const data = () => window.StudyData;

let host = null;
let onFinished = () => {};
let seq = [];
let pos = 0;
let done = new Set();
let round = 1;
let celebrated = false;
let startedAt = 0;
let stepViewedAt = 0;
let viewedStepId = null;
let lastPracticeRule = null;
let active = false;
let placeTimer = null;

function record(type, detail={}){
  return data()?.record(type, {tutorial_protocol:PROTOCOL, ...detail});
}

function previewMode(){
  return (data()?.params || new URLSearchParams(location.search)).get("preview") === "1";
}

// &guide_off=a,b turns gadgets off, in preview only.
function enabledGadgets(){
  const enabled = Object.fromEntries(Object.keys(CONFIG.gadgets).map(id => [id, true]));
  const off = previewMode()
    ? (new URLSearchParams(location.search).get("guide_off") || data()?.params.get("guide_off") || "")
    : "";
  off.split(",").map(id => id.trim()).filter(Boolean).forEach(id => { enabled[id] = false; });
  return enabled;
}

function validate(enabled){
  const errors = [];
  const stepIds = new Set(CONFIG.steps.map(step => step.id));
  if(enabled.core === false) errors.push('The "core" gadget cannot be turned off.');
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
    if(!CONFIG.maps[step.map]) errors.push(`Step "${step.id}" uses unknown map "${step.map}".`);
    if(!RULE_STATES.has(step.rule)) errors.push(`Step "${step.id}" has unknown rule state "${step.rule}".`);
    if(step.gate && !GATES.has(step.gate)) errors.push(`Step "${step.id}" has unknown gate "${step.gate}".`);
    step.unlock.forEach(part => {
      if(!CONFIG.parts[part]) errors.push(`Step "${step.id}" unlocks unknown part "${part}".`);
    });
    [step.target, step.targetAlso].filter(Boolean).forEach(target => {
      if(!/^(robot|value):/.test(target) && !CONFIG.targets[target]) errors.push(`Step "${step.id}" targets unknown "${target}".`);
    });
  });
  const sequence = CONFIG.steps.filter(step => enabled[step.gadget]);
  if(!sequence.length) errors.push("No steps are enabled.");
  return errors;
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

// One CSS rule per part, keyed on body[data-guide-unlock], survives app.js re-renders.
function installLockStyles(){
  if($("guided-lock-styles")) return;
  const style = document.createElement("style");
  style.id = "guided-lock-styles";
  style.textContent = Object.entries(CONFIG.parts).map(([part, selectors]) =>
    selectors.map(selector =>
      `body.guided-active:not([data-guide-unlock~="${part}"]) ${selector}`).join(",\n") +
    "{opacity:.22;filter:grayscale(1);pointer-events:none;}"
  ).join("\n");
  document.head.appendChild(style);
}

function applyLock(){
  document.body.dataset.guideUnlock = (seq[pos]?.unlock || []).join(" ");
}

/* ---------- choice lock: only the asked-for tab or value responds ---------- */

// The step's own action is the only rule choice that can be clicked. Every
// other tab and value (including already selected ones) ignores clicks and
// keys and records nothing.
function allowedChoice(){
  const step = seq[pos];
  const practice = CONFIG.practice;
  if(!active || !step) return {};
  const state = host.getRuleState();
  if(step.gate === "family-move" && state.family !== practice.family) return {tab:practice.family};
  if(step.gate === "value" && state.family === practice.family &&
    !(state.values[practice.family] || []).map(String).includes(String(practice.value))) return {value:practice.value};
  return {};
}

function choiceAllowed(control){
  const allowed = allowedChoice();
  if(control.classList.contains("rule-family-tab")) return !!allowed.tab && control.dataset.family === allowed.tab;
  return !!allowed.value && control.dataset.family === CONFIG.practice.family &&
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
  const value = allowed.value ? `:not([data-family="${CONFIG.practice.family}"][data-value="${allowed.value}"])` : "";
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
  const state = {family:step.rule === "none" ? "role" : practice.family, values:{move_dir:[], role:[]}};
  if(step.rule === "move-N") state.values[practice.family] = [practice.value];
  if(step.gate === "family-move" && done.has(step.id)) state.family = practice.family;
  if(step.gate === "value" && done.has(step.id)) state.values[practice.family] = [practice.value];
  return state;
}

function practiceRequirementMet(state){
  const practice = CONFIG.practice;
  const values = state.values[practice.family] || [];
  return state.family === practice.family && values.length === 1 && String(values[0]) === String(practice.value);
}

function setupStep(){
  const step = seq[pos];
  if(host.sceneId() !== CONFIG.maps[step.map].id) host.showScene(CONFIG.maps[step.map]);
  host.setRuleState(stepRuleState(step));
  host.resetRun();
  const completed = done.has(step.id);
  if(step.shown === "end" || (step.gate && completed && step.gate.startsWith("run"))) host.showRunEnd();
  applyLock();
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
    const node = step.target.startsWith("value:")
      ? document.querySelector(`.simple-value-button[data-family="${CONFIG.practice.family}"][data-value="${step.target.slice(6)}"]`)
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
  $("guided-message").innerHTML = step.text;
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
    celebrated, started_at:startedAt, last_practice_rule:lastPracticeRule,
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
  if(step.celebrate && direction === "forward" && !celebrated){
    celebrated = true;
    celebrate = true;
    const {wrap, width, height} = wrapGeometry();
    host.confetti($("guided-layer") || wrap, width, height);
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
    if(step.gate === "family-move" && detail.to_family === CONFIG.practice.family) complete(step, step.gate);
  }else if(type === "rule_value_added" || type === "rule_value_removed"){
    record("tutorial_rule_value_toggled", {
      family:detail.family, value:detail.value, selected:type === "rule_value_added",
      step_id:step.id, round,
    });
    const state = host.getRuleState();
    if(step.gate === "value" && state.family === CONFIG.practice.family &&
      (state.values[CONFIG.practice.family] || []).map(String).includes(String(CONFIG.practice.value))) complete(step, step.gate);
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
  record("tutorial_run", {
    step_id:step.id, scene_id:host.sceneId(), layout_source:CONFIG.maps[step.map].layout_source || null,
    ok:!!result.ok, reason:result.reason || null,
    active_family:state.family, selected_values:state.values,
    practice_requirement_met:practiceMet, trigger, frame_total:Math.max(0, (result.frames?.length || 1) - 1),
    feedback_title:feedback?.title || null, feedback_observation:feedback?.observation || null, round,
  });
  if(step.gate === "run-any") complete(step, step.gate);
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
    practice_rule:lastPracticeRule, last_step_ms:Date.now() - stepViewedAt,
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
      onFinished();
    },
    onFailed(){
      // Back to step 1. Actions already done stay done, so Next skips through.
      // Confetti stays once per participant (decision B4).
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
  seq = CONFIG.steps.filter(step => enabled[step.gadget]);
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
    celebrated = !!resume.celebrated;
    startedAt = resume.started_at || Date.now();
    lastPracticeRule = resume.last_practice_rule || null;
  }else{
    startedAt = Date.now();
    record("tutorial_started", {
      gadgets_enabled:Object.keys(enabled).filter(id => enabled[id]),
      gadgets_disabled:Object.keys(enabled).filter(id => !enabled[id]),
      steps:seq.map(step => step.id), step_count:seq.length,
      practice:{...CONFIG.practice}, carry_into_first_task:{...CONFIG.carryIntoFirstTask},
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

window.GuidedTutorial = {phase, start, validate, enabledGadgets};
})();
