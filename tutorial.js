/* Pre-task tutorial for the curriculum version of Shared Rulebook.
 *
 * It teaches only the interface and the warehouse's base mechanics. Special
 * elements such as cold storage, exits, Cleaners, and Operators remain for
 * the curriculum to introduce.
 */

(function(){
"use strict";

let CELL = 42;
let viewportResizeTimer = null;
const STEP_MS = 420;
const SIMPLE_TYPE_COLOR = "#2D70B3";
const CONTINUATION_CONDITION = "local";
const SIMPLE_PRACTICE_PROTOCOL = "type-only-d-mirror-v1";
const STORY_PROTOCOL = "space-manager-note-type-mirror-v1";
const ASSET_PREFIX = document.body?.dataset.assetPrefix || "";
const SIMPLE_IDENTITY_COLORS = [
  "#2563B8", "#C04B23", "#167A62", "#7653B5",
  "#B52A55", "#8A6718", "#16728A", "#8C3F70",
];
const SIMPLE_TYPE_LETTERS = {
  carrier:"A",
  operator:"B",
  inspector:"C",
  loader:"D",
  technician:"E",
  courier:"F",
  scout:"G",
  guard:"H",
};
const INSTRUCTION_IMAGE_PATHS = [
  `${ASSET_PREFIX}assets/instructions/map-overview.png?v=32`,
  `${ASSET_PREFIX}assets/instructions/robot-badges.png?v=32`,
];

function icon(name, extraClass=""){
  const cls = `ui-icon ${extraClass}`.trim();
  const base = `class="${cls}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"`;
  const stroke = 'fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="square" stroke-linejoin="miter"';
  const fill = 'fill="currentColor"';
  if(name === "robot") return `<svg ${base}><path ${fill} d="M8 3h8v2h2v7H6V5h2V3ZM5 12h14v9H5v-9Z"/><circle cx="10" cy="8" r="1" fill="#202020"/><circle cx="14" cy="8" r="1" fill="#202020"/><path d="M9 16h6M9 18h6" stroke="#fff" stroke-width="1.4"/></svg>`;
  if(name === "carrier") return `<svg ${base}><path ${fill} d="M7 2h10v2h2v7H5V4h2V2ZM3 12h18v4h-2v6H5v-6H3v-4Z"/><circle cx="9" cy="7" r="1.2" fill="#202020"/><circle cx="15" cy="7" r="1.2" fill="#202020"/><path d="M8 14h8v7H8v-7Zm4 0v7M8 17h8" fill="#fff" stroke="#202020" stroke-width="1.3"/></svg>`;
  if(name === "operator") return `<svg ${base}><circle ${fill} cx="12" cy="2.5" r="1.5"/><path d="M12 4v2" stroke="currentColor" stroke-width="2"/><path ${fill} d="M4 6h16v9H4V6Zm3 10h10v6H7v-6Z"/><circle cx="9" cy="10" r="1.25" fill="#202020"/><circle cx="15" cy="10" r="1.25" fill="#202020"/><path d="M9 18h2M13 18h2M9 20h6" stroke="#202020" stroke-width="1.3" fill="none"/></svg>`;
  if(name === "wall") return `<svg ${base}><path ${fill} d="M3 4h7v5H3V4Zm9 0h9v5h-9V4ZM3 11h4v5H3v-5Zm6 0h8v5H9v-5Zm10 0h2v5h-2v-5ZM3 18h9v3H3v-3Zm11 0h7v3h-7v-3Z"/></svg>`;
  if(name === "floor") return `<svg ${base}><rect ${stroke} x="4" y="4" width="16" height="16" stroke-width="1.5"/></svg>`;
  if(name === "done") return `<svg ${base}><circle ${fill} cx="12" cy="12" r="10"/><path d="m7 12 3.2 3.2L17.5 8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="square"/></svg>`;
  if(name === "failed") return `<svg ${base}><circle ${fill} cx="12" cy="12" r="10"/><path d="m8 8 8 8M16 8l-8 8" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="square"/></svg>`;
  if(name === "waiting") return `<svg ${base}><circle ${fill} cx="12" cy="12" r="10"/><path d="M9 7v10M15 7v10" stroke="#fff" stroke-width="2.4" fill="none" stroke-linecap="square"/></svg>`;
  return `<svg ${base}><circle ${stroke} cx="12" cy="12" r="8"/></svg>`;
}

function preloadInstructionImages(){
  INSTRUCTION_IMAGE_PATHS.forEach(src => {
    const image = new Image();
    image.src = src;
  });
}

function simpleTypeLetter(role){
  return SIMPLE_TYPE_LETTERS[role] || "?";
}

function simpleTypeLabel(role){
  return `Type ${simpleTypeLetter(role)}`;
}

function tutorialTargetNumber(agent, scene){
  const activeAgents = scene?.agents?.filter(candidate => candidate.active) || [];
  const index = activeAgents.findIndex(candidate => String(candidate.id) === String(agent.id));
  return index >= 0 ? String(index + 1) : String(Number(agent.id) + 1);
}

let emit = () => {};
let finish = () => {};
let tutorialMode = "standard";
let standaloneStage = null;
let instructionStep = 0;
let instructionReviewMode = false;
let comprehensionAttempt = 0;
const consentScrollDepths = new Set();

const COMPREHENSION_ANSWERS = {
  check1:"b",
  check2:"c",
  check3:"a",
  check4:"d",
};

const state = {
  page:0,
  result:null,
  frames:[],
  frameIndex:0,
  timer:null,
  startedAt:0,
  pageStartedAt:0,
  pageVisits:[],
  runs:[],
  practiceCondition:null,
  practiceSolved:false,
  practiceSaved:false,
  practiceUsed:false,
  reuseSolved:false,
  simpleCollisionObserved:false,
  simpleMovementObserved:false,
  simpleValues:{move_dir:[], role:[]},
  simpleFamily:"role",
  simpleFeatureDemo:{simpleFamily:"role", simpleValues:{move_dir:[], role:[]}},
  ruleEditorProtocol:window.STUDY_CONFIG?.rule_editor_protocol,
  simplePracticeSolved:false,
  simplePracticeSceneId:null,
  overviewRevealStep:0,
  featuresRevealStep:0,
  storyProtocol:STORY_PROTOCOL,
  storyRevealSteps:{},
  storySceneViews:{},
};

function agentDisplayId(id){
  const value = Number(id);
  if(!Number.isInteger(value) || value < 0) return String(id);
  let label = "";
  let index = value;
  do{
    label = String.fromCharCode(65 + (index % 26)) + label;
    index = Math.floor(index / 26) - 1;
  }while(index >= 0);
  return label;
}

function makeScene(id, walls, agents, options={}){
  return normalizeTask({
    id,
    level:0,
    layer:0,
    prerequisites:[],
    label:id,
    family:"tutorial",
    description:"",
    participant_prompt:"",
    active_agent_count:agents.length,
    measure:"",
    expected_min_norms:null,
    solver:null,
    baseline:null,
    world:{
      rows:options.rows || 5,
      cols:options.cols || 7,
      walls,
      zones:[],
      protected:[],
      items:[],
      machines:[],
      scanners:[],
      diagonal_edges:options.diagonalEdges || [],
      agents,
    },
  });
}

function carrier(id, start, target){
  return {
    id,
    start,
    role:"carrier",
    carrying:"none",
    active:true,
    tokens:[],
    goal:{kind:"reach", target},
  };
}

function tutorialRobot(id, start, target, role, movementArrow){
  return {
    id,
    start,
    role,
    movement_arrow:movementArrow,
    carrying:"none",
    active:true,
    tokens:[],
    goal:{kind:"reach", target},
  };
}

function wallsOutside(openCells, rows=5, cols=7){
  const open = new Set(openCells.map(cell => `${cell[0]},${cell[1]}`));
  const walls = [];
  for(let row = 0; row < rows; row += 1){
    for(let col = 0; col < cols; col += 1){
      if(!open.has(`${row},${col}`)) walls.push([row, col]);
    }
  }
  return walls;
}

const MOVEMENT_SCENE = makeScene(
  "tutorial_movement",
  [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[4,0],[4,1],[4,2],[4,3],[4,4],[4,5],[4,6],[2,3]],
  [carrier(0, [2,0], [2,6])],
);

const COLLISION_SCENE = makeScene(
  "tutorial_collision",
  [[0,0],[0,1],[0,2],[0,4],[0,5],[0,6],[4,0],[4,1],[4,2],[4,4],[4,5],[4,6]],
  [
    carrier(0, [2,1], [2,5]),
    carrier(1, [0,3], [4,3]),
  ],
);

const RULE_PRACTICE_SCENE = makeScene(
  "tutorial_rule_practice",
  [[0,0],[0,1],[0,2],[0,3],[0,4],[0,5],[0,6],[4,0],[4,1],[4,2],[4,3],[4,4],[4,5],[4,6]],
  [carrier(0, [2,0], [2,6])],
);
RULE_PRACTICE_SCENE.practiceMarked = [2,3];

const RULE_REUSE_SCENE = makeScene(
  "tutorial_rule_reuse",
  [[0,0],[1,0],[2,0],[3,0],[4,0],[0,6],[1,6],[2,6],[3,6],[4,6]],
  [carrier(0, [0,3], [4,3])],
);
RULE_REUSE_SCENE.practiceMarked = [2,3];

const SIMPLE_CONFLICT_OPEN = [
  [2,1], [2,2], [2,3],
  [4,3], [3,3],
  [1,4], [0,5],
];
const SIMPLE_CONFLICT_SCENE = makeScene(
  "tutorial_shared_square",
  wallsOutside(SIMPLE_CONFLICT_OPEN),
  [
    tutorialRobot(0, [2,1], [1,4], "carrier", "E"),
    tutorialRobot(1, [4,3], [0,5], "operator", "N"),
  ],
  {
    diagonalEdges:[
      [[2,3], [1,4]],
      [[1,4], [0,5]],
    ],
  },
);

const SIMPLE_PRACTICE_SCENE = makeScene(
  "tutorial_type_d_wait_practice",
  wallsOutside(SIMPLE_CONFLICT_OPEN),
  [
    tutorialRobot(0, [2,1], [0,5], "carrier", "E"),
    tutorialRobot(1, [4,3], [1,4], "loader", "N"),
  ],
  {
    diagonalEdges:[
      [[2,3], [1,4]],
      [[1,4], [0,5]],
    ],
  },
);

const SIMPLE_MOVEMENT_OPEN = [
  [1,0], [1,1], [1,2], [1,3], [1,4], [1,5], [1,6],
  [3,0], [3,1], [3,2], [3,3], [3,4], [3,5], [3,6],
];
const SIMPLE_MOVEMENT_SCENE = makeScene(
  "tutorial_simple_movement",
  wallsOutside(SIMPLE_MOVEMENT_OPEN),
  [
    tutorialRobot(0, [1,0], [1,6], "carrier", "E"),
    tutorialRobot(1, [3,6], [3,0], "loader", "W"),
  ],
);

const SIMPLE_CONDITION_OPEN = [
  [2,0], [2,1], [2,2], [1,3], [0,4],
  [4,2], [3,2], [1,2], [0,2],
  [4,5], [4,6], [4,7], [4,8], [4,9],
];
const SIMPLE_CONDITION_SCENE = makeScene(
  "tutorial_condition",
  wallsOutside(SIMPLE_CONDITION_OPEN, 5, 10),
  [
    tutorialRobot(0, [2,0], [0,4], "carrier", "E"),
    tutorialRobot(1, [4,2], [0,2], "operator", "N"),
    tutorialRobot(2, [4,9], [4,5], "inspector", "W"),
  ],
  {
    rows:5,
    cols:10,
    diagonalEdges:[
      [[2,2], [1,3]],
      [[1,3], [0,4]],
    ],
  },
);

const SIMPLE_CARRY_OPEN = [
  [2,0], [2,1], [2,2], [1,2], [0,2], [1,3], [0,4], [3,2], [4,2],
  [2,10], [2,9], [2,8], [1,8], [0,8], [3,8], [4,8], [3,7], [4,6],
];
const SIMPLE_CARRY_SCENE = makeScene(
  "tutorial_rule_carryover",
  wallsOutside(SIMPLE_CARRY_OPEN, 5, 11),
  [
    tutorialRobot(0, [2,0], [0,4], "carrier", "E"),
    tutorialRobot(1, [4,2], [0,2], "operator", "N"),
    tutorialRobot(2, [2,10], [4,6], "inspector", "W"),
    tutorialRobot(3, [0,8], [4,8], "loader", "S"),
  ],
  {
    rows:5,
    cols:11,
    diagonalEdges:[
      [[2,2], [1,3]],
      [[1,3], [0,4]],
      [[2,8], [3,7]],
      [[3,7], [4,6]],
    ],
  },
);

const ALL_PAGES = [
  {
    id:"goal",
    title:"Read the map",
    lead:"Your task is to write shared rules that let every active robot complete its target without causing a failure.",
    points:[
      "A robot and its target have the same letter and colour.",
      "A target is shown as a dashed square.",
      "Robots may enter available squares but cannot enter walls.",
      "Letters and colours only match robots to targets; they do not give priority.",
    ],
    scene:MOVEMENT_SCENE,
    controls:false,
    reference:"map",
    initialNote:"Robot A and its dashed target use the same letter and colour.",
  },
  {
    id:"movement",
    title:"How robots move",
    lead:"Press Run to watch Robot A plan a route around the wall and reach its target.",
    points:[
      "A robot moves one square during each time step.",
      "It chooses the shortest legal route. If routes are equally short, it prefers fewer turns.",
      "A wall changes the route; it does not stop the robot from planning.",
      "Use the arrows after a run to inspect the movement one step at a time.",
    ],
    scene:MOVEMENT_SCENE,
    controls:true,
    initialNote:"Press Run to see the planned route.",
  },
  {
    id:"simultaneous",
    title:"Robots move at the same time",
    lead:"Press Run to see what happens when two independently planned routes cross.",
    points:[
      "All active robots act during the same time step.",
      "If multiple robots try to enter the same square in the same step, they collide.",
      "The task is complete only when every active robot reaches its target.",
      "After a run, use the arrows to inspect the robots' positions at each time step.",
    ],
    scene:COLLISION_SCENE,
    controls:true,
    initialNote:"Both robots are heading toward the centre square.",
  },
  {
    id:"rules",
    title:"Build, test, and refine a rule",
    lead:"Entering the marked square causes this practice task to fail. Build a rule that prevents the robot from entering it.",
    points:[
      "Choose an object and a fact; then select Add condition.",
      "Conditions within one rule are joined by AND, so all of them must be true.",
      "Every active rule applies to every robot in the task.",
    ],
    scene:RULE_PRACTICE_SCENE,
    controls:true,
    initialNote:"Press Run first, or build a rule and test it.",
    reference:"rule",
    requires:"practice_solved",
  },
  {
    id:"library",
    title:"Save and reuse a rule",
    lead:"The library is optional. Use it when you want to carry a rule into another task.",
    points:[
      "Save to library keeps a copy available throughout the rest of the task.",
      "A saved rule is not active in a new task automatically.",
      "To reuse it, select Add to rulebook. You can then run the task to test it.",
    ],
    scene:RULE_REUSE_SCENE,
    controls:true,
    initialNote:"This is a new task. No rules are active yet.",
    reference:"library",
  },
];

// Rule carry-over is controlled by the assigned experimental condition.
// The optional library would create a second participant-controlled path.
const DEFAULT_PAGES = ALL_PAGES.filter(page => page.id !== "library");

const SIMPLE_PAGES = [
  {
    id:"simple_welcome",
    title:"",
    lead:"The robots are heading back to their charging bays. Each robot and its charging bay have the same color.",
    points:[],
    scene:null,
    controls:false,
    reference:"doc_matching",
    visualAfter:0,
  },
  {
    id:"simple_movement",
    title:"",
    lead:"Robots are programmed to find the shortest routes to their charging bay.",
    points:["Click the run button to see the robots moving to their bays!"],
    scene:SIMPLE_MOVEMENT_SCENE,
    controls:true,
    initialNote:"",
    requires:"movement_observed",
    visualAfter:1,
  },
  {
    id:"simple_encounter",
    title:"",
    lead:"Sometimes, the layout can get a little complicated..",
    points:[
      "And the robots can move into each other, and clash!",
      "Click the Run button and see what happens in this map.",
    ],
    scene:SIMPLE_PRACTICE_SCENE,
    controls:true,
    initialNote:"",
    requires:"collision_observed",
    visualAfter:0,
    controlsAfter:2,
  },
  {
    id:"simple_choice",
    title:"",
    lead:"Your task is to coordinate the robots and prevent them from colliding.",
    points:[
      "You can do this by adding coordination rules to the robots.",
      "For example, when two robots are going to meet, you can specify which robot should wait:",
    ],
    scene:null,
    controls:false,
  },
  {
    id:"simple_features",
    title:"",
    lead:"The letter on each robot shows its Type.",
    points:[
      "A robot's Type stays the same throughout its route.",
      "The arrow shows which direction the robot will move next, and can change along its route.",
    ],
    scene:null,
    controls:false,
    reference:"features",
    visualAfter:0,
  },
  {
    id:"simple_tabs",
    title:"",
    lead:"Choose Type or Movement to decide who waits.",
    points:[
      "Click an option to select it. Click it again to deselect it.",
      "Only one tab applies at a time. Each tab keeps your previous selections.",
      "Matching robots get a green outline. This shows your selection, not a successful Run.",
    ],
    scene:null,
    controls:false,
    reference:"simple_builder",
    visualAfter:0,
  },
  {
    id:"simple_practice",
    title:"",
    lead:"Now, configure a rule to solve the clash in this map.",
    points:[
      "For this practice, use Type.",
      "Select a Type and look for the green outline on the matching robot.",
    ],
    scene:SIMPLE_PRACTICE_SCENE,
    controls:true,
    reference:"simple_builder",
    requires:"simple_practice",
    visualAfter:0,
  },
  {
    id:"simple_ready",
    title:"",
    lead:"Good job!",
    points:[
      "You need to configure ONE rule to coordinate all the robots in this warehouse.",
      "Every robot will follow your rule.",
      "The task is complete when every robot reaches its bay in the same Run.",
      "By default, the rule you compose in the current trial will carry over to the next.",
      "Ready?",
    ],
    scene:null,
    controls:false,
    reference:"manager_note",
    visualAfter:5,
  },
];

const INSTRUCTION_STEPS = [
  {
    label:"Step 1 · Goal",
    title:"Guide every robot to its charging bay",
    lead:"The number on each robot matches its charging bay.",
    points:[
      "The robots move automatically.",
      "Press Run to send the robots on their way.",
    ],
    visual:() => `
      <figure class="instruction-screenshot instruction-map-annotated">
        <div class="instruction-map-image">
          <img src="${ASSET_PREFIX}assets/instructions/map-overview.png?v=32" alt="A tutorial practice map showing two robots, their routes, and numbered charging bays.">
          <svg class="instruction-map-arrows" viewBox="0 0 100 100" aria-hidden="true">
            <defs>
              <marker id="instruction-red-arrow" markerWidth="7" markerHeight="7" refX="5.2" refY="3.5" orient="auto" markerUnits="strokeWidth">
                <path d="M0,0 L7,3.5 L0,7 Z"></path>
              </marker>
            </defs>
            <path class="instruction-map-arrow-path" d="M 22 53 C 39 51, 51 43, 62 35"></path>
            <path class="instruction-map-arrow-path" d="M 56 82 C 70 69, 76 42, 80 22"></path>
          </svg>
        </div>
      </figure>`,
  },
  {
    label:"Step 2 · Robot information",
    title:"Meet your robots",
    lead:"Select Robot types to choose which robots wait.",
    points:[
      "<strong class=\"tutorial-key\">Robot type</strong> is the letter. It stays with the robot.",
      "<strong class=\"tutorial-key\">Movement direction</strong> is the arrow. It shows which direction the robot will move next.",
    ],
    visual:() => `
      <figure class="instruction-screenshot is-robot-detail">
        <img src="${ASSET_PREFIX}assets/instructions/robot-badges.png?v=32" alt="A tutorial robot with destination number 1, type A, and a rightward movement arrow.">
      </figure>`,
  },
  {
    label:"Step 3 · Who waits",
    title:"Choose who waits",
    lead:"When two robots try to enter the same square, your choices decide who waits.",
    points:[
      "Choose Robot types to decide who waits.",
      "The <strong class=\"tutorial-key\">matching robot waits</strong> while the other moves first.",
      "Your choices <strong class=\"tutorial-key\">stay selected</strong> for the next task. Keep them or change them as you go.",
    ],
    visual:() => `<div class="instruction-live-editor">${simpleRuleBuilderMarkup()}</div>`,
  },
];

let PAGES = DEFAULT_PAGES;

const el = id => document.getElementById(id);

function stopAnimation(){
  if(state.timer !== null){
    clearInterval(state.timer);
    state.timer = null;
  }
}

function drawBoard(host, scene, frame=null){
  host.innerHTML = "";
  const frameWidth = host.parentElement?.clientWidth || window.innerWidth;
  const widthCell = Math.floor(Math.max(220, frameWidth - 24) / scene.cols);
  const heightBudget = tutorialMode === "simple" && host.parentElement?.clientHeight
    ? Math.max(120, host.parentElement.clientHeight - 16)
    : Math.max(230, Math.min(560, window.innerHeight * .56));
  const heightCell = Math.floor(heightBudget / scene.rows);
  CELL = Math.max(24, Math.min(42, widthCell, heightCell));
  host.style.width = `${scene.cols * CELL}px`;
  host.style.height = `${scene.rows * CELL}px`;

  (scene.diagonalEdgePairs || []).forEach(([first, second]) => {
    const firstX = first[1] * CELL + (CELL - 4) / 2;
    const firstY = first[0] * CELL + (CELL - 4) / 2;
    const secondX = second[1] * CELL + (CELL - 4) / 2;
    const secondY = second[0] * CELL + (CELL - 4) / 2;
    const dx = secondX - firstX;
    const dy = secondY - firstY;
    const link = document.createElement("div");
    link.className = "diagonal-road-link tut-diagonal-road-link";
    link.style.left = `${firstX}px`;
    link.style.top = `${firstY}px`;
    link.style.width = `${Math.hypot(dx, dy)}px`;
    link.style.height = `${Math.max(8, CELL - 8)}px`;
    link.style.transform = `translateY(-50%) rotate(${Math.atan2(dy, dx)}rad)`;
    host.appendChild(link);
  });

  for(let row = 0; row < scene.rows; row += 1){
    for(let col = 0; col < scene.cols; col += 1){
      const cell = document.createElement("div");
      const blocked = !passable(scene, [row, col]);
      cell.className = blocked ? "cell wall" : "cell zone-normal";
      cell.style.left = `${col * CELL}px`;
      cell.style.top = `${row * CELL}px`;
      cell.style.width = `${blocked ? CELL : CELL - 4}px`;
      cell.style.height = `${blocked ? CELL : CELL - 4}px`;
      cell.dataset.tutorialCell = K(row, col);
      if(scene.practiceMarked && sameCell(scene.practiceMarked, [row, col])){
        cell.classList.add("practice-marked");
        cell.innerHTML = "<span>Marked</span>";
      }
      host.appendChild(cell);
    }
  }

  scene.agents.forEach(agent => {
    const target = goalCell(scene, agent);
    const agentColour = tutorialMode === "simple"
      ? SIMPLE_IDENTITY_COLORS[Number(agent.id) % SIMPLE_IDENTITY_COLORS.length]
      : COL[agent.id % COL.length];
    const ring = document.createElement("div");
    ring.className = "ring";
    ring.style.left = `${target[1] * CELL}px`;
    ring.style.top = `${target[0] * CELL}px`;
    ring.style.width = `${CELL - 4}px`;
    ring.style.height = `${CELL - 4}px`;
    ring.style.borderColor = agentColour;
    ring.style.setProperty("--agent-color", agentColour);
    ring.setAttribute("aria-label", tutorialMode === "simple"
      ? `Charging bay ${tutorialTargetNumber(agent, scene)} for Robot ${tutorialTargetNumber(agent, scene)}, ${simpleTypeLabel(agent.role)}`
      : `Target for Robot ${agentDisplayId(agent.id)}`);
    ring.innerHTML = tutorialMode === "simple"
      ? `<span class="target-label target-label-corner-0">${tutorialTargetNumber(agent, scene)}</span>`
      : `<span class="target-label target-label-corner-0">${agentDisplayId(agent.id)}</span>`;
    host.appendChild(ring);
  });

  scene.agents.forEach(agent => {
    const position = frame?.pos?.[agent.id] || agent.pos;
    const meta = frame?.agents?.[agent.id] || frame?.agents?.[String(agent.id)] || {};
    const robot = document.createElement("div");
    robot.className = "robot";
    robot.classList.toggle("done", !!meta.done);
    robot.classList.toggle("failed", !!meta.failed);
    robot.classList.toggle("waiting", !!meta.waiting);
    const matchesRule = tutorialMode === "simple" && PAGES[state.page]?.id === "simple_practice" && (
      (state.simpleValues.move_dir || []).some(value => String(value) === String(agent.movementArrow)) ||
      (state.simpleValues.role || []).some(value => String(value) === String(agent.role))
    );
    robot.classList.toggle("rule-preview-waits", matchesRule);
    const outsideConflict = tutorialMode === "simple" &&
      PAGES[state.page]?.id === "simple_encounter" && Number(agent.id) === 2;
    if(outsideConflict){
      robot.classList.add("tut-outside-conflict");
      const encounterFinished = !!state.result && state.frames.length > 0 &&
        state.frameIndex === state.frames.length - 1;
      robot.dataset.outsideLabel = encounterFinished
        ? CONTINUATION_CONDITION === "local"
          ? "Robot 3: continued"
          : "Robot 3: also stopped"
        : "Robot 3: not in conflict";
    }
    const robotSize = Math.max(18, CELL - 4);
    const robotInset = Math.max(2, (CELL - 4 - robotSize) / 2);
    robot.style.left = `${position[1] * CELL + robotInset}px`;
    robot.style.top = `${position[0] * CELL + robotInset}px`;
    robot.style.width = `${robotSize}px`;
    robot.style.height = `${robotSize}px`;
    const robotColour = tutorialMode === "simple"
      ? SIMPLE_IDENTITY_COLORS[Number(agent.id) % SIMPLE_IDENTITY_COLORS.length]
      : COL[agent.id % COL.length];
    robot.style.setProperty("--robot-fill", robotColour);
    robot.style.background = robotColour;
    robot.title = tutorialMode === "simple"
      ? `Robot ${tutorialTargetNumber(agent, scene)}, ${simpleTypeLabel(agent.role)}`
      : `Robot ${agentDisplayId(agent.id)}`;
    const direction = meta.display_dir || meta.intent?.dir || agent.movementArrow;
    const arrows = {N:"↑", NE:"↗", E:"→", SE:"↘", S:"↓", SW:"↙", W:"←", NW:"↖"};
    robot.innerHTML = (tutorialMode === "simple"
      ? icon("robot", "robot-role") + `<span class="robot-id">${tutorialTargetNumber(agent, scene)}</span>` + `<span class="robot-type-letter robot-type-mark" aria-hidden="true">${simpleTypeLetter(agent.role)}</span>`
      : icon(agent.role || "robot", "robot-role") + `<span class="robot-id">${agentDisplayId(agent.id)}</span>`) +
      (direction ? `<span class="tut-robot-arrow" aria-label="Moving ${direction}">${arrows[direction] || direction}</span>` : "") +
      (meta.waiting ? icon("waiting", "robot-state-mark") : "") +
      (meta.failed ? icon("failed", "robot-state-mark") : "") +
      (meta.done ? icon("done", "robot-state-mark") : "");
    host.appendChild(robot);
  });

  const failureEvents = frame?.failureEvents || frame?.simultaneousEvents || [frame?.event];
  failureEvents.forEach(event => {
    const eventCell = event?.cell;
    if(!eventCell || event.type === "machine-complete") return;
    host.querySelector(`[data-tutorial-cell="${K(eventCell[0], eventCell[1])}"]`)?.classList.add("flash");
  });
}

function rulePracticeResult(){
  const condition = state.practiceCondition;
  const blocksMarkedSquare =
    condition?.object === "practice" &&
    condition?.fact === "marked";
  const path = blocksMarkedSquare
    ? [[2,0],[2,1],[2,2],[1,2],[1,3],[1,4],[2,4],[2,5],[2,6]]
    : [[2,0],[2,1],[2,2],[2,3]];
  const frames = path.map((position, index) => ({
    pos:{0:position},
    agents:{
      0:{
        done:blocksMarkedSquare && index === path.length - 1,
        failed:!blocksMarkedSquare && index === path.length - 1,
      },
    },
    event:!blocksMarkedSquare && index === path.length - 1
      ? {type:"practice_marked", cell:[2,3], agent:0}
      : null,
  }));
  return {
    ok:blocksMarkedSquare,
    reason:blocksMarkedSquare ? "ok" : "practice_marked",
    frames,
  };
}

function ruleReuseResult(){
  const path = state.practiceUsed
    ? [[0,3],[1,3],[1,2],[2,2],[3,2],[3,3],[4,3]]
    : [[0,3],[1,3],[2,3]];
  const frames = path.map((position, index) => ({
    pos:{0:position},
    agents:{
      0:{
        done:state.practiceUsed && index === path.length - 1,
        failed:!state.practiceUsed && index === path.length - 1,
      },
    },
    event:!state.practiceUsed && index === path.length - 1
      ? {type:"practice_marked", cell:[2,3], agent:0}
      : null,
  }));
  return {
    ok:state.practiceUsed,
    reason:state.practiceUsed ? "ok" : "practice_marked",
    frames,
  };
}

function feedbackEntry(result){
  if(tutorialMode === "simple"){
    if(result.ok) return {kind:"ok", title:"Success", text:"Every robot reached its charging bay."};
    const waiting = studyBothWaitingFeedback(PAGES[state.page].scene, result, simpleTutorialRules(), agent => tutorialTargetNumber(agent, PAGES[state.page].scene));
    return {
      kind:"bad",
      title:result.reason === "timeout" ? "Robots are still waiting" : "Robots could not get through",
      text:PAGES[state.page]?.id === "simple_encounter"
        ? ""
        : waiting || "Take another look and try again.",
    };
  }
  if(result.ok){
    return {
      kind:"ok",
      title:"That worked!",
      text:tutorialMode === "simple"
        ? "The robots reached their charging bays."
        : "Every robot reached its destination.",
    };
  }
  if(result.reason === "timeout" && tutorialMode === "simple"){
    return {
      kind:"bad",
      title:"Both robots are being told to wait",
      text:"Choose a rule that matches only one robot.",
    };
  }
  if(result.reason === "collision"){
    const event = result.frames[result.frames.length - 1]?.event;
    const page = PAGES[state.page];
    const scene = page?.scene;
    const names = (event?.agents || []).map(id => {
      if(tutorialMode !== "simple") return `Robot ${agentDisplayId(id)}`;
      const agent = scene?.agents.find(row => String(row.id) === String(id));
      return `Robot ${tutorialTargetNumber(agent, scene)} (${simpleTypeLabel(agent?.role)})`;
    }).join(" and ");
    const conditionExplanation = page?.id === "simple_encounter"
      ? CONTINUATION_CONDITION === "local"
        ? " Robot 3 was not part of the conflict, so it kept moving. <strong class=\"tutorial-key\">Only the robots in the conflict stop; all other robots keep moving.</strong>"
        : " Robot 3 was not part of the conflict, but it also stopped. If any robots collide, every robot on the map stops."
      : "";
    return {
      kind:"bad",
      title:page?.id === "simple_encounter" ? "The robots blocked each other" : "They met at the same time",
      text:`${names || "The robots"} both tried to enter the same square.${conditionExplanation}`,
    };
  }
  if(result.reason === "practice_marked"){
    return {
      kind:"bad",
      title:"Almost there",
      text:"Robot A entered the marked square. Add a rule that asks it to wait before that move, then try again.",
    };
  }
  return {
    kind:"bad",
    title:"This run did not work yet",
    text:`${reasonText(result.reason, result)} Take another look at the last move and adjust your rule.`,
  };
}

function setFeedback(entry, plainText=""){
  const box = el("tut-feedback");
  box.className = "tut-feedback" + (entry ? ` ${entry.kind}` : "");
  if(entry){
    box.innerHTML = `<strong>${entry.title}</strong><span>${entry.text}</span>`;
  }else{
    box.textContent = plainText;
  }
}

function showFrame(index, inspected=false, source="automatic"){
  const page = PAGES[state.page];
  if(!page.scene || !state.frames.length) return;
  state.frameIndex = Math.max(0, Math.min(index, state.frames.length - 1));
  drawBoard(el("tut-board"), page.scene, state.frames[state.frameIndex]);
  el("tut-step-label").textContent = `Step ${state.frameIndex} / ${state.frames.length - 1}`;
  el("tut-prev").disabled = state.frameIndex === 0;
  el("tut-next-step").disabled = state.frameIndex === state.frames.length - 1;
  if(state.frameIndex === state.frames.length - 1){
    if(page.id === "simple_encounter") state.simpleCollisionObserved = state.result.reason === "collision";
    if(page.id === "simple_movement") state.simpleMovementObserved = state.result.ok;
    if(page.id === "simple_practice") state.simplePracticeSolved = state.result.ok;
    setFeedback(feedbackEntry(state.result));
    if(page.id === "rules") renderReference("rule");
    if(page.id === "library") renderReference("library");
    if(page.reference === "simple_builder") renderReference("simple_builder");
  }
  if(inspected){
    emit("tutorial_step_inspected", {
      tutorial_page:page.id,
      step_index:state.frameIndex,
    });
  }
  if(tutorialMode === "simple" && (state.frameIndex === state.frames.length - 1 ||
    (source === "manual" && state.storySceneViews[page.id]))){
    state.storySceneViews[page.id] = {result:structuredClone(state.result), frameIndex:state.frameIndex};
  }
  emit("tutorial_simulation_step", {
    tutorial_page:page.id,
    step_index:state.frameIndex,
    step_total:state.frames.length - 1,
    source,
    frame:state.frames[state.frameIndex],
  });
  updateContinueState();
}

function runCurrentScene(){
  const page = PAGES[state.page];
  if(!page.scene) return;
  delete state.storySceneViews[page.id];
  stopAnimation();
  const isSimplePractice = page.id === "simple_practice";
  if(page.id === "simple_movement") state.simpleMovementObserved = false;
  if(page.id === "simple_encounter") state.simpleCollisionObserved = false;
  state.result = page.id === "rules"
    ? rulePracticeResult()
    : page.id === "library"
      ? ruleReuseResult()
      : page.id === "simple_encounter" && CONTINUATION_CONDITION === "local"
        ? simulateLocalContinuation(page.scene, [], new Set())
        : simulate(page.scene, isSimplePractice ? simpleTutorialRules() : []);
  state.frames = state.result.frames || [];
  state.frameIndex = 0;
  if(page.id === "rules"){
    state.practiceSolved = state.result.ok;
    updateContinueState();
  }
  if(page.id === "library"){
    state.reuseSolved = state.result.ok;
    updateContinueState();
  }
  if(page.id === "simple_practice"){
    state.simplePracticeSolved = false;
  }
  const practiceRequirementMet = isSimplePractice ? state.result.ok : null;
  state.runs.push({
    page_id:page.id,
    scene_id:page.scene.id,
    ok:state.result.ok,
    reason:state.result.reason,
    simple_representation:isSimplePractice ? simpleTutorialRepresentation() : null,
    practice_requirement_met:practiceRequirementMet,
    timestamp:new Date().toISOString(),
  });
  emit("tutorial_run", {
    tutorial_page:page.id,
    scene_id:page.scene.id,
    practice_protocol:isSimplePractice ? SIMPLE_PRACTICE_PROTOCOL : null,
    ok:state.result.ok,
    reason:state.result.reason,
    simple_representation:isSimplePractice ? simpleTutorialRepresentation() : null,
    practice_requirement_met:practiceRequirementMet,
    selected_values:isSimplePractice ? structuredClone(state.simpleValues) : null,
  });
  setFeedback(null);
  showFrame(0, false, "run-start");
  state.timer = setInterval(() => {
    if(state.frameIndex < state.frames.length - 1){
      showFrame(state.frameIndex + 1, false, "automatic");
      return;
    }
    stopAnimation();
    updateContinueState();
    if(document.activeElement === el("tut-run")) el("tut-overview-reveal-prompt")?.focus({preventScroll:true});
  }, STEP_MS);
  updateContinueState();
}

function resetCurrentScene(source="system"){
  const page = PAGES[state.page];
  delete state.storySceneViews[page.id];
  stopAnimation();
  state.result = null;
  state.frames = [];
  state.frameIndex = 0;
  if(page.scene) drawBoard(el("tut-board"), page.scene);
  el("tut-step-label").textContent = "Step 0 / 0";
  el("tut-prev").disabled = true;
  el("tut-next-step").disabled = true;
  const note = page.reference === "simple_builder" ? "" : page.initialNote || "";
  setFeedback(null, note);
  if(source === "manual") emit("tutorial_scene_reset", {tutorial_page:page.id});
  updateContinueState();
}

function mapReferenceMarkup(){
  return `
    <div class="tut-map-key" aria-label="Basic map elements">
      <div>
        <span class="tut-key-robot">${icon("carrier", "robot-role")}<small>A</small></span>
        <span><strong>Robot A</strong><small>An active robot.</small></span>
      </div>
      <div>
        <span class="tut-key-target"><small>A</small></span>
        <span><strong>Target A</strong><small>Robot A's destination.</small></span>
      </div>
      <div>
        <span class="tut-key-floor">${icon("floor")}</span>
        <span><strong>Available square</strong><small>A robot may enter it.</small></span>
      </div>
      <div>
        <span class="tut-key-wall">${icon("wall")}</span>
        <span><strong>Wall</strong><small>A robot cannot enter it.</small></span>
      </div>
    </div>
  `;
}

function simpleIntroReferenceMarkup(kind="intro_guide"){
  return `
    <div class="tut-intro-reference" aria-label="How to read robots and charging bays">
      <div class="tut-intro-row" ${kind === "features" ? "hidden" : ""}>
        <div class="tut-match-pair" aria-hidden="true">
          <span class="tut-match-robot">${icon("robot", "tut-match-robot-icon")}<i>1</i></span>
          <span class="tut-match-arrow">→</span>
          <span class="tut-match-bay"><i>1</i></span>
        </div>
        <span class="tut-intro-copy">
          <strong>Match the charging bay</strong>
          <small>Robot 1 returns to charging bay 1, and they share the same blue colour. The colour helps you find the right bay.</small>
        </span>
      </div>
      <div class="tut-intro-row" ${kind === "matching" ? "hidden" : ""}>
        <div class="tut-feature-robot" aria-hidden="true">
          ${icon("robot", "tut-feature-robot-icon")}
          <span class="tut-feature-number">1</span>
          <span class="tut-feature-type">A</span>
          <span class="tut-feature-direction">→</span>
        </div>
        <span class="tut-intro-copy">
          <strong>Each robot has two features</strong>
          <small><b>A</b> is its Robot type. <b>→</b> shows the direction it will move next.</small>
        </span>
      </div>
    </div>
  `;
}

function simpleOverviewReferenceMarkup(){
  return `<div class="tut-overview-editor-live" aria-label="Choose which robots wait">${simpleRuleBuilderMarkup()}</div>`;
}

function waitingReferenceMarkup(){
  return `<div class="story-wait-demo" role="img" aria-label="A robot matching your choices waits. The other robot goes first.">
    <div class="story-wait-example" aria-hidden="true">
      <span class="tut-match-robot is-waiting">${icon("robot", "tut-match-robot-icon")}<i>1</i></span>
      <strong>Waits</strong><span>Matches your choices</span>
    </div>
    <div class="story-wait-example" aria-hidden="true">
      <span class="story-go-robot"><span class="tut-match-robot">${icon("robot", "tut-match-robot-icon")}<i>2</i></span><b>→</b></span>
      <strong>Goes first</strong><span>Does not match</span>
    </div>
  </div>`;
}

function simpleTutorialFields(){
  const schema = typeof EXPORTED_RULE_SCHEMA !== "undefined"
    ? EXPORTED_RULE_SCHEMA
    : window.TASK_LIBRARY?.rule_schema;
  const families = PAGES[state.page]?.id === "simple_tabs" ? ["role", "move_dir"] : ["role"];
  return families.map(predicate => (schema?.fields || []).find(field => field.predicate === predicate)).filter(Boolean);
}

function simpleTutorialField(predicate){
  return simpleTutorialFields().find(field => field.predicate === predicate) || null;
}

function simpleEditorState(){
  // Exploring either tab must not preselect the later Type-only practice.
  return PAGES[state.page]?.id === "simple_tabs" ? state.simpleFeatureDemo : state;
}

function simpleTutorialSelectedValues(predicate){
  const editor = simpleEditorState();
  if(predicate !== editor.simpleFamily) return [];
  const field = simpleTutorialField(predicate);
  if(!field) return [];
  const selected = new Set((editor.simpleValues[predicate] || []).map(String));
  return field.values.filter(value => selected.has(String(value.id)));
}

function simpleTutorialVisibleValues(field){
  const scene = PAGES[state.page]?.scene;
  if(!field || !scene) return field?.values || [];
  const present = new Set(scene.agents.map(agent =>
    field.predicate === "role" ? agent.role : agent.movementArrow
  ));
  return field.values.filter(value => present.has(value.id));
}

function simpleTutorialRuleSentence(){
  const movement = simpleTutorialSelectedValues("move_dir");
  const role = simpleTutorialSelectedValues("role");
  if(!movement.length && !role.length) return "Nobody is selected to wait yet.";
  const clauses = [];
  if(movement.length){
    clauses.push(`it is moving ${naturalTutorialList(
      movement.map(value => value.symbol || value.id)
    )}`);
  }
  if(role.length){
    clauses.push(`it is ${naturalTutorialList(role.map(value => value.label))}`);
  }
  return `A robot waits if ${clauses.join(", or ")}.`;
}

function naturalTutorialList(items){
  if(items.length < 2) return items[0] || "";
  if(items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(", ")}, or ${items[items.length - 1]}`;
}

function simpleTutorialRules(){
  let index = 0;
  return simpleTutorialFields().flatMap(field =>
    simpleTutorialSelectedValues(field.predicate).map(value => ({
      id:9000 + index++,
      action:"MOVE",
      conds:[{
        object:field.object,
        property:field.id,
        p:field.predicate,
        v:value.id,
        negated:false,
      }],
      editor:null,
    }))
  );
}

function simpleTutorialValueCount(){
  return simpleTutorialFields().reduce(
    (count, field) => count + simpleTutorialSelectedValues(field.predicate).length,
    0,
  );
}

function simpleTutorialRepresentation(){
  const hasMovement = simpleTutorialSelectedValues("move_dir").length > 0;
  const hasRole = simpleTutorialSelectedValues("role").length > 0;
  if(hasMovement && hasRole) return "mixed";
  if(hasMovement) return "pure_movement";
  if(hasRole) return "pure_type";
  return "empty";
}

function simpleBuilderHelp(){
  if(PAGES[state.page]?.id !== "simple_practice") return "";
  if(state.simplePracticeSolved) return "Both robots are home.";
  return simpleTutorialValueCount() ? "Press Run to try it." : "Choose who waits.";
}

function simpleRuleBuilderMarkup(){
  const editor = simpleEditorState();
  const fields = simpleTutorialFields();
  const isPractice = PAGES[state.page]?.id === "simple_practice";
  const interactive = isPractice || PAGES[state.page]?.id === "simple_tabs";
  return `
    <div class="tut-simple-builder${fields.length === 1 ? " has-single-family" : ""}" aria-label="Choose who waits">
      <div class="simple-rule-context">WHEN TWO ROBOTS MEET</div>
      <section class="simple-rule-intro">
        <strong>Choose who waits</strong>
        <p>${isPractice ? "Choose a Type, then press Run." : "Choose one tab, then select one or more options."}</p>
      </section>
      ${fields.length > 1 ? `<div class="rule-family-tabs" role="tablist" aria-label="Robot feature">
        ${fields.map(field => `<button type="button" class="rule-family-tab" role="tab"
          id="tutorial-family-tab-${field.predicate}" data-tut-tab="${field.predicate}"
          aria-controls="tutorial-family-panel-${field.predicate}"
          aria-selected="${editor.simpleFamily === field.predicate}" tabindex="${editor.simpleFamily === field.predicate ? 0 : -1}">
          ${field.predicate === "role" ? "Type" : "Movement"}</button>`).join("")}
      </div>` : ""}
      <div class="simple-family-sections pure-family-panels">
        ${fields.map(field => {
          const selected = new Set((editor.simpleValues[field.predicate] || []).map(String));
          const heading = field.predicate === "role"
            ? `${icon("robot", "family-button-icon")}<strong>Robot type</strong>`
            : '<span class="family-arrow-icon" aria-hidden="true">↗</span><strong>Movement direction</strong>';
          return `<section class="simple-family-section family-${field.predicate}" id="tutorial-family-panel-${field.predicate}"
            ${fields.length > 1 ? `role="tabpanel" aria-labelledby="tutorial-family-tab-${field.predicate}"` : ""}
            ${editor.simpleFamily !== field.predicate ? "hidden" : ""}>
          <div class="simple-family-heading">${heading}</div>
          <div class="simple-value-grid">
            ${simpleTutorialVisibleValues(field).map(value => {
              const isSelected = selected.has(String(value.id));
              const mark = field.predicate === "role"
                ? `<span class="simple-role-swatch simple-type-swatch" style="--role-color:${SIMPLE_TYPE_COLOR}">${icon("robot", "simple-role-icon")}<span class="robot-type-letter simple-type-letter" aria-hidden="true">${simpleTypeLetter(value.id)}</span></span>`
                : `<span class="simple-role-swatch simple-type-swatch" style="--role-color:${SIMPLE_TYPE_COLOR}">${icon("robot", "simple-role-icon")}<span class="robot-type-letter simple-type-letter simple-movement-mark">${value.symbol || value.id}</span></span>`;
              return `<button class="simple-value-button tut-simple-value-button${isSelected ? " selected" : ""}" type="button"
                data-tut-family="${field.predicate}" data-tut-value="${value.id}" aria-pressed="${isSelected}" ${interactive ? "" : "disabled"}>
                ${mark}<span>${value.label}</span></button>`;
            }).join("")}
          </div>
        </section>`;
        }).join("")}
      </div>
      ${simpleTutorialValueCount() ? `
        <section class="simple-current-rule">
          <strong>${simpleTutorialRuleSentence()}</strong>
        </section>
      ` : ""}
      <p class="tut-simple-builder-help">${simpleBuilderHelp()}</p>
    </div>
  `;
}

function bindSimpleRuleBuilder(){
  const editor = simpleEditorState();
  const fields = simpleTutorialFields();
  const selectTab = (family, trigger) => {
    if(family === editor.simpleFamily || !fields.some(field => field.predicate === family)) return;
    const from = editor.simpleFamily;
    editor.simpleFamily = family;
    emit("tutorial_rule_family_changed", {from_family:from, to_family:family, trigger});
    renderReference(PAGES[state.page].reference);
    el(`tutorial-family-tab-${family}`)?.focus();
  };
  document.querySelectorAll("#tut-rule-reference [data-tut-tab]").forEach((button,index) => {
    button.onclick = () => selectTab(button.dataset.tutTab, "click");
    button.onkeydown = event => {
      const next = event.key === "ArrowRight" ? (index+1)%fields.length
        : event.key === "ArrowLeft" ? (index+fields.length-1)%fields.length
        : event.key === "Home" ? 0 : event.key === "End" ? fields.length-1 : null;
      if(next === null) return;
      event.preventDefault();
      selectTab(fields[next].predicate, "keyboard");
    };
  });
  document.querySelectorAll("#tut-rule-reference [data-tut-value]").forEach(button => {
    button.onclick = () => {
      const family = button.dataset.tutFamily;
      const isPractice = PAGES[state.page]?.id === "simple_practice";
      if(family !== editor.simpleFamily || (!isPractice && PAGES[state.page]?.id !== "simple_tabs")) return;
      const value = button.dataset.tutValue;
      const selected = new Set((editor.simpleValues[family] || []).map(String));
      if(selected.has(String(value))) selected.delete(String(value));
      else selected.add(String(value));
      const field = simpleTutorialField(family);
      editor.simpleValues[family] = field.values
        .filter(option => selected.has(String(option.id)))
        .map(option => option.id);
      if(isPractice) state.simplePracticeSolved = false;
      emit("tutorial_rule_value_toggled", {
        family,
        value,
        selected:selected.has(String(value)),
      });
      if(isPractice) resetCurrentScene();
      renderReference("simple_builder");
      updateContinueState();
    };
  });
}

const PRACTICE_TERMS = {
  practice:[
    {id:"marked", label:"marked", text:"the practice object is marked"},
  ],
};

function canContinueTutorial(){
  const page = PAGES[state.page];
  const requirement = page.requires;
  const reveal = currentProgressiveReveal();
  return !(
    (reveal && reveal.revealed < reveal.count) || state.timer !== null ||
    (requirement === "practice_solved" && !state.practiceSolved) ||
    (requirement === "movement_observed" && !state.simpleMovementObserved) ||
    (requirement === "collision_observed" && !state.simpleCollisionObserved) ||
    (requirement === "simple_practice" && !state.simplePracticeSolved)
  );
}

function updateContinueState(){
  const continueButton = el("tut-continue");
  if(continueButton) continueButton.disabled = !canContinueTutorial();
  const run = el("tut-run");
  if(run) run.disabled = state.timer !== null;
  el("tut-prev").disabled = state.timer !== null || !state.frames.length || state.frameIndex === 0;
  el("tut-next-step").disabled = state.timer !== null || !state.frames.length || state.frameIndex === state.frames.length - 1;
  renderProgressiveReveal();
}

function bindRulePractice(){
  const object = el("tut-practice-object");
  const fact = el("tut-practice-fact");
  const add = el("tut-practice-add");
  if(!object || !fact || !add) return;

  function updateFacts(){
    const terms = PRACTICE_TERMS[object.value] || [];
    fact.innerHTML = '<option value="">Select fact</option>' +
      terms.map(term => `<option value="${term.id}">${term.label}</option>`).join("");
    fact.disabled = !terms.length;
    add.disabled = true;
  }

  function updateAdd(){
    add.disabled = !(object.value && fact.value);
  }

  object.onchange = updateFacts;
  fact.onchange = updateAdd;
  add.onclick = () => {
    const term = (PRACTICE_TERMS[object.value] || []).find(row => row.id === fact.value);
    state.practiceCondition = {
      object:object.value,
      fact:fact.value,
      text:term?.text || "",
    };
    state.practiceSolved = false;
    emit("tutorial_condition_created", {...state.practiceCondition});
    resetCurrentScene();
    renderReference("rule");
    updateContinueState();
  };
}

function ruleReferenceMarkup(){
  const condition = state.practiceCondition;
  const step = !condition
    ? {label:"Step 1", text:"Choose Practice object and marked. Then click Add condition."}
    : !state.practiceSolved
      ? {label:"Step 2", text:"Click Run to test the rule."}
      : null;
  return `
    ${step ? `
      <div class="tut-rule-instruction">
        <span>${step.label}</span>
        <strong>${step.text}</strong>
      </div>
    ` : ""}
    <div class="tut-rule-example tut-rule-builder" aria-label="Practice rule builder">
      <div class="tut-rule-action">${CLEAN_RULE_LANGUAGE
        ? "<strong>A ROBOT WAITS</strong>"
        : "<span>FORBID</span><strong>MOVE INTO A SQUARE</strong>"}</div>
      ${condition ? `
        <div class="tut-rule-cond completed"><span>WHEN</span><b>${condition.text}</b></div>
        <div class="tut-practice-rule-actions">
          <button class="tut-change-condition" id="tut-change-condition" type="button">Change condition</button>
        </div>
      ` : `
        <div class="tut-practice-editor">
          <span>WHEN</span>
          <select id="tut-practice-object" aria-label="Condition object">
            <option value="">Select object</option>
            <option value="practice">Practice object</option>
          </select>
          <select id="tut-practice-fact" aria-label="Condition fact" disabled>
            <option value="">Select fact</option>
          </select>
          <button id="tut-practice-add" type="button" disabled>Add condition</button>
        </div>
      `}
    </div>
    <p class="tut-practice-help">${condition
      ? state.practiceSolved
        ? ""
        : "Condition added. Press Run to test it; use Change condition if it does not work."
      : "Run without a rule to observe the problem, then build the practice rule."}</p>
  `;
}

function libraryReferenceMarkup(){
  const text = state.practiceCondition?.text || "the robot is moving north";
  const action = CLEAN_RULE_LANGUAGE
    ? "<strong>A ROBOT WAITS</strong>"
    : "<span>FORBID</span> MOVE INTO A SQUARE";
  const summary = CLEAN_RULE_LANGUAGE
    ? `A ROBOT WAITS WHEN ${text}`
    : `FORBID MOVE INTO A SQUARE WHEN ${text}`;
  if(!state.practiceSaved){
    return `
      <div class="tut-library-instruction">
        <span>Optional</span>
        <strong>Save the rule from the previous task to make it available here, or start the task without saving it.</strong>
      </div>
      <div class="tut-library-demo">
        <section>
          <h3>Rule from the previous task</h3>
          <div class="tut-library-rule">
            <div>${action}</div>
            <div><span>WHEN</span> ${text}</div>
          </div>
          <button id="tut-save-practice" type="button">Save to library</button>
        </section>
        <section>
          <h3>Saved rule library</h3>
          <p class="tut-library-empty">No saved rules.</p>
        </section>
      </div>
    `;
  }
  return `
    <div class="tut-library-instruction ${state.practiceUsed ? "is-complete" : ""}">
      <span>${state.practiceUsed ? "Added" : "Saved"}</span>
      <strong>${state.practiceUsed
        ? "The saved rule is now in this task's rulebook."
        : "The rule remains in the library. Add it to this task's rulebook if you want to test it here."}</strong>
    </div>
    <div class="tut-library-demo">
      <section>
        <h3>Rules in this task</h3>
        ${state.practiceUsed ? `
          <div class="tut-library-rule">
            <div>${action}</div>
            <div><span>WHEN</span> ${text}</div>
          </div>
        ` : '<p class="tut-library-empty">No active rules.</p>'}
      </section>
      <section>
        <h3>Saved rule library</h3>
        <div class="tut-saved-row">
          <span>${summary}</span>
          <button class="${state.practiceUsed ? "" : "tut-next-action"}" id="tut-use-practice" type="button" ${state.practiceUsed ? "disabled" : ""}>
            ${state.practiceUsed ? "Added" : "Add to rulebook"}
          </button>
        </div>
      </section>
    </div>
  `;
}

function bindLibraryPractice(){
  const save = el("tut-save-practice");
  if(save){
    save.onclick = () => {
      state.practiceSaved = true;
      emit("tutorial_library_saved", {condition:state.practiceCondition?.text || null});
      renderReference("library");
      updateContinueState();
    };
  }
  const use = el("tut-use-practice");
  if(use){
    use.onclick = () => {
      state.practiceUsed = true;
      state.reuseSolved = false;
      emit("tutorial_library_used", {condition:state.practiceCondition?.text || null});
      resetCurrentScene();
      setFeedback(null, "The saved rule is active in this task. Press Run to test it.");
      renderReference("library");
      updateContinueState();
    };
  }
}

const MANAGER_NOTE_POINTS = [
  "Robots involved in a conflict stop. The others keep moving.",
  "Try a Run first to see where the problem is.",
  "Your choices carry over to the next task. Keep them or change them.",
  "Each Run starts all robots again. All must reach their bays in that Run.",
];

function managerNoteMarkup(){
  return `<aside class="manager-notebook" aria-labelledby="manager-note-title">
    <div class="manager-notebook-binding" aria-hidden="true">${Array.from({length:7}, () => "<i></i>").join("")}</div>
    <div class="manager-notebook-cover" aria-hidden="true">
      <div class="manager-cover-label"><span>WAREHOUSE</span><strong>Shift Notes</strong><small>From your predecessor</small></div>
      <span class="manager-cover-seam"></span>
    </div>
    <div class="manager-notebook-turn" aria-hidden="true"></div>
    <div class="manager-notebook-page">
      <span class="manager-notebook-bookmark" aria-hidden="true"></span>
      <p class="manager-note-from">A note from</p>
      <h2 id="manager-note-title">The previous warehouse manager</h2>
      <ol class="manager-note-list">
        ${MANAGER_NOTE_POINTS.map(point => `<li aria-hidden="true">${point}</li>`).join("")}
      </ol>
    </div>
  </aside>`;
}

function renderReference(kind){
  const host = el("tut-rule-reference");
  host.hidden = !kind;
  host.classList.toggle("is-intro-guide", ["intro_guide", "matching", "features"].includes(kind));
  host.classList.toggle("is-overview", kind === "overview");
  if(!kind) return;
  if(kind === "doc_matching"){
    host.innerHTML = `<img class="tutorial-doc-figure doc-figure-1" src="${ASSET_PREFIX}assets/tutorial-doc/figure-1.png" alt="Robot 1 and charging bay 1 have the same blue color.">`;
  }
  if(kind === "manager_note") host.innerHTML = managerNoteMarkup();
  if(kind === "map") host.innerHTML = mapReferenceMarkup();
  if(kind === "waiting") host.innerHTML = waitingReferenceMarkup();
  if(kind === "overview"){
    host.innerHTML = simpleOverviewReferenceMarkup();
    bindSimpleRuleBuilder();
  }
  if(kind === "intro_guide") host.innerHTML = simpleIntroReferenceMarkup();
  if(kind === "matching" || kind === "features") host.innerHTML = simpleIntroReferenceMarkup(kind);
  if(kind === "simple_builder"){
    host.innerHTML = simpleRuleBuilderMarkup();
    bindSimpleRuleBuilder();
  }
  if(kind === "rule"){
    host.innerHTML = ruleReferenceMarkup();
    bindRulePractice();
    const change = el("tut-change-condition");
    if(change){
      change.onclick = () => {
        state.practiceCondition = null;
        state.practiceSolved = false;
        state.practiceSaved = false;
        state.practiceUsed = false;
        state.reuseSolved = false;
        resetCurrentScene();
        renderReference("rule");
        updateContinueState();
      };
    }
  }
  if(kind === "library"){
    host.innerHTML = libraryReferenceMarkup();
    bindLibraryPractice();
  }
}

function currentProgressiveReveal(){
  if(tutorialMode !== "simple") return null;
  const page = PAGES[state.page];
  const textCount = 1 + page.points.length;
  const count = page.reference === "manager_note"
    ? Math.max(textCount, page.visualAfter + MANAGER_NOTE_POINTS.length)
    : textCount;
  return {id:page.id, count, textCount, limit:count, revealed:Math.min(state.storyRevealSteps[page.id] || 1, count)};
}

function progressiveRevealBlocks(){
  const points = Array.from(el("tut-points")?.children || []);
  return [el("tut-lead"), ...points].filter(Boolean).map(node => [node]);
}

function restoreDocumentLayout(){
  if(tutorialMode !== "simple") return;
  const panel = document.querySelector(".tut-panel");
  // Restore movable visuals before replacing paragraphs that may contain them.
  document.querySelector(".tut-body").append(panel);
  panel.append(el("tut-visual"), el("tut-rule-reference"));
  el("tut-visual").append(el("tut-controls"));
  panel.hidden = false;
}

function renderDocumentLayout(page){
  if(tutorialMode !== "simple") return;
  document.querySelector(".tut-body").classList.toggle("has-story-visual", !!(page.scene || page.reference));
  document.querySelector(".tut-panel").hidden = !(page.scene || page.reference);
}

function renderStoryPrompt(){
  const reveal = currentProgressiveReveal();
  const oldPrompt = el("tut-overview-reveal-prompt");
  if(!reveal){ oldPrompt?.remove(); return; }
  const prompt = oldPrompt || document.createElement("p");
  prompt.tabIndex = -1;
  prompt.setAttribute("role", "status");
  prompt.id = "tut-overview-reveal-prompt";
  prompt.className = "tut-story-prompt";
  const canReveal = state.timer === null && reveal.revealed < reveal.limit;
  const ready = canContinueTutorial();
  prompt.setAttribute("aria-disabled", String(!canReveal && !ready));
  prompt.textContent = canReveal || ready
    ? "Press Space to continue"
      : state.timer !== null ? "Watch the robots..."
        : PAGES[state.page].id === "simple_practice" ? "Get both robots home to continue"
          : "Press Run to watch what happens";
  if(!oldPrompt) el("tutorial-screen")?.querySelector(".onboarding-footer")?.appendChild(prompt);
}

function renderProgressiveReveal(){
  const reveal = currentProgressiveReveal();
  const blocks = reveal ? progressiveRevealBlocks() : [];
  const currentBlocks = new Set(blocks.flat());
  document.body.classList.toggle("linear-tutorial", !!reveal);
  document.body.classList.toggle("document-tutorial", !!reveal);
  document.body.classList.toggle("viewport-tutorial", !!reveal);
  document.querySelector(".tut-body")?.classList.toggle("is-progressive-overview", !!reveal);
  const continueButton = el("tut-continue");
  if(continueButton) continueButton.hidden = !!reveal;
  document.querySelectorAll(".overview-reveal-block").forEach(node => {
    if(currentBlocks.has(node)) return;
    node.classList.remove("overview-reveal-block", "is-overview-visible");
    node.removeAttribute("aria-hidden");
  });
  if(reveal){
    blocks.forEach((block, index) => block.forEach(node => {
      const visible = index === 0 || index === Math.min(reveal.revealed, reveal.textCount) - 1;
      node.classList.add("overview-reveal-block");
      node.classList.toggle("is-overview-visible", visible);
      node.setAttribute("aria-hidden", String(!visible));
    }));
    const page = PAGES[state.page];
    document.querySelector(".tut-panel").hidden = !(page.scene || page.reference) || reveal.revealed <= (page.visualAfter || 0);
    if(page.reference === "manager_note"){
      document.querySelector(".tut-body").classList.toggle("has-story-visual", reveal.revealed > page.visualAfter);
      document.querySelectorAll(".manager-note-list li").forEach((node, index) => {
        const visible = index < reveal.revealed - page.visualAfter;
        node.classList.toggle("is-note-visible", visible);
        node.setAttribute("aria-hidden", String(!visible));
      });
    }
    el("tut-controls").hidden = !page.scene || !page.controls || reveal.revealed <= (page.controlsAfter || 0);
    el("tut-back").disabled = state.page === 0 && reveal.revealed === 1;
  }
  renderStoryPrompt();
  if(reveal) window.TutorialEmphasis?.render({
    pageId:reveal.id, blocks, revealed:reveal.revealed,
  });
}

function revealNextBlock(trigger){
  const reveal = currentProgressiveReveal();
  if(!reveal || state.timer !== null || reveal.revealed >= reveal.limit) return false;
  state.storyRevealSteps[reveal.id] = reveal.revealed + 1;
  renderProgressiveReveal();
  updateContinueState();
  const page = PAGES[state.page];
  if(page.scene && !document.querySelector(".tut-panel").hidden){
    drawBoard(el("tut-board"), page.scene, state.frames[state.frameIndex] || null);
  }
  emit("tutorial_story_block_revealed", {
    tutorial_page:reveal.id,
    reveal_step:state.storyRevealSteps[reveal.id],
    reveal_step_count:reveal.count,
    reveal_trigger:trigger,
  });
  return true;
}

function advanceStory(trigger){
  const screen = el("tutorial-screen");
  if(tutorialMode !== "simple" || !screen || screen.hidden) return false;
  if(revealNextBlock(trigger)) return true;
  if(!canContinueTutorial()) return false;
  emit("tutorial_story_advanced", {tutorial_page:PAGES[state.page].id, trigger});
  if(state.page === PAGES.length - 1) completeTutorial();
  else renderPage(state.page + 1);
  return true;
}

function handleTutorialKeydown(event){
  if(tutorialMode !== "simple" || el("tutorial-screen")?.hidden || event.key !== " ") return;
  if(event.ctrlKey || event.metaKey || event.altKey) return;
  if(event.target?.closest?.("input, textarea, select, [contenteditable=true]")) return;
  // Space advances the story, never activates a focused Run, tab or Back button.
  event.preventDefault();
  event.stopPropagation();
  if(!event.repeat) advanceStory("space");
}

function goBackTutorial(){
  const reveal = currentProgressiveReveal();
  if(reveal?.revealed > 1){
    state.storyRevealSteps[reveal.id] = reveal.revealed - 1;
    updateContinueState();
    emit("tutorial_story_back", {tutorial_page:reveal.id, reveal_step:reveal.revealed - 1});
    el("tut-overview-reveal-prompt")?.focus({preventScroll:true});
  }else{
    renderPage(state.page - 1);
  }
}

function recordPageVisit(){
  if(!state.pageStartedAt) return;
  state.pageVisits.push({
    page_id:PAGES[state.page].id,
    duration_ms:Date.now() - state.pageStartedAt,
  });
}

function hideOnboardingScreens(){
  ["ethics-screen", "instructions-screen", "tutorial-screen", "comprehension-screen"].forEach(id => {
    const screen = el(id);
    if(screen) screen.hidden = true;
  });
}

function setOnboardingActive(active){
  document.body.classList.toggle("tutorial-active", active);
  const task = document.querySelector(".wrap");
  if(active) task?.setAttribute("aria-hidden", "true");
  else task?.removeAttribute("aria-hidden");
}

function renderInstructionStep(index){
  instructionStep = Math.max(0, Math.min(index, INSTRUCTION_STEPS.length - 1));
  const step = INSTRUCTION_STEPS[instructionStep];
  el("instruction-step-label").textContent = step.label;
  const instructionTitle = el("instruction-step-title");
  instructionTitle.textContent = step.title;
  instructionTitle.hidden = !step.title;
  el("instruction-step-lead").textContent = step.lead;
  el("instruction-step-points").innerHTML = step.points.map(point => `<li>${point}</li>`).join("");
  el("instruction-visual").innerHTML = step.visual();
  el("instruction-progress-label").textContent = `${instructionStep + 1} of ${INSTRUCTION_STEPS.length}`;
  el("instruction-progress-bar").style.width = `${((instructionStep + 1) / INSTRUCTION_STEPS.length) * 100}%`;
  el("instruction-back").disabled = instructionStep === 0;
  el("instruction-next").textContent = instructionStep === INSTRUCTION_STEPS.length - 1
    ? instructionReviewMode ? "Return to task" : "Start tutorial"
    : "Next";
  el("instruction-dots").innerHTML = INSTRUCTION_STEPS.map((row, stepIndex) => {
    const className = stepIndex === instructionStep ? "is-active" : stepIndex < instructionStep ? "is-complete" : "";
    return `<span class="${className}"></span>`;
  }).join("");
  emit("instruction_step_viewed", {
    instruction_step:instructionStep + 1,
    instruction_step_id:step.label,
    review:instructionReviewMode,
  });
}

function closeInstructionReview(){
  hideOnboardingScreens();
  setOnboardingActive(false);
  window.scrollTo(0, 0);
  emit("instructions_closed", {review:true});
}

function beginInteractiveTutorial(){
  hideOnboardingScreens();
  setOnboardingActive(true);
  const screen = el("tutorial-screen");
  if(!screen){
    finish();
    return;
  }
  screen.hidden = false;
  emit("interactive_tutorial_started", {page_count:PAGES.length});
  renderPage(state.page);
  (tutorialMode === "simple" ? el("tut-overview-reveal-prompt") : el("tut-continue"))?.focus({preventScroll:true});
}

function openInstructions(review=false){
  instructionReviewMode = !!review;
  instructionStep = 0;
  hideOnboardingScreens();
  setOnboardingActive(true);
  const screen = el("instructions-screen");
  if(!screen){
    if(instructionReviewMode) closeInstructionReview();
    else beginInteractiveTutorial();
    return;
  }
  screen.hidden = false;
  emit("instructions_opened", {review:instructionReviewMode});
  renderInstructionStep(0);
  el("instruction-next").focus();
}

function updateEthicsAgreement(){
  const sheet = el("ethics-scroll");
  const agree = el("ethics-agree");
  if(!sheet || !agree) return;
  const available = Math.max(1, sheet.scrollHeight - sheet.clientHeight);
  const depth = Math.min(1, sheet.scrollTop / available);
  [25, 50, 75, 100].forEach(threshold => {
    if(depth * 100 >= threshold && !consentScrollDepths.has(threshold)){
      consentScrollDepths.add(threshold);
      emit("consent_scroll_depth", {percent:threshold});
    }
  });
  const reachedBottom = sheet.scrollTop + sheet.clientHeight >= sheet.scrollHeight - 12;
  agree.disabled = !reachedBottom;
}

function showEthicsScreen(){
  hideOnboardingScreens();
  setOnboardingActive(true);
  const screen = el("ethics-screen");
  if(!screen){
    beginInteractiveTutorial();
    return;
  }
  screen.hidden = false;
  const sheet = el("ethics-scroll");
  if(sheet) sheet.scrollTop = 0;
  updateEthicsAgreement();
  emit("participant_information_viewed", {ethics_reference:"979409"});
}

function renderPage(index){
  recordPageVisit();
  const previousPage = PAGES[state.page];
  if(tutorialMode === "simple" && previousPage.scene && state.result && state.timer === null){
    state.storySceneViews[previousPage.id] = {
      result:structuredClone(state.result), frameIndex:state.frameIndex,
    };
  }
  stopAnimation();
  state.page = Math.max(0, Math.min(index, PAGES.length - 1));
  state.pageStartedAt = Date.now();
  const page = PAGES[state.page];
  restoreDocumentLayout();
  if(tutorialMode === "simple") el("tutorial-screen").dataset.storyPage = page.id;
  if(page.id === "simple_practice") state.simpleFamily = "role";
  if(page.id === "simple_practice" && state.simpleValues.move_dir.length){
    state.simpleValues.move_dir = [];
    state.simplePracticeSolved = false;
  }

  el("tut-title").textContent = page.title;
  el("tut-lead").textContent = page.lead;
  el("tut-points").hidden = page.points.length === 0;
  el("tut-points").innerHTML = page.points.map(point => `<li>${point}</li>`).join("");

  const visual = el("tut-visual");
  const ruleReference = el("tut-rule-reference");
  const isRulePractice = page.id === "rules" || page.id === "library" ||
    page.id === "simple_practice" || page.id === "simple_features";
  document.querySelector(".tut-panel")?.classList.toggle(
    "has-rule-practice",
    isRulePractice,
  );
  document.querySelector(".tut-body")?.classList.toggle(
    "has-rule-practice",
    isRulePractice,
  );
  document.querySelector(".tut-body")?.classList.toggle(
    "has-intro-guide-page",
    page.id === "simple_features",
  );
  document.querySelector(".tut-body")?.classList.toggle(
    "has-overview-page",
    page.id === "simple_overview",
  );
  visual.hidden = !page.scene;
  if(page.id === "simple_overview"){
    visual.setAttribute("aria-label", "Two differently coloured robots approach the same square on routes to their matching charging bays.");
  }else{
    visual.removeAttribute("aria-label");
  }
  ruleReference.hidden = !page.reference;
  el("tut-controls").hidden = !page.scene || !page.controls;
  renderReference(page.reference);
  renderDocumentLayout(page);

  if(page.scene){
    const savedView = state.storySceneViews[page.id];
    if(savedView){
      state.result = structuredClone(savedView.result);
      state.frames = state.result.frames || [];
      showFrame(savedView.frameIndex, false, "page-return");
    }else{
      resetCurrentScene();
    }
  }else{
    state.result = null;
    state.frames = [];
    state.frameIndex = 0;
  }
  renderProgressiveReveal();

  el("tut-progress-label").textContent = `${state.page + 1} of ${PAGES.length}`;
  el("tut-progress-bar").style.width = `${((state.page + 1) / PAGES.length) * 100}%`;
  const backButton = el("tut-back");
  if(backButton) backButton.disabled = state.page === 0;
  const continueButton = el("tut-continue");
  if(continueButton) continueButton.textContent = state.page === PAGES.length - 1 ? "Continue" : "Next";
  updateContinueState();
  el("tut-dots").innerHTML = PAGES.map((row, pageIndex) => {
    const className = pageIndex === state.page ? "is-active" : pageIndex < state.page ? "is-complete" : "";
    return `<span class="${className}"></span>`;
  }).join("");

  emit("tutorial_page_viewed", {
    tutorial_page:page.id,
    tutorial_page_index:state.page,
  });
  if(tutorialMode === "simple"){
    el("tutorial-screen").dataset.storyPage = page.id;
    const focusTarget = el("tut-overview-reveal-prompt");
    focusTarget?.focus({preventScroll:true});
  }
}

function completeTutorial(){
  if(tutorialMode === "simple" && (!state.simplePracticeSolved || !state.simpleMovementObserved || !state.simpleCollisionObserved)) return;
  recordPageVisit();
  stopAnimation();
  window.tutorialReport = {
    duration_ms:Date.now() - state.startedAt,
    page_visits:state.pageVisits,
    runs:state.runs,
    practice:{
      condition_created:!!state.practiceCondition,
      rule_solved:state.practiceSolved,
      library_saved:state.practiceSaved,
      library_used:state.practiceUsed,
      reuse_solved:state.reuseSolved,
      simple_representation:simpleTutorialRepresentation(),
      simple_movement_values:state.simpleValues.move_dir.slice(),
      simple_role_values:state.simpleValues.role.slice(),
      movement_observed:state.simpleMovementObserved,
      collision_observed:state.simpleCollisionObserved,
      simple_rule_solved:state.simplePracticeSolved,
    },
    comprehension_attempts:[],
  };
  emit("tutorial_completed", {
    duration_ms:window.tutorialReport.duration_ms,
    run_count:state.runs.length,
    practice_protocol:tutorialMode === "simple" ? SIMPLE_PRACTICE_PROTOCOL : null,
  });
  if(standaloneStage === "tutorial"){
    finish();
    return;
  }
  showComprehension();
}

function comprehensionResponses(){
  const responses = {};
  Object.keys(COMPREHENSION_ANSWERS).forEach(name => {
    responses[name] = document.querySelector(`input[name="${name}"]:checked`)?.value || null;
  });
  return responses;
}

function updateComprehensionState(){
  const responses = comprehensionResponses();
  const answered = Object.values(responses).filter(Boolean).length;
  el("comprehension-check").disabled = answered !== Object.keys(COMPREHENSION_ANSWERS).length;
}

function resetComprehension(){
  el("comprehension-form").reset();
  el("comprehension-questions").hidden = false;
  el("comprehension-result").hidden = true;
  el("comprehension-retry").hidden = true;
  el("comprehension-start").hidden = true;
  updateComprehensionState();
  window.StudyData?.saveCheckpoint("comprehension", {attempt:comprehensionAttempt, responses:{}, result:null});
  el("comprehension-form").querySelector("input")?.focus();
}

function configureConditionQuestion(){
  const options = CONTINUATION_CONDITION === "local"
    ? {
        a:"Every robot on the map stops.",
        b:"All robots immediately reach their charging bays.",
        c:"The robots in the conflict stop, while other robots keep moving.",
        d:"Your choices are cleared.",
      }
    : {
        a:"Only the two robots in the conflict stop; all others keep moving.",
        b:"All robots immediately reach their charging bays.",
        c:"Every robot on the map stops.",
        d:"Your choices are cleared.",
      };
  Object.entries(options).forEach(([key, copy]) => {
    const target = el(`comprehension-condition-${key}`);
    if(target) target.textContent = copy;
  });
}

function showComprehension(){
  hideOnboardingScreens();
  setOnboardingActive(true);
  const screen = el("comprehension-screen");
  if(!screen){
    setOnboardingActive(false);
    finish();
    return;
  }
  configureConditionQuestion();
  const saved = window.StudyData?.checkpoint("comprehension");
  resetComprehension();
  if(saved){
    comprehensionAttempt = saved.attempt || 0;
    for(const [name, value] of Object.entries(saved.responses || {})){
      const input = el("comprehension-form").querySelector(`input[name="${name}"][value="${value}"]`);
      if(input) input.checked = true;
    }
    updateComprehensionState();
    if(saved.result) showComprehensionResult(saved.result.passed);
    window.StudyData?.saveCheckpoint("comprehension", saved);
  }
  screen.hidden = false;
  emit("comprehension_opened", {question_count:Object.keys(COMPREHENSION_ANSWERS).length});
  window.scrollTo(0, 0);
}

function checkComprehension(){
  const responses = comprehensionResponses();
  if(Object.values(responses).some(value => !value)) return;
  comprehensionAttempt += 1;
  const passed = Object.entries(COMPREHENSION_ANSWERS)
    .every(([name, answer]) => responses[name] === answer);
  const record = {
    attempt:comprehensionAttempt,
    passed,
    responses,
    timestamp:Date.now(),
  };
  window.tutorialReport?.comprehension_attempts.push(record);
  emit("comprehension_submitted", record);
  window.StudyData?.saveCheckpoint("comprehension", {attempt:comprehensionAttempt, responses, result:record});
  showComprehensionResult(passed);
}

function showComprehensionResult(passed){
  el("comprehension-questions").hidden = true;
  el("comprehension-result").hidden = false;
  el("comprehension-result-title").textContent = passed ? "You are ready" : "Please try again";
  el("comprehension-result-copy").textContent = passed
    ? "All four answers are correct."
    : "Some answers were not correct. Please answer all four questions again.";
  el("comprehension-start").hidden = !passed;
  el("comprehension-retry").hidden = passed;
  (passed ? el("comprehension-start") : el("comprehension-retry")).focus();
}

function startTaskAfterComprehension(){
  hideOnboardingScreens();
  setOnboardingActive(false);
  window.scrollTo(0, 0);
  emit("comprehension_passed", {attempts:comprehensionAttempt});
  finish();
}

function bind(){
  const on = (id, handler) => {
    const node = el(id);
    if(node) node.onclick = handler;
  };
  on("tut-run", runCurrentScene);
  on("tut-reset", () => resetCurrentScene("manual"));
  on("tut-prev", () => {
    if(state.timer !== null) return;
    stopAnimation();
    showFrame(state.frameIndex - 1, true, "manual");
  });
  on("tut-next-step", () => {
    if(state.timer !== null) return;
    stopAnimation();
    showFrame(state.frameIndex + 1, true, "manual");
  });
  on("tut-back", goBackTutorial);
  on("tut-continue", () => {
    if(!canContinueTutorial()) return;
    if(state.page === PAGES.length - 1) completeTutorial();
    else renderPage(state.page + 1);
  });
  on("ethics-agree", () => {
    emit("consent_agreed", {ethics_reference:"979409"});
    if(standaloneStage === "consent") finish();
    else openInstructions(false);
  });
  const ethicsScroll = el("ethics-scroll");
  if(ethicsScroll) ethicsScroll.onscroll = updateEthicsAgreement;
  on("instruction-back", () => renderInstructionStep(instructionStep - 1));
  on("instruction-next", () => {
    if(instructionStep < INSTRUCTION_STEPS.length - 1){
      renderInstructionStep(instructionStep + 1);
      return;
    }
    if(instructionReviewMode) closeInstructionReview();
    else if(standaloneStage === "instructions") finish();
    else beginInteractiveTutorial();
  });
  const comprehensionForm = el("comprehension-form");
  if(comprehensionForm){
    comprehensionForm.onchange = event => {
      updateComprehensionState();
      emit("comprehension_option_selected", {
        question:event.target?.name || null,
        response:event.target?.value || null,
      });
    };
  }
  on("comprehension-check", checkComprehension);
  on("comprehension-retry", resetComprehension);
  on("comprehension-start", startTaskAfterComprehension);
}

function resizeTutorialLayout(){
  if(viewportResizeTimer) clearTimeout(viewportResizeTimer);
  viewportResizeTimer = setTimeout(() => {
    viewportResizeTimer = null;
    const screen = el("tutorial-screen");
    const page = PAGES[state.page];
    if(!screen || screen.hidden || !page?.scene) return;
    const frame = state.frames.length ? state.frames[state.frameIndex] : null;
    drawBoard(el("tut-board"), page.scene, frame);
  }, 120);
}

function startTutorial(options={}, mode="standard"){
    tutorialMode = mode;
    standaloneStage = options.standaloneStage || null;
    PAGES = mode === "simple" ? SIMPLE_PAGES : DEFAULT_PAGES;
    emit = (type, detail) => {
      options.log?.(type, {...detail, tutorial_story_protocol:mode === "simple" ? STORY_PROTOCOL : null});
      if(standaloneStage === "tutorial"){
        const {timer, result, frames, ...saved} = state;
        window.StudyData?.saveCheckpoint("tutorial", saved);
      }
      if(standaloneStage === "comprehension" && type === "comprehension_option_selected"){
        window.StudyData?.saveCheckpoint("comprehension", {attempt:comprehensionAttempt, responses:comprehensionResponses(), result:null});
      }
    };
    finish = options.onComplete || (() => {});
    state.startedAt = Date.now();
    state.pageStartedAt = 0;
    state.pageVisits = [];
    state.runs = [];
    state.practiceCondition = null;
    state.practiceSolved = false;
    state.practiceSaved = false;
    state.practiceUsed = false;
    state.reuseSolved = false;
    state.simpleCollisionObserved = false;
    state.simpleMovementObserved = false;
    state.simpleValues = {move_dir:[], role:[]};
    state.simpleFamily = "role";
    state.simpleFeatureDemo = {simpleFamily:"role", simpleValues:{move_dir:[], role:[]}};
    state.ruleEditorProtocol = window.STUDY_CONFIG?.rule_editor_protocol;
    state.simplePracticeSolved = false;
    state.simplePracticeSceneId = SIMPLE_PRACTICE_SCENE.id;
    state.overviewRevealStep = 0;
    state.featuresRevealStep = 0;
    state.storyProtocol = STORY_PROTOCOL;
    state.storyRevealSteps = {};
    state.storySceneViews = {};
    state.page = 0;
    if(standaloneStage === "tutorial"){
      const saved = window.StudyData?.checkpoint("tutorial");
      if(saved && saved.storyProtocol === STORY_PROTOCOL && saved.ruleEditorProtocol === state.ruleEditorProtocol &&
        ["move_dir", "role"].includes(saved.simpleFamily) &&
        Number.isInteger(saved.page) && PAGES[saved.page]) Object.assign(state, saved);
      if(state.simplePracticeSceneId !== SIMPLE_PRACTICE_SCENE.id){
        state.simplePracticeSolved = false;
        state.simplePracticeSceneId = SIMPLE_PRACTICE_SCENE.id;
      }
    }
    state.simpleFamily = "role";
    state.simpleValues.move_dir = [];
    comprehensionAttempt = 0;
    consentScrollDepths.clear();
    bind();
    document.removeEventListener("keydown", handleTutorialKeydown, true);
    document.addEventListener("keydown", handleTutorialKeydown, true);
    window.addEventListener("resize", resizeTutorialLayout, {passive:true});
    emit("tutorial_started", {
      page_count:PAGES.length,
      tutorial_mode:tutorialMode,
      continuation_condition:CONTINUATION_CONDITION,
      practice_protocol:tutorialMode === "simple" ? SIMPLE_PRACTICE_PROTOCOL : null,
    });
    if(mode !== "simple"){
      beginInteractiveTutorial();
      return;
    }
    if(options.startAt === "instructions"){
      openInstructions(false);
      return;
    }
    if(options.startAt === "tutorial"){
      beginInteractiveTutorial();
      return;
    }
    if(options.startAt === "comprehension"){
      window.tutorialReport = {
        duration_ms:0,
        page_visits:[],
        runs:[],
        practice:{},
        comprehension_attempts:[],
      };
      showComprehension();
      return;
    }
    showEthicsScreen();
}

window.ResearchTutorial = {
  start(options={}){
    startTutorial(options, "standard");
  },
  startSimple(options={}){
    startTutorial(options, "simple");
  },
  startSimpleStage(options={}){
    startTutorial({
      ...options,
      startAt:options.stage || "consent",
      standaloneStage:options.stage || "consent",
    }, "simple");
  },
};

})();
