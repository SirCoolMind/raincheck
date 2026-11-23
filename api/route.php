<?php
require __DIR__ . '/common.php';
api_boot('route');

$wp = $_GET['wp'] ?? '';
$b = $_GET['b'] ?? null;
if (!is_string($wp) || ($b !== null && !is_string($b))) json_error(400, 'bad_request', 'Invalid parameters.');

$points = explode(';', $wp);
if (count($points) < 2 || count($points) > 12) json_error(400, 'bad_request', 'wp needs 2 to 12 points.');
foreach ($points as $p) {
    if (!preg_match('/^(-?\d{1,3}(?:\.\d{1,6})?),(-?\d{1,2}(?:\.\d{1,6})?)$/', $p, $m)
        || !malaysia_lon_ok((float) $m[1]) || !malaysia_lat_ok((float) $m[2])) {
        json_error(400, 'bad_request', 'Each waypoint must be "lon,lat" within range, max 6 decimals.');
    }
}
if ($b !== null && $b !== '') {
    if (!preg_match('/^[0-9,;]*$/', $b) || substr_count($b, ';') !== count($points) - 1) {
        json_error(400, 'bad_request', 'b must match wp (one bearing per waypoint, digits , ; only).');
    }
    foreach (explode(';', $b) as $item) {
        if (!preg_match('/^(\d{1,3},\d{1,4})?$/', $item) || ($item !== '' && (int) explode(',', $item)[0] > 360)) {
            json_error(400, 'bad_request', 'Each bearing must be empty or "deg,range".');
        }
    }
} else {
    $b = null;
}

$url = 'https://router.project-osrm.org/route/v1/driving/' . $wp
    . '?overview=false&steps=true&geometries=geojson&continue_straight=true'
    . ($b !== null ? '&bearings=' . $b : '');

send_cached_or_fetch('route:' . sha1($wp . '|' . ($b ?? '')), 7 * 86400, function () use ($url) {
    $r = upstream_get($url, ['Accept: application/json'], 12);
    $j = json_decode($r['body'], true);
    $r['cache'] = is_array($j) && ($j['code'] ?? '') === 'Ok';
    $r['passthrough'] = true;
    $r['content_type'] = 'application/json; charset=utf-8';
    return $r;
});
