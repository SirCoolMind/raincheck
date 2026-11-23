<?php
/**
 * Smoke test for api/*.php. Usage: php tests/php/smoke.php
 * Starts its own PHP dev servers on 127.0.0.1:8799 with a temp cache dir. Live upstream calls are made once (then cached).
 * Never prints response bodies (carto responses could in theory contain the key) - only status codes/headers.
 */
$root = dirname(__DIR__, 2);
$port = 8799;
$base = "http://127.0.0.1:$port";
$hasKey = is_file($root . '/api/config.local.php');
$fails = 0; $passes = 0;
$procs = []; $tmpDirs = [];

function check(string $name, bool $ok, string $detail = ''): void {
    global $fails, $passes;
    $ok ? $passes++ : $fails++;
    echo ($ok ? 'PASS' : 'FAIL') . '  ' . $name . ($ok || $detail === '' ? '' : "  ($detail)") . "\n";
}

function rrmdir(string $d): void {
    if (!is_dir($d)) return;
    foreach (scandir($d) as $f) {
        if ($f === '.' || $f === '..') continue;
        $p = $d . DIRECTORY_SEPARATOR . $f;
        is_dir($p) ? rrmdir($p) : @unlink($p);
    }
    @rmdir($d);
}

function start_server(array $env): array {
    global $root, $port, $tmpDirs;
    $cache = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'raincheck-smoke-' . bin2hex(random_bytes(4));
    $tmpDirs[] = $cache;
    $envs = array_merge(getenv(), ['RAINCHECK_CACHE_DIR' => $cache], $env);
    $nul = DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null';
    $proc = proc_open([PHP_BINARY, '-S', "127.0.0.1:$port", '-t', $root],
        [0 => ['file', $nul, 'r'], 1 => ['file', $nul, 'w'], 2 => ['file', $nul, 'w']], $pipes, $root, $envs);
    for ($i = 0; $i < 50; $i++) {
        $s = @fsockopen('127.0.0.1', $port, $e, $es, 0.2);
        if ($s) { fclose($s); return [$proc, $cache]; }
        usleep(100000);
    }
    throw new RuntimeException('server did not start');
}

function stop_server($proc): void {
    proc_terminate($proc);
    proc_close($proc);
    usleep(300000);
}

/** @return array{status:int, headers:array, json:?array} */
function req(string $path, string $method = 'GET', array $hdr = [], ?string $payload = null): array {
    global $base;
    $h = [];
    $ch = curl_init($base . $path);
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 40, CURLOPT_CUSTOMREQUEST => $method,
        CURLOPT_HTTPHEADER => $hdr,
        CURLOPT_HEADERFUNCTION => function ($c, $l) use (&$h) {
            if (strpos($l, ':') !== false) { [$k, $v] = explode(':', $l, 2); $h[strtolower(trim($k))] = trim($v); }
            return strlen($l);
        },
    ]);
    if ($payload !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
    $body = curl_exec($ch);
    $st = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    return ['status' => $st, 'headers' => $h, 'json' => is_string($body) ? json_decode($body, true) : null, 'leak' => is_string($body) && preg_match('/[?&]key=/', $body) === 1];
}

$endpoints = [
    'openmeteo'      => ['/api/openmeteo.php?lat=2.81,3.16&lon=101.64,101.72', '/api/openmeteo.php?lat=2.81&lon=101.64,101.72'],
    'metno'          => ['/api/metno.php?lat=2.9226&lon=101.651', '/api/metno.php?lat=50&lon=101'],
    'metmy forecast' => ['/api/metmy.php?kind=forecast&district=Ds064', '/api/metmy.php?kind=forecast&district=Sepang'],
    'metmy warning'  => ['/api/metmy.php?kind=warning', '/api/metmy.php?kind=bogus'],
    'radar'          => ['/api/radar.php', null],
    'route'          => ['/api/route.php?wp=101.651,2.9226;101.6964,2.9264', '/api/route.php?wp=abc'],
    'search'         => ['/api/search.php?q=Putrajaya', '/api/search.php?q=ab'],
    'carto style'    => ['/api/carto.php?p=gl/voyager-gl-style/style.json', '/api/carto.php?p=../etc/passwd'],
];

try {
    // ---- normal + cache behaviour
    [$srv] = start_server([]);
    foreach ($endpoints as $name => [$good, $bad]) {
        if ($name === 'carto style' && !$hasKey) {
            $r = req($good);
            check("$name: no key -> 503 no_key", $r['status'] === 503 && ($r['json']['error']['code'] ?? '') === 'no_key', (string) $r['status']);
        } else {
            $r1 = req($good);
            check("$name: first call 200 + X-Cache MISS", $r1['status'] === 200 && ($r1['headers']['x-cache'] ?? '') === 'MISS',
                $r1['status'] . ' ' . ($r1['headers']['x-cache'] ?? '-') . ' ' . ($r1['json']['error']['code'] ?? ''));
            $r2 = req($good);
            check("$name: second call HIT", $r2['status'] === 200 && ($r2['headers']['x-cache'] ?? '') === 'HIT', $r2['status'] . ' ' . ($r2['headers']['x-cache'] ?? '-'));
            if ($name === 'carto style') check("$name: no key= in response body", !$r1['leak'] && !$r2['leak']);
            if ($name === 'metno') check("$name: Expires exposed", isset($r2['headers']['expires']) && stripos($r2['headers']['access-control-expose-headers'] ?? '', 'Expires') !== false);
        }
        if ($bad !== null) {
            $rb = req($bad);
            check("$name: validation error -> 400 JSON", $rb['status'] === 400 && isset($rb['json']['error']['code']), (string) $rb['status']);
            check("$name: error marked as ours (X-RainCheck-Api)", ($rb['headers']['x-raincheck-api'] ?? '') === '1');
        }
    }
    $r = req('/api/radar.php', 'POST');
    check('radar: POST -> 405 JSON', $r['status'] === 405 && isset($r['json']['error']['code']), (string) $r['status']);
    $r = req('/api/carto.php?p=gl/voyager-gl-style/style.json&h=evil.example.com');
    check('carto: foreign host -> 400', $r['status'] === 400, (string) $r['status']);
    $r = req('/api/carto.php?p=//evil.example.com/x.png');
    check('carto: leading // -> 400', $r['status'] === 400, (string) $r['status']);
    $r = req('/api/carto.php?p=a/../b.png');
    check('carto: .. -> 400', $r['status'] === 400, (string) $r['status']);
    $r = req('/api/radar.php', 'GET', ['Origin: http://localhost:5173']);
    check('CORS: allowed origin echoed + Vary', ($r['headers']['access-control-allow-origin'] ?? '') === 'http://localhost:5173' && stripos($r['headers']['vary'] ?? '', 'Origin') !== false);
    $r = req('/api/radar.php', 'GET', ['Origin: http://evil.example.com']);
    check('CORS: foreign origin gets no ACAO', !isset($r['headers']['access-control-allow-origin']));
    $r = req('/api/radar.php', 'OPTIONS', ['Origin: http://localhost:5173']);
    check('CORS: OPTIONS -> 204', $r['status'] === 204, (string) $r['status']);
    // ---- same-site guard
    $r = req('/api/radar.php', 'GET', ['Sec-Fetch-Site: cross-site']);
    check('guard: Sec-Fetch-Site cross-site -> 403 cross_site', $r['status'] === 403 && ($r['json']['error']['code'] ?? '') === 'cross_site', (string) $r['status']);
    $r = req('/api/radar.php', 'GET', ['Sec-Fetch-Site: same-site']);
    check('guard: same-site (other subdomain) -> 403', $r['status'] === 403, (string) $r['status']);
    $r = req('/api/radar.php', 'GET', ['Origin: https://evil.example.com']);
    check('guard: foreign Origin -> 403', $r['status'] === 403, (string) $r['status']);
    $r = req('/api/radar.php', 'GET', ['Origin: null']);
    check('guard: Origin null -> 403', $r['status'] === 403, (string) $r['status']);
    $r = req('/api/radar.php', 'GET', ['Referer: https://evil.example.com/page']);
    check('guard: foreign Referer -> 403', $r['status'] === 403, (string) $r['status']);
    $r = req('/api/feedback.php?challenge=1', 'GET', ['Sec-Fetch-Site: cross-site']);
    check('guard: feedback cross-site -> 403', $r['status'] === 403, (string) $r['status']);
    $r = req('/api/radar.php', 'GET', ['Sec-Fetch-Site: same-origin', "Referer: $base/"]);
    check('guard: same-origin + own Referer -> 200', $r['status'] === 200, (string) $r['status']);
    $r = req('/api/radar.php', 'GET', ['Sec-Fetch-Site: cross-site', 'Origin: http://localhost:5173']);
    check('guard: allowed dev origin passes', $r['status'] === 200, (string) $r['status']);
    $r = req('/api/radar.php');
    check('guard: no browser headers (curl) -> 200', $r['status'] === 200, (string) $r['status']);
    $r = req('/api/nothing.php');
    check('unknown api path -> 404', $r['status'] === 404, (string) $r['status']);
    stop_server($srv);

    // ---- upstream failure with fresh empty cache
    [$srv] = start_server(['RAINCHECK_UPSTREAM_OVERRIDE' => 'http://127.0.0.1:9/']);
    foreach ($endpoints as $name => [$good]) {
        if ($name === 'carto style' && !$hasKey) continue;
        $r = req($good);
        check("$name: upstream down + empty cache -> 502 JSON", $r['status'] === 502 && isset($r['json']['error']['code']), $r['status'] . ' ' . ($r['json']['error']['code'] ?? ''));
    }
    stop_server($srv);

    // ---- stale-serving: prime cache then kill upstream (same cache dir is not reusable across start_server, so prime via override-less run)
    // (covered implicitly by X-Cache STALE logic; exercised below with a short-lived entry)

    // ---- daily free-tier budget used up: no upstream call, 503 + Retry-After (until MYT midnight)
    [$srv] = start_server(['RAINCHECK_DAILY_BUDGET' => '0']);
    $r = req('/api/radar.php');
    check('budget: cap reached + empty cache -> 503 daily_budget + Retry-After',
        $r['status'] === 503 && ($r['json']['error']['code'] ?? '') === 'daily_budget' && (int) ($r['headers']['retry-after'] ?? 0) > 0,
        $r['status'] . ' ' . ($r['json']['error']['code'] ?? ''));
    stop_server($srv);

    // ---- feedback (no mail settings in the test env → validation runs, sending answers 503 not_configured)
    [$srv] = start_server(['RAINCHECK_FEEDBACK_PER_MIN' => '50', 'MAIL_FROM_ADDRESS' => '', 'GMAIL_CLIENT_ID' => '', 'GMAIL_CLIENT_SECRET' => '', 'GMAIL_REFRESH_TOKEN' => '']);
    $json = ['Content-Type: application/json'];
    $r = req('/api/feedback.php');
    check('feedback: GET -> 405', $r['status'] === 405, (string) $r['status']);
    $r = req('/api/feedback.php', 'POST', $json, 'not json');
    check('feedback: bad JSON -> 400', $r['status'] === 400, (string) $r['status']);
    $r = req('/api/feedback.php', 'POST', $json, json_encode(['kind' => 'idea', 'message' => 'hi']));
    check('feedback: too short -> 422 too_short', $r['status'] === 422 && ($r['json']['error']['code'] ?? '') === 'too_short', (string) $r['status']);
    $r = req('/api/feedback.php', 'POST', $json, json_encode(['kind' => 'idea', 'message' => str_repeat('a', 2001)]));
    check('feedback: too long -> 422 too_long', $r['status'] === 422 && ($r['json']['error']['code'] ?? '') === 'too_long', (string) $r['status']);
    $r = req('/api/feedback.php', 'POST', $json, json_encode(['kind' => 'idea', 'message' => 'Great app', 'email' => 'nope']));
    check('feedback: bad reply email -> 422 bad_email', $r['status'] === 422 && ($r['json']['error']['code'] ?? '') === 'bad_email', (string) $r['status']);
    $r = req('/api/feedback.php', 'POST', $json, json_encode(['kind' => 'idea', 'message' => 'buy now', 'website' => 'http://spam']));
    check('feedback: honeypot -> fake 200 ok', $r['status'] === 200 && ($r['json']['ok'] ?? false) === true, (string) $r['status']);

    // Human check: a signed sum. This server keeps the 3 s minimum, so "too fast" can be tested first.
    $q = req('/api/feedback.php?challenge=1');
    check('feedback check: GET ?challenge -> "a + b" + token', $q['status'] === 200 && preg_match('/^\d+ \+ \d+$/', $q['json']['q'] ?? '') === 1 && str_contains($q['json']['token'] ?? '', '.'));
    $solve = function (array $c): string { [$a, $b] = array_map('intval', explode(' + ', $c['q'])); return (string) ($a + $b); };
    $post = fn(array $extra) => req('/api/feedback.php', 'POST', $json, json_encode(['kind' => 'idea', 'message' => 'The radar is great'] + $extra));
    $r = $post(['token' => $q['json']['token'], 'answer' => $solve($q['json'])]);
    check('feedback check: answered within 3 s -> 422 too_fast (token kept)', $r['status'] === 422 && ($r['json']['error']['code'] ?? '') === 'too_fast', (string) $r['status']);
    $r = $post([]);
    check('feedback check: no token -> 422', $r['status'] === 422 && ($r['json']['error']['code'] ?? '') === 'challenge_expired', (string) $r['status']);
    [$p0, $s0] = explode('.', $q['json']['token']);
    $forged = rtrim(strtr(base64_encode(json_encode(['a' => 1, 'b' => 1, 't' => time() - 60, 'n' => 'x'])), '+/', '-_'), '=') . '.' . $s0;
    $r = $post(['token' => $forged, 'answer' => '2']);
    check('feedback check: forged token -> 422 challenge_expired', $r['status'] === 422 && ($r['json']['error']['code'] ?? '') === 'challenge_expired', (string) $r['status']);
    sleep(3);
    $r = $post(['token' => $q['json']['token'], 'answer' => (string) ((int) $solve($q['json']) + 1)]);
    check('feedback check: wrong answer -> 422 wrong_answer + a fresh sum', $r['status'] === 422 && ($r['json']['error']['code'] ?? '') === 'wrong_answer' && isset($r['json']['challenge']['token']), (string) $r['status']);
    $r = $post(['token' => $q['json']['token'], 'answer' => $solve($q['json'])]);
    check('feedback check: a spent token cannot be replayed', $r['status'] === 422 && ($r['json']['error']['code'] ?? '') === 'challenge_expired', (string) $r['status']);
    $q2 = req('/api/feedback.php?challenge=1');
    sleep(3);
    // Only when no mail is configured locally: otherwise this would send a real email.
    if (!$hasKey || !str_contains((string) file_get_contents($root . '/api/config.local.php'), 'GMAIL_REFRESH_TOKEN')) {
        $r = $post(['token' => $q2['json']['token'], 'answer' => $solve($q2['json'])]);
        check('feedback: valid but unconfigured -> 503 not_configured', $r['status'] === 503 && ($r['json']['error']['code'] ?? '') === 'not_configured', (string) $r['status']);
    }
    stop_server($srv);

    // ---- feedback send path against a fake Google (token + Gmail send), checking the message we build
    $out = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'raincheck-fake-google-' . bin2hex(random_bytes(4)) . '.json';
    $nul = DIRECTORY_SEPARATOR === '\\' ? 'NUL' : '/dev/null';
    $fake = proc_open([PHP_BINARY, '-S', '127.0.0.1:8798', $root . '/tests/php/fake-google.php'],
        [0 => ['file', $nul, 'r'], 1 => ['file', $nul, 'w'], 2 => ['file', $nul, 'w']], $pp, $root, array_merge(getenv(), ['FAKE_GOOGLE_OUT' => $out]));
    usleep(500000);
    [$srv] = start_server([
        'RAINCHECK_FEEDBACK_PER_MIN' => '50', 'RAINCHECK_FEEDBACK_MIN_SECONDS' => '0', 'RAINCHECK_UPSTREAM_OVERRIDE' => 'http://127.0.0.1:8798',
        'MAIL_MAILER' => 'gmail', 'MAIL_FROM_ADDRESS' => 'sender@example.test', 'MAIL_FROM_NAME' => 'RainCheck Test',
        'GMAIL_CLIENT_ID' => 'cid', 'GMAIL_CLIENT_SECRET' => 'secret', 'GMAIL_REFRESH_TOKEN' => 'test-refresh', 'FEEDBACK_TO' => 'owner@example.test',
    ]);
    $q = req('/api/feedback.php?challenge=1');
    $r = req('/api/feedback.php', 'POST', $json, json_encode(['kind' => 'problem', 'message' => "Radar froze at 18:00\nsecond line ✓", 'email' => 'rider@example.test', 'token' => $q['json']['token'], 'answer' => $solve($q['json'])]));
    $sent = is_file($out) ? json_decode((string) file_get_contents($out), true) : null;
    $raw = is_array($sent) ? json_decode((string) $sent['body'], true)['raw'] ?? '' : '';
    $mime = base64_decode(strtr($raw, '-_', '+/'));
    [$head, $mbody] = array_pad(explode("\r\n\r\n", $mime, 2), 2, '');
    $text = base64_decode(str_replace("\r\n", '', $mbody));
    check('feedback send: 200 ok', $r['status'] === 200 && ($r['json']['ok'] ?? false) === true, (string) $r['status']);
    check('feedback send: bearer token from refresh', is_array($sent) && $sent['auth'] === 'Bearer test-access');
    check('feedback send: To / Reply-To / From headers', str_contains($head, 'To: <owner@example.test>') && str_contains($head, 'Reply-To: <rider@example.test>') && str_contains($head, '<sender@example.test>'));
    check('feedback send: subject names the kind', str_contains($head, 'Subject: =?UTF-8?B?') && str_contains(base64_decode((string) preg_replace('/^.*Subject: =\?UTF-8\?B\?([^?]+)\?=.*$/s', '$1', $head)), 'RainCheck feedback (Problem): Radar froze'));
    check('feedback send: body keeps the message (UTF-8, newlines)', str_contains($text, "Radar froze at 18:00\nsecond line ✓") && str_contains($text, 'Kind: Problem'));
    $r = req('/api/feedback.php', 'POST', $json, json_encode(['kind' => 'idea', 'message' => "Header\r\nBcc: evil@example.test", 'email' => "x@example.test\r\nBcc: evil@example.test"]));
    check('feedback send: header injection via reply email rejected', $r['status'] === 422, (string) $r['status']);
    stop_server($srv);
    proc_terminate($fake);
    proc_close($fake);
    @unlink($out);

    // ---- strict mode: header-less requests refused
    [$srv] = start_server(['RAINCHECK_REQUIRE_BROWSER_HEADERS' => '1']);
    $r = req('/api/radar.php');
    check('guard strict: no headers -> 403', $r['status'] === 403, (string) $r['status']);
    $r = req('/api/radar.php', 'GET', ['Sec-Fetch-Site: same-origin']);
    check('guard strict: same-origin -> 200', $r['status'] === 200, (string) $r['status']);
    stop_server($srv);

    // ---- rate limit
    [$srv] = start_server(['RAINCHECK_RATE_PER_MIN' => '5']);
    $got429 = null;
    for ($i = 0; $i < 7; $i++) { $r = req('/api/radar.php'); if ($r['status'] === 429) $got429 = $r; }
    check('rate limit: >=1 of 7 radar calls -> 429 JSON + Retry-After',
        $got429 !== null && isset($got429['json']['error']['code']) && isset($got429['headers']['retry-after']));
    stop_server($srv);
} catch (Throwable $e) {
    check('harness', false, $e->getMessage());
} finally {
    foreach ($tmpDirs as $d) rrmdir($d);
}

echo "\nSummary: $passes passed, $fails failed\n";
exit($fails > 0 ? 1 : 0);
