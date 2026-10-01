/* Build the task library and lock each formal participant to one study arm. */
(() => {
  const pool = window.SHARED_POOL;
  const url = new URL(location.href);
  const p = window.StudyData?.params || url.searchParams;
  const preview = p.get('preview') === '1';
  const formalSchedules = ['all-local', 'jump-2', 'jump-5'];
  const armLabels = {
    'all-local':'all-local',
    'jump-2':'early-jump',
    'jump-5':'late-jump',
  };
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
    schedule = Object.hasOwn(pool.sequences, p.get('schedule')) ? p.get('schedule') : 'all-local';
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
    ? Math.max(0, Math.min(10, requested - 1)) : 0;
  const continuation = 'local';
  const taskPage = inferredStage === 'task';

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
    p.set('skipTutorial', '1');
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
  window.TASK_LIBRARY = {
    ...structuredClone(pool.template),
    condition:'carry',
    schedule,
    assignment_arm:armLabels[schedule] || 'researcher-preview',
    experiment_version:pool.version,
    study_preview:preview,
    tasks:sequence.materials.map((name, index) => ({
      ...structuredClone(pool.bank[name]),
      label:`T${index + 1}`,
      level:index + 1,
      measure:{phase:index < 5 ? 'expansion' : 'shuffle', index:index + 1},
      starter_rulebook:pool.vocabulary.movement
        .filter((_, bit) => sequence.reference[index].carried_mask & (1 << bit))
        .map(v => ({conds:[{p:'move_dir', v, negated:false}]})),
    })),
  };
  window.EXPERIMENT_ASSIGNMENT = {
    schedule,
    arm:armLabels[schedule] || 'researcher-preview',
    source:assignmentSource,
    formal:!preview,
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

  function mountTestConditionSwitcher(){
    if(['555bighamsome.github.io', 'lzykun.github.io'].includes(location.hostname)) return;
    if(!(preview || location.protocol === 'file:') || document.querySelector('.test-condition-switcher')) return;
    const switcher = document.createElement('aside');
    switcher.className = 'test-condition-switcher';
    switcher.setAttribute('aria-label', 'Test condition');
    switcher.innerHTML = `
      <span>Test condition</span>
      <div role="group" aria-label="Choose a condition">
        ${formalSchedules.map(value => `
          <button type="button" data-test-schedule="${value}"${value === schedule ? ' aria-pressed="true" class="is-active"' : ' aria-pressed="false"'}>
            ${{'all-local':'All-local','jump-2':'Early jump','jump-5':'Late jump'}[value]}
          </button>
        `).join('')}
      </div>
    `;
    switcher.querySelectorAll('[data-test-schedule]').forEach(button => {
      button.addEventListener('click', () => {
        const nextSchedule = button.dataset.testSchedule;
        if(nextSchedule === schedule) return;
        const next = new URL(location.href);
        next.searchParams.set('preview', '1');
        next.searchParams.set('schedule', nextSchedule);
        next.searchParams.set('assigned_condition', nextSchedule);
        next.searchParams.set('assignment_arm', armLabels[nextSchedule]);
        next.searchParams.set('assignment_source', 'researcher-preview');
        next.searchParams.set('v', pool.version);
        location.assign(next.href);
      });
    });
    document.body.appendChild(switcher);
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', mountTestConditionSwitcher, {once:true});
  }else{
    mountTestConditionSwitcher();
  }
})();
