const pool = require('../db');
const { validarId, enteroPositivo, obtenerEntrada } = require('../validators/comunes');

// Cursos inscritos ACTIVOS de UN estudiante.
const SELECT_CURSOS_DEL_ESTUDIANTE = `
  SELECT cu.id, cu.nombre, cu.codigo, cu.creditos
  FROM inscripciones i
  INNER JOIN cursos cu ON cu.id = i.curso_id
  WHERE i.estudiante_id = ? AND i.estado = 'ACTIVO'
  ORDER BY cu.nombre`;

function responderErrorBaseDatos(res, error) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'El estudiante ya está inscrito en ese curso.' });
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(404).json({ error: 'El estudiante o el curso ya no existe.' });
  }
  console.error('Database error:', error.message);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

const listar = async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ error: 'El id debe ser un entero positivo.' });
    const [estudiantes] = await pool.execute(
      "SELECT id FROM estudiantes WHERE id = ? AND estado = 'ACTIVO'",
      [id],
    );
    if (estudiantes.length === 0) return res.status(404).json({ error: 'Estudiante no encontrado.' });
    const [cursos] = await pool.execute(SELECT_CURSOS_DEL_ESTUDIANTE, [id]);
    return res.status(200).json(cursos);
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

const inscribir = async (req, res) => {
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ error: 'El id debe ser un entero positivo.' });
    const entrada = obtenerEntrada(req.body);
    const cursoId = enteroPositivo(entrada.cursoId !== undefined ? entrada.cursoId : entrada.curso_id);
    if (!cursoId) {
      return res.status(400).json({
        error: 'Hay datos inválidos.',
        detalles: ['cursoId es obligatorio y debe ser un entero positivo.'],
      });
    }

    const conexion = await pool.getConnection();
    try {
      await conexion.beginTransaction();
      const [estudiantes] = await conexion.execute(
        "SELECT carrera_id FROM estudiantes WHERE id = ? AND estado = 'ACTIVO' FOR UPDATE",
        [id],
      );
      if (estudiantes.length === 0) {
        await conexion.rollback();
        return res.status(404).json({ error: 'Estudiante no encontrado.' });
      }
      const [cursos] = await conexion.execute(
        'SELECT id, carrera_id, nombre, codigo, creditos FROM cursos WHERE id = ?',
        [cursoId],
      );
      if (cursos.length === 0) {
        await conexion.rollback();
        return res.status(404).json({ error: 'Curso no encontrado.' });
      }
      const curso = cursos[0];
      if (curso.carrera_id !== estudiantes[0].carrera_id) {
        await conexion.rollback();
        return res.status(400).json({ error: 'El curso no pertenece a la carrera del estudiante.' });
      }

      // Verificar si ya existe un registro (ACTIVO o INACTIVO) en inscripciones
      const [inscripcionPrevia] = await conexion.execute(
        'SELECT estado FROM inscripciones WHERE estudiante_id = ? AND curso_id = ? FOR UPDATE',
        [id, cursoId],
      );

      if (inscripcionPrevia.length > 0) {
        if (inscripcionPrevia[0].estado === 'ACTIVO') {
          await conexion.rollback();
          return res.status(409).json({ error: 'El estudiante ya está inscrito en ese curso.' });
        }
        // Si estaba INACTIVO, lo reactivamos a ACTIVO
        await conexion.execute(
          "UPDATE inscripciones SET estado = 'ACTIVO' WHERE estudiante_id = ? AND curso_id = ?",
          [id, cursoId],
        );
      } else {
        await conexion.execute(
          "INSERT INTO inscripciones (estudiante_id, curso_id, estado) VALUES (?, ?, 'ACTIVO')",
          [id, cursoId],
        );
      }

      await conexion.commit();
      return res.status(201).json({
        id: curso.id,
        nombre: curso.nombre,
        codigo: curso.codigo,
        creditos: curso.creditos,
      });
    } catch (error) {
      await conexion.rollback();
      throw error;
    } finally {
      conexion.release();
    }
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

const quitar = async (req, res) => {
  // Borrado lógico de la inscripción: pasa a estado 'INACTIVO' en vez de borrar la fila.
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ error: 'El id debe ser un entero positivo.' });
    const cursoId = validarId(req.params.cursoId);
    if (!cursoId) return res.status(400).json({ error: 'El id del curso debe ser un entero positivo.' });

    const [estudiantes] = await pool.execute(
      "SELECT id FROM estudiantes WHERE id = ? AND estado = 'ACTIVO'",
      [id],
    );
    if (estudiantes.length === 0) return res.status(404).json({ error: 'Estudiante no encontrado.' });

    const [resultado] = await pool.execute(
      "UPDATE inscripciones SET estado = 'INACTIVO' WHERE estudiante_id = ? AND curso_id = ? AND estado = 'ACTIVO'",
      [id, cursoId],
    );
    if (resultado.affectedRows === 0) {
      return res.status(404).json({ error: 'El estudiante no está inscrito en ese curso.' });
    }
    return res.status(204).end();
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

module.exports = { listar, inscribir, quitar };