// Panel de detalle del estudiante: datos en modo lectura e inscripciones de cursos.
// Usa los endpoints GET/POST /estudiantes/:id/cursos y DELETE /estudiantes/:id/cursos/:cursoId,
// así que inscribir o quitar un curso nunca reenvía los datos personales.
import { solicitar, enviar, borrar } from './api.js';
import {
  mostrarMensaje, mostrarErrorApi, crearBoton, crearOpcion, mostrarErrorCampo, cambiarEstadoBoton, confirmar,
} from './ui.js';

const panel = document.getElementById('panel-estudiante');
const titulo = document.getElementById('panel-titulo');
const listaDatos = document.getElementById('panel-datos');
const listaCursos = document.getElementById('panel-cursos');
const formInscribir = document.getElementById('form-inscribir');
const selectAgregar = document.getElementById('panel-agregar');
const botonInscribir = document.getElementById('panel-inscribir');

// Estudiante mostrado en el panel (null si está cerrado).
let estudianteActual = null;

// Funciones de otros módulos que asigna main.js (evita dependencias circulares).
let avisos = {
  alEditar: () => {},             // "Editar datos": abre el formulario de estudiantes.js
  alCambiarCursos: () => {},      // actualiza la fila del estudiante en la tabla
  alNoExistir: () => {},          // el estudiante se borró en otra pestaña: recargar la tabla
};

// ===== Dibujo del panel =====

// Agrega un par término/valor a la lista de datos (<dl>).
function agregarDato(termino, valor) {
  const dt = document.createElement('dt');
  dt.textContent = termino;
  const dd = document.createElement('dd');
  dd.textContent = valor;
  listaDatos.append(dt, dd);
}

// Muestra los datos personales del estudiante en modo lectura.
function pintarDatos(estudiante) {
  titulo.textContent = `${estudiante.nombres} ${estudiante.apellidos}`;
  listaDatos.replaceChildren();
  agregarDato('Carnet', estudiante.carnet);
  agregarDato('Correo', estudiante.correo);
  agregarDato('Fecha de nacimiento', estudiante.fecha_nacimiento || 'No registrada');
  agregarDato('Carrera', estudiante.carrera_nombre);
}

// Dibuja la lista de cursos inscritos con un botón Quitar por curso.
function pintarInscritos(cursos) {
  if (cursos.length === 0) {
    const vacio = document.createElement('li');
    vacio.className = 'panel__vacio';
    vacio.textContent = 'No está inscrito en ningún curso.';
    listaCursos.replaceChildren(vacio);
    return;
  }
  listaCursos.replaceChildren(...cursos.map((curso) => {
    const item = document.createElement('li');
    const texto = document.createElement('span');
    texto.textContent = `${curso.nombre} (${curso.codigo}) · ${curso.creditos} créditos`;
    item.append(
      texto,
      crearBoton('Quitar', 'boton--peligro', `Quitar el curso ${curso.nombre}`, (boton) => quitarCurso(curso, boton)),
    );
    return item;
  }));
}

// Llena el select "Agregar curso" con los cursos de la carrera en los que aún no está inscrito.
function llenarDisponibles(disponibles) {
  mostrarErrorCampo('panel-agregar', '');
  if (disponibles.length === 0) {
    selectAgregar.replaceChildren(crearOpcion('', 'No hay cursos disponibles en su carrera'));
    selectAgregar.disabled = true;
    botonInscribir.disabled = true;
    return;
  }
  const opciones = disponibles.map((curso) => crearOpcion(curso.id, `${curso.nombre} (${curso.codigo})`));
  selectAgregar.replaceChildren(crearOpcion('', 'Seleccione un curso'), ...opciones);
  selectAgregar.disabled = false;
  botonInscribir.disabled = false;
}

// ===== Carga de datos =====

// Vuelve a pedir los cursos inscritos (GET /estudiantes/:id/cursos) y los de su carrera
// (GET /cursos?carrera_id=N); redibuja solo el panel y avisa para actualizar la fila de la tabla.
async function refrescarCursos() {
  const { id, carrera_id: carreraId } = estudianteActual;
  try {
    const [inscritos, cursosCarrera] = await Promise.all([
      solicitar(`/estudiantes/${id}/cursos`),
      solicitar(`/cursos?carrera_id=${carreraId}`),
    ]);
    if (!estudianteActual || estudianteActual.id !== id) return; // se cerró o cambió mientras cargaba
    const idsInscritos = new Set(inscritos.map((curso) => curso.id));
    pintarInscritos(inscritos);
    llenarDisponibles(cursosCarrera.filter((curso) => !idsInscritos.has(curso.id)));
    avisos.alCambiarCursos(id, inscritos);
  } catch (error) {
    mostrarErrorApi(error);
    if (error.status === 404) {
      cerrarPanel();
      avisos.alNoExistir();
    }
  }
}

// Abre el panel de un estudiante (GET /estudiantes/:id). Con enfocar=false solo lo actualiza.
export async function abrirPanel(id, enfocar = true) {
  try {
    const estudiante = await solicitar(`/estudiantes/${id}`);
    estudianteActual = estudiante;
    pintarDatos(estudiante);
    panel.hidden = false;
    if (enfocar) {
      panel.scrollIntoView({ behavior: 'smooth' });
      titulo.focus(); // el lector de pantalla anuncia el nombre del estudiante
    }
    await refrescarCursos();
  } catch (error) {
    mostrarErrorApi(error);
    if (error.status === 404) {
      cerrarPanel();
      avisos.alNoExistir();
    }
  }
}

// Cierra el panel.
export function cerrarPanel() {
  estudianteActual = null;
  panel.hidden = true;
}

// Si el panel muestra a ese estudiante (o a cualquiera, sin id), lo vuelve a cargar sin mover el foco.
export function refrescarPanel(id = null) {
  if (estudianteActual && (id === null || estudianteActual.id === id)) abrirPanel(estudianteActual.id, false);
}

// Si el panel muestra a ese estudiante, lo cierra (por ejemplo, porque se eliminó).
export function cerrarPanelSi(id) {
  if (estudianteActual && estudianteActual.id === id) cerrarPanel();
}

// ===== Acciones =====

// POST /estudiantes/:id/cursos con { cursoId } del select "Agregar curso".
async function inscribirCurso(evento) {
  evento.preventDefault();
  const cursoId = Number(selectAgregar.value);
  if (!cursoId) {
    mostrarErrorCampo('panel-agregar', 'Seleccione el curso que desea inscribir.');
    selectAgregar.focus();
    return;
  }
  const { id } = estudianteActual;
  cambiarEstadoBoton(botonInscribir, true, 'Inscribiendo…');
  try {
    const curso = await enviar(`/estudiantes/${id}/cursos`, 'POST', { cursoId });
    mostrarMensaje('exito', `Inscrito en ${curso.nombre}.`);
  } catch (error) {
    mostrarErrorApi(error); // 400 otra carrera, 404 no existe, 409 ya inscrito
  } finally {
    cambiarEstadoBoton(botonInscribir, false);
  }
  // Tanto si funcionó como si no, se vuelve a leer el estado real de la base.
  if (estudianteActual && estudianteActual.id === id) await refrescarCursos();
}

// DELETE /estudiantes/:id/cursos/:cursoId previa confirmación (responde 204 sin cuerpo).
async function quitarCurso(curso, boton) {
  const { id, nombres, apellidos } = estudianteActual;
  if (!confirmar(`¿Quitar a ${nombres} ${apellidos} del curso ${curso.nombre}?`)) return;
  boton.disabled = true;
  try {
    await borrar(`/estudiantes/${id}/cursos/${curso.id}`);
    mostrarMensaje('exito', `Se quitó la inscripción en ${curso.nombre}.`);
  } catch (error) {
    mostrarErrorApi(error); // 404 si la inscripción ya no existía
  }
  if (estudianteActual && estudianteActual.id === id) await refrescarCursos();
}

// ===== Inicio =====

// Registra los eventos del panel; "funciones" conecta con estudiantes.js (lo arma main.js).
export function iniciarInscripciones(funciones) {
  avisos = { ...avisos, ...funciones };
  formInscribir.addEventListener('submit', inscribirCurso);
  document.getElementById('panel-cerrar').addEventListener('click', cerrarPanel);
  document.getElementById('panel-editar').addEventListener('click', () => avisos.alEditar(estudianteActual.id));
  selectAgregar.addEventListener('change', () => mostrarErrorCampo('panel-agregar', ''));
}
