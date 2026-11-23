# RainCheck – Deployment runbook

> 	Live at `raincheck.hafizr.com`. The server folder is a plain git clone; a deploy is `git pull`.

Target: Ubuntu server, Nginx, PHP-FPM running as system user `raincheck`. **npm is never run on the server.** The site is built on your machine and the build (`dist/`) is committed, so the server only ever runs `git pull`.

Placeholders used below:

| Placeholder | Meaning |
|---|---|
| `<domain>` | public hostname, e.g. `commute.example.com` |
| `<server>` | SSH host or IP of the Ubuntu box |
| `<PHP>` | your PHP minor version, e.g. `8.3` (check with `ls /etc/php`) |

Server layout (one folder, a normal git clone):

```
/var/www/raincheck/               git clone of this repo, owned deploy:www-data (a normal deploy user)
  dist/                           built site, committed; this is the Nginx web root
  api/*.php                       PHP endpoints, served as /api/*.php
  api/config.local.php            server-only secrets, gitignored (git pull never touches it), deploy:raincheck 640
/var/cache/raincheck/             PHP file cache (CACHE_DIR), owned by raincheck
```

---

## 1. Build locally (never on the server)

Run in PowerShell in the project folder:

```powershell
npm ci
npm run build
npm run check:key
```

- `npm run build` runs `tsc --noEmit`, `vite build`, then `check:key`. The build fails if the key is found in `dist/`.
- The build uses `VITE_CARTO_MODE=proxy` from `.env.production`, so the browser calls `/api/carto.php` and the CARTO key is not bundled.
- `npm run check:key` must print **`[check-key] CARTO key: not found in tracked files or dist/`**. If it reports FOUND, stop and fix the build. Never set `ALLOW_BUNDLED_KEY` for a deploy build.
- Commit the new `dist/` together with the source change, then push.

## 2. Deploy = git pull

Every deploy after the first:

```bash
ssh root@<server> "sudo -u deploy git -C /var/www/raincheck pull --ff-only"
```

No reload is needed: Nginx serves the new `dist/` at once, and PHP reads the new `api/` files on the next request. Re-run a smoke test from step 8.

First time only:

```bash
sudo git clone <repo-url> /var/www/raincheck
sudo chown -R deploy:www-data /var/www/raincheck
```

Then do steps 3 to 6.

## 3. Nginx server block

Save as `/etc/nginx/sites-available/raincheck` and enable it:

```bash
sudo ln -s /etc/nginx/sites-available/raincheck /etc/nginx/sites-enabled/raincheck
```

Shared security headers, saved as `/etc/nginx/snippets/raincheck-security.conf`. They are a separate file because Nginx does not inherit `add_header` into a location that sets its own headers, so each static location includes this file:

```nginx
add_header X-Content-Type-Options "nosniff" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https://tilecache.rainviewer.com https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com https://*.tile.openstreetmap.org https://tile.openstreetmap.org; font-src 'self' data:; connect-src 'self' https://api.met.no https://api.open-meteo.com https://api.data.gov.my https://api.rainviewer.com https://tilecache.rainviewer.com https://router.project-osrm.org https://nominatim.openstreetmap.org https://*.basemaps.cartocdn.com https://basemaps.cartocdn.com https://*.tile.openstreetmap.org https://tile.openstreetmap.org; worker-src 'self' blob:; manifest-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'" always;
```

`api.met.no` is deliberately absent from the CSP: MET Norway is called server-side through `api/metno.php`, so the browser never contacts it. The `style-src 'unsafe-inline'` term is needed by MapLibre; tighten it if your console shows no violations without it.

Rate-limit zones, saved as `/etc/nginx/conf.d/raincheck-limits.conf` (files in `conf.d/` are loaded inside the `http {}` block, where `limit_req_zone` must live). Nginx turns floods away before PHP starts, so a burst costs almost nothing; the API's own per-IP limits (`RATE_PER_MIN`) and daily upstream budgets still apply behind it:

```nginx
# Keyed by client IP. With Cloudflare in front, the real-IP lines in section 3b make this the visitor's IP.
limit_req_zone $binary_remote_addr zone=rc_api:10m      rate=10r/s;  # forecasts, radar, route, search
limit_req_zone $binary_remote_addr zone=rc_tiles:10m    rate=30r/s;  # CARTO map tiles: one map view is dozens of requests
limit_req_zone $binary_remote_addr zone=rc_feedback:1m  rate=10r/m;  # feedback form and its sum question
limit_req_status 429;
limit_req_log_level warn;
```

Site block (`/etc/nginx/sites-available/raincheck`):

```nginx
server {
    listen 80;
    listen [::]:80;
    server_name <domain>;
    # certbot (step 3 end) adds the 443 listener, ssl_certificate lines and the HTTP->HTTPS redirect. Keep them.

    root /var/www/raincheck/dist;
    index index.html;
    server_tokens off;
    client_max_body_size 1m;

    # Compression for js, css and json (gzip is built in).
    gzip on;
    gzip_vary on;
    gzip_comp_level 5;
    gzip_min_length 1024;
    gzip_types text/css application/javascript text/javascript application/json application/manifest+json image/svg+xml;
    # Brotli, only if libnginx-mod-http-brotli-filter and libnginx-mod-http-brotli-static are installed:
    # brotli on;
    # brotli_static on;
    # brotli_types text/css application/javascript application/json image/svg+xml;

    # Never serve dotfiles.
    location ~ /\. { deny all; }

    # API config and cache must never be served directly. This block must stay ABOVE the .php rule.
    location ~ ^/api/(cache|config) { return 404; }

    # Map tiles through the CARTO proxy: generous burst, since panning fetches many tiles at once.
    location = /api/carto.php {
        root /var/www/raincheck;   # the PHP lives next to dist/, not inside it
        limit_req zone=rc_tiles burst=300 nodelay;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_pass unix:/run/php/raincheck.sock;
        fastcgi_read_timeout 30s;
    }

    # Feedback: a person sends a few at most. PHP adds a 3-per-minute and 10-per-day cap per IP.
    location = /api/feedback.php {
        root /var/www/raincheck;
        limit_req zone=rc_feedback burst=5 nodelay;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_pass unix:/run/php/raincheck.sock;
        fastcgi_read_timeout 30s;
    }

    # Only the .php endpoints under /api/ are executable.
    location ~ ^/api/.+\.php$ {
        root /var/www/raincheck;
        limit_req zone=rc_api burst=40 nodelay;
        try_files $fastcgi_script_name =404;
        include fastcgi_params;
        fastcgi_param SCRIPT_FILENAME $document_root$fastcgi_script_name;
        fastcgi_pass unix:/run/php/raincheck.sock;
        fastcgi_read_timeout 30s;
    }
    location /api/ { return 404; }

    # Hashed build assets: cache for a year.
    location /assets/ {
        include /etc/nginx/snippets/raincheck-security.conf;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }

    # Service worker and the HTML shell must always be revalidated so new builds roll out.
    location = /index.html {
        include /etc/nginx/snippets/raincheck-security.conf;
        add_header Cache-Control "no-cache" always;
    }
    location = /sw.js {
        include /etc/nginx/snippets/raincheck-security.conf;
        add_header Cache-Control "no-cache" always;
    }

    # SPA fallback.
    location / {
        include /etc/nginx/snippets/raincheck-security.conf;
        try_files $uri /index.html;
    }
}
```

Test and reload:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

TLS (mention only): `sudo apt install certbot python3-certbot-nginx` then `sudo certbot --nginx -d <domain>`. Add `Strict-Transport-Security` only after HTTPS works.

Check the limits after reloading: a burst of 60 quick radar calls should end in some `429`s, and a normal page load should show none in the browser's network tab.

```bash
for i in $(seq 1 60); do curl -s -o /dev/null -w '%{http_code}
' https://<domain>/api/radar.php; done | sort | uniq -c
```

### 3b. Optional: Cloudflare in front (free plan)

Cloudflare absorbs floods and hides the droplet's IP. It is optional; the steps above are enough on their own.

1. Add the domain to Cloudflare, or just the `raincheck` record if the zone is already there. Make it an orange-cloud (Proxied) `A` record to the droplet IP.
2. SSL/TLS mode: **Full (strict)**. Keep the certbot certificate on the droplet, so the Cloudflare-to-droplet leg is real HTTPS too. Certbot renewals still work through the proxy over HTTP-01.
3. Tell Nginx the visitor's real IP, so the rate limits and the API's per-IP limits count visitors, not Cloudflare. Save as `/etc/nginx/conf.d/cloudflare-realip.conf`, with the current ranges from <https://www.cloudflare.com/ips-v4> and <https://www.cloudflare.com/ips-v6> (check them now and then):

   ```nginx
   # One line per Cloudflare range, IPv4 and IPv6, e.g.:
   set_real_ip_from 173.245.48.0/20;
   set_real_ip_from 2400:cb00::/32;
   # ... the rest of the published ranges ...
   real_ip_header CF-Connecting-IP;
   ```

   Nginx then puts the visitor's IP in `REMOTE_ADDR`, so keep `'TRUST_PROXY' => false` in `config.local.php`. Setting it to `true` here would let anyone pick their own rate-limit identity with a fake `X-Forwarded-For`.
4. Optional, all on the free plan:
   - Security → Bots: turn on **Bot Fight Mode**. It can challenge `curl` from your own machine; the smoke tests in step 8 then need running from the droplet against `http://127.0.0.1` with `-H 'Host: <domain>'`, or pausing it.
   - Security → WAF → Rate limiting rules: one rule on URI path starting with `/api/`, for example more than 300 requests per 10 seconds per IP → Block for 10 seconds. It stops a flood at the edge before it reaches the droplet.
   - Caching: leave the default. `/api/*.php` responses are not cached by Cloudflare unless you add a Cache Rule; the API's own server cache already covers this.
5. Optional, strongest: allow ports 80 and 443 only from Cloudflare's ranges in the droplet firewall (DigitalOcean Cloud Firewall or `ufw`), so nobody can skip Cloudflare by hitting the droplet IP directly. Keep SSH reachable from your own IP.

## 4. PHP-FPM pool for `raincheck`

Install the extensions the API needs (curl is required):

```bash
sudo apt install php<PHP>-fpm php<PHP>-curl
php<PHP> -m | grep -i curl      # must print: curl
```

Create a login-less system user for the pool (it can read the code and write only the cache):

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin raincheck
```

Create `/etc/php/<PHP>/fpm/pool.d/raincheck.conf`:

```ini
[raincheck]
user = raincheck
group = raincheck

; Socket that Nginx (www-data) connects to.
listen = /run/php/raincheck.sock
listen.owner = www-data
listen.group = www-data
listen.mode = 0660

; Small on-demand pool: this is a low-traffic personal app.
pm = ondemand
pm.max_children = 5
pm.process_idle_timeout = 10s
pm.max_requests = 500

; Limit PHP file access to the app and its cache. Add paths only if a warning in the log names one.
php_admin_value[open_basedir] = /var/www/raincheck/:/var/cache/raincheck/:/tmp/
```

Check and reload:

```bash
sudo php-fpm<PHP> -t
sudo systemctl reload php<PHP>-fpm
```

## 5. Cache directory

```bash
sudo install -d -o raincheck -g raincheck -m 750 /var/cache/raincheck
```

The cache is outside the web root, so Nginx never serves it. The code is owned by `deploy`, not by the PHP user, so PHP cannot change it.

## 6. Server-only config

Create it once from the example and fill it in by hand. It is gitignored, so `git pull` never touches it. The key is pasted on the server, never through git and never in chat.

```bash
cd /var/www/raincheck/api
sudo cp config.example.php config.local.php
sudo chown deploy:raincheck config.local.php
sudo chmod 640 config.local.php
sudo -u deploy nano config.local.php
```

In the editor, set:

- `'CARTO_API_KEY' => '<paste the key here yourself>'`
- `'CACHE_DIR' => '/var/cache/raincheck'`
- `'ALLOWED_ORIGINS'`: remove the localhost entries. They exist for local development only. Same-origin requests from `https://<domain>` are already allowed.
- `'TRUST_PROXY' => false`, unless a trusted reverse proxy sits in front of Nginx. Behind Cloudflare it stays `false`: Nginx's real-IP setup (section 3b) already supplies the visitor's IP.
- `'SAME_SITE_ONLY' => true` (default). The API refuses requests made by other websites' pages with `403 cross_site`, judged from the browser's `Sec-Fetch-Site`, `Origin` and `Referer` headers, so nobody can embed RainCheck's API, or the CARTO key behind it, in their own site. Requests with none of those headers (curl, uptime checks) still pass.
- Optional `'REQUIRE_BROWSER_HEADERS' => true` also refuses requests with none of those headers, which turns away casual scripts. Scripts can fake headers, so this only raises the bar. With it on, add `-H 'Sec-Fetch-Site: same-origin'` to the curl checks in step 8.
- `'SITE_URL' => 'https://<domain>'`. It goes into the User-Agent sent to MET Norway and Nominatim, whose usage policies ask for an identifiable app.
- Optional `'DAILY_BUDGET' => ['api.open-meteo.com' => 8000, ...]`: daily upstream call caps per host (Malaysia time). The defaults in `api/common.php` (`DEFAULT_DAILY_BUDGET`) are about 80 % of each free tier; set a host to `null` for no cap. When a cap is reached, the API serves cached data or answers `503 daily_budget` with `Retry-After` until midnight. Counters live in `CACHE_DIR/budget/`; check them with `cat /var/cache/raincheck/budget/*`.
- Feedback mail (optional): `'MAIL_FROM_ADDRESS'`, `'GMAIL_CLIENT_ID'`, `'GMAIL_CLIENT_SECRET'`, `'GMAIL_REFRESH_TOKEN'` (the same Gmail API OAuth values a Laravel `MAIL_MAILER=gmail` setup uses; paste them yourself), and `'FEEDBACK_TO'` if it should differ from the sender. Mail goes out over HTTPS to the Gmail API, so the droplet's blocked port 25 does not matter. Without these the feedback popup tells visitors it is not set up. Failures are logged to the php-fpm error log as `[raincheck feedback] …`.

Saving the file takes effect on the next request; nothing needs a restart.
## 7. Restrict the CARTO key

Even though the proxy keeps the key server-side, restrict it:

1. In the CARTO dashboard go to **Developers → API keys**.
2. Open the key and set the allowed referrers / domains to `https://<domain>`.
3. Re-run the CARTO smoke test in step 8. The proxy sends `SITE_URL` as `Referer` and `Origin`, so a domain restriction works as long as `SITE_URL` is set in `config.local.php`. If it still returns 403, loosen the restriction: browsers never see the key in proxy mode, so it is a secondary safeguard only.

## 8. Smoke tests

Replace `<domain>` with your host. Each command states what to expect.

If `REQUIRE_BROWSER_HEADERS` is on, add `-H 'Sec-Fetch-Site: same-origin'` to every `/api/` call below. One extra check: a request claiming another site must be refused, so `curl -s -o /dev/null -w '%{http_code}\n' -H 'Origin: https://example.com' https://<domain>/api/radar.php` should print `403`.

```bash
# 1. Home page: 200, CSP header present.
curl -sI https://<domain>/ | grep -Ei '^(HTTP|content-security-policy|x-content-type-options)'

# 2. Radar: JSON body.
curl -s https://<domain>/api/radar.php | head -c 200; echo

# 3. CARTO style via proxy: expect HTTP 200 and Content-Type application/json.
curl -sI 'https://<domain>/api/carto.php?p=gl/voyager-gl-style/style.json' | grep -Ei '^(HTTP|content-type)'

# 4. The key must not leak in the body. Expect 0.
curl -s 'https://<domain>/api/carto.php?p=gl/voyager-gl-style/style.json' | grep -c 'key='

# 5. MET Norway (lat 0..8, lon 99..120): expect 200 JSON.
curl -s 'https://<domain>/api/metno.php?lat=3.1390&lon=101.6869' | head -c 200; echo

# 6. MET Malaysia: forecast needs a district location id (Ds + 3 digits, see src/data/districts.json); warning needs none.
curl -s 'https://<domain>/api/metmy.php?kind=forecast&district=Ds064' | head -c 200; echo
curl -s 'https://<domain>/api/metmy.php?kind=warning' | head -c 200; echo

# 7. Route with the default waypoints (URL-encoded: , = %2C and ; = %3B).
#    wp = five "lon,lat" points separated by ';'. b = one item per point, separated by ';':
#    empty items for the first two points, then "<bearing>,90" for each of the last two, and a trailing empty item.
#    Replace <bearing1> and <bearing2> with the heading in degrees you want (0..359).
curl -s 'https://<domain>/api/route.php?wp=101.651%2C2.9226%3B101.6964%2C2.9264%3B101.6831%2C2.9969%3B101.6959%2C3.0968%3B101.7123%2C3.1579&b=%3B%3B<bearing1>%2C90%3B<bearing2>%2C90%3B' | head -c 300; echo
```

Expected for the route call: a JSON body, not a 400 (`bad_request`). If it returns 400, the `b` item count does not match the `wp` point count.

```bash
# 8. Place search (Nominatim via the proxy, cached 24 h): expect a JSON array.
curl -s 'https://<domain>/api/search.php?q=Putrajaya' | head -c 200; echo
```

Rate limit (default 60 requests per minute per IP per endpoint). This uses up your own budget for one minute:

```bash
for i in $(seq 1 65); do curl -s -o /dev/null -w "%{http_code}\n" 'https://<domain>/api/radar.php'; done | sort | uniq -c
```

Expect mostly `200` and some `429`. A 429 response includes a `Retry-After` header.

## 9. Rollback

```bash
ssh root@<server> "cd /var/www/raincheck && git log --oneline -5"
ssh root@<server> "cd /var/www/raincheck && git checkout <good-commit>"     # back on main later: git checkout main && git pull
```

`config.local.php` and the cache are untouched by either. Re-run the smoke tests from step 8 after a rollback.
