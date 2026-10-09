/* Final questionnaire, confirmed upload, and completion code. */
(async function(){
"use strict";

const COMPLETION_CODE = "C1LALY4B";
const data = window.StudyData;
const params = data?.params || new URLSearchParams(window.location.search);
if(!await data?.ready || !data.init({stage:"debrief"})) return;
data?.record("debrief_viewed");

const form = document.getElementById("debrief-form");
const questionnaire = document.getElementById("debrief-questionnaire");
const completion = document.getElementById("debrief-completion");
const submit = document.getElementById("debrief-submit");
const saveStatus = document.getElementById("debrief-save-status");
const completionCode = document.getElementById("debrief-completion-code");
const completionStatus = document.getElementById("debrief-completion-status");
const copyButton = document.getElementById("debrief-copy");
const draftKey = "robot-study:debrief-draft:" + (data?.sessionId || "local");
const savedKey = "robot-study:debrief-saved:" + (data?.sessionId || "local");
let saving = false;
let lastRecordedAnswers = null;
let completionRecorded = data?.snapshot()?.events?.some(
  event => event.event_type === "study_completed",
) || false;

function responses(){
  return {
    age:Number(document.getElementById("debrief-age")?.value),
    gender:document.getElementById("debrief-gender")?.value || null,
    engagement:Number(document.getElementById("debrief-engagement")?.value),
    difficulty:Number(document.getElementById("debrief-difficulty")?.value),
    feature_use:document.getElementById("debrief-feature-use")?.value || null,
    strategy:(document.getElementById("debrief-strategy")?.value || "").trim(),
  };
}

function setFormDisabled(disabled){
  form?.querySelectorAll("input,select,textarea").forEach(control => {
    control.disabled = disabled;
  });
}

function updateSubmit(){
  if(!submit || !form) return;
  submit.disabled = saving || !form.checkValidity();
}

function saveDraft(){
  try{
    localStorage.setItem(draftKey, JSON.stringify(responses()));
  }catch(error){
    // The event stream remains the authoritative record after submission.
  }
}

function restoreDraft(){
  let draft = null;
  try{ draft = JSON.parse(localStorage.getItem(draftKey) || "null"); }
  catch(error){ return; }
  if(!draft) return;
  const values = {
    "debrief-age":draft.age,
    "debrief-gender":draft.gender,
    "debrief-engagement":draft.engagement,
    "debrief-difficulty":draft.difficulty,
    "debrief-feature-use":draft.feature_use,
    "debrief-strategy":draft.strategy,
  };
  for(const [id, value] of Object.entries(values)){
    const control = document.getElementById(id);
    if(control && value !== null && value !== undefined && value !== 0){
      control.value = String(value);
    }
  }
}

function markSaved(){
  try{
    localStorage.setItem(savedKey, "1");
    localStorage.removeItem(draftKey);
  }catch(error){
    // A successful server acknowledgement is sufficient without local storage.
  }
}

function alreadySaved(){
  try{ return localStorage.getItem(savedKey) === "1"; }
  catch(error){ return false; }
}

function showCompletion(){
  if(questionnaire) questionnaire.hidden = true;
  if(completion) completion.hidden = false;
  if(completionCode) completionCode.textContent = COMPLETION_CODE;
  if(completionStatus) completionStatus.textContent = data.endpoint ? "Your responses have been saved." : "Preview complete.";
  completion?.scrollIntoView({block:"start"});
}

function recordCompletion(answerSet){
  const signature = JSON.stringify(answerSet);
  if(signature !== lastRecordedAnswers){
    data?.record("debrief_responses_submitted", answerSet);
    lastRecordedAnswers = signature;
  }
  if(completionRecorded) return;
  data?.record("debrief_completed");
  data?.record("study_completed", {
    assigned_condition:params.get("assigned_condition"),
    assignment_arm:params.get("assignment_arm"),
    completion_code:COMPLETION_CODE,
  });
  completionRecorded = true;
}

form?.addEventListener("input", () => {
  saveDraft();
  updateSubmit();
});
form?.addEventListener("change", () => {
  saveDraft();
  updateSubmit();
});

form?.addEventListener("submit", async event => {
  event.preventDefault();
  if(saving || !form.checkValidity()){
    form.reportValidity();
    return;
  }
  saving = true;
  setFormDisabled(true);
  updateSubmit();
  submit.textContent = "Submitting...";
  if(saveStatus) saveStatus.textContent = "Uploading your responses...";

  recordCompletion(responses());
  const result = await data?.flush({attempts:3});
  if(result?.ok && (result.local_only || result.server_completed)){
    markSaved();
    showCompletion();
    return;
  }

  saving = false;
  setFormDisabled(false);
  submit.textContent = "Try again";
  if(saveStatus){
    saveStatus.textContent = "We could not confirm the upload. Check your connection and try again.";
  }
  updateSubmit();
});

copyButton?.addEventListener("click", async () => {
  try{
    await navigator.clipboard.writeText(COMPLETION_CODE);
    copyButton.textContent = "Copied";
  }catch(error){
    if(completionStatus) completionStatus.textContent = "Please select and copy the code manually.";
  }
});

restoreDraft();
updateSubmit();
if(alreadySaved() && (!data.endpoint || data.snapshot().server_completed)) showCompletion();
})();
