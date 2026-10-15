/* UI layer over solver-generated tasks: tabs, board animation, rule builder, logs. */

const TASK_LOGICAL_WIDTH = 1280;
const TASK_LOGICAL_HEIGHT = 880;
const TASK_CELL_SIZE = 32;
const TASK_FEATURE_BADGE_SIZE = 15;
const TASK_MIN_SCALE = 0.68;
let CELL = TASK_CELL_SIZE;
let viewportResizeTimer = null;
let curIndex = window.SHUFFLE_PREVIEW.startIndex;
let scn = TASKS[curIndex];
let rules = [];
let activeRuleFamily = "role";
let familyRuleDrafts = {move_dir:[], role:[]};
const sceneRuleDrafts = new Map();
let library = [];
let robotEls = {};
let machineEls = {};
let timer = null;
let taskSuccessTimer = null;
let successConfettiLayer = null;
let successConfettiTimer = null;
let completionDialogOpen = false;
let runs = [];
let lastResult = null;
let lastFrames = [];
let frameIndex = 0;
let experimentStartedAt = Date.now();
let trialStartedAt = experimentStartedAt;
let lastAttemptAt = experimentStartedAt;
let ruleEvents = [];
let lastRuleEventIndex = 0;
let nextRuleId = 1;
let rulebookRevision = 0;
let taskReady = false;
let trialStartRule = null;
let activeRunId = null;
const sceneGuidesSeen = new Set();
// "tutorial" while the guided tutorial borrows this board and rule panel. In
// that mode nothing here writes trial data; the guide records its own events.
let taskMode = "task";
let tutorialRuleListener = null;

const $ = id => document.getElementById(id);
const URL_PARAMS = window.StudyData?.params || new URLSearchParams(window.location.search);
const PARTICIPANT_CODE = window.StudyData?.participantCode || null;
const CONTINUATION_CONDITION = "local";
const RUN_COMPLETION_PROTOCOL = "full-map-single-run-v1";
const RULE_EDITOR_PROTOCOL = window.STUDY_CONFIG.rule_editor_protocol;
if(URL_PARAMS.get("continuation") !== CONTINUATION_CONDITION){
  URL_PARAMS.set("continuation", CONTINUATION_CONDITION);
  window.StudyData?.syncParams?.(URL_PARAMS);
}
const PREVIEW_MODE = URL_PARAMS.get("preview") === "1";
const DEBUG_UI = URL_PARAMS.get("debug") === "1" ||
  window.location.hash.includes("debug");
const ONBOARDING_STAGE = (URL_PARAMS.get("stage") || "").toLowerCase();
const SKIP_TUTORIAL = URL_PARAMS.get("skipTutorial") === "1" || ONBOARDING_STAGE === "task";
// Researchers can open T1 directly with ?preview=1&skipTutorial=1.
const SKIP_GUIDED_TUTORIAL = window.SHUFFLE_PREVIEW.inspect || (PREVIEW_MODE && SKIP_TUTORIAL);
// The experimental task is sequential by default. Designers can inspect every
// scene with ?order=free or ?skipTutorial=1 without changing the participant flow.
const ORDER_MODE = DEBUG_UI
  ? "free"
  : (URL_PARAMS.get("order") || (SKIP_TUTORIAL ? "free" : "curriculum"));
const ALWAYS_UNLOCK = URL_PARAMS.get("access") === "always";
const FREE_ORDER = ALWAYS_UNLOCK || ORDER_MODE === "free";
const EDITOR_CONDITION = RAW_LIBRARY.condition === "fresh" ? "fresh" : "carry";
let activeTaskBranch = "movement";

const TEST_JUMP_TIMINGS = [
  {id:"all-local", label:"All-local"},
  {id:"early", label:"Early jump"},
  {id:"late", label:"Late jump"},
];
const TEST_CONTINUATIONS = [
  {id:"local", label:"Local continuation"},
];

function installTestConditionMatrix(){}

// Shared-pool test controls are installed after task initialization.

function activateTaskBranch(branch){
  const rawTasks = RAW_LIBRARY.branch_tasks?.[branch];
  if(!Array.isArray(rawTasks) || !rawTasks.length) return false;
  const normalized = rawTasks.map(normalizeTask);
  TASKS.splice(0, TASKS.length, ...normalized);
  scn = TASKS[curIndex] || TASKS[0];
  activeTaskBranch = branch;
  return true;
}

const requestedBranch = URL_PARAMS.get("branch");
if(PREVIEW_MODE && (requestedBranch === "movement" || requestedBranch === "role")){
  activateTaskBranch(requestedBranch);
}

const shiftStates = Object.fromEntries(TASKS.map(task => [
  task.id,
  { visited:false, lastOk:null, testedRevision:null, attempts:0 },
]));

function taskUnlocked(task){
  if(FREE_ORDER) return true;
  const index = TASKS.indexOf(task);
  if(index <= 0) return true;
  return shiftStates[TASKS[index - 1].id].lastOk === true;
}

function unlockedTasks(){
  return TASKS.filter(taskUnlocked);
}

const EXPORTED_RULE_SCHEMA = RAW_LIBRARY.rule_schema || { fields:[], max_conditions:3 };
const MAX_RULE_CONDITIONS = EXPORTED_RULE_SCHEMA.max_conditions || 3;
const OBJECT_IDS = {
  "Target square":"target",
  "Square being entered":"target",
  "Next square":"target",
  "Traffic":"traffic",
  "Target station":"station",
  "Robot":"robot",
  "Robot type":"robot",
  "Robot role":"robot",
  "Movement":"movement",
};
const VISIBLE_RULE_FIELDS = (EXPORTED_RULE_SCHEMA.fields || []).filter(
  field => !CLEAN_RULE_LANGUAGE || field.predicate !== "contested"
);
const RULE_SCHEMA = Object.values(VISIBLE_RULE_FIELDS.reduce((groups, field) => {
  const objectId = OBJECT_IDS[field.object] || field.object.toLowerCase().replaceAll(" ", "-");
  if(!groups[objectId]){
    groups[objectId] = { id:objectId, label:field.object, properties:[] };
  }
  groups[objectId].properties.push({
    id:field.id,
    label:field.id,
    predicate:field.predicate,
    values:field.values,
  });
  return groups;
}, {}));

const MUTATING_RULE_EVENTS = new Set([
  "rule_added",
  "condition_edited",
  "condition_added",
  "condition_removed",
  "rule_removed",
  "library_rule_used",
  "rule_family_changed",
  "rule_value_added",
  "rule_value_removed",
  "practice_rule_carried_over",
]);

function recordRuleEvent(type, detail={}){
  if(taskMode === "tutorial"){
    tutorialRuleListener?.(type, {...detail, active_rule_family:activeRuleFamily});
    return;
  }
  const mutatesRule = MUTATING_RULE_EVENTS.has(type);
  if(mutatesRule){
    rulebookRevision += 1;
    if(scn?.id && shiftStates[scn.id]){
      shiftStates[scn.id].lastOk = null;
      shiftStates[scn.id].testedRevision = null;
    }
  }
  const event = {
    type,
    participant_code:PARTICIPANT_CODE,
    schedule:RAW_LIBRARY.schedule || null,
    editor_condition:EDITOR_CONDITION,
    continuation_condition:CONTINUATION_CONDITION,
    completion_protocol:RUN_COMPLETION_PROTOCOL,
    rule_editor_protocol:RULE_EDITOR_PROTOCOL,
    active_rule_family:activeRuleFamily,
    curriculum_branch:activeTaskBranch,
    shift_id:scn?.id || null,
    task_item_id:scn?.itemId || null,
    rulebook_revision:rulebookRevision,
    time_from_experiment_start_ms:Date.now() - experimentStartedAt,
    time_from_trial_start_ms:Date.now() - trialStartedAt,
    timestamp:new Date().toISOString(),
    ...detail,
    rule_json_after_event:mutatesRule ? ruleJson() : undefined,
  };
  ruleEvents.push(event);
  window.StudyData?.setContext({
    trial_index:curIndex + 1,
    task_id:scn?.id || null,
    task_item_id:scn?.itemId || null,
    attempt_index:shiftStates?.[scn?.id]?.attempts ?? null,
    rulebook_revision:rulebookRevision,
  });
  window.StudyData?.record(type, event);
  persistTaskProgress();
}

function ruleMetricsState(){
  const state = simpleRuleState();
  return {movement_mask:state.movementMask, role_mask:state.roleMask,
    representation:state.representation, selected_value_count:state.valueCount,
    active_rule_family:activeRuleFamily};
}

function persistTaskProgress(){
  if(!taskReady || taskMode !== "task") return;
  window.StudyData?.saveCheckpoint("task", {
    version:window.SHARED_POOL.version, schedule:RAW_LIBRARY.schedule, branch:activeTaskBranch,
    completion_protocol:RUN_COMPLETION_PROTOCOL,
    rule_editor_protocol:RULE_EDITOR_PROTOCOL,
    active_rule_family:activeRuleFamily,
    family_rule_drafts:currentFamilyDrafts(),
    material_order:TASKS.map(task => task.itemId), current_index:curIndex,
    rules, library, next_rule_id:nextRuleId, revision:rulebookRevision,
    shift_states:shiftStates,
    experiment_started_at:experimentStartedAt, trial_started_at:trialStartedAt,
    last_attempt_at:lastAttemptAt, trial_start_rule:trialStartRule,
    display_frame_index:frameIndex, active_run_id:activeRunId, last_rule_event_index:lastRuleEventIndex,
  });
}

function restoreTaskProgress(){
  const saved = window.StudyData?.checkpoint("task");
  if(!saved || saved.version !== window.SHARED_POOL.version || saved.schedule !== RAW_LIBRARY.schedule ||
    saved.completion_protocol !== RUN_COMPLETION_PROTOCOL ||
    saved.rule_editor_protocol !== RULE_EDITOR_PROTOCOL ||
    !isPureFamilyRulebook(saved.rules, saved.active_rule_family) ||
    !["move_dir", "role"].every(family => isPureFamilyRulebook(saved.family_rule_drafts?.[family], family)) ||
    saved.branch !== activeTaskBranch || JSON.stringify(saved.material_order) !== JSON.stringify(TASKS.map(task => task.itemId)) ||
    !Number.isInteger(saved.current_index) || !TASKS[saved.current_index]) return false;
  curIndex = saved.current_index;
  scn = TASKS[curIndex];
  rules = saved.rules || [];
  activeRuleFamily = saved.active_rule_family;
  familyRuleDrafts = structuredClone(saved.family_rule_drafts);
  library = saved.library || [];
  nextRuleId = saved.next_rule_id;
  rulebookRevision = saved.revision;
  for(const task of TASKS) Object.assign(shiftStates[task.id], saved.shift_states?.[task.id] || {});
  experimentStartedAt = saved.experiment_started_at;
  trialStartedAt = saved.trial_started_at;
  lastAttemptAt = saved.last_attempt_at;
  trialStartRule = saved.trial_start_rule;
  const events = window.StudyData.snapshot().events.filter(event =>
    event.completion_protocol === RUN_COMPLETION_PROTOCOL && event.rule_editor_protocol === RULE_EDITOR_PROTOCOL);
  runs = events.filter(event => event.stage === "task" && event.event_type === "run_completed").map(event => event.detail);
  ruleEvents = events.filter(event => event.stage === "task" && event.detail?.type === event.event_type).map(event => event.detail);
  lastRuleEventIndex = Math.min(saved.last_rule_event_index || 0, ruleEvents.length);
  const last = runs.at(-1);
  if(last?.shift_id === scn.id){
    if(last.rulebook_revision === rulebookRevision){
      lastResult = {...last, completedAgentIds:last.completed_agent_ids_after,
        newlyCompletedIds:last.newly_completed_agent_ids, failedEncounterIds:last.failed_encounter_ids};
    }
    lastFrames = last.frames || [];
    frameIndex = Math.min(saved.display_frame_index || 0, Math.max(0,lastFrames.length-1));
  }
  window.StudyData?.setContext({trial_index:curIndex+1, task_id:scn.id, task_item_id:scn.itemId,
    attempt_index:shiftStates[scn.id].attempts, rulebook_revision:rulebookRevision});
  if(saved.active_run_id) window.StudyData.record("run_animation_interrupted", {
    run_id:saved.active_run_id, frame_index:saved.display_frame_index, reason:"page-reload",
  });
  return true;
}

function recordTaskEntry(source){
  const material = RAW_LIBRARY.tasks[curIndex];
  window.StudyData?.record("task_entered", {source, inherited_rule:trialStartRule, current_rule:ruleMetricsState(),
    active_robot_count:scn.agents.filter(agent => agent.active).length,
    completion_protocol:RUN_COMPLETION_PROTOCOL, completed_agent_ids:[]});
  if(!window.StudyData?.snapshot().events.some(event => event.event_type === "task_material_snapshot" && event.task_item_id === scn.itemId)){
    window.StudyData?.record("task_material_snapshot", {world:material.world, agents:material.agents,
      encounters:material.encounters || material.encounter_modules || []});
  }
}

function stopTaskAnimation(reason){
  closeTaskSuccessDialog();
  if(!timer) return;
  clearInterval(timer);
  timer = null;
  if(taskMode === "task") window.StudyData?.record("run_animation_interrupted", {run_id:activeRunId,
    frame_index:frameIndex, frame_total:lastFrames.length-1, reason});
  activeRunId = null;
}

function icon(name, extraClass=""){
  const cls = `ui-icon ${extraClass}`.trim();
  const base = `class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"`;
  const stroke = 'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" stroke-linejoin="miter"';
  const fill = 'fill="currentColor"';
  if(name === "robot") return `<svg ${base}><path ${fill} d="M8 3h8v2h2v7H6V5h2V3ZM5 12h14v9H5v-9Z"/><circle cx="10" cy="8" r="1" fill="#202020"/><circle cx="14" cy="8" r="1" fill="#202020"/><path d="M9 16h6M9 18h6" stroke="#fff" stroke-width="1.4"/></svg>`;
  if(name === "carrier") return `<svg ${base}><path ${fill} d="M7 2h10v2h2v7H5V4h2V2ZM3 12h18v4h-2v6H5v-6H3v-4Z"/><circle cx="9" cy="7" r="1.2" fill="#202020"/><circle cx="15" cy="7" r="1.2" fill="#202020"/><path d="M8 14h8v7H8v-7Zm4 0v7M8 17h8" fill="#fff" stroke="#202020" stroke-width="1.3"/></svg>`;
  if(name === "cleaner") return `<svg ${base}><path ${fill} d="M8 3h8v2h2v7H6V5h2V3ZM5 12h14v9H5v-9Z"/><circle cx="10" cy="8" r="1" fill="#202020"/><circle cx="14" cy="8" r="1" fill="#202020"/><path d="m14 14 7 7M12.5 15.5l1.5 1.5M17 17l2 2M19 15l2 2" stroke="#202020" stroke-width="1.6" fill="none" stroke-linecap="square"/></svg>`;
  if(name === "operator") return `<svg ${base}><circle ${fill} cx="12" cy="2.5" r="1.5"/><path d="M12 4v2" stroke="currentColor" stroke-width="2"/><path ${fill} d="M4 6h16v9H4V6Zm3 10h10v6H7v-6Z"/><circle cx="9" cy="10" r="1.25" fill="#202020"/><circle cx="15" cy="10" r="1.25" fill="#202020"/><path d="M9 18h2M13 18h2M9 20h6" stroke="#202020" stroke-width="1.3" fill="none"/></svg>`;
  if(name === "spill") return `<svg ${base}><path ${fill} d="M12 2c3 4 6 7 6 11a6 6 0 1 1-12 0c0-4 3-7 6-11Z"/><path d="M12 9v4M12 16h.01" stroke="#fff" stroke-width="2.5" stroke-linecap="square"/></svg>`;
  if(name === "cold") return `<svg ${base}><path ${stroke} d="M12 3v18M4.2 7.5l15.6 9M19.8 7.5l-15.6 9M8 4.5l4 3 4-3M8 19.5l4-3 4 3"/></svg>`;
  if(name === "intersection") return `<svg ${base}><path ${fill} d="M9 2h6v7h7v6h-7v7H9v-7H2V9h7V2Z"/></svg>`;
  if(name === "passage") return `<svg ${base}><path ${stroke} d="M5 3v18M19 3v18M8 7h8M8 12h8M8 17h8"/></svg>`;
  if(name === "exit") return `<svg ${base}><path ${stroke} d="M13 4.5 21 3v18l-8-1.5V4.5ZM13 19.5H5V5h8M17 12h.01"/></svg>`;
  if(name === "machine") return icon("exit", extraClass);
  if(name === "wall") return `<svg ${base}><path ${fill} d="M3 4h7v5H3V4Zm9 0h9v5h-9V4ZM3 11h4v5H3v-5Zm6 0h8v5H9v-5Zm10 0h2v5h-2v-5ZM3 18h9v3H3v-3Zm11 0h7v3h-7v-3Z"/></svg>`;
  if(name === "floor") return `<svg ${base}><rect ${stroke} x="4" y="4" width="16" height="16" stroke-width="1.5"/></svg>`;
  if(name === "reach") return `<svg ${base}><path ${fill} d="M10 2h4v7h7v4h-7v7h-4v-7H3V9h7V2Z"/></svg>`;
  if(name === "operate") return icon("machine", extraClass);
  if(name === "deliver") return icon("carrier", extraClass);
  if(name === "done") return `<svg ${base}><circle ${fill} cx="12" cy="12" r="10"/><path d="m7 12 3.2 3.2L17.5 8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="square"/></svg>`;
  if(name === "failed") return `<svg ${base}><circle ${fill} cx="12" cy="12" r="10"/><path d="m8 8 8 8M16 8l-8 8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="square"/></svg>`;
  if(name === "waiting") return `<svg ${base}><circle ${fill} cx="12" cy="12" r="10"/><path d="M9 7v10M15 7v10" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="square"/></svg>`;
  if(name === "run") return `<svg ${base}><circle ${fill} cx="12" cy="12" r="10"/><path d="m10 7 7 5-7 5V7Z" fill="#fff"/></svg>`;
  if(name === "idle") return `<svg ${base}><circle ${stroke} cx="12" cy="12" r="9"/></svg>`;
  if(name === "target") return icon("reach", extraClass);
  if(name === "charging") return `<svg ${base}><path ${stroke} d="M7 4h10v3h2v14H5V7h2V4Zm2 3h6V5H9v2Z"/><path ${fill} d="m13 9-4 6h3l-1 5 4-7h-3l1-4Z"/></svg>`;
  return `<svg ${base}><circle ${stroke} cx="12" cy="12" r="8"/></svg>`;
}

function roleIconName(role){
  if(SIMPLE_FAMILY_RULE_LANGUAGE) return "robot";
  if(role === "carrier") return "carrier";
  if(role === "operator") return "operator";
  if(role === "cleaner") return "cleaner";
  return "robot";
}

function agentDisplayId(id){
  const value = Number(id);
  if(!Number.isInteger(value) || value < 0) return String(id);
  let label = "";
  let index = value;
  do{
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26) - 1;
  }while(index >= 0);
  return label;
}

function agentTargetNumber(agent, task=scn){
  const activeAgents = task?.agents?.filter(candidate => candidate.active) || [];
  const index = activeAgents.findIndex(candidate => String(candidate.id) === String(agent.id));
  return index >= 0 ? String(index + 1) : String(Number(agent.id) + 1);
}

function carryIcon(agent){
  return agent.carrying === "spill" ? icon("spill", "carry-icon") : "";
}

function goalIconName(agent){
  if(agent.goal.kind === "operate") return "operate";
  if(agent.goal.kind === "deliver") return "deliver";
  return "reach";
}

function stateIconName(meta){
  if(!meta) return "idle";
  if(meta.offDuty) return "idle";
  if(meta.failed) return "failed";
  if(meta.done) return "done";
  if(meta.waiting) return "waiting";
  if(meta.step_count === null || meta.step_count === undefined) return "idle";
  return "run";
}

const ROLE_SHORT_ZH = {
  carrier:"A",
  operator:"B",
  inspector:"C",
  loader:"D",
  technician:"E",
  courier:"F",
  scout:"G",
  guard:"H",
  cleaner:"Cl",
};
const MOVEMENT_ARROWS = {
  N:"\u2191", NE:"\u2197", E:"\u2192", SE:"\u2198",
  S:"\u2193", SW:"\u2199", W:"\u2190", NW:"\u2196",
};
const PROPERTY_LABELS = {
  target_type:"type",
  contested:"state",
  station_marker:"marker",
  role:"type",
  carrying:"carrying",
  move_dir:"direction",
};

const SIMPLE_ROBOT_COLOR = "#2D70B3";
const ROBOT_IDENTITY_COLORS = (
  "#2563B8,#C04B23,#167A62,#7653B5,#B52A55,#8A6718,#16728A,#8C3F70"
).split(",");

function agentColor(agent){
  if(!SIMPLE_FAMILY_RULE_LANGUAGE) return roleColor(agent.role);
  const activeAgents = scn?.agents?.filter(candidate => candidate.active) || [];
  const agentIndex = activeAgents.findIndex(candidate => String(candidate.id) === String(agent.id));
  if(agentIndex < 0) return SIMPLE_ROBOT_COLOR;
  return ROBOT_IDENTITY_COLORS[agentIndex % ROBOT_IDENTITY_COLORS.length];
}

const ROLE_COLORS = {
  carrier: "#D85C2F",
  operator: "#347FC4",
  inspector: "#7B61A8",
  loader: "#2D8B73",
  technician: "#B06C2D",
  courier: "#4F6F8F",
  scout: "#8A6D3B",
  guard: "#7A4B57",
  cleaner: "#17966F",
};

function roleColor(role){
  return ROLE_COLORS[role] || COL[5];
}

function robotTypeLetter(role){
  return ROLE_SHORT_ZH[role] || "?";
}

function robotTypeMark(role, extraClass=""){
  return `<span class="robot-type-letter ${extraClass}" aria-hidden="true">${robotTypeLetter(role)}</span>`;
}

function roleLegendAvatar(role, extraClass=""){
  const mark = SIMPLE_FAMILY_RULE_LANGUAGE
    ? `${icon("robot", "agent-avatar-icon")}${robotTypeMark(role, "agent-type-letter")}`
    : icon(roleIconName(role), "agent-avatar-icon");
  const color = SIMPLE_FAMILY_RULE_LANGUAGE ? SIMPLE_ROBOT_COLOR : roleColor(role);
  return `<span class="agent-avatar role-key-avatar ${extraClass}" style="--agent-color:${color}">${mark}</span>`;
}

function passageMapSample(extraClass=""){
  return `<span class="passage-map-sample ${extraClass}" aria-hidden="true"></span>`;
}

function roleBadge(agent, className=""){
  return `<span class="role-badge role-${agent.role} ${className}">${ROLE_SHORT_ZH[agent.role] || "R"}</span>`;
}

function spillBadge(agent, className=""){
  if(agent.carrying === "none") return "";
  return `<span class="spill-badge ${className}" title="Carrying spill">spill</span>`;
}

function zoneMarkup(zone){
  if(zone === "cold") return icon("cold", "board-zone-icon");
  return "";
}

function targetMarkup(agent, targetIndex=0, onMachine=false){
  if(SIMPLE_FAMILY_RULE_LANGUAGE){
    const corner = targetIndex % 4;
    return `<span class="target-label target-label-corner-${corner}${onMachine ? ` target-label-on-machine target-label-machine-${corner}` : ""}">${agentTargetNumber(agent)}</span>`;
  }
  const corner = targetIndex % 4;
  return `<span class="target-label target-label-corner-${corner}${onMachine ? ` target-label-on-machine target-label-machine-${corner}` : ""}">${agentDisplayId(agent.id)}</span>`;
}

function agentAvatar(agent, extraClass=""){
  const mark = SIMPLE_FAMILY_RULE_LANGUAGE
    ? `${icon("robot", "agent-avatar-icon")}${robotTypeMark(agent.role, "agent-type-letter")}`
    : icon(roleIconName(agent.role), "agent-avatar-icon");
  const identity = SIMPLE_FAMILY_RULE_LANGUAGE
    ? ""
    : `<span class="agent-avatar-id">${agentDisplayId(agent.id)}</span>`;
  return `<span class="agent-avatar ${extraClass}" style="--agent-color:${agentColor(agent)}">${mark}${identity}</span>`;
}

function spillIconBadge(agent, className=""){
  if(agent.carrying !== "spill") return "";
  return `<span class="spill-icon-badge ${className}" title="Carrying spill">${icon("spill", "spill-icon")}</span>`;
}

function displayedMovement(agent, meta=null){
  if(meta?.done) return null;
  return meta?.display_dir || meta?.intent?.dir || agent.movementArrow || null;
}

function robotMarkup(agent, meta){
  const movement = displayedMovement(agent, meta);
  const identity = SIMPLE_FAMILY_RULE_LANGUAGE
    ? `${icon("robot", "robot-role")}${robotTypeMark(agent.role, "robot-type-mark")}`
    : icon(roleIconName(agent.role), "robot-role");
  return [
    identity,
    `<span class="robot-id">${SIMPLE_FAMILY_RULE_LANGUAGE ? agentTargetNumber(agent) : agentDisplayId(agent.id)}</span>`,
    SIMPLE_FAMILY_RULE_LANGUAGE && movement
      ? `<span class="movement-arrow-badge" title="Movement direction ${MOVEMENT_ARROWS[movement] || movement}">${MOVEMENT_ARROWS[movement] || movement}</span>`
      : "",
    carryIcon(agent),
    meta?.done ? icon("done", "robot-state-mark")
      : meta?.failed ? icon("failed", "robot-state-mark")
      : meta?.waiting ? icon("waiting", "robot-state-mark wait") : "",
  ].join("");
}

const introducedFeatures = new Set();

const SCENE_GUIDES = {
  trial_1: {
    title:"When paths meet",
    body:"Robots cannot enter the same square together.",
  },
  trial_2: {
    title:"New map element",
  },
  trial_3: {
    title:"New map element",
  },
  trial_7: {
    title:"New map element: Narrow passage",
    body:"Robots may enter a narrow passage from either end, but only one robot can be inside at a time.",
    example:"If two robots arrive from opposite ends together, one must wait at the entrance until the other has left.",
  },
};

const GUIDE_COPY = {
  cold:"",
  machine:"A marked exit that admits one robot at a time. After entering, the robot leaves the map and the exit becomes available again.",
  passage:"",
  carrier:"",
  operator:"",
  cleaner:"Can carry a spill into cold storage without contamination.",
};

function sceneFeatureItems(task){
  const roles = new Set(task.agents.filter(agent => agent.active).map(agent => agent.role));
  const hasCold = Object.values(task.zones).includes("cold");
  const specs = [
    {
      id:"cold",
      present:hasCold,
      iconName:"cold",
      title:"Cold storage square",
      detail:GUIDE_COPY.cold,
    },
    {
      id:"passage",
      present:Object.keys(task.passages).length > 0,
      iconName:"passage",
      title:"Narrow passage",
      detail:GUIDE_COPY.passage,
    },
    {
      id:"machine",
      present:Object.keys(task.machines).length > 0,
      iconName:"exit",
      title:"Exit",
      detail:GUIDE_COPY.machine,
    },
    {
      id:"carrier",
      present:roles.has("carrier"),
      iconName:"carrier",
      role:"carrier",
      title:"Carrier",
      detail:GUIDE_COPY.carrier,
    },
    {
      id:"operator",
      present:roles.has("operator"),
      iconName:"operator",
      role:"operator",
      title:"Operator",
      detail:GUIDE_COPY.operator,
    },
    {
      id:"cleaner",
      present:roles.has("cleaner"),
      iconName:"cleaner",
      role:"cleaner",
      title:"Cleaner",
      detail:GUIDE_COPY.cleaner,
    },
  ];
  return specs.filter(spec => spec.present && !introducedFeatures.has(spec.id));
}

function guideFeatureMarkup(feature){
  let symbol;
  if(feature.target){
    symbol = '<span class="legend-target-sample" style="--agent-color:#555"><span>0</span></span>';
  }else if(feature.role){
    symbol = roleLegendAvatar(feature.role);
  }else if(feature.id === "passage"){
    symbol = passageMapSample("guide-passage-sample");
  }else{
    symbol = legendIcon(feature.iconName, feature.legendClass || `${feature.iconName}-sample`);
  }
  return `<div class="guide-item">${symbol}<span><strong>${feature.title}</strong>${feature.detail ? `<small>${feature.detail}</small>` : ""}</span></div>`;
}

function sceneHasGuide(task){
  if(SIMPLE_FAMILY_RULE_LANGUAGE) return false;
  return sceneFeatureItems(task).length > 0;
}

function shouldAutoShowGuide(task){
  if(SIMPLE_FAMILY_RULE_LANGUAGE) return false;
  return sceneFeatureItems(task).length > 0;
}

function closeSceneGuide(){
  const backdrop = $("guide-backdrop");
  if(!backdrop || backdrop.hidden) return;
  backdrop.hidden = true;
  sceneGuidesSeen.add(scn.id);
  recordRuleEvent("scene_guide_closed", {scene_guide_id:scn.id});
}

function showSceneGuide(force=false){
  const guide = SCENE_GUIDES[scn.id];
  const newFeatures = sceneFeatureItems(scn);
  const backdrop = $("guide-backdrop");
  if(!backdrop || !newFeatures.length) return;
  $("guide-kicker").textContent = `${scn.label} · Task guide`;
  $("guide-title").textContent = guide?.title || "New elements in this task";
  $("guide-items").innerHTML = newFeatures.map(guideFeatureMarkup).join("");
  const body = $("guide-body");
  const example = $("guide-example");
  body.textContent = guide?.body || "";
  body.hidden = !body.textContent;
  example.textContent = guide?.example || "";
  example.hidden = !example.textContent;
  newFeatures.forEach(feature => {
    introducedFeatures.add(feature.id);
  });
  renderSceneGuideButton();
  backdrop.hidden = false;
  recordRuleEvent("scene_guide_opened", {scene_guide_id:scn.id, first_view:!sceneGuidesSeen.has(scn.id)});
  $("guide-close")?.focus();
}

function renderSceneGuideButton(){
  const button = $("scene-guide");
  if(!button) return;
  const available = sceneHasGuide(scn);
  button.hidden = !available;
  button.onclick = available ? () => showSceneGuide(true) : null;
}

function closeScenePicker(){
  const backdrop = $("scene-picker-backdrop");
  if(backdrop) backdrop.hidden = true;
}

function sceneFullMapMarkup(task){
  const targets = new Map();
  task.agents.filter(agent => agent.active).forEach(agent => {
    const target = goalCell(task, agent);
    const key = K(target[0], target[1]);
    if(!targets.has(key)) targets.set(key, []);
    targets.get(key).push(agent);
  });
  const machines = new Map(Object.values(task.machines).map(machine => [K(machine.cell[0], machine.cell[1]), machine]));
  const cells = [];
  for(let row = 0; row < task.rows; row++){
    for(let col = 0; col < task.cols; col++){
      const key = K(row, col);
      const wall = task.walls.has(key);
      const zone = task.zones[key] || "normal";
      const agents = task.agents.filter(agent => agent.active && sameCell(agent.pos, [row, col]));
      const items = Object.values(task.items).filter(item => K(item.cell[0], item.cell[1]) === key);
      const machine = machines.get(key);
      const passage = task.passageCells.has(key);
      const feature = machine
        ? `<span class="picker-machine marker-${machine.marker || "plain"}"><span class="picker-machine-icon">${icon("machine")}</span></span>`
        : passage
          ? `<span class="picker-passage" aria-hidden="true"></span>`
          : "";
      const itemMarkup = items.map(item => `<span class="picker-item item-${item.colour}" aria-hidden="true"></span>`).join("");
      const targetMarkup = (targets.get(key) || []).map((agent, targetIndex) =>
        `<span class="picker-target picker-target-${targetIndex % 4}${machines.has(key) ? ` picker-target-on-machine picker-target-on-machine-${targetIndex % 4}` : ""}" style="--agent-color:${agentColor(agent)}" aria-hidden="true"><span class="picker-target-label picker-target-label-${targetIndex % 4}">${SIMPLE_FAMILY_RULE_LANGUAGE ? agentTargetNumber(agent, task) : agentDisplayId(agent.id)}</span></span>`
      ).join("");
      const agentMarkup = agents.map((agent, agentIndex) =>
        `<span class="picker-agent ${agents.length > 1 ? "picker-agent-multi" : ""} picker-agent-index-${agentIndex}" style="--agent-color:${agentColor(agent)}" aria-hidden="true">${icon(roleIconName(agent.role), "picker-agent-icon")}<span class="picker-agent-id">${SIMPLE_FAMILY_RULE_LANGUAGE ? agentTargetNumber(agent, task) : agentDisplayId(agent.id)}</span>${SIMPLE_FAMILY_RULE_LANGUAGE ? robotTypeMark(agent.role, "picker-agent-type") : ""}${agent.goal?.kind === "operate" ? icon("machine", "picker-goal-badge") : ""}${agent.carrying === "spill" ? icon("spill", "picker-carry-icon") : ""}</span>`
      ).join("");
      const zoneMarkupText = !wall && zone === "cold" ? zoneMarkup("cold") : "";
      cells.push(`<span class="picker-map-cell ${wall ? "picker-map-wall" : `picker-map-${zone}${passage ? " picker-passage-square" : ""}`}" aria-hidden="true">${wall ? "" : zoneMarkupText + feature + itemMarkup + targetMarkup + agentMarkup}</span>`);
    }
  }
  return `<span class="scene-full-map" style="--map-cols:${task.cols};--map-rows:${task.rows}">${cells.join("")}</span>`;
}

function renderScenePickerKey(){
  const key = $("scene-picker-key");
  if(!key) return;
  const roles = [...new Set(TASKS.flatMap(task =>
    task.agents.filter(agent => agent.active).map(agent => agent.role)
  ))];
  const roleTiles = roles.map(role => {
    const agent = TASKS.flatMap(task => task.agents)
      .find(candidate => candidate.active && candidate.role === role);
    return `<div class="picker-key-tile">${roleLegendAvatar(role, "picker-key-symbol role-symbol")}<span>${ROLE_ZH[role] || role}</span></div>`;
  }).join("");
  const environmentTiles = [
    ["floor", "Available square"],
    ["wall", "Wall"],
    ["passage", "Narrow passage"],
    ["exit", "Exit"],
  ].map(([iconName, label]) =>
    `<div class="picker-key-tile">${iconName === "passage"
      ? passageMapSample("picker-key-symbol")
      : `<span class="picker-key-symbol ${iconName}-symbol">${icon(iconName)}</span>`}<span>${label}</span></div>`
  ).join("");
  key.innerHTML = `<strong>Map key</strong><div class="picker-key-group"><span class="picker-key-group-label">Robot types</span>${roleTiles}</div><div class="picker-key-group"><span class="picker-key-group-label">Map</span><div class="picker-key-grid"><div class="picker-key-tile"><span class="picker-key-target"><span>${SIMPLE_FAMILY_RULE_LANGUAGE ? "1" : "0"}</span></span><span>${SIMPLE_FAMILY_RULE_LANGUAGE ? "Numbered charging bay" : "Target"}</span></div>${environmentTiles}</div></div>`;
}

function showScenePicker(){
  const backdrop = $("scene-picker-backdrop");
  const options = $("scene-picker-options");
  if(!backdrop || !options) return;
  renderScenePickerKey();
  options.innerHTML = "";
  TASKS.forEach((task, index) => {
    const button = document.createElement("button");
    button.className = "scene-picker-card";
    button.type = "button";
    button.innerHTML = `${sceneFullMapMarkup(task)}<span class="scene-picker-card-label">${task.label}</span>`;
    button.onclick = () => {
      initialSceneChosen = true;
      closeScenePicker();
      recordRuleEvent("initial_scene_selected", {
        selected_shift_id:task.id,
        selected_shift_index:index,
      });
      if(index === curIndex){
        renderAll();
        if(shouldAutoShowGuide(scn)) setTimeout(() => showSceneGuide(), 0);
      }else{
        switchTask(index);
      }
    };
    options.appendChild(button);
  });
  backdrop.hidden = false;
  options.querySelector("button")?.focus();
}

function switchTask(index){
  if(!taskUnlocked(TASKS[index])) return;
  window.StudyData?.finishInspections("task-navigation");
  stopTaskAnimation("task-navigation");
  const sourceIndex = curIndex;
  const sourceTask = scn;
  if(EDITOR_CONDITION === "fresh"){
    sceneRuleDrafts.set(scn.id, {family:activeRuleFamily, drafts:currentFamilyDrafts()});
  }
  curIndex = index;
  scn = TASKS[curIndex];
  const carriesActiveRulebook = EDITOR_CONDITION === "carry";
  if(!carriesActiveRulebook){
    const existingDraft = sceneRuleDrafts.get(scn.id);
    activeRuleFamily = existingDraft?.family || "move_dir";
    familyRuleDrafts = existingDraft?.drafts || {move_dir:loadStarterRules(scn), role:[]};
    rules = structuredClone(familyRuleDrafts[activeRuleFamily]);
  }
  lastResult = null;
  lastFrames = [];
  frameIndex = 0;
  trialStartedAt = Date.now();
  trialStartRule = ruleMetricsState();
  window.StudyData?.setContext({
    trial_index:curIndex + 1,
    task_id:scn.id,
    task_item_id:scn.itemId,
    attempt_index:shiftStates[scn.id].attempts,
    rulebook_revision:rulebookRevision,
  });
  recordRuleEvent("shift_selected", {
    selected_shift_id:scn.id,
    selected_shift_index:index,
    previously_visited:shiftStates[scn.id].visited,
  });
  if(carriesActiveRulebook){
    recordRuleEvent("rulebook_carried_over", {
      source_shift_id:sourceTask.id,
      source_shift_index:sourceIndex,
      source_was_successful:shiftStates[sourceTask.id].lastOk === true,
      carried_rule_ids:rules.map(rule => rule.id),
      carried_rule_json:ruleJson(),
      active_rule_family:activeRuleFamily,
      family_draft_state:familyDraftMetrics(),
    });
  }
  renderAll();
  recordTaskEntry("task-navigation");
  persistTaskProgress();
  if(carriesActiveRulebook){
    setStatus(`Your rule from ${sourceTask.label} is still selected. Press Run when you are ready.`, "");
  }
  showFirstRunGuidance();
  if(shouldAutoShowGuide(scn)){
    setTimeout(() => showSceneGuide(), 0);
  }
}

function buildTabs(){
  const tabs = $("tabs");
  tabs.innerHTML = "";
  TASKS.forEach((task, index) => {
    const state = shiftStates[task.id];
    const locked = !taskUnlocked(task);
    if(locked) return;
    const button = document.createElement("button");
    const stateClass = locked
      ? "locked"
      : !state.visited || state.lastOk === null ? "unseen" : state.lastOk ? "solved" : "failed";
    button.className = `tab case-tab ${stateClass}` + (index === curIndex ? " active" : "");
    const mark = locked || !state.visited || state.lastOk === null ? "" : state.lastOk ? "✓" : "×";
    button.innerHTML = `<span class="scene-number">${task.label}</span><span class="scene-mark" aria-hidden="true">${mark}</span>`;
    button.disabled = locked;
    button.title = locked
      ? `${task.label}: complete the previous task first`
      : !state.visited
      ? `${task.label}: not yet run`
      : state.lastOk === null
      ? `${task.label}: edited rule not yet run`
      : `${task.label}: ${state.lastOk ? "solved" : "not solved"}`;
    button.onclick = () => switchTask(index);
    tabs.appendChild(button);
  });
  const sceneLabel = $("scene-label");
  if(sceneLabel) sceneLabel.textContent = scn.label;
  const position = $("scene-position");
  if(position){
    position.textContent = scn.label;
  }
  renderSceneGuideButton();
  const visited = Object.values(shiftStates).filter(state => state.visited).length;
  const currentSolved = Object.values(shiftStates).filter(state =>
    state.lastOk
  ).length;
  const caseSummary = $("case-summary");
  if(caseSummary){
    caseSummary.textContent = `${scn.label} · ${currentSolved} solved`;
  }
  const courseProgress = $("course-progress");
  if(courseProgress){
    courseProgress.textContent = `${visited} checked`;
  }
}

function renderSceneGoal(){
  const list = $("scene-goal-list");
  if(!list) return;
  const consequence = CONTINUATION_CONDITION === "local"
    ? "Robots that are not involved in a conflict keep moving."
    : "If a conflict occurs, all robots stop.";
  list.innerHTML = `<div class="goal-instruction">Help every robot reach its charging bay. ${consequence}</div>`;
}

function buildBoard(){
  const board = $("board");
  board.innerHTML = "";
  robotEls = {};
  machineEls = {};
  // The cumulative maps share one coordinate scale. Window fitting happens to
  // the complete task surface, so cells and feature badges never resize alone.
  CELL = TASK_CELL_SIZE;
  board.style.setProperty("--robot-badge-size", `${TASK_FEATURE_BADGE_SIZE}px`);
  board.style.setProperty("--robot-badge-offset", "1px");
  board.style.width = (scn.cols * CELL) + "px";
  board.style.height = (scn.rows * CELL) + "px";
  const machineCellKeys = new Set(
    Object.values(scn.machines).map(machine => K(machine.cell[0], machine.cell[1]))
  );
  const passageCellKeys = scn.passageCells;
  const passageEntranceKeys = scn.passageEntrances;
  scn.diagonalEdgePairs.forEach(([first, second]) => {
    const firstX = first[1] * CELL + (CELL - 4) / 2;
    const firstY = first[0] * CELL + (CELL - 4) / 2;
    const secondX = second[1] * CELL + (CELL - 4) / 2;
    const secondY = second[0] * CELL + (CELL - 4) / 2;
    const dx = secondX - firstX;
    const dy = secondY - firstY;
    const link = document.createElement("div");
    link.className = "diagonal-road-link";
    link.style.left = `${firstX}px`;
    link.style.top = `${firstY}px`;
    link.style.width = `${Math.hypot(dx, dy)}px`;
    link.style.height = `${Math.max(8, CELL - 8)}px`;
    link.style.transform = `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`;
    board.appendChild(link);
  });

  for(let r=0; r<scn.rows; r++) for(let c=0; c<scn.cols; c++){
    const key = K(r,c);
    const blocked = !passable(scn, [r,c]);
    const zone = zoneOf(scn, [r,c]);
    const visualZone = zone === "intersection" ? "normal" : zone;
    const cell = document.createElement("div");
    cell.className = blocked
      ? `cell wall${r % 2 ? " wall-row-offset" : ""}`
      : "cell zone-" + visualZone
        + (machineCellKeys.has(key) ? " machine-square-cell" : "")
        + (passageCellKeys.has(key) ? " passage-square-cell" : "")
        + (passageEntranceKeys.has(key) ? " passage-entrance-cell" : "");
    cell.style.left = (c * CELL) + "px";
    cell.style.top = (r * CELL) + "px";
    cell.style.width = (blocked ? CELL : CELL - 4) + "px";
    cell.style.height = (blocked ? CELL : CELL - 4) + "px";
    cell.dataset.cell = key;
    cell.setAttribute("aria-label", blocked
      ? "Wall"
      : machineCellKeys.has(key)
        ? "Exit"
        : passageCellKeys.has(key)
          ? "Narrow passage"
          : (ZONE_ZH[visualZone] || visualZone));
    if(!blocked){
      cell.innerHTML = zoneMarkup(visualZone);
    }
    board.appendChild(cell);
  }

  Object.values(scn.machines).forEach(machine => {
    const el = document.createElement("div");
    el.className = `machine marker-${machine.marker || "plain"}`;
    el.style.left = (machine.cell[1] * CELL + 3) + "px";
    el.style.top = (machine.cell[0] * CELL + 3) + "px";
    el.style.width = (CELL - 8) + "px";
    el.style.height = (CELL - 8) + "px";
    el.innerHTML = icon("machine", "board-feature-icon");
    el.setAttribute("aria-label", machineLabel(machine.id));
    board.appendChild(el);
    machineEls[machine.id] = el;
  });

  Object.values(scn.items).forEach(item => {
    const el = document.createElement("div");
    el.className = "item item-" + item.colour;
    el.style.left = (item.cell[1] * CELL + 11) + "px";
    el.style.top = (item.cell[0] * CELL + 11) + "px";
    el.style.width = (CELL - 22) + "px";
    el.style.height = (CELL - 22) + "px";
    el.setAttribute("aria-label", ITEM_ZH[item.colour] || item.id);
    board.appendChild(el);
  });

  const activeAgents = scn.agents.filter(agent => agent.active);
  const targetGroups = {};
  activeAgents.forEach(agent => {
    const target = goalCell(scn, agent);
    const key = K(target[0], target[1]);
    targetGroups[key] = targetGroups[key] || [];
    targetGroups[key].push(agent.id);
  });

  Object.values(scn.machines).forEach(machine => {
    const assigned = activeAgents.filter(agent =>
      agent.goal.kind === "operate" && agent.goal.machine === machine.id
    );
    const machineEl = machineEls[machine.id];
    if(!machineEl || !assigned.length) return;
    const labels = assigned.map(agent =>
      `<span style="--agent-color:${agentColor(agent)}">${agentDisplayId(agent.id)}</span>`
    ).join("");
    machineEl.insertAdjacentHTML("beforeend", `<span class="machine-goal-ids" aria-label="Target for robots ${assigned.map(agent => agentDisplayId(agent.id)).join(" and ")}">${labels}</span>`);
  });

  (scn.previousGoals || []).forEach(goal => {
    const ring = document.createElement("div");
    ring.className = "ring previous-goal-ring";
    ring.style.left = `${goal.target[1] * CELL}px`;
    ring.style.top = `${goal.target[0] * CELL}px`;
    ring.style.width = `${CELL - 4}px`;
    ring.style.height = `${CELL - 4}px`;
    ring.setAttribute("aria-label", "Charging bay completed in an earlier task");
    ring.innerHTML = '<span aria-hidden="true">✓</span>';
    board.appendChild(ring);
  });

  activeAgents.forEach(agent => {
    const target = goalCell(scn, agent);
    const targetIds = targetGroups[K(target[0], target[1])];
    const targetIndex = targetIds.indexOf(agent.id);
    const targetIsMachine = Object.values(scn.machines).some(machine => sameCell(machine.cell, target));
    if(targetIsMachine) return;
    const inset = targetIsMachine ? 0 : targetIndex * 4;
    const ring = document.createElement("div");
    ring.className = "ring";
    if(targetIds.length > 1) ring.classList.add("shared-target-ring");
    ring.style.left = (target[1] * CELL + inset) + "px";
    ring.style.top = (target[0] * CELL + inset) + "px";
    ring.style.width = (CELL - 4 - inset * 2) + "px";
    ring.style.height = (CELL - 4 - inset * 2) + "px";
    ring.style.borderColor = agentColor(agent);
    ring.style.setProperty("--agent-color", agentColor(agent));
    ring.classList.add("goal-" + agent.goal.kind);
    if(targetIsMachine){
      ring.classList.add("machine-target-ring");
    }
    ring.setAttribute("aria-label", SIMPLE_FAMILY_RULE_LANGUAGE
      ? `Charging bay ${agentTargetNumber(agent)} for Robot ${agentTargetNumber(agent)}, ${ROLE_ZH[agent.role] || agent.role}`
      : `Robot ${agentDisplayId(agent.id)} target: ${goalLabel(agent)}`);
    ring.innerHTML = targetMarkup(agent, targetIndex, targetIsMachine);
    board.appendChild(ring);
  });

  scn.agents.forEach(agent => {
    const robot = document.createElement("div");
    robot.className = "robot" + (agent.active ? "" : " off-duty");
    robot.dataset.agentId = agent.id;
    robot.dataset.role = agent.role;
    const robotSize = Math.max(20, CELL - 2);
    robot.style.width = robotSize + "px";
    robot.style.height = robotSize + "px";
    robot.style.setProperty("--robot-fill", agentColor(agent));
    robot.style.background = agentColor(agent);
    const movement = displayedMovement(agent);
    const identity = SIMPLE_FAMILY_RULE_LANGUAGE
      ? `Robot ${agentTargetNumber(agent)}, ${ROLE_ZH[agent.role] || agent.role}, movement ${MOVEMENT_ARROWS[movement] || movement}`
      : `Robot ${agentDisplayId(agent.id)}`;
    robot.setAttribute("aria-label", agent.active ? identity : `${identity}: off duty`);
    robot.innerHTML = robotMarkup(agent, null);
    board.appendChild(robot);
    robotEls[agent.id] = robot;
  });

  renderFrame(initialFrame());
}

function initialFrame(){
  const pos = Object.fromEntries(scn.agents.map(agent => [
    agent.id, agent.pos.slice(),
  ]));
  const agents = {};
  scn.agents.forEach(agent => {
    agents[agent.id] = {
      state:!agent.active ? "off-duty" : "pending",
      done:!agent.active,
      offDuty:!agent.active,
      waiting:false,
      failed:false,
      step_index:null,
      step_count:null,
      next_step:"",
    };
  });
  return { pos, event:null, agents, tick:0 };
}

function stateText(meta){
  if(!meta) return "Not run";
  if(meta.offDuty) return "Off duty";
  if(meta.failed) return "Failed";
  if(meta.done) return "Complete";
  if(meta.waiting) return "Waiting by rule";
  if(meta.step_count === null || meta.step_count === undefined) return "Not run";
  return "Moving";
}

function stateClass(meta){
  if(!meta) return "idle";
  if(meta.offDuty) return "off-duty";
  if(meta.failed) return "bad";
  if(meta.done) return "ok";
  if(meta.waiting) return "wait";
  return "run";
}

function goalLabel(agent){
  const target = goalCell(scn, agent);
  if(agent.goal.kind === "deliver") return `deliver ${agent.goal.item} to (${target[0]}, ${target[1]})`;
  if(agent.goal.kind === "operate") return `leave through the ${machineLabel(agent.goal.machine)}`;
  return `reach (${target[0]}, ${target[1]})`;
}

function agentBadge(agent, className=""){
  return `<span class="agent-chip ${className}">${agentAvatar(agent)}${spillIconBadge(agent, "chip-spill")}</span>`;
}

function legendSection(title, content, className=""){
  if(!content) return "";
  return `<section class="legend-section ${className}"><div class="legend-title">${title}</div><div class="legend-grid">${content}</div></section>`;
}

function legendTile(symbol, title, detail="", extraClass=""){
  return `<div class="legend-tile ${extraClass}">${symbol}<span class="legend-copy"><strong>${title}</strong>${detail ? `<small>${detail}</small>` : ""}</span></div>`;
}

function legendSample(text, className=""){
  return `<span class="legend-sample ${className}">${text}</span>`;
}

function legendIcon(iconName, className=""){
  return `<span class="legend-symbol ${className}">${icon(iconName)}</span>`;
}

function statePill(meta){
  return `<span class="state-pill ${stateClass(meta)}">${stateText(meta)}</span>`;
}

function renderAgentProgress(frame){
  const panel = $("agent-progress");
  if(!panel) return;
  panel.innerHTML = "";
  panel.hidden = true;
}

function renderFrame(frame){
  Object.values(machineEls).forEach(el => el.classList.remove("available"));
  const releasedMachines = new Set();
  const occupiedMachines = new Set();
  scn.agents.forEach(agent => {
    const p = frame.pos[agent.id];
    const el = robotEls[agent.id];
    if(!el || !p) return;
    const meta = frame.agents?.[agent.id] || frame.agents?.[String(agent.id)] || null;
    const released = !!meta?.released;
    el.classList.toggle("released", released);
    el.setAttribute("aria-hidden", released ? "true" : "false");
    const robotSize = Number.parseFloat(el.style.width) || Math.max(20, CELL - 2);
    const robotInset = Math.max(2, (CELL - 4 - robotSize) / 2);
    el.style.left = (p[1] * CELL + robotInset) + "px";
    el.style.top = (p[0] * CELL + robotInset) + "px";
    el.classList.toggle("done", !!meta?.done);
    el.classList.toggle("off-duty", !!meta?.offDuty);
    el.classList.toggle("waiting", !!meta?.waiting && !meta?.done && !meta?.failed);
    el.classList.toggle("failed", !!meta?.failed && !meta?.done);
    el.style.setProperty("--robot-fill", agentColor(agent));
    el.style.backgroundColor = agentColor(agent);
    const movement = displayedMovement(agent, meta);
    const identity = SIMPLE_FAMILY_RULE_LANGUAGE
      ? `${ROLE_ZH[agent.role] || agent.role}${movement ? `, movement ${MOVEMENT_ARROWS[movement] || movement}` : ""}`
      : "";
    el.setAttribute("aria-label", SIMPLE_FAMILY_RULE_LANGUAGE
      ? `Robot ${agentTargetNumber(agent)}, ${identity}: ${stateText(meta)}`
      : `Robot ${agentDisplayId(agent.id)}: ${stateText(meta)}`);
    el.innerHTML = robotMarkup(agent, meta);
    if(agent.goal?.kind === "operate"){
      if(released){
        releasedMachines.add(agent.goal.machine);
      }else if(sameCell(p, scn.machines[agent.goal.machine]?.cell)){
        occupiedMachines.add(agent.goal.machine);
      }
    }
  });
  releasedMachines.forEach(machineId => {
    if(!occupiedMachines.has(machineId)) machineEls[machineId]?.classList.add("available");
  });
  document.querySelectorAll(".cell.flash").forEach(el => el.classList.remove("flash"));
  const failureEvents = frame.failureEvents || frame.simultaneousEvents || [frame.event];
  failureEvents.forEach(event => {
    if(!event?.cell || event.type === "machine-complete") return;
    const cell = document.querySelector('[data-cell="' + K(event.cell[0], event.cell[1]) + '"]');
    if(cell) cell.classList.add("flash");
  });
  renderAgentProgress(frame);
  updateFrameButtons();
}

function schemaObject(id){
  return RULE_SCHEMA.find(object => object.id === id) || null;
}

function schemaProperty(objectId, propertyId){
  return schemaObject(objectId)?.properties.find(property => property.id === propertyId) || null;
}

function conditionText(cond){
  if(cond.p === "target_type"){
    const targetType = {
      road:"an ordinary road square",
      passage:"a narrow-passage square",
      machine:"an exit",
      cold:"cold storage",
    }[cond.v] || cond.v;
    return `the next square is ${targetType}`;
  }
  if(cond.p === "role"){
    const role = ROLE_ZH[cond.v] || cond.v;
    return SIMPLE_FAMILY_RULE_LANGUAGE
      ? `the robot is ${role}`
      : `the robot's role is ${role}`;
  }
  if(cond.p === "carrying"){
    return "the robot is carrying a spill";
  }
  if(cond.p === "move_dir"){
    if(SIMPLE_FAMILY_RULE_LANGUAGE){
      return `the robot's movement direction is ${MOVEMENT_ARROWS[cond.v] || cond.v}`;
    }
    const direction = {N:"north", S:"south", E:"east", W:"west"}[cond.v] || cond.v;
    return `the robot is moving ${direction}`;
  }
  if(cond.p === "station_marker"){
    const marker = {red:"red", blue:"blue", green:"green"}[cond.v] || cond.v;
    return `the target station is ${marker}`;
  }
  if(cond.p === "contested"){
    return "the robot's movement conflicts with another robot";
  }
  return cond.label || `${cond.p}: ${cond.v}`;
}

function displayCondition(_rule, cond){
  return conditionText(cond);
}

function cloneCondition(cond){
  return {
    object:cond.object,
    property:cond.property,
    p:cond.p,
    v:cond.v,
    negated:false,
  };
}

function cloneRule(rule, sourceLibraryId=null){
  return {
    id:nextRuleId++,
    action:"MOVE",
    conds:rule.conds.map(cloneCondition),
    editor:null,
    sourceLibraryId,
  };
}

function duplicateRuleForEdit(rule, sourceIndex){
  if(!rule.conds.length){
    showNotice("Add a condition before duplicating this rule.");
    return;
  }
  const duplicate = cloneRule(rule, rule.sourceLibraryId || null);
  const preferredIndex = Math.max(
    0,
    duplicate.conds.findIndex(condition => condition.p === "move_dir" || condition.p === "role"),
  );
  const condition = duplicate.conds[preferredIndex];
  duplicate.editor = {
    conditionIndex:preferredIndex,
    object:condition.object,
    property:condition.property,
    value:condition.v,
  };
  rules.push(duplicate);
  recordRuleEvent("rule_duplicated_for_edit", {
    source_rule_id:rule.id,
    source_rule_index:sourceIndex,
    rule_id:duplicate.id,
    rule_index:rules.length - 1,
    condition_index:preferredIndex,
  });
  renderRules();
}

function starterRulesFor(task){
  return (task?.starter_rulebook || []).map(rule => cloneRule({
    action:"MOVE",
    conds:rule.conds || [],
  }));
}

function loadStarterRules(task){
  const starter = starterRulesFor(task);
  if(!starter.length) return [];
  sceneRuleDrafts.set(task.id, starter);
  recordRuleEvent("starter_rulebook_loaded", {
    starter_rule_ids:starter.map(rule => rule.id),
    starter_rule_json:ruleJson(starter),
  });
  return starter;
}

function ruleSignature(rule){
  return rule.conds
    .map(cond => `${cond.p}|${String(cond.v)}`)
    .sort()
    .join(";");
}

function ruleText(rule){
  return `If ${rule.conds.map(c => displayCondition(rule, c)).join(" and ")}, then do not move into the square`;
}

function saveRuleToLibrary(rule, ruleIndex){
  if(!rule.conds.length){
    showNotice("Add a complete condition before saving this rule.");
    return;
  }
  const signature = ruleSignature(rule);
  const existing = library.find(entry => entry.signature === signature);
  if(existing){
    recordRuleEvent("library_save_skipped", {
      rule_id:rule.id,
      rule_index:ruleIndex,
      library_rule_id:existing.id,
      reason:"duplicate_rule",
    });
    setStatus("This rule is already in the library.", "");
    return;
  }
  const entry = {
    id:`L${Math.max(0, ...library.map(row => Number(row.id.slice(1)) || 0)) + 1}`,
    signature,
    sourceRuleId:rule.id,
    rule:{action:"MOVE", conds:rule.conds.map(cloneCondition)},
  };
  library.push(entry);
  recordRuleEvent("library_rule_saved", {
    rule_id:rule.id,
    rule_index:ruleIndex,
    library_rule_id:entry.id,
    rule:ruleJson([rule])[0],
  });
  renderRules();
}

function useLibraryRule(entry){
  const signature = entry.signature;
  if(rules.some(rule => ruleSignature(rule) === signature)){
    recordRuleEvent("library_rule_use_skipped", {
      library_rule_id:entry.id,
      reason:"already_active",
    });
    setStatus("This library rule is already active in the task.", "");
    return;
  }
  const rule = cloneRule(entry.rule, entry.id);
  rules.push(rule);
  recordRuleEvent("library_rule_used", {
    rule_id:rule.id,
    rule_index:rules.length - 1,
    library_rule_id:entry.id,
    source_rule_id:entry.sourceRuleId,
  });
  renderRules();
}

function removeLibraryRule(entry){
  library = library.filter(row => row.id !== entry.id);
  recordRuleEvent("library_rule_removed", {library_rule_id:entry.id});
  renderRules();
}

function renderLibrary(){
  const box = $("library");
  if(!box) return;
  box.innerHTML = "";
  $("library-count").textContent = `${library.length} saved`;
  if(!library.length){
    box.innerHTML = '<div class="library-empty">No saved rules yet.</div>';
    return;
  }
  library.forEach(entry => {
    const row = document.createElement("div");
    row.className = "library-row";
    const text = document.createElement("span");
    text.className = "library-rule-text";
    text.textContent = `${entry.id}: ${ruleText(entry.rule)}`;
    row.appendChild(text);

    const use = document.createElement("button");
    use.className = "library-use";
    use.textContent = "Add to rulebook";
    use.title = "Add this saved rule to the shared rulebook";
    use.onclick = () => useLibraryRule(entry);
    row.appendChild(use);

    const remove = document.createElement("button");
    remove.className = "library-remove";
    remove.textContent = "×";
    remove.title = "Remove this rule from the library";
    remove.setAttribute("aria-label", `Remove ${entry.id} from library`);
    remove.onclick = () => removeLibraryRule(entry);
    row.appendChild(remove);
    box.appendChild(row);
  });
}

function emptyConditionEditor(conditionIndex=null){
  return {
    conditionIndex,
    object:null,
    property:null,
    value:null,
  };
}

function editorSelect(className, placeholder, options, selected, onChange, disabled=false){
  const select = document.createElement("select");
  select.className = className;
  select.disabled = disabled;
  const blank = document.createElement("option");
  blank.value = "";
  blank.textContent = placeholder;
  select.appendChild(blank);
  options.forEach(option => {
    const row = document.createElement("option");
    row.value = String(option.id);
    row.textContent = option.label;
    row.selected = selected !== null && selected !== undefined && String(option.id) === String(selected);
    select.appendChild(row);
  });
  select.onchange = () => onChange(select.value);
  return select;
}

function editorField(label, control){
  const field = document.createElement("label");
  field.className = "editor-field";
  const caption = document.createElement("span");
  caption.className = "editor-field-label";
  caption.textContent = label;
  field.appendChild(caption);
  field.appendChild(control);
  return field;
}

function conditionPayload(cond){
  return {
    object:cond.object,
    property:cond.property,
    predicate:cond.p,
    value:cond.v,
    text:conditionText(cond),
  };
}

function conditionTerms(object){
  if(!object) return [];
  return object.properties.flatMap(property =>
    property.values.map(value => ({
      id:`${property.id}|${String(value.id)}`,
      label:value.label,
      property:property.id,
      predicate:property.predicate,
      value:value.id,
    }))
  );
}

function termPlaceholder(objectId){
  if(objectId === "target") return "Choose square fact";
  if(objectId === "robot") return "Choose robot fact";
  if(objectId === "movement") return "Choose movement fact";
  return "Choose fact";
}

function renderConditionEditor(rule, card){
  const editor = rule.editor;
  if(!editor) return;

  const panel = document.createElement("div");
  panel.className = "condition-editor";
  const prefix = document.createElement("span");
  prefix.className = "condition-builder-prefix";
  const hasPreviousCondition = editor.conditionIndex === null
    ? rule.conds.length > 0
    : editor.conditionIndex > 0;
  prefix.textContent = hasPreviousCondition
    ? "AND"
    : "WHEN";
  panel.appendChild(prefix);

  const object = schemaObject(editor.object);
  const property = schemaProperty(editor.object, editor.property);
  const availableObjects = RULE_SCHEMA;

  const objectSelect = editorSelect(
    "typed-select object-select",
    "Select object",
    availableObjects,
    editor.object,
    value => {
      editor.object = value || null;
      editor.property = null;
      editor.value = null;
      recordRuleEvent("condition_field_selected", {rule_id:rule.id, field:"object", value:value || null});
      renderRules();
    }
  );
  objectSelect.setAttribute("aria-label", "Condition object");
  panel.appendChild(objectSelect);

  const terms = conditionTerms(object);
  const selectedTerm = editor.property === null
    ? null
    : `${editor.property}|${String(editor.value)}`;
  const valueSelect = editorSelect(
    "typed-select value-select",
    "Select fact",
    terms,
    selectedTerm,
    value => {
      const selected = terms.find(option => option.id === value) || null;
      editor.property = selected?.property || null;
      editor.value = selected ? selected.value : null;
      recordRuleEvent("condition_term_selected", {
        rule_id:rule.id,
        object:editor.object,
        property:editor.property,
        predicate:selected?.predicate || null,
        value:editor.value,
        label:selected?.label || null,
      });
      renderRules();
    },
    !object
  );
  valueSelect.setAttribute("aria-label", "Condition fact");
  panel.appendChild(valueSelect);

  const actions = document.createElement("div");
  actions.className = "condition-editor-actions";
  const save = document.createElement("button");
  save.className = "btn condition-save";
  save.textContent = editor.conditionIndex === null ? "Add" : "Save";
  save.disabled = !object || !property || editor.value === null;
  save.onclick = () => {
    const duplicatePropertyIndex = rule.conds.findIndex((existing, index) =>
      index !== editor.conditionIndex && existing.property === property.id
    );
    if(duplicatePropertyIndex !== -1){
      showNotice("Each rule can use a property only once.");
      return;
    }
    const cond = {
      object:object.id,
      property:property.id,
      p:property.predicate,
      v:editor.value,
      negated:false,
    };
    const editing = editor.conditionIndex !== null;
    if(editing) rule.conds[editor.conditionIndex] = cond;
    else rule.conds.push(cond);
    recordRuleEvent(editing ? "condition_edited" : "condition_added", {
      rule_id:rule.id,
      condition_index:editing ? editor.conditionIndex : rule.conds.length - 1,
      condition:conditionPayload(cond),
    });
    rule.editor = null;
    renderRules();
  };
  actions.appendChild(save);

  const cancel = document.createElement("button");
  cancel.className = "btn condition-cancel";
  cancel.textContent = "Cancel";
  cancel.onclick = () => {
    recordRuleEvent("condition_editor_closed", {rule_id:rule.id, saved:false});
    rule.editor = null;
    renderRules();
  };
  actions.appendChild(cancel);
  panel.appendChild(actions);
  card.appendChild(panel);
}

function simpleField(predicate){
  return (EXPORTED_RULE_SCHEMA.fields || []).find(field => field.predicate === predicate) || null;
}

function simpleFields(){
  return ["move_dir", "role"]
    .map(predicate => simpleField(predicate))
    .filter(Boolean);
}

function isPureFamilyRulebook(sourceRules, family){
  const field = simpleField(family);
  return !!field && Array.isArray(sourceRules) && sourceRules.every(rule =>
    rule?.action === "MOVE" && Array.isArray(rule.conds) && rule.conds.length === 1 &&
    rule.conds[0].p === family && !rule.conds[0].negated &&
    field.values.some(value => String(value.id) === String(rule.conds[0].v))
  );
}

function currentFamilyDrafts(){
  return structuredClone({...familyRuleDrafts, [activeRuleFamily]:rules});
}

function familyDraftMetrics(){
  return Object.fromEntries(Object.entries(currentFamilyDrafts()).map(([family, draft]) => {
    const state = simpleRuleState(draft);
    return [family, {movement_mask:state.movementMask, role_mask:state.roleMask}];
  }));
}

function switchRuleFamily(family, trigger="click"){
  if(!["move_dir", "role"].includes(family) || family === activeRuleFamily) return;
  window.StudyData?.finishInspections("rule-family-switch");
  const before = ruleMetricsState();
  const from = activeRuleFamily;
  familyRuleDrafts = currentFamilyDrafts();
  activeRuleFamily = family;
  rules = window.STUDY_CONFIG.retain_family_drafts
    ? structuredClone(familyRuleDrafts[family]) : [];
  if(!window.STUDY_CONFIG.retain_family_drafts) familyRuleDrafts = {move_dir:[], role:[]};
  stopTaskAnimation("rule-family-switch");
  recordRuleEvent("rule_family_changed", {
    from_family:from, to_family:family, trigger, rule_state_before:before,
    rule_state_after:ruleMetricsState(), family_draft_state:familyDraftMetrics(),
    restored_draft:rules.length > 0,
  });
  resetRunAfterRuleEdit();
  renderRules();
  if(taskMode === "task") window.StudyData?.record("rule_representation_changed", {
    before:before.representation, after:ruleMetricsState().representation,
    source:"tab-switch", rule_state:ruleMetricsState(),
  });
  document.getElementById(`rule-family-tab-${family}`)?.focus();
}

function simpleSelectedValues(sourceRules=rules, family=null){
  if(!family){
    return simpleFields().flatMap(field => simpleSelectedValues(sourceRules, field.predicate));
  }
  const field = simpleField(family);
  if(!field) return [];
  const selected = new Set(sourceRules
    .flatMap(rule => rule.conds)
    .filter(cond => cond.p === family)
    .map(cond => String(cond.v)));
  return field.values.filter(value => selected.has(String(value.id)));
}

function simpleRuleState(sourceRules=rules){
  const movement = simpleSelectedValues(sourceRules, "move_dir");
  const role = simpleSelectedValues(sourceRules, "role");
  const maskFor = (field, values) => values.reduce((mask, value) => {
    const index = field?.values?.findIndex(option => String(option.id) === String(value.id)) ?? -1;
    return index < 0 ? mask : mask | (1 << index);
  }, 0);
  let representation = "empty";
  if(movement.length && role.length) representation = "mixed";
  else if(movement.length) representation = "pure_movement";
  else if(role.length) representation = "pure_type";
  return {
    representation,
    movement,
    role,
    movementMask:maskFor(simpleField("move_dir"), movement),
    roleMask:maskFor(simpleField("role"), role),
    valueCount:movement.length + role.length,
  };
}

function simpleRuleMatchesAgent(agent, sourceRules=rules){
  if(!agent?.active) return false;
  const state = simpleRuleState(sourceRules);
  return state.role.some(value => String(value.id) === String(agent.role)) ||
    state.movement.some(value => String(value.id) === String(agent.movementArrow));
}

function renderRuleMatchPreview(){
  if(!SIMPLE_FAMILY_RULE_LANGUAGE) return;
  scn.agents.forEach(agent => {
    const matches = simpleRuleMatchesAgent(agent);
    robotEls[agent.id]?.classList.toggle("rule-preview-waits", matches);
  });
}

function naturalList(items){
  if(items.length < 2) return items[0] || "";
  if(items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

function simpleRuleSentence(sourceRules=rules){
  const state = simpleRuleState(sourceRules);
  if(!state.valueCount) return "No waiting rule yet.";
  const clauses = [];
  if(state.movement.length){
    const directions = naturalList(state.movement.map(
      value => value.symbol || MOVEMENT_ARROWS[value.id] || value.id
    ));
    clauses.push(`it is moving ${directions}`);
  }
  if(state.role.length){
    clauses.push(`it is ${naturalList(state.role.map(value => value.label))}`);
  }
  return `A robot waits if ${clauses.join(", or ")}.`;
}

function simpleCondition(field, value){
  return {
    object:field.object,
    property:field.id,
    p:field.predicate,
    v:value.id,
    negated:false,
  };
}

function carryPracticeRuleIntoFirstTask(){
  if(!SIMPLE_FAMILY_RULE_LANGUAGE || curIndex !== 0 ||
    window.SHUFFLE_PREVIEW.inspect || rules.length ||
    window.StudyData?.checkpoint("task")) return;
  const events = window.StudyData?.snapshot().events || [];
  if(events.some(event => event.stage === "task" && (
    event.event_type === "task_entered" || event.event_type === "run_started" ||
    event.event_type === "run_completed" || MUTATING_RULE_EVENTS.has(event.event_type)
  ))) return;

  // The guided tutorial's config names the protocol and the rule carried into T1.
  const protocol = window.GuidedTutorialConfig?.protocol;
  const carry = window.GuidedTutorialConfig?.carryIntoFirstTask;
  if(!protocol || !carry) return;
  const completedIndex = events.findLastIndex(event => event.event_type === "tutorial_completed");
  const completed = events[completedIndex];
  if(completed?.detail?.tutorial_protocol !== protocol) return;
  // Carry only after a practice Run that solved the practice map.
  const practice = events.slice(0, completedIndex).findLast(event =>
    event.event_type === "tutorial_run" && event.detail?.tutorial_protocol === protocol &&
    event.detail?.ok && event.detail?.practice_requirement_met
  );
  if(!practice) return;
  const field = simpleField(carry.family);
  const value = field?.values.find(option => String(option.id) === String(carry.value));
  if(!value) return;
  activeRuleFamily = carry.family;
  rules = [{id:nextRuleId++, action:"MOVE", conds:[simpleCondition(field, value)], editor:null}];
  recordRuleEvent("practice_rule_carried_over", {
    automatic:true,
    source_event_id:practice.event_id,
    source_completion_event_id:completed.event_id,
    source_scene_id:practice.detail.scene_id,
    practice_protocol:protocol,
    carried_family:carry.family,
    carried_value:value.id,
    movement_values:carry.family === "move_dir" ? [value.id] : [],
    role_values:carry.family === "role" ? [value.id] : [],
    rule_state:ruleMetricsState(),
  });
}

function resetRunAfterRuleEdit(){
  stopTaskAnimation("rule-edit");
  lastResult = null;
  if(!lastFrames.length) buildBoard();
  updateContinueButton();
  setStatus(
    simpleSelectedValues().length
      ? "Rule changed. Press Run to test it with all robots back at the start."
      : "No values selected. Run to see what happens without a waiting rule.",
    "",
  );
  showFirstRunGuidance();
  persistTaskProgress();
}

function toggleSimpleValue(field, value){
  if(field.predicate !== activeRuleFamily) return;
  const representationBefore = simpleRuleState().representation;
  const index = rules.findIndex(rule =>
    rule.conds.length === 1 &&
    rule.conds[0].p === field.predicate &&
    String(rule.conds[0].v) === String(value.id)
  );
  if(index >= 0){
    const [removed] = rules.splice(index, 1);
    recordRuleEvent("rule_value_removed", {
      family:field.predicate,
      value:value.id,
      rule_id:removed.id,
    });
  }else{
    const rule = {
      id:nextRuleId++,
      action:"MOVE",
      conds:[simpleCondition(field, value)],
      editor:null,
    };
    rules.push(rule);
    recordRuleEvent("rule_value_added", {
      family:field.predicate,
      value:value.id,
      rule_id:rule.id,
    });
  }
  resetRunAfterRuleEdit();
  renderRules();
  const after = ruleMetricsState();
  if(taskMode !== "task") return;
  if(after.representation !== representationBefore) window.StudyData?.record("rule_representation_changed", {
    before:representationBefore, after:after.representation, rule_state:after,
  });
  if(field.predicate === "role" && after.role_mask && !window.StudyData?.snapshot().events.some(event => event.event_type === "first_type_value_selected")){
    window.StudyData?.record("first_type_value_selected", {rule_state:after});
  }
}

function renderSimpleRuleEditor(){
  window.StudyData?.finishInspections();
  const box = $("rules");
  const actions = document.querySelector(".rulebook-actions");
  const libraryPanel = document.querySelector(".library-panel");
  if(actions) actions.hidden = true;
  if(libraryPanel) libraryPanel.hidden = true;
  box.innerHTML = "";

  const editor = document.createElement("div");
  editor.className = "simple-rule-editor";
  const state = simpleRuleState();
  const current = document.createElement("section");
  current.className = "simple-current-rule";
  current.innerHTML = `<span>CURRENT RULE</span><strong>${simpleRuleSentence()}</strong>`;
  editor.appendChild(current);
  const context = document.createElement("div");
  context.className = "simple-rule-context";
  context.textContent = "WHEN TWO ROBOTS MEET";
  editor.appendChild(context);

  const intro = document.createElement("section");
  intro.className = "simple-rule-intro";
  intro.innerHTML = '<strong>Choose who waits</strong><p>Select one or more values. A robot waits if it matches any selected value.</p>';
  editor.appendChild(intro);

  const fields = [simpleField("role"), simpleField("move_dir")].filter(Boolean);
  const tabs = document.createElement("div");
  tabs.className = "rule-family-tabs";
  tabs.setAttribute("role", "tablist");
  tabs.setAttribute("aria-label", "Rule feature");
  fields.forEach((field, index) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.id = `rule-family-tab-${field.predicate}`;
    tab.className = "rule-family-tab";
    tab.dataset.family = field.predicate;
    tab.textContent = field.predicate === "role" ? "Type" : "Movement";
    tab.setAttribute("role", "tab");
    tab.setAttribute("aria-selected", String(field.predicate === activeRuleFamily));
    tab.setAttribute("aria-controls", `rule-family-panel-${field.predicate}`);
    tab.tabIndex = field.predicate === activeRuleFamily ? 0 : -1;
    tab.onclick = () => switchRuleFamily(field.predicate);
    tab.onkeydown = event => {
      const next = event.key === "ArrowRight" ? (index+1)%fields.length
        : event.key === "ArrowLeft" ? (index+fields.length-1)%fields.length
        : event.key === "Home" ? 0 : event.key === "End" ? fields.length-1 : null;
      if(next === null) return;
      event.preventDefault();
      switchRuleFamily(fields[next].predicate, "keyboard");
    };
    tabs.appendChild(tab);
  });
  editor.appendChild(tabs);
  const familySections = document.createElement("div");
  familySections.className = "simple-family-sections pure-family-panels";
  fields.forEach(field => {
    const selectedValues = new Set(
      simpleSelectedValues(rules, field.predicate).map(value => String(value.id))
    );
    const familySection = document.createElement("section");
    familySection.className = `simple-family-section family-${field.predicate}`;
    familySection.id = `rule-family-panel-${field.predicate}`;
    familySection.hidden = field.predicate !== activeRuleFamily;
    familySection.setAttribute("role", "tabpanel");
    familySection.setAttribute("aria-labelledby", `rule-family-tab-${field.predicate}`);
    familySection.dataset.family = field.predicate;
    const familyHeading = document.createElement("div");
    familyHeading.className = "simple-family-heading";
    familyHeading.innerHTML = field.predicate === "role"
      ? `${icon("robot", "family-button-icon")}<strong>Robot type</strong>`
      : '<span class="family-arrow-icon" aria-hidden="true">\u2197</span><strong>Movement direction</strong>';
    familySection.appendChild(familyHeading);
    const valueGrid = document.createElement("div");
    valueGrid.className = "simple-value-grid";
    field.values.forEach(value => {
      const button = document.createElement("button");
      const selected = selectedValues.has(String(value.id));
      button.type = "button";
      button.className = `simple-value-button value-${field.predicate}${selected ? " selected" : ""}`;
      button.dataset.family = field.predicate;
      button.dataset.value = value.id;
      button.setAttribute("aria-pressed", String(selected));
      button.title = value.label;
      if(field.predicate === "role"){
        button.innerHTML = `<span class="simple-role-swatch simple-type-swatch" style="--role-color:${SIMPLE_ROBOT_COLOR}">${icon("robot", "simple-role-icon")}${robotTypeMark(value.id, "simple-type-letter")}</span><span>${value.label}</span>`;
      }else{
        button.innerHTML = `<span class="simple-role-swatch simple-type-swatch" style="--role-color:${SIMPLE_ROBOT_COLOR}">${icon("robot", "simple-role-icon")}<span class="robot-type-letter simple-type-letter simple-movement-mark">${value.symbol || MOVEMENT_ARROWS[value.id] || value.id}</span></span><span>${value.label}</span>`;
      }
      button.onclick = () => toggleSimpleValue(field, value);
      valueGrid.appendChild(button);
    });
    familySection.appendChild(valueGrid);
    familySections.appendChild(familySection);
  });
  editor.appendChild(familySections);

  box.appendChild(editor);

  const count = $("rule-count");
  if(count) count.textContent = `${state.valueCount} value${state.valueCount === 1 ? "" : "s"}`;
  const runButton = $("run");
  if(runButton) runButton.disabled = false;
  renderRuleMatchPreview();
  buildTabs();
}

function renderRules(){
  if(SIMPLE_FAMILY_RULE_LANGUAGE){
    renderSimpleRuleEditor();
    return;
  }
  const box = $("rules");
  box.innerHTML = "";
  $("rule-count").textContent = `${rules.filter(rule => rule.conds.length > 0).length} active`;
  if(rules.length === 0){
    box.innerHTML = "";
  }

  const displayRules = rules
    .map((rule, sourceIndex) => ({rule, sourceIndex}))
    .sort((a, b) => Number(a.rule.conds.length > 0) - Number(b.rule.conds.length > 0));
  let activeRuleNumber = 0;

  displayRules.forEach(({rule, sourceIndex}) => {
    if(rule.conds.length > 0 && activeRuleNumber === 0){
      const label = document.createElement("div");
      label.className = "rule-group-label";
      label.textContent = "Active rules";
      box.appendChild(label);
    }
    if(rule.conds.length > 0 && activeRuleNumber > 0){
      const separator = document.createElement("div");
      separator.className = "rule-or-separator";
      separator.textContent = "OR";
      separator.setAttribute("aria-label", "or");
      box.appendChild(separator);
    }
    const ruleLabel = rule.conds.length === 0
      ? ""
      : `Rule ${++activeRuleNumber}`;
    const card = document.createElement("div");
    card.className = "rule";

    const header = document.createElement("div");
    header.className = "rule-header";
    header.innerHTML = ruleLabel ? `<strong>${ruleLabel}</strong>` : "";
    const actions = document.createElement("div");
    actions.className = "rule-actions";
    const duplicate = document.createElement("button");
    duplicate.className = "duplicate-rule";
    duplicate.textContent = "Duplicate";
    duplicate.title = rule.conds.length
      ? "Copy this rule and change one condition"
      : "Add a condition before duplicating";
    duplicate.disabled = !rule.conds.length;
    duplicate.onclick = () => duplicateRuleForEdit(rule, sourceIndex);
    actions.appendChild(duplicate);
    const save = document.createElement("button");
    save.className = "save-rule";
    save.textContent = "Save to library";
    if(!rule.conds.length) save.classList.add("needs-condition");
    save.title = rule.conds.length
      ? "Save this rule for reuse in another task"
      : "Add a complete condition before saving";
    save.onclick = () => saveRuleToLibrary(rule, sourceIndex);
    actions.appendChild(save);

    const del = document.createElement("button");
    del.className = "del";
    del.textContent = "×";
    del.title = "Remove rule";
    del.setAttribute("aria-label", "Remove rule");
    del.onclick = () => {
      recordRuleEvent("rule_removed", {rule_id:rule.id, rule_index:sourceIndex});
      rules.splice(sourceIndex, 1);
      renderRules();
    };
    actions.appendChild(del);
    header.appendChild(actions);
    card.appendChild(header);

    const actionLine = document.createElement("div");
    actionLine.className = "rule-action-line";
    actionLine.innerHTML = CLEAN_RULE_LANGUAGE
      ? '<strong>A ROBOT WAITS</strong>'
      : '<span class="kw2">FORBID</span><strong>MOVE INTO A SQUARE</strong>';
    card.appendChild(actionLine);

    const conditions = document.createElement("div");
    conditions.className = "condition-list";
    rule.conds.forEach((cond, ci) => {
      const row = document.createElement("div");
      row.className = "condition-row";
      const join = document.createElement("span");
      join.className = "condition-join";
      join.textContent = ci === 0 ? "WHEN" : "AND";
      row.appendChild(join);

      const edit = document.createElement("button");
      edit.className = "condition-sentence";
      edit.textContent = conditionText(cond);
      edit.title = "Edit this condition";
      edit.onclick = () => {
        rule.editor = {
          conditionIndex:ci,
          object:cond.object,
          property:cond.property,
          value:cond.v,
        };
        recordRuleEvent("condition_editor_opened", {rule_id:rule.id, condition_index:ci, mode:"edit"});
        renderRules();
      };
      row.appendChild(edit);

      const remove = document.createElement("button");
      remove.className = "condition-remove";
      remove.textContent = "×";
      remove.title = "Delete this condition";
      remove.onclick = () => {
        recordRuleEvent("condition_removed", {
          rule_id:rule.id,
          condition_index:ci,
          condition:conditionPayload(cond),
        });
        rule.conds.splice(ci, 1);
        rule.editor = null;
        renderRules();
      };
      row.appendChild(remove);
      conditions.appendChild(row);
    });
    card.appendChild(conditions);

    if(!rule.editor && rule.conds.length < MAX_RULE_CONDITIONS){
      const add = document.createElement("button");
      add.className = "add-condition";
      add.textContent = "+ Add condition";
      add.onclick = () => {
        rule.editor = emptyConditionEditor();
        recordRuleEvent("condition_editor_opened", {rule_id:rule.id, condition_index:null, mode:"add"});
        renderRules();
      };
      card.appendChild(add);
    }

    renderConditionEditor(rule, card);
    box.appendChild(card);
  });
  renderLibrary();
  buildTabs();
}

function renderLegend(){
  const activeAgents = scn.agents.filter(agent => agent.active);
  const legendAgents = SIMPLE_FAMILY_RULE_LANGUAGE
    ? [...new Map(activeAgents.map(agent => [agent.role, agent])).values()]
    : activeAgents;
  const robotTiles = legendAgents.map(agent => {
    const symbol = agentAvatar(agent, "legend-robot-avatar");
    return SIMPLE_FAMILY_RULE_LANGUAGE
      ? `<div class="legend-tile robot-identity-tile" data-robot-type="${agent.role}">${symbol}<span class="legend-copy"><strong>${ROLE_ZH[agent.role] || agent.role}</strong><small>Robot type</small></span></div>`
      : `<div class="legend-tile robot-identity-tile" data-agent-id="${agent.id}">${symbol}<span class="legend-copy"><strong>Robot ${agentDisplayId(agent.id)}</strong><small>${ROLE_ZH[agent.role] || agent.role}</small></span></div>`;
  }).join("");

  const chargingTile = SIMPLE_FAMILY_RULE_LANGUAGE
    ? legendTile(
        '<span class="legend-target-sample" style="--agent-color:#2d70b3"><span>1</span></span>',
        "Numbered charging bay",
        "Robot 1 goes to Bay 1",
        "charging-bay-tile",
      )
    : "";

  const markerTiles = [...new Set(Object.values(scn.machines).map(machine => machine.marker || "plain"))]
    .map(marker => legendTile(
      `<span class="machine-sample marker-${marker}">${icon("machine")}</span>`,
      marker === "plain" ? "Exit" : `${marker[0].toUpperCase() + marker.slice(1)} exit`,
      marker === "plain" ? "One robot can enter at a time" : "",
      `machine-tile marker-${marker}`,
    ));
  const passageTile = Object.keys(scn.passages).length
    ? legendTile(
        passageMapSample("legend-symbol"),
        "Narrow passage",
        "",
        "passage-tile",
      )
    : "";
  const legend = $("legend");
  if(legend) legend.innerHTML = `<section class="map-key compact-map-key" aria-labelledby="map-key-title"><h3 class="map-key-title" id="map-key-title">Key</h3><div class="legend-grid essential-key">${robotTiles}${chargingTile}${passageTile}${markerTiles.join("")}</div></section>`;
  const conditionLines = RULE_SCHEMA.map(object => {
    const fields = object.properties.map(property =>
      `${property.label}: ${property.values.map(value => value.label).join(" / ")}`
    );
    return `${object.label} — ${fields.join("; ")}`;
  });
  const atomicPredicateCount = RULE_SCHEMA.reduce(
    (sum, object) => sum + object.properties.reduce(
      (objectSum, property) => objectSum + property.values.length,
      0
    ),
    0
  );
  $("vocab").innerHTML = [
    `<div class="vocab-summary">${CLEAN_RULE_LANGUAGE ? "Waiting-rule" : "Typed MOVE-rule"} space · ${atomicPredicateCount} positive conditions · up to ${MAX_RULE_CONDITIONS} conditions</div>`,
    `<details class="vocab-detail"><summary>Show typed fields</summary><div>${conditionLines.join("<br>")}<br>Runs on this page = human attempts.</div></details>`
  ].join("");
  renderRuleMatchPreview();
}

function ruleSummary(){
  if(SIMPLE_FAMILY_RULE_LANGUAGE) return simpleRuleSentence();
  const active = rules.filter(r => r.conds.length > 0);
  if(active.length === 0) return "(no rules)";
  return active.map(ruleText).join("; ");
}

function ruleJson(sourceRules=rules){
  if(SIMPLE_FAMILY_RULE_LANGUAGE){
    const state = simpleRuleState(sourceRules);
    if(!state.valueCount) return [];
    return [{
      rule_id:"shared_waiting_rule",
      representation:state.representation,
      family:state.representation === "pure_movement"
        ? "move_dir"
        : state.representation === "pure_type" ? "role" : "mixed",
      movement_values:state.movement.map(value => value.id),
      role_values:state.role.map(value => value.id),
      movement_mask:state.movementMask,
      role_mask:state.roleMask,
      selected_value_count:state.valueCount,
      within_family_join:"OR",
      between_family_join:"OR",
      text:simpleRuleSentence(sourceRules),
    }];
  }
  return sourceRules
    .filter(r => r.conds.length > 0)
    .map(r => ({
      rule_id:r.id,
      source_library_id:r.sourceLibraryId || null,
      action:"MOVE",
      literals:r.conds.map(c => ({
        object:c.object,
        property:c.property,
        predicate:c.p,
        value:c.v,
        label:displayCondition(r, c),
      })),
    }));
}

function renderLog(){
  const el = $("log");
  if(runs.length === 0){ el.innerHTML = ""; return; }
  let html = '<h4>Run log (human attempts = ' + runs.length + ')</h4>';
  runs.forEach(r => {
    html += '<div class="logrow"><span class="n">' + r.global_attempt_index + '</span><span class="log-main"><strong>' +
      r.shift_label + '</strong> · ' + r.rule_summary + '<span class="reason">' + r.reason_text + '</span></span><span class="res ' +
      (r.ok ? "ok" : "bad") + '">' + (r.ok ? "Success" : "Fail") + '</span></div>';
  });
  el.innerHTML = html;
}

function setStatus(text, kind){
  const status = $("status");
  status.textContent = text;
  status.className = "status" + (kind ? " " + kind : "");
  $("run")?.removeAttribute("aria-describedby");
  if(kind !== "run-guidance-only") $("run")?.classList.remove("is-guided");
}

function showFirstRunGuidance(){
  const visible = taskMode === "task" && curIndex === 0 && shiftStates[scn.id].attempts === 0;
  $("run")?.classList.toggle("is-guided", visible);
  if(!visible){
    if($("status").classList.contains("run-guidance-only")) setStatus("", "");
    return;
  }
  setStatus("", "run-guidance-only");
  $("status").innerHTML = `<span class="run-guide-character" aria-hidden="true">${icon("robot", "run-guide-robot")}<span class="run-guide-arm"></span></span><span class="run-guide-bubble" id="first-run-guide-message">Try <strong>Run</strong> first.</span>`;
  $("run")?.setAttribute("aria-describedby", "first-run-guide-message");
  if(!window.StudyData?.snapshot().events.some(event =>
    event.event_type === "task_run_guidance_shown" && event.detail?.guidance_id === "t1-robot-run-v1")){
    window.StudyData?.record("task_run_guidance_shown", {
      guidance_id:"t1-robot-run-v1", animation:"robot-pointing-and-run-pulse",
      message:"Try Run first.", placement:"above-run-button",
    });
  }
}

function feedbackCellType(cell){
  if(!cell) return "square";
  if(Object.values(scn.machines).some(machine => sameCell(machine.cell, cell))){
    return "exit";
  }
  if(scn.mergeCells.has(K(cell[0], cell[1]))) return "shared square";
  if(scn.passageCells.has(K(cell[0], cell[1]))) return "narrow passage";
  const zone = scn.zones[K(cell[0], cell[1])];
  if(zone === "cold") return "cold-storage area";
  return "route square";
}

function feedbackAgent(id){
  if(SIMPLE_FAMILY_RULE_LANGUAGE){
    const agent = scn.agents.find(row => String(row.id) === String(id));
    return `Robot ${agentTargetNumber(agent)} (${ROLE_ZH[agent?.role] || agent?.role || "unknown type"})`;
  }
  return `Robot ${agentDisplayId(id)}`;
}

function lastWaitingFrame(result){
  return [...(result.frames || [])].reverse().find(frame =>
    Object.values(frame.agents || {}).some(agent => agent.waiting)
  ) || null;
}

const FEEDBACK_DIRECTIONS = {
  N:"\u2191", NE:"\u2197", E:"\u2192", SE:"\u2198",
  S:"\u2193", SW:"\u2199", W:"\u2190", NW:"\u2196",
};

function feedbackMove(id, frame){
  const agent = scn.agents.find(row => String(row.id) === String(id));
  const direction = frame?.agents?.[String(id)]?.intent?.dir || agent?.movementArrow;
  if(!direction) return feedbackAgent(id);
  return SIMPLE_FAMILY_RULE_LANGUAGE
    ? `${feedbackAgent(id)} (${FEEDBACK_DIRECTIONS[direction] || direction})`
    : `${feedbackAgent(id)} moving ${FEEDBACK_DIRECTIONS[direction] || direction}`;
}

function feedbackRuleMatches(result, frame, ids, passageContested=false){
  const norms = result.testedNorms || [];
  return Object.fromEntries(ids.map(id => {
    const intent = frame?.agents?.[String(id)]?.intent;
    const agent = scn.agents.find(row => String(row.id) === String(id));
    if(!intent || !agent) return [String(id), []];
    const ctx = {
      world:scn,
      agent,
      action:"MOVE",
      cell:intent.cell,
      moveDir:intent.dir,
      plannedTurn:null,
      item:null,
      machine:null,
      contested:true,
      passageContested,
    };
    return [String(id), norms
      .filter(norm => matchesNorm(norm, ctx))
      .map((norm, index) => norm.feedbackLabel || `Rule ${index + 1}`)];
  }));
}

function joinedMoves(ids, frame){
  return ids.map(id => feedbackMove(id, frame)).join(" and ");
}

function uniqueRuleLabels(matches, ids){
  return [...new Set(ids.flatMap(id => matches[String(id)] || []))];
}

function ruleStopExplanation(matches, ids, frame){
  const stoppedByRule = new Map();
  ids.forEach(id => {
    (matches[String(id)] || []).forEach(label => {
      const stopped = stoppedByRule.get(label) || [];
      stopped.push(id);
      stoppedByRule.set(label, stopped);
    });
  });
  return [...stoppedByRule.entries()]
    .map(([label, stopped]) => `${label} stops ${joinedMoves(stopped, frame)}`)
    .join("; ");
}

function buildRunFeedback(result){
  const frame = result.frames?.[result.frames.length - 1] || null;
  if(SIMPLE_FAMILY_RULE_LANGUAGE){
    const active = scn.agents.filter(agent => agent.active);
    const reached = active.filter(agent => frame?.agents?.[agent.id]?.done).length;
    const waiting = studyBothWaitingFeedback(scn, result, result.testedNorms || [], agent => agentTargetNumber(agent));
    if(waiting) return {title:`${reached}/${active.length} robots arrived`, observation:waiting, kind:"bad"};
    return {
      title:result.ok ? "Success" : "Not complete",
      observation:`${reached}/${active.length} robots reached their charging bays in this Run.`,
      kind:result.ok ? "ok" : "bad",
    };
  }
  const event = frame?.event || null;
  const step = frame?.tick ?? Math.max(0, (result.frames?.length || 1) - 1);
  const ids = event?.agents || (event?.agent !== undefined ? [event.agent] : []);
  const robots = SIMPLE_FAMILY_RULE_LANGUAGE
    ? joinedMoves(ids, frame)
    : ids.map(id => feedbackAgent(id, frame)).join(" and ");
  const square = feedbackCellType(event?.cell);

  if(result.ok){
    return {
      title:"Success",
      observation:SIMPLE_FAMILY_RULE_LANGUAGE
        ? "Every robot reached its assigned charging bay."
        : "Every robot reached its matching target.",
      kind:"ok",
    };
  }

  if(result.reason?.startsWith("pollution:")){
    const robotNames = ids.map(id => feedbackAgent(id)).join(" and ");
    return {
      title:"Something went wrong",
      observation:`At step ${step}, ${robotNames} carried a spill into the ${square}, so that area was contaminated. Use the step buttons to look back at the move.`,
      kind:"bad",
    };
  }
  if(result.reason === "collision" || result.reason === "resource-conflict"){
    const matches = feedbackRuleMatches(result, frame, ids);
    const matchedRules = uniqueRuleLabels(matches, ids);
    if(square === "exit"){
      const coverage = matchedRules.length
        ? `${matchedRules.join(" and ")} did not leave one robot free to enter first.`
        : `None of your current rules covered ${joinedMoves(ids, frame)}, so neither robot waited.`;
      return {
        title:"This exit has an entry order",
        observation:`At step ${step}, ${robots} tried to enter the exit together. ${coverage} Change the rule so one robot waits while the other enters first.`,
        kind:"bad",
      };
    }
    const coverage = matchedRules.length
      ? "Your rule did not let one robot move first."
      : "Your rule matched neither robot, so neither waited.";
    return {
      title:"Collision at the shared square",
      observation:`Step ${step}: ${robots} arrived together. ${coverage}`,
      kind:"bad",
    };
  }
  if(result.reason === "passage-conflict"){
    const matches = feedbackRuleMatches(result, frame, ids, true);
    const matchedRules = uniqueRuleLabels(matches, ids);
    const hasPassageRule = (result.testedNorms || []).some(hasPassageCondition);
    let diagnosis;
    if(!hasPassageRule){
      diagnosis = "Your current rules do not name the narrow passage, so they cannot decide who waits at its entrances.";
    }else if(!matchedRules.length){
      diagnosis = `Your narrow-passage rule did not match ${joinedMoves(ids, frame)}.`;
    }else{
      diagnosis = `${matchedRules.join(" and ")} did not leave exactly one entrance free.`;
    }
    return {
      title:"The narrow passage was not resolved",
      observation:`At step ${step}, ${robots} entered from opposite ends. ${diagnosis} Adjust a narrow-passage rule so one robot waits at the entrance.`,
      kind:"bad",
    };
  }
  if(result.reason === "lane-blocked"){
    const blocker = event?.blocking_agent !== undefined
      ? feedbackMove(event.blocking_agent, frame)
      : "The robot at the near destination";
    const traveler = event?.moving_agent !== undefined
      ? feedbackMove(event.moving_agent, frame)
      : "the other robot";
    return {
      title:"The wrong robot went first",
      observation:`${blocker} went first and stopped at the near destination, blocking ${traveler}. Your rule selected the wrong robot to wait.`,
      kind:"bad",
    };
  }
  if(result.reason === "priority-violation"){
    const entrant = event?.agent !== undefined ? feedbackAgent(event.agent, frame) : "A robot";
    const waitingIds = ids.filter(id => String(id) !== String(event?.agent));
    const matches = feedbackRuleMatches(result, frame, ids);
    const waitingMove = waitingIds.length ? feedbackMove(waitingIds[0], frame) : "the other robot";
    const waitingRules = uniqueRuleLabels(matches, waitingIds);
    const cause = waitingRules.length
      ? `${waitingRules.join(" and ")} made ${waitingMove} wait, so ${entrant} entered first.`
      : `${entrant} entered first because the other robot was stopped.`;
    return {
      title:"The exit received the wrong robot first",
      observation:`At step ${step}, ${cause} This exit requires the opposite order, so change which approach waits.`,
      kind:"bad",
    };
  }
  if(result.reason === "no-plan"){
    return {
      title:"One robot has no way through",
      observation:`With these rules, ${feedbackAgent(result.blockedAgent)} cannot find a route to its destination. A rule may be stopping more moves than you intended.`,
      kind:"bad",
    };
  }
  if(result.reason === "timeout"){
    const waitingFrame = lastWaitingFrame(result);
    const waitingIds = Object.entries(waitingFrame?.agents || {})
      .filter(([, meta]) => meta.waiting)
      .map(([id]) => id);
    const waitingRobots = waitingIds.map(id => feedbackAgent(id, waitingFrame)).join(" and ");
    const matches = feedbackRuleMatches(result, waitingFrame, waitingIds);
    const matchedRules = uniqueRuleLabels(matches, waitingIds);
    const stoppedByRules = ruleStopExplanation(matches, waitingIds, waitingFrame);
    const targetCell = waitingFrame?.agents?.[waitingIds[0]]?.intent?.cell;
    const target = feedbackCellType(targetCell);
    const cause = matchedRules.length
      ? `At the ${target}, ${stoppedByRules}.`
      : `${waitingRobots || "The robots"} are repeatedly being stopped at the ${target}.`;
    return {
      title:"Both robots are being told to wait",
      observation:`${cause} Neither robot can enter, so the task cannot continue.`,
      kind:"bad",
    };
  }
  if(result.reason === "machine-order"){
    return {
      title:"The exit was not open",
      observation:`At step ${step}, ${robots} tried to enter the exit too soon. Look back one step to see what needed to happen first.`,
      kind:"bad",
    };
  }
  return {
    title:"This run did not work yet",
    observation:`${reasonText(result.reason, result)} Use the step buttons to inspect the last move, then adjust your rules and try again.`,
    kind:"bad",
  };
}

function setRunFeedback(result, showSuccess=true){
  const status = $("status");
  const feedback = buildRunFeedback(result);
  status.className = `status run-feedback ${feedback.kind}`;
  status.replaceChildren();
  const title = document.createElement("strong");
  title.className = "feedback-title";
  title.textContent = feedback.title;
  const observation = document.createElement("span");
  if(SIMPLE_FAMILY_RULE_LANGUAGE) observation.className = "run-arrival-summary";
  observation.textContent = feedback.observation;
  status.append(title, observation);
  if(!result.ok && !SIMPLE_FAMILY_RULE_LANGUAGE){
    const active = scn.agents.filter(agent => agent.active);
    const finalAgents = result.frames?.at(-1)?.agents || {};
    const reached = active.filter(agent => finalAgents[agent.id]?.done).length;
    const progress = document.createElement("span");
    progress.className = "run-arrival-summary";
    progress.textContent = ` (${reached}/${active.length} robots arrived this run)`;
    title.append(progress);
  }
  updateContinueButton();
  if(result?.ok && showSuccess && taskMode === "task"){
    if(curIndex === TASKS.length - 1) showTaskCompletionDialog();
    else showTaskSuccessDialog();
  }
  return feedback;
}

function updateContinueButton(){
  const runButton = $("run");
  if(runButton){
    runButton.textContent = lastResult?.ok ? "Run again" : "Run rule";
    runButton.classList.toggle("primary", !lastResult?.ok);
    runButton.classList.toggle("secondary-run", !!lastResult?.ok);
  }
}

function closeTaskSuccessDialog(){
  if(taskSuccessTimer !== null){
    clearTimeout(taskSuccessTimer);
    taskSuccessTimer = null;
  }
  clearSuccessConfetti();
  const dialog = $("task-success-dialog");
  if(dialog?.open) dialog.close();
}

function clearSuccessConfetti(){
  if(successConfettiTimer !== null) clearTimeout(successConfettiTimer);
  successConfettiTimer = null;
  successConfettiLayer?.getAnimations({subtree:true}).forEach(animation => animation.cancel());
  successConfettiLayer?.remove();
  successConfettiLayer = null;
}

function showSuccessConfetti(dialog){
  const run = runs.at(-1);
  if(!dialog || !run?.ok || !run.run_id) return;
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if(window.StudyData?.snapshot().events.some(event =>
    event.event_type === "task_success_confetti_shown" && event.detail?.run_id === run.run_id)) return;
  const count = renderSuccessConfetti(dialog, innerWidth, innerHeight);
  window.StudyData?.record("task_success_confetti_shown", {
    run_id:run.run_id, completed_trial_index:curIndex + 1,
    animation:"pixel-popup-confetti-v2", animated:!reducedMotion,
    particle_count:count, duration_ms:920,
  });
}

// Draws the success confetti into container over a width x height area and
// returns the particle count. The guided tutorial reuses it for "Good job".
function renderSuccessConfetti(container, width, height){
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  clearSuccessConfetti();
  const layer = document.createElement("div");
  layer.className = "task-success-confetti";
  layer.setAttribute("aria-hidden", "true");
  container.appendChild(layer);
  successConfettiLayer = layer;
  const colors = ["#2670d5", "#13966c", "#e0ac26", "#df5987", "#24a1ab", "#e5743d"];
  const count = 168;
  const particleScale = Math.min(1, Math.max(.65, width / 800));
  // Deterministic decoration leaves the experiment's random state untouched.
  for(let index=0; index<count; index++){
    const particle = document.createElement("span");
    particle.className = `task-success-confetti-piece${index % 5 === 0 ? " is-spark" : ""}`;
    particle.style.color = colors[(Math.floor(index/2) + index*3) % colors.length];
    const size = Math.round((index % 5 === 0 ? 8 : 12 + (index % 3) * 4) * particleScale);
    particle.style.width = `${size}px`;
    particle.style.height = `${size}px`;
    particle.style.setProperty("--confetti-pixel-size", `${size}px`);
    layer.appendChild(particle);
    const side = index % 2 ? 1 : -1;
    const spread = ((index * 47 + 23) % 173) / 173;
    const lift = ((index * 31 + 11) % 61) / 61;
    const fall = ((index * 23 + 7) % 67) / 67;
    const startX = width * (side < 0 ? .28 : .72) + ((index*7)%19 - 9)*2;
    const startY = height * (.73 + (index % 7)*.008);
    const endX = 12 + spread * (width - 24);
    const rise = height * (.32 + lift*.45);
    const endY = height * (.78 + fall*.28);
    const frames = Array.from({length:16}, (_, step) => {
      const t = step / 15;
      const x = Math.round(startX + (endX-startX)*Math.min(1,t*1.6));
      const y = Math.round(startY + (endY-startY)*t - 4*rise*t*(1-t));
      return {transform:`translate(${x}px, ${y}px)`, opacity:step === 0 || step === 15 ? 0 : 1,
        offset:t, easing:"steps(1, end)"};
    });
    if(reducedMotion){
      particle.style.transform = frames[6].transform;
      particle.style.opacity = "1";
    }else{
      particle.animate(frames, {duration:860, delay:(index % 6)*12, fill:"both"});
    }
  }
  successConfettiTimer = setTimeout(clearSuccessConfetti, 950);
  return count;
}

function showTaskSuccessDialog(){
  const dialog = $("task-success-dialog");
  const completedIndex = curIndex;
  const nextTask = TASKS[completedIndex + 1];
  if(!dialog || dialog.open || !nextTask || !taskUnlocked(nextTask)) return;
  const runId = runs.at(-1)?.run_id || null;
  recordRuleEvent("task_success_dialog_shown", {
    run_id:runId,
    completed_trial_index:curIndex + 1,
  });
  dialog.showModal();
  showSuccessConfetti(dialog);
  recordRuleEvent("task_auto_advance_scheduled", {
    run_id:runId,
    source_shift_id:scn.id,
    target_shift_id:nextTask.id,
    delay_ms:1000,
  });
  taskSuccessTimer = setTimeout(() => {
    taskSuccessTimer = null;
    closeTaskSuccessDialog();
    if(curIndex !== completedIndex || !shiftStates[scn.id].lastOk) return;
    recordRuleEvent("task_success_auto_advanced", {
      run_id:runId,
      completed_trial_index:completedIndex + 1,
      target_shift_id:nextTask.id,
    });
    switchTask(completedIndex + 1);
    $("run").focus();
  }, 1000);
}

async function saveBeforeDebrief(){
  const status = $("task-complete-save-status");
  const retry = $("task-complete-retry");
  const continueButton = $("task-complete-debrief");
  if(status) status.textContent = "Saving your responses...";
  if(retry) retry.hidden = true;
  if(continueButton) continueButton.disabled = true;
  const result = await window.StudyData?.flush({attempts:3});
  if(result?.ok || result?.local_only){
    if(status){
      status.textContent = result.local_only ? "" : "Your responses have been saved.";
    }
    if(continueButton){
      continueButton.disabled = false;
      continueButton.focus();
    }
    return;
  }
  if(status) status.textContent = "We could not save your responses. Check your connection and try again.";
  if(retry){
    retry.hidden = false;
    retry.focus();
  }
}

function showTaskCompletionDialog(){
  const backdrop = $("task-complete-backdrop");
  if(!backdrop) return;
  if(!completionDialogOpen){
    completionDialogOpen = true;
    recordRuleEvent("task_sequence_completed", {
      completed_tasks:TASKS.length,
      assigned_condition:URL_PARAMS.get("assigned_condition"),
    });
  }
  backdrop.hidden = false;
  showSuccessConfetti(backdrop.querySelector(".task-complete-dialog"));
  saveBeforeDebrief();
}

function closeNotice(){
  const backdrop = $("notice-backdrop");
  if(backdrop) backdrop.hidden = true;
}

function showNotice(message){
  const backdrop = $("notice-backdrop");
  const text = $("notice-message");
  if(!backdrop || !text) return;
  text.textContent = message;
  backdrop.hidden = false;
  $("notice-close")?.focus();
}

function updateFrameButtons(){
  const prev = $("prev");
  const next = $("next");
  const label = $("step-label");
  if(!prev || !next) return;
  const enabled = lastFrames.length > 0;
  prev.disabled = !enabled || frameIndex <= 0;
  next.disabled = !enabled || frameIndex >= lastFrames.length - 1;
  if(label){
    label.textContent = enabled ? frameStepLabel(frameIndex) : "Ready";
  }
}

function frameStepLabel(index){
  if(!lastFrames.length || index <= 0) return "Start";
  const frame = lastFrames[index];
  const total = lastFrames.length - 1;
  const waiting = Object.values(frame?.agents || {}).some(agent => agent.waiting);
  const failed = frame?.event && frame.event.type !== "machine-complete";
  if(lastResult?.ok && index === total) return `Finish · ${index}/${total}`;
  if(failed) return `Conflict · ${index}/${total}`;
  if(waiting) return `Wait · ${index}/${total}`;
  return `Move · ${index}/${total}`;
}

function showFrameAt(index, updateStatus=true, source="automatic"){
  if(!lastFrames.length) return;
  frameIndex = Math.max(0, Math.min(index, lastFrames.length - 1));
  renderFrame(lastFrames[frameIndex]);
  if(taskMode === "task") window.StudyData?.record("task_simulation_step", {
    source,
    frame_index:frameIndex,
    frame_total:lastFrames.length - 1,
    frame:lastFrames[frameIndex],
    run_index:runs.length,
    run_id:runs.at(-1)?.run_id || null,
  });
  persistTaskProgress();
  if(updateStatus){
    if(lastResult && frameIndex === lastFrames.length - 1){
      setRunFeedback(lastResult, false);
    }else{
      setStatus(frameIndex === 0
        ? "Start: every robot is ready to follow its shortest route."
        : `${frameStepLabel(frameIndex)}: use the arrows to inspect what happened.`, "");
    }
  }
}

function currentNorms(){
  return rules
    .map((rule, index) => ({rule, index}))
    .filter(({rule}) => rule.conds.length > 0)
    .map(({rule, index}) => ({
      action:"MOVE",
      feedbackLabel:SIMPLE_FAMILY_RULE_LANGUAGE ? "Your current rule" : `Rule ${index + 1}`,
      conds:rule.conds.map(condition => ({
        p:condition.p,
        v:condition.v,
        negated:!!condition.negated,
      })),
    }));
}

function observedFailedEncounterIds(result){
  if(result?.ok) return [];
  const explicit = (result?.failedEncounterIds || []).map(id => String(id));
  if(explicit.length) return [...new Set(explicit)];
  const event = result?.frames?.[result.frames.length - 1]?.event || null;
  const agentIds = event?.agents || (
    event?.agent !== undefined ? [event.agent] : []
  );
  return [...new Set(agentIds
    .map(id => scn.agents.find(agent => String(agent.id) === String(id))?.moduleId)
    .filter(id => id !== null && id !== undefined)
    .map(id => String(id)))];
}

function libraryNorms(){
  return library
    .filter(entry => entry.rule && entry.rule.conds && entry.rule.conds.length > 0)
    .map(entry => ({
      action:"MOVE",
      conds:entry.rule.conds.map(condition => ({
        p:condition.p,
        v:condition.v,
        negated:!!condition.negated,
      })),
    }));
}

function play(trigger="manual"){
  if(taskMode === "tutorial"){
    playTutorialRun(trigger);
    return;
  }
  if(!isPureFamilyRulebook(rules, activeRuleFamily)){
    window.StudyData?.record("run_rejected", {reason:"mixed-or-invalid-rule", active_rule_family:activeRuleFamily});
    setStatus("Choose a rule using one feature only.", "bad");
    return;
  }
  const runGuidanceVisible = $("run").classList.contains("is-guided");
  stopTaskAnimation("new-run");
  const runButton = $("run");
  if(runButton){
    runButton.textContent = "Run rule";
    runButton.classList.add("primary");
    runButton.classList.remove("secondary-run", "is-guided");
  }
  const norms = currentNorms();
  const runId = window.crypto?.randomUUID?.() || `${PARTICIPANT_CODE}-${runs.length+1}-${Date.now()}`;
  activeRunId = runId;
  window.StudyData?.setContext({
    trial_index:curIndex + 1,
    task_id:scn.id,
    task_item_id:scn.itemId,
    attempt_index:shiftStates[scn.id].attempts + 1,
    rulebook_revision:rulebookRevision,
  });
  const startedEvent = window.StudyData?.record("run_started", {
    run_id:runId,
    run_guidance_visible:runGuidanceVisible,
    completion_protocol:RUN_COMPLETION_PROTOCOL,
    completed_agent_ids_before:[],
    active_rule_family:activeRuleFamily,
    rule_state:ruleMetricsState(),
    trigger,
    rule_summary:ruleSummary(),
    rule_json:ruleJson(),
  });
  // Local continuation applies within this Run; every encounter starts fresh.
  const completedBefore = new Set();
  const result = CONTINUATION_CONDITION === "local"
    ? simulateLocalContinuation(scn, norms, completedBefore)
    : studyGlobalResult(scn, norms);
  result.testedNorms = norms.map(norm => ({
    action:norm.action,
    feedbackLabel:norm.feedbackLabel,
    conds:norm.conds.map(condition => ({...condition})),
  }));
  const availableBefore = new Set(unlockedTasks().map(task => task.id));
  const shiftState = shiftStates[scn.id];
  shiftState.visited = true;
  shiftState.lastOk = result.ok;
  shiftState.testedRevision = rulebookRevision;
  shiftState.attempts += 1;
  if(!FREE_ORDER && result.ok){
    const newlyUnlocked = unlockedTasks().filter(task => !availableBefore.has(task.id));
    if(newlyUnlocked.length){
      result.curriculumMessage =
        `Task complete. Available next: ${newlyUnlocked.map(task => task.label).join(", ")}.`;
      newlyUnlocked.forEach(task => recordRuleEvent("shift_unlocked", {
        unlocked_shift_id:task.id,
        unlocked_shift_index:TASKS.indexOf(task),
        unlocked_by_shift_id:scn.id,
      }));
    }else if(unlockedTasks().length === TASKS.length &&
             TASKS.every(task => shiftStates[task.id].lastOk)){
      result.curriculumMessage = "Curriculum complete.";
    }
  }
  lastResult = result;
  lastFrames = result.frames || [];
  frameIndex = 0;
  const now = Date.now();
  const feedback = buildRunFeedback(result);
  const simpleState = SIMPLE_FAMILY_RULE_LANGUAGE ? simpleRuleState() : null;
  const popcount = value => {let n=0;for(;value;value&=value-1)n++;return n;};
  const edits = ruleEvents.slice(lastRuleEventIndex).filter(event => event.type === "rule_value_added" || event.type === "rule_value_removed");
  const previous = [...runs].reverse().find(run => run.shift_id === scn.id);
  const record = {
    run_id:runId,
    run_guidance_visible:runGuidanceVisible,
    participant_code: PARTICIPANT_CODE,
    experiment_version:RAW_LIBRARY.experiment_version || 2,
    schedule:RAW_LIBRARY.schedule || null,
    editor_condition:EDITOR_CONDITION,
    curriculum_branch:activeTaskBranch,
    continuation_condition:CONTINUATION_CONDITION,
    run_trigger:trigger,
    completion_protocol:RUN_COMPLETION_PROTOCOL,
    shift_id: scn.id,
    rule_editor_protocol:RULE_EDITOR_PROTOCOL,
    active_rule_family:activeRuleFamily,
    family_draft_state:familyDraftMetrics(),
    family_switches_since_last_run:ruleEvents.slice(lastRuleEventIndex).filter(event => event.type === "rule_family_changed").length,
    task_item_id:scn.itemId,
    shift_label: scn.label,
    shift_attempt_index:shiftState.attempts,
    global_attempt_index:runs.length + 1,
    rulebook_revision:rulebookRevision,
    rule_summary: ruleSummary(),
    rule_json: ruleJson(),
    rule_representation:simpleState?.representation || null,
    movement_values:simpleState?.movement.map(value => value.id) || [],
    role_values:simpleState?.role.map(value => value.id) || [],
    movement_mask:simpleState?.movementMask ?? null,
    role_mask:simpleState?.roleMask ?? null,
    selected_value_count:simpleState?.valueCount ?? null,
    trial_start_rule:trialStartRule,
    movement_hamming_from_trial_start:popcount(simpleState.movementMask ^ trialStartRule.movement_mask),
    type_hamming_from_trial_start:popcount(simpleState.roleMask ^ trialStartRule.role_mask),
    hamming_from_previous_run:previous ? popcount(simpleState.movementMask ^ previous.movement_mask) + popcount(simpleState.roleMask ^ previous.role_mask) : null,
    value_edits_since_last_run:edits.length,
    visible_trial_ms:startedEvent?.visible_context_ms ?? null,
    time_to_first_run_ms:shiftState.attempts === 1 ? now-trialStartedAt : null,
    active_rule_ids:rules.map(rule => rule.id),
    active_library_rule_ids:rules.map(rule => rule.sourceLibraryId).filter(Boolean),
    saved_library_rule_ids:library.map(entry => entry.id),
    ok: result.ok,
    reason: result.reason,
    reason_text: reasonText(result.reason, result),
    feedback_observation:feedback.observation,
    curriculum_message:result.curriculumMessage || null,
    frames: result.frames,
    agent_report: result.frames.length ? result.frames[result.frames.length - 1].agents : {},
    completed_agent_ids_before:[...completedBefore],
    completed_agent_ids_after:result.completedAgentIds || [],
    newly_completed_agent_ids:result.newlyCompletedIds || [],
    failed_encounter_ids:observedFailedEncounterIds(result),
    encounter_results:result.encounterResults || [],
    time_from_trial_start_ms: now - trialStartedAt,
    time_from_experiment_start_ms: now - experimentStartedAt,
    time_from_last_attempt_ms: now - lastAttemptAt,
    rule_construction_events: ruleEvents.slice(lastRuleEventIndex),
    timestamp: new Date(now).toISOString(),
  };
  runs.push(record);
  window.StudyData?.record("run_completed", record);
  for(const [type, condition] of [["first_type_rule_run", simpleState.roleMask > 0], ["first_mixed_rule_run", simpleState.representation === "mixed"], ["first_pure_type_rule_run", simpleState.representation === "pure_type"]]){
    if(condition && !window.StudyData?.snapshot().events.some(event => event.event_type === type)) window.StudyData?.record(type, {run_id:runId, rule_state:ruleMetricsState()});
  }
  lastRuleEventIndex = ruleEvents.length;
  lastAttemptAt = now;
  renderLog();
  buildTabs();

  if(lastFrames.length) showFrameAt(0, false, "run-start");
  setStatus("Running...", "");
  timer = setInterval(() => {
    if(frameIndex < lastFrames.length - 1){
      showFrameAt(frameIndex + 1, false, "automatic");
    }
    if(frameIndex >= lastFrames.length - 1){
      clearInterval(timer);
      timer = null;
      window.StudyData?.record("run_animation_completed", {run_id:runId, frame_total:lastFrames.length-1});
      activeRunId = null;
      persistTaskProgress();
      setRunFeedback(result);
    }
  }, 360);
  persistTaskProgress();
}

function resetBoard(){
  stopTaskAnimation("board-reset");
  lastResult = null;
  lastFrames = [];
  frameIndex = 0;
  buildBoard();
  setStatus("Ready to replay this rule from the start.", "");
  updateFrameButtons();
  updateContinueButton();
  window.StudyData?.record("task_board_reset", {
    run_index:runs.length,
    rulebook_revision:rulebookRevision,
  });
  persistTaskProgress();
}

function download(name, mime, content){
  const blob = new Blob([content], { type:mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

function exportJson(){
  const payload = {
    participant_code:PARTICIPANT_CODE,
    experiment_version:RAW_LIBRARY.experiment_version || null,
    schedule:RAW_LIBRARY.schedule || null,
    editor_condition:EDITOR_CONDITION,
    curriculum_branch:activeTaskBranch,
    continuation_condition:CONTINUATION_CONDITION,
    tutorial:window.tutorialReport || null,
    study_data:window.StudyData?.snapshot() || null,
    rule_events:ruleEvents,
    runs,
  };
  download("norm-task-log.json", "application/json", JSON.stringify(payload, null, 2));
}

function exportCsv(){
  const cols = ["participant_code","experiment_version","schedule","editor_condition","shift_id","task_item_id","shift_label","curriculum_branch","continuation_condition","run_trigger","shift_attempt_index","global_attempt_index","rulebook_revision","rule_representation","movement_values","role_values","movement_mask","role_mask","selected_value_count","active_rule_ids","active_library_rule_ids","saved_library_rule_ids","ok","reason","feedback_observation","rule_summary","time_from_trial_start_ms","time_from_experiment_start_ms","time_from_last_attempt_ms","timestamp"];
  const esc = v => '"' + String(v ?? "").replaceAll('"', '""') + '"';
  const rows = [cols.join(",")].concat(runs.map(r => cols.map(c => esc(r[c])).join(",")));
  download("norm-task-log.csv", "text/csv", rows.join("\n") + "\n");
}

function startTaskAfterTutorial(){
  const screen = $("tutorial-screen");
  if(screen) screen.hidden = true;
  document.body.classList.remove("tutorial-active");
  document.querySelector(".wrap")?.removeAttribute("aria-hidden");
  const startTime = Date.now();
  experimentStartedAt = startTime;
  trialStartedAt = startTime;
  lastAttemptAt = startTime;
  lastRuleEventIndex = ruleEvents.length;
  window.scrollTo(0, 0);
  if(scn.starter_rulebook?.length){
    setStatus("A starter rule is set. The outlined robot matches it. Run the rule.", "");
  }else if(SIMPLE_FAMILY_RULE_LANGUAGE && !simpleSelectedValues().length){
    setStatus("No waiting rule is selected. Run to see what happens, or choose a rule.", "");
  }
  showFirstRunGuidance();
  if(shouldAutoShowGuide(scn)){
    setTimeout(() => showSceneGuide(), 0);
  }
}

function initializeTutorial(){
  if(SIMPLE_FAMILY_RULE_LANGUAGE){
    if(SKIP_TUTORIAL || !window.ResearchTutorial?.startSimple){
      startTaskAfterTutorial();
      return;
    }
    window.ResearchTutorial.startSimple({
      log:recordRuleEvent,
      onComplete:startTaskAfterTutorial,
      startAt:ONBOARDING_STAGE,
    });
    return;
  }
  const screen = $("tutorial-screen");
  if(!screen || !window.ResearchTutorial){
    startTaskAfterTutorial();
    return;
  }
  window.ResearchTutorial.start({
    log:recordRuleEvent,
    onComplete:startTaskAfterTutorial,
  });
}

// Runs the tutorial scene with the real simulator and animation. Nothing is
// added to runs or shiftStates; the guide hears about the result instead.
let tutorialRunListener = null;
function playTutorialRun(trigger){
  stopTaskAnimation("new-run");
  const runButton = $("run");
  if(runButton){
    runButton.textContent = "Run rule";
    runButton.classList.add("primary");
    runButton.classList.remove("secondary-run", "is-guided");
  }
  const norms = currentNorms();
  const result = simulateLocalContinuation(scn, norms, new Set());
  result.testedNorms = norms.map(norm => ({
    action:norm.action,
    feedbackLabel:norm.feedbackLabel,
    conds:norm.conds.map(condition => ({...condition})),
  }));
  lastResult = result;
  lastFrames = result.frames || [];
  frameIndex = 0;
  if(lastFrames.length) showFrameAt(0, false, "run-start");
  setStatus("Running...", "");
  timer = setInterval(() => {
    if(frameIndex < lastFrames.length - 1){
      showFrameAt(frameIndex + 1, false, "automatic");
    }
    if(frameIndex >= lastFrames.length - 1){
      clearInterval(timer);
      timer = null;
      const feedback = setRunFeedback(result);
      tutorialRunListener?.(result, feedback, trigger);
    }
  }, 360);
}

function tutorialRuleState(){
  const drafts = currentFamilyDrafts();
  return {
    family:activeRuleFamily,
    values:Object.fromEntries(Object.entries(drafts).map(([family, draft]) =>
      [family, simpleSelectedValues(draft, family).map(value => value.id)])),
  };
}

function tutorialNorms(state){
  const field = simpleField(state.family);
  return (state.values?.[state.family] || []).map(id => ({
    action:"MOVE",
    feedbackLabel:"Your current rule",
    conds:[{p:field.predicate, v:id, negated:false}],
  }));
}

// The guided tutorial draws with this board and rule panel through TaskHost.
window.TaskHost = Object.freeze({
  get mode(){ return taskMode; },
  get cellSize(){ return CELL; },
  enterTutorialMode(){
    stopTaskAnimation("tutorial-start");
    taskMode = "tutorial";
    document.body.classList.add("task-tutorial-mode");
    buildTabs();
  },
  showScene(rawScene){
    stopTaskAnimation("tutorial-scene");
    scn = normalizeTask(structuredClone(rawScene));
    lastResult = null;
    lastFrames = [];
    frameIndex = 0;
    buildBoard();
    renderRuleMatchPreview();
    updateContinueButton();
    setStatus("", "");
  },
  sceneId(){ return scn?.id || null; },
  // A number shows that frame of the last run; an object is drawn as given.
  showFrame(frame){
    if(typeof frame === "number") showFrameAt(frame, true, "tutorial");
    else renderFrame(frame);
  },
  currentFrame(){ return lastFrames[frameIndex] || initialFrame(); },
  frameInfo(){ return {index:frameIndex, total:Math.max(0, lastFrames.length - 1), running:timer !== null}; },
  resetRun(){
    stopTaskAnimation("tutorial-reset");
    lastResult = null;
    lastFrames = [];
    frameIndex = 0;
    renderFrame(initialFrame());
    renderRuleMatchPreview();
    updateContinueButton();
    setStatus("", "");
  },
  showRunEnd(){
    stopTaskAnimation("tutorial-show-end");
    const result = window.TaskHost.simulate(null, tutorialRuleState());
    lastResult = result;
    lastFrames = result.frames || [];
    showFrameAt(lastFrames.length - 1, true, "tutorial");
    return result;
  },
  run(){ play("guide"); },
  renderRuleEditor(){ renderRules(); },
  getRuleState(){ return tutorialRuleState(); },
  setRuleState(state){
    stopTaskAnimation("tutorial-rule-state");
    const drafts = {move_dir:[], role:[]};
    for(const family of Object.keys(drafts)){
      const field = simpleField(family);
      drafts[family] = (state.values?.[family] || []).map(id => {
        const value = field.values.find(option => String(option.id) === String(id));
        return {id:nextRuleId++, action:"MOVE", conds:[simpleCondition(field, value)], editor:null};
      });
    }
    familyRuleDrafts = drafts;
    activeRuleFamily = state.family || "role";
    rules = structuredClone(familyRuleDrafts[activeRuleFamily]);
    renderRules();
  },
  onRuleChange(callback){ tutorialRuleListener = callback; },
  onRunComplete(callback){ tutorialRunListener = callback; },
  // Pure: simulate a scene (or the current tutorial scene) under a {family, values} rule.
  simulate(rawScene, state){
    const scene = rawScene ? normalizeTask(structuredClone(rawScene)) : scn;
    const norms = tutorialNorms(state);
    const result = simulateLocalContinuation(scene, norms, new Set());
    result.testedNorms = norms;
    return result;
  },
  runFeedback(result){ return buildRunFeedback(result); },
  confetti(container, width, height){ return renderSuccessConfetti(container, width, height); },
  fitViewport(){ fitTaskViewport(); },
});

function renderAll(){
  buildTabs();
  renderSceneGoal();
  buildBoard();
  renderRules();
  renderLegend();
  renderLog();
  updateContinueButton();
  fitTaskViewport();
}

function fitTaskViewport(){
  const viewport = $("task-viewport");
  const shell = $("task-scale-shell");
  const task = document.querySelector(".wrap");
  if(!viewport || !shell || !task) return;
  const availableWidth = Math.max(320, viewport.clientWidth - 16);
  const availableHeight = Math.max(320, viewport.clientHeight - 16);
  const fittedScale = Math.min(
    1,
    availableWidth / TASK_LOGICAL_WIDTH,
    availableHeight / TASK_LOGICAL_HEIGHT,
  );
  const scale = Math.max(TASK_MIN_SCALE, fittedScale);
  shell.style.width = `${TASK_LOGICAL_WIDTH * scale}px`;
  shell.style.height = `${TASK_LOGICAL_HEIGHT * scale}px`;
  task.style.transform = `scale(${scale})`;
  viewport.dataset.taskScale = scale.toFixed(4);
}

function resizeTaskLayout(){
  if(viewportResizeTimer) clearTimeout(viewportResizeTimer);
  viewportResizeTimer = setTimeout(() => {
    viewportResizeTimer = null;
    fitTaskViewport();
  }, 120);
}

window.addEventListener("pagehide", () => {stopTaskAnimation("page-hidden"); persistTaskProgress();});

// After comprehension is passed: leave tutorial mode and open T1 as v23 does,
// with the practice rule from the guided tutorial carried in.
function enterTaskAfterGuidedOnboarding(){
  stopTaskAnimation("tutorial-complete");
  clearSuccessConfetti();
  taskMode = "task";
  tutorialRuleListener = null;
  tutorialRunListener = null;
  document.body.classList.remove("task-tutorial-mode");
  window.StudyData?.setStage("task");
  scn = TASKS[curIndex];
  activeRuleFamily = "role";
  familyRuleDrafts = {move_dir:[], role:[]};
  lastResult = null;
  lastFrames = [];
  frameIndex = 0;
  window.StudyData?.setContext({
    trial_index:curIndex + 1,
    task_id:scn.id,
    task_item_id:scn.itemId,
    attempt_index:shiftStates[scn.id].attempts,
    rulebook_revision:rulebookRevision,
  });
  rules = loadStarterRules(scn);
  carryPracticeRuleIntoFirstTask();
  trialStartRule = ruleMetricsState();
  renderAll();
  startTaskAfterTutorial();
  recordTaskEntry("initial");
  persistTaskProgress();
}

(async function initializeTask(){
if(!await window.StudyData?.ready || !window.StudyData.requireStage("task")) return;
const restored = restoreTaskProgress();
if(!TASKS.length){
  setStatus("Could not find data/tasks.generated.js. Run python3 solver/task_generator.py first.", "bad");
}else{
  const researcherPanel = $("researcher-panel");
  if(researcherPanel) researcherPanel.hidden = !DEBUG_UI;
  $("run").onclick = () => play("manual");
  $("prev").onclick = () => showFrameAt(frameIndex - 1, true, "manual");
  $("next").onclick = () => showFrameAt(frameIndex + 1, true, "manual");
  $("guide-close").onclick = closeSceneGuide;
  $("guide-backdrop").onclick = event => {
    if(event.target.id === "guide-backdrop") closeSceneGuide();
  };
  $("notice-close").onclick = closeNotice;
  $("notice-backdrop").onclick = event => {
    if(event.target.id === "notice-backdrop") closeNotice();
  };
  $("task-complete-retry").onclick = saveBeforeDebrief;
  $("task-success-dialog").addEventListener("cancel", event => event.preventDefault());
  $("task-complete-debrief").onclick = async () => {
    const button = $("task-complete-debrief");
    if(button.disabled) return;
    button.disabled = true;
    button.textContent = "Opening debrief...";
    recordRuleEvent("debrief_navigation_activated");
    await window.StudyData?.navigate("debrief.html");
  };
  document.addEventListener("keydown", event => {
    if(event.key === "Escape") {
      closeSceneGuide();
      closeNotice();
    }
  });
  window.addEventListener("resize", resizeTaskLayout);
  $("addrule").onclick = () => {
    if(SIMPLE_FAMILY_RULE_LANGUAGE) return;
    const rule = { id:nextRuleId++, action:"MOVE", conds:[], editor:null };
    rules.push(rule);
    recordRuleEvent("rule_added", {rule_id:rule.id, rule_index:rules.length - 1});
    renderRules();
  };
  $("export-json").onclick = exportJson;
  $("export-csv").onclick = exportCsv;
  window.StudyData?.init({
    stage:"task",
    trial_index:curIndex + 1,
    task_id:scn.id,
    task_item_id:scn.itemId,
    attempt_index:shiftStates[scn.id].attempts,
    rulebook_revision:rulebookRevision,
  });
  window.StudyData?.record("experimental_assignment_loaded", window.EXPERIMENT_ASSIGNMENT || {});
  const onboardingPhase = restored || SKIP_GUIDED_TUTORIAL || !window.GuidedTutorial
    ? "task" : window.GuidedTutorial.phase();
  if(onboardingPhase !== "task"){
    // T1 is entered (and recorded) only after the tutorial and comprehension.
    taskReady = true;
    window.TaskHost.enterTutorialMode();
    renderAll();
    window.ShufflePreview.install();
    window.GuidedTutorial.start({host:window.TaskHost, phase:onboardingPhase,
      onFinished:enterTaskAfterGuidedOnboarding});
    return;
  }
  if(!restored){
    rules = loadStarterRules(scn);
    carryPracticeRuleIntoFirstTask();
  }
  trialStartRule ||= ruleMetricsState();
  taskReady = true;
  renderAll();
  window.ShufflePreview.install();
  if(restored){
    window.StudyData.record("task_progress_restored", {run_count:runs.length, rule_state:ruleMetricsState(),
      completed_agent_ids:[], completion_protocol:RUN_COMPLETION_PROTOCOL});
    if(lastFrames.length) showFrameAt(frameIndex, false, "restored");
    if(lastResult) setRunFeedback(lastResult);
    showFirstRunGuidance();
  }else if(SKIP_TUTORIAL) startTaskAfterTutorial();
  else initializeTutorial();
  recordTaskEntry(restored ? "reload" : "initial");
  persistTaskProgress();
}
})();
