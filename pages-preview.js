/* Keep the GitHub Pages build separate from the formal data-collection site. */
(function(){
"use strict";

if(!["555bighamsome.github.io", "lzykun.github.io"].includes(window.location.hostname)) return;

const url = new URL(window.location.href);
const defaults = {
  preview:"1",
  assigned_condition:"all-local",
  assignment_arm:"all-local",
  assignment_source:"researcher-preview",
  schedule:"all-local",
  mode:"sequence",
  condition:"carry",
  continuation:"local",
  order:"curriculum",
  trial:"1",
  v:window.SHARED_POOL?.version || "7bh-formal-v15",
};
let changed = false;

for(const [key, value] of Object.entries(defaults)){
  if(url.searchParams.has(key)) continue;
  url.searchParams.set(key, value);
  changed = true;
}

if(changed) window.location.replace(url.href);
})();
