# Guía para la defensa técnica individual

Documento de estudio basado en el código actual de `database/`, `backend/` y `frontend/`. Todo lo que se cita aquí sale de los archivos reales.

## 1. Flujo completo de una acción

Ejemplo: registrar un estudiante inscrito en dos cursos.

1. **Frontend (`frontend/js/estudiantes.js`).** Al pulsar Guardar, `guardarEstudiante` lee el formulario (`leerFormulario`) y lo valida (`validarFormulario`). Luego llama a `enviar('/estudiantes', 'POST', datos)` de `api.js`, que usa `fetch()` para enviar `POST http://localhost:3000/api/estudiantes` con el cuerpo `{ nombres, apellidos, correo, carnet, fecha_nacimiento, carrera_id, cursos: [1, 2] }`. El detalle está en la sección 9.
2. **`backend/server.js`.** Express recibe la petición y aplica, en orden:
   - `cors({ origin: origenesPermitidos })`: el navegador solo deja leer la respuesta a páginas servidas desde los orígenes de `CORS_ORIGIN` (por defecto `http://localhost:5500` y `http://127.0.0.1:5500`).
   - `express.json({ limit: '20kb' })`: convierte el cuerpo JSON en `req.body`. Si el JSON está mal formado o supera 20 kB, el manejador de errores final responde 400.
   - `app.use('/api/estudiantes', estudiantesRoutes)`: delega en el enrutador.
3. **`backend/routes/estudiantes.js`.** `router.post('/', controlador.crear)` asocia la ruta con la función `crear`.
4. **`backend/controllers/estudiantesController.js` → `crear`.** Llama a `validarEstudiante(req.body)`.
5. **`backend/validators/estudiantes.js` → `validarEstudiante`.** Revisa:
   - textos obligatorios con `validarTexto` (de `validators/comunes.js`);
   - formato del correo y `fecha_nacimiento` (`validarFecha`);
   - `carrera_id` con `enteroPositivo` y el formato de `cursos` (opcional) con `validarListaCursos`;
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

Cuerpo de POST y PUT: `nombres`, `apellidos`, `correo`, `carnet`, `carrera_id` (obligatorios), `fecha_nacimiento` (opcional, `YYYY-MM-DD`) y `cursos` (opcional, arreglo de IDs; puede ser `[]`). Respuesta: `id, nombres, apellidos, correo, carnet, fecha_nacimiento, carrera_id, carrera_nombre, cursos: [{ id, nombre, codigo, creditos }]`.

| Endpoint | Entrada | SQL | Códigos |
|---|---|---|---|
| GET /api/estudiantes (`listar`) | Ninguna | 1) `${SELECT_ESTUDIANTES} ORDER BY e.id`<br>2) `${SELECT_CURSOS_INSCRITOS} ORDER BY cu.nombre` | 200; 500 |
| GET /api/estudiantes/:id (`obtener`) | `req.params.id` | 1) `${SELECT_ESTUDIANTES} WHERE e.id = ?`<br>2) `${SELECT_CURSOS_INSCRITOS} WHERE i.estudiante_id = ? ORDER BY cu.nombre` | 200; 400; 404; 500 |
| POST /api/estudiantes (`crear`) | `req.body` | Validador: `SELECT id FROM carreras WHERE id = ?` y `SELECT id, carrera_id FROM cursos WHERE id IN (?, ?, ...)`<br>Transacción: `INSERT INTO estudiantes (nombres, apellidos, correo, carnet, carrera_id, fecha_nacimiento) VALUES (?, ?, ?, ?, ?, ?)` y, por cada curso, `INSERT INTO inscripciones (estudiante_id, curso_id) VALUES (?, ?)`<br>Lectura final: las 2 consultas de `obtener` | 201; 400; 409 correo o carnet repetido; 500 |
| PUT /api/estudiantes/:id (`actualizar`) | `req.params.id` y `req.body` | `SELECT id FROM estudiantes WHERE id = ?`; validador (igual que POST)<br>Transacción: `SELECT carrera_id FROM estudiantes WHERE id = ? FOR UPDATE`; si cambia la carrera y no se envió `cursos`, `SELECT COUNT(*) AS total FROM inscripciones WHERE estudiante_id = ?`; `UPDATE estudiantes SET nombres = ?, apellidos = ?, correo = ?, carnet = ?, carrera_id = ?, fecha_nacimiento = ? WHERE id = ?`; solo si se envió `cursos`: `DELETE FROM inscripciones WHERE estudiante_id = ?` y un `INSERT INTO inscripciones` por curso<br>Lectura final: las 2 consultas de `obtener` | 200; 400; 404; 409 correo o carnet repetido, o cambio de carrera con inscripciones sin enviar `cursos`; 500 |
| DELETE /api/estudiantes/:id (`eliminar`) | `req.params.id` | `DELETE FROM estudiantes WHERE id = ?` (si `affectedRows` es 0 responde 404; las inscripciones se borran por `ON DELETE CASCADE`) | 200 `{ mensaje }`; 400; 404; 500 |

Orden en PUT: valida el id (400), comprueba que exista (404), valida el cuerpo (400) y luego abre la transacción. Si la carrera cambia, los cursos enviados se validan contra la carrera **nueva**, porque el validador usa el `carrera_id` del cuerpo. Si el cuerpo no trae `cursos`, las inscripciones no se tocan; la regla completa de cambio de carrera está en la sección 10.

### Inscripciones de un estudiante (`controllers/inscripcionesController.js`)

Rutas declaradas en `routes/estudiantes.js`. Trabajan solo sobre la tabla `inscripciones`; no reciben ni modifican los datos personales.

| Endpoint | Entrada | SQL | Códigos |
|---|---|---|---|
| GET /api/estudiantes/:id/cursos (`listar`) | `req.params.id` | 1) `SELECT id FROM estudiantes WHERE id = ?`<br>2) `SELECT cu.id, cu.nombre, cu.codigo, cu.creditos FROM inscripciones i INNER JOIN cursos cu ON cu.id = i.curso_id WHERE i.estudiante_id = ? ORDER BY cu.nombre` | 200 (arreglo); 400; 404; 500 |
| POST /api/estudiantes/:id/cursos (`inscribir`) | `req.params.id`; `req.body.cursoId` (o `curso_id`) | Transacción: 1) `SELECT carrera_id FROM estudiantes WHERE id = ? FOR UPDATE`<br>2) `SELECT id, carrera_id, nombre, codigo, creditos FROM cursos WHERE id = ?`<br>3) `INSERT INTO inscripciones (estudiante_id, curso_id) VALUES (?, ?)` | 201 `{ id, nombre, codigo, creditos }`; 400 `cursoId` inválido o curso de otra carrera; 404 estudiante o curso inexistente; 409 ya inscrito; 500 |
| DELETE /api/estudiantes/:id/cursos/:cursoId (`quitar`) | `req.params.id` y `req.params.cursoId` | 1) `SELECT id FROM estudiantes WHERE id = ?`<br>2) `DELETE FROM inscripciones WHERE estudiante_id = ? AND curso_id = ?` (si `affectedRows` es 0 responde 404) | 204 sin cuerpo; 400; 404 estudiante inexistente o no inscrito; 500 |

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

1. Si se envía `cursos`, `validarListaCursos` revisa el formato: que sea un arreglo con 0 a 20 elementos, todos enteros positivos (`enteroPositivo` rechaza `true`, `[5]`, `5.5`) y sin repetidos.
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
- 204: inscripción quitada (éxito sin cuerpo).
- 201: registro creado.
- 400: datos, id, filtro o JSON inválidos, o cursos de otra carrera.
- 404: registro o ruta inexistente.
- 409: duplicado (correo, carnet, nombre o código; o inscripción repetida), borrado bloqueado porque hay datos que dependen del registro, o cambio de carrera con inscripciones sin enviar `cursos`.
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

Se sirve con `npx serve frontend -l 5500`. El puerto 5500 es obligatorio por CORS, y además los módulos ES no cargan desde `file://`. `index.html` carga un solo script: `<script type="module" src="js/main.js">`. Los demás módulos se cargan con `import`.

### Módulos

| Archivo | Responsabilidad | Funciones principales |
|---|---|---|
| `js/api.js` | Hablar con la API | `API_URL`, `ErrorApi`, `solicitar(ruta, opciones)`, `enviar(ruta, metodo, datos)`, `borrar(ruta)` |
| `js/ui.js` | Utilidades de interfaz | `mostrarMensaje`, `mostrarErrorApi`, `mostrarEstadoTabla`, `crearCelda`, `crearBoton`, `crearCeldaAcciones`, `crearOpcion`, `llenarSelectCarreras`, `mostrarErrorCampo`, `pintarErrores`, `detallesACampos`, `cambiarEstadoBoton`, `fechaHoy`, `confirmar` |
| `js/estudiantes.js` | Vista Estudiantes | `cargarEstudiantes`, `crearFilaEstudiante`, `cargarCursosDeCarrera`, `alCambiarCarrera`, `actualizarCarreras`, `leerFormulario`, `validarFormulario`, `iniciarEdicion`, `confirmarCambioDeCarrera`, `guardarEstudiante`, `eliminarEstudiante`, `reiniciarFormulario`, `actualizarCursosDeFila`, `iniciarEstudiantes` |
| `js/carreras.js` | Vista Carreras y cursos | `cargarCarreras`, `crearCarrera`, `eliminarCarrera`, `cargarCursos`, `crearCurso`, `eliminarCurso`, `iniciarCarreras` |
| `js/inscripciones.js` | Panel de detalle e inscripciones | `abrirPanel`, `cerrarPanel`, `refrescarPanel`, `cerrarPanelSi`, `refrescarCursos`, `pintarDatos`, `pintarInscritos`, `llenarDisponibles`, `inscribirCurso`, `quitarCurso`, `iniciarInscripciones` |
| `js/main.js` | Punto de entrada y conexión entre módulos | `mostrarVista`, `alCambiarHash`, `iniciar` |

Reglas comunes:
- **Seguridad:** todo dato de la API se inserta con `createElement` y `textContent`; nunca se usa `innerHTML`, lo que evita inyectar HTML o scripts.
- **Errores:** `solicitar` convierte cualquier respuesta no 2xx en `ErrorApi` con `status`, `message` (el `error` de la API) y `detalles`. Si `fetch` no obtiene respuesta, lanza `ErrorApi` con `status` 0 y el mensaje de API apagada.
- **Errores junto a los campos:** cada módulo tiene un mapa "campo de la API → id del elemento" (`CAMPOS`, `CAMPOS_CARRERA`, `CAMPOS_CURSO`). `pintarErrores` usa ese mapa, y `detallesACampos` ubica los `detalles` de un 400 junto a su campo.

### Navegación sin recargar (`main.js`)

Los enlaces del menú apuntan a `#estudiantes` y `#carreras-cursos`. Al cambiar el hash, el evento `hashchange` llama a `alCambiarHash` → `mostrarVista(nombre, true)`, que:
- pone `hidden` en la vista que no corresponde;
- marca el enlace activo con `aria-current="page"`;
- mueve el foco al título de la vista para que el lector de pantalla la anuncie.

Un hash desconocido, como `#contenido` del enlace "Saltar al contenido", no cambia la vista.

`iniciar()` muestra la vista inicial, conecta los módulos y carga los datos (`cargarCarreras()` y `cargarCursos()`). Los módulos no se importan entre sí: `main.js` les pasa funciones ("avisos").
- `iniciarCarreras(...)`: cada vez que `carreras.js` recarga las carreras, se llama a `actualizarCarreras` (select y casillas de Estudiantes) y a `refrescarPanel` (select "Agregar curso").
- `iniciarEstudiantes({ alVerCursos, alGuardar, alEliminar })`: el botón "Ver / Cursos" abre el panel; guardar o eliminar un estudiante refresca o cierra el panel.
- `iniciarInscripciones({ alEditar, alCambiarCursos, alNoExistir })`: "Editar datos" usa el formulario de `estudiantes.js`, e inscribir o quitar un curso actualiza solo la fila con `actualizarCursosDeFila`.

### Flujo principal: elegir carrera, cargar cursos y registrar al estudiante (cursos opcionales)

1. **Al iniciar:** `cargarCarreras()` → **GET /api/carreras**. Llena los selects de la vista Carreras y llama a `actualizarCarreras(carreras)`, que llena el select `#est-carrera` con `llenarSelectCarreras`. El grupo de cursos (`<fieldset id="est-cursos" disabled>`) empieza deshabilitado, con el texto "Seleccione primero una carrera".
2. **El usuario elige la carrera:** el evento `change` llama a `alCambiarCarrera()`:
   - si había cursos marcados, muestra el aviso "Cambió la carrera: se limpió la selección de cursos";
   - llama a `cargarCursosDeCarrera(carreraId)`.
3. **`cargarCursosDeCarrera`** → **GET /api/cursos?carrera_id=N**:
   - crea una casilla con su `<label>` por curso (`crearCasilla`) y habilita el fieldset;
   - si la carrera no tiene cursos, muestra un mensaje con enlace a `#carreras-cursos`;
   - un contador (`ultimaCargaCursos`) descarta respuestas lentas de una carrera elegida antes.
4. **El usuario marca cero o más cursos y pulsa Guardar:** `guardarEstudiante(evento)`:
   - `evento.preventDefault()` evita recargar la página;
   - `leerFormulario()` arma `{ nombres, apellidos, correo, carnet, fecha_nacimiento, carrera_id, cursos }`, donde `cursos` son los IDs de las casillas marcadas (`cursosMarcados()`). En modo edición no incluye `cursos`;
   - `validarFormulario(datos)` revisa los campos obligatorios, el correo, que la fecha no sea futura y la carrera elegida (los cursos son opcionales). Si hay errores, `pintarErrores` los muestra junto a cada campo (el del grupo, debajo del fieldset) y enfoca el primero;
   - `cambiarEstadoBoton(botonGuardar, true)` deshabilita el botón y muestra "Guardando…";
   - `enviar('/estudiantes', 'POST', datos)` → **POST /api/estudiantes** → 201. En modo edición: **PUT /api/estudiantes/:id** → 200.
5. **Resultado:**
   - Éxito: `reiniciarFormulario()`, el mensaje "registrado con N curso(s)" y `cargarEstudiantes()` → **GET /api/estudiantes**. La tabla muestra los cursos de cada estudiante como una lista, uno por línea.
   - Error 400: `detallesACampos` ubica cada detalle; por ejemplo, "Los cursos con id 5 no pertenecen…" queda junto al grupo de cursos.
   - En todos los errores, `mostrarErrorApi` muestra el mensaje de la API con su código.

### Otras acciones

- **Editar datos:** botón Editar de la fila, o "Editar datos" del panel → `iniciarEdicion(id)` → **GET /api/estudiantes/:id** → llena los datos personales y la carrera, y **oculta** la sección de cursos (las inscripciones se gestionan en el panel). El título cambia a "Editar datos: …" y el botón a "Guardar cambios". Al guardar se envía **PUT** sin `cursos`. Si cambió la carrera, aplica la regla de la sección 10. Cancelar llama a `reiniciarFormulario()`.
- **Ver / Cursos:** abre el panel de detalle (sección 10).
- **Eliminar estudiante:** `eliminarEstudiante` → `confirmar(...)` → **DELETE /api/estudiantes/:id**.
- **Crear carrera:** `crearCarrera` → **POST /api/carreras** → `cargarCarreras()`, que actualiza la tabla, los selects de ambas vistas y las casillas.
- **Crear curso:** `crearCurso` → **POST /api/cursos**. Conserva la carrera elegida para cargar varios cursos seguidos y recarga carreras (para `total_cursos` y las casillas de Estudiantes) y cursos.
- **Filtrar cursos:** `change` del select `#filtro-carrera` → `cargarCursos()` → **GET /api/cursos?carrera_id=N**, o **GET /api/cursos** si se elige "Todas".
- **Eliminar carrera o curso:** `eliminarCarrera` y `eliminarCurso` piden `confirmar(...)` → **DELETE /api/carreras/:id** o **DELETE /api/cursos/:id**. Si la API responde 409 porque hay dependientes, se muestra su mensaje, por ejemplo "No se puede eliminar la carrera porque tiene 2 curso(s) y 1 estudiante(s) asociados…". Si se borra, se recargan carreras y cursos, y con ellas el select y las casillas de Estudiantes.

### Manejo de errores en pantalla

| Situación | Qué ve el usuario |
|---|---|
| API apagada o red caída (`fetch` lanza excepción) | "No se pudo conectar con la API. Verifique que el backend esté en ejecución en http://localhost:3000." y la tabla con "No se pudo cargar…" |
| 400 | "Hay datos inválidos. (HTTP 400)" con la lista de `detalles`, cada uno también junto a su campo |
| 404 | Por ejemplo "Estudiante no encontrado. (HTTP 404)"; la tabla se recarga |
| 409 | Mensaje de la API: duplicado, o borrado bloqueado por dependientes |
| 500 | "Error interno del servidor. (HTTP 500)" |

Los mensajes de éxito y aviso se cierran solos a los 6 segundos; los de error quedan hasta cerrarlos. Todos se escriben en la región `aria-live` `#mensajes`.

### Respuestas base

**¿Qué hace `fetch()`?**
Es la función nativa del navegador para hacer peticiones HTTP desde JavaScript sin recargar la página. En este proyecto solo se llama dentro de `solicitar` (`js/api.js`): `fetch(API_URL + ruta, { method, headers, body })`. Devuelve una promesa que se resuelve con un objeto `Response` aunque el código sea 400 o 500; por eso `solicitar` revisa `respuesta.ok`. La promesa solo se rechaza cuando no hay respuesta (API apagada, red caída o CORS bloqueado), y ese caso se informa como API no disponible. El cuerpo se lee con `await respuesta.json()`. En POST y PUT, `enviar` agrega `Content-Type: application/json` y `body: JSON.stringify(datos)`.

**¿Qué endpoint se consume?**

| Acción en pantalla | Función | Endpoint |
|---|---|---|
| Abrir la página / Recargar estudiantes | `cargarEstudiantes` | GET /api/estudiantes |
| Abrir la página / tras crear o borrar carreras y cursos | `cargarCarreras` | GET /api/carreras |
| Elegir carrera en el formulario de estudiante | `cargarCursosDeCarrera` | GET /api/cursos?carrera_id=N |
| Tabla de cursos y su filtro | `cargarCursos` | GET /api/cursos o GET /api/cursos?carrera_id=N |
| Editar (cargar datos) | `iniciarEdicion` | GET /api/estudiantes/:id |
| Guardar estudiante (crear / editar) | `guardarEstudiante` | POST /api/estudiantes · PUT /api/estudiantes/:id |
| Eliminar estudiante | `eliminarEstudiante` | DELETE /api/estudiantes/:id |
| Crear carrera / Eliminar carrera | `crearCarrera` / `eliminarCarrera` | POST /api/carreras · DELETE /api/carreras/:id |
| Crear curso / Eliminar curso | `crearCurso` / `eliminarCurso` | POST /api/cursos · DELETE /api/cursos/:id |

## 10. Inscripción de cursos de un estudiante existente

El **registro** del estudiante (datos personales y carrera) y su **inscripción** en cursos son operaciones separadas. Así se puede agregar o quitar un curso sin volver a llenar ni reenviar los datos personales.

### Backend: tres endpoints sobre la tabla `inscripciones`

- `GET /api/estudiantes/:id/cursos`: lista los cursos inscritos.
- `POST /api/estudiantes/:id/cursos` con `{ "cursoId": n }`: inscribe un curso. Por coherencia con el resto de la API, también acepta `curso_id`.
- `DELETE /api/estudiantes/:id/cursos/:cursoId`: quita una inscripción y responde **204** (éxito sin cuerpo).

El SQL exacto está en la tabla de la sección 3. Orden de validación en `inscribir`:

| Paso | Comprobación | Código si falla |
|---|---|---|
| 1 | `:id` y `cursoId` son enteros positivos | 400 |
| 2 | El estudiante existe (`SELECT carrera_id FROM estudiantes WHERE id = ? FOR UPDATE`) | 404 `Estudiante no encontrado.` |
| 3 | El curso existe (`SELECT id, carrera_id, … FROM cursos WHERE id = ?`) | 404 `Curso no encontrado.` |
| 4 | `curso.carrera_id` es igual a la carrera del estudiante | 400 `El curso no pertenece a la carrera del estudiante.` |
| 5 | `INSERT INTO inscripciones (estudiante_id, curso_id) VALUES (?, ?)` | 409 `El estudiante ya está inscrito en ese curso.` |

El 409 no se calcula con un `SELECT` previo: lo produce MySQL, porque la clave primaria compuesta `(estudiante_id, curso_id)` rechaza el duplicado (`ER_DUP_ENTRY`). Así no hay carrera entre "comprobar" e "insertar".

**¿Por qué `FOR UPDATE`?** Bloquea la fila del estudiante hasta el `commit`. Si al mismo tiempo alguien edita su carrera (el PUT también hace `SELECT … FOR UPDATE`), una operación espera a la otra. Así nunca queda inscrito en un curso de una carrera que ya no es la suya.

### Regla de cambio de carrera (decisión del proyecto)

Un estudiante solo puede tener cursos de su carrera. Al cambiar la carrera con `PUT /api/estudiantes/:id`:

| Cuerpo del PUT | Resultado |
|---|---|
| Sin `cursos` y **misma** carrera | Actualiza los datos; las inscripciones no se tocan |
| Sin `cursos`, carrera **distinta**, estudiante **sin** inscripciones | Actualiza normalmente |
| Sin `cursos`, carrera **distinta**, estudiante **con** inscripciones | **409**, no cambia nada: la API nunca borra inscripciones que no se le pidió borrar |
| Con `cursos` (de la nueva carrera, o `[]`) | En una sola transacción: actualiza la carrera, borra las inscripciones anteriores e inserta las enviadas |

El frontend combina las dos opciones del enunciado:
- la API **bloquea con 409** el cambio implícito;
- la interfaz **pide confirmación** y, si el usuario acepta, envía `cursos: []` para quitar las inscripciones de forma explícita y atómica.

### Frontend: panel de detalle (`js/inscripciones.js`)

1. **Ver / Cursos** (botón de la fila, en `estudiantes.js`) → `main.js` llama a `abrirPanel(id)`:
   - **GET /api/estudiantes/:id** → `pintarDatos` muestra carnet, correo, fecha y carrera en una lista `<dl>`;
   - el foco pasa al título del panel con el nombre del estudiante.
2. `refrescarCursos()` pide en paralelo (`Promise.all`):
   - **GET /api/estudiantes/:id/cursos**: los cursos inscritos;
   - **GET /api/cursos?carrera_id=N**: los cursos de su carrera.

   Luego:
   - `pintarInscritos` dibuja cada curso inscrito con su botón **Quitar**;
   - `llenarDisponibles` llena el select **Agregar curso** solo con los cursos de la carrera que no están inscritos (si no queda ninguno, deshabilita el select y el botón);
   - avisa a `estudiantes.js` (`actualizarCursosDeFila`) para reemplazar **solo la celda de cursos** de esa fila, sin recargar la tabla.
3. **Inscribir** → `inscribirCurso(evento)`:
   - valida que haya un curso elegido;
   - envía **POST /api/estudiantes/:id/cursos** con `{ cursoId }`;
   - muestra el éxito o el error de la API (400, 404 o 409);
   - en ambos casos llama a `refrescarCursos()` para mostrar el estado real de la base.
4. **Quitar** → `quitarCurso(curso, boton)`: pide `confirmar(...)`, envía **DELETE /api/estudiantes/:id/cursos/:cursoId** (204) y llama a `refrescarCursos()`.
5. **Editar datos** → `iniciarEdicion(id)` de `estudiantes.js`. El formulario se muestra **sin** la sección de cursos y el PUT se envía sin `cursos`.
   - Si cambió la carrera, `confirmarCambioDeCarrera` consulta **GET /api/estudiantes/:id/cursos**.
   - Si hay inscripciones, pide confirmación con los nombres de los cursos. Si se acepta, agrega `cursos: []` al PUT; si se cancela, no se envía nada.
6. **Sincronización con el resto de la página:**
   - al guardar los datos, `refrescarPanel(id)` vuelve a cargar el panel;
   - al eliminar al estudiante, `cerrarPanelSi(id)` lo cierra;
   - al crear o borrar cursos en "Carreras y cursos", `refrescarPanel()` actualiza el select "Agregar curso".

### Respuestas base

**¿Por qué separar el registro de la inscripción?**
Son acciones distintas que cambian tablas distintas: los datos personales viven en `estudiantes`, y las inscripciones en `inscripciones`. Con endpoints propios, agregar un curso es un `INSERT` de una fila y quitarlo un `DELETE` de una fila. No hay que reenviar ni revalidar los datos personales, ni reemplazar todas las inscripciones.

**¿Qué significa el código 204?**
"Sin contenido": la operación salió bien y la respuesta no trae cuerpo. Se usa al quitar una inscripción, porque no hay nada nuevo que devolver. En el frontend, `solicitar` tolera la ausencia de JSON y devuelve `null`.

**¿Qué pasa si se intenta inscribir dos veces el mismo curso?**
La clave primaria compuesta `(estudiante_id, curso_id)` hace fallar el `INSERT` con `ER_DUP_ENTRY`; el `catch` hace `rollback` y `responderErrorBaseDatos` lo traduce a **409** `El estudiante ya está inscrito en ese curso.`

**¿Qué pasa si se cambia la carrera de un estudiante con cursos?**
Si el PUT no indica qué hacer con los cursos, la API responde 409 y no cambia nada. Desde la interfaz, se pide confirmación y se envía `cursos: []`. Así, la carrera y el borrado de las inscripciones ocurren juntos en la misma transacción.
