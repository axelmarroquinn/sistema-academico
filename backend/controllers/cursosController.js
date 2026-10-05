const pool = require('../db');
const { validarId } = require('../validators/comunes');
const { validarCurso } = require('../validators/cursos');

const SELECT_CURSOS = `
  SELECT cu.id, cu.carrera_id, ca.nombre AS carrera_nombre, cu.nombre, cu.codigo, cu.creditos
  FROM cursos cu
  INNER JOIN carreras ca ON ca.id = cu.carrera_id`;

function responderErrorBaseDatos(res, error) {
  if (error.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Ya existe un curso con ese código o con ese nombre en la carrera.' });
  }
  if (error.code === 'ER_NO_REFERENCED_ROW_2') {
    return res.status(400).json({ error: 'La carrera indicada no existe.' });
  }
  if (error.code === 'ER_ROW_IS_REFERENCED_2') {
    return res.status(409).json({ error: 'No se puede eliminar el curso porque tiene estudiantes inscritos.' });
  }
  console.error('Database error:', error.message);
  return res.status(500).json({ error: 'Error interno del servidor.' });
}

const listar = async (req, res) => {
  // Toma el filtro opcional carrera_id de req.query; devuelve 200, 400 o 500.
  try {
    if (req.query.carrera_id === undefined) {
      const [filas] = await pool.execute(`${SELECT_CURSOS} ORDER BY cu.nombre`);
      return res.status(200).json(filas);
    }
    const carreraId = validarId(req.query.carrera_id);
    if (!carreraId) return res.status(400).json({ error: 'carrera_id debe ser un entero positivo.' });
    const [filas] = await pool.execute(`${SELECT_CURSOS} WHERE cu.carrera_id = ? ORDER BY cu.nombre`, [carreraId]);
    return res.status(200).json(filas);
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

const crear = async (req, res) => {
  // Toma carrera_id, nombre, codigo y creditos de req.body; ejecuta INSERT; devuelve 201, 400, 409 o 500.
  try {
    const { errores, valores } = await validarCurso(req.body);
    if (errores.length) return res.status(400).json({ error: 'Hay datos inválidos.', detalles: errores });
    const [resultado] = await pool.execute(
      'INSERT INTO cursos (carrera_id, nombre, codigo, creditos) VALUES (?, ?, ?, ?)',
      [valores.carrera_id, valores.nombre, valores.codigo, valores.creditos],
    );
    const [filas] = await pool.execute(`${SELECT_CURSOS} WHERE cu.id = ?`, [resultado.insertId]);
    return res.status(201).json(filas[0]);
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

const eliminar = async (req, res) => {
  // Toma id de req.params; si hay inscritos responde 409; si no, ejecuta DELETE.
  // Devuelve 200, 400, 404, 409 o 500.
  try {
    const id = validarId(req.params.id);
    if (!id) return res.status(400).json({ error: 'El id debe ser un entero positivo.' });
    const [existentes] = await pool.execute('SELECT id FROM cursos WHERE id = ?', [id]);
    if (existentes.length === 0) return res.status(404).json({ error: 'Curso no encontrado.' });

    const [conteo] = await pool.execute('SELECT COUNT(*) AS total FROM inscripciones WHERE curso_id = ?', [id]);
    if (conteo[0].total > 0) {
      return res.status(409).json({
        error: `No se puede eliminar el curso porque tiene ${conteo[0].total} estudiante(s) inscrito(s). Retire primero las inscripciones.`,
      });
    }

    // Si alguien se inscribe justo ahora, la FK con ON DELETE RESTRICT lo impide (ER_ROW_IS_REFERENCED_2 → 409).
    await pool.execute('DELETE FROM cursos WHERE id = ?', [id]);
    return res.status(200).json({ mensaje: 'Curso eliminado correctamente.' });
  } catch (error) {
    return responderErrorBaseDatos(res, error);
  }
};

module.exports = { listar, crear, eliminar };
