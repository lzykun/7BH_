/* Formal entry router with server-side randomized block assignment. */
(function(){
"use strict";

const params = new URLSearchParams(window.location.search);
if(window.STUDY_CONFIG?.preview_only) params.set("preview", "1");
const recruitmentId = params.get("PROLIFIC_PID") || params.get("participant_id") || null;
const version = window.SHARED_POOL?.version;
if(params.get("preview") !== "1") history.replaceState(null, "", location.pathname);
const formalConditions = ["all-local", "jump-2", "jump-5"];
const armLabels = {
  "all-local":"all-local",
  "jump-2":"early-jump",
  "jump-5":"late-jump",
};
const contextKeys = [
  "session", "assigned_condition", "assignment_arm", "assignment_source",
  "schedule", "mode", "condition", "continuation", "order", "trial", "v",
  "completion_url", "completion_code", "session_token",
];
const pages = {
  consent:"routes/consent.html",
  reminder:"routes/reminder.html",
  instructions:"routes/tutorial.html",
  tutorial:"routes/tutorial.html",
  comprehension:"routes/comprehension.html",
  task:"routes/task.html",
  debrief:"routes/debrief.html",
  completion:"routes/completion.html",
};

function stripRecruitmentIdentifiers(){
  params.delete("PROLIFIC_PID");
  params.delete("participant_id");
  params.delete("participant");
}

function makeSessionId(){
  if(window.crypto?.randomUUID) return window.crypto.randomUUID();
  return "session-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 12);
}

function destination(){
  if(params.get("preview") !== "1" && location.protocol !== "file:") return pages.consent;
  const requested = params.get("stage");
  if(params.get("skipTutorial") === "1" || requested === "task") return pages.task;
  return pages[requested] || pages.consent;
}

function storeLaunchContext(){
  const context = {};
  for(const key of contextKeys){
    if(params.has(key)) context[key] = params.get(key);
  }
  const version = window.SHARED_POOL?.version || params.get("v") || "current";
  const key = "robot-study:active-context:" + version;
  let stored = false;
  for(const name of ["sessionStorage", "localStorage"]){
    try{
      const storage = window[name];
      storage?.setItem(key, JSON.stringify(context));
      stored = true;
    }catch(error){
      // Fall back to carrying the context in the URL.
    }
  }
  return stored;
}

function navigate(){
  const formal = params.get("preview") !== "1" && window.location.protocol !== "file:";
  const canUseCleanUrl = formal && storeLaunchContext();
  if(formal && !canUseCleanUrl){
    showError("Please enable browser storage, then try again.");
    return;
  }
  window.location.replace(
    canUseCleanUrl ? destination() : destination() + "?" + params.toString()
  );
}

function showError(message){
  const status = document.getElementById("assignment-status");
  const retry = document.getElementById("assignment-retry");
  if(status) status.textContent = message;
  if(retry) retry.hidden = false;
}

async function assign(){
  if(!params.get("session") && !recruitmentId){
    try{
      const key = "robot-study:active-context:" + version;
      const stored = JSON.parse(sessionStorage.getItem(key) || localStorage.getItem(key) || "null");
      if(stored?.session && stored.session_token) params.set("session", stored.session);
    }catch(error){ /* A new anonymous session is safe when no context exists. */ }
  }
  if(!params.get("session")) params.set("session", makeSessionId());
  const preview = params.get("preview") === "1";

  if(preview || window.location.protocol === "file:"){
    navigate();
    return;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), window.STUDY_CONFIG?.request_timeout_ms || 12000);
  try{
    const response = await fetch("assign_condition.php", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      credentials:"same-origin",
      signal:controller.signal,
      body:JSON.stringify({
        participant_id:recruitmentId,
        session_id:params.get("session"),
        experiment_version:window.SHARED_POOL?.version || params.get("v") || null,
      }),
    });
    if(!response.ok) throw new Error("HTTP " + response.status);
    const result = await response.json();
    if(!result.ok || !formalConditions.includes(result.condition) || !/^[a-f0-9]{64}$/.test(result.session_token || "")){
      throw new Error("Invalid assignment response");
    }
    params.set("assigned_condition", result.condition);
    params.set("session", result.session_id);
    params.set("session_token", result.session_token);
    params.set("assignment_arm", armLabels[result.condition]);
    params.set("assignment_source", "server-block");
    stripRecruitmentIdentifiers();
    navigate();
  }catch(error){
    showError("We could not start the study. Please check your connection and try again.");
  }finally{
    clearTimeout(timeout);
  }
}

document.getElementById("assignment-retry")?.addEventListener("click", () => {
  document.getElementById("assignment-retry").hidden = true;
  document.getElementById("assignment-status").textContent = "Preparing your study...";
  assign();
});

assign();
})();
