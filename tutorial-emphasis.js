(function(){
"use strict";

const phrases = {
  simple_choice:['Your task is to coordinate the robots and prevent them from colliding.'],
};
const seen = new Set();
let activeTrack = null;

function emphasizeText(block, phrase){
  const start = block.textContent.indexOf(phrase);
  if(start < 0) return;
  const end = start + phrase.length;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const range = document.createRange();
  let offset = 0;
  let started = false;
  let node;
  while((node = walker.nextNode())){
    const next = offset + node.textContent.length;
    if(!started && start >= offset && start < next){
      range.setStart(node, start - offset);
      started = true;
    }
    if(started && end <= next){
      range.setEnd(node, end - offset);
      const mark = document.createElement('strong');
      mark.className = 'story-key-phrase story-key-rule';
      mark.appendChild(range.extractContents());
      range.insertNode(mark);
      return mark;
    }
    offset = next;
  }
}

function robotMarkup(){
  return `<svg viewBox="0 0 56 52" focusable="false" aria-hidden="true">
    <g class="ink-robot-feet" fill="#172d3e">
      <rect class="ink-foot-left" x="10" y="41" width="12" height="6" rx="3"/>
      <rect class="ink-foot-right" x="27" y="41" width="12" height="6" rx="3"/>
    </g>
    <g class="ink-robot-body">
      <path d="M24 9V5" stroke="#172d3e" stroke-width="3" stroke-linecap="round"/>
      <circle cx="24" cy="4" r="3" fill="#edaa34"/>
      <rect x="8" y="10" width="32" height="23" rx="9" fill="#2d70b3"/>
      <rect x="12" y="14" width="24" height="13" rx="6" fill="#f4fbff"/>
      <g class="ink-robot-eyes" fill="#172d3e">
        <ellipse cx="23" cy="21" rx="2.4" ry="3.6"/>
        <ellipse cx="31" cy="21" rx="2.4" ry="3.6"/>
      </g>
      <path d="M27 29q3 3 6 0" fill="none" stroke="#fff" stroke-width="1.8" stroke-linecap="round"/>
      <rect x="12" y="31" width="25" height="12" rx="5" fill="#2d70b3"/>
      <rect x="20" y="34" width="9" height="5" rx="2" fill="#edaa34"/>
      <path d="M11 33l-5 5M36 33l13-15" stroke="#172d3e" stroke-width="4" stroke-linecap="round"/>
      <g>
        <rect x="47" y="5" width="6" height="14" rx="2" fill="#db3946"/>
        <path d="M47 5h6l-3-5z" fill="#ad2130"/>
      </g>
    </g>
  </svg>`;
}

function finishDrawing(){
  if(activeTrack) activeTrack.classList.remove('is-drawing');
  activeTrack = null;
}

function render({pageId, blocks, revealed}){
  const pagePhrases = phrases[pageId];
  if(!pagePhrases){ finishDrawing(); return; }
  const freshTracks = [];
  blocks.forEach((group, index) => {
    const block = group[0];
    const selected = pagePhrases[index];
    if(!block || !selected) return;
    if(!block.querySelector('.story-ink-track')){
      const sentence = emphasizeText(block, selected);
      if(!sentence) return;
      const track = document.createElement('span');
      track.className = 'story-ink-track';
      track.setAttribute('aria-hidden', 'true');
      track.innerHTML = `<span class="story-ink-line"></span><span class="story-ink-runner"><span class="story-ink-robot">${robotMarkup()}</span></span>`;
      const group = document.createElement('span');
      group.className = 'story-key-group';
      sentence.before(group);
      group.append(sentence, track);
    }
    if(index >= revealed) return;
    const key = `${pageId}:${index}`;
    if(seen.has(key)) return;
    seen.add(key);
    freshTracks.push(block.querySelector('.story-ink-track'));
  });
  if(activeTrack && !activeTrack.isConnected) finishDrawing();
  if(!freshTracks.length) return;
  // Only the newly revealed passage moves; previous underlines stay in place.
  finishDrawing();
  if(window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  activeTrack = freshTracks[freshTracks.length - 1];
  activeTrack.classList.add('is-drawing');
}

window.TutorialEmphasis = {render};
window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => {
  if(event.matches) finishDrawing();
});
})();
