/* Comprehension check shown as a dialog on the task page after the guided
 * tutorial. Questions, answers and the condition-specific question 2 are the
 * ones in routes/comprehension.html and tutorial.js (COMPREHENSION_ANSWERS);
 * tests/verify-guided-tutorial.cjs checks that the answers still match.
 */
(function(){
"use strict";

const CONTINUATION_CONDITION = "local";
const COMPREHENSION_ANSWERS = {
  check1:"b",
  check2:"c",
  check3:"a",
  check4:"d",
};
const CONDITION_OPTIONS = {
  local:{
    a:"Every robot on the map stops.",
    b:"All robots immediately reach their charging bays.",
    c:"The robots in the conflict stop, while other robots keep moving.",
    d:"Your choices are cleared.",
  },
};

const $ = id => document.getElementById(id);
const data = () => window.StudyData;
let attempt = 0;
let options = null;
let bound = false;

function record(type, detail={}){
  data()?.record(type, {tutorial_protocol:options?.protocol || null, ...detail});
}

function responses(){
  return Object.fromEntries(Object.keys(COMPREHENSION_ANSWERS).map(name =>
    [name, document.querySelector(`#comprehension-form input[name="${name}"]:checked`)?.value || null]));
}

function save(result=null){
  data()?.saveCheckpoint("comprehension", {attempt, responses:responses(), result});
}

function updateState(){
  const answered = Object.values(responses()).filter(Boolean).length;
  $("comprehension-check").disabled = answered !== Object.keys(COMPREHENSION_ANSWERS).length;
}

function resetForm(){
  $("comprehension-form").reset();
  $("comprehension-questions").hidden = false;
  $("comprehension-result").hidden = true;
  $("comprehension-back-to-tutorial").hidden = true;
  $("comprehension-start").hidden = true;
  updateState();
}

function showResult(passed){
  $("comprehension-questions").hidden = true;
  $("comprehension-result").hidden = false;
  $("comprehension-result-title").textContent = passed ? "You are ready" : "Please try again";
  $("comprehension-result-copy").textContent = passed
    ? "All four answers are correct."
    : "Some answers were not correct. Let's go through the tutorial again, then answer the questions again.";
  $("comprehension-start").hidden = !passed;
  $("comprehension-back-to-tutorial").hidden = passed;
  (passed ? $("comprehension-start") : $("comprehension-back-to-tutorial")).focus();
}

function check(){
  const answers = responses();
  if(Object.values(answers).some(value => !value)) return;
  attempt += 1;
  const passed = Object.entries(COMPREHENSION_ANSWERS).every(([name, answer]) => answers[name] === answer);
  const result = {attempt, passed, responses:answers, timestamp:Date.now(), round:options.round};
  if(!passed) result.returned_to_tutorial = true;
  record("comprehension_submitted", result);
  save(result);
  showResult(passed);
}

function close(){
  $("guided-comprehension").hidden = true;
  document.body.classList.remove("guided-comprehension-open");
}

function bind(){
  if(bound) return;
  bound = true;
  $("comprehension-form").onchange = event => {
    updateState();
    record("comprehension_option_selected", {question:event.target?.name || null, response:event.target?.value || null});
    save();
  };
  $("comprehension-check").onclick = check;
  $("comprehension-start").onclick = () => {
    close();
    record("comprehension_passed", {attempts:attempt});
    data()?.flush?.();
    options.onPassed();
  };
  $("comprehension-back-to-tutorial").onclick = () => {
    close();
    data()?.saveCheckpoint("comprehension", {attempt, responses:{}, result:null});
    options.onFailed();
  };
}

function open(nextOptions){
  options = nextOptions;
  bind();
  data()?.setStage("comprehension");
  Object.entries(CONDITION_OPTIONS[CONTINUATION_CONDITION]).forEach(([key, copy]) => {
    const target = $(`comprehension-condition-${key}`);
    if(target) target.textContent = copy;
  });
  const saved = data()?.checkpoint("comprehension");
  resetForm();
  attempt = saved?.attempt || 0;
  for(const [name, value] of Object.entries(saved?.responses || {})){
    const input = $("comprehension-form").querySelector(`input[name="${name}"][value="${value}"]`);
    if(input) input.checked = true;
  }
  updateState();
  $("guided-comprehension").hidden = false;
  document.body.classList.add("guided-comprehension-open");
  if(saved?.result) showResult(saved.result.passed);
  else $("comprehension-form").querySelector("input")?.focus();
  record("comprehension_opened", {question_count:Object.keys(COMPREHENSION_ANSWERS).length, round:options.round});
}

window.GuidedComprehension = {open, answers:COMPREHENSION_ANSWERS};
})();
