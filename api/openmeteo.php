<?php
// Open-Meteo multi-point forecast, cached on the server so every visitor shares one upstream call.
// Only lat/lon lists are accepted; models and variables are fixed here (no open proxy).
require __DIR__ . '/common.php';
api_boot('openmeteo');

$parse = function (string $name, callable $ok): array {
    $raw = (string) ($_GET[$name] ?? '');
    $parts = $raw === '' ? [] : explode(',', $raw);
    if (count($parts) < 1 || count($parts) > 24) {
        json_error(400, 'bad_request', "$name must list 1-24 numbers.");
    }
    $out = [];
    foreach ($parts as $p) {
        $v = filter_var(trim($p), FILTER_VALIDATE_FLOAT);
        if ($v === false || !$ok($v)) json_error(400, 'bad_request', "$name has an out-of-range value.");
        // ~1 km: far finer than any model grid, coarse enough that nearby routes share a cache entry.
        $out[] = number_format(round($v, 2), 2, '.', '');
    }
    return $out;
};
$lat = $parse('lat', 'malaysia_lat_ok');
$lon = $parse('lon', 'malaysia_lon_ok');
if (count($lat) !== count($lon)) json_error(400, 'bad_request', 'lat and lon must have the same length.');

$q = http_build_query([
    'latitude' => implode(',', $lat),
    'longitude' => implode(',', $lon),
    'minutely_15' => 'precipitation',
    'hourly' => 'precipitation_probability,precipitation',
    'models' => 'best_match,ecmwf_ifs025,gfs_seamless,icon_seamless,jma_seamless',
    'timezone' => 'Asia/Kuala_Lumpur',
    'forecast_days' => '2',
    'past_days' => '0',
]);
$url = 'https://api.open-meteo.com/v1/forecast?' . str_replace('%2C', ',', $q);

// Open-Meteo counts a multi-location request as one call per location.
$weight = count($lat);
send_cached_or_fetch('openmeteo:' . sha1($url), 900, function () use ($url, $weight) {
    $r = upstream_get($url, ['Accept: application/json'], 15, true, $weight);
    $r['content_type'] = 'application/json; charset=utf-8';
    return $r;
});
