function studyBothWaitingFeedback(scene, result, norms, labelForAgent) {
  if(result.ok) return null;
  const final = result.frames?.at(-1);
  if(!final) return null;
  const events = [...(final.failureEvents || []), ...(final.simultaneousEvents || []), final.event];
  const pairs = [];
  const seen = new Set();
  for(const event of events) {
    if(event?.type !== "timeout" || event.agents?.length !== 2) continue;
    const ids = event.agents.map(String);
    const agents = ids.map(id => scene.agents.find(agent => agent.active && String(agent.id) === id));
    const states = ids.map(id => final.agents?.[id]);
    if(agents.some(agent => !agent) || states.some(state => !state?.waiting || state.done || state.intent?.kind !== "move")) continue;
    if(!sameCell(states[0].intent.cell, states[1].intent.cell)) continue;
    const selected = agents.every((agent, i) => norms.some(norm => matchesNorm(norm, {
      world:scene, agent, action:"MOVE", cell:states[i].intent.cell,
      moveDir:states[i].intent.dir, contested:true, passageContested:false,
      plannedTurn:null, item:null, machine:null,
    })));
    const key = ids.slice().sort().join(":");
    if(!selected || seen.has(key)) continue;
    seen.add(key);
    pairs.push(agents.map(labelForAgent).join(" and "));
  }
  if(!pairs.length) return null;
  if(pairs.length === 1) return `Robots ${pairs[0]} are both selected to wait. Deselect one of them.`;
  return `Both robots in pairs ${pairs.join("; ")} are selected to wait. Deselect one robot in each pair.`;
}

/* Annotate only failures that occur at the actual global stopping tick.
 * Movement, timing, positions, success, and failure reasons remain engine-owned.
 */
function studyGlobalResult(scene, rules) {
  const result = simulate(scene, rules);
  if (result.ok) return {...result, failedEncounterIds:[], encounterResults:[]};
  const final = result.frames.at(-1);
  const stopTick = final.tick;
  const groups = new Map();
  for (const agent of scene.agents.filter(a => a.active)) {
    const key = String(agent.moduleId);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(agent);
  }
  const failed = [];
  const events = [];
  const meta = {...final.agents};
  for (const [region, agents] of groups) {
    const local = simulate({...scene, agents}, rules);
    const end = local.frames.at(-1);
    if (!local.ok && end.tick <= stopTick) {
      failed.push(region);
      events.push(end.event);
      for (const agent of agents) {
        if (end.agents[agent.id]?.failed) {
          meta[agent.id] = {...meta[agent.id], failed:true, state:"failed"};
        }
      }
    }
  }
  return {...result, continuationMode:"global", failedEncounterIds:failed,
    observedFailureTick:stopTick,
    frames:[...result.frames.slice(0, -1), {...final, agents:meta, simultaneousEvents:events}],
    encounterResults:failed.map(id => ({encounter_id:id, ok:false, observed_at_tick:stopTick}))};
}
