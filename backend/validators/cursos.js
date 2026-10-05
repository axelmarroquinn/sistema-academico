const pool = require('../db');
const { enteroPositivo, obtenerEntrada, validarTexto } = require('./comunes');

// Valida el cuerpo de POST /api/cursos: carrera_id existente, nombre (máx. 150),
// codigo (máx. 20) y creditos opcional (entero de 1 a 30; si no se envía vale 3).
async function validarCurso(body) {
  const errores = [];
  const valores = {};
  const entrada = obtenerEntrada(body);

  validarTexto(entrada, 'nombre', 150, errores, valores);
  validarTexto(entrada, 'codigo', 20, errores, valores);

  const creditos = entrada.creditos;
  if (creditos === undefined || creditos === null || creditos === '') {
    valores.creditos = 3;
  } else {
    const numero = enteroPositivo(creditos);
    if (!numero || numero > 30) errores.push('creditos debe ser un entero entre 1 y 30.');
    else valores.creditos = numero;
  }

  const carreraId = enteroPositivo(entrada.carrera_id);
  if (!carreraId) {
    errores.push('carrera_id es obligatorio y debe ser un entero positivo.');
  } else {
    valores.carrera_id = carreraId;
    const [carreras] = await pool.execute('SELECT id FROM carreras WHERE id = ?', [carreraId]);
    if (carreras.length === 0) errores.push('La carrera indicada no existe.');
  }

  return { errores, valores };
}

module.exports = { validarCurso };
