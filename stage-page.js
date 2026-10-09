/* Controller for one standalone onboarding page. */
(async function(){
"use strict";

const stage = document.body.dataset.stage;
const nextPage = {
  consent:"reminder.html",
  tutorial:"comprehension.html",
  comprehension:"task.html",
};

function log(type, detail){
  window.StudyData?.record(type, detail || {});
}

function completeStage(){
  log(stage + "_stage_completed");
  window.StudyData?.flush();
  const destination = nextPage[stage];
  if(destination) window.StudyData.navigate(destination);
}

if(!await window.StudyData?.ready || !window.StudyData.init({stage:stage})) return;

if(!window.ResearchTutorial?.startSimpleStage){
  document.body.textContent = "The study could not load. Please refresh the page.";
  log("stage_load_failed", {reason:"tutorial_controller_unavailable"});
  return;
}

if(stage === "tutorial"){
  window.ResearchTutorial.startSimple({
    startAt:"tutorial",
    standaloneStage:"tutorial",
    log:log,
    onComplete:completeStage,
  });
}else{
  window.ResearchTutorial.startSimpleStage({
    stage:stage,
    log:log,
    onComplete:completeStage,
  });
}
})();
