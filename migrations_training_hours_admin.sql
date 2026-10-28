-- =====================================================
-- MIGRACIÓN: fase Training, tareas de training, savings en horas,
--            savings FTE estimados/reales, más estados de proyecto
--            y gestión de usuarios por admins (noviembre 2026)
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente: se puede
-- pegar entera más de una vez sin romper nada.
--
-- SOLO AÑADE. No borra filas, no borra columnas, no cambia tipos y
-- no estrecha ningún CHECK (el de projects.phase se recrea como
-- SUPERCONJUNTO del anterior). Cada columna nueva lleva un DEFAULT que
-- reproduce el comportamiento de hoy, así que la versión de la app que
-- está publicada sigue funcionando igual después de pasar esto.
--
-- Orden: 0. copia de seguridad, 1. fase Training, 1b. estados de
--        proyecto, 2. savings en horas, 2b. FTE reales, 3. tipo de
--        tarea, 4. directorio de usuarios, 5. datos de partida,
--        6. realtime, 7. comprobación.
--
-- Estado de producción comprobado el 28-oct-2026 (consultas de la
-- Fase 0 del plan): projects 46, app_users 5, daily_comments 92,
-- day_tasks 3, day_personal_tasks 0, team_vacations 52,
-- user_capacity_overrides 0, project_notes 15, project_statuses 1,
-- project_weekly_tasks 20, project_incidents 1. Ningún proyecto tiene
-- savings en € (volume > 0: 0 filas). Todas las iniciales usadas en
-- datos están en app_users. Ninguna columna nueva existía ya.
--
-- Convenciones de schema.sql: RLS activada con política permisiva
-- "Allow all"; la app no usa Supabase Auth. No la endurezcas aquí.
-- =====================================================


-- =====================================================
-- 0. COPIA DE SEGURIDAD
-- Foto de las cuatro tablas que se tocan, en un esquema aparte. Solo
-- crea: no toca las tablas originales. IF NOT EXISTS hace que una
-- segunda ejecución NO sobrescriba la foto buena con datos ya
-- migrados.
-- =====================================================
CREATE SCHEMA IF NOT EXISTS backup_20261028;
CREATE TABLE IF NOT EXISTS backup_20261028.projects       AS TABLE public.projects;
CREATE TABLE IF NOT EXISTS backup_20261028.app_users      AS TABLE public.app_users;
CREATE TABLE IF NOT EXISTS backup_20261028.day_tasks      AS TABLE public.day_tasks;
CREATE TABLE IF NOT EXISTS backup_20261028.daily_comments AS TABLE public.daily_comments;


-- =====================================================
-- 1. FASE TRAINING (projects.phase)
--
-- Cada persona puede tener un proyecto "<Nombre>'s Training" donde
-- registra sus formaciones como tareas con horas. Se AMPLÍA el CHECK:
-- es la lista de migrations_description_country_priority.sql más
-- 'Training'. Comprobado: el CHECK vivo es exactamente la lista de 11
-- fases y las fases en uso (BAU, Completed, Development, Discovery,
-- On Hold, Production, Testing) están todas dentro.
-- =====================================================
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_phase_check;
ALTER TABLE projects ADD CONSTRAINT projects_phase_check
    CHECK (phase IN ('Discovery', 'Design', 'Development', 'Testing', 'Pilot', 'Production',
                     'Hypercare', 'BAU', 'Completed', 'Cancelled', 'On Hold', 'Training'));


-- =====================================================
-- 1b. ESTADOS DE PROYECTO (projects.status)
--
-- Hoy: Verde (On Track), Ámbar (At Risk), Rojo (Blocked). Se AMPLÍA
-- con estados que no son de "salud" sino de situación:
--   En pausa   -> On Hold
--   Cancelado  -> Cancelled
--   Completado -> Done
-- Valores en español, como los existentes; las etiquetas en inglés las
-- pone la app. Superconjunto del CHECK vivo projects_status_check.
-- =====================================================
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_status_check;
ALTER TABLE projects ADD CONSTRAINT projects_status_check
    CHECK (status IN ('Verde', 'Ámbar', 'Rojo', 'En pausa', 'Cancelado', 'Completado'));


-- =====================================================
-- 2. SAVINGS EN HORAS (projects.savings_hours)
--
-- Horas ahorradas AL AÑO. Sustituye en la interfaz a los savings en €
-- (columna volume), que NO se borra ni se convierte: no hay un tipo
-- €/hora fiable, y los valores antiguos se siguen enseñando en la
-- ficha como "legacy" mientras nadie rellene las horas.
-- NULL = sin indicar (distinto de 0 horas).
-- =====================================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS savings_hours numeric;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_savings_hours_check;
ALTER TABLE projects ADD CONSTRAINT projects_savings_hours_check
    CHECK (savings_hours IS NULL OR savings_hours >= 0);


-- =====================================================
-- 2b. SAVINGS FTE REALES (projects.real_fte)
--
-- La columna fte pasa a ser el ahorro ESTIMADO (no cambia nada en los
-- datos, solo la etiqueta en la app). real_fte es el ahorro real
-- medido tras la puesta en producción. NULL = aún sin medir.
-- =====================================================
ALTER TABLE projects ADD COLUMN IF NOT EXISTS real_fte numeric;
ALTER TABLE projects DROP CONSTRAINT IF EXISTS projects_real_fte_check;
ALTER TABLE projects ADD CONSTRAINT projects_real_fte_check
    CHECK (real_fte IS NULL OR real_fte >= 0);


-- =====================================================
-- 3. TIPO DE TAREA (daily_comments.task_type, day_tasks.task_type)
--
--   standard -> tarea normal (todo lo que existe hoy)
--   training -> formación: se pinta en verde en Daily y Tasks
-- Las dos tablas son las que computan horas; las tareas personales
-- (day_personal_tasks) no llevan tipo.
-- =====================================================
ALTER TABLE daily_comments ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'standard';
ALTER TABLE daily_comments DROP CONSTRAINT IF EXISTS daily_comments_task_type_check;
ALTER TABLE daily_comments ADD CONSTRAINT daily_comments_task_type_check
    CHECK (task_type IN ('standard', 'training'));

ALTER TABLE day_tasks ADD COLUMN IF NOT EXISTS task_type text NOT NULL DEFAULT 'standard';
ALTER TABLE day_tasks DROP CONSTRAINT IF EXISTS day_tasks_task_type_check;
ALTER TABLE day_tasks ADD CONSTRAINT day_tasks_task_type_check
    CHECK (task_type IN ('standard', 'training'));


-- =====================================================
-- 4. DIRECTORIO DE USUARIOS (app_users)
--
-- is_admin  -> ve la pestaña Admin (crear / dar de baja usuarios).
--              OJO: con RLS abierta es control de interfaz, no
--              seguridad.
-- is_active -> "borrar" un usuario es ponerlo a false: deja de poder
--              entrar y de aparecer en los selectores, pero su trabajo
--              (proyectos, tareas, horas, ausencias) se conserva y se
--              sigue viendo, en gris. NUNCA se hace DELETE para dar de
--              baja.
-- first_name / last_name -> nombre para mostrar y para generar las
--              iniciales de las altas.
-- =====================================================
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS first_name     text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS last_name      text;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_admin       boolean NOT NULL DEFAULT false;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS is_active      boolean NOT NULL DEFAULT true;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS deactivated_at timestamptz;
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS deactivated_by text;


-- =====================================================
-- 5. DATOS DE PARTIDA
-- UPDATE con WHERE estrecho: solo filas concretas y solo si siguen
-- vacías, para que una segunda ejecución no pise cambios hechos
-- después desde la app.
-- =====================================================
UPDATE app_users SET is_admin = true WHERE initials IN ('TB', 'AR') AND is_admin = false;

UPDATE app_users SET first_name = 'Teo',   last_name = 'Balsalobre' WHERE initials = 'TB' AND first_name IS NULL;
UPDATE app_users SET first_name = 'Ana',   last_name = 'Real'       WHERE initials = 'AR' AND first_name IS NULL;
UPDATE app_users SET first_name = 'Jorge', last_name = 'Gazulla'    WHERE initials = 'JG' AND first_name IS NULL;
UPDATE app_users SET first_name = 'Inês',  last_name = 'Marcelino'  WHERE initials = 'IM' AND first_name IS NULL;
UPDATE app_users SET first_name = 'Abha',  last_name = 'Dungdung'   WHERE initials = 'AD' AND first_name IS NULL;


-- =====================================================
-- 6. REALTIME
-- app_users debe estar publicada para que un alta o una baja hecha por
-- un admin llegue a los demás sin recargar. Comprobado: ya lo está
-- (junto con day_tasks, team_vacations y user_capacity_overrides); el
-- bloque se deja por idempotencia, no hace nada.
-- =====================================================
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE app_users;
EXCEPTION
    WHEN duplicate_object THEN NULL;  -- ya estaba publicada
    WHEN undefined_object THEN NULL;  -- la publicación no existe aquí
END $$;


-- =====================================================
-- 7. COMPROBACIÓN (en una query APARTE, después de la migración)
--
-- a) Recuentos: deben ser IDÉNTICOS a los de antes y a la copia.
-- b) Columnas nuevas: debe devolver 10 filas.
-- c) Todo lo existente quedó como standard / activo; TB y AR admins.
-- d) Los CHECK de phase y status ampliados.
-- =====================================================

-- SELECT 'projects' t, (SELECT count(*) FROM projects) live, (SELECT count(*) FROM backup_20261028.projects) backup
-- UNION ALL SELECT 'app_users', (SELECT count(*) FROM app_users), (SELECT count(*) FROM backup_20261028.app_users)
-- UNION ALL SELECT 'day_tasks', (SELECT count(*) FROM day_tasks), (SELECT count(*) FROM backup_20261028.day_tasks)
-- UNION ALL SELECT 'daily_comments', (SELECT count(*) FROM daily_comments), (SELECT count(*) FROM backup_20261028.daily_comments);

-- SELECT table_name, column_name, data_type, is_nullable, column_default
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND ( (table_name = 'projects'       AND column_name IN ('savings_hours', 'real_fte'))
--       OR (table_name = 'daily_comments' AND column_name = 'task_type')
--       OR (table_name = 'day_tasks'      AND column_name = 'task_type')
--       OR (table_name = 'app_users'      AND column_name IN ('first_name', 'last_name', 'is_admin', 'is_active', 'deactivated_at', 'deactivated_by')) )
--  ORDER BY table_name, column_name;

-- SELECT initials, first_name, last_name, is_admin, is_active FROM app_users ORDER BY initials;
-- SELECT 'daily_comments' t, task_type, count(*) FROM daily_comments GROUP BY 2
-- UNION ALL SELECT 'day_tasks', task_type, count(*) FROM day_tasks GROUP BY 2;

-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint
--  WHERE conname IN ('projects_phase_check', 'projects_status_check');
