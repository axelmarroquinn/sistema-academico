const express = require('express');
const controlador = require('../controllers/estudiantesController');
const inscripciones = require('../controllers/inscripcionesController');

const router = express.Router();

router.get('/', controlador.listar);
router.get('/:id', controlador.obtener);
router.post('/', controlador.crear);
router.put('/:id', controlador.actualizar);
router.delete('/:id', controlador.eliminar);

// Inscripciones de un estudiante existente (sin reenviar sus datos personales)
router.get('/:id/cursos', inscripciones.listar);
router.post('/:id/cursos', inscripciones.inscribir);
router.delete('/:id/cursos/:cursoId', inscripciones.quitar);

module.exports = router;
