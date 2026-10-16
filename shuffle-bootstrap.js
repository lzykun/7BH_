/* Build the task library and lock each formal participant to one study arm. */
(() => {
  const pool = window.SHARED_POOL;
  const url = new URL(location.href);
  const p = window.StudyData?.params || url.searchParams;
  const preview = p.get('preview') === '1';
  const formalSchedules = ['jump-2'];
  const previewSchedules = window.STUDY_CONFIG.preview_only ? window.STUDY_CONFIG.preview_conditions : formalSchedules;
  const armLabels = {
    'all-local':'all-local',
    'jump-2':'early-jump',
    'jump-5':'late-jump',
  };
  const connectedRoadItems = new Set([
    'T4', 'T5', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6',
  ]);
  const inferredStage = document.body?.dataset.stage || p.get('stage') ||
    (location.pathname.split('/').pop() || '').replace('.html', '') || 'consent';
  const needsServerAssignment = !preview && /^https?:$/.test(location.protocol) &&
    p.get('assignment_source') !== 'server-block';
  if(needsServerAssignment){
    const entry = new URL('../index.html', location.href);
    entry.search = url.search;
    location.replace(entry.href);
    return;
  }

  function storedAssignmentKey(){
    const identity = p.get('PROLIFIC_PID') || p.get('participant_id') ||
      p.get('participant') || p.get('session') || 'anonymous';
    return 'robot-study-assignment:' + pool.version + ':' + identity;
  }

  function readStoredAssignment(){
    try{
      const value = localStorage.getItem(storedAssignmentKey());
      return formalSchedules.includes(value) ? value : null;
    }catch(error){
      return null;
    }
  }

  function storeAssignment(value){
    try{
      localStorage.setItem(storedAssignmentKey(), value);
    }catch(error){
      // The assignment also remains in the URL for the full session.
    }
  }

  function randomAssignment(){
    if(window.crypto?.getRandomValues){
      const draw = new Uint32Array(1);
      window.crypto.getRandomValues(draw);
      return formalSchedules[draw[0] % formalSchedules.length];
    }
    return formalSchedules[Math.floor(Math.random() * formalSchedules.length)];
  }

  let schedule;
  let assignmentSource;
  if(preview){
    schedule = previewSchedules.includes(p.get('schedule')) ? p.get('schedule') : formalSchedules[0];
    assignmentSource = 'researcher-preview';
  }else{
    const stored = readStoredAssignment();
    const carried = formalSchedules.includes(p.get('assigned_condition'))
      ? p.get('assigned_condition') : null;
    const serverCarried = p.get('assignment_source') === 'server-block' ? carried : null;
    schedule = serverCarried || stored || carried || randomAssignment();
    assignmentSource = serverCarried ? 'server-block' : stored ? 'stored' : carried ? 'carried-url' : 'random';
    storeAssignment(schedule);
  }

  const inspect = preview && p.get('mode') === 'inspect';
  const requested = Number(p.get('trial'));
  const startIndex = inspect && Number.isInteger(requested)
    ? Math.max(0, Math.min(pool.sequences[schedule].materials.length - 1, requested - 1)) : 0;
  const continuation = 'local';
  const taskPage = inferredStage === 'task';
  // The guided tutorial runs on the task page, so only an explicit request skips it.
  const skipTutorialRequested = url.searchParams.get('skipTutorial') === '1';

  p.set('schedule', schedule);
  p.set('assigned_condition', schedule);
  p.set('assignment_arm', armLabels[schedule] || 'researcher-preview');
  p.set('mode', inspect ? 'inspect' : 'sequence');
  p.set('condition', 'carry');
  p.set('continuation', continuation);
  p.set('order', inspect ? 'free' : 'curriculum');
  p.set('trial', String(startIndex + 1));
  p.set('v', pool.version);
  if(inspect) p.set('access', 'always');
  else p.delete('access');
  if(preview) p.set('preview', '1');
  else p.delete('preview');
  if(taskPage || inspect){
    if(inspect || skipTutorialRequested) p.set('skipTutorial', '1');
    else p.delete('skipTutorial');
    p.delete('stage');
  }else{
    p.delete('skipTutorial');
    p.set('stage', inferredStage);
  }
  window.StudyData?.syncParams?.(p);
  if(preview || location.protocol === 'file:' || !window.StudyData){
    url.search = p.toString();
    history.replaceState(null, '', url);
  }

  const sequence = pool.sequences[schedule];

  function taskWithConnectedRoad(name, index){
    const task = structuredClone(pool.bank[name]);
    if(connectedRoadItems.has(name)){
      // Move the redundant square beside Robot 7 to the space beside Robot 8.
      // This clarifies the road shape without changing any planned route.
      task.world.walls = task.world.walls
        .filter(([row, col]) => row !== 12 || col !== 5);
      if(!task.world.walls.some(([row, col]) => row === 13 && col === 4)){
        task.world.walls.push([13, 4]);
      }
    }
    return {
      ...task,
      label:`T${index + 1}`,
      level:index + 1,
      measure:{phase:index < pool.prefix_length ? 'expansion' : 'shuffle', index:index + 1},
      starter_rulebook:inspect ? pool.vocabulary.role
        .filter((_, bit) => sequence.reference[index].carried_mask & (1 << bit))
        .map(v => ({conds:[{p:'role', v, negated:false}]})) : [],
    };
  }

  window.TASK_LIBRARY = {
    ...structuredClone(pool.template),
    condition:'carry',
    schedule,
    assignment_arm:armLabels[schedule] || 'researcher-preview',
    experiment_version:pool.version,
    study_preview:preview,
    tasks:sequence.materials.map(taskWithConnectedRoad),
  };
  window.EXPERIMENT_ASSIGNMENT = {
    schedule,
    arm:armLabels[schedule] || 'researcher-preview',
    source:assignmentSource,
    formal:!preview,
    policy:window.STUDY_CONFIG?.assignment_policy || 'early-jump-only-v1',
  };
  window.SHUFFLE_PREVIEW = {
    schedule,
    inspect,
    startIndex,
    continuation,
    preview,
    version:pool.version,
    assignment:window.EXPERIMENT_ASSIGNMENT,
  };

  function mountTestConditionSwitcher(){}

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mountTestConditionSwitcher, {once:true});
  }else{
    mountTestConditionSwitcher();
  }
})();
