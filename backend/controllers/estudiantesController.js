const pool = require('../db');
const { validarId } = require('../validators/comunes');
const { validarEstudiante } = require('../validators/estudiantes');

// Datos del estudiante con el nombre de su carrera (sin cursos).
const SELECT_ESTUDIANTES = `
  SELECT e.id, e.nombres, e.apellidos, e.correo, e.carnet, e.fecha_nacimiento,
         e.carrera_id, ca.nombre AS carrera_nombre
  FROM estudiantes e
  INNER JOIN carreras ca ON ca.id = e.carrera_id`;

// Cursos inscritos, con el id del estudiante para poder agruparlos en JavaScript.
const SELECT_CURSOS_INSCRITOS = `
  SELECT i.estudiante_id, cu.id, cu.nombre, cu.codigo, cu.creditos
  FROM inscripciones i
  INNER JOIN cursos cu ON cu.id = i.curso_id`;

function responderErrorBaseDatos(res, error) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'El correo o carnet ya está registrado.' });
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    // Una carrera o un curso se borró entre la validación y la escritura.
    return res.status(400).json({ error: 'La carrera o alguno de los cursos indicados no existe.' });
  }
  console.error('Database error:', error.message);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

// Agrega a cada estudiante su arreglo "cursos" a partir de las filas de SELECT_CURSOS_INSCRITOS.
// Así se usan 2 consultas en total en lugar de 1 por estudiante (problema N+1).
function agruparCursos(estudiantes, filasCursos) {
  const cursosPorEstudiante = new Map();
  for (const fila of filasCursos) {
    if (!cursosPorEstudiante.has(fila.estudiante_id)) cursosPorEstudiante.set(fila.estudiante_id, []);
    cursosPorEstudiante.get(fila.estudiante_id).push({
      id: fila.id,
      nombre: fila.nombre,
      codigo: fila.codigo,
      creditos: fila.creditos,
    });
  }
  return estudiantes.map((estudiante) => ({
    ...estudiante,
    cursos: cursosPorEstudiante.get(estudiante.id) || [],
  }));
}

// Busca un estudiante con sus cursos; "conexion" puede ser el pool o una conexión de transacción.
// Devuelve null si no existe.
async function buscarEstudiante(conexion, id) {
  const [estudiantes] = await conexion.execute(`${SELECT_ESTUDIANTES} WHERE e.id = ?`, [id]);
  if (estudiantes.length === 0) return null;
  const [cursos] = await conexion.execute(
    `${SELECT_CURSOS_INSCRITOS} WHERE i.estudiante_id = ? ORDER BY cu.nombre`,
    [id],
  );
  return agruparCursos(estudiantes, cursos)[0];
}

// Inserta una fila en inscripciones por cada curso. Se llama dentro de una transacción.
// cursosIds puede ser null (no se enviaron cursos) o []: en ambos casos no inserta nada.
async function insertarInscripciones(conexion, estudianteId, cursosIds) {
  for (const cursoId of cursosIds || []) {
    await conexion.execute(
      'INSERT INTO inscripciones (estudiante_id, curso_id) VALUES (?, ?)',
      [estudianteId, cursoId],
    );
  }
}

const listar = async (_req, res) => {
  // Ejecuta 2 SELECT (estudiantes y cursos inscritos) y los agrupa; devuelve 200 o 500.
  try {
    const [estudiantes] = await pool.execute(`${SELECT_ESTUDIANTES} ORDER BY e.id`);
    const [cursos] = await pool.execute(`${SELECT_CURSOS_INSCRITOS} ORDER BY cu.nombre`);
    return res.status(200).json(agruparCursos(estudiantes, cursos));
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

const obtener = async (req, res) => {
  // Toma id de req.params y devuelve 200, 400, 404 o 500.
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ error: 'El id debe ser un entero positivo.' });
    const estudiante = await buscarEstudiante(pool, id);
    if (!estudiante) return res.status(404).json({ error: 'Estudiante no encontrado.' });
    return res.status(200).json(estudiante);
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

const crear = async (req, res) => {
  // Toma campos de req.body, valida y, en una transacción, inserta al estudiante y sus
  // inscripciones (cursos es opcional); devuelve 201, 400, 409 o 500.
  try {
    const { errores, valores } = await validarEstudiante(req.body);
    if (errores.length) return res.status(400).json({ error: 'Hay datos inválidos.', detalles: errores });

    let nuevoId;
    const conexion = await pool.getConnection();
    try {
      await conexion.beginTransaction();
      const [resultado] = await conexion.execute(
        'INSERT INTO estudiantes (nombres, apellidos, correo, carnet, carrera_id, fecha_nacimiento) VALUES (?, ?, ?, ?, ?, ?)',
        [valores.nombres, valores.apellidos, valores.correo, valores.carnet, valores.carrera_id, valores.fecha_nacimiento],
      );
      nuevoId = resultado.insertId;
      await insertarInscripciones(conexion, nuevoId, valores.cursos);
      await conexion.commit();
    } catch (error) {
      // Si algo falla, se deshace todo: no queda un estudiante sin inscripciones ni a medias.
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release(); // la conexión vuelve al pool siempre
    }

    const estudiante = await buscarEstudiante(pool, nuevoId);
    return res.status(201).json(estudiante);
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

const actualizar = async (req, res) => {
  // Toma id de req.params y campos de req.body; en una transacción actualiza al estudiante.
  // Inscripciones: si el cuerpo trae "cursos" (aunque sea []), se reemplazan; si no lo trae,
  // no se tocan. Regla de cambio de carrera: si cambia la carrera, no se envía "cursos" y el
  // estudiante tiene inscripciones, responde 409 (no se borran inscripciones sin pedirlo).
  // Devuelve 200, 400, 404, 409 o 500.
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ error: 'El id debe ser un entero positivo.' });
    const [existentes] = await pool.execute('SELECT id FROM estudiantes WHERE id = ?', [id]);
    if (existentes.length === 0) return res.status(404).json({ error: 'Estudiante no encontrado.' });
    // Los cursos se validan contra la carrera enviada, que puede ser una carrera nueva.
    const { errores, valores } = await validarEstudiante(req.body);
    if (errores.length) return res.status(400).json({ error: 'Hay datos inválidos.', detalles: errores });

    const conexion = await pool.getConnection();
    try {
      await conexion.beginTransaction();
      // FOR UPDATE bloquea la fila del estudiante hasta el commit: nadie puede inscribirlo en
      // otro curso mientras se decide el cambio de carrera.
      const [actuales] = await conexion.execute('SELECT carrera_id FROM estudiantes WHERE id = ? FOR UPDATE', [id]);
      if (actuales.length === 0) {
        // Otro usuario lo eliminó después de la comprobación inicial.
        await conexion.rollback();
        return res.status(404).json({ error: 'Estudiante no encontrado.' });
      }

      const cambiaCarrera = actuales[0].carrera_id !== valores.carrera_id;
      if (cambiaCarrera && valores.cursos === null) {
        const [conteo] = await conexion.execute('SELECT COUNT(*) AS total FROM inscripciones WHERE estudiante_id = ?', [id]);
        if (conteo[0].total > 0) {
          await conexion.rollback();
          return res.status(409).json({
            error: `No se puede cambiar la carrera porque el estudiante tiene ${conteo[0].total} curso(s) inscrito(s). Quite las inscripciones o envíe "cursos" con cursos de la nueva carrera (puede ser []).`,
          });
        }
      }

      await conexion.execute(
        'UPDATE estudiantes SET nombres = ?, apellidos = ?, correo = ?, carnet = ?, carrera_id = ?, fecha_nacimiento = ? WHERE id = ?',
        [valores.nombres, valores.apellidos, valores.correo, valores.carnet, valores.carrera_id, valores.fecha_nacimiento, id],
      );
      if (valores.cursos !== null) {
        // Reemplazo de inscripciones: se borran las anteriores y se insertan las enviadas.
        await conexion.execute('DELETE FROM inscripciones WHERE estudiante_id = ?', [id]);
        await insertarInscripciones(conexion, id, valores.cursos);
      }
      await conexion.commit();
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }

    const estudiante = await buscarEstudiante(pool, id);
    return res.status(200).json(estudiante);
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

const eliminar = async (req, res) => {
  // Toma id de req.params y ejecuta DELETE; las inscripciones se borran por ON DELETE CASCADE.
  // Devuelve 200, 400, 404 o 500.
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ error: 'El id debe ser un entero positivo.' });
    const [resultado] = await pool.execute('DELETE FROM estudiantes WHERE id = ?', [id]);
    if (resultado.affectedRows === 0) return res.status(404).json({ error: 'Estudiante no encontrado.' });
    return res.status(200).json({ mensaje: 'Estudiante eliminado correctamente.' });
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

module.exports = { listar, obtener, crear, actualizar, eliminar };
