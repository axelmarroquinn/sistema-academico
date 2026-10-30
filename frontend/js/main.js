// Punto de entrada: navegación entre secciones e inicio de los módulos.
import {
  iniciarEstudiantes, actualizarCarreras, actualizarCursosDeFila, iniciarEdicion, cargarEstudiantes,
} from './estudiantes.js';
import { iniciarCarreras, cargarCarreras, cargarCursos } from './carreras.js';
import {
  iniciarInscripciones, abrirPanel, refrescarPanel, cerrarPanelSi,
} from './inscripciones.js';

const VISTA_INICIAL = 'estudiantes';
const vistas = document.querySelectorAll('.vista');
const enlaces = document.querySelectorAll('.menu a[data-vista]');

// Devuelve el nombre de la vista indicada en la URL (#estudiantes o #carreras-cursos), o null.
function vistaDesdeUrl() {
  const nombre = window.location.hash.slice(1);
  return [...vistas].some((vista) => vista.dataset.vista === nombre) ? nombre : null;
}

// Muestra una vista y oculta la otra sin recargar la página; marca el enlace activo.
function mostrarVista(nombre, moverFoco) {
  vistas.forEach((vista) => { vista.hidden = vista.dataset.vista !== nombre; });
  enlaces.forEach((enlace) => {
    if (enlace.dataset.vista === nombre) enlace.setAttribute('aria-current', 'page');
    else enlace.removeAttribute('aria-current');
  });
  // Al navegar, el foco pasa al título de la vista para que el lector de pantalla la anuncie.
  if (moverFoco) document.querySelector(`.vista[data-vista="${nombre}"] .vista__titulo`).focus();
}

// Cambia de vista cuando cambia el hash (enlaces del menú o del aviso "sin cursos").
// Otros hash, como #contenido del enlace "Saltar al contenido", no cambian la vista.
function alCambiarHash() {
  const nombre = vistaDesdeUrl();
  if (nombre) mostrarVista(nombre, true);
}

// Inicia la aplicación.
function iniciar() {
  mostrarVista(vistaDesdeUrl() || VISTA_INICIAL, false);
  window.addEventListener('hashchange', alCambiarHash);

  // Cada vez que carreras.js recarga las carreras (al crear o borrar carreras y cursos), la sección
  // Estudiantes actualiza su select y casillas, y el panel de detalle su lista "Agregar curso".
  iniciarCarreras((carreras) => {
    actualizarCarreras(carreras);
    refrescarPanel();
  });

  // Conexión entre la tabla de estudiantes y el panel de inscripciones (sin importarse entre sí).
  iniciarEstudiantes({
    alVerCursos: (id) => abrirPanel(id),
    alGuardar: (id) => refrescarPanel(id),
    alEliminar: (id) => cerrarPanelSi(id),
  });
  iniciarInscripciones({
    alEditar: (id) => iniciarEdicion(id),
    alCambiarCursos: (id, cursos) => actualizarCursosDeFila(id, cursos),
    alNoExistir: () => cargarEstudiantes(),
  });

  cargarCarreras();
  cargarCursos();
}

iniciar();

/* LÓGICA DEL PANEL LATERAL IZQUIERDO Y MODO OSCURO */

(() => {
    const btnAbrir = document.getElementById('btn-abrir-sidebar');
    const btnCerrar = document.getElementById('btn-cerrar-sidebar');
    const sidebar = document.getElementById('sidebar-panel');
    const overlay = document.getElementById('sidebar-overlay');
    const toggleDark = document.getElementById('toggle-dark-mode');
    const themeLabel = document.getElementById('theme-label-text');

    const abrirSidebar = () => {
        sidebar?.classList.add('activo');
        overlay?.classList.add('activo');
    };

    const cerrarSidebar = () => {
        sidebar?.classList.remove('activo');
        overlay?.classList.remove('activo');
    };

    btnAbrir?.addEventListener('click', abrirSidebar);
    btnCerrar?.addEventListener('click', cerrarSidebar);
    overlay?.addEventListener('click', cerrarSidebar);

    // Cerrar con tecla Escape
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') cerrarSidebar();
    });

    // Aplicar y guardar preferencia de Modo Oscuro en localStorage
    const aplicarTema = (esOscuro) => {
        document.body.classList.toggle('dark-mode', esOscuro);
        if (toggleDark) toggleDark.checked = esOscuro;
        if (themeLabel) {
            themeLabel.textContent = esOscuro ? '☀️ Modo Oscuro (Activo)' : '🌙 Modo Oscuro';
        }
        localStorage.setItem('umg_tema_oscuro', esOscuro ? '1' : '0');
    };

    // Restaurar al cargar la página
    const guardado = localStorage.getItem('umg_tema_oscuro') === '1';
    aplicarTema(guardado);

    toggleDark?.addEventListener('change', (e) => {
        aplicarTema(e.target.checked);
    });
})();