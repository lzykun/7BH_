<?php
declare(strict_types=1);

const STUDY_VERSION = '7bh-formal-v23';
const STUDY_TRIAL_COUNT = 11;
const STUDY_ARMS = ['all-local' => 'all-local', 'jump-2' => 'early-jump', 'jump-5' => 'late-jump'];

function fail(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

function studyRequest(int $limit): stdClass
{
    $origin = getenv('STUDY_ALLOWED_ORIGIN') ?: 'https://bococo-81.inf.ed.ac.uk';
    header('Access-Control-Allow-Origin: ' . $origin);
    header('Access-Control-Allow-Methods: POST, OPTIONS');
    header('Access-Control-Allow-Headers: Content-Type');
    header('Content-Type: application/json; charset=utf-8');
    header('Cache-Control: no-store');
    header('X-Content-Type-Options: nosniff');
    if (!hash_equals($origin, $_SERVER['HTTP_ORIGIN'] ?? '')) fail(403, 'Origin not allowed');
    if (($_SERVER['REQUEST_METHOD'] ?? '') === 'OPTIONS') {
        http_response_code(204);
        exit;
    }
    if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'POST required');
    if (!preg_match('/\Aapplication\/json(?:\s*;\s*charset=(?:utf-8|"utf-8"))?\z/iD', trim($_SERVER['CONTENT_TYPE'] ?? ''))) {
        fail(415, 'Content-Type must be application/json');
    }
    $raw = file_get_contents('php://input', false, null, 0, $limit + 1);
    if ($raw === false || strlen($raw) > $limit) fail(413, 'Request body is too large');
    try {
        // Decode objects as objects, including empty and numeric-keyed agent maps.
        $payload = json_decode($raw, false, 64, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        fail(400, 'Invalid JSON');
    }
    if (!$payload instanceof stdClass) fail(400, 'JSON object required');
    return $payload;
}

function studyDirectory(string $name): string
{
    $root = getenv('STUDY_DATA_ROOT') ?: '/home/bococo81/server_data/7BH';
    $base = realpath($root);
    if ($base === false || !is_dir($base) || is_link($root)) fail(500, 'Private data directory unavailable');
    $path = $base . '/' . $name;
    umask(0077);
    if (!is_dir($path) && !@mkdir($path, 0700) && !is_dir($path)) fail(500, 'Could not create private directory');
    if (is_link($path)) fail(500, 'Invalid private directory');
    return $path;
}

function studyLock(string $name, int $mode)
{
    $handle = fopen(studyDirectory('locks') . '/' . $name . '.lock', 'c+');
    if ($handle === false || !flock($handle, $mode)) fail(500, 'Could not lock record');
    return $handle;
}

function studyWrite($handle, string $contents): void
{
    $offset = 0;
    while ($offset < strlen($contents)) {
        $written = fwrite($handle, substr($contents, $offset));
        if ($written === false || $written === 0) fail(500, 'Could not save record');
        $offset += $written;
    }
    if (!fflush($handle)) fail(500, 'Could not flush record');
}

function studyAssignments(): array
{
    $path = studyDirectory('assignment') . '/assignment-state.json';
    if (is_link($path)) fail(500, 'Invalid assignment destination');
    if (!file_exists($path)) return ['studies' => []];
    try {
        $state = json_decode((string)file_get_contents($path), true, 32, JSON_THROW_ON_ERROR);
    } catch (JsonException $e) {
        fail(500, 'Assignment state is unreadable');
    }
    if (!is_array($state) || !is_array($state['studies'] ?? null)) fail(500, 'Assignment state is invalid');
    return $state;
}

function studyToken(array $study, string $session, string $condition): string
{
    return hash_hmac('sha256', STUDY_VERSION . '|' . $session . '|' . $condition, $study['secret']);
}

function studyReadEvents(string $path): array
{
    if (is_link($path)) fail(500, 'Invalid record destination');
    if (!file_exists($path)) return [];
    $handle = fopen($path, 'r');
    if ($handle === false) fail(500, 'Could not read record');
    $events = [];
    while (($line = fgets($handle)) !== false) {
        try { $event = json_decode($line, false, 64, JSON_THROW_ON_ERROR); }
        catch (JsonException $e) { fail(500, 'Stored record is unreadable'); }
        if (!$event instanceof stdClass || !is_string($event->event_id ?? null)) fail(500, 'Stored record is invalid');
        $events[$event->event_id] = $event;
    }
    fclose($handle);
    return $events;
}

function studyOrder(string $condition): array
{
    $suffix = match ($condition) {
        'all-local' => ['A', 'B', 'C', 'D', 'E', 'F'],
        'jump-2' => ['F', 'E', 'D', 'C', 'B', 'A'],
        'jump-5' => ['B', 'C', 'D', 'E', 'F', 'A'],
    };
    return array_merge(['T1', 'T2', 'T3', 'T4', 'T5'], $suffix);
}

function studyProgress(array $events, string $condition): bool
{
    $consent = $reminder = $tutorial = $answers = $comprehension = $sequence = $debrief = $completed = false;
    $tasks = [];
    $order = studyOrder($condition);
    foreach ($events as $event) {
        $stage = $event->stage;
        $type = $event->event_type;
        $detail = $event->detail;
        if (!in_array($stage, ['consent', 'reminder', 'tutorial', 'comprehension', 'task', 'debrief', 'completion'], true)) fail(422, 'Unknown stage');
        if ($stage !== 'consent' && !$consent) fail(422, 'Consent required');
        if (in_array($stage, ['tutorial','comprehension','task','debrief','completion'], true) && !$reminder) fail(422, 'Reminder required');
        if (in_array($stage, ['comprehension','task','debrief','completion'], true) && !$tutorial) fail(422, 'Tutorial required');
        if (in_array($stage, ['task','debrief','completion'], true) && !$comprehension) fail(422, 'Comprehension required');
        if (in_array($stage, ['debrief','completion'], true) && !$sequence) fail(422, 'All tasks must be completed');
        if ($type === 'consent_agreed') {
            if ($stage !== 'consent') fail(422, 'Invalid consent stage');
            $consent = true;
        } elseif ($type === 'reminder_acknowledged') {
            if ($stage !== 'reminder') fail(422, 'Invalid reminder stage');
            $reminder = true;
        } elseif ($type === 'tutorial_completed') {
            if ($stage !== 'tutorial') fail(422, 'Invalid tutorial stage');
            $tutorial = true;
        } elseif ($type === 'comprehension_submitted' && ($detail->passed ?? false) === true) {
            if ($stage !== 'comprehension') fail(422, 'Invalid comprehension stage');
            foreach (['check1'=>'b','check2'=>'c','check3'=>'a','check4'=>'d'] as $key=>$value) {
                if (($detail->responses->$key ?? null) !== $value) fail(422, 'Invalid comprehension answers');
            }
            $answers = true;
        } elseif ($type === 'comprehension_passed') {
            if ($stage !== 'comprehension' || !$answers) fail(422, 'Comprehension answers required');
            $comprehension = true;
        } elseif ($type === 'run_completed') {
            $trial = $event->trial_index ?? null;
            if ($stage !== 'task' || !is_int($trial) || $trial < 1 || $trial > STUDY_TRIAL_COUNT
                || ($event->task_item_id ?? null) !== $order[$trial-1]
                || ($detail->task_item_id ?? null) !== $order[$trial-1]
                || !is_bool($detail->ok ?? null) || !is_array($detail->frames ?? null) || count($detail->frames) < 1
                || !is_string($detail->run_id ?? null)) fail(422, 'Invalid task result');
            foreach (['movement_mask', 'role_mask'] as $key) {
                if (!is_int($detail->$key ?? null) || $detail->$key < 0 || $detail->$key > 255) fail(422, 'Invalid rule mask');
            }
            for ($i=1; $i<$trial; $i++) if (!isset($tasks[$i])) fail(422, 'Previous task incomplete');
            if ($detail->ok) $tasks[$trial] = true;
        } elseif ($type === 'task_sequence_completed') {
            if ($stage !== 'task' || count($tasks) !== STUDY_TRIAL_COUNT) fail(422, 'Eleven successful tasks required');
            $sequence = true;
        } elseif ($type === 'debrief_responses_submitted') {
            if ($stage !== 'debrief' || !is_int($detail->age ?? null) || $detail->age < 18 || $detail->age > 100
                || !in_array($detail->gender ?? null, ['woman','man','nonbinary','other','prefer_not_to_say'], true)
                || !in_array($detail->feature_use ?? null, ['movement','robot_type','both','no_consistent_strategy','unsure'], true)
                || !is_string($detail->strategy ?? null) || strlen($detail->strategy) > 4000) fail(422, 'Invalid debrief responses');
            foreach (['engagement','difficulty'] as $key) {
                if (!is_int($detail->$key ?? null) || $detail->$key < 1 || $detail->$key > 10) fail(422, 'Invalid questionnaire rating');
            }
            $debrief = true;
        } elseif ($type === 'study_completed') {
            if ($stage !== 'debrief' || !$debrief) fail(422, 'Submitted debrief required');
            $completed = true;
        }
        if ($stage === 'debrief' && $type === 'ui_value_changed' && ($detail->value ?? null) !== null) fail(422, 'Unsubmitted draft is not permitted');
    }
    return $completed;
}
