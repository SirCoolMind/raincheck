<?php
require __DIR__ . '/common.php';
api_boot('metmy');

$kind = $_GET['kind'] ?? '';
if ($kind === 'forecast') {
    $district = $_GET['district'] ?? '';
    // MET Malaysia district location_id, e.g. Ds064 (Sepang).
    if (!is_string($district) || !preg_match('/^Ds\d{3}$/', $district)) {
        json_error(400, 'bad_request', 'district must be a MET Malaysia district id like Ds064.');
    }
    // Trailing slash is required (without it the API answers 301).
    $url = 'https://api.data.gov.my/weather/forecast/?contains=' . $district . '@location__location_id';
    $key = 'metmy:forecast:' . $district;
} elseif ($kind === 'warning') {
    $url = 'https://api.data.gov.my/weather/warning/?limit=5';
    $key = 'metmy:warning';
} else {
    json_error(400, 'bad_request', 'kind must be "forecast" or "warning".');
}

send_cached_or_fetch($key, 1800, function () use ($url) {
    $r = upstream_get($url, ['Accept: application/json']);
    $r['content_type'] = 'application/json; charset=utf-8';
    return $r;
});
