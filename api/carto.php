<?php
require __DIR__ . '/common.php';
// A map view needs style + sprites + glyphs + 20–60 tiles; mobile CGNAT shares IPs. High, separate limit.
api_boot('carto', (int) cfg('CARTO_RATE_PER_MIN', 1500));

// Only these upstream hosts, ever. This is not an open proxy.
const CARTO_HOSTS = [
    'basemaps.cartocdn.com', 'tiles.basemaps.cartocdn.com',
    'a.basemaps.cartocdn.com', 'b.basemaps.cartocdn.com', 'c.basemaps.cartocdn.com', 'd.basemaps.cartocdn.com',
];

$p = $_GET['p'] ?? '';
$h = $_GET['h'] ?? 'basemaps.cartocdn.com';
if (!is_string($p) || !is_string($h)) json_error(400, 'bad_request', 'Invalid parameters.');
if (!in_array($h, CARTO_HOSTS, true)) json_error(400, 'bad_host', 'Host not allowed.');
if (strpos($p, '//') === 0) json_error(400, 'bad_path', 'Invalid path.');
if (strpos($p, '/') === 0) $p = substr($p, 1); // tolerate one leading slash
if ($p === '' || !preg_match('#^[A-Za-z0-9/_.\-{}@, ]+$#', $p) || strpos($p, '..') !== false
    || strpos($p, '//') !== false || strlen($p) > 300) {
    json_error(400, 'bad_path', 'Invalid path.');
}

// Only basemap assets: the two GL styles, their sprites/fonts, and vector/raster tiles. No arbitrary CARTO paths.
$allowedPrefixes = [
    'gl/positron-gl-style/', 'gl/dark-matter-gl-style/', 'gl/voyager-gl-style/',
    'v/', 'vectortiles/', 'fonts/', 'rastertiles/', 'light_all/', 'dark_all/',
];
$okPrefix = false;
foreach ($allowedPrefixes as $pre) {
    if (strpos($p, $pre) === 0) { $okPrefix = true; break; }
}
if (!$okPrefix) json_error(400, 'bad_path', 'Path not allowed.');

$apiKey = (string) cfg('CARTO_API_KEY', '');
if ($apiKey === '') json_error(503, 'no_key', 'Map tiles are not configured.');

// Drop every client query param: CARTO basemap URLs need only the key, and arbitrary params
// would let anyone bust the cache and fill the disk.
$q = [];
ksort($q);
$qs = http_build_query($q);
$path = strtr($p, ['{' => '%7B', '}' => '%7D', ' ' => '%20', ',' => '%2C']); // font stacks contain spaces/commas
$url = 'https://' . $h . '/' . $path . '?' . ($qs !== '' ? $qs . '&' : '') . 'key=' . rawurlencode($apiKey);

$isJson = (bool) preg_match('#\.json$#i', $p);
$cacheKey = 'carto:' . $h . '/' . $p . '?' . $qs; // never contains the API key

send_cached_or_fetch($cacheKey, $isJson ? 3600 : 86400, function () use ($url, $isJson, $apiKey) {
    $r = upstream_get($url, ['Accept: */*'], 10, false); // never follow a redirect with the key attached
    $ct = $r['headers']['content-type'] ?? 'application/octet-stream';
    if ($r['status'] >= 200 && $r['status'] < 300) {
        if ($isJson || preg_match('#json|text|xml|javascript#i', $ct)) {
            $b = $r['body'];
            $b = str_replace([$apiKey, rawurlencode($apiKey)], '', $b);
            $b = preg_replace('/([?&])key=[^&"\'\\\\\s]*&?/', '$1', $b);
            $b = preg_replace('/[?&](?=["\'])/', '', $b); // drop dangling ? or &
            $r['body'] = $b;
        }
    }
    $r['content_type'] = $ct;
    $r['cache_control'] = !empty($r['headers']['cache-control'])
        ? $r['headers']['cache-control']
        : ($isJson ? 'public, max-age=3600' : 'public, max-age=86400');
    $r['ttl'] = $isJson ? 3600 : 86400;
    return $r;
});
