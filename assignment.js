/* Formal entry router with server-side randomized block assignment. */
(function(){
"use strict";

const params = new URLSearchParams(window.location.search);
const pagesPreviewHost = ["555bighamsome.github.io", "lzykun.github.io"]
  .includes(window.location.hostname);
const formalConditions = ["all-local", "jump-2", "jump-5"];
const armLabels = {
  "all-local":"all-local",
  "jump-2":"early-jump",
  "jump-5":"late-jump",
};
const contextKeys = [
  "session", "assigned_condition", "assignment_arm", "assignment_source",
  "schedule", "mode", "condition", "continuation", "order", "trial", "v",
  "completion_url", "completion_code", "data_endpoint",
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
  for(const storage of [window.sessionStorage, window.localStorage]){
    try{
      storage?.setItem(key, JSON.stringify(context));
      stored = true;
    }catch(error){
      // Fall back to carrying the context in the URL.
    }
  }
  return stored;
}

function navigate(){
  const canUseCleanUrl = params.get("preview") !== "1" &&
    window.location.protocol !== "file:" && storeLaunchContext();
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
  // On GitHub Pages, pages-preview.js reloads this page with preview=1;
  // never contact the assignment server from there.
  if(pagesPreviewHost && params.get("preview") !== "1") return;
  if(!params.get("session")) params.set("session", makeSessionId());
  const preview = params.get("preview") === "1";
  const carried = params.get("assigned_condition");
  const serverAssigned = params.get("assignment_source") === "server-block" &&
    formalConditions.includes(carried);

  if(preview || window.location.protocol === "file:"){
    navigate();
    return;
  }
  if(serverAssigned){
    stripRecruitmentIdentifiers();
    navigate();
    return;
  }

  try{
    const response = await fetch("assign_condition.php", {
      method:"POST",
      headers:{"Content-Type":"application/json"},
      credentials:"same-origin",
      body:JSON.stringify({
        participant_id:params.get("PROLIFIC_PID") || params.get("participant_id") || null,
        session_id:params.get("session"),
        experiment_version:window.SHARED_POOL?.version || params.get("v") || null,
      }),
    });
    if(!response.ok) throw new Error("HTTP " + response.status);
    const result = await response.json();
    if(!result.ok || !formalConditions.includes(result.condition)){
      throw new Error("Invalid assignment response");
    }
    params.set("assigned_condition", result.condition);
    params.set("assignment_arm", armLabels[result.condition]);
    params.set("assignment_source", "server-block");
    stripRecruitmentIdentifiers();
    navigate();
  }catch(error){
    showError("We could not start the study. Please check your connection and try again.");
  }
}

document.getElementById("assignment-retry")?.addEventListener("click", () => {
  document.getElementById("assignment-retry").hidden = true;
  document.getElementById("assignment-status").textContent = "Preparing your study...";
  assign();
});

assign();
})();
