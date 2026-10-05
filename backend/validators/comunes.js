// Funciones de validación compartidas por carreras, cursos y estudiantes.

// Valida un id que llega como texto (req.params o req.query): solo dígitos y mayor que 0.
function validarId(valor) {
  if (!/^\d+$/.test(String(valor))) return null;
  const id = Number(valor);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// Valida un entero positivo que llega en el JSON del cuerpo.
// Acepta el número 5 o el texto "5"; rechaza true, [5], 5.5, "5e0" y similares.
function enteroPositivo(valor) {
  if (typeof valor === 'number') return Number.isSafeInteger(valor) && valor > 0 ? valor : null;
  if (typeof valor === 'string') return validarId(valor);
  return null;
}

// Devuelve el cuerpo si es un objeto JSON; si no, un objeto vacío para que fallen los campos.
function obtenerEntrada(body) {
  return body && typeof body === 'object' && !Array.isArray(body) ? body : {};
}

// Valida un texto obligatorio: tipo string, sin quedar vacío, sin espacios en los extremos y con
// longitud máxima. Agrega los mensajes a "errores" y, si es texto, guarda el valor en "valores".
function validarTexto(entrada, campo, limite, errores, valores) {
  const valor = entrada[campo];
  if (typeof valor !== 'string' || !valor.trim()) {
    errores.push(`${campo} es obligatorio y debe ser texto.`);
    return;
  }
  valores[campo] = valor.trim();
  if (valores[campo].length > limite) {
    errores.push(`${campo} no puede superar ${limite} caracteres.`);
  }
  if (valor !== valor.trim()) {
    errores.push(`${campo} no debe tener espacios al inicio ni al final.`);
  }
}

module.exports = { validarId, enteroPositivo, obtenerEntrada, validarTexto };
