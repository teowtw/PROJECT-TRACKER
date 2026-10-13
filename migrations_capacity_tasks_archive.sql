-- =====================================================
-- MIGRACIÓN: capacidad real por horas, tareas con varios
--            responsables, y archivado / papelera de proyectos
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente: se puede
-- pegar entera más de una vez sin romper nada.
--
-- Tres bloques independientes:
--   1. Archivado y papelera de proyectos  (projects)
--   2. Horas: jornada por persona, horas por tarea y reparto
--      entre responsables  (app_users, daily_comments, day_tasks)
--   3. Override manual de capacidad  (user_capacity_overrides)
--
-- Convenciones de schema.sql: RLS activada con política permisiva
-- "Allow all"; la app no usa Supabase Auth, usa su propio login JS
-- contra app_users. No la endurezcas aquí.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- 1. ARCHIVADO Y PAPELERA DE PROYECTOS
--
-- Borrado BLANDO a propósito. Todas las tablas hijas
-- (daily_comments, project_notes, project_capacities, ...) cuelgan de
-- projects con ON DELETE CASCADE, así que un DELETE real se llevaría
-- por delante todo el histórico del proyecto sin vuelta atrás. Con
-- deleted_at el proyecto desaparece de la interfaz pero sus datos
-- siguen intactos, y restaurarlo es poner la columna a NULL.
--
--   archived_at IS NOT NULL -> proyecto archivado (fuera del flujo
--                              de trabajo, pero consultable)
--   deleted_at  IS NOT NULL -> proyecto en la papelera
--
-- Un proyecto en la papelera se considera borrado aunque también
-- esté archivado: deleted_at manda.
-- =====================================================

ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_at timestamptz;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_at  timestamptz;

-- Quién lo archivó o lo tiró, para poder explicar en la interfaz
-- "archivado por TB el 13/10" sin tener que mirar logs.
ALTER TABLE projects ADD COLUMN IF NOT EXISTS archived_by text;
ALTER TABLE projects ADD COLUMN IF NOT EXISTS deleted_by  text;

-- Índices parciales: la consulta normal de la app es "dame los
-- proyectos vivos", que es la inmensa mayoría de las filas.
CREATE INDEX IF NOT EXISTS idx_projects_live
    ON projects (created_at) WHERE deleted_at IS NULL AND archived_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_projects_archived
    ON projects (archived_at) WHERE archived_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_projects_deleted
    ON projects (deleted_at) WHERE deleted_at IS NOT NULL;


-- =====================================================
-- 2. HORAS
-- =====================================================

-- 2a. Jornada semanal por persona. Es el denominador de todos los
-- porcentajes de capacidad. Por persona y no una constante porque
-- una media jornada o un contrato distinto no debería obligar a
-- tocar código. 168 = horas de una semana, tope de cordura.
ALTER TABLE app_users ADD COLUMN IF NOT EXISTS weekly_hours numeric NOT NULL DEFAULT 40;

ALTER TABLE app_users DROP CONSTRAINT IF EXISTS app_users_weekly_hours_check;
ALTER TABLE app_users ADD CONSTRAINT app_users_weekly_hours_check
    CHECK (weekly_hours > 0 AND weekly_hours <= 168);


-- 2b. daily_comments: de "un responsable" a "varios", más detalle y
-- horas estimadas.
--
-- Se CONSERVA la columna antigua `responsible` y la app la sigue
-- escribiendo con responsibles[1]. No es redundancia por pereza: la
-- columna es NOT NULL en algunas filas históricas y hay vistas y
-- consultas manuales del equipo que la usan. La fuente de verdad
-- para la app es `responsibles`.
--
-- hours_by_assignee: reparto explícito {"TB": 8, "JG": 2}. Si una
-- persona NO aparece en el jsonb, su parte es
-- estimated_hours / nº de responsables (reparto a partes iguales).
-- En cuanto alguien personaliza el reparto, la app escribe el jsonb
-- completo y pone estimated_hours a la suma, de modo que el total y
-- las partes nunca se contradicen.
ALTER TABLE daily_comments ADD COLUMN IF NOT EXISTS responsibles      text[] NOT NULL DEFAULT '{}';
ALTER TABLE daily_comments ADD COLUMN IF NOT EXISTS description       text DEFAULT '';
ALTER TABLE daily_comments ADD COLUMN IF NOT EXISTS estimated_hours   numeric NOT NULL DEFAULT 0;
ALTER TABLE daily_comments ADD COLUMN IF NOT EXISTS hours_by_assignee jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE daily_comments DROP CONSTRAINT IF EXISTS daily_comments_estimated_hours_check;
ALTER TABLE daily_comments ADD CONSTRAINT daily_comments_estimated_hours_check
    CHECK (estimated_hours >= 0 AND estimated_hours <= 1000);

-- Backfill: pasar el responsable único al array. Solo toca filas que
-- aún no tengan array, así que repetir la migración no duplica nada.
UPDATE daily_comments
   SET responsibles = ARRAY[upper(trim(responsible))]
 WHERE responsibles = '{}'::text[]
   AND responsible IS NOT NULL
   AND trim(responsible) <> '';

-- Índice GIN para "¿qué tiene asignado JG esta semana?"
-- (responsibles @> ARRAY['JG']) sin recorrer la tabla entera.
CREATE INDEX IF NOT EXISTS idx_daily_comments_responsibles
    ON daily_comments USING gin (responsibles);


-- 2c. day_tasks: las mismas tres columnas. Las tareas de día del
-- equipo también consumen horas de la semana, así que tienen que
-- entrar en el cálculo de capacidad igual que los daily_comments.
--
-- Red de seguridad: day_tasks la crea migrations_day_tasks.sql, pero
-- si esa migración no se ha pasado todavía, los ALTER de abajo fallan
-- con "relation day_tasks does not exist" y el editor de Supabase
-- aborta TODA la transacción, así que no se aplicaría nada de este
-- fichero. Se recrea aquí (idéntica, y con IF NOT EXISTS) para que
-- esta migración se pueda ejecutar sola y en cualquier orden.
-- Si ya existe, este bloque no hace nada.
CREATE TABLE IF NOT EXISTS day_tasks (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    task_date  date NOT NULL,
    text       text NOT NULL,
    project_id text REFERENCES projects(id) ON DELETE SET NULL,
    assignees  text[] NOT NULL DEFAULT '{}',
    created_by text,
    completed  boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE day_tasks ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on day_tasks" ON day_tasks;
CREATE POLICY "Allow all on day_tasks"
    ON day_tasks FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_day_tasks_date ON day_tasks (task_date);
CREATE INDEX IF NOT EXISTS idx_day_tasks_project ON day_tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_day_tasks_created_at ON day_tasks (created_at);
CREATE INDEX IF NOT EXISTS idx_day_tasks_assignees ON day_tasks USING gin (assignees);

ALTER TABLE day_tasks ADD COLUMN IF NOT EXISTS description       text DEFAULT '';
ALTER TABLE day_tasks ADD COLUMN IF NOT EXISTS estimated_hours   numeric NOT NULL DEFAULT 0;
ALTER TABLE day_tasks ADD COLUMN IF NOT EXISTS hours_by_assignee jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE day_tasks DROP CONSTRAINT IF EXISTS day_tasks_estimated_hours_check;
ALTER TABLE day_tasks ADD CONSTRAINT day_tasks_estimated_hours_check
    CHECK (estimated_hours >= 0 AND estimated_hours <= 1000);


-- =====================================================
-- 3. OVERRIDE MANUAL DE CAPACIDAD
--
-- La capacidad se calcula sola sumando las horas de las tareas, pero
-- hace falta una válvula de escape: formación, una baja, un proyecto
-- fuera de la herramienta... Si hay override para (persona, semana),
-- ese valor manda sobre el calculado y la interfaz lo marca.
--
-- Clave por (persona, semana) y NO por proyecto: el widget de
-- capacidad muestra la carga de la persona across todos los
-- proyectos, así que un override por proyecto no tendría sentido.
-- Esto es justo lo que diferencia esta tabla de project_capacities
-- (que era capacidad manual en % por proyecto, y queda obsoleta).
--
-- Se guarda en HORAS, no en %: las horas son la unidad real del
-- modelo y el % depende de app_users.weekly_hours, que puede cambiar.
-- La interfaz deja escribir en la unidad que esté mostrando y
-- convierte a horas antes de guardar.
-- =====================================================

CREATE TABLE IF NOT EXISTS user_capacity_overrides (
    user_initials  text NOT NULL,
    week_start     date NOT NULL,
    override_hours numeric NOT NULL CHECK (override_hours >= 0 AND override_hours <= 1000),
    note           text DEFAULT '',
    created_by     text,
    updated_at     timestamptz DEFAULT now(),
    PRIMARY KEY (user_initials, week_start)
);

ALTER TABLE user_capacity_overrides ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow all on user_capacity_overrides" ON user_capacity_overrides;
CREATE POLICY "Allow all on user_capacity_overrides"
    ON user_capacity_overrides FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_user_capacity_overrides_week
    ON user_capacity_overrides (week_start);


-- =====================================================
-- 4. REALTIME
-- La app se suscribe a estas tablas en app.js. Si la publicación no
-- las incluye, los cambios de otros usuarios no llegan hasta recargar.
-- =====================================================
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE user_capacity_overrides;
EXCEPTION
    WHEN duplicate_object THEN NULL;  -- ya estaba publicada
    WHEN undefined_object THEN NULL;  -- la publicación no existe aquí
END $$;

DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE app_users;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;

-- day_tasks también, por si la tabla se ha creado en el bloque 2c de
-- este fichero y no en migrations_day_tasks.sql.
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE day_tasks;
EXCEPTION
    WHEN duplicate_object THEN NULL;
    WHEN undefined_object THEN NULL;
END $$;


-- =====================================================
-- 5. COMPROBACIÓN (opcional)
--
-- Descomenta y ejecuta en una query APARTE después de la migración.
-- La primera debe devolver 12 filas; la segunda, dos valores no nulos.
-- =====================================================

-- SELECT table_name, column_name
--   FROM information_schema.columns
--  WHERE table_schema = 'public'
--    AND ( (table_name = 'projects'       AND column_name IN ('archived_at', 'deleted_at', 'archived_by', 'deleted_by'))
--       OR (table_name = 'app_users'      AND column_name IN ('weekly_hours'))
--       OR (table_name = 'daily_comments' AND column_name IN ('responsibles', 'description', 'estimated_hours', 'hours_by_assignee'))
--       OR (table_name = 'day_tasks'      AND column_name IN ('description', 'estimated_hours', 'hours_by_assignee')) )
--  ORDER BY table_name, column_name;

-- SELECT to_regclass('public.day_tasks')               AS day_tasks,
--        to_regclass('public.user_capacity_overrides') AS user_capacity_overrides;
