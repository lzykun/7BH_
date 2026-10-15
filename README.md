# 7BH

Interface and data-collection code for a behavioural study of how people search across movement-direction and robot-type representations when constructing shared coordination rules.

## Current release

`7bh-formal-v23` / `7bh-eleven-type-jump-v23`, deployed to Bococo on 9 October 2026.
The runtime files match the deployed release byte for byte; their SHA-256 hashes
are recorded in `release-manifest.json`.

- Eleven tasks, with the same first five tasks across conditions and the same six remaining tasks reordered.
- Type-only practice carries Type D into T1. Type and Movement use separate tabs, retain their own selections, and cannot be combined in one Run.
- The Type repair jump is five additions/removals at T6 in Early jump and T11 in Late jump. The critical tasks also accept Movement north alone.
- All-local retains small Type repairs: `0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1`.
- Type solutions are unique from T5 onward. Earlier tasks permit redundant unused Types; Movement solutions need not be unique.
- Every Run restarts the full map. Passing requires all robots to succeed with the current rule in that Run.

Formal participant entry: https://bococo-81.inf.ed.ac.uk/7BH/

## Online preview

The static, non-recording preview is available at:

https://555bighamsome.github.io/7BH/

GitHub Pages does not run the PHP assignment and data endpoints. Formal participant sessions must therefore use the Bococo deployment; the Pages build stores preview activity only in the browser.

## Local preview

Run a static server from this directory:

```bash
python3 -m http.server 8767 --bind 127.0.0.1
```

Then open:

```text
http://127.0.0.1:8767/routes/consent.html?preview=1
```

Preview sessions remain in browser storage and do not write to the study server.

## Verification

```bash
node tests/verify-release.cjs
node tests/verify-guided-tutorial.cjs
```

This checks the runtime hashes, JavaScript syntax, shared task orders, pure Type
solutions and critical Movement alternatives against the actual simulator.
`build-manifest.json` and `interface-checks.json` are historical generation
artifacts, not validation of the current release.

## Study flow

The standalone pages cover consent, reminder, the task page, debrief, and completion. The task page runs the guided tutorial (`guided-tutorial/`, spec in `docs/guided-tutorial-storyboard.html`), the comprehension questions and the eleven coordination tasks. Researchers can open T1 directly with `routes/task.html?preview=1&skipTutorial=1`, and turn tutorial gadgets off in preview with `&guide_off=replay,features`. Formal server assignment balances participants across the all-local, early-jump, and late-jump conditions.

## Data safety

Participant events are not stored in this repository or under the public web directory. In deployment, the PHP endpoints expect pre-created private directories outside `public_html`. See `DATA_COLLECTION.md` for the event schema, assignment method, and deployment checks.
