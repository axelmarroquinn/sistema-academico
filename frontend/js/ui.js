// Utilidades de interfaz: mensajes, estados de carga, errores de campos y creación de elementos.
// Todo el contenido que viene de la API se inserta con textContent, nunca con innerHTML.

const contenedorMensajes = document.getElementById('mensajes');

// ===== Mensajes (toast) =====

// Muestra un mensaje; tipo: 'exito', 'error' o 'aviso'. Los detalles se listan debajo.
export function mostrarMensaje(tipo, texto, detalles = []) {
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

  // Los mensajes de éxito y aviso desaparecen solos; los de error quedan hasta cerrarlos.
  if (tipo !== 'error') {
    setTimeout(() => mensaje.remove(), 6000);
  }
}

// Muestra un ErrorApi con su mensaje, el código HTTP y los detalles.
export function mostrarErrorApi(error) {
  const status = error.status ? ` (HTTP ${error.status})` : '';
  mostrarMensaje('error', `${error.message}${status}`, error.detalles || []);
}

// ===== Tablas =====

// Reemplaza el contenido de un tbody por una sola fila con un texto (carga, vacío o error).
export function mostrarEstadoTabla(tbody, columnas, texto) {
  const fila = document.createElement('tr');
  const celda = document.createElement('td');
  celda.colSpan = columnas;
  celda.className = 'tabla__estado';
  celda.textContent = texto;
  fila.appendChild(celda);
  tbody.replaceChildren(fila);
}

// Crea una celda; acepta texto o un elemento ya construido.
export function crearCelda(contenido) {
  const celda = document.createElement('td');
  if (contenido instanceof Node) celda.appendChild(contenido);
  else celda.textContent = contenido;
  return celda;
}

// Crea un botón pequeño para una fila; etiqueta es el aria-label (incluye el nombre del registro).
export function crearBoton(texto, clase, etiqueta, alHacerClic) {
  const boton = document.createElement('button');
  boton.type = 'button';
  boton.className = `boton boton--pequeno ${clase}`;
  boton.textContent = texto;
  boton.setAttribute('aria-label', etiqueta);
  boton.addEventListener('click', () => alHacerClic(boton));
  return boton;
}

// Crea la celda de acciones con los botones indicados.
export function crearCeldaAcciones(...botones) {
  const contenedor = document.createElement('div');
  contenedor.className = 'tabla__acciones';
  contenedor.append(...botones);
  return crearCelda(contenedor);
}

// ===== Selects =====

// Crea una opción de un select.
export function crearOpcion(valor, texto) {
  const opcion = document.createElement('option');
  opcion.value = valor;
  opcion.textContent = texto;
  return opcion;
}

// Llena un select de carreras conservando la opción elegida si todavía existe.
export function llenarSelectCarreras(select, carreras, textoVacio) {
  const anterior = select.value;
  const opciones = carreras.map((carrera) => crearOpcion(carrera.id, `${carrera.nombre} (${carrera.codigo})`));
  select.replaceChildren(crearOpcion('', textoVacio), ...opciones);
  if (carreras.some((carrera) => String(carrera.id) === anterior)) select.value = anterior;
}

// ===== Errores junto a los campos =====

// Muestra (o limpia) el error de un campo. El elemento de error tiene id "error-<idCampo>".
export function mostrarErrorCampo(idCampo, mensaje) {
  const campo = document.getElementById(idCampo);
  document.getElementById(`error-${idCampo}`).textContent = mensaje || '';
  if (campo.tagName === 'FIELDSET') {
    campo.classList.toggle('grupo-cursos--error', Boolean(mensaje)); // aria-invalid no aplica a fieldset
  } else if (mensaje) {
    campo.setAttribute('aria-invalid', 'true');
  } else {
    campo.removeAttribute('aria-invalid');
  }
}

// Pinta los errores { campoApi: mensaje } usando el mapa { campoApi: idCampo } y enfoca el primero.
export function pintarErrores(mapaCampos, errores) {
  const campos = Object.keys(mapaCampos);
  campos.forEach((campo) => mostrarErrorCampo(mapaCampos[campo], errores[campo]));
  const primero = campos.find((campo) => errores[campo]);
  if (primero) enfocar(document.getElementById(mapaCampos[primero]));
}

// Pone el foco en un campo; en un fieldset, en su primera casilla habilitada.
function enfocar(elemento) {
  if (elemento.tagName === 'FIELDSET') {
    const casilla = elemento.querySelector('input:not(:disabled)');
    if (casilla) casilla.focus();
    return;
  }
  elemento.focus();
}

// Convierte los "detalles" de un 400 en { campo: mensaje } según el nombre del campo al inicio
// del texto (ej. "correo debe tener..."); "reglas" resuelve los mensajes que no empiezan así.
export function detallesACampos(detalles, campos, reglas = []) {
  const errores = {};
  detalles.forEach((detalle) => {
    let campo = campos.find((nombre) => detalle.startsWith(nombre));
    if (!campo) {
      const regla = reglas.find(([patron]) => patron.test(detalle));
      if (regla) campo = regla[1];
    }
    if (campo && !errores[campo]) errores[campo] = detalle;
  });
  return errores;
}

// ===== Otros =====

// Activa o desactiva el estado "enviando" de un botón, guardando su texto original.
export function cambiarEstadoBoton(boton, ocupado, textoOcupado = 'Guardando…') {
  if (ocupado) {
    boton.dataset.textoOriginal = boton.textContent;
    boton.textContent = textoOcupado;
  } else if (boton.dataset.textoOriginal) {
    boton.textContent = boton.dataset.textoOriginal;
  }
  boton.disabled = ocupado;
}

// Devuelve la fecha de hoy (hora local) en formato YYYY-MM-DD.
export function fechaHoy() {
  const hoy = new Date();
  const mes = String(hoy.getMonth() + 1).padStart(2, '0');
  const dia = String(hoy.getDate()).padStart(2, '0');
  return `${hoy.getFullYear()}-${mes}-${dia}`;
}

// Pide confirmación antes de una acción irreversible.
export function confirmar(texto) {
  return window.confirm(`${texto} Esta acción no se puede deshacer.`);
}
