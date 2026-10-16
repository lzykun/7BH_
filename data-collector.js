/* Persistent event stream shared by every standalone experiment page. */
(function(){
"use strict";

const SCHEMA_VERSION = "2.0";
const WINDOW_NAME_PREFIX = "__ROBOT_STUDY_DATA__";
const MAX_KEEPALIVE_BYTES = 60000;
const params = new URLSearchParams(window.location.search);
// GitHub Pages previews never upload events, whatever the URL says.
const PAGES_PREVIEW_HOST = ["555bighamsome.github.io", "lzykun.github.io"]
  .includes(window.location.hostname);
if(window.STUDY_CONFIG?.preview_only || PAGES_PREVIEW_HOST) params.set("preview", "1");
const CONTEXT_KEYS = [
  "session", "assigned_condition", "assignment_arm", "assignment_source",
  "schedule", "mode", "condition", "continuation", "order", "trial", "v",
  "completion_url", "completion_code", "preview", "debug", "branch", "access", "session_token",
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
let database = null;
let databaseDurableIndex = 0;
let ownsSession = false;
let releaseLock = null;
let validLease = () => true;
let storageFailed = false;
let lastActivityTime = Date.now();
let visibleTime = 0;
let hiddenTime = 0;
let activityKey = null;
let wasVisible = !document.hidden;
const writes = new Set();
const inspections = new Map();

function uuid(){
  if(window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "session-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

function cleanId(value){
  const cleaned = String(value || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 80);
  return cleaned.length >= 8 ? cleaned : null;
}

function readActiveContext(){
  for(const name of ["sessionStorage", "localStorage"]){
    try{
      const storage = window[name];
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

function persistNavigationContext(){
  const context = {};
  for(const key of CONTEXT_KEYS){
    if(params.has(key)) context[key] = params.get(key);
  }
  let stored = false;
  for(const name of ["sessionStorage", "localStorage"]){
    try{
      const storage = window[name];
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
const endpoint = PAGES_PREVIEW_HOST ? null : (
  params.get("preview") === "1" || window.location.protocol === "file:" ? null : (
    document.querySelector('meta[name="study-data-endpoint"]')?.content ||
    (/^https?:$/.test(window.location.protocol) ? "record_result.php" : null)
  )
);

function storageCandidates(){
  const available = [];
  for(const name of ["localStorage", "sessionStorage"]){
    try{
      const candidate = window[name];
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

function readState(){
  let latest = null;
  for(const store of stores){
    try{
      const parsed = JSON.parse(store.getItem(storageKey) || "null");
      if(parsed?.session_id === sessionId && (!latest || parsed.next_event_index > latest.next_event_index ||
        (parsed.next_event_index === latest.next_event_index && parsed.acknowledged_event_index > latest.acknowledged_event_index))) latest = parsed;
    }catch(error){
      // Try the next persistence mechanism.
    }
  }
  return latest;
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
  if(database){
    // A small synchronous journal bridges a click immediately followed by reload.
    const {events, ...metadata} = state;
    const journal = JSON.stringify({...metadata, events:events.filter(event => event.event_index > databaseDurableIndex)});
    for(const store of stores){
      try{ store.setItem(storageKey + ":journal", journal); }catch(error){ /* IndexedDB remains primary. */ }
    }
    const transaction = database.transaction(["sessions", "events"], "readwrite");
    transaction.objectStore("sessions").put(metadata);
    const latest = events[events.length - 1];
    if(latest) transaction.objectStore("events").put(latest);
    const pending = new Promise(resolve => {
      transaction.oncomplete = () => {databaseDurableIndex = Math.max(databaseDurableIndex, latest?.event_index || 0); resolve(true);};
      transaction.onerror = transaction.onabort = () => {
        database?.close();
        database = null;
        persist();
        resolve(false);
      };
    });
    writes.add(pending);
    pending.finally(() => writes.delete(pending));
    return;
  }
  const serialized = JSON.stringify(state);
  let saved = false;
  for(const store of stores){
    try{
      store.setItem(storageKey, serialized);
      saved = true;
    }catch(error){
      // Try the remaining browser stores.
    }
  }
  if(!saved) storageWarning();
}

function storageWarning(){
  storageFailed = true;
  if(document.getElementById("study-storage-warning")) return;
  const warning = document.createElement("p");
  warning.id = "study-storage-warning";
  warning.setAttribute("role", "alert");
  warning.textContent = "Browser storage is unavailable. Keep this tab open and check your connection before continuing.";
  document.body.prepend(warning);
}

async function durable(){
  await Promise.all([...writes]);
  return !storageFailed;
}

function blockedSession(storageUnavailable=false){
  if(document.getElementById("study-session-blocked")) return;
  const dialog = document.createElement("section");
  dialog.id = "study-session-blocked";
  dialog.setAttribute("role", "alertdialog");
  dialog.innerHTML = '<h1>This study is open in another tab</h1><p>Continue in the original tab, or close it and reload this page.</p><button type="button">Reload</button>';
  if(storageUnavailable){
    dialog.querySelector("h1").textContent = "Browser storage is unavailable";
    dialog.querySelector("p").textContent = "Enable browser storage and reload this page to continue safely.";
  }
  for(const node of document.body.children) node.inert = true;
  document.body.append(dialog);
  dialog.querySelector("button").onclick = () => location.reload();
}

async function openDatabase(){
  if(!window.indexedDB) return;
  try{
    database = await new Promise((resolve, reject) => {
      const request = indexedDB.open("robot-study-events-v2", 1);
      request.onupgradeneeded = () => {
        request.result.createObjectStore("sessions", {keyPath:"session_id"});
        request.result.createObjectStore("events", {keyPath:"event_id"}).createIndex("session", "session_id");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Database blocked"));
    });
    const saved = await new Promise((resolve, reject) => {
      const transaction = database.transaction(["sessions", "events"], "readonly");
      const metadata = transaction.objectStore("sessions").get(sessionId);
      const events = transaction.objectStore("events").index("session").getAll(sessionId);
      transaction.oncomplete = () => resolve(metadata.result ? {...metadata.result, events:events.result.sort((a,b) => a.event_index-b.event_index)} : null);
      transaction.onerror = () => reject(transaction.error);
    });
    databaseDurableIndex = saved?.events.at(-1)?.event_index || 0;
    if(saved && saved.next_event_index >= state.next_event_index) state = saved;
    for(const store of stores){
      try{
        const journal = JSON.parse(store.getItem(storageKey + ":journal") || "null");
        if(journal?.session_id === sessionId && journal.next_event_index >= state.next_event_index){
          const merged = new Map(state.events.map(event => [event.event_id, event]));
          for(const event of journal.events || []) merged.set(event.event_id, event);
          state = {...journal, events:[...merged.values()].sort((a,b)=>a.event_index-b.event_index)};
        }
      }catch(error){ /* Ignore an unreadable journal; retain the database stream. */ }
    }
    if(state.events.length){
      const transaction = database.transaction(["sessions", "events"], "readwrite");
      const {events, ...metadata} = state;
      transaction.objectStore("sessions").put(metadata);
      for(const event of events) transaction.objectStore("events").put(event);
      await new Promise((resolve,reject) => {transaction.oncomplete = resolve; transaction.onerror = transaction.onabort = () => reject(transaction.error);});
      databaseDurableIndex = state.events.at(-1).event_index;
    }
    database.onversionchange = () => database.close();
  }catch(error){
    database = null;
    if(!stores.length) storageWarning();
  }
}

async function acquireSession(){
  const name = "robot-study:" + sessionId;
  if(navigator.locks){
    const acquired = await new Promise(resolve => {
      navigator.locks.request(name, {ifAvailable:true}, lock => {
        if(!lock){ resolve(false); return; }
        resolve(true);
        return new Promise(release => { releaseLock = release; });
      }).catch(() => resolve(false));
    });
    if(!acquired){ blockedSession(); return false; }
  }else{
    const owner = uuid();
    const key = name + ":lease";
    try{
      const current = JSON.parse(localStorage.getItem(key) || "null");
      if(current?.until > Date.now()){ blockedSession(); return false; }
      const heartbeat = () => {
        const lease = JSON.parse(localStorage.getItem(key) || "null");
        if(lease?.owner !== owner){clearInterval(interval); ownsSession=false; blockedSession(); return;}
        localStorage.setItem(key, JSON.stringify({owner, until:Date.now()+30000}));
      };
      localStorage.setItem(key, JSON.stringify({owner, until:Date.now()+30000}));
      if(JSON.parse(localStorage.getItem(key)).owner !== owner){ blockedSession(); return false; }
      const interval = setInterval(heartbeat, 10000);
      validLease = () => JSON.parse(localStorage.getItem(key) || "null")?.owner === owner;
      releaseLock = () => {
        clearInterval(interval);
        if(JSON.parse(localStorage.getItem(key) || "null")?.owner === owner) localStorage.removeItem(key);
      };
    }catch(error){
      if(endpoint){ blockedSession(true); return false; }
    }
  }
  ownsSession = true;
  state = readState() || state;
  await openDatabase();
  if(window.name.startsWith(WINDOW_NAME_PREFIX)) window.name = "";
  return true;
}

function workflow(){
  const has = type => state.events.some(event => event.event_type === type);
  const successful = new Set(state.events.filter(event => event.stage === "task" && event.event_type === "run_completed" && event.detail?.ok).map(event => event.trial_index));
  const count = window.SHARED_POOL?.sequences?.[params.get("schedule")]?.materials.length || window.STUDY_CONFIG.trial_count;
  const allTasks = Number.isInteger(count) && count > 0 &&
    Array.from({length:count}, (_, index) => index + 1).every(index => successful.has(index));
  return {consent:has("consent_agreed"), reminder:has("reminder_acknowledged"),
    tutorial:has("tutorial_completed"), comprehension:has("comprehension_passed"),
    tasks:allTasks && has("task_sequence_completed"), completed:has("study_completed")};
}

function requireStage(nextStage){
  if(!ownsSession) return false;
  if(!endpoint) return true;
  const progress = workflow();
  let destination = null;
  if(params.get("assignment_source") !== "server-block" || !params.get("session_token")) destination = "../index.html";
  else if(nextStage === "consent" && progress.consent){
    destination = !progress.reminder ? "reminder.html" : !progress.tasks ? "task.html" : "debrief.html";
  }
  else if(nextStage !== "consent" && !progress.consent) destination = "consent.html";
  else if(!["consent","reminder"].includes(nextStage) && !progress.reminder) destination = "reminder.html";
  // The guided tutorial and comprehension run on the task page, so it needs only the reminder.
  else if(["debrief","completion"].includes(nextStage) && (!progress.tutorial || !progress.comprehension)) destination = "task.html";
  else if(["debrief","completion"].includes(nextStage) && !progress.tasks) destination = "task.html";
  else if(nextStage === "completion" && !state.server_completed) destination = "debrief.html";
  if(destination){
    const next = new URL(destination, location.href);
    location.replace(next.href);
    return false;
  }
  return true;
}

function activity(){
  const now = Date.now();
  if(wasVisible) visibleTime += Math.max(0, now-lastActivityTime);
  else hiddenTime += Math.max(0, now-lastActivityTime);
  lastActivityTime = now;
  wasVisible = !document.hidden;
  const key = `${stage}:${context.trial_index || 0}:${context.task_item_id || ""}`;
  state.activity ||= {};
  if(activityKey){ state.activity[activityKey] = {visible:visibleTime, hidden:hiddenTime}; }
  if(activityKey !== key){
    activityKey = key;
    visibleTime = state.activity[key]?.visible || 0;
    hiddenTime = state.activity[key]?.hidden || 0;
  }
  return {visible_context_ms:visibleTime, hidden_context_ms:hiddenTime};
}

function saveCheckpoint(name, value){
  if(!ownsSession) return;
  state.checkpoints ||= {};
  state.checkpoints[name] = serializable(value);
  persist();
}

function checkpoint(name){ return serializable(state.checkpoints?.[name] || null); }

function sanitizedReferrer(){
  try{ return document.referrer ? new URL(document.referrer).origin : null; }
  catch(error){ return null; }
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
    deployment_id:window.STUDY_CONFIG?.deployment_id || null,
    completion_protocol:window.STUDY_CONFIG?.completion_protocol || null,
    rule_editor_protocol:window.STUDY_CONFIG?.rule_editor_protocol || null,
    tutorial_story_protocol:window.STUDY_CONFIG?.tutorial_story_protocol || null,
    retain_family_drafts:window.STUDY_CONFIG?.retain_family_drafts ?? null,
    material_bank_sha256:window.SHARED_POOL?.material_sha256 || null,
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

function record(eventType, detail={}, options={}){
  if(!ownsSession) return null;
  try{
    if(!validLease()){ownsSession=false; blockedSession(); return null;}
  }catch(error){ownsSession=false; blockedSession(true); return null;}
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
    ...activity(),
    detail:serializable(detail),
  };
  state.events.push(event);
  persist();
  if(!options.noAutoFlush && endpoint && workflow().consent && pendingEvents().length >= 10){
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
    session_token:params.get("session_token"),
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
    const controller = new AbortController();
    let status = null;
    const timeout = window.setTimeout(() => controller.abort(), window.STUDY_CONFIG?.request_timeout_ms || 12000);
    try{
      const response = await fetch(endpoint, {
        method:"POST",
        headers:{"Content-Type":"application/json"},
        body,
        credentials:"same-origin",
        keepalive,
        signal:controller.signal,
      });
      status = response.status;
      if(!response.ok) throw new Error("HTTP " + response.status);
      const result = await response.json();
      if(result?.ok !== true || result.received !== batch.length){
        throw new Error("Invalid acknowledgement from data receiver");
      }
      if(result.workflow_completed === true) state.server_completed = true;
      if(state.upload_problem_open){
        state.upload_problem_open = false;
        record("data_upload_recovered", {http_status:status}, {noAutoFlush:true});
      }
      return {ok:true, accepted:result.accepted, received:result.received};
    }catch(error){
      lastError = error;
      if(!state.upload_problem_open){
        state.upload_problem_open = true;
        record("data_upload_problem", {http_status:status, timeout:controller.signal.aborted,
          request_attempt:attempt, pending_count:pendingEvents().length}, {noAutoFlush:true});
      }
      if(attempt < attempts) await pause(300 * (2 ** (attempt - 1)));
    }finally{
      clearTimeout(timeout);
    }
  }
  return {ok:false, error:String(lastError)};
}

async function flushNow(options={}){
  if(!options.beacon) await durable();
  let pending = pendingEvents();
  if(!endpoint) return {ok:true, local_only:true, pending:pending.length};
  if(!workflow().consent) return {ok:false, not_consented:true, pending:pending.length};
  if(!pending.length) return {ok:true, local_only:false, pending:0, server_completed:!!state.server_completed};
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
    await durable();
    pending = pendingEvents();
  }
  return {ok:true, pending:0, server_completed:!!state.server_completed};
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
    server_completed:!!state.server_completed,
    storage_failed:storageFailed,
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
    "deployment_id","material_bank_sha256","visible_context_ms","hidden_context_ms",
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
  if(!endpoint){
    for(const [key, value] of params.entries()){
      if(key !== "stage" && key !== "skipTutorial" && key !== "session_token") next.searchParams.set(key, value);
    }
    next.searchParams.set("session", sessionId);
  }
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
    value:stage === "debrief" ? null : control.matches("input,select,textarea") ? control.value : null,
    family:control.dataset.family || null,
    rule_value:control.dataset.value || null,
    checked:control.matches('input[type="radio"],input[type="checkbox"]')
      ? control.checked : null,
  };
}

function bindGenericEvents(){
  document.addEventListener("click", event => {
    const control = controlDescriptor(event.target);
    if(control) record("ui_control_activated", {...control, input_method:event.detail === 0 ? "keyboard" : event.pointerType || "mouse"});
  }, true);
  document.addEventListener("change", event => {
    const control = controlDescriptor(event.target);
    if(control) record("ui_value_changed", control);
  }, true);
  document.addEventListener("visibilitychange", () => {
    finishInspections("visibility-change");
    record("page_visibility_changed", {visibility_state:document.visibilityState});
    if(document.hidden) flush({beacon:true});
  });
  window.addEventListener("focus", () => record("window_focused"));
  window.addEventListener("blur", () => record("window_blurred"));
  window.addEventListener("pagehide", () => {
    record("page_hidden", {time_on_page_ms:Date.now() - pageStartedAt});
    flush({beacon:true});
    releaseLock?.();
    ownsSession = false;
  });
  document.addEventListener("pointerover", event => beginInspection(event.target, "pointer"));
  document.addEventListener("pointerout", event => {
    const node = event.target.closest?.(".simple-value-button");
    if(node && node.contains(event.relatedTarget)) return;
    endInspection(event.target, "pointer", "leave");
  });
  document.addEventListener("focusin", event => beginInspection(event.target, "focus"));
  document.addEventListener("focusout", event => endInspection(event.target, "focus", "leave"));
  window.addEventListener("online", () => {record("connection_restored"); flush();});
  window.addEventListener("offline", () => record("connection_lost"));
  let resizeTimer;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => record("viewport_changed", {width:innerWidth,height:innerHeight}), 150);
  });
  window.addEventListener("pageshow", event => {if(event.persisted) location.reload();});
  const reportedErrors = new Set();
  window.addEventListener("error", event => {
    let source = null;
    const filename = event.filename || event.target?.src || event.target?.href;
    try{if(filename) source = new URL(filename, location.href).pathname.split("/").pop();}catch(error){ /* No filename available. */ }
    const key = `${source}:${event.lineno || 0}:${event.colno || 0}`;
    if(reportedErrors.has(key)) return;
    reportedErrors.add(key);
    record("interface_error", {kind:event.filename ? "runtime" : "resource", source_file:source,
      line:event.lineno || null, column:event.colno || null});
  }, true);
  window.addEventListener("unhandledrejection", () => record("interface_error", {kind:"unhandled_promise"}));
}

function beginInspection(target, source){
  const node = target.closest?.(".simple-value-button");
  if(!node || document.hidden) return;
  const key = `${source}:${node.dataset.family}:${node.dataset.value}`;
  if(!inspections.has(key)) inspections.set(key, {node, source, started:performance.now()});
}

function endInspection(target, source, reason){
  const node = target.closest?.(".simple-value-button");
  if(!node) return;
  const key = `${source}:${node.dataset.family}:${node.dataset.value}`;
  const inspection = inspections.get(key);
  if(!inspection) return;
  inspections.delete(key);
  const duration = Math.round(performance.now()-inspection.started);
  if(duration >= (window.STUDY_CONFIG?.inspection_min_ms || 150)) record("rule_value_inspected", {
    family:node.dataset.family, value:node.dataset.value, source, duration_ms:duration, end_reason:reason,
  });
}

function finishInspections(reason="editor-redraw"){
  for(const inspection of [...inspections.values()]) endInspection(inspection.node, inspection.source, reason);
}

function init(meta={}){
  if(!requireStage(meta.stage || stage)) return false;
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
    referrer_origin:sanitizedReferrer(),
    navigation_type:performance.getEntriesByType("navigation")[0]?.type || null,
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
  ready:acquireSession(),
  checkpoint,
  saveCheckpoint,
  workflow,
  requireStage,
  durable,
  finishInspections,
};
})();
