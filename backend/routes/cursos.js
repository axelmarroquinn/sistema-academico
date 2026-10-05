const express = require('express');
const controlador = require('../controllers/cursosController');

const router = express.Router();

router.get('/', controlador.listar); // admite ?carrera_id=N
router.post('/', controlador.crear);
router.delete('/:id', controlador.eliminar);

module.exports = router;
