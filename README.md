# 7BH

Interface and data-collection code for a behavioural study of how people search across movement-direction and robot-type representations when constructing shared coordination rules.

## Current release

`7bh-formal-v27` / `7bh-early-only-type-coupled-bonus-v27`, deployed to Bococo on 16 October 2026.
The runtime files match the deployed release byte for byte; their SHA-256 hashes
are recorded in `release-manifest.json`.

- Eleven tasks, with the same first five tasks across conditions and the same six remaining tasks reordered.
- The tutorial demonstrates Movement first and finishes with a successful Type D Run, which carries into T1. Type and Movement use separate tabs, retain their own selections, and cannot be combined in one Run.
- The published runtime uses Early jump only, including GitHub Pages. All-local and Late jump remain in the task bank for offline validation and local development previews.
- The Type repair jump is five additions/removals at T6 in Early jump and T11 in Late jump. The critical tasks also accept Movement north alone.
- All-local retains small Type repairs: `0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1`.
- Type solutions are unique from T5 onward. Earlier tasks permit redundant unused Types; Movement solutions need not be unique.
- Every Run restarts the full map. Passing requires all robots to succeed with the current rule in that Run.
- Each task allows ten Runs. An unchanged Run counts; replay does not. Success on Run 10 counts. Otherwise the task ends and the last selections carry into the next task.
- Each successfully solved task earns a GBP 0.10 bonus (up to GBP 1.10). The Prolific base payment is unchanged. Bonus information appears in consent and immediately before the task, not in the operation tutorial.
- The expanded warehouse roads and ten-robot grouping are retained. Critical material F changes Type assignments to couple choices across groups; Movement north remains a one-value solution.

Formal participant entry: https://bococo-81.inf.ed.ac.uk/7BH/

## Online preview

The static, non-recording preview is available at:

https://555bighamsome.github.io/7BH/?schedule=jump-2&assigned_condition=jump-2&assignment_arm=early-jump

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
```

This checks the runtime hashes, JavaScript syntax, shared task orders, all 5,632
pure Type/Movement rules against the actual simulator and server solution sets,
tutorial carry-over, seven comprehension answers, Run limits and bonus accounting.
`build-manifest.json` and `interface-checks.json` are historical generation
artifacts, not validation of the current release.

## Study flow

The entry pages lead through consent, reminder, an interactive guided tutorial,
seven comprehension questions, eleven coordination tasks, debrief and completion.
Formal server assignment always selects Early jump. Completion requires all tasks
to be resolved, either successfully or after exhausting ten Runs, not eleven successes.

## Tutorial provenance

The guided tutorial was adopted from Kun's `lzykun/7BH_` branch `guided-preview`,
commit `c1eb228461060c0a144bf96b16e8f16310ad984c`, and subsequently adapted for
the Type anchor, Run budget, comprehension checks and current payment notice.
This code synchronization is separate from the older pull request #1.

## Data safety

Participant events are not stored in this repository or under the public web directory. In deployment, the PHP endpoints expect pre-created private directories outside `public_html`. See `DATA_COLLECTION.md` for the event schema, assignment method, and deployment checks.
