require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express = require('express');
const cors = require('cors');
const pool = require('./db');
const estudiantesRoutes = require('./routes/estudiantes');
const cursosRoutes = require('./routes/cursos');
const carrerasRoutes = require('./routes/carreras');

const app = express();
const PORT = Number(process.env.PORT || 3000);
const origenesPermitidos = (process.env.CORS_ORIGIN || 'http://localhost:5500,http://127.0.0.1:5500')
  .split(',')
  .map((origen) => origen.trim())
  .filter(Boolean);

app.disable('x-powered-by');
app.use(cors({ origin: origenesPermitidos }));
app.use(express.json({ limit: '20kb' }));

// Comprueba MySQL y responde 200 o 500 según el estado de la conexión.
app.get('/api/health', async (_req, res) => {
  try {
    await pool.query('SELECT 1');
    return res.status(200).json({ status: 'ok', database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error.message);
    return res.status(500).json({ error: 'No se pudo conectar con la base de datos.' });
  }
});

app.use('/api/estudiantes', estudiantesRoutes);
app.use('/api/cursos', cursosRoutes);
app.use('/api/carreras', carrerasRoutes);

// Responde 404 en español para cualquier ruta no registrada.
app.use((_req, res) => res.status(404).json({ error: 'Ruta no encontrada.' }));

// Convierte errores del parser JSON a 400 y oculta los detalles internos con 500.
app.use((error, _req, res, _next) => {
  if (error.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'El cuerpo de la solicitud debe contener JSON válido.' });
  }
  if (error.type === 'entity.too.large') {
    return res.status(400).json({ error: 'El cuerpo de la solicitud excede el tamaño permitido.' });
  }
  console.error('Unhandled server error:', error);
  return res.status(500).json({ error: 'Error interno del servidor.' });
});

async function iniciarServidor() {
  try {
    await pool.query('SELECT 1');
  } catch (error) {
    console.error('No se pudo conectar con MySQL. Revise el servicio y las variables DB_* del archivo backend/.env.');
    console.error(error.message);
    process.exit(1);
    return;
  }

  const server = app.listen(PORT, () => {
    console.log(`API disponible en http://localhost:${PORT}`);
  });

  async function cerrarServidor(signal) {
    console.log(`${signal}: cerrando servidor...`);
    try {
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    } catch (error) {
      console.error('Error al cerrar el servidor:', error.message);
    } finally {
      try {
        await pool.end();
      } finally {
        process.exit(0);
      }
    }
  }

  process.once('SIGINT', () => cerrarServidor('SIGINT'));
  process.once('SIGTERM', () => cerrarServidor('SIGTERM'));
}

iniciarServidor();

module.exports = app;
