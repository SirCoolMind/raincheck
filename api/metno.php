<?php
require __DIR__ . '/common.php';
api_boot('metno');

$lat = filter_var($_GET['lat'] ?? null, FILTER_VALIDATE_FLOAT);
$lon = filter_var($_GET['lon'] ?? null, FILTER_VALIDATE_FLOAT);
if ($lat === false || $lon === false || !malaysia_lat_ok($lat) || !malaysia_lon_ok($lon)) {
    json_error(400, 'bad_request', 'lat (0..8) and lon (99..120) are required numbers.');
}
$slat = number_format(round($lat / 0.05) * 0.05, 2, '.', '');
$slon = number_format(round($lon / 0.05) * 0.05, 2, '.', '');
$url = "https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=$slat&lon=$slon";

send_cached_or_fetch("metno:$slat,$slon", 1800, function (?array $cached) use ($url) {
    $h = ['Accept: application/json'];
    if ($cached && !empty($cached['last_modified'])) $h[] = 'If-Modified-Since: ' . $cached['last_modified'];
    $r = upstream_get($url, $h);
    $r['ttl'] = ttl_from_expires($r['headers']['expires'] ?? null, 1800);
    $r['content_type'] = 'application/json; charset=utf-8';
    $r['extra'] = ['last_modified' => $r['headers']['last-modified'] ?? null];
    return $r;
});
