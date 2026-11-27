# Levanta BDSecurity en LOCAL (Supabase local + Vite). Nunca toca produccion.
# Uso: powershell -ExecutionPolicy Bypass -File C:\proyectos\talca-qr\scripts\herramientas\iniciar-local.ps1
# 'Continue' a proposito: en PowerShell 5.1 el stderr de un programa nativo (por ejemplo el aviso
# "[inbucket] is deprecated" de la CLI de Supabase) es un error fatal bajo 'Stop'. Se revisa
# $LASTEXITCODE a mano.
$ErrorActionPreference = 'Continue'
Set-Location C:\proyectos\talca-qr

function Fallar($msg) { Write-Host "ERROR: $msg" -ForegroundColor Red; exit 1 }

Write-Host "== Rama y commit ==" -ForegroundColor Cyan
git --no-pager log -1 --format='%h %d %s'

Write-Host "== Supabase local (dbsecurity-frutales) ==" -ForegroundColor Cyan
function Leer-Estado { (npx supabase status -o env 2>$null) | ForEach-Object { "$_" } }
$st = Leer-Estado
if (-not ($st -match 'API_URL')) {
  Write-Host "No esta corriendo; iniciando (Docker Desktop debe estar abierto)..." -ForegroundColor Yellow
  npx supabase start 2>&1 | ForEach-Object { "$_" }
  if ($LASTEXITCODE -ne 0) { Fallar "supabase start fallo (revisa que Docker Desktop este abierto)" }
  $st = Leer-Estado
}
$vars = @{}
foreach ($l in $st) { if ($l -match '^([A-Z_]+)="?(.*?)"?\s*$') { $vars[$Matches[1]] = $Matches[2] } }
$url = $vars['API_URL']; $anon = $vars['ANON_KEY']
if (-not $url -or -not $anon) { Fallar "No pude leer API_URL/ANON_KEY de 'supabase status'" }
if ($url -notmatch '^http://(127\.0\.0\.1|localhost)') { Fallar "API_URL no es local ($url). Me detengo." }
Write-Host "API local: $url"

Write-Host "== Migraciones pendientes en LOCAL ==" -ForegroundColor Cyan
npx supabase migration up --local --include-all 2>&1 | ForEach-Object { "$_" }
if ($LASTEXITCODE -ne 0) { Fallar "migration up --local fallo; pegale la salida completa a Claude" }

Write-Host "== Vite (frontend) apuntando a LOCAL ==" -ForegroundColor Cyan
Set-Location C:\proyectos\talca-qr\frontend
$env:VITE_SUPABASE_URL = $url
$env:VITE_SUPABASE_ANON_KEY = $anon
Write-Host "Abre la URL que imprime Vite. Ctrl+C para detener (Supabase local sigue; apagalo con: npx supabase stop)"
npx vite --host 127.0.0.1
