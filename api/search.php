<?php
// Place search (Nominatim), Malaysia only. Nominatim's usage policy asks for caching, an identifying
// User-Agent and at most 1 request per second from the whole site: results are cached for 24 h and a
// site-wide lock spaces upstream calls ≥1.1 s apart.
require __DIR__ . '/common.php';
api_boot('search', 30);

$q = $_GET['q'] ?? '';
if (!is_string($q)) json_error(400, 'bad_request', 'q is required.');
$q = trim(preg_replace('/\s+/u', ' ', $q) ?? '');
$len = function_exists('mb_strlen') ? mb_strlen($q) : strlen($q);
if ($len < 3 || $len > 100) json_error(400, 'bad_request', 'q must be 3 to 100 characters.');
$norm = function_exists('mb_strtolower') ? mb_strtolower($q) : strtolower($q);

$url = 'https://nominatim.openstreetmap.org/search?' . http_build_query([
    'q' => $q,
    'countrycodes' => 'my',
    'format' => 'jsonv2',
    'limit' => '5',
    'accept-language' => 'en',
]);

/** Block until ≥1.1 s since the last upstream Nominatim call from this site (max wait ~1.1 s). */
function nominatim_gate(): void
{
    if (!ensure_dir(CACHE_DIR)) return;
    $fh = @fopen(CACHE_DIR . DIRECTORY_SEPARATOR . 'nominatim.lock', 'c+');
    if (!$fh) return;
    if (flock($fh, LOCK_EX)) {
        $last = (float) stream_get_contents($fh);
        $wait = $last + 1.1 - microtime(true);
        if ($wait > 0) usleep((int) (min($wait, 1.1) * 1e6));
        ftruncate($fh, 0);
        rewind($fh);
        fwrite($fh, (string) microtime(true));
        fflush($fh);
        flock($fh, LOCK_UN);
    }
    fclose($fh);
}

send_cached_or_fetch('search:' . sha1($norm), 86400, function () use ($url) {
    nominatim_gate();
    $r = upstream_get($url, ['Accept: application/json'], 8);
    $r['content_type'] = 'application/json; charset=utf-8';
    return $r;
});
