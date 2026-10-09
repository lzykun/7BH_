/* Completion, final upload confirmation, and recruitment-platform return. */
(async function(){
"use strict";

const data = window.StudyData;
const params = data?.params || new URLSearchParams(window.location.search);
if(!await data?.ready || !data.init({stage:"completion"})) return;

const session = document.getElementById("completion-session");
if(session) session.textContent = data?.sessionId || "Unavailable";

const assignment = document.getElementById("completion-assignment");
if(assignment) assignment.textContent = params.get("assignment_arm") || "Unavailable";

const status = document.getElementById("completion-save-status");
const localTools = document.getElementById("completion-local-tools");
const retryButton = document.getElementById("completion-retry");
const returnButton = document.getElementById("completion-return");
const codePanel = document.getElementById("completion-code-panel");
const codeElement = document.getElementById("completion-code");
const copyButton = document.getElementById("completion-copy");
const isLocal = window.location.protocol === "file:" || params.get("preview") === "1";
if(localTools) localTools.hidden = !isLocal;
const researcherDetail = document.querySelector(".researcher-only-detail");
if(researcherDetail) researcherDetail.hidden = !isLocal;

function safeCompletionUrl(value){
  if(!value) return null;
  try{
    const url = new URL(value);
    return url.protocol === "https:" && ["app.prolific.com", "www.prolific.com"].includes(url.hostname)
      ? url.href : null;
  }catch(error){
    return null;
  }
}

const completionUrl = safeCompletionUrl(params.get("completion_url"));
const rawCompletionCode = params.get("completion_code") || "";
const completionCode = /^[A-Za-z0-9]{4,16}$/.test(rawCompletionCode)
  ? rawCompletionCode.toUpperCase() : null;

function showCompletionRoute(){
  if(codePanel && completionCode){
    codePanel.hidden = false;
    if(codeElement) codeElement.textContent = completionCode;
  }
  if(returnButton && completionUrl) returnButton.hidden = false;
}

async function save(){
  if(retryButton) retryButton.hidden = true;
  if(returnButton) returnButton.hidden = true;
  if(status) status.textContent = "Saving your responses...";
  const result = await data?.flush({attempts:3});
  if(!status) return;
  if(result?.local_only){
    status.textContent = "Local preview: the event record is stored in this browser. Use the download buttons below to keep a copy.";
    showCompletionRoute();
  }else if(result?.ok && result.server_completed){
    status.textContent = completionUrl
      ? "Your responses have been saved. You may now return to Prolific."
      : "Your responses have been saved. You may now close this tab and return to the recruitment platform.";
    showCompletionRoute();
  }else{
    status.textContent = "We could not confirm the final upload. Your responses remain stored in this browser. Check your connection and try again.";
    if(retryButton) retryButton.hidden = false;
    if(localTools) localTools.hidden = false;
  }
}

document.getElementById("download-json")?.addEventListener("click", () => data.downloadJson());
document.getElementById("download-jsonl")?.addEventListener("click", () => data.downloadJsonl());
document.getElementById("download-csv")?.addEventListener("click", () => data.downloadCsv());
retryButton?.addEventListener("click", save);
copyButton?.addEventListener("click", async () => {
  try{
    await navigator.clipboard.writeText(completionCode || "");
    copyButton.textContent = "Copied";
  }catch(error){
    if(status) status.textContent = "Please select and copy the completion code manually.";
  }
});

if(returnButton && completionUrl){
  returnButton.addEventListener("click", async () => {
    returnButton.disabled = true;
    returnButton.textContent = "Returning...";
    data?.record("completion_return_activated");
    const result = await data?.flush({attempts:3});
    if(!result?.ok && !result?.local_only){
      returnButton.disabled = false;
      returnButton.textContent = "Return to Prolific";
      if(status) status.textContent = "We could not confirm the final upload. Check your connection and try again.";
      if(retryButton) retryButton.hidden = false;
      return;
    }
    window.location.href = completionUrl;
  });
}

save();
})();
