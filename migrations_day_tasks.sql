-- =====================================================
-- MIGRACIÓN: day_tasks (tareas de día compartidas y asignables)
-- Ejecutar en el SQL Editor de Supabase. Es idempotente:
-- se puede pegar entero más de una vez sin romper nada.
--
-- Por qué una tabla nueva y no reutilizar las existentes:
--   - day_personal_tasks es PRIVADA por diseño (owner_initials
--     filtra en cliente y en el .eq() de cada update/delete), no
--     tiene proyecto ni asignados, así que no sirve para "aviso a
--     Jorge de que el jueves subo el flow a UAT".
--   - daily_comments exige project_id NOT NULL y solo admite UN
--     responsible (texto), no una lista.
-- day_tasks es el punto medio: visible para todo el equipo, con
-- fecha, lista de asignados y proyecto OPCIONAL.
--
-- Convenciones tomadas de schema.sql:
--   - id uuid con gen_random_uuid() generado por la base de datos
--     (el cliente no manda id en el insert).
--   - RLS activada con política permisiva "Allow all": la app no
--     usa Supabase Auth, usa su propio login JS contra app_users.
--     No la endurezcas aquí.
--   - assignees es text[] igual que projects.responsibles.
-- =====================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS day_tasks (
    id         uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    task_date  date NOT NULL,
    text       text NOT NULL,
    -- Proyecto OPCIONAL: hay tareas de día que no cuelgan de ningún
    -- proyecto. ON DELETE SET NULL (y no CASCADE) para que borrar un
    -- proyecto no borre el historial de tareas del equipo.
    project_id text REFERENCES projects(id) ON DELETE SET NULL,
    assignees  text[] NOT NULL DEFAULT '{}',
    created_by text,
    completed  boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE day_tasks ENABLE ROW LEVEL SECURITY;

-- CREATE POLICY no admite IF NOT EXISTS en todas las versiones de
-- Postgres que usa Supabase, así que se borra antes de crearla.
DROP POLICY IF EXISTS "Allow all on day_tasks" ON day_tasks;
CREATE POLICY "Allow all on day_tasks"
    ON day_tasks FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_day_tasks_date ON day_tasks (task_date);
CREATE INDEX IF NOT EXISTS idx_day_tasks_project ON day_tasks (project_id);
CREATE INDEX IF NOT EXISTS idx_day_tasks_created_at ON day_tasks (created_at);

-- Índice GIN para poder filtrar por asignado con el operador @>
-- (assignees @> ARRAY['JG']) sin escanear la tabla entera.
CREATE INDEX IF NOT EXISTS idx_day_tasks_assignees ON day_tasks USING gin (assignees);

-- =====================================================
-- Realtime: la app se suscribe a day_tasks en app.js
-- (lista de tablas al final del bloque de TIEMPO REAL).
-- Si la publicación supabase_realtime no incluye la tabla, los
-- cambios de otros usuarios no llegan solos hasta recargar.
-- =====================================================
DO $$
BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE day_tasks;
EXCEPTION
    WHEN duplicate_object THEN NULL;  -- ya estaba publicada
    WHEN undefined_object THEN NULL;  -- la publicación no existe en este proyecto
END $$;
