/* Pre-study setup reminder. */
(async function(){
"use strict";

const data = window.StudyData;
if(!await data?.ready || !data.init({stage:"reminder"})) return;

document.getElementById("reminder-continue")?.addEventListener("click", async event => {
  const button = event.currentTarget;
  button.disabled = true;
  button.textContent = "Opening tutorial...";
  data?.record("reminder_acknowledged");
  await data?.navigate("tutorial.html");
});
})();
