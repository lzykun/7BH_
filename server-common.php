<?php
declare(strict_types=1);

const STUDY_VERSION = '7bh-formal-v27';
const STUDY_TRIAL_COUNT = 11;
const STUDY_MAX_RUNS = 10;
const STUDY_BONUS_PENCE = 10;
const STUDY_PUBLICATION_READY = true;
const STUDY_ARMS = ['jump-2' => 'early-jump'];

function fail(int $status, string $message): never
{
    http_response_code($status);
    echo json_encode(['ok' => false, 'error' => $message]);
    exit;
}

function studyRequest(int $limit): stdClass
{
    if (!STUDY_PUBLICATION_READY) fail(503, 'Local candidate: publication and payment configuration pending');
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

// Call only after studyProgress has validated the complete event prefix.
function studyScore(array $events): array
{
    $won = [];
    $failed = [];
    foreach ($events as $event) {
        if ($event->stage !== 'task' || $event->event_type !== 'run_completed') continue;
        if ($event->detail->ok) $won[$event->trial_index] = true;
        elseif ($event->detail->shift_attempt_index === STUDY_MAX_RUNS) $failed[$event->trial_index] = true;
    }
    return ['successful_tasks'=>count($won), 'failed_tasks'=>count($failed),
        'resolved_tasks'=>count($won)+count($failed), 'payment_configured'=>false, 'total_pence'=>null,
        'bonus_configured'=>true, 'currency'=>'GBP', 'bonus_rate_pence'=>STUDY_BONUS_PENCE,
        'bonus_pence'=>count($won)*STUDY_BONUS_PENCE, 'performance_pence'=>count($won)*STUDY_BONUS_PENCE,
        'base_payment_source'=>'prolific-listing'];
}

function studyProgress(array $events, string $condition, ?array $solutions = null): bool
{
    $consent = $reminder = $tutorial = $answers = $comprehension = $sequence = $debrief = $completed = false;
    $tasks = [];
    $attempts = [];
    $runIds = [];
    $successful = [];
    $solutions ??= json_decode((string)file_get_contents(__DIR__ . '/task-solutions.json'), true, 32, JSON_THROW_ON_ERROR);
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
            foreach (['check1'=>'b','check2'=>'c','check3'=>'a','check4'=>'d','check5'=>'b','check6'=>'a','check7'=>'c'] as $key=>$value) {
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
            if (isset($tasks[$trial]) || ($attempts[$trial] ?? 0) >= STUDY_MAX_RUNS) fail(422, 'Trial already resolved');
            if (isset($runIds[$detail->run_id])) fail(422, 'Repeated Run identifier');
            $runIds[$detail->run_id] = true;
            $attempts[$trial] = ($attempts[$trial] ?? 0) + 1;
            if (($event->attempt_index ?? null) !== $attempts[$trial]
                || ($detail->shift_attempt_index ?? null) !== $attempts[$trial]
                || ($detail->outcome_protocol ?? null) !== 'ten-run-budget-v1') fail(422, 'Invalid attempt counter');
            $family = $detail->active_rule_family ?? null;
            if (!in_array($family, ['role','move_dir'], true)
                || ($family === 'role' && $detail->movement_mask !== 0)
                || ($family === 'move_dir' && $detail->role_mask !== 0)) fail(422, 'Pure family required');
            $mask = $family === 'role' ? $detail->role_mask : $detail->movement_mask;
            $correct = in_array($mask, $solutions[$order[$trial-1]][$family], true);
            if ($detail->ok !== $correct) fail(422, 'Result disagrees with verified solution set');
            $outcome = $correct ? 'success' : ($attempts[$trial] === STUDY_MAX_RUNS ? 'failed' : null);
            if (($detail->trial_outcome ?? null) !== $outcome) fail(422, 'Invalid outcome');
            if ($outcome !== null) $tasks[$trial] = $outcome;
            if ($correct) $successful[$trial] = true;
        } elseif ($type === 'trial_resolved') {
            $trial = $event->trial_index ?? null;
            if ($stage !== 'task' || !isset($tasks[$trial])
                || ($detail->outcome ?? null) !== $tasks[$trial]
                || ($detail->attempts ?? null) !== $attempts[$trial]) fail(422, 'Unverified trial outcome');
        } elseif ($type === 'task_sequence_completed') {
            if ($stage !== 'task' || count($tasks) !== STUDY_TRIAL_COUNT) fail(422, 'All trials must be resolved');
            if (($detail->successful_tasks ?? null) !== count($successful)
                || ($detail->failed_tasks ?? null) !== STUDY_TRIAL_COUNT-count($successful)) fail(422, 'Incorrect score');
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
