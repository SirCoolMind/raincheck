<?php
/**
 * Shared helpers for the RainCheck proxy endpoints. No framework, no DB, file cache.
 *
 * Test hooks (honoured ONLY when PHP_SAPI === 'cli-server' AND REMOTE_ADDR === 127.0.0.1,
 * i.e. the local dev server; ignored on Nginx + PHP-FPM):
 *   RAINCHECK_CACHE_DIR            override cache directory
 *   RAINCHECK_UPSTREAM_OVERRIDE    replace scheme+host of every upstream URL (e.g. http://127.0.0.1:9/ to force failures)
 *   RAINCHECK_RATE_PER_MIN         override per-minute rate limit
 *   RAINCHECK_REQUIRE_BROWSER_HEADERS  1 = refuse requests without browser origin headers
 */

declare(strict_types=1);

/**
 * Identifying User-Agent for upstreams that require one (MET Norway, Nominatim). Uses SITE_URL from
 * config.local.php when set (the public site address); no personal data.
 */
function app_ua(): string
{
    $site = (string) cfg('SITE_URL', '');
    return 'RainCheck/1.0 (+' . ($site !== '' ? $site : 'https://github.com/example/raincheck-daily-commute') . ')';
}

function rc_dev(): bool
{
    return PHP_SAPI === 'cli-server' && ($_SERVER['REMOTE_ADDR'] ?? '') === '127.0.0.1';
}

function rc_env(string $name): ?string
{
    if (!rc_dev()) return null;
    $v = getenv($name);
    return ($v === false || $v === '') ? null : $v;
}

function cfg(string $key, $default = null)
{
    static $c = null;
    if ($c === null) {
        $local = __DIR__ . '/config.local.php';
        $c = is_file($local) ? require $local : require __DIR__ . '/config.example.php';
        if (!is_array($c)) $c = [];
    }
    return array_key_exists($key, $c) && $c[$key] !== null ? $c[$key] : $default;
}

define('CACHE_DIR', rtrim((string) (rc_env('RAINCHECK_CACHE_DIR') ?? cfg('CACHE_DIR', __DIR__ . '/cache')), '/\\'));

// ---------------------------------------------------------------- output

function send_security_headers(): void
{
    header('X-Content-Type-Options: nosniff');
    header('Referrer-Policy: no-referrer');
    // Lets the browser tell "our API answered (e.g. 429)" from "no API here" so it never
    // bypasses the server cache by calling the free upstream directly.
    header('X-RainCheck-Api: 1');
    header('Access-Control-Expose-Headers: X-RainCheck-Api, Expires, X-Cache, Retry-After');
}

function json_out($data, int $status = 200, array $headers = []): void
{
    send_security_headers();
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    if (!isset($headers['Cache-Control'])) header('Cache-Control: no-store');
    foreach ($headers as $k => $v) header($k . ': ' . $v);
    echo json_encode($data, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    exit;
}

function json_error(int $status, string $code, string $message, array $headers = []): void
{
    json_out(['error' => ['code' => $code, 'message' => $message]], $status, $headers);
}

// ---------------------------------------------------------------- request guards

function client_ip(): string
{
    $ip = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    if (cfg('TRUST_PROXY', false) && !empty($_SERVER['HTTP_X_FORWARDED_FOR'])) {
        $first = trim(explode(',', $_SERVER['HTTP_X_FORWARDED_FOR'])[0]);
        if (filter_var($first, FILTER_VALIDATE_IP)) $ip = $first;
    }
    return $ip;
}

function request_scheme(): string
{
    if (cfg('TRUST_PROXY', false) && !empty($_SERVER['HTTP_X_FORWARDED_PROTO'])) {
        return strtolower(explode(',', $_SERVER['HTTP_X_FORWARDED_PROTO'])[0]) === 'https' ? 'https' : 'http';
    }
    $https = $_SERVER['HTTPS'] ?? '';
    return ($https !== '' && strtolower($https) !== 'off') ? 'https' : 'http';
}

function cors_same_origin(): void
{
    $origin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($origin !== '') {
        header('Vary: Origin');
        if (in_array(strtolower($origin), own_origins(), true)) {
            header('Access-Control-Allow-Origin: ' . $origin);
            header('Access-Control-Allow-Methods: GET, HEAD, OPTIONS');
            header('Access-Control-Allow-Headers: Content-Type');
            header('Access-Control-Max-Age: 86400');
        }
    }
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') === 'OPTIONS') {
        send_security_headers();
        http_response_code(204);
        exit;
    }
}

function only_get(): void
{
    $m = $_SERVER['REQUEST_METHOD'] ?? 'GET';
    if ($m !== 'GET' && $m !== 'HEAD') {
        json_error(405, 'method_not_allowed', 'Only GET is supported.', ['Allow' => 'GET, HEAD, OPTIONS']);
    }
}

/** Our own origin plus the configured dev origins. */
function own_origins(): array
{
    $self = request_scheme() . '://' . ($_SERVER['HTTP_HOST'] ?? '');
    $extra = cfg('ALLOWED_ORIGINS', ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173']);
    return array_map('strtolower', array_merge([$self], (array) $extra));
}

/**
 * Only RainCheck's own pages may use this API. Browsers say where a request comes from (Sec-Fetch-Site,
 * Origin, Referer); a request another website's page makes is refused with 403, so nobody can run their
 * site on this API or on its CARTO key. Requests with none of these headers (curl, monitoring) pass,
 * unless REQUIRE_BROWSER_HEADERS is true, which also turns away naive scripts. A script can fake headers,
 * so this is a fence, not a lock: the per-IP limits and daily budgets still apply to everyone.
 */
function same_site_guard(): void
{
    if (!cfg('SAME_SITE_ONLY', true)) return;
    $mine = own_origins();
    $deny = fn() => json_error(403, 'cross_site', 'This API only serves RainCheck pages.');
    $sfs = strtolower((string) ($_SERVER['HTTP_SEC_FETCH_SITE'] ?? ''));
    $origin = strtolower(rtrim((string) ($_SERVER['HTTP_ORIGIN'] ?? ''), '/'));
    $ref = (string) ($_SERVER['HTTP_REFERER'] ?? '');
    $refOrigin = '';
    if ($ref !== '') {
        $u = parse_url($ref);
        if (is_array($u) && isset($u['scheme'], $u['host'])) $refOrigin = strtolower($u['scheme'] . '://' . $u['host'] . (isset($u['port']) ? ':' . $u['port'] : ''));
    }
    // An Origin or Referer naming another site settles it, whatever else is sent.
    if ($origin !== '' && $origin !== 'null' && !in_array($origin, $mine, true)) $deny();
    if ($origin === 'null') $deny(); // sandboxed iframes, data: pages
    if ($refOrigin !== '' && !in_array($refOrigin, $mine, true)) $deny();
    // cross-site / same-site (another subdomain) are refused unless that page's origin is explicitly allowed.
    if ($sfs === 'cross-site' || $sfs === 'same-site') {
        if (!($origin !== '' && in_array($origin, $mine, true)) && !($refOrigin !== '' && in_array($refOrigin, $mine, true))) $deny();
    }
    $strict = rc_env('RAINCHECK_REQUIRE_BROWSER_HEADERS') ?? cfg('REQUIRE_BROWSER_HEADERS', false);
    if (filter_var($strict, FILTER_VALIDATE_BOOLEAN) && $sfs === '' && $origin === '' && $refOrigin === '') $deny();
}

/** Standard prologue for every endpoint. */
function api_boot(string $bucket, ?int $perMin = null): void
{
    send_security_headers();
    cors_same_origin();
    same_site_guard();
    only_get();
    rate_limit($bucket, $perMin);
}

// ---------------------------------------------------------------- file helpers

function ensure_dir(string $dir): bool
{
    if (is_dir($dir)) return true;
    return @mkdir($dir, 0775, true) || is_dir($dir);
}

function atomic_write(string $path, string $data): bool
{
    $dir = dirname($path);
    if (!ensure_dir($dir)) return false;
    $tmp = $dir . DIRECTORY_SEPARATOR . '.tmp' . bin2hex(random_bytes(6));
    if (@file_put_contents($tmp, $data, LOCK_EX) === false) return false;
    if (!@rename($tmp, $path)) {
        @unlink($tmp);
        return false;
    }
    return true;
}

// ---------------------------------------------------------------- cache

function cache_path(string $key): string
{
    $h = sha1($key);
    return CACHE_DIR . DIRECTORY_SEPARATOR . 'c' . DIRECTORY_SEPARATOR . substr($h, 0, 2) . DIRECTORY_SEPARATOR . $h . '.cache';
}

/**
 * Returns the cached body (even if expired - check $meta['expires']) or null.
 * File format: one JSON meta line, "\n", raw body.
 */
function cache_get(string $key, &$meta = null): ?string
{
    $meta = [];
    $raw = @file_get_contents(cache_path($key));
    if ($raw === false) return null;
    $nl = strpos($raw, "\n");
    if ($nl === false) return null;
    $m = json_decode(substr($raw, 0, $nl), true);
    if (!is_array($m) || !isset($m['expires'])) return null;
    $meta = $m;
    return substr($raw, $nl + 1);
}

function cache_put(string $key, string $body, int $ttl, array $meta = []): void
{
    $meta['expires'] = time() + max(1, $ttl);
    $meta['fetched_at'] = $meta['fetched_at'] ?? time();
    $meta['content_type'] = $meta['content_type'] ?? 'application/octet-stream';
    $meta['status'] = $meta['status'] ?? 200;
    atomic_write(cache_path($key), json_encode($meta, JSON_UNESCAPED_SLASHES) . "\n" . $body);
}

// ---------------------------------------------------------------- rate limit

function rate_limit(string $bucket, ?int $perMin = null): void
{
    $perMin = $perMin ?? (int) (rc_env('RAINCHECK_RATE_PER_MIN') ?? cfg('RATE_PER_MIN', 60));
    $now = time();
    $minute = intdiv($now, 60);
    $dir = CACHE_DIR . DIRECTORY_SEPARATOR . 'rl';
    if (!ensure_dir($dir)) return; // fail open
    $file = $dir . DIRECTORY_SEPARATOR . sha1(client_ip() . '|' . $bucket) . '-' . $minute;
    $fh = @fopen($file, 'c+');
    if (!$fh) return;
    $count = 0;
    if (flock($fh, LOCK_EX)) {
        $count = (int) stream_get_contents($fh) + 1;
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, (string) $count);
        fflush($fh);
        flock($fh, LOCK_UN);
    }
    fclose($fh);
    if (random_int(1, 100) === 1) { // opportunistic cleanup of old counters
        foreach (@glob($dir . DIRECTORY_SEPARATOR . '*') ?: [] as $f) {
            if (@filemtime($f) < $now - 300) @unlink($f);
        }
    }
    if ($count > $perMin) {
        json_error(429, 'rate_limited', 'Too many requests. Please slow down.', ['Retry-After' => (string) (60 - ($now % 60))]);
    }
}

// ---------------------------------------------------------------- daily free-tier budget

/**
 * Upstream calls allowed per day (Malaysia time) per host, about 80 % of each free tier, so many
 * visitors can never push the site past a provider's limit. Override per host with DAILY_BUDGET in
 * config.local.php; null = unlimited. Open-Meteo weighs each request by its number of locations.
 */
const DEFAULT_DAILY_BUDGET = [
    'api.open-meteo.com' => 8000,          // free tier: 10,000 calls/day (multi-location requests count per location)
    'api.met.no' => 20000,                 // no fixed cap; be a good citizen
    'api.data.gov.my' => 5000,
    'api.rainviewer.com' => 5000,
    'router.project-osrm.org' => 5000,     // public demo server: not for heavy use
    'nominatim.openstreetmap.org' => 4000, // usage policy: light use, ≤1 req/s
];

/** Count one upstream call (× weight) for today; false once the host's daily cap is reached. Fails open. */
function budget_take(string $url, int $weight = 1): bool
{
    $host = strtolower((string) parse_url($url, PHP_URL_HOST));
    $caps = array_merge(DEFAULT_DAILY_BUDGET, (array) cfg('DAILY_BUDGET', []));
    $override = rc_env('RAINCHECK_DAILY_BUDGET');
    $cap = $override !== null ? (int) $override : ($caps[$host] ?? null);
    if ($cap === null || $host === '') return true;
    $dir = CACHE_DIR . DIRECTORY_SEPARATOR . 'budget';
    if (!ensure_dir($dir)) return true;
    $day = gmdate('Ymd', time() + 8 * 3600);
    $fh = @fopen($dir . DIRECTORY_SEPARATOR . preg_replace('/[^a-z0-9.-]/', '_', $host) . '-' . $day, 'c+');
    if (!$fh) return true;
    $ok = true;
    if (flock($fh, LOCK_EX)) {
        $used = (int) stream_get_contents($fh);
        if ($used + max(1, $weight) > $cap) {
            $ok = false;
        } else {
            ftruncate($fh, 0);
            rewind($fh);
            fwrite($fh, (string) ($used + max(1, $weight)));
            fflush($fh);
        }
        flock($fh, LOCK_UN);
    }
    fclose($fh);
    if (random_int(1, 200) === 1) { // drop counters from earlier days
        foreach (@glob($dir . DIRECTORY_SEPARATOR . '*') ?: [] as $f) {
            if (!str_ends_with($f, '-' . $day) && @filemtime($f) < time() - 3 * 86400) @unlink($f);
        }
    }
    return $ok;
}

/** Seconds until midnight Malaysia time (when daily budgets reset). */
function seconds_to_myt_midnight(): int
{
    $myt = time() + 8 * 3600;
    return 86400 - ($myt % 86400);
}

// ---------------------------------------------------------------- upstream

function upstream_rewrite(string $url): string
{
    $o = rc_env('RAINCHECK_UPSTREAM_OVERRIDE');
    if ($o === null) return $url;
    $p = parse_url($url);
    if (!$p) return $url;
    return rtrim($o, '/') . ($p['path'] ?? '/') . (isset($p['query']) ? '?' . $p['query'] : '');
}

/** @return array{status:int, body:string, headers:array<string,string>}  status 0 = network failure; header names lower-cased */
function upstream_get(string $url, array $headers = [], int $timeout = 8, bool $follow = true, int $weight = 1): array
{
    if (!budget_take($url, $weight)) return ['status' => 0, 'body' => '', 'headers' => [], 'budget' => true];
    $url = upstream_rewrite($url);
    $fail = ['status' => 0, 'body' => '', 'headers' => []];

    if (function_exists('curl_init')) {
        $resp = [];
        $ch = curl_init($url);
        curl_setopt_array($ch, [
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_USERAGENT => app_ua(),
            CURLOPT_HTTPHEADER => $headers,
            CURLOPT_FOLLOWLOCATION => $follow,
            CURLOPT_MAXREDIRS => 3,
            CURLOPT_CONNECTTIMEOUT => min(5, $timeout),
            CURLOPT_TIMEOUT => $timeout,
            CURLOPT_ENCODING => '',
            CURLOPT_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_REDIR_PROTOCOLS => CURLPROTO_HTTP | CURLPROTO_HTTPS,
            CURLOPT_HEADERFUNCTION => function ($ch, $line) use (&$resp) {
                if (stripos($line, 'HTTP/') === 0) {
                    $resp = [];
                } elseif (strpos($line, ':') !== false) {
                    [$k, $v] = explode(':', $line, 2);
                    $resp[strtolower(trim($k))] = trim($v);
                }
                return strlen($line);
            },
        ]);
        $body = curl_exec($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        if ($body === false || $status === 0) return $fail;
        return ['status' => $status, 'body' => (string) $body, 'headers' => $resp];
    }

    $gz = function_exists('gzdecode');
    $hdrs = array_merge(['User-Agent: ' . app_ua()], $gz ? ['Accept-Encoding: gzip'] : [], $headers);
    $ctx = stream_context_create(['http' => [
        'method' => 'GET',
        'header' => implode("\r\n", $hdrs),
        'timeout' => $timeout,
        'follow_location' => 1,
        'max_redirects' => 4, // 3 redirects
        'ignore_errors' => true,
    ]]);
    $body = @file_get_contents($url, false, $ctx);
    $rh = function_exists('http_get_last_response_headers') ? http_get_last_response_headers() : ($http_response_header ?? null);
    if ($body === false || empty($rh)) return $fail;
    $status = 0;
    $resp = [];
    foreach ($rh as $line) {
        if (stripos($line, 'HTTP/') === 0) {
            $resp = [];
            $parts = explode(' ', $line, 3);
            $status = (int) ($parts[1] ?? 0);
        } elseif (strpos($line, ':') !== false) {
            [$k, $v] = explode(':', $line, 2);
            $resp[strtolower(trim($k))] = trim($v);
        }
    }
    if ($gz && stripos($resp['content-encoding'] ?? '', 'gzip') !== false) {
        $d = @gzdecode($body);
        if ($d !== false) $body = $d;
    }
    return ['status' => $status, 'body' => (string) $body, 'headers' => $resp];
}

// ---------------------------------------------------------------- cached fetch

function serve_body(string $body, array $meta, string $xcache, ?string $cacheControl = null): void
{
    send_security_headers();
    http_response_code(200);
    header('Content-Type: ' . ($meta['content_type'] ?? 'application/octet-stream'));
    header('X-Cache: ' . $xcache);
    $remaining = max(0, (int) ($meta['expires'] ?? 0) - time());
    if ($cacheControl === null) {
        $cacheControl = $xcache === 'STALE' ? 'public, max-age=60'
            : (!empty($meta['cache_control']) ? $meta['cache_control'] : 'public, max-age=' . $remaining);
    }
    header('Cache-Control: ' . $cacheControl);
    if (!empty($meta['expires'])) header('Expires: ' . gmdate('D, d M Y H:i:s', (int) $meta['expires']) . ' GMT');
    header('Access-Control-Expose-Headers: Expires, X-Cache, Retry-After');
    if (($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'HEAD') echo $body;
    exit;
}

/**
 * Cache-through helper. $fetch(?array $cachedMeta): array with
 *   status, body, headers (as upstream_get) plus optional:
 *   ttl (int seconds, default $ttlFallback), cache (bool, default true), content_type, cache_control,
 *   extra (array merged into stored meta), passthrough (bool: relay upstream 4xx status+body uncached).
 * $cachedMeta is passed (non-null) when a stale entry exists so the fetcher can send conditional headers.
 * X-Cache: HIT | MISS | STALE (upstream failed, stale copy served) | BYPASS (valid but not cacheable).
 */
function send_cached_or_fetch(string $key, int $ttlFallback, callable $fetch): void
{
    $meta = [];
    $cached = cache_get($key, $meta);
    if ($cached !== null && (int) $meta['expires'] > time()) {
        serve_body($cached, $meta, 'HIT');
    }

    $r = $fetch($cached !== null ? $meta : null);
    $st = (int) ($r['status'] ?? 0);
    $ttl = max(1, (int) ($r['ttl'] ?? $ttlFallback));

    if ($cached !== null && $st === 304) {
        $meta = array_merge($meta, array_filter((array) ($r['extra'] ?? []), fn($v) => $v !== null));
        cache_put($key, $cached, $ttl, $meta);
        $meta['expires'] = time() + $ttl;
        serve_body($cached, $meta, 'HIT');
    }

    if ($st >= 200 && $st < 300) {
        $m = array_merge((array) ($r['extra'] ?? []), [
            'content_type' => $r['content_type'] ?? ($r['headers']['content-type'] ?? 'application/octet-stream'),
            'status' => $st,
            'fetched_at' => time(),
        ]);
        if (!empty($r['cache_control'])) $m['cache_control'] = $r['cache_control'];
        if ($r['cache'] ?? true) {
            cache_put($key, (string) $r['body'], $ttl, $m);
            $m['expires'] = time() + $ttl;
            serve_body((string) $r['body'], $m, 'MISS');
        }
        $m['expires'] = 0;
        serve_body((string) $r['body'], $m, 'BYPASS', 'no-store');
    }

    if ($cached !== null) serve_body($cached, $meta, 'STALE');

    if (!empty($r['budget'])) {
        json_error(503, 'daily_budget', 'This free data source has reached its daily limit on this site. Cached data only until midnight.',
            ['Retry-After' => (string) seconds_to_myt_midnight()]);
    }

    if (!empty($r['passthrough']) && $st >= 400 && $st < 500 && $st !== 429) {
        send_security_headers();
        http_response_code($st);
        header('Content-Type: ' . ($r['headers']['content-type'] ?? 'application/json'));
        header('Cache-Control: no-store');
        header('X-Cache: BYPASS');
        echo $r['body'];
        exit;
    }

    if ($st === 0) json_error(502, 'upstream_unreachable', 'The upstream service could not be reached.');
    json_error(502, 'upstream_error', 'The upstream service returned status ' . $st . '.');
}

// ---------------------------------------------------------------- validation helpers

function malaysia_lat_ok(float $lat): bool { return $lat >= 0 && $lat <= 8; }
function malaysia_lon_ok(float $lon): bool { return $lon >= 99 && $lon <= 120; }

function ttl_from_expires(?string $expires, int $fallback, int $min = 60, int $max = 21600): int
{
    if ($expires) {
        $t = strtotime($expires);
        if ($t !== false) return max($min, min($max, $t - time()));
    }
    return $fallback;
}
