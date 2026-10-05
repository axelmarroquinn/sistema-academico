// Comunicación con la API REST: fetch() y conversión de errores.

// Única constante de configuración: dirección base de la API.
export const API_URL = 'http://localhost:3000/api';

// Error con el código HTTP, el mensaje y los detalles que devuelve la API.
// status 0 significa que no hubo respuesta (API apagada o red caída).
export class ErrorApi extends Error {
  constructor(status, mensaje, detalles = []) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

// Hace una petición con fetch() y devuelve el JSON; si la API responde con error, lanza ErrorApi.
export async function solicitar(ruta, opciones = {}) {
  let respuesta;
  try {
    // Content-Type solo se envía cuando hay cuerpo JSON (POST y PUT)
    const headers = opciones.body ? { 'Content-Type': 'application/json' } : {};
    respuesta = await fetch(`${API_URL}${ruta}`, { ...opciones, headers });
  } catch {
    // fetch solo lanza excepción cuando no hay respuesta (API apagada, red caída o CORS)
    throw new ErrorApi(0, 'No se pudo conectar con la API. Verifique que el backend esté en ejecución en http://localhost:3000.');
  }

  let datos = null;
  try {
    datos = await respuesta.json();
  } catch {
    datos = null; // la respuesta no trae JSON
  }

  if (!respuesta.ok) {
    const mensaje = datos && datos.error ? datos.error : `Error inesperado (HTTP ${respuesta.status}).`;
    const detalles = datos && Array.isArray(datos.detalles) ? datos.detalles : [];
    throw new ErrorApi(respuesta.status, mensaje, detalles);
  }
  return datos;
}

// Atajo para POST y PUT: convierte el objeto a JSON y lo envía.
export function enviar(ruta, metodo, datos) {
  return solicitar(ruta, { method: metodo, body: JSON.stringify(datos) });
}

// Atajo para DELETE.
export function borrar(ruta) {
  return solicitar(ruta, { method: 'DELETE' });
}
