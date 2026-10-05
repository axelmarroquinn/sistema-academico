// Sección "Estudiantes": tabla y formulario de crear/editar con carrera y varios cursos.
import { solicitar, enviar, borrar } from './api.js';
import {
  mostrarMensaje, mostrarErrorApi, mostrarEstadoTabla, crearCelda, crearBoton, crearCeldaAcciones,
  llenarSelectCarreras, mostrarErrorCampo, pintarErrores, detallesACampos, cambiarEstadoBoton,
  fechaHoy, confirmar,
} from './ui.js';

const formulario = document.getElementById('form-estudiante');
const tituloFormulario = document.getElementById('titulo-form-estudiante');
const botonGuardar = document.getElementById('est-guardar');
const botonCancelar = document.getElementById('est-cancelar');
const botonRecargar = document.getElementById('est-recargar');
const selectCarrera = document.getElementById('est-carrera');
const grupoCursos = document.getElementById('est-cursos');
const ayudaCursos = document.getElementById('ayuda-est-cursos');
const listaCursos = document.getElementById('lista-est-cursos');
const tabla = document.getElementById('tabla-estudiantes');
const COLUMNAS = 6;

// Campo de la API → id del elemento en el formulario.
const CAMPOS = {
  nombres: 'est-nombres',
  apellidos: 'est-apellidos',
  correo: 'est-correo',
  carnet: 'est-carnet',
  fecha_nacimiento: 'est-fecha',
  carrera_id: 'est-carrera',
  cursos: 'est-cursos',
};

// Id del estudiante en edición; null significa modo "crear".
let idEnEdicion = null;
// Carrera que tenía el estudiante al abrir la edición (para detectar el cambio de carrera).
let carreraOriginal = null;

// Funciones de inscripciones.js que asigna main.js (evita dependencias circulares).
let avisos = {
  alVerCursos: () => {},   // abre el panel de detalle del estudiante
  alGuardar: () => {},     // refresca el panel si muestra al estudiante editado
  alEliminar: () => {},    // cierra el panel si muestra al estudiante eliminado
};
// Número de la última carga de cursos; evita que una respuesta lenta pise a una más nueva.
let ultimaCargaCursos = 0;

// ===== Tabla =====

// Lista de cursos de un estudiante, uno por línea.
function crearListaCursos(cursos) {
  const lista = document.createElement('ul');
  lista.className = 'lista-cursos';
  cursos.forEach((curso) => {
    const item = document.createElement('li');
    item.textContent = `${curso.nombre} (${curso.codigo})`;
    lista.appendChild(item);
  });
  return lista;
}

// Contenido de la celda de cursos: la lista, o un texto si no tiene inscripciones.
function contenidoCursos(cursos) {
  return cursos.length > 0 ? crearListaCursos(cursos) : 'Sin cursos';
}

// Construye la fila de un estudiante con sus botones Ver / Cursos, Editar y Eliminar.
function crearFilaEstudiante(estudiante) {
  const fila = document.createElement('tr');
  fila.dataset.id = estudiante.id; // permite actualizar solo esta fila después
  const nombreCompleto = `${estudiante.nombres} ${estudiante.apellidos}`;
  fila.append(
    crearCelda(estudiante.carnet),
    crearCelda(nombreCompleto),
    crearCelda(estudiante.correo),
    crearCelda(estudiante.carrera_nombre),
    crearCelda(contenidoCursos(estudiante.cursos)),
    crearCeldaAcciones(
      crearBoton('Ver / Cursos', 'boton--secundario', `Ver datos y cursos de ${nombreCompleto}`, () => avisos.alVerCursos(estudiante.id)),
      crearBoton('Editar', 'boton--secundario', `Editar a ${nombreCompleto}`, () => iniciarEdicion(estudiante.id)),
      crearBoton('Eliminar', 'boton--peligro', `Eliminar a ${nombreCompleto}`, (boton) => eliminarEstudiante(estudiante, boton)),
    ),
  );
  return fila;
}

// Reemplaza solo la celda de cursos de la fila de un estudiante (la llama inscripciones.js).
export function actualizarCursosDeFila(id, cursos) {
  const fila = tabla.querySelector(`tr[data-id="${id}"]`);
  if (!fila) return;
  const celda = fila.cells[4];
  celda.replaceChildren();
  const contenido = contenidoCursos(cursos);
  if (contenido instanceof Node) celda.appendChild(contenido);
  else celda.textContent = contenido;
}

// GET /estudiantes: carga la lista y la dibuja en la tabla.
export async function cargarEstudiantes() {
  mostrarEstadoTabla(tabla, COLUMNAS, 'Cargando estudiantes…');
  botonRecargar.disabled = true;
  try {
    const estudiantes = await solicitar('/estudiantes');
    if (estudiantes.length === 0) mostrarEstadoTabla(tabla, COLUMNAS, 'No hay estudiantes registrados.');
    else tabla.replaceChildren(...estudiantes.map(crearFilaEstudiante));
  } catch (error) {
    mostrarEstadoTabla(tabla, COLUMNAS, 'No se pudo cargar la lista de estudiantes.');
    mostrarErrorApi(error);
  } finally {
    botonRecargar.disabled = false;
  }
}

// ===== Casillas de cursos =====

// Devuelve los IDs (números) de los cursos marcados.
function cursosMarcados() {
  return [...listaCursos.querySelectorAll('input:checked')].map((casilla) => Number(casilla.value));
}

// Cambia el texto de ayuda del grupo de cursos; con enlace, agrega un acceso a "Carreras y cursos".
function mostrarAyudaCursos(texto, conEnlace = false) {
  ayudaCursos.textContent = texto;
  if (conEnlace) {
    const enlace = document.createElement('a');
    enlace.href = '#carreras-cursos';
    enlace.textContent = 'Agregar cursos en "Carreras y cursos"';
    ayudaCursos.append(' ', enlace);
  }
}

// Crea una casilla con su label para un curso.
function crearCasilla(curso, marcada) {
  const id = `est-curso-${curso.id}`;
  const contenedor = document.createElement('div');
  contenedor.className = 'casilla';

  const casilla = document.createElement('input');
  casilla.type = 'checkbox';
  casilla.id = id;
  casilla.value = curso.id;
  casilla.checked = marcada;

  const etiqueta = document.createElement('label');
  etiqueta.htmlFor = id;
  etiqueta.textContent = `${curso.nombre} (${curso.codigo}) · ${curso.creditos} créditos`;

  contenedor.append(casilla, etiqueta);
  return contenedor;
}

// GET /cursos?carrera_id=N: dibuja las casillas de la carrera y marca los IDs indicados.
// Sin carrera, el grupo queda deshabilitado.
async function cargarCursosDeCarrera(carreraId, marcados = []) {
  const numeroCarga = ++ultimaCargaCursos;
  listaCursos.replaceChildren();
  grupoCursos.disabled = true;
  if (!carreraId) {
    mostrarAyudaCursos('Opcional: elija una carrera para ver sus cursos. También puede inscribirlo después con "Ver / Cursos" en el recuadro inferior.');
    return;
  }

  mostrarAyudaCursos('Cargando cursos…');
  try {
    const cursos = await solicitar(`/cursos?carrera_id=${encodeURIComponent(carreraId)}`);
    if (numeroCarga !== ultimaCargaCursos) return; // llegó tarde: ya se pidió otra carrera
    if (cursos.length === 0) {
      mostrarAyudaCursos('Esta carrera no tiene cursos registrados.', true);
      return;
    }
    listaCursos.replaceChildren(...cursos.map((curso) => crearCasilla(curso, marcados.includes(curso.id))));
    mostrarAyudaCursos('Opcional: marque los cursos en que se inscribirá.');
    grupoCursos.disabled = false;
  } catch (error) {
    if (numeroCarga !== ultimaCargaCursos) return;
    mostrarAyudaCursos('No se pudieron cargar los cursos de la carrera.');
    mostrarErrorApi(error);
  }
}

// Al cambiar la carrera:
// - al registrar, se limpian los cursos marcados (con aviso) y se cargan los de la nueva carrera;
// - al editar, no hay casillas: solo se avisa que al guardar se pedirá confirmar si tiene cursos.
function alCambiarCarrera() {
  mostrarErrorCampo(CAMPOS.carrera_id, '');
  mostrarErrorCampo(CAMPOS.cursos, '');
  if (idEnEdicion !== null) {
    if (selectCarrera.value && Number(selectCarrera.value) !== carreraOriginal) {
      mostrarMensaje('aviso', 'Si el estudiante tiene cursos inscritos, al guardar se le pedirá confirmar que se quiten.');
    }
    return;
  }
  if (cursosMarcados().length > 0) {
    mostrarMensaje('aviso', 'Cambió la carrera: se limpió la selección de cursos.');
  }
  cargarCursosDeCarrera(selectCarrera.value);
}

// Recibe la lista de carreras (desde carreras.js) y actualiza el select y las casillas,
// conservando la carrera y los cursos marcados si siguen existiendo.
export function actualizarCarreras(carreras) {
  const marcados = cursosMarcados();
  llenarSelectCarreras(selectCarrera, carreras, 'Seleccione una carrera');
  if (idEnEdicion === null) cargarCursosDeCarrera(selectCarrera.value, marcados);
}

// ===== Formulario =====

// Lee el formulario y arma el objeto que se envía a la API.
// Solo al registrar se envía "cursos"; al editar se omite para no tocar las inscripciones.
function leerFormulario() {
  const datos = {
    nombres: document.getElementById('est-nombres').value.trim(),
    apellidos: document.getElementById('est-apellidos').value.trim(),
    correo: document.getElementById('est-correo').value.trim(),
    carnet: document.getElementById('est-carnet').value.trim(),
    fecha_nacimiento: document.getElementById('est-fecha').value || null,
    carrera_id: selectCarrera.value ? Number(selectCarrera.value) : null,
  };
  if (idEnEdicion === null) datos.cursos = cursosMarcados();
  return datos;
}

// Valida en el cliente con las mismas reglas del backend; devuelve { campo: mensaje }.
// Los cursos son opcionales.
function validarFormulario(datos) {
  const errores = {};
  if (!datos.nombres) errores.nombres = 'Ingrese los nombres.';
  if (!datos.apellidos) errores.apellidos = 'Ingrese los apellidos.';
  if (!datos.correo) errores.correo = 'Ingrese el correo.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) errores.correo = 'Ingrese un correo válido, por ejemplo nombre@dominio.com.';
  if (!datos.carnet) errores.carnet = 'Ingrese el carnet.';
  if (datos.fecha_nacimiento && datos.fecha_nacimiento > fechaHoy()) {
    errores.fecha_nacimiento = 'La fecha de nacimiento no puede ser futura.';
  }
  if (!datos.carrera_id) errores.carrera_id = 'Seleccione una carrera.';
  return errores;
}

// Texto del botón Guardar según el modo.
function textoGuardar() {
  return idEnEdicion ? 'Guardar cambios' : 'Guardar';
}

// Deja el formulario vacío y en modo "crear" (con la sección de cursos visible).
function reiniciarFormulario() {
  formulario.reset();
  pintarErrores(CAMPOS, {});
  idEnEdicion = null;
  carreraOriginal = null;
  grupoCursos.hidden = false;
  tituloFormulario.textContent = 'Registrar estudiante';
  botonGuardar.textContent = textoGuardar();
  cargarCursosDeCarrera('');
}

// GET /estudiantes/:id: llena el formulario con los datos personales y la carrera.
// En modo edición la sección de cursos se oculta: las inscripciones se gestionan en "Ver / Cursos".
export async function iniciarEdicion(id) {
  try {
    const estudiante = await solicitar(`/estudiantes/${id}`);
    reiniciarFormulario();
    document.getElementById('est-nombres').value = estudiante.nombres;
    document.getElementById('est-apellidos').value = estudiante.apellidos;
    document.getElementById('est-correo').value = estudiante.correo;
    document.getElementById('est-carnet').value = estudiante.carnet;
    document.getElementById('est-fecha').value = estudiante.fecha_nacimiento || '';
    selectCarrera.value = String(estudiante.carrera_id);
    idEnEdicion = estudiante.id;
    carreraOriginal = estudiante.carrera_id;
    grupoCursos.hidden = true;
    tituloFormulario.textContent = `Editar datos: ${estudiante.nombres} ${estudiante.apellidos}`;
    botonGuardar.textContent = textoGuardar();
    formulario.scrollIntoView({ behavior: 'smooth' });
    document.getElementById('est-nombres').focus();
  } catch (error) {
    mostrarErrorApi(error);
    if (error.status === 404) cargarEstudiantes(); // el estudiante ya no existe: se actualiza la tabla
  }
}

// Regla de cambio de carrera al editar: si el estudiante tiene cursos inscritos, se pide
// confirmación y, si acepta, se envía cursos: [] para que la API quite las inscripciones
// en la misma transacción. Devuelve false si el usuario cancela.
async function confirmarCambioDeCarrera(datos) {
  if (datos.carrera_id === carreraOriginal) return true;
  const inscritos = await solicitar(`/estudiantes/${idEnEdicion}/cursos`); // estado actual, no el de la tabla
  if (inscritos.length === 0) return true;
  const nombres = inscritos.map((curso) => curso.nombre).join(', ');
  const acepta = confirmar(`El estudiante está inscrito en ${inscritos.length} curso(s) de su carrera actual (${nombres}). Al cambiar de carrera se quitarán esas inscripciones. ¿Continuar?`);
  if (acepta) datos.cursos = [];
  return acepta;
}

// POST /estudiantes o PUT /estudiantes/:id según el modo del formulario.
async function guardarEstudiante(evento) {
  evento.preventDefault();
  const datos = leerFormulario();
  const errores = validarFormulario(datos);
  pintarErrores(CAMPOS, errores);
  if (Object.keys(errores).length > 0) {
    mostrarMensaje('error', 'Revise los campos marcados en el formulario.');
    return;
  }

  const editando = idEnEdicion !== null;
  cambiarEstadoBoton(botonGuardar, true);
  botonCancelar.disabled = true;
  try {
    if (editando && !(await confirmarCambioDeCarrera(datos))) return; // canceló: no se envía nada
    const estudiante = editando
      ? await enviar(`/estudiantes/${idEnEdicion}`, 'PUT', datos)
      : await enviar('/estudiantes', 'POST', datos);
    reiniciarFormulario();
    const accion = editando ? 'actualizado' : 'registrado';
    mostrarMensaje('exito', `Estudiante ${estudiante.nombres} ${estudiante.apellidos} ${accion} con ${estudiante.cursos.length} curso(s).`);
    await cargarEstudiantes();
    if (editando) avisos.alGuardar(estudiante.id);
  } catch (error) {
    if (error.status === 400) {
      // Mensajes de la API que no empiezan con el nombre del campo
      const reglas = [[/curso/i, 'cursos'], [/carrera/i, 'carrera_id']];
      pintarErrores(CAMPOS, detallesACampos(error.detalles, Object.keys(CAMPOS), reglas));
    }
    mostrarErrorApi(error); // incluye el 409 de la regla de cambio de carrera
  } finally {
    cambiarEstadoBoton(botonGuardar, false);
    botonGuardar.textContent = textoGuardar();
    botonCancelar.disabled = false;
  }
}

// DELETE /estudiantes/:id previa confirmación.
async function eliminarEstudiante(estudiante, boton) {
  if (!confirmar(`¿Eliminar a ${estudiante.nombres} ${estudiante.apellidos} (carnet ${estudiante.carnet})?`)) return;
  boton.disabled = true;
  try {
    const respuesta = await borrar(`/estudiantes/${estudiante.id}`);
    if (idEnEdicion === estudiante.id) reiniciarFormulario(); // ya no se puede editar un registro borrado
    avisos.alEliminar(estudiante.id);
    mostrarMensaje('exito', respuesta.mensaje);
    await cargarEstudiantes();
  } catch (error) {
    boton.disabled = false;
    mostrarErrorApi(error);
    if (error.status === 404) cargarEstudiantes();
  }
}

// ===== Inicio =====

// Registra los eventos de la sección y carga la tabla; "funciones" conecta con inscripciones.js.
export function iniciarEstudiantes(funciones = {}) {
  avisos = { ...avisos, ...funciones };
  document.getElementById('est-fecha').max = fechaHoy();
  formulario.addEventListener('submit', guardarEstudiante);
  botonCancelar.addEventListener('click', reiniciarFormulario);
  botonRecargar.addEventListener('click', cargarEstudiantes);
  selectCarrera.addEventListener('change', alCambiarCarrera);
  cargarEstudiantes();
}
