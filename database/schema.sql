-- Sistema Académico: esquema inicial para MySQL 8.0+
-- Ejecutar este archivo en una base de datos vacía.

CREATE DATABASE IF NOT EXISTS sistema_academico
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_0900_ai_ci;

USE sistema_academico;

CREATE TABLE IF NOT EXISTS carreras (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(120) NOT NULL,
  codigo VARCHAR(20) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_carreras_nombre (nombre),
  UNIQUE KEY uq_carreras_codigo (codigo)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS cursos (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  carrera_id INT UNSIGNED NOT NULL,
  nombre VARCHAR(150) NOT NULL,
  codigo VARCHAR(20) NOT NULL,
  creditos TINYINT UNSIGNED NOT NULL DEFAULT 3,
  PRIMARY KEY (id),
  UNIQUE KEY uq_cursos_codigo (codigo),
  UNIQUE KEY uq_cursos_carrera_nombre (carrera_id, nombre),
  CONSTRAINT chk_cursos_creditos CHECK (creditos BETWEEN 1 AND 30),
  CONSTRAINT fk_cursos_carreras FOREIGN KEY (carrera_id)
    REFERENCES carreras (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS estudiantes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  curso_id INT UNSIGNED NOT NULL,
  nombres VARCHAR(100) NOT NULL,
  apellidos VARCHAR(100) NOT NULL,
  correo VARCHAR(254) NOT NULL,
  carnet VARCHAR(30) NOT NULL,
  fecha_nacimiento DATE NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  actualizado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_estudiantes_correo (correo),
  UNIQUE KEY uq_estudiantes_carnet (carnet),
  KEY idx_estudiantes_curso_id (curso_id),
  CONSTRAINT fk_estudiantes_cursos FOREIGN KEY (curso_id)
    REFERENCES cursos (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB;

INSERT INTO carreras (nombre, codigo) VALUES
  ('Ingeniería en Sistemas', 'IS'),
  ('Administración de Empresas', 'AE'),
  ('Psicología', 'PS')
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre);

INSERT INTO cursos (carrera_id, nombre, codigo, creditos)
SELECT c.id, datos.nombre, datos.codigo, datos.creditos
FROM (
  SELECT 'IS' AS carrera_codigo, 'Desarrollo Web' AS nombre, 'IS-DW101' AS codigo, 4 AS creditos
  UNION ALL SELECT 'IS', 'Bases de Datos', 'IS-BD102', 4
  UNION ALL SELECT 'AE', 'Contabilidad General', 'AE-CG101', 3
  UNION ALL SELECT 'PS', 'Psicología General', 'PS-PG101', 3
) AS datos
JOIN carreras AS c ON c.codigo = datos.carrera_codigo
ON DUPLICATE KEY UPDATE nombre = VALUES(nombre), creditos = VALUES(creditos);

INSERT INTO estudiantes (curso_id, nombres, apellidos, correo, carnet, fecha_nacimiento)
SELECT c.id, datos.nombres, datos.apellidos, datos.correo, datos.carnet, datos.fecha_nacimiento
FROM (
  SELECT 'IS-DW101' AS curso_codigo, 'Ana María' AS nombres, 'López García' AS apellidos,
         'ana.lopez@example.com' AS correo, '2026-IS-001' AS carnet, '2004-03-15' AS fecha_nacimiento
  UNION ALL SELECT 'IS-BD102', 'Carlos', 'Méndez Ruiz', 'carlos.mendez@example.com', '2026-IS-002', '2003-11-02'
  UNION ALL SELECT 'AE-CG101', 'Lucía', 'Pérez Soto', 'lucia.perez@example.com', '2026-AE-001', '2005-07-21'
) AS datos
JOIN cursos AS c ON c.codigo = datos.curso_codigo
ON DUPLICATE KEY UPDATE nombres = VALUES(nombres), apellidos = VALUES(apellidos);
