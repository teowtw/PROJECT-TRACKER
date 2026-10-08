-- =====================================================
-- MIGRACIÓN: Description, Country, Critical priority, phase cleanup
-- Ejecutar en Supabase SQL Editor
--
-- (Si ya pegaste una versión anterior de este script y falló con
-- "violates check constraint projects_phase_check", no pasa nada:
-- el error aborta la transacción completa, no se aplicó nada a medias.
-- Pega este archivo entero de nuevo, de arriba a abajo.)
-- =====================================================

-- Nuevas columnas
ALTER TABLE projects ADD COLUMN IF NOT EXISTS description text DEFAULT '';
ALTER TABLE projects ADD COLUMN IF NOT EXISTS country text DEFAULT '';

-- Priority: añadir nivel "Crítica" (ningún dato existente usa este valor
-- todavía, así que no hace falta tocar filas antes de endurecer el check)
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_priority_check;
ALTER TABLE projects ADD CONSTRAINT projects_priority_check
    CHECK (priority IN ('Baja', 'Media', 'Alta', 'Crítica'));

-- Phase: hay que quitar el constraint ANTES de normalizar los valores
-- heredados, porque el constraint antiguo solo permite el vocabulario
-- viejo (Idea/En Progreso/Cerrado/Mantenimiento/...) y rechazaría el
-- UPDATE a los nombres nuevos (Discovery/Development/Completed/BAU).
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_phase_check;

UPDATE projects SET phase = 'Discovery'   WHERE phase = 'Idea';
UPDATE projects SET phase = 'Development' WHERE phase = 'En Progreso';
UPDATE projects SET phase = 'Completed'   WHERE phase = 'Cerrado';
UPDATE projects SET phase = 'BAU'         WHERE phase = 'Mantenimiento';

ALTER TABLE projects ALTER COLUMN phase SET DEFAULT 'Discovery';
ALTER TABLE projects ADD CONSTRAINT projects_phase_check
    CHECK (phase IN ('Discovery', 'Design', 'Development', 'Testing', 'Pilot', 'Production', 'Hypercare', 'BAU', 'Completed', 'Cancelled', 'On Hold'));
