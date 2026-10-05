# Guía para la defensa técnica individual

Documento de estudio basado en el código actual de `database/`, `backend/` y `frontend/`. Todo lo que se cita aquí sale de los archivos reales.

## 1. Flujo completo de una acción

Ejemplo: registrar un estudiante inscrito en dos cursos.

1. **Cliente.** Envía `POST http://localhost:3000/api/estudiantes` con el cuerpo `{ nombres, apellidos, correo, carnet, fecha_nacimiento, carrera_id, cursos: [1, 2] }`. Hoy se hace con `docs/probar-api.ps1` o Postman. El frontend todavía usa el contrato anterior (sección 9).
2. **`backend/server.js`.** Express recibe la petición y aplica, en orden:
   - `cors({ origin: origenesPermitidos })`: el navegador solo deja leer la respuesta a páginas servidas desde los orígenes de `CORS_ORIGIN` (por defecto `http://localhost:5500` y `http://127.0.0.1:5500`).
   - `express.json({ limit: '20kb' })`: convierte el cuerpo JSON en `req.body`. Si el JSON está mal formado o supera 20 kB, el manejador de errores final responde 400.
   - `app.use('/api/estudiantes', estudiantesRoutes)`: delega en el enrutador.
3. **`backend/routes/estudiantes.js`.** `router.post('/', controlador.crear)` asocia la ruta con la función `crear`.
4. **`backend/controllers/estudiantesController.js` → `crear`.** Llama a `validarEstudiante(req.body)`.
5. **`backend/validators/estudiantes.js` → `validarEstudiante`.** Revisa:
   - textos obligatorios con `validarTexto` (de `validators/comunes.js`);
   - formato del correo y `fecha_nacimiento` (`validarFecha`);
   - `carrera_id` con `enteroPositivo` y el formato de `cursos` con `validarListaCursos`;
   - con la base: que la carrera exista y, con `validarCursosDeCarrera`, que todos los cursos existan y sean de esa carrera (sección 5).

   Devuelve `{ errores, valores }`.
6. **`crear`.** Si hay errores responde 400 con `detalles`. Si no, abre una **transacción** en una conexión propia (`pool.getConnection()`). Dentro ejecuta el `INSERT` en `estudiantes`, un `INSERT` en `inscripciones` por cada curso (`insertarInscripciones`) y `commit`. Si algo falla, hace `rollback` y nada queda guardado (sección 4).
7. **`backend/db.js`.** El `pool` de `mysql2/promise` entrega las conexiones; `conexion.release()` la devuelve al pool en el `finally`.
8. **Respuesta.** `buscarEstudiante(pool, nuevoId)` lee al estudiante con su carrera y sus cursos, y se responde `res.status(201).json(estudiante)`. Un correo o carnet duplicado (`ER_DUP_ENTRY`) se traduce en 409; cualquier error no previsto, en 500 genérico.

## 2. Modelo de datos: relación muchos a muchos

Tablas de `database/database.sql`:

| Tabla | Relación |
|---|---|
| `carreras` | Una carrera tiene muchos cursos y muchos estudiantes. |
| `cursos` | Cada curso pertenece a una carrera (`carrera_id`). |
| `estudiantes` | Cada estudiante pertenece a una carrera (`carrera_id`). |
| `inscripciones` | Tabla intermedia: una fila por cada par (estudiante, curso). |

Un estudiante tiene muchos cursos y un curso tiene muchos estudiantes. Eso no cabe en una columna de `estudiantes`, así que la relación se guarda como filas en la tabla intermedia:

```sql
CREATE TABLE inscripciones (
  estudiante_id INT UNSIGNED NOT NULL,
  curso_id INT UNSIGNED NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (estudiante_id, curso_id),
  KEY idx_inscripciones_curso_id (curso_id),
  CONSTRAINT fk_inscripciones_estudiantes FOREIGN KEY (estudiante_id)
    REFERENCES estudiantes (id) ON UPDATE CASCADE ON DELETE CASCADE,
  CONSTRAINT fk_inscripciones_cursos FOREIGN KEY (curso_id)
    REFERENCES cursos (id) ON UPDATE CASCADE ON DELETE RESTRICT
);
```

- **Clave primaria compuesta** `(estudiante_id, curso_id)`: impide inscribir dos veces al mismo estudiante en el mismo curso, y sirve de índice para buscar los cursos de un estudiante.
- **Índice `idx_inscripciones_curso_id`**: acelera la búsqueda inversa (los inscritos de un curso), por ejemplo al contarlos antes de borrar el curso.
- **`ON DELETE CASCADE`** hacia estudiantes: al borrar un estudiante, MySQL borra solo sus inscripciones.
- **`ON DELETE RESTRICT`** hacia cursos: MySQL no deja borrar un curso que tenga inscritos.
- `estudiantes.carrera_id` y `cursos.carrera_id` también usan `RESTRICT`: no se puede borrar una carrera con cursos o estudiantes.

`database.sql` empieza con `DROP TABLE IF EXISTS` de las cuatro tablas en orden inverso de dependencias (primero `inscripciones`, al final `carreras`). Por eso se puede ejecutar varias veces, pero **borra todos los datos**.

## 3. Endpoints

Además de los códigos de cada tabla, `server.js` responde 400 a cualquier JSON mal formado o mayor de 20 kB, y 404 (`Ruta no encontrada.`) a rutas no registradas. Los `:id` se validan con `validarId` (`validators/comunes.js`): solo dígitos, entero seguro mayor que 0; si no, 400 `El id debe ser un entero positivo.`

### GET /api/health (`server.js`)

| Elemento | Detalle |
|---|---|
| Entrada | Ninguna |
| SQL | `SELECT 1` (con `pool.query`) |
| Códigos | 200 `{ status: 'ok', database: 'connected' }`; 500 `No se pudo conectar con la base de datos.` |

### Carreras (`controllers/carrerasController.js`)

Constante `SELECT_CARRERAS`:

```sql
  SELECT ca.id, ca.nombre, ca.codigo, COUNT(cu.id) AS total_cursos
  FROM carreras ca
  LEFT JOIN cursos cu ON cu.carrera_id = ca.id
```

| Endpoint | Entrada | SQL | Códigos |
|---|---|---|---|
| GET /api/carreras (`listar`) | Ninguna | `${SELECT_CARRERAS} GROUP BY ca.id, ca.nombre, ca.codigo ORDER BY ca.nombre` | 200; 500 |
| POST /api/carreras (`crear`) | `req.body`: `nombre` (máx. 120), `codigo` (máx. 20) | 1) `INSERT INTO carreras (nombre, codigo) VALUES (?, ?)`<br>2) `${SELECT_CARRERAS} WHERE ca.id = ? GROUP BY ca.id, ca.nombre, ca.codigo` | 201; 400 datos inválidos; 409 nombre o código repetido (`ER_DUP_ENTRY`); 500 |
| DELETE /api/carreras/:id (`eliminar`) | `req.params.id` | 1) `SELECT id FROM carreras WHERE id = ?`<br>2) `SELECT (SELECT COUNT(*) FROM cursos WHERE carrera_id = ?) AS cursos, (SELECT COUNT(*) FROM estudiantes WHERE carrera_id = ?) AS estudiantes`<br>3) `DELETE FROM carreras WHERE id = ?` | 200 `{ mensaje }`; 400; 404; 409 con la cantidad de cursos y estudiantes; 500 |

`LEFT JOIN` hace que también aparezcan las carreras sin cursos, con `total_cursos = 0`.

### Cursos (`controllers/cursosController.js`)

Constante `SELECT_CURSOS`:

```sql
  SELECT cu.id, cu.carrera_id, ca.nombre AS carrera_nombre, cu.nombre, cu.codigo, cu.creditos
  FROM cursos cu
  INNER JOIN carreras ca ON ca.id = cu.carrera_id
```

| Endpoint | Entrada | SQL | Códigos |
|---|---|---|---|
| GET /api/cursos (`listar`) | `req.query.carrera_id` opcional | Sin filtro: `${SELECT_CURSOS} ORDER BY cu.nombre`<br>Con filtro: `${SELECT_CURSOS} WHERE cu.carrera_id = ? ORDER BY cu.nombre` | 200 (arreglo, vacío si la carrera no tiene cursos o no existe); 400 si `carrera_id` no es entero positivo; 500 |
| POST /api/cursos (`crear`) | `req.body`: `carrera_id`, `nombre` (máx. 150), `codigo` (máx. 20), `creditos` opcional 1-30 (por defecto 3) | 1) `SELECT id FROM carreras WHERE id = ?` (validador)<br>2) `INSERT INTO cursos (carrera_id, nombre, codigo, creditos) VALUES (?, ?, ?, ?)`<br>3) `${SELECT_CURSOS} WHERE cu.id = ?` | 201; 400 datos inválidos o carrera inexistente; 409 código repetido o nombre repetido en la carrera; 500 |
| DELETE /api/cursos/:id (`eliminar`) | `req.params.id` | 1) `SELECT id FROM cursos WHERE id = ?`<br>2) `SELECT COUNT(*) AS total FROM inscripciones WHERE curso_id = ?`<br>3) `DELETE FROM cursos WHERE id = ?` | 200 `{ mensaje }`; 400; 404; 409 con la cantidad de inscritos; 500 |

### Estudiantes (`controllers/estudiantesController.js`)

Constantes:

```sql
-- SELECT_ESTUDIANTES
  SELECT e.id, e.nombres, e.apellidos, e.correo, e.carnet, e.fecha_nacimiento,
         e.carrera_id, ca.nombre AS carrera_nombre
  FROM estudiantes e
  INNER JOIN carreras ca ON ca.id = e.carrera_id

-- SELECT_CURSOS_INSCRITOS
  SELECT i.estudiante_id, cu.id, cu.nombre, cu.codigo, cu.creditos
  FROM inscripciones i
  INNER JOIN cursos cu ON cu.id = i.curso_id
```

Cuerpo de POST y PUT: `nombres`, `apellidos`, `correo`, `carnet`, `carrera_id`, `cursos` (obligatorios) y `fecha_nacimiento` (opcional, `YYYY-MM-DD`). Respuesta: `id, nombres, apellidos, correo, carnet, fecha_nacimiento, carrera_id, carrera_nombre, cursos: [{ id, nombre, codigo, creditos }]`.

| Endpoint | Entrada | SQL | Códigos |
|---|---|---|---|
| GET /api/estudiantes (`listar`) | Ninguna | 1) `${SELECT_ESTUDIANTES} ORDER BY e.id`<br>2) `${SELECT_CURSOS_INSCRITOS} ORDER BY cu.nombre` | 200; 500 |
| GET /api/estudiantes/:id (`obtener`) | `req.params.id` | 1) `${SELECT_ESTUDIANTES} WHERE e.id = ?`<br>2) `${SELECT_CURSOS_INSCRITOS} WHERE i.estudiante_id = ? ORDER BY cu.nombre` | 200; 400; 404; 500 |
| POST /api/estudiantes (`crear`) | `req.body` | Validador: `SELECT id FROM carreras WHERE id = ?` y `SELECT id, carrera_id FROM cursos WHERE id IN (?, ?, ...)`<br>Transacción: `INSERT INTO estudiantes (nombres, apellidos, correo, carnet, carrera_id, fecha_nacimiento) VALUES (?, ?, ?, ?, ?, ?)` y, por cada curso, `INSERT INTO inscripciones (estudiante_id, curso_id) VALUES (?, ?)`<br>Lectura final: las 2 consultas de `obtener` | 201; 400; 409 correo o carnet repetido; 500 |
| PUT /api/estudiantes/:id (`actualizar`) | `req.params.id` y `req.body` | `SELECT id FROM estudiantes WHERE id = ?`; validador (igual que POST)<br>Transacción: `UPDATE estudiantes SET nombres = ?, apellidos = ?, correo = ?, carnet = ?, carrera_id = ?, fecha_nacimiento = ? WHERE id = ?`, `DELETE FROM inscripciones WHERE estudiante_id = ?` y un `INSERT INTO inscripciones` por curso<br>Lectura final: las 2 consultas de `obtener` | 200; 400; 404; 409; 500 |
| DELETE /api/estudiantes/:id (`eliminar`) | `req.params.id` | `DELETE FROM estudiantes WHERE id = ?` (si `affectedRows` es 0 responde 404; las inscripciones se borran por `ON DELETE CASCADE`) | 200 `{ mensaje }`; 400; 404; 500 |

Orden en PUT: valida el id (400), comprueba que exista (404), valida el cuerpo (400) y luego abre la transacción. Si la carrera cambia, los cursos se validan contra la carrera **nueva**, porque el validador usa el `carrera_id` del cuerpo.

**Sin consultas N+1 en `listar`.** No se consulta una vez por estudiante (eso serían 1 + N consultas). Se hacen 2 consultas en total, y la función `agruparCursos` arma un `Map` de `estudiante_id → [cursos]` y lo agrega a cada estudiante. No se usa `JSON_ARRAYAGG` para mantener la compatibilidad con MariaDB.

### Traducción de errores de MySQL

| Código de MySQL | Dónde | Respuesta HTTP |
|---|---|---|
| `ER_DUP_ENTRY` | estudiantes / cursos / carreras | 409 con mensaje propio de cada recurso |
| `ER_NO_REFERENCED_ROW_2` | estudiantes / cursos | 400: la carrera o el curso dejó de existir entre la validación y la escritura |
| `ER_ROW_IS_REFERENCED_2` | cursos / carreras (DELETE) | 409: alguien agregó una inscripción, un curso o un estudiante entre el conteo y el `DELETE` |
| Cualquier otro | todos | 500 `Error interno del servidor.` (el detalle solo se imprime en la consola) |

## 4. Transacciones y rollback

Una **transacción** agrupa varias sentencias SQL para que se apliquen **todas o ninguna**. Registrar un estudiante son al menos tres sentencias (un `INSERT` en `estudiantes` y uno por curso en `inscripciones`). Si fallara la tercera sin transacción, quedaría un estudiante con la mitad de sus cursos.

Patrón usado en `crear` y `actualizar`:

```js
const conexion = await pool.getConnection(); // una conexión fija para todas las sentencias
try {
  await conexion.beginTransaction();          // inicia la transacción
  // INSERT/UPDATE en estudiantes, DELETE e INSERT en inscripciones
  await conexion.commit();                    // confirma todo
} catch (error) {
  await conexion.rollback();                  // deshace todo lo hecho desde beginTransaction
  throw error;                                // el catch exterior responde 409, 400 o 500
} finally {
  conexion.release();                         // devuelve la conexión al pool siempre
}
```

- Se usa `pool.getConnection()` y no `pool.execute()`, porque una transacción vive en **una** conexión. Con `pool.execute()` cada sentencia podría ir por una conexión distinta.
- `release()` está en `finally` para que la conexión vuelva al pool aunque haya error. Si no, después de 10 fallos (`connectionLimit: 10`) el pool se quedaría sin conexiones.
- La lectura final (`buscarEstudiante(pool, id)`) va **después** del `commit`, fuera del bloque. Así un fallo al leer no intenta deshacer algo ya confirmado.
- En `actualizar`, si el `UPDATE` no encuentra la fila (`affectedRows === 0`, porque otro usuario la borró), se hace `rollback` y se responde 404.

## 5. Cómo se valida que los cursos sean de la carrera

En `validators/estudiantes.js`:

1. `validarListaCursos` revisa el formato: que sea un arreglo con 1 a 20 elementos, todos enteros positivos (`enteroPositivo` rechaza `true`, `[5]`, `5.5`) y sin repetidos.
2. Se comprueba que la carrera exista: `SELECT id FROM carreras WHERE id = ?`.
3. `validarCursosDeCarrera` hace **una sola consulta** para todos los cursos:

   ```js
   const marcadores = cursosIds.map(() => '?').join(', ');   // para [3, 7, 9] → "?, ?, ?"
   const [filas] = await pool.execute(
     `SELECT id, carrera_id FROM cursos WHERE id IN (${marcadores})`,
     cursosIds,
   );
   ```

   Lo único que se arma con texto son los signos `?`. Los IDs siguen viajando como parámetros, así que la consulta sigue siendo parametrizada.
4. Con las filas devueltas se calculan dos listas:
   - `noExisten`: IDs que la consulta no devolvió;
   - `deOtraCarrera`: IDs cuyo `carrera_id` no coincide.

   Cada lista no vacía genera un mensaje en `detalles`. Por ejemplo, `"Los cursos con id 5 no pertenecen a la carrera indicada."` produce un 400.

Esta regla vive en la API y no en MySQL. Hacerla cumplir en la base exigiría una llave foránea compuesta, que complica el esquema más de lo razonable para el proyecto.

## 6. Conexión del backend con MySQL

- `server.js` carga `backend/.env` con `dotenv` en su primera línea, antes de requerir `db.js`.
- `db.js` crea un único pool con `mysql.createPool` y lo exporta; los controladores y validadores lo importan con `require('../db')`.
- Variables de entorno:
  - `DB_HOST` (por defecto `localhost`), `DB_PORT` (3306), `DB_USER`, `DB_PASSWORD` y `DB_NAME` (`sistema_academico`);
  - `PORT` (3000) y `CORS_ORIGIN`, que usa `server.js`.

  La plantilla es `backend/.env.example`; el `.env` real está en `.gitignore`.
- Opciones del pool:
  - `connectionLimit: 10`, `waitForConnections: true`, `queueLimit: 0` (sin límite de cola) e `idleTimeout: 60_000` ms;
  - `charset: 'utf8mb4'` y `timezone: 'Z'`;
  - `dateStrings: ['DATE']`: las fechas DATE llegan como texto `YYYY-MM-DD`, sin desfase de zona horaria.
- `pool.execute(sql, valores)` toma una conexión, ejecuta una sentencia preparada y la libera automáticamente. Para transacciones se usa `pool.getConnection()` (sección 4).

## 7. Qué ocurre si MySQL está apagado

Según el código:

- **Al arrancar:** `iniciarServidor()` ejecuta `SELECT 1`. Si falla, imprime `No se pudo conectar con MySQL. Revise el servicio y las variables DB_* del archivo backend/.env.` y el mensaje técnico, y termina con `process.exit(1)`. El servidor no llega a escuchar el puerto 3000.
- **Con el servidor ya en marcha:** cada consulta, o `pool.getConnection()`, lanza una excepción que se captura en el `try/catch` del handler:
  - `/api/health` responde 500 `No se pudo conectar con la base de datos.`
  - Los demás endpoints responden 500 `Error interno del servidor.` mediante `responderErrorBaseDatos`.
  - El detalle técnico (`error.message`) solo se escribe en la consola del servidor.
- Las validaciones que no consultan la base siguen funcionando. Por ejemplo, `GET /api/estudiantes/abc` responde 400, y un POST con `carrera_id: 0` también, sin tocar MySQL.
- **Al volver MySQL:** el pool crea conexiones nuevas cuando se necesitan, así que se espera que se recupere sin reiniciar el backend. Esto se comprueba con `docs/probar-500.ps1`.

## 8. Respuestas base a las preguntas del PDF

**¿Qué ocurre desde la acción del usuario hasta la respuesta?**
El cliente envía una petición HTTP con `fetch`. Express la recibe en `server.js`, aplica CORS y el parser JSON, y la enruta (`routes/`). El controlador valida los datos (`validators/`), ejecuta SQL parametrizado con el pool (`db.js`), dentro de una transacción si escribe en varias tablas, y responde con un código HTTP y un JSON.

**¿Qué hace `fetch()`?**
Es la función nativa del navegador para hacer peticiones HTTP desde JavaScript. Devuelve una promesa con un objeto `Response`; con `response.status` se lee el código y con `await response.json()` el cuerpo. Para enviar datos se indican `method`, el encabezado `Content-Type: application/json` y `body: JSON.stringify(objeto)`.

**¿Qué endpoint se consume?**
Depende de la acción:
- Carreras: `GET /api/carreras` para listar, `POST /api/carreras` para crear, `DELETE /api/carreras/:id` para eliminar.
- Cursos: `GET /api/cursos?carrera_id=N` para listar los de una carrera, `POST /api/cursos` para crear, `DELETE /api/cursos/:id` para eliminar.
- Estudiantes: `GET /api/estudiantes` y `GET /api/estudiantes/:id` para consultar, `POST` para registrar, `PUT /api/estudiantes/:id` para editar, `DELETE /api/estudiantes/:id` para eliminar.
- Estado: `GET /api/health`.

**¿Diferencia entre `req.params`, `req.query` y `req.body`?**
- `req.params` son los valores que forman parte de la ruta, declarados con `:`. En `/api/estudiantes/5`, `req.params.id` es `'5'` (siempre texto).
- `req.query` son los parámetros después del `?`. En `/api/cursos?carrera_id=1`, `req.query.carrera_id` es `'1'`.
- `req.body` son los datos enviados en el cuerpo (POST y PUT). Existe porque `express.json()` convierte el JSON en un objeto.

**¿Qué SQL ejecuta una operación?**
Ejemplo, eliminar un estudiante: `DELETE FROM estudiantes WHERE id = ?`. Si `affectedRows` es 0 se responde 404; sus filas de `inscripciones` las borra MySQL por `ON DELETE CASCADE`. Las demás están en las tablas de la sección 3.

**¿Por qué se usan consultas parametrizadas?**
Porque los valores (`?`) viajan separados del texto SQL: `mysql2` los envía como datos de una sentencia preparada. Un valor como `' OR 1=1 --` se guarda como texto y no se ejecuta, así que se evita la inyección SQL. Incluso en `IN (...)` solo se generan los signos `?`; los IDs siguen siendo parámetros.

**¿Qué sucede si MySQL está apagado?**
Si está apagado al arrancar, el backend termina con `process.exit(1)`. Si se apaga con el servidor en marcha, las rutas que usan la base responden 500 con un mensaje genérico, y el detalle solo aparece en la consola (sección 7).

**¿Qué código HTTP devuelve la API?**
- 200: consulta, actualización o eliminación correcta.
- 201: registro creado.
- 400: datos, id, filtro o JSON inválidos, o cursos de otra carrera.
- 404: registro o ruta inexistente.
- 409: duplicado (correo, carnet, nombre o código), o borrado bloqueado porque hay datos que dependen del registro.
- 500: error interno o base de datos no disponible.

**¿Cómo se conecta el backend con MySQL?**
Con un pool de `mysql2/promise` creado en `db.js`, configurado por las variables `DB_*` que `dotenv` carga desde `backend/.env`. Para consultas sueltas se usa `pool.execute(sql, valores)`; para transacciones, `pool.getConnection()`.

**¿Cómo se relacionan estudiantes y cursos?**
Es una relación muchos a muchos: un estudiante lleva varios cursos y un curso tiene varios estudiantes. Se resuelve con la tabla intermedia `inscripciones`, que guarda una fila por cada par (`estudiante_id`, `curso_id`) con clave primaria compuesta y dos llaves foráneas. Además, cada estudiante y cada curso pertenecen a una carrera, y la API exige que los cursos de un estudiante sean de su carrera.

**¿Qué es una transacción y por qué se usa?**
Es un grupo de sentencias que la base aplica como una sola unidad: o se confirman todas (`commit`) o se deshacen todas (`rollback`). Se usa en `crear` y `actualizar` de estudiantes porque cada operación escribe en dos tablas (`estudiantes` e `inscripciones`). Sin transacción, un fallo intermedio dejaría datos incompletos.

**¿Qué pasa si falla la inserción de inscripciones a mitad del proceso?**
La sentencia que falla lanza una excepción. El `catch` interno ejecuta `conexion.rollback()`, que deshace el `INSERT` o `UPDATE` del estudiante y las inscripciones ya insertadas (en PUT, también el `DELETE` de las inscripciones anteriores). La base queda exactamente como antes de la petición. Luego el `finally` libera la conexión, y el `catch` exterior responde 400, 409 o 500 según el error.

## 9. Frontend

> **Atención:** el frontend todavía usa el contrato anterior (un solo `curso_id` por estudiante y los campos `curso_nombre` y `curso_codigo`). Lo que sigue describe el código actual de `frontend/` y debe actualizarse cuando se adapte a carreras y varios cursos.

Archivos: `frontend/index.html` (estructura y formulario), `frontend/styles.css` (diseño) y `frontend/app.js` (lógica). Se sirve con `npx serve frontend -l 5500` porque CORS solo admite los orígenes del puerto 5500.

### Piezas comunes de `app.js`

| Función | Qué hace |
|---|---|
| `API_URL` | Constante única con la dirección base: `http://localhost:3000/api`. |
| `solicitar(ruta, opciones)` | Llama a `fetch()`. Si no hay respuesta lanza `ErrorApi` con status 0 y el mensaje de API apagada. Si la respuesta no es 2xx lanza `ErrorApi` con el status, `error` y `detalles` del JSON. Si todo va bien devuelve el JSON. |
| `ErrorApi` | Clase de error con `status`, `message` y `detalles`. |
| `mostrarMensaje(tipo, texto, detalles)` | Muestra un aviso de éxito o error en la región `aria-live` `#mensajes`. |
| `mostrarErrorApi(error)` | Muestra el mensaje de la API, el código HTTP y la lista de `detalles`. |
| `crearCelda`, `crearBoton`, `crearOpcion` | Construyen el DOM con `createElement` y `textContent`; nunca se usa `innerHTML` con datos de la API, lo que evita inyectar HTML o scripts. |

### Flujo de cada acción

**Cargar la página.** `iniciar()` fija la fecha máxima del campo de nacimiento, registra los eventos y llama a:
- `cargarCursos()` → `solicitar('/cursos')` → **GET /api/cursos** → llena el select con `crearOpcion(curso.id, "nombre (código)")`.
- `cargarEstudiantes()` → muestra "Cargando estudiantes…" → `solicitar('/estudiantes')` → **GET /api/estudiantes** → dibuja una fila por estudiante con `crearFilaEstudiante`, o "No hay estudiantes registrados." si la lista está vacía.

**Crear.** Botón Guardar → evento `submit` → `guardarEstudiante(evento)`:
1. `evento.preventDefault()` evita que el navegador recargue la página.
2. `leerFormulario()` arma el objeto con los textos sin espacios sobrantes, `curso_id` numérico y `fecha_nacimiento` o `null`.
3. `validarFormulario(datos)` aplica campos obligatorios, el formato del correo (la misma expresión que el backend) y que la fecha no sea futura. Si hay errores, `mostrarErroresFormulario` los muestra junto a cada campo y no se envía nada.
4. `cambiarEstadoEnvio(true)` deshabilita los botones y muestra "Guardando…".
5. `solicitar('/estudiantes', { method: 'POST', body: JSON.stringify(datos) })` → **POST /api/estudiantes** → 201.
6. Si funciona: `reiniciarFormulario()`, un mensaje de éxito y `cargarEstudiantes()`. Si falla con 400, `detallesACampos` ubica cada detalle junto a su campo; en todos los casos `mostrarErrorApi` muestra el mensaje de la API.

**Editar.** Botón Editar de la fila → `iniciarEdicion(id)` → `solicitar('/estudiantes/' + id)` → **GET /api/estudiantes/:id** → `llenarFormulario(estudiante)`, `idEnEdicion = id` y el título cambia a "Editar estudiante #id". Al guardar, `guardarEstudiante` detecta `idEnEdicion` y envía **PUT /api/estudiantes/:id** → 200. Cancelar llama a `reiniciarFormulario()` y vuelve al modo crear. Si el estudiante ya no existe (404), se muestra el error y se recarga la tabla.

**Eliminar.** Botón Eliminar → `eliminarEstudiante(estudiante, boton)` → `window.confirm(...)`; si el usuario cancela, no se hace nada. Si confirma, se deshabilita el botón y se ejecuta `solicitar('/estudiantes/' + id, { method: 'DELETE' })` → **DELETE /api/estudiantes/:id** → 200 `{ mensaje }`. Se muestra el `mensaje` y se recarga la tabla.

**Recargar.** El botón Recargar llama a `cargarEstudiantes()`.

### Manejo de errores en pantalla

| Situación | Qué ve el usuario |
|---|---|
| API apagada o red caída (`fetch` lanza excepción) | "No se pudo conectar con la API. Verifique que el backend esté en ejecución en http://localhost:3000." |
| 400 | "Hay datos inválidos. (HTTP 400)" con la lista de `detalles`, cada uno también junto a su campo |
| 404 | "Estudiante no encontrado. (HTTP 404)" |
| 409 | "El correo o carnet ya está registrado. (HTTP 409)" |
| 500 | "Error interno del servidor. (HTTP 500)" |

### Respuestas base

**¿Qué hace `fetch()`?**
Es la función nativa del navegador para hacer peticiones HTTP desde JavaScript sin recargar la página. En este proyecto solo se llama dentro de `solicitar`: `fetch(API_URL + ruta, { method, headers, body })`. Devuelve una promesa que se resuelve con un objeto `Response` aunque el código sea 400 o 500; por eso `solicitar` revisa `respuesta.ok`. La promesa solo se rechaza cuando no hay respuesta (API apagada, red caída o CORS bloqueado), y ese caso se informa como API no disponible. El cuerpo se lee con `await respuesta.json()`. En POST y PUT se envía `Content-Type: application/json` y `body: JSON.stringify(datos)`.

**¿Qué endpoint se consume?**

| Acción en pantalla | Función | Endpoint |
|---|---|---|
| Abrir la página / Recargar | `cargarEstudiantes` | GET /api/estudiantes |
| Abrir la página (select de cursos) | `cargarCursos` | GET /api/cursos |
| Editar (cargar datos) | `iniciarEdicion` | GET /api/estudiantes/:id |
| Guardar en modo crear | `guardarEstudiante` | POST /api/estudiantes |
| Guardar en modo edición | `guardarEstudiante` | PUT /api/estudiantes/:id |
| Eliminar | `eliminarEstudiante` | DELETE /api/estudiantes/:id |
