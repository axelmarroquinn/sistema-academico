const { obtenerEntrada, validarTexto } = require('./comunes');

// Valida el cuerpo de POST /api/carreras: nombre (máx. 120) y codigo (máx. 20).
// Los duplicados no se revisan aquí: los detecta MySQL con los índices únicos (409).
function validarCarrera(body) {
  const errores = [];
  const valores = {};
  const entrada = obtenerEntrada(body);

  validarTexto(entrada, 'nombre', 120, errores, valores);
  validarTexto(entrada, 'codigo', 20, errores, valores);

  return { errores, valores };
}

module.exports = { validarCarrera };
