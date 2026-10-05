const pool = require('../db');
const { enteroPositivo, obtenerEntrada, validarTexto } = require('./comunes');

const limites = {
  nombres: 100,
  apellidos: 100,
  correo: 254,
  carnet: 30,
};

// Máximo de cursos por solicitud; evita listas enormes en la consulta IN (...).
const MAX_CURSOS = 20;

// Valida fecha_nacimiento opcional: formato YYYY-MM-DD, fecha real y no futura.
function validarFecha(fecha, errores, valores) {
  if (fecha === undefined || fecha === null || fecha === '') {
    valores.fecha_nacimiento = null;
    return;
  }
  const coincide = typeof fecha === 'string' && /^(\d{4})-(\d{2})-(\d{2})$/.exec(fecha);
  if (!coincide) {
    errores.push('fecha_nacimiento debe tener el formato YYYY-MM-DD.');
    return;
  }
  const [, anio, mes, dia] = coincide;
  const fechaUtc = new Date(Date.UTC(Number(anio), Number(mes) - 1, Number(dia)));
  const fechaNormalizada = `${fechaUtc.getUTCFullYear()}-${String(fechaUtc.getUTCMonth() + 1).padStart(2, '0')}-${String(fechaUtc.getUTCDate()).padStart(2, '0')}`;
  const hoy = new Date();
  const hoyLocal = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}-${String(hoy.getDate()).padStart(2, '0')}`;
  if (fechaNormalizada !== fecha) errores.push('fecha_nacimiento no es una fecha válida.');
  else if (fecha > hoyLocal) errores.push('fecha_nacimiento no puede ser futura.');
  else valores.fecha_nacimiento = fecha;
}

// Valida el formato del arreglo cursos: al menos 1, máximo MAX_CURSOS, enteros positivos y sin repetidos.
// Devuelve la lista de IDs si el formato es correcto, o null si hay errores.
function validarListaCursos(cursos, errores) {
  if (!Array.isArray(cursos) || cursos.length === 0) {
    errores.push('cursos es obligatorio y debe ser un arreglo con al menos un id de curso.');
    return null;
  }
  if (cursos.length > MAX_CURSOS) {
    errores.push(`cursos no puede tener más de ${MAX_CURSOS} elementos.`);
    return null;
  }
  const ids = cursos.map(enteroPositivo);
  if (ids.includes(null)) {
    errores.push('cursos solo puede contener enteros positivos.');
    return null;
  }
  const repetidos = ids.filter((id, posicion) => ids.indexOf(id) !== posicion);
  if (repetidos.length > 0) {
    errores.push(`cursos no puede tener IDs repetidos (repetidos: ${[...new Set(repetidos)].join(', ')}).`);
    return null;
  }
  return ids;
}

// Comprueba con UNA sola consulta que los cursos existan y pertenezcan a la carrera.
// Los marcadores "?" se generan según la cantidad de IDs; los valores siguen siendo parámetros.
async function validarCursosDeCarrera(carreraId, cursosIds, errores) {
  const marcadores = cursosIds.map(() => '?').join(', ');
  const [filas] = await pool.execute(
    `SELECT id, carrera_id FROM cursos WHERE id IN (${marcadores})`,
    cursosIds,
  );
  const encontrados = new Map(filas.map((fila) => [fila.id, fila.carrera_id]));
  const noExisten = cursosIds.filter((id) => !encontrados.has(id));
  const deOtraCarrera = cursosIds.filter((id) => encontrados.has(id) && encontrados.get(id) !== carreraId);

  if (noExisten.length > 0) {
    errores.push(`Los cursos con id ${noExisten.join(', ')} no existen.`);
  }
  if (deOtraCarrera.length > 0) {
    errores.push(`Los cursos con id ${deOtraCarrera.join(', ')} no pertenecen a la carrera indicada.`);
  }
}

// Valida el cuerpo de POST y PUT /api/estudiantes. Devuelve { errores, valores }.
async function validarEstudiante(body) {
  const errores = [];
  const valores = {};
  const entrada = obtenerEntrada(body);

  for (const campo of ['nombres', 'apellidos', 'correo', 'carnet']) {
    validarTexto(entrada, campo, limites[campo], errores, valores);
  }
  if (valores.correo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(valores.correo)) {
    errores.push('correo debe tener un formato válido.');
  }

  validarFecha(entrada.fecha_nacimiento, errores, valores);

  const carreraId = enteroPositivo(entrada.carrera_id);
  if (!carreraId) errores.push('carrera_id es obligatorio y debe ser un entero positivo.');
  const cursosIds = validarListaCursos(entrada.cursos, errores);

  // Las consultas a la base solo se hacen si carrera_id tiene formato válido.
  if (carreraId) {
    valores.carrera_id = carreraId;
    const [carreras] = await pool.execute('SELECT id FROM carreras WHERE id = ?', [carreraId]);
    if (carreras.length === 0) {
      errores.push('La carrera indicada no existe.');
    } else if (cursosIds) {
      await validarCursosDeCarrera(carreraId, cursosIds, errores);
    }
  }
  valores.cursos = cursosIds;

  return { errores, valores };
}

module.exports = { validarEstudiante };
