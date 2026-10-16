/* Trial outcomes are permanent; replaying animation never spends another Run. */
(function(root){
  "use strict";
  const LIMIT = 10;
  function empty(){ return {attempts:0, outcome:null, lastOk:null}; }
  function apply(state, ok){
    if(state.outcome || state.attempts >= LIMIT) throw new Error("Trial already resolved");
    if(typeof ok !== "boolean") throw new Error("Boolean result required");
    const attempts = state.attempts + 1;
    return {attempts, lastOk:ok, outcome:ok ? "success" : attempts === LIMIT ? "failed" : null};
  }
  function summarize(events, count, payment={}){
    const trials = Array.from({length:count}, empty);
    const ids = new Set();
    for(const event of events){
      if(event.stage !== "task" || event.event_type !== "run_completed") continue;
      const trial = event.trial_index, id = event.detail?.run_id;
      if(!Number.isInteger(trial) || trial < 1 || trial > count || typeof id !== "string") throw new Error("Invalid trial result");
      if(ids.has(id)) throw new Error("Repeated Run identifier");
      ids.add(id);
      trials[trial-1] = apply(trials[trial-1], event.detail.ok);
    }
    const success = trials.filter(t=>t.outcome === "success").length;
    const failed = trials.filter(t=>t.outcome === "failed").length;
    const bonusConfigured = Number.isSafeInteger(payment.per_success_pence) && payment.per_success_pence >= 0;
    const configured = payment.configured === true && bonusConfigured && Number.isSafeInteger(payment.base_pence) && payment.base_pence >= 0;
    const performance = bonusConfigured ? success * payment.per_success_pence : null;
    const total = configured ? payment.base_pence + performance : null;
    if(configured && !Number.isSafeInteger(total)) throw new Error("Invalid payment amount");
    return {trials, successful_tasks:success, failed_tasks:failed, resolved_tasks:success+failed,
      all_resolved:success+failed === count, max_runs_per_trial:LIMIT,
      payment_configured:configured, bonus_configured:bonusConfigured, currency:"GBP", base_pence:configured ? payment.base_pence : null,
      bonus_rate_pence:bonusConfigured ? payment.per_success_pence : null,
      bonus_pence:performance, performance_pence:performance, total_pence:total};
  }
  function money(pence){ return new Intl.NumberFormat("en-GB",{style:"currency",currency:"GBP"}).format(pence/100); }
  function paymentText(summary){
    return summary.payment_configured
      ? `Total payment: ${money(summary.total_pence)} (${money(summary.base_pence)} base + ${money(summary.performance_pence)} for solved tasks).`
      : summary.bonus_configured
        ? `Bonus earned: ${money(summary.bonus_pence)}. Your base payment is unchanged.`
        : "Preview: payment amounts have not been set.";
  }
  const api = {LIMIT, empty, apply, summarize, paymentText};
  if(typeof module !== "undefined" && module.exports) module.exports = api;
  else {
    root.TrialPolicy = Object.freeze(api);
    const terms = document.querySelector('[data-payment-terms]');
    if(terms){
      const payment = root.STUDY_CONFIG.payment;
      const summary = summarize([],root.STUDY_CONFIG.trial_count,payment);
      if(summary.payment_configured) terms.textContent = `Base payment: ${money(payment.base_pence)}. Each solved task adds ${money(payment.per_success_pence)}. Only solved tasks add to the performance payment; the base payment is unchanged.`;
      else if(summary.bonus_configured) terms.textContent = `You will earn a ${money(payment.per_success_pence)} bonus for each task you solve successfully. Your base payment will not be affected.`;
    }
  }
})(typeof window === "undefined" ? globalThis : window);
