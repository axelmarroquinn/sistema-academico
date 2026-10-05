# probar-500.ps1
# Prueba guiada del codigo 500 cuando MySQL esta apagado.
# Ejecutar desde la raiz del proyecto, con el backend corriendo (npm run dev):
#   .\docs\probar-500.ps1
# Este script NO detiene ni inicia MySQL: le pide al usuario que lo haga en otra
# ventana de PowerShell abierta como administrador.
# La salida completa se guarda en docs\evidencias\prueba-500-AAAAMMDD-HHmm.txt
# Termina con codigo de salida 1 si alguna verificacion falla.

$baseUrl = 'http://localhost:3000'
$fallos = 0

# Mensajes genericos que el backend devuelve en sus respuestas 500 (server.js y controladores)
$mensajesGenericos = @(
  'No se pudo conectar con la base de datos.',
  'Error interno del servidor.'
)

# Patrones que delatarian detalles internos si aparecieran en la respuesta
$patronesInternos = 'ECONNREFUSED|PROTOCOL_|ER_[A-Z_]+|errno|sqlMessage|sqlState|stack|SELECT |INSERT |node_modules|\.js:\d+|3306'

# Carpeta de evidencias junto a este script (se crea si no existe)
$carpetaEvidencias = Join-Path $PSScriptRoot 'evidencias'
if (-not (Test-Path $carpetaEvidencias)) {
  New-Item -ItemType Directory -Path $carpetaEvidencias | Out-Null
}
$archivoEvidencia = Join-Path $carpetaEvidencias ("prueba-500-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmm'))

# Hace un GET y devuelve el codigo HTTP (0 si no hubo respuesta) y el cuerpo.
function Consultar($ruta) {
  try {
    $resp = Invoke-WebRequest -Uri "$baseUrl$ruta" -UseBasicParsing -TimeoutSec 30
    return @{ Codigo = [int]$resp.StatusCode; Cuerpo = $resp.Content }
  } catch {
    if ($_.Exception.Response) {
      return @{ Codigo = [int]$_.Exception.Response.StatusCode; Cuerpo = $_.ErrorDetails.Message }
    }
    return @{ Codigo = 0; Cuerpo = "Sin respuesta del servidor: $($_.Exception.Message)" }
  }
}

# Verifica que la ruta responda 500 con un mensaje generico y sin detalles internos.
function Verificar500($ruta) {
  Write-Host "`n=== GET $ruta (esperado 500 con mensaje generico) ===" -ForegroundColor Cyan
  $r = Consultar $ruta
  Write-Host "Codigo HTTP: $($r.Codigo)"
  Write-Host "Cuerpo: $($r.Cuerpo)"

  $mensaje = $null
  try { $mensaje = ($r.Cuerpo | ConvertFrom-Json).error } catch { }

  $ok = $true
  if ($r.Codigo -ne 500) {
    Write-Host '  FALLO: el codigo no es 500.' -ForegroundColor Red
    $ok = $false
  }
  if ($mensajesGenericos -notcontains $mensaje) {
    Write-Host '  FALLO: el campo "error" no es uno de los mensajes genericos esperados.' -ForegroundColor Red
    $ok = $false
  }
  if ($r.Cuerpo -match $patronesInternos) {
    Write-Host "  FALLO: la respuesta contiene detalles internos ($($Matches[0]))." -ForegroundColor Red
    $ok = $false
  }
  if ($ok) {
    Write-Host '  OK: 500 con mensaje generico y sin detalles internos.' -ForegroundColor Green
  } else {
    $script:fallos++
  }
}

Start-Transcript -Path $archivoEvidencia | Out-Null
try {
  Write-Host '=== PRUEBA GUIADA DEL CODIGO 500 ===' -ForegroundColor Cyan

  # Paso 0: estado inicial (solo informativo)
  $inicial = Consultar '/api/health'
  Write-Host "Estado inicial de /api/health: $($inicial.Codigo) $($inicial.Cuerpo)"
  if ($inicial.Codigo -eq 0) {
    Write-Host 'El backend no responde. Inicielo con npm run dev en la carpeta backend y vuelva a ejecutar este script.' -ForegroundColor Red
    $fallos++
  } else {

  # Paso 1: el usuario detiene MySQL
  Write-Host ''
  Write-Host 'PASO 1. Abra otra ventana de PowerShell COMO ADMINISTRADOR y ejecute:' -ForegroundColor Yellow
  Write-Host '    Stop-Service MySQL80' -ForegroundColor Yellow
  Write-Host 'Deje el backend corriendo. No cierre esta ventana.' -ForegroundColor Yellow
  Read-Host 'Cuando el servicio este detenido, presione Enter para continuar' | Out-Null

  # Paso 2: las rutas que usan la base deben responder 500 generico
  Verificar500 '/api/health'
  Verificar500 '/api/estudiantes'
  Verificar500 '/api/cursos'

  # Paso 3: el usuario vuelve a iniciar MySQL
  Write-Host ''
  Write-Host 'PASO 2. En la ventana de administrador ejecute:' -ForegroundColor Yellow
  Write-Host '    Start-Service MySQL80' -ForegroundColor Yellow
  Read-Host 'Cuando el servicio este en ejecucion, presione Enter para continuar' | Out-Null

  # Se consulta /api/health hasta 3 veces porque MySQL puede tardar unos segundos en aceptar conexiones
  Write-Host "`n=== GET /api/health (recuperacion del pool) ===" -ForegroundColor Cyan
  $recuperado = $false
  for ($intento = 1; $intento -le 3; $intento++) {
    $r = Consultar '/api/health'
    Write-Host "Intento ${intento}: $($r.Codigo) $($r.Cuerpo)"
    if ($r.Codigo -eq 200) { $recuperado = $true; break }
    Start-Sleep -Seconds 3
  }
  if ($recuperado) {
    Write-Host 'RESULTADO: el pool se recupero solo (200). No hace falta reiniciar el servidor.' -ForegroundColor Green
  } else {
    Write-Host 'RESULTADO: /api/health no respondio 200. Verifique MySQL con Get-Service MySQL80 y, si sigue en ejecucion, reinicie el backend (Ctrl+C y npm run dev).' -ForegroundColor Red
    $fallos++
  }
  }   # fin del bloque que se ejecuta solo si el backend responde
} finally {
  Write-Host "`nVerificaciones fallidas: $fallos"
  Write-Host "Evidencia guardada en: $archivoEvidencia"
  Stop-Transcript | Out-Null
}

if ($fallos -gt 0) { exit 1 }
exit 0
