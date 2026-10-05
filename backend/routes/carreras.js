const express = require('express');
const controlador = require('../controllers/carrerasController');

const router = express.Router();

router.get('/', controlador.listar);
router.post('/', controlador.crear);
router.delete('/:id', controlador.eliminar);

module.exports = router;
