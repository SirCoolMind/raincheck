<?php
// Copy this file to config.local.php BY HAND on the server (never commit config.local.php; it is gitignored).
return [
    // CARTO basemaps API key. Leave empty here; set it only in config.local.php.
    'CARTO_API_KEY' => '',
    // Cache directory. null = <this dir>/cache (created on demand, mode 0775, must be writable by php-fpm user).
    'CACHE_DIR' => null,
    // Extra origins allowed for CORS besides the site's own origin. Local dev only: set [] in production.
    'ALLOWED_ORIGINS' => [
        'http://localhost:5173',
        'http://127.0.0.1:5173',
        'http://localhost:4173',
    ],
    // true only if behind a trusted reverse proxy that sets X-Forwarded-For / X-Forwarded-Proto.
    'TRUST_PROXY' => false,
    // Refuse API requests made by other websites' pages (403 cross_site). Keep true.
    'SAME_SITE_ONLY' => true,
    // Also refuse requests that carry no browser origin headers at all (curl, simple scripts). Stops
    // casual scraping but also your own curl checks: add -H 'Sec-Fetch-Site: same-origin' to them.
    'REQUIRE_BROWSER_HEADERS' => false,
    // Requests per minute per client IP per endpoint.
    'RATE_PER_MIN' => 60,
    // Public address of this site, e.g. 'https://raincheck.example.my'. Sent in the User-Agent to
    // MET Norway and Nominatim, whose usage policies ask for an identifiable app.
    'SITE_URL' => '',
    // Feedback popup (api/feedback.php) sends mail through the Gmail API with an OAuth refresh token.
    // Fill these only in config.local.php (or set them as environment variables for php-fpm).
    // Empty = the popup answers "not set up on this server yet".
    'MAIL_MAILER' => 'gmail',
    'MAIL_FROM_ADDRESS' => '',
    'MAIL_FROM_NAME' => 'RainCheck',
    'GMAIL_CLIENT_ID' => '',
    'GMAIL_CLIENT_SECRET' => '',
    'GMAIL_REFRESH_TOKEN' => '',
    // Where feedback goes. Empty = MAIL_FROM_ADDRESS.
    'FEEDBACK_TO' => '',
    // Key that signs the feedback sum check. Empty = a random key created once in CACHE_DIR/feedback/.
    'FEEDBACK_SECRET' => '',
];
