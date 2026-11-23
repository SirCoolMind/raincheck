<?php
// Router for `php -S`: a stand-in for Google's OAuth token and Gmail send endpoints, used by smoke.php.
// Records the last Gmail request in FAKE_GOOGLE_OUT so the test can inspect the message.
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
header('Content-Type: application/json');
if ($path === '/token') {
    parse_str(file_get_contents('php://input'), $f);
    if (($f['grant_type'] ?? '') !== 'refresh_token' || ($f['refresh_token'] ?? '') !== 'test-refresh') {
        http_response_code(400);
        echo '{"error":"invalid_grant"}';
        return true;
    }
    echo '{"access_token":"test-access","expires_in":3599}';
    return true;
}
if ($path === '/gmail/v1/users/me/messages/send') {
    file_put_contents(getenv('FAKE_GOOGLE_OUT'), json_encode([
        'auth' => $_SERVER['HTTP_AUTHORIZATION'] ?? '',
        'body' => file_get_contents('php://input'),
    ]));
    echo '{"id":"fake-1"}';
    return true;
}
http_response_code(404);
echo '{}';
return true;
