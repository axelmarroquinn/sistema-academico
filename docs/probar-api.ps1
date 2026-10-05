# probar-api.ps1
# Ejecutar desde la raiz del proyecto:
#   .\docs\probar-api.ps1
# Requisitos: backend corriendo (npm run dev en otra terminal), MySQL activo
# y database.sql cargado (las pruebas de duplicado usan ana.lopez@example.com).
# Las carreras, cursos y estudiantes de prueba llevan la marca de tiempo en su
# nombre o codigo y se eliminan al final.
# La salida completa se guarda en docs\evidencias\pruebas-api-AAAAMMDD-HHmm.txt
# Termina con codigo de salida 1 si alguna prueba falla.

$baseUrl = 'http://localhost:3000'
$marca = Get-Date -Format 'yyyyMMddHHmmss'   # hace unicos correos, carnets y nombres de cada corrida
$corta = Get-Date -Format 'MMddHHmmss'       # version corta para codigos (maximo 20 caracteres)
$resultados = New-Object System.Collections.ArrayList   # una fila por prueba para la tabla final
$aprobadas = 0
$total = -1   # si el script se interrumpe antes del resumen, termina con codigo 1
$completo = $false

# IDs creados durante la prueba, para borrarlos al final (en orden: estudiantes, cursos, carreras)
$creados = @{
  estudiantes = New-Object System.Collections.ArrayList
  cursos = New-Object System.Collections.ArrayList
  carreras = New-Object System.Collections.ArrayList
}

# Carpeta de evidencias junto a este script (se crea si no existe)
$carpetaEvidencias = Join-Path $PSScriptRoot 'evidencias'
if (-not (Test-Path $carpetaEvidencias)) {
  New-Item -ItemType Directory -Path $carpetaEvidencias | Out-Null
}
$archivoEvidencia = Join-Path $carpetaEvidencias ("pruebas-api-{0}.txt" -f (Get-Date -Format 'yyyyMMdd-HHmm'))

# Envia una peticion, muestra el resultado y lo compara con el codigo esperado.
# $datos se convierte a JSON; $cuerpoCrudo se envia tal cual (sirve para JSON malformado).
# Devuelve el JSON de la respuesta (de exito o de error) como objeto, o $null si no hubo respuesta.
function Probar($titulo, $metodo, $ruta, $esperado, $datos = $null, $cuerpoCrudo = $null) {
  Write-Host "`n=== $titulo ($metodo $ruta) ===" -ForegroundColor Cyan
  $params = @{ Uri = "$baseUrl$ruta"; Method = $metodo; UseBasicParsing = $true }
  if ($null -ne $datos) {
    # El JSON se envia en bytes UTF-8 para que los acentos no se corrompan
    $params.ContentType = 'application/json; charset=utf-8'
    $params.Body = [System.Text.Encoding]::UTF8.GetBytes(($datos | ConvertTo-Json -Depth 5))
  } elseif ($null -ne $cuerpoCrudo) {
    $params.ContentType = 'application/json; charset=utf-8'
    $params.Body = [System.Text.Encoding]::UTF8.GetBytes($cuerpoCrudo)
  }

  $obtenido = 0          # 0 significa que no hubo respuesta del servidor
  $texto = $null
  try {
    $resp = Invoke-WebRequest @params
    $obtenido = [int]$resp.StatusCode
    $texto = $resp.Content
    Write-Host "Codigo HTTP: $obtenido" -ForegroundColor Green
  } catch {
    if ($_.Exception.Response) {
      # El servidor respondio con error (4xx o 5xx): se muestra el codigo y el mensaje de la API
      $obtenido = [int]$_.Exception.Response.StatusCode
      $texto = $_.ErrorDetails.Message
      Write-Host "Codigo HTTP: $obtenido" -ForegroundColor Yellow
    } else {
      # Sin respuesta: API apagada o puerto incorrecto
      Write-Host "Sin respuesta del servidor: $($_.Exception.Message)" -ForegroundColor Red
    }
  }
  if ($texto) { Write-Host $texto }

  $resultado = if ($obtenido -eq $esperado) { 'OK' } else { 'FALLO' }
  $color = if ($resultado -eq 'OK') { 'Green' } else { 'Red' }
  Write-Host "Esperado: $esperado | Obtenido: $obtenido | $resultado" -ForegroundColor $color
  [void]$resultados.Add([pscustomobject]@{ Prueba = $titulo; Esperado = $esperado; Obtenido = $obtenido; Resultado = $resultado })

  $respuesta = $null
  if ($texto) { try { $respuesta = $texto | ConvertFrom-Json } catch { } }
  return $respuesta
}

# Registra una comprobacion del contenido de una respuesta (no de su codigo HTTP).
function Verificar($titulo, [bool]$cumple) {
  $obtenido = if ($cumple) { 'si' } else { 'no' }
  $resultado = if ($cumple) { 'OK' } else { 'FALLO' }
  $color = if ($cumple) { 'Green' } else { 'Red' }
  Write-Host "Verificacion: $titulo -> $resultado" -ForegroundColor $color
  [void]$resultados.Add([pscustomobject]@{ Prueba = "  (verif.) $titulo"; Esperado = 'si'; Obtenido = $obtenido; Resultado = $resultado })
}

# Marca como FALLO un bloque de pruebas que no se pudo ejecutar.
function Omitir($titulo) {
  Write-Host "`nSe omite: $titulo (fallo una prueba previa necesaria)." -ForegroundColor Red
  [void]$resultados.Add([pscustomobject]@{ Prueba = "$titulo (omitido)"; Esperado = '-'; Obtenido = '-'; Resultado = 'FALLO' })
}

# Guarda el id de un registro creado para borrarlo al final (tambien si se creo por error).
function Registrar($tipo, $respuesta) {
  if ($respuesta -and $respuesta.id) { [void]$creados[$tipo].Add($respuesta.id) }
}

# Busca un estudiante por correo en GET /api/estudiantes y devuelve su id (o $null).
function BuscarIdPorCorreo($correo) {
  try {
    $lista = (Invoke-WebRequest -Uri "$baseUrl/api/estudiantes" -UseBasicParsing).Content | ConvertFrom-Json
    $encontrado = $lista | Where-Object { $_.correo -eq $correo } | Select-Object -First 1
    if ($encontrado) { return $encontrado.id }
  } catch { }
  return $null
}

# Borra un registro sin contarlo como prueba. Devuelve el codigo HTTP (404 = ya no existia).
function BorrarSilencioso($ruta) {
  try {
    $resp = Invoke-WebRequest -Uri "$baseUrl$ruta" -Method 'DELETE' -UseBasicParsing
    return [int]$resp.StatusCode
  } catch {
    if ($_.Exception.Response) { return [int]$_.Exception.Response.StatusCode }
    return 0
  }
}

# Arma el cuerpo de un estudiante de prueba con los datos indicados.
function DatosEstudiante($sufijo, $carreraId, $cursos, $correo = $null) {
  if (-not $correo) { $correo = "est.$sufijo.$marca@example.com" }
  return @{
    nombres = 'Estudiante'
    apellidos = "Prueba $sufijo"
    correo = $correo
    carnet = "EST-$sufijo-$corta"
    fecha_nacimiento = '2004-05-20'
    carrera_id = $carreraId
    cursos = @($cursos)
  }
}

Start-Transcript -Path $archivoEvidencia | Out-Null
try {
  # ===== Rutas de lectura =====
  Probar 'Estado de API y MySQL' 'GET' '/api/health' 200 | Out-Null
  $lista = Probar 'Listar estudiantes' 'GET' '/api/estudiantes' 200
  Verificar 'Cada estudiante trae carrera_nombre y arreglo cursos' ((@($lista).Count -gt 0) -and ($null -ne @($lista)[0].carrera_nombre) -and ($null -ne @($lista)[0].cursos))
  Probar 'Listar carreras' 'GET' '/api/carreras' 200 | Out-Null
  Probar 'Listar cursos' 'GET' '/api/cursos' 200 | Out-Null

  # ===== Carreras =====
  $carA = Probar 'Crear carrera A' 'POST' '/api/carreras' 201 @{ nombre = "Carrera Prueba A $marca"; codigo = "PA$corta" }
  Registrar 'carreras' $carA
  $carB = Probar 'Crear carrera B' 'POST' '/api/carreras' 201 @{ nombre = "Carrera Prueba B $marca"; codigo = "PB$corta" }
  Registrar 'carreras' $carB
  $r = Probar 'Carrera duplicada' 'POST' '/api/carreras' 409 @{ nombre = "Carrera Prueba A $marca"; codigo = "PA$corta" }
  Registrar 'carreras' $r
  $r = Probar 'Carrera invalida' 'POST' '/api/carreras' 400 @{ nombre = ''; codigo = '' }
  Registrar 'carreras' $r
  $carC = Probar 'Crear carrera C (sin cursos)' 'POST' '/api/carreras' 201 @{ nombre = "Carrera Prueba C $marca"; codigo = "PC$corta" }
  Registrar 'carreras' $carC
  if ($carC.id) {
    Verificar 'Carrera nueva con total_cursos = 0' ($carC.total_cursos -eq 0)
    Probar 'Eliminar carrera sin cursos ni estudiantes' 'DELETE' "/api/carreras/$($carC.id)" 200 | Out-Null
  } else {
    Omitir 'Eliminar carrera sin cursos ni estudiantes'
  }
  Probar 'Eliminar carrera inexistente' 'DELETE' '/api/carreras/999999' 404 | Out-Null

  if (-not ($carA.id -and $carB.id)) {
    Omitir 'Pruebas de cursos y estudiantes'
  } else {
    # ===== Cursos =====
    $a1 = Probar 'Crear curso A1' 'POST' '/api/cursos' 201 @{ carrera_id = $carA.id; nombre = "Curso A1 $marca"; codigo = "A1$corta"; creditos = 4 }
    Registrar 'cursos' $a1
    $a2 = Probar 'Crear curso A2 sin creditos' 'POST' '/api/cursos' 201 @{ carrera_id = $carA.id; nombre = "Curso A2 $marca"; codigo = "A2$corta" }
    Registrar 'cursos' $a2
    Verificar 'Creditos por defecto = 3' ($a2.creditos -eq 3)
    $a3 = Probar 'Crear curso A3' 'POST' '/api/cursos' 201 @{ carrera_id = $carA.id; nombre = "Curso A3 $marca"; codigo = "A3$corta"; creditos = 5 }
    Registrar 'cursos' $a3
    $b1 = Probar 'Crear curso B1' 'POST' '/api/cursos' 201 @{ carrera_id = $carB.id; nombre = "Curso B1 $marca"; codigo = "B1$corta" }
    Registrar 'cursos' $b1

    $r = Probar 'Curso con carrera inexistente' 'POST' '/api/cursos' 400 @{ carrera_id = 999999; nombre = "Curso X $marca"; codigo = "X1$corta" }
    Registrar 'cursos' $r
    $r = Probar 'Curso con codigo duplicado' 'POST' '/api/cursos' 409 @{ carrera_id = $carA.id; nombre = "Curso Otro $marca"; codigo = "A1$corta" }
    Registrar 'cursos' $r
    $r = Probar 'Curso con nombre duplicado en la carrera' 'POST' '/api/cursos' 409 @{ carrera_id = $carA.id; nombre = "Curso A1 $marca"; codigo = "A9$corta" }
    Registrar 'cursos' $r
    $r = Probar 'Curso con creditos fuera de rango' 'POST' '/api/cursos' 400 @{ carrera_id = $carA.id; nombre = "Curso C31 $marca"; codigo = "C31$corta"; creditos = 31 }
    Registrar 'cursos' $r

    $filtrados = Probar 'Filtrar cursos por carrera' 'GET' "/api/cursos?carrera_id=$($carA.id)" 200
    $soloDeA = @($filtrados | Where-Object { $_.carrera_id -ne $carA.id }).Count -eq 0
    Verificar 'El filtro devuelve solo los 3 cursos de la carrera A' ((@($filtrados).Count -eq 3) -and $soloDeA)
    Probar 'Filtro con carrera_id invalido' 'GET' '/api/cursos?carrera_id=abc' 400 | Out-Null

    if (-not ($a1.id -and $a2.id -and $a3.id -and $b1.id)) {
      Omitir 'Pruebas de estudiantes con cursos'
    } else {
      # ===== Estudiantes =====
      $est = Probar 'Crear estudiante con 2 cursos de su carrera' 'POST' '/api/estudiantes' 201 (DatosEstudiante 'uno' $carA.id @($a1.id, $a2.id))
      Registrar 'estudiantes' $est
      $idsCursos = @($est.cursos | ForEach-Object { $_.id })
      Verificar 'La respuesta trae la carrera A y los cursos A1 y A2' (($est.carrera_id -eq $carA.id) -and ($idsCursos.Count -eq 2) -and ($idsCursos -contains $a1.id) -and ($idsCursos -contains $a2.id))

      $r = Probar 'Estudiante con un curso de otra carrera' 'POST' '/api/estudiantes' 400 (DatosEstudiante 'dos' $carA.id @($a1.id, $b1.id))
      Registrar 'estudiantes' $r
      Verificar 'Los detalles indican el curso de otra carrera' ((@($r.detalles) -join ' ') -match "\b$($b1.id)\b")
      $r = Probar 'Estudiante con cursos vacios' 'POST' '/api/estudiantes' 400 (DatosEstudiante 'tres' $carA.id @())
      Registrar 'estudiantes' $r
      $r = Probar 'Estudiante con cursos repetidos' 'POST' '/api/estudiantes' 400 (DatosEstudiante 'cuatro' $carA.id @($a1.id, $a1.id))
      Registrar 'estudiantes' $r
      $r = Probar 'Estudiante con curso inexistente' 'POST' '/api/estudiantes' 400 (DatosEstudiante 'cinco' $carA.id @(999999))
      Registrar 'estudiantes' $r
      $r = Probar 'Correo duplicado (POST)' 'POST' '/api/estudiantes' 409 (DatosEstudiante 'seis' $carA.id @($a1.id) 'ana.lopez@example.com')
      Registrar 'estudiantes' $r

      if ($est.id) {
        Probar 'Obtener el estudiante creado' 'GET' "/api/estudiantes/$($est.id)" 200 | Out-Null

        $datosPut = DatosEstudiante 'uno' $carA.id @($a3.id) $est.correo
        $put = Probar 'PUT que reemplaza los cursos' 'PUT' "/api/estudiantes/$($est.id)" 200 $datosPut
        $idsPut = @($put.cursos | ForEach-Object { $_.id })
        Verificar 'Despues del PUT solo queda el curso A3' (($idsPut.Count -eq 1) -and ($idsPut[0] -eq $a3.id))

        Probar 'PUT que cambia de carrera con cursos de la anterior' 'PUT' "/api/estudiantes/$($est.id)" 400 (DatosEstudiante 'uno' $carB.id @($a3.id) $est.correo) | Out-Null

        # PUT con el correo de otro estudiante: los IDs se obtienen consultando la API por correo
        $idPrueba = BuscarIdPorCorreo $est.correo
        $idAna = BuscarIdPorCorreo 'ana.lopez@example.com'
        Write-Host "`nID del estudiante de prueba ($($est.correo)): $idPrueba"
        Write-Host "ID del estudiante existente (ana.lopez@example.com): $idAna"
        if ($idPrueba -and $idAna) {
          Probar 'PUT con correo de otro estudiante' 'PUT' "/api/estudiantes/$idPrueba" 409 (DatosEstudiante 'uno' $carA.id @($a3.id) 'ana.lopez@example.com') | Out-Null
        } else {
          Omitir 'PUT con correo de otro estudiante'
        }

        Probar 'Eliminar curso con estudiantes inscritos' 'DELETE' "/api/cursos/$($a3.id)" 409 | Out-Null
        Probar 'Eliminar carrera con cursos o estudiantes' 'DELETE' "/api/carreras/$($carA.id)" 409 | Out-Null

        Probar 'Eliminar estudiante' 'DELETE' "/api/estudiantes/$($est.id)" 200 | Out-Null
        Probar 'Obtener el estudiante eliminado' 'GET' "/api/estudiantes/$($est.id)" 404 | Out-Null
        # Si ON DELETE CASCADE borro las inscripciones, el curso A3 ya se puede eliminar
        Probar 'Eliminar curso cuyas inscripciones borro el CASCADE' 'DELETE' "/api/cursos/$($a3.id)" 200 | Out-Null
      } else {
        Omitir 'Pruebas que dependen del estudiante creado'
      }
    }
  }

  # ===== Casos de error generales =====
  Probar 'Estudiante inexistente' 'GET' '/api/estudiantes/999999' 404 | Out-Null
  $r = Probar 'Datos invalidos' 'POST' '/api/estudiantes' 400 @{ nombres = ''; apellidos = ''; correo = 'correo-invalido'; carnet = ''; carrera_id = 0; cursos = 'x' }
  Registrar 'estudiantes' $r
  Probar 'PUT a estudiante inexistente' 'PUT' '/api/estudiantes/999999' 404 (DatosEstudiante 'siete' 1 @(1)) | Out-Null
  Probar 'DELETE a estudiante inexistente' 'DELETE' '/api/estudiantes/999999' 404 | Out-Null
  Probar 'GET con ID no numerico' 'GET' '/api/estudiantes/abc' 400 | Out-Null
  $r = Probar 'POST con JSON malformado' 'POST' '/api/estudiantes' 400 $null '{"nombres": "Ana", "apellidos": '
  Registrar 'estudiantes' $r
  $futura = DatosEstudiante 'ocho' 1 @(1)
  $futura.fecha_nacimiento = (Get-Date).AddYears(1).ToString('yyyy-MM-dd')
  $r = Probar 'POST con fecha_nacimiento futura' 'POST' '/api/estudiantes' 400 $futura
  Registrar 'estudiantes' $r
  Probar 'Eliminar curso inexistente' 'DELETE' '/api/cursos/999999' 404 | Out-Null
  Probar 'Ruta desconocida' 'GET' '/api/xyz' 404 | Out-Null
  $completo = $true   # se llego al final sin excepciones
} finally {
  # ===== Limpieza: borra lo creado (no cuenta como prueba). 404 significa que ya se habia borrado. =====
  Write-Host "`n=== LIMPIEZA ===" -ForegroundColor Cyan
  foreach ($tipo in @('estudiantes', 'cursos', 'carreras')) {
    foreach ($id in $creados[$tipo]) {
      $codigo = BorrarSilencioso "/api/$tipo/$id"
      $estado = if ($codigo -eq 200) { 'eliminado' } elseif ($codigo -eq 404) { 'ya no existia' } else { "NO SE PUDO ELIMINAR (HTTP $codigo)" }
      $color = if ($codigo -eq 200 -or $codigo -eq 404) { 'DarkGray' } else { 'Red' }
      Write-Host "$tipo $id : $estado" -ForegroundColor $color
    }
  }

  # ===== Resumen =====
  $aprobadas = @($resultados | Where-Object { $_.Resultado -eq 'OK' }).Count
  $total = $resultados.Count
  Write-Host "`n=== RESUMEN ===" -ForegroundColor Cyan
  $resultados | Format-Table Prueba, Esperado, Obtenido, Resultado -AutoSize | Out-String -Width 200 | Write-Host
  $colorTotal = if ($aprobadas -eq $total) { 'Green' } else { 'Red' }
  Write-Host "Pruebas aprobadas: $aprobadas de $total" -ForegroundColor $colorTotal
  Write-Host "Evidencia guardada en: $archivoEvidencia"
  Stop-Transcript | Out-Null
}

if (-not $completo -or $aprobadas -ne $total) { exit 1 }
exit 0
