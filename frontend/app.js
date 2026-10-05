// Única constante de configuración: dirección base de la API REST.
const API_URL = 'http://localhost:3000/api';

// Referencias a los elementos del DOM que se usan en varias funciones.
const formulario = document.getElementById('formulario');
const tituloFormulario = document.getElementById('titulo-formulario');
const botonGuardar = document.getElementById('boton-guardar');
const botonCancelar = document.getElementById('boton-cancelar');
const botonRecargar = document.getElementById('boton-recargar');
const selectCurso = document.getElementById('curso_id');
const cuerpoTabla = document.getElementById('cuerpo-tabla');
const contenedorMensajes = document.getElementById('mensajes');

// Campos del formulario; coinciden con los nombres que espera la API.
const CAMPOS = ['nombres', 'apellidos', 'correo', 'carnet', 'fecha_nacimiento', 'curso_id'];
const COLUMNAS_TABLA = 9;

// Id del estudiante en edición; null significa modo "crear".
let idEnEdicion = null;

// ===== Comunicación con la API =====

// Error con el código HTTP, el mensaje y los detalles que devuelve la API.
class ErrorApi extends Error {
  constructor(status, mensaje, detalles = []) {
    super(mensaje);
    this.status = status;
    this.detalles = detalles;
  }
}

// Hace una petición con fetch() y devuelve el JSON; si la API responde con error, lanza ErrorApi.
async function solicitar(ruta, opciones = {}) {
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

// ===== Mensajes (toast) =====

// Muestra un mensaje de éxito o error; los detalles se listan debajo del texto principal.
function mostrarMensaje(tipo, texto, detalles = []) {
  const mensaje = document.createElement('div');
  mensaje.className = `mensaje mensaje--${tipo}`;

  const cuerpo = document.createElement('div');
  cuerpo.className = 'mensaje__texto';
  const parrafo = document.createElement('p');
  parrafo.textContent = texto;
  cuerpo.appendChild(parrafo);

  if (detalles.length > 0) {
    const lista = document.createElement('ul');
    detalles.forEach((detalle) => {
      const item = document.createElement('li');
      item.textContent = detalle;
      lista.appendChild(item);
    });
    cuerpo.appendChild(lista);
  }

  const cerrar = document.createElement('button');
  cerrar.type = 'button';
  cerrar.className = 'mensaje__cerrar';
  cerrar.setAttribute('aria-label', 'Cerrar mensaje');
  cerrar.textContent = '×';
  cerrar.addEventListener('click', () => mensaje.remove());

  mensaje.append(cuerpo, cerrar);
  contenedorMensajes.replaceChildren(mensaje);

  // Los mensajes de éxito desaparecen solos; los de error quedan hasta cerrarlos.
  if (tipo === 'exito') {
    setTimeout(() => mensaje.remove(), 5000);
  }
}

// Muestra un ErrorApi con su mensaje y detalles.
function mostrarErrorApi(error) {
  const status = error.status ? ` (HTTP ${error.status})` : '';
  mostrarMensaje('error', `${error.message}${status}`, error.detalles || []);
}

// ===== Tabla de estudiantes =====

// Reemplaza el contenido de la tabla por una sola fila con un texto (carga, vacío o error).
function mostrarEstadoTabla(texto) {
  const fila = document.createElement('tr');
  const celda = document.createElement('td');
  celda.colSpan = COLUMNAS_TABLA;
  celda.className = 'tabla__estado';
  celda.textContent = texto;
  fila.appendChild(celda);
  cuerpoTabla.replaceChildren(fila);
}

// Crea una celda de texto; los datos se insertan con textContent para evitar inyección de HTML.
function crearCelda(texto) {
  const celda = document.createElement('td');
  celda.textContent = texto;
  return celda;
}

// Crea un botón de acción para una fila de la tabla.
function crearBoton(texto, clase, etiqueta, alHacerClic) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = `boton boton--pequeno ${clase}`;
  boton.textContent = texto;
  boton.setAttribute('aria-label', etiqueta);
  boton.addEventListener('click', () => alHacerClic(boton));
  return boton;
}

// Construye la fila de un estudiante con sus botones Editar y Eliminar.
function crearFilaEstudiante(estudiante) {
  const fila = document.createElement('tr');
  const nombreCompleto = `${estudiante.nombres} ${estudiante.apellidos}`;

  fila.append(
    crearCelda(estudiante.id),
    crearCelda(estudiante.nombres),
    crearCelda(estudiante.apellidos),
    crearCelda(estudiante.correo),
    crearCelda(estudiante.carnet),
    crearCelda(estudiante.fecha_nacimiento || '—'),
    crearCelda(`${estudiante.curso_nombre} (${estudiante.curso_codigo})`),
    crearCelda(estudiante.carrera_nombre),
  );

  const acciones = document.createElement('td');
  const contenedor = document.createElement('div');
  contenedor.className = 'tabla__acciones';
  contenedor.append(
    crearBoton('Editar', 'boton--secundario', `Editar a ${nombreCompleto}`, () => iniciarEdicion(estudiante.id)),
    crearBoton('Eliminar', 'boton--peligro', `Eliminar a ${nombreCompleto}`, (boton) => eliminarEstudiante(estudiante, boton)),
  );
  acciones.appendChild(contenedor);
  fila.appendChild(acciones);
  return fila;
}

// GET /estudiantes: carga la lista y la dibuja en la tabla.
async function cargarEstudiantes() {
  mostrarEstadoTabla('Cargando estudiantes…');
  botonRecargar.disabled = true;
  try {
    const estudiantes = await solicitar('/estudiantes');
    if (estudiantes.length === 0) {
      mostrarEstadoTabla('No hay estudiantes registrados.');
      return;
    }
    cuerpoTabla.replaceChildren(...estudiantes.map(crearFilaEstudiante));
  } catch (error) {
    mostrarEstadoTabla('No se pudo cargar la lista de estudiantes.');
    mostrarErrorApi(error);
  } finally {
    botonRecargar.disabled = false;
  }
}

// ===== Select de cursos =====

// Crea una opción del select con el texto indicado.
function crearOpcion(valor, texto) {
  const opcion = document.createElement('option');
  opcion.value = valor;
  opcion.textContent = texto;
  return opcion;
}

// GET /cursos: llena el select con "nombre (código)".
async function cargarCursos() {
  selectCurso.disabled = true;
  try {
    const cursos = await solicitar('/cursos');
    const opciones = cursos.map((curso) => crearOpcion(curso.id, `${curso.nombre} (${curso.codigo})`));
    selectCurso.replaceChildren(crearOpcion('', 'Seleccione un curso'), ...opciones);
  } catch (error) {
    selectCurso.replaceChildren(crearOpcion('', 'No se pudieron cargar los cursos'));
    mostrarErrorApi(error);
  } finally {
    selectCurso.disabled = false;
  }
}

// ===== Formulario =====

// Devuelve la fecha de hoy (hora local) en formato YYYY-MM-DD.
function fechaHoy() {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

// Lee el formulario y arma el objeto que se envía a la API (texto sin espacios sobrantes).
function leerFormulario() {
  return {
    nombres: formulario.nombres.value.trim(),
    apellidos: formulario.apellidos.value.trim(),
    correo: formulario.correo.value.trim(),
    carnet: formulario.carnet.value.trim(),
    curso_id: formulario.curso_id.value ? Number(formulario.curso_id.value) : null,
    fecha_nacimiento: formulario.fecha_nacimiento.value || null,
  };
}

// Valida en el cliente con las mismas reglas del backend; devuelve { campo: mensaje }.
function validarFormulario(datos) {
  const errores = {};
  if (!datos.nombres) errores.nombres = 'Ingrese los nombres.';
  if (!datos.apellidos) errores.apellidos = 'Ingrese los apellidos.';
  if (!datos.correo) errores.correo = 'Ingrese el correo.';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.correo)) errores.correo = 'Ingrese un correo válido, por ejemplo nombre@dominio.com.';
  if (!datos.carnet) errores.carnet = 'Ingrese el carnet.';
  if (!datos.curso_id) errores.curso_id = 'Seleccione un curso.';
  if (datos.fecha_nacimiento && datos.fecha_nacimiento > fechaHoy()) {
    errores.fecha_nacimiento = 'La fecha de nacimiento no puede ser futura.';
  }
  return errores;
}

// Muestra (o limpia) el error junto a un campo y marca el campo como inválido.
function mostrarErrorCampo(campo, mensaje) {
  const entrada = document.getElementById(campo);
  const contenedorError = document.getElementById(`error-${campo}`);
  contenedorError.textContent = mensaje || '';
  if (mensaje) entrada.setAttribute('aria-invalid', 'true');
  else entrada.removeAttribute('aria-invalid');
}

// Limpia los errores de todos los campos.
function limpiarErrores() {
  CAMPOS.forEach((campo) => mostrarErrorCampo(campo, ''));
}

// Pinta los errores de validación y pone el foco en el primer campo con error.
function mostrarErroresFormulario(errores) {
  limpiarErrores();
  const camposConError = CAMPOS.filter((campo) => errores[campo]);
  camposConError.forEach((campo) => mostrarErrorCampo(campo, errores[campo]));
  if (camposConError.length > 0) document.getElementById(camposConError[0]).focus();
}

// Asocia los "detalles" de un 400 de la API al campo que mencionan (ej. "correo debe tener...").
function detallesACampos(detalles) {
  const errores = {};
  detalles.forEach((detalle) => {
    const campo = CAMPOS.find((nombre) => detalle.startsWith(nombre));
    if (campo) errores[campo] = errores[campo] || detalle;
    else if (detalle.includes('curso')) errores.curso_id = detalle;
  });
  return errores;
}

// Activa o desactiva el estado "enviando" del formulario.
function cambiarEstadoEnvio(enviando) {
  botonGuardar.disabled = enviando;
  botonCancelar.disabled = enviando;
  botonGuardar.textContent = enviando ? 'Guardando…' : (idEnEdicion ? 'Guardar cambios' : 'Guardar');
}

// Deja el formulario vacío y en modo "crear".
function reiniciarFormulario() {
  formulario.reset();
  limpiarErrores();
  idEnEdicion = null;
  tituloFormulario.textContent = 'Registrar estudiante';
  botonGuardar.textContent = 'Guardar';
}

// Copia los datos de un estudiante en los campos del formulario.
function llenarFormulario(estudiante) {
  formulario.nombres.value = estudiante.nombres;
  formulario.apellidos.value = estudiante.apellidos;
  formulario.correo.value = estudiante.correo;
  formulario.carnet.value = estudiante.carnet;
  formulario.fecha_nacimiento.value = estudiante.fecha_nacimiento || '';
  formulario.curso_id.value = String(estudiante.curso_id);
}

// GET /estudiantes/:id: trae los datos actuales y pasa el formulario a modo edición.
async function iniciarEdicion(id) {
  try {
    const estudiante = await solicitar(`/estudiantes/${id}`);
    reiniciarFormulario();
    llenarFormulario(estudiante);
    idEnEdicion = estudiante.id;
    tituloFormulario.textContent = `Editar estudiante #${estudiante.id}`;
    botonGuardar.textContent = 'Guardar cambios';
    document.getElementById('seccion-formulario').scrollIntoView({ behavior: 'smooth' });
    formulario.nombres.focus();
  } catch (error) {
    mostrarErrorApi(error);
    if (error.status === 404) cargarEstudiantes(); // el estudiante ya no existe: se actualiza la tabla
  }
}

// POST /estudiantes o PUT /estudiantes/:id según el modo del formulario.
async function guardarEstudiante(evento) {
  evento.preventDefault();
  const datos = leerFormulario();
  const errores = validarFormulario(datos);
  if (Object.keys(errores).length > 0) {
    mostrarErroresFormulario(errores);
    mostrarMensaje('error', 'Revise los campos marcados en el formulario.');
    return;
  }

  limpiarErrores();
  const editando = idEnEdicion !== null;
  cambiarEstadoEnvio(true);
  try {
    const ruta = editando ? `/estudiantes/${idEnEdicion}` : '/estudiantes';
    const estudiante = await solicitar(ruta, {
      method: editando ? 'PUT' : 'POST',
      body: JSON.stringify(datos),
    });
    reiniciarFormulario();
    mostrarMensaje('exito', editando
      ? `Estudiante ${estudiante.nombres} ${estudiante.apellidos} actualizado correctamente.`
      : `Estudiante ${estudiante.nombres} ${estudiante.apellidos} registrado correctamente.`);
    await cargarEstudiantes();
  } catch (error) {
    if (error.status === 400 && error.detalles.length > 0) {
      mostrarErroresFormulario(detallesACampos(error.detalles));
    }
    mostrarErrorApi(error);
  } finally {
    cambiarEstadoEnvio(false);
  }
}

// DELETE /estudiantes/:id previa confirmación del usuario.
async function eliminarEstudiante(estudiante, boton) {
  const confirmado = window.confirm(
    `¿Eliminar a ${estudiante.nombres} ${estudiante.apellidos} (carnet ${estudiante.carnet})? Esta acción no se puede deshacer.`,
  );
  if (!confirmado) return;

  boton.disabled = true;
  try {
    const respuesta = await solicitar(`/estudiantes/${estudiante.id}`, { method: 'DELETE' });
    if (idEnEdicion === estudiante.id) reiniciarFormulario(); // ya no se puede editar un registro borrado
    mostrarMensaje('exito', respuesta.mensaje);
    await cargarEstudiantes();
  } catch (error) {
    boton.disabled = false;
    mostrarErrorApi(error);
    if (error.status === 404) cargarEstudiantes();
  }
}

// ===== Inicio =====

// Registra los eventos y carga los datos iniciales.
function iniciar() {
  formulario.fecha_nacimiento.max = fechaHoy();
  formulario.addEventListener('submit', guardarEstudiante);
  botonCancelar.addEventListener('click', reiniciarFormulario);
  botonRecargar.addEventListener('click', cargarEstudiantes);
  cargarCursos();
  cargarEstudiantes();
}

iniciar();
