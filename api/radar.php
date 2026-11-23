<?php
require __DIR__ . '/common.php';
api_boot('radar');

send_cached_or_fetch('radar:maps', 300, function () {
    $r = upstream_get('https://api.rainviewer.com/public/weather-maps.json', ['Accept: application/json']);
    $r['content_type'] = 'application/json; charset=utf-8';
    return $r;
});
