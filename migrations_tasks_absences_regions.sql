-- =====================================================
-- MIGRACIÓN: tipos de ausencia, "next year", región de festivos
--            por persona y vista Tasks (feedback octubre 2026)
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente: se puede
-- pegar entera más de una vez sin romper nada.
--
-- SOLO AÑADE. No borra filas, no borra columnas, no cambia tipos y
-- no estrecha ningún CHECK (los que se recrean son SUPERCONJUNTO del
-- anterior). Cada columna nueva lleva un DEFAULT que reproduce el
-- comportamiento de hoy, así que la versión de la app que está
-- publicada sigue funcionando igual después de pasar esto.
--
-- Orden: 0. copia de seguridad, 1. ausencias, 2. región de festivos,
--        3. tareas, 4. realtime, 5. comprobación.
--
-- Convenciones de schema.sql: RLS activada con política permisiva
-- "Allow all"; la app no usa Supabase Auth. No la endurezcas aquí.
-- =====================================================


-- =====================================================
-- 0. COPIA DE SEGURIDAD
-- Foto de las tres tablas que se tocan, en un esquema aparte. Solo
-- crea: no toca las tablas originales. IF NOT EXISTS hace que una
-- segunda ejecución NO sobrescriba la foto buena con datos ya
-- migrados.
-- =====================================================
CREATE SCHEMA IF NOT EXISTS backup_20261027;
CREATE TABLE IF NOT EXISTS backup_20261027.team_vacations AS TABLE public.team_vacations;
CREATE TABLE IF NOT EXISTS backup_20261027.day_tasks      AS TABLE public.day_tasks;
CREATE TABLE IF NOT EXISTS backup_20261027.app_users      AS TABLE public.app_users;


-- =====================================================
-- 1. AUSENCIAS (team_vacations)
--
-- Hoy toda fila de team_vacations es "vacaciones" y resta saldo.
-- Ahora una ausencia puede ser:
--   vacation    -> vacaciones (resta saldo, como hasta ahora)
--   sick_leave  -> baja laboral (NO resta saldo)
--   personal    -> asunto personal (NO resta saldo)
-- DEFAULT 'vacation': las filas existentes quedan exactamente como
-- estaban, y la app publicada (que no manda la columna) sigue
-- guardando vacaciones.
--
-- El motivo concreto solo lo ve el titular en la interfaz; el resto
-- ve "Absent". OJO: con RLS abierta es ocultación de interfaz, no
-- seguridad. Por eso NO se añade campo de texto libre: una baja no
-- debe llevar detalle médico en la base de datos.
-- =====================================================
ALTER TABLE team_vacations ADD COLUMN IF NOT EXISTS absence_type text NOT NULL DEFAULT 'vacation';

ALTER TABLE team_vacations DROP CONSTRAINT IF EXISTS team_vacations_absence_type_check;
ALTER TABLE team_vacations ADD CONSTRAINT team_vacations_absence_type_check
    CHECK (absence_type IN ('vacation', 'sick_leave', 'personal'));

-- vacation_type: se AMPLÍA (superconjunto del CHECK original).
--   next_year   -> vacaciones cargadas al saldo del año siguiente
--   not_charged -> ausencias que no son vacaciones (no cargan saldo)
-- Antes de pasar esto, la comprobación previa debe confirmar que no
-- existe ningún valor fuera de esta lista y el nombre real del
-- constraint (team_vacations_vacation_type_check es el que genera
-- Postgres para el CHECK inline de schema.sql).
ALTER TABLE team_vacations DROP CONSTRAINT IF EXISTS team_vacations_vacation_type_check;
ALTER TABLE team_vacations ADD CONSTRAINT team_vacations_vacation_type_check
    CHECK (vacation_type IN ('current_year', 'previous_year', 'next_year', 'willis_choice', 'not_charged'));


-- =====================================================
-- 2. REGIÓN DE FESTIVOS POR PERSONA (app_users)
--
-- Los festivos dependen de la comunidad y del municipio, no solo del
-- país (el 9-nov es festivo en Madrid ciudad, no en Alicante). NULL =
-- la app usa su tabla por defecto en código (MEMBER_REGION), así que
-- no hace falta rellenar nada para que funcione. Sin CHECK a
-- propósito: añadir una región nueva no debe exigir otra migración;
-- la app ignora códigos que no conoce y usa el de por defecto.
-- =====================================================
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS holiday_region text;


-- =====================================================
-- 3. TAREAS (day_tasks)
--
-- Se AMPLÍA day_tasks en vez de crear una tabla nueva: ya tiene
-- proyecto opcional, varios asignados, horas y descripción, y ya entra
-- en Daily y en el cálculo de capacidad. Una cuarta tabla de tareas
-- obligaría a duplicar toda esa lógica.
--
-- Valores guardados en español, etiquetas en inglés en la app, igual
-- que projects.priority / projects.impact.
-- =====================================================

-- Prioridad (Low/Medium/High/Critical). DEFAULT 'Media': las tareas de
-- hoy no tenían prioridad y se pintan como "medium".
ALTER TABLE day_tasks ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'Media';
ALTER TABLE day_tasks DROP CONSTRAINT IF EXISTS day_tasks_priority_check;
ALTER TABLE day_tasks ADD CONSTRAINT day_tasks_priority_check
    CHECK (priority IN ('Baja', 'Media', 'Alta', 'Crítica'));

-- Esfuerzo (Low/Medium/High). Opcional: NULL = sin indicar.
ALTER TABLE day_tasks ADD COLUMN IF NOT EXISTS effort text;
ALTER TABLE day_tasks DROP CONSTRAINT IF EXISTS day_tasks_effort_check;
ALTER TABLE day_tasks ADD CONSTRAINT day_tasks_effort_check
    CHECK (effort IS NULL OR effort IN ('Bajo', 'Medio', 'Alto'));

-- Hora opcional 'HH:MM' (texto, como daily_comments.time).
ALTER TABLE day_tasks ADD COLUMN IF NOT EXISTS task_time text;
ALTER TABLE day_tasks DROP CONSTRAINT IF EXISTS day_tasks_task_time_check;
ALTER TABLE day_tasks ADD CONSTRAINT day_tasks_task_time_check
    CHECK (task_time IS NULL OR task_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$');

-- Visibilidad en Daily:
--   team    -> la ve todo el equipo (comportamiento de hoy)
--   private -> solo creador y asignados
ALTER TABLE day_tasks ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'team';
ALTER TABLE day_tasks DROP CONSTRAINT IF EXISTS day_tasks_visibility_check;
ALTER TABLE day_tasks ADD CONSTRAINT day_tasks_visibility_check
    CHECK (visibility IN ('team', 'private'));

-- Fecha opcional: una tarea sin fecha vive solo en la vista Tasks y
-- no computa capacidad. Quitar un NOT NULL no toca ninguna fila.
ALTER TABLE day_tasks ALTER COLUMN task_date DROP NOT NULL;

-- "Mis tareas": se filtra por creador además de por asignados (GIN).
CREATE INDEX IF NOT EXISTS idx_day_tasks_created_by ON day_tasks (created_by);


-- =====================================================
-- 4. REALTIME
-- team_vacations no estaba publicada: las ausencias de otros no
-- llegaban hasta recargar. La app se suscribirá a ella.
-- =====================================================
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE team_vacations;
EXCEPTION
    WHEN duplicate_object THEN NULL;  -- ya estaba publicada
    WHEN undefined_object THEN NULL;  -- la publicación no existe aquí
END $$;


-- =====================================================
-- 5. COMPROBACIÓN (en una query APARTE, después de la migración)
--
-- a) Recuentos: deben ser IDÉNTICOS a los de antes y a la copia.
-- b) Columnas nuevas: debe devolver 7 filas.
-- c) Todo lo existente quedó como vacaciones / prioridad media / equipo.
-- =====================================================

-- SELECT 'team_vacations' t, (SELECT count(*) FROM team_vacations) live, (SELECT count(*) FROM backup_20261027.team_vacations) backup
-- UNION ALL SELECT 'day_tasks', (SELECT count(*) FROM day_tasks), (SELECT count(*) FROM backup_20261027.day_tasks)
-- UNION ALL SELECT 'app_users', (SELECT count(*) FROM app_users), (SELECT count(*) FROM backup_20261027.app_users);

-- SELECT table_name, column_name, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND ( (table_name = 'team_vacations' AND column_name = 'absence_type')
--       OR (table_name = 'app_users'      AND column_name = 'holiday_region')
--       OR (table_name = 'day_tasks'      AND column_name IN ('priority', 'effort', 'task_time', 'visibility', 'task_date')) )
--  ORDER BY table_name, column_name;

-- SELECT absence_type, vacation_type, count(*) FROM team_vacations GROUP BY 1, 2 ORDER BY 1, 2;
-- SELECT priority, visibility, count(*) FROM day_tasks GROUP BY 1, 2;
