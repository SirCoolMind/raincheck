<?php
/**
 * GET  /api/feedback.php?challenge=1                                  → {q:"12 + 32", token}
 * POST /api/feedback.php  {kind, message, email?, website?, token, answer} → {ok:true}
 *
 * Sends visitor feedback to the site owner through the Gmail API (OAuth refresh token; no SMTP, so it
 * works on hosts that block port 25). Settings come from config.local.php or the environment:
 *   MAIL_MAILER=gmail, MAIL_FROM_ADDRESS, MAIL_FROM_NAME, GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET,
 *   GMAIL_REFRESH_TOKEN, FEEDBACK_TO (defaults to MAIL_FROM_ADDRESS).
 * The recipient never reaches the browser. Missing settings → 503 not_configured.
 *
 * Abuse limits: 3 per minute and 10 per day per IP, 2,000 characters, a hidden "website" field that
 * only bots fill (they get a fake success), and a small sum to solve. The sum travels as a signed token
 * (HMAC, 30 min, one use, not answerable in under 3 s), so the server keeps no session.
 */

declare(strict_types=1);
require __DIR__ . '/common.php';

send_security_headers();
cors_same_origin();
same_site_guard();

// ---------------------------------------------------------------- human check (a signed sum)
const CHALLENGE_TTL = 1800;

/** HMAC key: FEEDBACK_SECRET if set, else a random key created once in the cache dir. */
function challenge_key(): ?string
{
    $k = trim((string) (cfg('FEEDBACK_SECRET') ?? getenv('FEEDBACK_SECRET') ?: ''));
    if ($k !== '') return $k;
    $dir = CACHE_DIR . DIRECTORY_SEPARATOR . 'feedback';
    if (!ensure_dir($dir)) return null;
    $file = $dir . DIRECTORY_SEPARATOR . 'challenge.key';
    $k = (string) @file_get_contents($file);
    if (strlen($k) >= 32) return $k;
    $k = bin2hex(random_bytes(32));
    if (@file_put_contents($file, $k, LOCK_EX) === false) return null;
    @chmod($file, 0600);
    return $k;
}

function b64u(string $s): string { return rtrim(strtr(base64_encode($s), '+/', '-_'), '='); }

function new_challenge(string $key): array
{
    $a = random_int(10, 29);
    $b = random_int(10, 39);
    $payload = b64u(json_encode(['a' => $a, 'b' => $b, 't' => time(), 'n' => bin2hex(random_bytes(8))]));
    return ['q' => "{$a} + {$b}", 'token' => $payload . '.' . b64u(hash_hmac('sha256', $payload, $key, true))];
}

/** null when the answer is right (and the token is now spent); otherwise [status, code, message]. */
function check_challenge(string $key, string $token, string $answer): ?array
{
    $expired = [422, 'challenge_expired', 'That question expired. Here is a new one.'];
    $parts = explode('.', $token);
    if (count($parts) !== 2) return $expired;
    [$payload, $sig] = $parts;
    if (!hash_equals(b64u(hash_hmac('sha256', $payload, $key, true)), $sig)) return $expired;
    $c = json_decode((string) base64_decode(strtr($payload, '-_', '+/')), true);
    if (!is_array($c) || !isset($c['a'], $c['b'], $c['t'], $c['n'])) return $expired;
    $age = time() - (int) $c['t'];
    if ($age > CHALLENGE_TTL || $age < -60) return $expired;
    $minAge = (int) (rc_env('RAINCHECK_FEEDBACK_MIN_SECONDS') ?? 3); // override: local dev server only
    if ($age < $minAge) return [422, 'too_fast', 'That was quick! Check the sum, then send again.'];
    // One use: a spent token cannot be replayed, right or wrong (so a bot cannot try every answer).
    $dir = CACHE_DIR . DIRECTORY_SEPARATOR . 'feedback';
    if (ensure_dir($dir)) {
        $used = $dir . DIRECTORY_SEPARATOR . 'used-' . sha1((string) $c['n']);
        $fh = @fopen($used, 'x');
        if ($fh === false) return $expired;
        fclose($fh);
        if (random_int(1, 50) === 1) {
            foreach (@glob($dir . DIRECTORY_SEPARATOR . 'used-*') ?: [] as $f) {
                if (@filemtime($f) < time() - CHALLENGE_TTL - 120) @unlink($f);
            }
        }
    }
    $ans = trim($answer);
    if (!preg_match('/^\d{1,3}$/', $ans) || (int) $ans !== (int) $c['a'] + (int) $c['b']) {
        return [422, 'wrong_answer', 'That sum is not right. Try this one.'];
    }
    return null;
}

$method = $_SERVER['REQUEST_METHOD'] ?? 'GET';
if ($method === 'GET' && isset($_GET['challenge'])) {
    rate_limit('feedback-q', 20);
    $key = challenge_key();
    if ($key === null) json_error(503, 'not_configured', 'Feedback is not set up on this server yet.');
    json_out(new_challenge($key));
}
if ($method !== 'POST') {
    json_error(405, 'method_not_allowed', 'Only POST is supported.', ['Allow' => 'GET, POST, OPTIONS']);
}
rate_limit('feedback', (int) (rc_env('RAINCHECK_FEEDBACK_PER_MIN') ?? 3)); // override: local dev server only

function mail_setting(string $key): string
{
    $v = cfg($key);
    if ($v === null || $v === '') {
        $e = getenv($key);
        $v = $e === false ? '' : $e;
    }
    return trim((string) $v);
}

// ---------------------------------------------------------------- input
$raw = file_get_contents('php://input', false, null, 0, 16384);
$in = json_decode($raw === false ? '' : $raw, true);
if (!is_array($in)) json_error(400, 'bad_request', 'Send JSON.');
if (trim((string) ($in['website'] ?? '')) !== '') json_out(['ok' => true]); // honeypot

$kinds = ['idea' => 'Idea', 'problem' => 'Problem', 'other' => 'Other'];
$kind = $kinds[(string) ($in['kind'] ?? 'other')] ?? 'Other';
$message = trim(str_replace("\r\n", "\n", (string) ($in['message'] ?? '')));
$message = preg_replace('/[^\P{C}\n\t]/u', '', $message) ?? '';
$len = mb_strlen($message);
if ($len < 3) json_error(422, 'too_short', 'Write a few words first.');
if ($len > 2000) json_error(422, 'too_long', 'Keep it under 2,000 characters.');
$reply = trim((string) ($in['email'] ?? ''));
if ($reply !== '' && (strlen($reply) > 200 || !filter_var($reply, FILTER_VALIDATE_EMAIL))) {
    json_error(422, 'bad_email', 'That email address does not look right.');
}
$key = challenge_key();
if ($key === null) json_error(503, 'not_configured', 'Feedback is not set up on this server yet.');
$token = (string) ($in['token'] ?? '');
if ($token === '') json_error(422, 'challenge_expired', 'Answer the small sum first.');
$bad = check_challenge($key, $token, (string) ($in['answer'] ?? ''));
if ($bad !== null) {
    // A fresh question rides along, so the popup can swap it in without another round trip.
    json_out(['error' => ['code' => $bad[1], 'message' => $bad[2]], 'challenge' => $bad[1] === 'too_fast' ? null : new_challenge($key)], $bad[0]);
}

// ---------------------------------------------------------------- settings
$from = mail_setting('MAIL_FROM_ADDRESS');
$to = mail_setting('FEEDBACK_TO') ?: $from;
$cid = mail_setting('GMAIL_CLIENT_ID');
$secret = mail_setting('GMAIL_CLIENT_SECRET');
$refresh = mail_setting('GMAIL_REFRESH_TOKEN');
if (strtolower(mail_setting('MAIL_MAILER') ?: 'gmail') !== 'gmail' || $from === '' || $to === '' || $cid === '' || $secret === '' || $refresh === '') {
    json_error(503, 'not_configured', 'Feedback is not set up on this server yet.');
}

// Daily cap per IP (after validation, so typos do not burn it).
$dayDir = CACHE_DIR . DIRECTORY_SEPARATOR . 'feedback';
if (ensure_dir($dayDir)) {
    $f = $dayDir . DIRECTORY_SEPARATOR . sha1(client_ip()) . '-' . gmdate('Ymd');
    $n = (int) @file_get_contents($f);
    if ($n >= 10) json_error(429, 'daily_limit', 'Thanks! That is plenty for today.');
    @file_put_contents($f, (string) ($n + 1), LOCK_EX);
}

// ---------------------------------------------------------------- Gmail API
function http_post(string $url, string $body, array $headers): array
{
    $ch = curl_init(upstream_rewrite($url)); // rewrite: local test server only
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_HTTPHEADER => $headers,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 12,
        CURLOPT_CONNECTTIMEOUT => 5,
    ]);
    $res = curl_exec($ch);
    $code = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    return [$code, is_string($res) ? $res : ''];
}

/** Access token from the refresh token, cached until a minute before it expires. */
function gmail_token(string $cid, string $secret, string $refresh): ?string
{
    $cacheFile = CACHE_DIR . DIRECTORY_SEPARATOR . 'feedback' . DIRECTORY_SEPARATOR . 'token-' . sha1($cid . $refresh);
    $cached = @json_decode((string) @file_get_contents($cacheFile), true);
    if (is_array($cached) && ($cached['exp'] ?? 0) > time() && is_string($cached['tok'] ?? null)) return $cached['tok'];
    [$code, $body] = http_post('https://oauth2.googleapis.com/token', http_build_query([
        'client_id' => $cid,
        'client_secret' => $secret,
        'refresh_token' => $refresh,
        'grant_type' => 'refresh_token',
    ]), ['Content-Type: application/x-www-form-urlencoded']);
    $j = json_decode($body, true);
    if ($code !== 200 || !is_array($j) || !is_string($j['access_token'] ?? null)) {
        error_log('[raincheck feedback] token refresh failed: HTTP ' . $code);
        return null;
    }
    @file_put_contents($cacheFile, json_encode(['tok' => $j['access_token'], 'exp' => time() + (int) ($j['expires_in'] ?? 3600) - 60]), LOCK_EX);
    @chmod($cacheFile, 0600);
    return $j['access_token'];
}

$hdr = fn(string $s): string => '=?UTF-8?B?' . base64_encode($s) . '?=';
$clean = fn(string $s): string => str_replace(["\r", "\n"], ' ', $s);
$name = mail_setting('MAIL_FROM_NAME') ?: 'RainCheck';
$first = mb_substr(preg_replace('/\s+/u', ' ', $message) ?? '', 0, 60);
$subject = "RainCheck feedback ({$kind}): {$first}" . (mb_strlen($message) > 60 ? '…' : '');
$text = $message . "\n\n—\nKind: {$kind}\nReply to: " . ($reply !== '' ? $reply : '(not given)')
    . "\nSent: " . gmdate('Y-m-d H:i') . " UTC\nSite: " . (string) ($_SERVER['HTTP_HOST'] ?? '') . "\n";
$mime = implode("\r\n", array_filter([
    'From: ' . $hdr($clean($name)) . ' <' . $clean($from) . '>',
    'To: <' . $clean($to) . '>',
    $reply !== '' ? 'Reply-To: <' . $clean($reply) . '>' : null,
    'Subject: ' . $hdr($clean($subject)),
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
])) . "\r\n\r\n" . chunk_split(base64_encode($text));

$token = gmail_token($cid, $secret, $refresh);
if ($token === null) json_error(502, 'send_failed', 'Could not send right now. Please try again later.');
[$code] = http_post(
    'https://gmail.googleapis.com/gmail/v1/users/me/messages/send',
    json_encode(['raw' => rtrim(strtr(base64_encode($mime), '+/', '-_'), '=')]),
    ['Content-Type: application/json', 'Authorization: Bearer ' . $token],
);
if ($code < 200 || $code >= 300) {
    error_log('[raincheck feedback] gmail send failed: HTTP ' . $code);
    json_error(502, 'send_failed', 'Could not send right now. Please try again later.');
}
json_out(['ok' => true]);
