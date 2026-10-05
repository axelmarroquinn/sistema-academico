-- Sistema Académico: esquema y datos iniciales para MySQL 8.0+ o MariaDB 10.2+
--
-- ADVERTENCIA: este script BORRA las tablas inscripciones, estudiantes, cursos y
-- carreras, con todos sus datos, y las vuelve a crear con los datos iniciales.
-- Puede ejecutarse varias veces; cada ejecución deja la base en el estado inicial.
--
-- Modelo:
--   carreras 1 ── N cursos        (cada curso pertenece a una carrera)
--   carreras 1 ── N estudiantes   (cada estudiante pertenece a una carrera)
--   estudiantes N ── N cursos     (tabla intermedia inscripciones)
-- La regla "un estudiante solo se inscribe en cursos de su carrera" la valida la API.

CREATE DATABASE IF NOT EXISTS sistema_academico
  DEFAULT CHARACTER SET utf8mb4;

USE sistema_academico;

-- Se borran en orden inverso de dependencias (primero las tablas que tienen llaves foráneas).
DROP TABLE IF EXISTS inscripciones;
DROP TABLE IF EXISTS estudiantes;
DROP TABLE IF EXISTS cursos;
DROP TABLE IF EXISTS carreras;

CREATE TABLE carreras (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  nombre VARCHAR(120) NOT NULL,
  codigo VARCHAR(20) NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_carreras_nombre (nombre),
  UNIQUE KEY uq_carreras_codigo (codigo)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE cursos (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE estudiantes (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  carrera_id INT UNSIGNED NOT NULL,
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
  KEY idx_estudiantes_carrera_id (carrera_id),
  CONSTRAINT fk_estudiantes_carreras FOREIGN KEY (carrera_id)
    REFERENCES carreras (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Tabla intermedia de la relación muchos a muchos entre estudiantes y cursos.
-- La clave primaria compuesta impide inscribir dos veces al mismo estudiante en el mismo curso.
CREATE TABLE inscripciones (
  estudiante_id INT UNSIGNED NOT NULL,
  curso_id INT UNSIGNED NOT NULL,
  creado_en TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (estudiante_id, curso_id),
  KEY idx_inscripciones_curso_id (curso_id),
  -- Al borrar un estudiante se borran sus inscripciones.
  CONSTRAINT fk_inscripciones_estudiantes FOREIGN KEY (estudiante_id)
    REFERENCES estudiantes (id)
    ON UPDATE CASCADE
    ON DELETE CASCADE,
  -- No se puede borrar un curso que tenga estudiantes inscritos.
  CONSTRAINT fk_inscripciones_cursos FOREIGN KEY (curso_id)
    REFERENCES cursos (id)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- ===== Datos iniciales (IDs explícitos para que sean predecibles) =====

INSERT INTO carreras (id, nombre, codigo) VALUES
  (1, 'Ingeniería en Sistemas', 'IS'),
  (2, 'Administración de Empresas', 'AE'),
  (3, 'Psicología', 'PS');

-- Cursos 1-4: Sistemas; 5-8: Administración; 9-12: Psicología.
INSERT INTO cursos (id, carrera_id, nombre, codigo, creditos) VALUES
  (1, 1, 'Desarrollo Web', 'IS-DW101', 4),
  (2, 1, 'Bases de Datos', 'IS-BD102', 4),
  (3, 1, 'Programación I', 'IS-PR101', 5),
  (4, 1, 'Redes de Computadoras', 'IS-RC201', 4),
  (5, 2, 'Contabilidad General', 'AE-CG101', 3),
  (6, 2, 'Administración I', 'AE-AD101', 3),
  (7, 2, 'Microeconomía', 'AE-MI101', 3),
  (8, 2, 'Mercadotecnia', 'AE-MK201', 3),
  (9, 3, 'Psicología General', 'PS-PG101', 3),
  (10, 3, 'Psicología del Desarrollo', 'PS-PD101', 3),
  (11, 3, 'Estadística Aplicada', 'PS-EA201', 4),
  (12, 3, 'Neurociencias', 'PS-NC201', 4);

INSERT INTO estudiantes (id, carrera_id, nombres, apellidos, correo, carnet, fecha_nacimiento) VALUES
  (1, 1, 'Ana María', 'López García', 'ana.lopez@example.com', '2026-IS-001', '2004-03-15'),
  (2, 1, 'Carlos', 'Méndez Ruiz', 'carlos.mendez@example.com', '2026-IS-002', '2003-11-02'),
  (3, 2, 'Lucía', 'Pérez Soto', 'lucia.perez@example.com', '2026-AE-001', '2005-07-21'),
  (4, 2, 'José', 'Ramírez Castillo', 'jose.ramirez@example.com', '2026-AE-002', '2004-09-10'),
  (5, 3, 'Sofía', 'Hernández Morales', 'sofia.hernandez@example.com', '2026-PS-001', '2005-01-30'),
  (6, 3, 'Diego', 'Juárez Pineda', 'diego.juarez@example.com', '2026-PS-002', NULL);

-- Cada estudiante está inscrito en cursos de su propia carrera.
INSERT INTO inscripciones (estudiante_id, curso_id) VALUES
  (1, 1), (1, 2), (1, 3),
  (2, 2), (2, 4),
  (3, 5), (3, 6),
  (4, 5), (4, 7), (4, 8),
  (5, 9), (5, 10), (5, 11),
  (6, 9), (6, 12);
