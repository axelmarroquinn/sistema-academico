# Sistema Académico de Gestión de Estudiantes y Cursos

**Curso:** Desarrollo Web, Universidad Mariano Gálvez de Guatemala (UMG)  
**Integrantes:** [Nombre del integrante 1], [Nombre del integrante 2], [Nombre del integrante 3]

## Descripción

Aplicación web académica para consultar y administrar estudiantes y sus cursos. Separa interfaz, API y persistencia en MySQL.

## Problema que resuelve

Centraliza el registro de carreras, cursos y estudiantes con sus inscripciones, reduce duplicados y permite consultar los datos relacionados.

## Tecnologías

- Frontend: HTML5, CSS3 y JavaScript Vanilla, sin frameworks ni paso de compilación.
- Backend: Node.js y Express 4.
- Base de datos: MySQL 8 o MariaDB compatible.
- Conexión y configuración: `mysql2/promise`, `dotenv` y CORS.

## Arquitectura

**Usuario → Frontend → Fetch/HTTP → API REST → MySQL**

## Modelo de datos

Cada estudiante pertenece a **una** carrera y puede inscribirse en **varios** cursos de esa misma carrera. La relación muchos a muchos entre estudiantes y cursos se guarda en la tabla intermedia `inscripciones`.

```mermaid
erDiagram
    CARRERAS ||--o{ CURSOS : "ofrece"
    CARRERAS ||--o{ ESTUDIANTES : "agrupa"
    ESTUDIANTES ||--o{ INSCRIPCIONES : "tiene"
    CURSOS ||--o{ INSCRIPCIONES : "recibe"

    CARRERAS {
        int id PK
        varchar nombre UK
        varchar codigo UK
    }
    CURSOS {
        int id PK
        int carrera_id FK
        varchar nombre "único dentro de la carrera"
        varchar codigo UK
        tinyint creditos "1 a 30, por defecto 3"
    }
    ESTUDIANTES {
        int id PK
        int carrera_id FK
        varchar nombres
        varchar apellidos
        varchar correo UK
        varchar carnet UK
        date fecha_nacimiento "opcional"
        timestamp creado_en
        timestamp actualizado_en
    }
    INSCRIPCIONES {
        int estudiante_id PK, FK
        int curso_id PK, FK
        timestamp creado_en
    }
```

| Llave foránea | Al borrar el registro padre |
|---|---|
| `cursos.carrera_id` → `carreras.id` | RESTRICT: no se puede borrar una carrera con cursos |
| `estudiantes.carrera_id` → `carreras.id` | RESTRICT: no se puede borrar una carrera con estudiantes |
| `inscripciones.estudiante_id` → `estudiantes.id` | CASCADE: al borrar un estudiante se borran sus inscripciones |
| `inscripciones.curso_id` → `cursos.id` | RESTRICT: no se puede borrar un curso con inscritos |

La regla "los cursos deben ser de la carrera del estudiante" la valida la API (`backend/validators/estudiantes.js`), no una restricción de MySQL.

Datos iniciales con IDs fijos: carreras 1 (Sistemas), 2 (Administración) y 3 (Psicología); cursos 1-4, 5-8 y 9-12 respectivamente; 6 estudiantes con 2 o 3 cursos cada uno.

## Estructura de carpetas

```text
database/
  database.sql
backend/
  controllers/
  routes/
  validators/
  .env.example
  db.js
  package.json
  server.js
frontend/
  index.html
  styles.css
  app.js
docs/
  postman_collection.json
README.md
.gitignore
```

## Instalación y ejecución en Windows / PowerShell

Requisitos: Node.js 20 o posterior y MySQL 8 o MariaDB instalado y en ejecución.

1. Instale dependencias desde la raíz del proyecto:

   ```powershell
   Set-Location .\backend
   npm install
   ```

2. Cree el archivo local de variables y edite las credenciales:

   ```powershell
   Copy-Item .env.example .env
   notepad .env
   ```

   Configure `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD` y `DB_NAME`. `CORS_ORIGIN` admite orígenes separados por coma.

3. Ejecute el SQL desde la raíz:

   ```powershell
   Set-Location ..
   mysql -u root -p --default-character-set=utf8mb4 -e "source database/database.sql"
   ```

   Ingrese la contraseña cuando MySQL la solicite. Reemplace `root` si usa otro usuario. La opción `--default-character-set=utf8mb4` evita que los acentos se guarden corruptos.

   > **Advertencia:** `database.sql` borra las tablas `inscripciones`, `estudiantes`, `cursos` y `carreras` con todos sus datos y las vuelve a crear con los datos iniciales. Úselo solo para instalar o reiniciar la base.

4. Inicie el backend:

   ```powershell
   Set-Location .\backend
   npm run dev
   ```

   La API escucha en `http://localhost:3000`. Si MySQL o las credenciales no funcionan, el backend muestra un mensaje y termina con error.

5. Detenga el servidor con `Ctrl+C`. Puede importar `docs/postman_collection.json` en Postman.

## Abrir el frontend

El frontend debe servirse por HTTP en el puerto 5500, porque la API solo acepta (CORS) los orígenes `http://localhost:5500` y `http://127.0.0.1:5500`. No funciona abriendo `index.html` con doble clic (`file://`).

1. Con el backend en ejecución, abra otra terminal en la raíz del proyecto y ejecute:

   ```powershell
   npx serve frontend -l 5500
   ```

   `npx` descarga y ejecuta `serve` temporalmente; no se agrega ninguna dependencia al proyecto. La primera vez puede pedir confirmación para instalarlo.

2. Abra `http://localhost:5500` en el navegador.
3. Detenga el servidor estático con `Ctrl+C`.

La dirección de la API se configura en la constante `API_URL` al inicio de `frontend/app.js`.

> **Pendiente:** el frontend actual todavía usa el contrato anterior (un solo `curso_id` por estudiante). Hasta actualizarlo, crear y editar estudiantes desde la interfaz falla con 400 y la columna Curso de la tabla muestra `undefined (undefined)`.

## Endpoints

| Método | Ruta | Descripción | Códigos principales |
|---|---|---|---|
| GET | `/api/health` | Verifica API y conexión con MySQL | 200, 500 |
| GET | `/api/carreras` | Lista carreras con `total_cursos`, ordenadas por nombre | 200, 500 |
| POST | `/api/carreras` | Crea carrera `{ nombre, codigo }` | 201, 400, 409, 500 |
| DELETE | `/api/carreras/:id` | Elimina carrera sin cursos ni estudiantes | 200, 400, 404, 409, 500 |
| GET | `/api/cursos` | Lista cursos; filtro opcional `?carrera_id=N` | 200, 400, 500 |
| POST | `/api/cursos` | Crea curso `{ carrera_id, nombre, codigo, creditos? }` | 201, 400, 409, 500 |
| DELETE | `/api/cursos/:id` | Elimina curso sin inscritos | 200, 400, 404, 409, 500 |
| GET | `/api/estudiantes` | Lista estudiantes con carrera y cursos | 200, 500 |
| GET | `/api/estudiantes/:id` | Obtiene estudiante con carrera y cursos | 200, 400, 404, 500 |
| POST | `/api/estudiantes` | Registra estudiante e inscripciones (transacción) | 201, 400, 409, 500 |
| PUT | `/api/estudiantes/:id` | Actualiza estudiante y reemplaza inscripciones (transacción) | 200, 400, 404, 409, 500 |
| DELETE | `/api/estudiantes/:id` | Elimina estudiante; sus inscripciones se borran en cascada | 200, 400, 404, 500 |

Cuerpo de POST y PUT de estudiantes:

```json
{
  "nombres": "María Fernanda",
  "apellidos": "Gómez López",
  "correo": "maria.gomez@example.com",
  "carnet": "2026-IS-099",
  "fecha_nacimiento": "2004-05-20",
  "carrera_id": 1,
  "cursos": [1, 2]
}
```

`fecha_nacimiento` es opcional. `cursos` debe tener al menos un id, sin repetidos, y todos deben pertenecer a `carrera_id`. Las respuestas de estudiantes incluyen `carrera_id`, `carrera_nombre` y `cursos: [{ id, nombre, codigo, creditos }]` ordenados por nombre.

Los errores responden `{ "error": "mensaje en español" }`; la validación (400) incluye además `detalles` con mensajes legibles.

## Seguridad básica

- Las consultas parametrizan los valores recibidos; no se concatenan datos externos al SQL.
- Las credenciales se leen de `backend/.env` y no están escritas en el código.
- `.gitignore` excluye `node_modules/` y `.env`; el archivo de ejemplo usa valores ficticios.
- El backend limita el tamaño del JSON y no expone detalles internos en las respuestas de error.

## Pruebas de la API

Con MySQL y el backend en ejecución, desde la raíz del proyecto:

```powershell
.\docs\probar-api.ps1
```

- `docs/probar-api.ps1` prueba carreras, cursos, estudiantes e inscripciones (creación, filtros, reemplazo de cursos, borrado en cascada y errores 400, 404 y 409), además de verificar el contenido de algunas respuestas. Muestra una tabla resumen con el código esperado y el obtenido, y termina con código de salida 1 si algo falla. Los registros que crea llevan la marca de tiempo y se eliminan al final.
- `docs/probar-500.ps1` es una prueba guiada del código 500: pide detener `MySQL80` en otra ventana como administrador, verifica que `/api/health`, `/api/estudiantes` y `/api/cursos` respondan 500 con un mensaje genérico y, tras reiniciar el servicio, comprueba si el pool se recupera sin reiniciar el backend. El script no detiene MySQL por sí mismo.
- Ambos scripts guardan su salida en `docs/evidencias/` (`pruebas-api-AAAAMMDD-HHmm.txt` y `prueba-500-AAAAMMDD-HHmm.txt`).

La guía de estudio para la defensa técnica está en `docs/guia-defensa.md`.
