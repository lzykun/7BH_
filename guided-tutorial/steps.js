/* Guided tutorial config: steps, gadgets, maps and the practice rule.
 * Ported from docs/guided-tutorial-storyboard.html (STEPS and GADGETS). Edit
 * content here; guided-tutorial/engine.js only interprets it. Participant text
 * is copied from the storyboard and must not be changed without approval.
 */
(function(){
"use strict";

const ROWS = 19;
const COLS = 19;

// Same raw format as the task bank, so app.js draws and simulates it as a task.
function tutorialMap(id, openCells, robots){
  const open = new Set(openCells.map(cell => `${cell[0]},${cell[1]}`));
  const walls = [];
  for(let row = 0; row < ROWS; row += 1){
    for(let col = 0; col < COLS; col += 1){
      if(!open.has(`${row},${col}`)) walls.push([row, col]);
    }
  }
  return {
    id,
    item_id:id,
    label:id,
    world:{
      rows:ROWS, cols:COLS, walls, zones:[], protected:[], items:[], machines:[],
      passages:[], scanners:[], diagonal_edges:[], merge_cells:[],
      agents:robots.map((robot, index) => ({
        id:index,
        module_id:0,
        start:robot.start,
        goal:{kind:"reach", target:robot.target},
        movement_arrow:robot.arrow,
        role:robot.role,
        carrying:"none",
        tokens:[],
        active:true,
      })),
    },
  };
}

const span = (from, to) => Array.from({length:to - from + 1}, (_, index) => from + index);

// Open area in the top-left (rows 2-7, cols 2-7), where T1's roads are.
// Robot 1 is Type A (carrier), robot 2 is Type D (loader). On map 2 robot 2
// moves west into the crossing, so the practice answer matches T1's (west).
const MAPS = {
  m1:tutorialMap("guided_tutorial_m1",
    [...span(2, 7).map(col => [3, col]), ...span(2, 7).map(col => [5, col])],
    [
      {start:[3, 2], target:[3, 7], arrow:"E", role:"carrier"},
      {start:[5, 7], target:[5, 2], arrow:"W", role:"loader"},
    ]),
  m2:tutorialMap("guided_tutorial_m2",
    [...span(2, 7).map(col => [4, col]), [2, 4], [3, 4], [5, 4], [6, 4], [7, 4]],
    [
      {start:[7, 4], target:[2, 4], arrow:"N", role:"carrier"},
      {start:[4, 7], target:[4, 2], arrow:"W", role:"loader"},
    ]),
};

// Storyboard part names -> elements of routes/task.html. Locked parts are greyed.
const PARTS = {
  goals:["#scene-goal"],
  board:[".scene-visual"],
  status:["#status"],
  runbar:[".scene-bottom-controls"],
  "rules-head":[".rules-heading"],
  current:[".simple-current-rule"],
  context:[".simple-rule-context", ".simple-rule-intro"],
  tabs:[".rule-family-tabs"],
  values:[".simple-family-sections"],
};

// Storyboard target selectors -> elements of routes/task.html.
// "robot:N" and "value:V" are resolved by the engine.
const TARGETS = {
  "#board":"#board",
  ".runbar":".scene-run-controls",
  "#status":"#status",
  ".rules":".rules-panel",
  "[data-part=tabs]":".rule-family-tabs",
  "#tab-move":"#rule-family-tab-move_dir",
  ".current":".simple-current-rule",
};

const GADGETS = {
  core:{label:"Main line (cannot be turned off)"},
  fullscreen:{label:"Full-screen reminder"},
  features:{label:"Robot badges"},
  replay:{label:"Replay buttons"},
  "two-tabs":{label:"Only one tab is used"},
  "match-outline":{label:"Green outline", requires:"select-value"},
  "carry-over":{label:"Rule carries over", requires:"practice-run"},
};

const UNLOCK_RULES = ["board", "runbar", "status", "goals", "rules-head", "current", "context", "tabs", "values"];

const STEPS = [
  {id:"welcome", gadget:"core", map:"m1", rule:"none", shown:"start", target:null, unlock:[],
    text:"Welcome to the Robot Warehouse! This is the screen you will work on. Let's walk through it together."},
  {id:"fullscreen", gadget:"fullscreen", map:"m1", rule:"none", shown:"start", target:null, unlock:[],
    text:"For the best view, please make your browser window full screen now."},
  {id:"map", gadget:"core", map:"m1", rule:"none", shown:"start", target:"#board", area:[[3, 2], [5, 7]], unlock:["board"],
    text:"The robots are heading back to their charging bays. Each robot and its bay share the <em>same number and colour</em>."},
  {id:"badges", gadget:"features", map:"m1", rule:"none", shown:"start", target:"robot:1", unlock:["board"],
    text:"The <em>arrow</em> shows which way a robot will move next. The <em>letter</em> is its Type. You will use these later."},
  {id:"run-1", gadget:"core", map:"m1", rule:"none", shown:"start", target:"#board", area:[[3, 2], [5, 7]], targetAlso:".runbar", unlock:["board", "runbar"], gate:"run-any",
    text:"Robots always take the shortest route to their bay. Press <em>Run rule</em> to watch them move.", wait:"Press Run rule to continue"},
  {id:"replay", gadget:"replay", map:"m1", rule:"none", shown:"end", target:"#board", area:[[3, 2], [5, 7]], targetAlso:".runbar", unlock:["board", "runbar"],
    text:"Use the <em>← →</em> buttons to replay a run one step at a time."},
  {id:"run-2", gadget:"core", map:"m2", rule:"none", shown:"start", target:"#board", area:[[2, 2], [7, 7]], targetAlso:".runbar", unlock:["board", "runbar", "status"], gate:"run-any",
    text:"Sometimes the layout gets more complicated. Press <em>Run rule</em> and see what happens on this map.", wait:"Press Run rule to continue"},
  {id:"clash", gadget:"core", map:"m2", rule:"none", shown:"end", target:"#status", unlock:["board", "runbar", "status"],
    text:"The two robots tried to enter the <em>same square</em> at the same time and collided. Robots in a collision stop."},
  {id:"task", gadget:"core", map:"m2", rule:"none", shown:"end", target:null, unlock:["board", "runbar", "status", "goals"],
    text:"<span class='key'>Your task is to coordinate the robots and prevent them from colliding.</span>"},
  {id:"rules", gadget:"core", map:"m2", rule:"none", shown:"end", target:".rules", bubbleDx:-70, unlock:["board", "runbar", "status", "goals", "rules-head", "current", "context"],
    text:"You coordinate them with a <em>waiting rule</em>. When two robots meet, your rule decides which one waits."},
  {id:"features", gadget:"core", map:"m2", rule:"none", shown:"end", target:"[data-part=tabs]", unlock:["board", "runbar", "status", "goals", "rules-head", "current", "context", "tabs"],
    text:"A rule can use one of two robot features: <em>Type</em> (the letter) or <em>Movement</em> direction (the arrow)."},
  {id:"two-tabs", gadget:"two-tabs", map:"m2", rule:"none", shown:"end", target:"[data-part=tabs]", unlock:["board", "runbar", "status", "goals", "rules-head", "current", "context", "tabs"],
    text:"Only the tab that is open when you press Run is used. Each tab keeps its own selections."},
  {id:"pick-movement", gadget:"core", map:"m2", rule:"none", shown:"end", target:"#tab-move", unlock:["board", "runbar", "status", "goals", "rules-head", "current", "context", "tabs"], gate:"family-move",
    text:"Let's use Movement for this map. Click the <em>Movement</em> tab.", wait:"Click Movement to continue"},
  // Storyboard said north; changed to west so the practice matches T1 (decision B1).
  {id:"select-value", gadget:"core", map:"m2", rule:"move-tab", shown:"end", target:"value:W", unlock:UNLOCK_RULES, gate:"value",
    text:"Robot 2 is moving <em>west ←</em>. Select <em>west</em> so that robot waits when the two meet.", wait:"Select west to continue"},
  {id:"match-outline", gadget:"match-outline", map:"m2", rule:"move-N", shown:"start", target:"robot:2", unlock:UNLOCK_RULES,
    text:"Robots that match your rule get a <em>green outline</em>. It shows who would wait. It does not mean the rule works yet."},
  {id:"current-rule", gadget:"core", map:"m2", rule:"move-N", shown:"start", target:".current", unlock:UNLOCK_RULES,
    text:"Your current rule is written out here in words."},
  {id:"practice-run", gadget:"core", map:"m2", rule:"move-N", shown:"start", target:"#board", area:[[2, 2], [7, 7]], targetAlso:".runbar", unlock:UNLOCK_RULES, gate:"run-success",
    text:"Press <em>Run rule</em> to test your rule.", wait:"Get both robots to their bays to continue"},
  {id:"good-job", gadget:"core", celebrate:true, map:"m2", rule:"move-N", shown:"end", target:"#board", area:[[2, 2], [7, 7]], unlock:UNLOCK_RULES,
    text:"<span class='key'>Good job!</span> Robot 2 waited, robot 1 passed, and both reached their bays in the same Run."},
  {id:"one-rule", gadget:"core", map:"m2", rule:"move-N", shown:"end", target:".rules", unlock:UNLOCK_RULES,
    text:"In each task you build <em>one rule</em>, and every robot follows it. A task is complete when every robot reaches its bay in the same Run."},
  {id:"carry-over", gadget:"carry-over", map:"m2", rule:"move-N", shown:"end", target:".current", unlock:UNLOCK_RULES,
    text:"When the next task starts, your rule <em>stays selected</em>. You can keep it or change it."},
  {id:"end", gadget:"core", map:"m2", rule:"move-N", shown:"end", target:null, unlock:UNLOCK_RULES,
    text:"That's it! Next come a few quick questions, then your first task on the full warehouse map."},
];

window.GuidedTutorialConfig = Object.freeze({
  protocol:"guided-interface-v1",
  // The practice answer. It must match T1's solution once the task set is final.
  practice:{family:"move_dir", value:"W"},
  // The rule that is selected when T1 starts.
  carryIntoFirstTask:{family:"move_dir", value:"W"},
  practiceRetryText:"Try again: select west on the Movement tab, then press Run rule.",
  labels:{back:"← Back", next:"Next →", finish:"Finish"},
  maps:MAPS,
  parts:PARTS,
  targets:TARGETS,
  gadgets:GADGETS,
  steps:STEPS,
});
})();
