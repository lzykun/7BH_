<?php
declare(strict_types=1);
require __DIR__ . '/server-common.php';

$payload = studyRequest(64000);
$session = $payload->session_id ?? null;
$participant = $payload->participant_id ?? '';
if (!is_string($session) || !preg_match('/\A[A-Za-z0-9_-]{8,80}\z/D', $session)) fail(400, 'Invalid session');
if (!is_string($participant) || strlen($participant) > 128 || ($participant !== '' && !preg_match('/\A[A-Za-z0-9_-]+\z/D', $participant))) fail(400, 'Invalid participant identifier');
if (($payload->experiment_version ?? null) !== STUDY_VERSION) fail(409, 'Reload the current study version');

$lock = studyLock('assignment', LOCK_EX);
$state = studyAssignments();
$studyKey = hash('sha256', STUDY_VERSION);
if (!isset($state['studies'][$studyKey])) {
    $state['studies'][$studyKey] = ['queue'=>[], 'assignments'=>[], 'sessions'=>[], 'counts'=>array_fill_keys(array_keys(STUDY_ARMS), 0), 'secret'=>bin2hex(random_bytes(32))];
}
$study =& $state['studies'][$studyKey];
$identity = hash('sha256', STUDY_VERSION . '|' . ($participant !== '' ? 'participant:' . $participant : 'session:' . $session));
$sessionKey = hash('sha256', $session);
if (isset($study['assignments'][$identity])) {
    $assignment = $study['assignments'][$identity];
    $session = $assignment['session_id'];
    $condition = $assignment['condition'];
    $reused = true;
} elseif ($participant === '' && isset($study['sessions'][$sessionKey])) {
    $condition = $study['sessions'][$sessionKey]['condition'];
    $reused = true;
} else {
    if (isset($study['sessions'][$sessionKey])) fail(409, 'Session already assigned');
    if (!$study['queue']) {
        $study['queue'] = array_keys(STUDY_ARMS);
        for ($i=count($study['queue'])-1; $i>0; $i--) {
            $j = random_int(0, $i);
            [$study['queue'][$i], $study['queue'][$j]] = [$study['queue'][$j], $study['queue'][$i]];
        }
    }
    $condition = array_shift($study['queue']);
    $study['assignments'][$identity] = ['session_id'=>$session, 'condition'=>$condition, 'assigned_at'=>gmdate('c')];
    $study['sessions'][$sessionKey] = ['condition'=>$condition];
    $study['counts'][$condition]++;
    $reused = false;
}
$directory = studyDirectory('assignment');
$temporary = tempnam($directory, '.assignment-');
if ($temporary === false) fail(500, 'Could not create assignment file');
$handle = fopen($temporary, 'wb');
if ($handle === false) fail(500, 'Could not write assignment file');
studyWrite($handle, json_encode($state, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR) . "\n");
fclose($handle);
chmod($temporary, 0600);
if (!rename($temporary, $directory . '/assignment-state.json')) fail(500, 'Could not commit assignment');
flock($lock, LOCK_UN);
fclose($lock);
echo json_encode(['ok'=>true, 'condition'=>$condition, 'session_id'=>$session, 'session_token'=>studyToken($study, $session, $condition), 'reused'=>$reused]);
