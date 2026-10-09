# Study data collection

## Release and assignment

Current release: `7bh-formal-v23`, deployment `7bh-eleven-type-jump-v23`.
Formal sessions enter through `index.html` on Bococo. Server-side randomized
blocks of three assign `all-local`, `jump-2` (Early jump), or `jump-5` (Late jump).
Re-entry with the same recruitment identifier restores the same assignment.
Balanced assignments do not guarantee balanced completed samples.

The conditions share T1-T5, followed by these permutations of one task bank:

| Condition | Remaining tasks | Critical trial |
| --- | --- | --- |
| All-local | A, B, C, D, E, F | None |
| Early jump | F, E, D, C, B, A | T6 |
| Late jump | B, C, D, E, F, A | T11 |

The critical repair is in Type, not Movement. Type-only tutorial practice carries
D into T1. Type and Movement selections are retained separately, but only the
active tab contributes to a Run. Switching tabs and editing values are distinct
events. A tab switch does not by itself establish a tested strategy shift.

## Event stream and completion

`data-collector.js` records ordered events with a random study session code,
version, deployment ID, material hash, condition, stage, trial, item, attempt,
timestamps and event-specific detail. Recruitment identifiers are removed from
navigation and are not part of the behavioral stream. Assignment tokens are
kept in browser storage rather than displayed URLs.

The stream covers consent, tutorial, comprehension, rule edits, family switches,
Runs, replay frames, task transitions, questionnaire submission and completion.
Every `run_completed` records the active family, both rule masks, trial-start
rule, edit counts, family-switch counts, outcome and timing. Rule drafts in the
inactive tab are not executed. The inherited tutorial rule is initialization,
not a participant edit.

`completion_protocol: full-map-single-run-v1` means that every Run restarts all
robots. Robots outside a conflict may continue within that Run, but successful
robots are not carried into the next Run. Passing requires the current rule to
solve the whole task from its initial state. Earlier cumulative-completion
cohorts must not be interpreted using this criterion without replay validation.

`task_sequence_completed` means all eleven tasks were passed. It is distinct
from `debrief_responses_submitted` and `study_completed`. The completion code is
shown only after the questionnaire and final event queue have been acknowledged
by the server. An unsuccessful upload remains retryable. The questionnaire
contains age, gender, engagement, difficulty, reported feature use and optional
strategy text; generic UI events do not contain questionnaire field values.

## Private storage and recovery

Production v23 uses `STUDY_DATA_ROOT=/home/bococo81/server_data/7BH/v23`, outside
`public_html`, with separate `events/`, `consent/`, `assignment/` and `locks/`
directories. Earlier versions retain their own records. Directories use mode
`0700`; record files use `0600`.

IndexedDB and browser checkpoints preserve queued events, selections, progress
and replay after reload. A same-session tab lock prevents conflicting writers.
The receiver validates origin, assignment token, version, event continuity and
workflow order. Identical retries are deduplicated. A queued beacon is not an
upload acknowledgement. Browser-generated outcomes still require replay checks
for independent validation.

GitHub Pages and `preview=1` are non-recording previews: they do not use the
formal PHP endpoints. The Pages workflow publishes only static assets. No
participant data, allocation state, private analysis, server secrets or QA
access configuration belongs in this repository.

## Server deployment requirements

Configure the private, version-specific `STUDY_DATA_ROOT` explicitly; do not use
the receiver's historical fallback for a new deployment. Configure
`STUDY_ALLOWED_ORIGIN` when using a different host. Deny direct HTTP access to
`server-common.php`, disable directory listings and keep server configuration
private. The production `.htaccess` is intentionally not distributed here.

Before recruitment, verify consent, tutorial carry-over, comprehension, all
eleven tasks, questionnaire and acknowledged completion in each condition.
Test rejected requests, retry deduplication and recovery with an isolated QA
data directory, then read back the stored events. Never run these QA sessions
against participant storage. Replacing an active production receiver requires
an explicit deployment decision; pushing this repository does not deploy to
Bococo or change its participant data.
