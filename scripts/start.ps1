# Starts RainCheck locally: PHP API + Vite dev server on the first free ports,
# opens the browser, and stops both when you press Ctrl+C or close the window.
# Usually launched via start.bat in the project root.
param(
  [int]$WebPort = 5173,   # first port to try for the web app
  [int]$ApiPort = 8787,   # first port to try for the PHP API
  [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Test-PortFree([int]$port) {
  if (Get-NetTCPConnection -State Listen -LocalPort $port -ErrorAction SilentlyContinue) { return $false }
  foreach ($addr in @([Net.IPAddress]::Loopback, [Net.IPAddress]::IPv6Loopback)) {
    $l = $null
    try { $l = [Net.Sockets.TcpListener]::new($addr, $port); $l.Start() }
    catch { if ($addr -eq [Net.IPAddress]::Loopback) { return $false } }  # IPv4 must bind; IPv6 may be disabled
    finally { if ($l) { $l.Stop() } }
  }
  return $true
}
function Find-FreePort([int]$start, [int[]]$exclude = @()) {
  for ($p = $start; $p -lt $start + 200 -and $p -lt 65535; $p++) {
    if ($exclude -notcontains $p -and (Test-PortFree $p)) { return $p }
  }
  throw "No free port found in $start-$($start + 199)."
}
function Wait-Port([int]$port, [int]$seconds) {
  $deadline = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $deadline) {
    $c = [Net.Sockets.TcpClient]::new()
    try { $c.Connect('127.0.0.1', $port); return $true } catch { Start-Sleep -Milliseconds 300 } finally { $c.Dispose() }
  }
  return $false
}

Write-Host ''
Write-Host '  RainCheck - Daily Commute' -ForegroundColor Cyan
Write-Host ''

foreach ($cmd in 'node', 'npm', 'php') {
  if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) {
    Write-Host "  '$cmd' was not found on PATH. Install it and try again." -ForegroundColor Red
    exit 1
  }
}
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
  Write-Host '  First run: installing dependencies (npm install)...' -ForegroundColor Yellow
  & npm.cmd install
  if ($LASTEXITCODE -ne 0) { Write-Host '  npm install failed.' -ForegroundColor Red; exit 1 }
}

$api = Find-FreePort $ApiPort
$web = Find-FreePort $WebPort -exclude @($api)
if ($api -ne $ApiPort) { Write-Host "  Port $ApiPort is busy, API will use $api" -ForegroundColor Yellow }
if ($web -ne $WebPort) { Write-Host "  Port $WebPort is busy, app will use $web" -ForegroundColor Yellow }

$env:RAINCHECK_API_PORT = "$api"
$env:RAINCHECK_WEB_PORT = "$web"
$url = "http://localhost:$web/"

$apiProc = $null; $webProc = $null
try {
  # PHP API shares this console (so closing the window stops it too); its noisy
  # request log goes to a file instead of the screen.
  $apiLog = Join-Path $env:TEMP 'raincheck-api.log'
  $apiProc = Start-Process php -ArgumentList '-S', "127.0.0.1:$api", '-t', '.' `
    -WorkingDirectory $root -NoNewWindow -PassThru `
    -RedirectStandardOutput $apiLog -RedirectStandardError "$apiLog.err"
  if (-not (Wait-Port $api 15)) { throw "PHP API did not start on port $api." }
  Write-Host "  API  -> http://127.0.0.1:$api  (log: $apiLog.err)" -ForegroundColor Green

  # Vite dev server in this window.
  $webProc = Start-Process npm.cmd -ArgumentList 'run', 'dev' -WorkingDirectory $root -NoNewWindow -PassThru
  if (-not (Wait-Port $web 60)) { throw "Web app did not start on port $web." }
  Write-Host ''
  Write-Host "  App  -> $url" -ForegroundColor Green
  Write-Host '  Press Ctrl+C (or close this window) to stop everything.' -ForegroundColor DarkGray
  Write-Host ''
  if (-not $NoBrowser) { Start-Process $url }

  Wait-Process -Id $webProc.Id
}
catch {
  Write-Host "  $($_.Exception.Message)" -ForegroundColor Red
  $failed = $true
}
finally {
  foreach ($p in @($webProc, $apiProc)) {
    if ($p -and -not $p.HasExited) { & taskkill.exe /PID $p.Id /T /F 2>$null | Out-Null }
  }
  Write-Host '  Stopped.' -ForegroundColor DarkGray
}
if ($failed) { exit 1 }
