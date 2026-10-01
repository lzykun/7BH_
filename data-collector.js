/* Persistent event stream shared by every standalone experiment page. */
(function(){
"use strict";

const SCHEMA_VERSION = "1.0";
const WINDOW_NAME_PREFIX = "__ROBOT_STUDY_DATA__";
const MAX_KEEPALIVE_BYTES = 60000;
const params = new URLSearchParams(window.location.search);
// GitHub Pages previews never upload events, whatever the URL says.
const PAGES_PREVIEW_HOST = ["555bighamsome.github.io", "lzykun.github.io"]
  .includes(window.location.hostname);
const CONTEXT_KEYS = [
  "session", "assigned_condition", "assignment_arm", "assignment_source",
  "schedule", "mode", "condition", "continuation", "order", "trial", "v",
  "completion_url", "completion_code", "data_endpoint", "preview", "debug", "branch", "access",
];
const activeContextKey = "robot-study:active-context:" +
  (window.SHARED_POOL?.version || params.get("v") || "current");
const pageStartedAt = Date.now();
const pageStartedPerf = performance.now();
let stage = document.body?.dataset.stage || params.get("stage") || "unknown";
let context = {};
let flushTimer = null;
let activeFlush = null;
let initialized = false;

function uuid(){
  if(window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "session-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

function cleanId(value){
  const cleaned = String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return cleaned.length >= 8 ? cleaned : null;
}

function readActiveContext(){
  for(const storage of [window.sessionStorage, window.localStorage]){
    try{
      const parsed = JSON.parse(storage?.getItem(activeContextKey) || "null");
      if(parsed && typeof parsed === "object") return parsed;
    }catch(error){
      // Try the next browser storage mechanism.
    }
  }
  return null;
}

const storedContext = readActiveContext();
const incomingSession = cleanId(params.get("session"));
const storedSession = cleanId(storedContext?.session);
if(storedContext && (!incomingSession || incomingSession === storedSession)){
  for(const key of CONTEXT_KEYS){
    if(!params.has(key) && storedContext[key] !== undefined){
      params.set(key, String(storedContext[key]));
    }
  }
}

const sessionId = cleanId(params.get("session")) || uuid();
params.set("session", sessionId);
if(PAGES_PREVIEW_HOST) params.delete("data_endpoint");

function persistNavigationContext(){
  const context = {};
  for(const key of CONTEXT_KEYS){
    if(params.has(key)) context[key] = params.get(key);
  }
  let stored = false;
  for(const storage of [window.sessionStorage, window.localStorage]){
    try{
      storage?.setItem(activeContextKey, JSON.stringify(context));
      stored = true;
    }catch(error){
      // The long URL remains as a safe fallback when storage is unavailable.
    }
  }
  return stored;
}

function cleanVisibleUrl(){
  const formal = params.get("assignment_source") === "server-block";
  if(!formal || params.get("preview") === "1" || window.location.protocol === "file:") return;
  if(!persistNavigationContext()) return;
  history.replaceState(null, "", window.location.pathname + window.location.hash);
}

function syncParams(nextParams=params){
  if(nextParams !== params){
    for(const key of CONTEXT_KEYS) params.delete(key);
    for(const [key, value] of nextParams.entries()) params.set(key, value);
  }
  persistNavigationContext();
  return params;
}

persistNavigationContext();

const storageKey = "robot-study:" + sessionId;
const participantCode = sessionId;
const explicitEndpoint = PAGES_PREVIEW_HOST ? null : params.get("data_endpoint");
const endpoint = PAGES_PREVIEW_HOST ? null : explicitEndpoint || (
  params.get("preview") === "1" ? null : (
    document.querySelector('meta[name="study-data-endpoint"]')?.content ||
    (/^https?:$/.test(window.location.protocol) ? "record_result.php" : null)
  )
);

function storageCandidates(){
  const available = [];
  for(const candidate of [window.localStorage, window.sessionStorage]){
    try{
      const key = storageKey + ":probe";
      candidate.setItem(key, "1");
      candidate.removeItem(key);
      available.push(candidate);
    }catch(error){
      // Storage can be unavailable for file previews or privacy settings.
    }
  }
  return available;
}

const stores = storageCandidates();

function readWindowName(){
  if(!window.name.startsWith(WINDOW_NAME_PREFIX)) return null;
  try{
    const envelope = JSON.parse(window.name.slice(WINDOW_NAME_PREFIX.length));
    return envelope?.session_id === sessionId ? envelope : null;
  }catch(error){
    return null;
  }
}

function readState(){
  for(const store of stores){
    try{
      const parsed = JSON.parse(store.getItem(storageKey) || "null");
      if(parsed?.session_id === sessionId) return parsed;
    }catch(error){
      // Try the next persistence mechanism.
    }
  }
  return readWindowName();
}

let state = readState() || {
  schema_version:SCHEMA_VERSION,
  session_id:sessionId,
  participant_code:participantCode,
  created_at:new Date().toISOString(),
  created_at_ms:Date.now(),
  next_event_index:1,
  acknowledged_event_index:0,
  events:[],
};
state.participant_code = participantCode;
delete state.participant_id;
state.events = Array.isArray(state.events) ? state.events.map(event => {
  const cleaned = {...event, participant_code:participantCode};
  delete cleaned.participant_id;
  return cleaned;
}) : [];

function persist(){
  const serialized = JSON.stringify(state);
  for(const store of stores){
    try{
      store.setItem(storageKey, serialized);
    }catch(error){
      // The stream remains available through the other stores/window.name.
    }
  }
  try{
    window.name = WINDOW_NAME_PREFIX + serialized;
  }catch(error){
    // window.name is only a local-preview fallback.
  }
}

function serializable(value){
  if(value === undefined) return null;
  try{
    return JSON.parse(JSON.stringify(value, (key, item) => {
      if(item instanceof Set) return [...item];
      if(item instanceof Map) return Object.fromEntries(item);
      if(item instanceof Element) return {
        tag:item.tagName.toLowerCase(),
        id:item.id || null,
        name:item.getAttribute("name"),
      };
      return item;
    }));
  }catch(error){
    return {serialization_error:String(error)};
  }
}

function baseContext(){
  return {
    experiment_version:window.SHARED_POOL?.version || params.get("v") || null,
    assigned_condition:params.get("assigned_condition") || null,
    assignment_arm:params.get("assignment_arm") || null,
    assignment_source:params.get("assignment_source") || null,
    schedule:params.get("schedule") || null,
    condition:params.get("condition") || null,
    continuation:params.get("continuation") || null,
    mode:params.get("mode") || null,
    trial_index:context.trial_index ?? (
      Number.isFinite(Number(params.get("trial"))) ? Number(params.get("trial")) : null
    ),
    task_id:context.task_id || null,
    task_item_id:context.task_item_id || null,
    attempt_index:context.attempt_index ?? null,
    rulebook_revision:context.rulebook_revision ?? null,
  };
}

function record(eventType, detail={}){
  const now = Date.now();
  const eventIndex = state.next_event_index++;
  const event = {
    schema_version:SCHEMA_VERSION,
    event_id:sessionId + "-" + String(eventIndex).padStart(6, "0"),
    event_index:eventIndex,
    session_id:sessionId,
    participant_code:participantCode,
    event_type:eventType,
    stage,
    page:window.location.pathname.split("/").pop() || "index.html",
    timestamp:new Date(now).toISOString(),
    elapsed_session_ms:now - state.created_at_ms,
    elapsed_stage_ms:Math.round(performance.now() - pageStartedPerf),
    ...baseContext(),
    detail:serializable(detail),
  };
  state.events.push(event);
  persist();
  if(endpoint && state.events.length - state.acknowledged_event_index >= 10){
    scheduleFlush();
  }
  return event;
}

function setContext(next={}){
  context = {...context, ...serializable(next)};
}

function setStage(nextStage){
  stage = nextStage || stage;
  document.body.dataset.stage = stage;
}

function pendingEvents(){
  return state.events.filter(event =>
    event.event_index > (state.acknowledged_event_index || 0)
  );
}

function uploadPayload(events){
  return JSON.stringify({
    schema_version:SCHEMA_VERSION,
    session_id:sessionId,
    participant_code:participantCode,
    experiment_version:window.SHARED_POOL?.version || params.get("v") || null,
    events,
  });
}

function uploadBatch(events){
  let batch = events.slice(0, 200);
  while(batch.length > 1 && new Blob([uploadPayload(batch)]).size > MAX_KEEPALIVE_BYTES){
    batch = batch.slice(0, Math.ceil(batch.length / 2));
  }
  return batch;
}

function pause(milliseconds){
  return new Promise(resolve => window.setTimeout(resolve, milliseconds));
}

async function postBatch(batch, attempts){
  const body = uploadPayload(batch);
  const keepalive = new Blob([body]).size <= MAX_KEEPALIVE_BYTES;
  let lastError = null;
  for(let attempt = 1; attempt <= attempts; attempt += 1){
    try{
      const response = await fetch(endpoint, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body,
        credentials:"same-origin",
        keepalive,
      });
      if(!response.ok) throw new Error("HTTP " + response.status);
      const result = await response.json();
      if(result?.ok !== true || result.received !== batch.length){
        throw new Error("Invalid acknowledgement from data receiver");
      }
      return {ok:true, accepted:result.accepted, received:result.received};
    }catch(error){
      lastError = error;
      if(attempt < attempts) await pause(300 * (2 ** (attempt - 1)));
    }
  }
  return {ok:false, error:String(lastError)};
}

async function flushNow(options={}){
  let pending = pendingEvents();
  if(!endpoint) return {ok:true, local_only:true, pending:pending.length};
  if(!pending.length) return {ok:true, local_only:false, pending:0};
  if(options.beacon && navigator.sendBeacon){
    const batch = uploadBatch(pending);
    const queued = navigator.sendBeacon(
      endpoint,
      new Blob([uploadPayload(batch)], {type:"application/json"}),
    );
    return {ok:queued, beacon:true, pending:pending.length, queued:batch.length};
  }
  const attempts = Math.max(1, Math.min(3, Number(options.attempts) || 3));
  while(pending.length){
    const batch = uploadBatch(pending);
    const result = await postBatch(batch, attempts);
    if(!result.ok){
      return {ok:false, pending:pending.length, error:result.error};
    }
    state.acknowledged_event_index = Math.max(
      state.acknowledged_event_index || 0,
      batch[batch.length - 1].event_index,
    );
    persist();
    pending = pendingEvents();
  }
  return {ok:true, pending:0};
}

function flush(options={}){
  if(options.beacon) return flushNow(options);
  if(activeFlush) return activeFlush;
  activeFlush = flushNow(options).finally(() => {
    activeFlush = null;
  });
  return activeFlush;
}

function scheduleFlush(){
  if(flushTimer !== null) return;
  flushTimer = window.setTimeout(async () => {
    flushTimer = null;
    await flush();
  }, 800);
}

function snapshot(){
  return serializable({
    schema_version:SCHEMA_VERSION,
    session_id:sessionId,
    participant_code:participantCode,
    created_at:state.created_at,
    acknowledged_event_index:state.acknowledged_event_index || 0,
    endpoint:endpoint || null,
    events:state.events,
  });
}

function download(name, type, content){
  const url = URL.createObjectURL(new Blob([content], {type}));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function downloadJson(){
  download(sessionId + ".json", "application/json", JSON.stringify(snapshot(), null, 2));
}

function downloadJsonl(){
  const lines = state.events.map(event => JSON.stringify(event)).join("\n");
  download(sessionId + ".jsonl", "application/x-ndjson", lines + "\n");
}

function downloadCsv(){
  const columns = [
    "event_index","event_id","session_id","participant_code","event_type","stage",
    "page","timestamp","elapsed_session_ms","elapsed_stage_ms",
    "experiment_version","assigned_condition","assignment_arm","assignment_source","schedule","condition","continuation","mode",
    "trial_index","task_id","task_item_id","attempt_index","rulebook_revision","detail",
  ];
  const quote = value => '"' + String(value ?? "").replaceAll('"', '""') + '"';
  const rows = [columns.join(",")].concat(state.events.map(event =>
    columns.map(column => quote(
      column === "detail" ? JSON.stringify(event.detail) : event[column]
    )).join(",")
  ));
  download(sessionId + ".csv", "text/csv", rows.join("\n") + "\n");
}

async function navigate(fileName, options={}){
  record("stage_navigation", {from:stage, to:fileName});
  const upload = await flush({attempts:3});
  if(options.requireUpload && !upload.ok && !upload.local_only){
    return {...upload, navigated:false};
  }
  const next = new URL(fileName, window.location.href);
  persistNavigationContext();
  for(const [key, value] of params.entries()){
    if(key !== "stage" && key !== "skipTutorial") next.searchParams.set(key, value);
  }
  next.searchParams.set("session", sessionId);
  window.location.href = next.href;
  return {...upload, navigated:true};
}

function controlDescriptor(target){
  const control = target.closest?.("button,a,input,select,textarea");
  if(!control) return null;
  return {
    tag:control.tagName.toLowerCase(),
    id:control.id || null,
    name:control.getAttribute("name"),
    type:control.getAttribute("type"),
    value:control.matches("input,select,textarea") ? control.value : null,
    checked:control.matches('input[type="radio"],input[type="checkbox"]')
      ? control.checked : null,
  };
}

function bindGenericEvents(){
  document.addEventListener("click", event => {
    const control = controlDescriptor(event.target);
    if(control) record("ui_control_activated", control);
  }, true);
  document.addEventListener("change", event => {
    const control = controlDescriptor(event.target);
    if(control) record("ui_value_changed", control);
  }, true);
  document.addEventListener("visibilitychange", () => {
    record("page_visibility_changed", {visibility_state:document.visibilityState});
    if(document.hidden) flush({beacon:true});
  });
  window.addEventListener("focus", () => record("window_focused"));
  window.addEventListener("blur", () => record("window_blurred"));
  window.addEventListener("pagehide", () => {
    record("page_hidden", {time_on_page_ms:Date.now() - pageStartedAt});
    flush({beacon:true});
  });
}

function init(meta={}){
  setStage(meta.stage || stage);
  setContext(meta);
  if(initialized) return snapshot();
  initialized = true;
  if(state.events.length === 0){
    record("session_started", {
      user_agent:navigator.userAgent,
      viewport:{width:window.innerWidth, height:window.innerHeight},
    });
  }
  record("stage_loaded", {
    referrer:document.referrer || null,
    viewport:{width:window.innerWidth, height:window.innerHeight},
  });
  bindGenericEvents();
  cleanVisibleUrl();
  return snapshot();
}

window.StudyData = {
  init,
  record,
  setContext,
  setStage,
  flush,
  snapshot,
  pendingEvents,
  downloadJson,
  downloadJsonl,
  downloadCsv,
  navigate,
  params,
  syncParams,
  cleanVisibleUrl,
  sessionId,
  participantCode,
  endpoint,
};
})();
