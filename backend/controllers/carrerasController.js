const pool = require('../db');
const { validarId } = require('../validators/comunes');
const { validarCarrera } = require('../validators/carreras');

// LEFT JOIN para que también aparezcan las carreras sin cursos (total_cursos = 0).
const SELECT_CARRERAS = `
  SELECT ca.id, ca.nombre, ca.codigo, COUNT(cu.id) AS total_cursos
  FROM carreras ca
  LEFT JOIN cursos cu ON cu.carrera_id = ca.id`;

function responderErrorBaseDatos(res, error) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Ya existe una carrera con ese nombre o código.' });
  }
  if (error.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: 'No se puede eliminar la carrera porque tiene cursos o estudiantes asociados.' });
  }
  console.error('Database error:', error.message);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

const listar = async (_req, res) => {
  // Ejecuta SELECT con LEFT JOIN y GROUP BY; sin params ni body; devuelve 200 o 500.
  try {
    const [filas] = await pool.execute(`${SELECT_CARRERAS} GROUP BY ca.id, ca.nombre, ca.codigo ORDER BY ca.nombre`);
    return res.status(200).json(filas);
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

const crear = async (req, res) => {
  // Toma nombre y codigo de req.body; ejecuta INSERT; devuelve 201, 400, 409 o 500.
  try {
    const { errores, valores } = validarCarrera(req.body);
    if (errores.length) return res.status(400).json({ error: 'Hay datos inválidos.', detalles: errores });
    const [resultado] = await pool.execute(
      'INSERT INTO carreras (nombre, codigo) VALUES (?, ?)',
      [valores.nombre, valores.codigo],
    );
    const [filas] = await pool.execute(
      `${SELECT_CARRERAS} WHERE ca.id = ? GROUP BY ca.id, ca.nombre, ca.codigo`,
      [resultado.insertId],
    );
    return res.status(201).json(filas[0]);
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

const eliminar = async (req, res) => {
  // Toma id de req.params; si tiene cursos o estudiantes responde 409; si no, ejecuta DELETE.
  // Devuelve 200, 400, 404, 409 o 500.
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ error: 'El id debe ser un entero positivo.' });
    const [existentes] = await pool.execute('SELECT id FROM carreras WHERE id = ?', [id]);
    if (existentes.length === 0) return res.status(404).json({ error: 'Carrera no encontrada.' });

    const [conteo] = await pool.execute(
      `SELECT (SELECT COUNT(*) FROM cursos WHERE carrera_id = ?) AS cursos,
              (SELECT COUNT(*) FROM estudiantes WHERE carrera_id = ?) AS estudiantes`,
      [id, id],
    );
    const { cursos, estudiantes } = conteo[0];
    if (cursos > 0 || estudiantes > 0) {
      return res.status(409).json({
        error: `No se puede eliminar la carrera porque tiene ${cursos} curso(s) y ${estudiantes} estudiante(s) asociados. Elimínelos primero.`,
      });
    }

    // Si alguien agrega un curso o estudiante justo ahora, la FK con ON DELETE RESTRICT lo impide (409).
    await pool.execute('DELETE FROM carreras WHERE id = ?', [id]);
    return res.status(200).json({ mensaje: 'Carrera eliminada correctamente.' });
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

module.exports = { listar, crear, eliminar };
