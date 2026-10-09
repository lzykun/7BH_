<?php
declare(strict_types=1);
require __DIR__ . '/server-common.php';

$payload = studyRequest(1000000);
$session = $payload->session_id ?? null;
$events = $payload->events ?? null;
if (!is_string($session) || !preg_match('/\A[A-Za-z0-9_-]{8,80}\z/D', $session)
    || ($payload->participant_code ?? null) !== $session || ($payload->experiment_version ?? null) !== STUDY_VERSION
    || !is_array($events) || count($events) < 1 || count($events) > 500) fail(400, 'Invalid event payload');
$assignmentLock = studyLock('assignment', LOCK_SH);
$assignments = studyAssignments();
$study = $assignments['studies'][hash('sha256', STUDY_VERSION)] ?? [];
$condition = $study['sessions'][hash('sha256', $session)]['condition'] ?? null;
if (!isset(STUDY_ARMS[$condition ?? '']) || !is_string($payload->session_token ?? null)
    || !hash_equals(studyToken($study, $session, $condition), $payload->session_token)) fail(403, 'Valid assignment required');
flock($assignmentLock, LOCK_UN);
fclose($assignmentLock);

foreach ($events as $event) {
    if (!$event instanceof stdClass || ($event->session_id ?? null) !== $session || ($event->participant_code ?? null) !== $session
        || ($event->experiment_version ?? null) !== STUDY_VERSION || ($event->assigned_condition ?? null) !== $condition
        || ($event->schedule ?? null) !== $condition || ($event->assignment_arm ?? null) !== STUDY_ARMS[$condition]
        || ($event->assignment_source ?? null) !== 'server-block' || ($event->continuation ?? null) !== 'local'
        || !is_int($event->event_index ?? null) || $event->event_index < 1
        || ($event->event_id ?? null) !== $session . '-' . str_pad((string)$event->event_index, 6, '0', STR_PAD_LEFT)
        || !is_string($event->event_type ?? null) || strlen($event->event_type) > 100
        || !is_string($event->stage ?? null) || !is_string($event->timestamp ?? null) || strlen($event->timestamp) > 60
        || !($event->detail ?? null) instanceof stdClass || isset($event->server_received_at) || property_exists($event, 'participant_id') || property_exists($event, 'session_token')) fail(400, 'Invalid event record');
}

$lock = studyLock('session-' . $session, LOCK_EX);
$paths = ['consent'=>studyDirectory('consent') . '/' . $session . '.jsonl', 'events'=>studyDirectory('events') . '/' . $session . '.jsonl'];
$known = array_merge(studyReadEvents($paths['consent']), studyReadEvents($paths['events']));
$combined = $known;
$new = [];
foreach ($events as $event) {
    if (isset($combined[$event->event_id])) {
        $original = clone $combined[$event->event_id];
        unset($original->server_received_at);
        if (json_encode($original) !== json_encode($event)) fail(409, 'Conflicting event identifier');
    } else {
        $combined[$event->event_id] = $event;
        $new[$event->event_id] = $event;
    }
}
uasort($combined, fn($a, $b) => $a->event_index <=> $b->event_index);
$expectedIndex = 1;
foreach ($combined as $event) {
    if ($event->event_index !== $expectedIndex++) fail(422, 'Earlier events are missing');
}
$completed = studyProgress($combined, $condition);
foreach ($paths as $kind => $path) {
    $rows = array_filter($new, fn($event) => ($event->stage === 'consent') === ($kind === 'consent'));
    if (!$rows) continue;
    $handle = fopen($path, 'ab');
    if ($handle === false) fail(500, 'Could not open record');
    foreach ($rows as $event) {
        $stored = clone $event;
        $stored->server_received_at = gmdate('Y-m-d\TH:i:s\Z');
        studyWrite($handle, json_encode($stored, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_THROW_ON_ERROR) . "\n");
    }
    fclose($handle);
    chmod($path, 0600);
}
flock($lock, LOCK_UN);
fclose($lock);
echo json_encode(['ok'=>true, 'accepted'=>count($new), 'received'=>count($events), 'workflow_completed'=>$completed]);
