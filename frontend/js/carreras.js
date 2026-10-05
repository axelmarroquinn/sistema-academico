// Sección "Carreras y cursos": crear y eliminar carreras y cursos, y listar cursos con filtro.
import { solicitar, enviar, borrar } from './api.js';
import {
  mostrarMensaje, mostrarErrorApi, mostrarEstadoTabla, crearCelda, crearBoton, crearCeldaAcciones,
  llenarSelectCarreras, pintarErrores, detallesACampos, cambiarEstadoBoton, confirmar,
} from './ui.js';

const formCarrera = document.getElementById('form-carrera');
const botonCarrera = document.getElementById('car-guardar');
const tablaCarreras = document.getElementById('tabla-carreras');

const formCurso = document.getElementById('form-curso');
const botonCurso = document.getElementById('cur-guardar');
const selectCarreraCurso = document.getElementById('cur-carrera');
const filtroCarrera = document.getElementById('filtro-carrera');
const tablaCursos = document.getElementById('tabla-cursos');

// Campo de la API → id del elemento en el formulario.
const CAMPOS_CARRERA = { nombre: 'car-nombre', codigo: 'car-codigo' };
const CAMPOS_CURSO = { carrera_id: 'cur-carrera', nombre: 'cur-nombre', codigo: 'cur-codigo', creditos: 'cur-creditos' };

// Función que avisa a la sección Estudiantes cuando cambian carreras o cursos (la asigna main.js).
let alCambiarCatalogo = () => {};

// ===== Carreras =====

// Construye la fila de una carrera con su botón Eliminar.
function crearFilaCarrera(carrera) {
  const fila = document.createElement('tr');
  fila.append(
    crearCelda(carrera.nombre),
    crearCelda(carrera.codigo),
    crearCelda(carrera.total_cursos),
    crearCeldaAcciones(
      crearBoton('Eliminar', 'boton--peligro', `Eliminar la carrera ${carrera.nombre}`, (boton) => eliminarCarrera(carrera, boton)),
    ),
  );
  return fila;
}

// GET /carreras: dibuja la tabla, llena los selects de esta sección y avisa a Estudiantes.
export async function cargarCarreras() {
  mostrarEstadoTabla(tablaCarreras, 4, 'Cargando carreras…');
  try {
    const carreras = await solicitar('/carreras');
    if (carreras.length === 0) mostrarEstadoTabla(tablaCarreras, 4, 'No hay carreras registradas.');
    else tablaCarreras.replaceChildren(...carreras.map(crearFilaCarrera));
    llenarSelectCarreras(selectCarreraCurso, carreras, 'Seleccione una carrera');
    llenarSelectCarreras(filtroCarrera, carreras, 'Todas las carreras');
    alCambiarCatalogo(carreras);
  } catch (error) {
    mostrarEstadoTabla(tablaCarreras, 4, 'No se pudo cargar la lista de carreras.');
    mostrarErrorApi(error);
  }
}

// Valida nombre y código de la carrera; devuelve { campo: mensaje }.
function validarCarrera(datos) {
  const errores = {};
  if (!datos.nombre) errores.nombre = 'Ingrese el nombre de la carrera.';
  if (!datos.codigo) errores.codigo = 'Ingrese el código de la carrera.';
  return errores;
}

// POST /carreras con los datos del formulario.
async function crearCarrera(evento) {
  evento.preventDefault();
  const datos = {
    nombre: document.getElementById('car-nombre').value.trim(),
    codigo: document.getElementById('car-codigo').value.trim(),
  };
  const errores = validarCarrera(datos);
  pintarErrores(CAMPOS_CARRERA, errores);
  if (Object.keys(errores).length > 0) return;

  cambiarEstadoBoton(botonCarrera, true);
  try {
    const carrera = await enviar('/carreras', 'POST', datos);
    formCarrera.reset();
    mostrarMensaje('exito', `Carrera ${carrera.nombre} creada correctamente.`);
    await cargarCarreras();
  } catch (error) {
    if (error.status === 400) pintarErrores(CAMPOS_CARRERA, detallesACampos(error.detalles, Object.keys(CAMPOS_CARRERA)));
    mostrarErrorApi(error);
  } finally {
    cambiarEstadoBoton(botonCarrera, false);
  }
}

// DELETE /carreras/:id previa confirmación; un 409 muestra el mensaje de la API (tiene dependientes).
async function eliminarCarrera(carrera, boton) {
  if (!confirmar(`¿Eliminar la carrera ${carrera.nombre} (${carrera.codigo})?`)) return;
  boton.disabled = true;
  try {
    const respuesta = await borrar(`/carreras/${carrera.id}`);
    mostrarMensaje('exito', respuesta.mensaje);
    await cargarCarreras();
    await cargarCursos(); // si el filtro apuntaba a la carrera borrada, vuelve a "Todas"
  } catch (error) {
    boton.disabled = false;
    mostrarErrorApi(error);
    if (error.status === 404) cargarCarreras();
  }
}

// ===== Cursos =====

// Construye la fila de un curso con su botón Eliminar.
function crearFilaCurso(curso) {
  const fila = document.createElement('tr');
  fila.append(
    crearCelda(curso.nombre),
    crearCelda(curso.codigo),
    crearCelda(curso.creditos),
    crearCelda(curso.carrera_nombre),
    crearCeldaAcciones(
      crearBoton('Eliminar', 'boton--peligro', `Eliminar el curso ${curso.nombre}`, (boton) => eliminarCurso(curso, boton)),
    ),
  );
  return fila;
}

// GET /cursos (o /cursos?carrera_id=N según el filtro) y dibuja la tabla.
export async function cargarCursos() {
  const carreraId = filtroCarrera.value;
  const ruta = carreraId ? `/cursos?carrera_id=${encodeURIComponent(carreraId)}` : '/cursos';
  mostrarEstadoTabla(tablaCursos, 5, 'Cargando cursos…');
  try {
    const cursos = await solicitar(ruta);
    if (cursos.length === 0) {
      mostrarEstadoTabla(tablaCursos, 5, carreraId ? 'Esta carrera no tiene cursos registrados.' : 'No hay cursos registrados.');
      return;
    }
    tablaCursos.replaceChildren(...cursos.map(crearFilaCurso));
  } catch (error) {
    mostrarEstadoTabla(tablaCursos, 5, 'No se pudo cargar la lista de cursos.');
    mostrarErrorApi(error);
  }
}

// Lee el formulario de curso; créditos queda como número o null si está vacío.
function leerCurso() {
  const creditos = document.getElementById('cur-creditos').value.trim();
  return {
    carrera_id: selectCarreraCurso.value ? Number(selectCarreraCurso.value) : null,
    nombre: document.getElementById('cur-nombre').value.trim(),
    codigo: document.getElementById('cur-codigo').value.trim(),
    creditos: creditos === '' ? null : Number(creditos),
  };
}

// Valida el curso con las mismas reglas del backend; devuelve { campo: mensaje }.
function validarCurso(datos) {
  const errores = {};
  if (!datos.carrera_id) errores.carrera_id = 'Seleccione la carrera del curso.';
  if (!datos.nombre) errores.nombre = 'Ingrese el nombre del curso.';
  if (!datos.codigo) errores.codigo = 'Ingrese el código del curso.';
  if (!Number.isInteger(datos.creditos) || datos.creditos < 1 || datos.creditos > 30) {
    errores.creditos = 'Los créditos deben ser un entero entre 1 y 30.';
  }
  return errores;
}

// POST /cursos con los datos del formulario.
async function crearCurso(evento) {
  evento.preventDefault();
  const datos = leerCurso();
  const errores = validarCurso(datos);
  pintarErrores(CAMPOS_CURSO, errores);
  if (Object.keys(errores).length > 0) return;

  cambiarEstadoBoton(botonCurso, true);
  try {
    const curso = await enviar('/cursos', 'POST', datos);
    formCurso.reset();
    selectCarreraCurso.value = String(datos.carrera_id); // conserva la carrera para cargar varios cursos seguidos
    mostrarMensaje('exito', `Curso ${curso.nombre} creado en ${curso.carrera_nombre}.`);
    await cargarCarreras(); // actualiza total_cursos y las casillas de Estudiantes
    await cargarCursos();
  } catch (error) {
    if (error.status === 400) {
      const reglas = [[/carrera/i, 'carrera_id']]; // "La carrera indicada no existe."
      pintarErrores(CAMPOS_CURSO, detallesACampos(error.detalles, Object.keys(CAMPOS_CURSO), reglas));
    }
    mostrarErrorApi(error);
  } finally {
    cambiarEstadoBoton(botonCurso, false);
  }
}

// DELETE /cursos/:id previa confirmación; un 409 muestra el mensaje de la API (tiene inscritos).
async function eliminarCurso(curso, boton) {
  if (!confirmar(`¿Eliminar el curso ${curso.nombre} (${curso.codigo})?`)) return;
  boton.disabled = true;
  try {
    const respuesta = await borrar(`/cursos/${curso.id}`);
    mostrarMensaje('exito', respuesta.mensaje);
    await cargarCarreras();
    await cargarCursos();
  } catch (error) {
    boton.disabled = false;
    mostrarErrorApi(error);
    if (error.status === 404) cargarCursos();
  }
}

// ===== Inicio =====

// Registra los eventos de la sección; "avisar" se llama con la lista de carreras cada vez que cambia.
export function iniciarCarreras(avisar) {
  alCambiarCatalogo = avisar;
  formCarrera.addEventListener('submit', crearCarrera);
  formCurso.addEventListener('submit', crearCurso);
  filtroCarrera.addEventListener('change', cargarCursos);
}
