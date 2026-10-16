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
function tutorialMap(id, openCells, robots, options={}){
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
    layout_source:options.layoutSource || null,
    world:{
      rows:ROWS, cols:COLS, walls, zones:[], protected:[], items:[], machines:[],
      passages:[], scanners:[], diagonal_edges:options.diagonalEdges || [], merge_cells:[],
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
// Map 2 (conflict and practice) is the v23 Type-D practice layout mirrored
// left-right with the bays swapped. Both Movement west and Type D solve it;
// Type D is tested last and carried into T1 without switching tabs again.
const MAPS = {
  m1:tutorialMap("guided_tutorial_m1",
    [...span(2, 7).map(col => [3, col]), ...span(2, 7).map(col => [5, col])],
    [
      {start:[3, 2], target:[3, 7], arrow:"E", role:"carrier"},
      {start:[5, 7], target:[5, 2], arrow:"W", role:"loader"},
    ]),
  m2:tutorialMap("tutorial_conflict_practice",
    [[4, 6], [4, 5], [4, 4], [6, 4], [5, 4], [3, 3], [2, 2]],
    [
      {start:[4, 6], target:[3, 3], arrow:"W", role:"loader"},
      {start:[6, 4], target:[2, 2], arrow:"N", role:"carrier"},
    ],
    {
      layoutSource:"v23-practice-mirrored-swapped-bays",
      diagonalEdges:[[[4, 4], [3, 3]], [[3, 3], [2, 2]]],
    }),
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
  "#tab-type":"#rule-family-tab-role",
  ".current":".simple-current-rule",
};

const GADGETS = {
  core:{label:"Main line (cannot be turned off)"},
  fullscreen:{label:"Full-screen reminder"},
  features:{label:"Robot badges"},
  replay:{label:"Replay buttons"},
  "match-outline":{label:"Green outline", requires:"select-value"},
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
  {id:"run-2", gadget:"core", map:"m2", rule:"none", shown:"start", target:"#board", area:[[2, 2], [6, 6]], targetAlso:".runbar", unlock:["board", "runbar", "status"], gate:"run-any",
    text:"Sometimes the layout gets more complicated. Press <em>Run rule</em> and see what happens on this map.", wait:"Press Run rule to continue"},
  {id:"clash", gadget:"core", map:"m2", rule:"none", shown:"end", target:"#status", unlock:["board", "runbar", "status"],
    text:"The two robots tried to enter the <em>same square</em> at the same time and collided. Robots in a collision stop."},
  {id:"task", gadget:"core", map:"m2", rule:"none", shown:"end", target:null, unlock:["board", "runbar", "status", "goals"],
    text:"<span class='key'>Your task is to coordinate the robots and prevent them from colliding.</span>"},
  {id:"rules", gadget:"core", map:"m2", rule:"none", shown:"end", target:".rules", bubbleDx:-70, unlock:["board", "runbar", "status", "goals", "rules-head", "current", "context"],
    text:"You coordinate them with a <em>waiting rule</em>. When two robots meet, your rule decides which one waits."},
  {id:"features", gadget:"core", map:"m2", rule:"none", shown:"end", target:"[data-part=tabs]", unlock:["board", "runbar", "status", "goals", "rules-head", "current", "context", "tabs"],
    text:"A rule can use one of two robot features: <em>Type</em> (the letter) or <em>Movement</em> direction (the arrow)."},
  {id:"pick-movement", gadget:"core", map:"m2", rule:"none", shown:"end", target:"#tab-move", unlock:["board", "runbar", "status", "goals", "rules-head", "current", "context", "tabs"], gate:"family-move",
    text:"Let's use Movement for this map. Click the <em>Movement</em> tab.", wait:"Click Movement to continue"},
  // Storyboard said north; west so the practice matches T1 (approved wording).
  {id:"select-value", gadget:"core", map:"m2", rule:"move-tab", shown:"end", target:"value:W", unlock:UNLOCK_RULES, gate:"value",
    text:"Robot 1 is moving <em>west ←</em>. Select <em>west</em> so that robot waits when the two meet.", wait:"Select west to continue"},
  {id:"match-outline", gadget:"match-outline", map:"m2", rule:"move-N", shown:"start", target:"robot:1", unlock:UNLOCK_RULES,
    text:"Robots that match your rule get a <em>green outline</em>. It shows who would wait. It does not mean the rule works yet."},
  {id:"current-rule", gadget:"core", map:"m2", rule:"move-N", shown:"start", target:".current", unlock:UNLOCK_RULES,
    text:"Your current rule is written out here in words."},
  {id:"practice-run", gadget:"core", map:"m2", rule:"move-N", shown:"start", target:"#board", area:[[2, 2], [6, 6]], targetAlso:".runbar", unlock:UNLOCK_RULES, gate:"run-success",
    text:"Press <em>Run rule</em> to test your rule.", wait:"Get both robots to their bays to continue"},
  {id:"good-job", gadget:"core", celebrate:true, map:"m2", rule:"move-N", shown:"end", target:"#board", area:[[2, 2], [6, 6]], unlock:UNLOCK_RULES,
    text:"<span class='key'>Good job!</span> Robot 1 waited, robot 2 passed, and both reached their bays in the same Run."},
  // Type practice is required: the final successful rule is carried into T1.
  {id:"alt-intro", gadget:"core", map:"m2", rule:"move-N", shown:"end", target:"[data-part=tabs]", unlock:UNLOCK_RULES,
    text:"You can always try the other feature. Let's solve the same map with <em>Type</em>."},
  {id:"pick-type", gadget:"core", map:"m2", rule:"move-N", shown:"end", target:"#tab-type", unlock:UNLOCK_RULES, gate:"family-type",
    text:"Click <em>Type</em>. Your Movement selection is kept separately and won't change.", wait:"Click Type to continue"},
  {id:"select-type", gadget:"core", map:"m2", rule:"type-tab", shown:"end", target:"value:role:loader", bubbleDx:-200, unlock:UNLOCK_RULES, gate:"type-value",
    text:"Robot 1 is <em>Type D</em>. Select <em>D</em> so it waits.", wait:"Select D to continue"},
  {id:"type-run", gadget:"core", map:"m2", rule:"type-D", shown:"start", target:"#board", area:[[2, 2], [6, 6]], targetAlso:".runbar", unlock:UNLOCK_RULES, gate:"run-type-success",
    text:"Press <em>Run rule</em>. Only the open tab is used, so this Run uses your Type rule.", wait:"Get both robots to their bays to continue"},
  {id:"type-good", gadget:"core", celebrate:true, map:"m2", rule:"type-D", shown:"end", target:"#board", area:[[2, 2], [6, 6]], unlock:UNLOCK_RULES,
    text:"Both robots are home! Keep <em>Type D</em> selected for your first task."},
  {id:"both-kept", gadget:"core", map:"m2", rule:"type-D", shown:"end", target:".rules", unlock:UNLOCK_RULES,
    text:"Each tab keeps its own selections, and both are carried into the next task. The open tab is the rule every robot follows when you press Run."},
  {id:"run-budget", gadget:"core", map:"m2", rule:"type-D", shown:"end", target:null, unlock:UNLOCK_RULES,
    text:"In the tasks, you have <em>10 Runs per map</em>. Every Run counts, even with unchanged selections. Success on Run 10 counts. If some robots are still not home after Run 10, you move to the next map. Your last selections carry over. Practice and replay steps do not use task Runs."},
  {id:"end", gadget:"core", map:"m2", rule:"type-D", shown:"end", target:null, unlock:UNLOCK_RULES,
    text:"Next come a few quick questions, then your first task. <em>Type D</em> will stay selected."},
];

window.GuidedTutorialConfig = Object.freeze({
  protocol:"guided-interface-v4-type-finish-bonus",
  // The practice answer. It must match T1's solution once the task set is final.
  practice:{family:"move_dir", value:"W"},
  // The alternative-feature answer (Type D; "loader" is D's value id).
  alternative:{family:"role", value:"loader"},
  // T1 starts with Type D; the tested Movement draft remains in its own tab.
  carryIntoFirstTask:{family:"role", value:"loader"},
  practiceRetryText:"Try again: select west on the Movement tab, then press Run rule.",
  labels:{back:"← Back", next:"Next →", finish:"Finish"},
  maps:MAPS,
  parts:PARTS,
  targets:TARGETS,
  gadgets:GADGETS,
  steps:STEPS,
});
})();
