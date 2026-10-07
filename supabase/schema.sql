-- =====================================================
-- SCHEMA COMPLETO — PROD Gestor de Proyectos
-- Ejecutar una sola vez en el SQL Editor del proyecto
-- Supabase NUEVO (vacío), antes de seed.sql.
--
-- Estilo y convenciones tomados de migrations_weekly_incidents.sql:
--   - PKs uuid con gen_random_uuid(), salvo donde el código JS
--     genera y envía su propio id de texto (ver abajo).
--   - projects.id es TEXT (no uuid): el código a veces lo genera
--     en el cliente con generateId() = Date.now()+random, y a veces
--     lo deja que lo genere la base de datos (saveNewProject() no
--     manda id). Por eso projects.id es text con DEFAULT que genera
--     un identificador aleatorio en forma de texto.
--   - RLS activada con política permisiva "Allow all ... USING
--     (true) WITH CHECK (true)" en todas las tablas: la app no usa
--     Supabase Auth, usa su propio login JS contra app_users, así
--     que la seguridad a nivel de Postgres se deja abierta a
--     propósito. No la endurezcas aquí.
-- =====================================================

-- Necesario para gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =====================================================
-- 1. app_users
-- Directorio de usuarios de la app (login propio, no Supabase Auth).
-- Ver app.js ~L77-295 (APP_USERS_TABLE, loadUserDirectory, saveUserProfile).
-- =====================================================
CREATE TABLE IF NOT EXISTS app_users (
    initials      text PRIMARY KEY,
    email         text NOT NULL,
    password_hash text NOT NULL,
    created_at    timestamptz DEFAULT now()
);

ALTER TABLE app_users ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on app_users"
    ON app_users FOR ALL
    USING (true) WITH CHECK (true);

-- =====================================================
-- 2. projects
-- Tabla principal. id es TEXT: unas veces lo genera el cliente
-- (generateId() = Date.now()+random) y otras lo deja a la base de
-- datos (saveNewProject() inserta sin id y lee data.id de vuelta).
-- phase/priority/impact/status son listas cerradas (ver config.js
-- PROJECT_PHASES y los valores usados en updateIndicator()/selects).
-- prerequisites es un array de objetos {name, done, na, url?} -> jsonb.
-- responsibles es un array de iniciales -> text[].
-- Ver app.js ~L901-990 (saveNewProject), ~L2381-2472
-- (updateProjectField) y ~L4385-4404 (mapeo de lectura).
-- =====================================================
CREATE TABLE IF NOT EXISTS projects (
    id            text PRIMARY KEY DEFAULT (gen_random_uuid()::text),
    name          text NOT NULL,
    start_date    date,
    end_date      date,
    phase         text NOT NULL DEFAULT 'Idea'
                  CHECK (phase IN ('Idea', 'En Progreso', 'On Hold', 'Hypercare', 'BAU', 'Cerrado', 'Mantenimiento')),
    bau_owner     text CHECK (bau_owner IN ('', 'propio', 'otro') OR bau_owner IS NULL),
    stakeholders  text DEFAULT '',
    benefits      text DEFAULT '',
    volume        numeric DEFAULT 0,
    fte           numeric DEFAULT 0,
    priority      text NOT NULL DEFAULT 'Media'
                  CHECK (priority IN ('Baja', 'Media', 'Alta')),
    impact        text NOT NULL DEFAULT 'Medio'
                  CHECK (impact IN ('Bajo', 'Medio', 'Alto')),
    status        text NOT NULL DEFAULT 'Verde'
                  CHECK (status IN ('Verde', 'Ámbar', 'Rojo')),
    progress      integer NOT NULL DEFAULT 0 CHECK (progress BETWEEN 0 AND 100),
    prerequisites jsonb NOT NULL DEFAULT '[]'::jsonb,
    responsibles  text[] NOT NULL DEFAULT '{}',
    created_at    timestamptz DEFAULT now()
);

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on projects"
    ON projects FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_projects_created_at ON projects (created_at);
CREATE INDEX IF NOT EXISTS idx_projects_phase ON projects (phase);

-- =====================================================
-- 3. daily_comments
-- Comentarios del Daily, con hilos (parent_id) y tareas personales
-- del propio comentario (is_personal/owner_initials/completed).
-- id es TEXT, generado en cliente con generateId().
-- Ver app.js ~L1840-1930 (saveDailyComment), ~L2194-2225
-- (submitCommentReply), ~L2282-2295 (setCommentCompletion),
-- ~L4435-4450 (mapeo de lectura).
-- =====================================================
CREATE TABLE IF NOT EXISTS daily_comments (
    id             text PRIMARY KEY,
    project_id     text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    parent_id      text REFERENCES daily_comments(id) ON DELETE CASCADE,
    date           date NOT NULL,
    time           text NOT NULL,
    text           text NOT NULL,
    responsible    text,
    is_personal    boolean NOT NULL DEFAULT false,
    owner_initials text,
    user_name      text,
    urgency        text NOT NULL DEFAULT 'Normal'
                   CHECK (urgency IN ('Normal', 'Alta', 'Máxima')),
    has_incident   boolean NOT NULL DEFAULT false,
    completed      boolean NOT NULL DEFAULT false,
    created_at     timestamptz DEFAULT now()
);

ALTER TABLE daily_comments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on daily_comments"
    ON daily_comments FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_daily_comments_project ON daily_comments (project_id);
CREATE INDEX IF NOT EXISTS idx_daily_comments_date ON daily_comments (date);
CREATE INDEX IF NOT EXISTS idx_daily_comments_parent ON daily_comments (parent_id);
CREATE INDEX IF NOT EXISTS idx_daily_comments_created_at ON daily_comments (created_at);

-- =====================================================
-- 4. project_capacities
-- Capacidad semanal por proyecto y miembro del equipo.
-- id TEXT generado en cliente con generateId(); week_start es la
-- clave de texto YYYY-MM-DD del lunes de esa semana (formatDateKey()),
-- se guarda como date.
-- Ver app.js ~L2531-2670 (loadCapacities/updateCapacity).
-- =====================================================
CREATE TABLE IF NOT EXISTS project_capacities (
    id               text PRIMARY KEY,
    project_id       text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    user_initials    text NOT NULL,
    week_start       date NOT NULL,
    capacity_percent integer NOT NULL DEFAULT 0 CHECK (capacity_percent BETWEEN 0 AND 100),
    created_at       timestamptz DEFAULT now()
);

ALTER TABLE project_capacities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on project_capacities"
    ON project_capacities FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_capacities_project_week
    ON project_capacities (project_id, user_initials, week_start);

-- =====================================================
-- 5. project_weekly_tasks
-- Objetivos semanales por proyecto (widget WEEKLY).
-- Tal cual migrations_weekly_incidents.sql (uuid PK, generado por DB:
-- addWeeklyTask() no manda id).
-- Ver app.js ~L2719-2763.
-- =====================================================
CREATE TABLE IF NOT EXISTS project_weekly_tasks (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id  text REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    week_start  date NOT NULL,
    text        text NOT NULL,
    done        boolean DEFAULT false,
    position    integer DEFAULT 0,
    created_by  text,
    created_at  timestamptz DEFAULT now()
);

ALTER TABLE project_weekly_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on project_weekly_tasks"
    ON project_weekly_tasks FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_weekly_tasks_project_week
    ON project_weekly_tasks (project_id, week_start);

-- =====================================================
-- 6. project_statuses
-- Historial de "últimos estados" publicados en la ficha de proyecto.
-- id TEXT generado en cliente con generateId().
-- Ver app.js ~L3042-3066 (insert), ~L2843-2862 (loadProjectStatuses).
-- =====================================================
CREATE TABLE IF NOT EXISTS project_statuses (
    id             text PRIMARY KEY,
    project_id     text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    status_text    text NOT NULL,
    user_initials  text,
    created_at     timestamptz DEFAULT now()
);

ALTER TABLE project_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on project_statuses"
    ON project_statuses FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_project_statuses_project ON project_statuses (project_id);
CREATE INDEX IF NOT EXISTS idx_project_statuses_created_at ON project_statuses (created_at);

-- =====================================================
-- 7. project_notes
-- Notas rápidas por proyecto (widget de notas). id TEXT generado en
-- cliente con generateId(). color es una lista cerrada de opciones
-- del selector (amarillo/menta/salmon/cielo).
-- Ver app.js ~L3095-3198 (saveProjectNote/deleteProjectNote).
-- =====================================================
CREATE TABLE IF NOT EXISTS project_notes (
    id         text PRIMARY KEY,
    project_id text NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
    title      text DEFAULT '',
    body       text DEFAULT '',
    url        text,
    color      text NOT NULL DEFAULT 'yellow'
               CHECK (color IN ('yellow', 'mint', 'salmon', 'sky')),
    created_by text,
    created_at timestamptz DEFAULT now(),
    updated_at timestamptz DEFAULT now()
);

ALTER TABLE project_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on project_notes"
    ON project_notes FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_project_notes_project ON project_notes (project_id);
CREATE INDEX IF NOT EXISTS idx_project_notes_created_at ON project_notes (created_at);

-- =====================================================
-- 8. project_incidents
-- Incidencias por proyecto (widget INCIDENCIAS).
-- Tal cual migrations_weekly_incidents.sql (uuid PK generado por DB:
-- addIncident() no manda id).
-- Ver app.js ~L3288-3329.
-- =====================================================
CREATE TABLE IF NOT EXISTS project_incidents (
    id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    project_id  text REFERENCES projects(id) ON DELETE CASCADE NOT NULL,
    description text NOT NULL,
    resolved    boolean DEFAULT false,
    created_by  text,
    created_at  timestamptz DEFAULT now()
);

ALTER TABLE project_incidents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on project_incidents"
    ON project_incidents FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_incidents_project
    ON project_incidents (project_id);

-- =====================================================
-- 9. team_vacations
-- Vacaciones del equipo, un registro por día (no por rango), para
-- poder borrar días individuales. id lo genera la base de datos
-- (addVacationWithDateRange() no manda id). status siempre se guarda
-- como 'planned' desde el cliente actual, pero se deja como texto
-- libre con default por si se amplía. vacation_type es una lista
-- cerrada validada en JS (['current_year','previous_year','willis_choice']).
-- Ver app.js ~L4966-5037.
-- =====================================================
CREATE TABLE IF NOT EXISTS team_vacations (
    id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    user_initials  text NOT NULL,
    start_date     date NOT NULL,
    end_date       date NOT NULL,
    status         text NOT NULL DEFAULT 'planned',
    vacation_type  text NOT NULL DEFAULT 'current_year'
                   CHECK (vacation_type IN ('current_year', 'previous_year', 'willis_choice')),
    vacation_year  integer NOT NULL,
    days_count     integer NOT NULL DEFAULT 1,
    created_at     timestamptz DEFAULT now()
);

ALTER TABLE team_vacations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on team_vacations"
    ON team_vacations FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_team_vacations_start_date ON team_vacations (start_date);
CREATE INDEX IF NOT EXISTS idx_team_vacations_user ON team_vacations (user_initials);

-- =====================================================
-- 10. day_personal_tasks
-- Tareas personales del día, privadas por usuario (owner_initials).
-- id lo genera la base de datos (addDayPersonalTask() no manda id).
-- task_date es la clave de texto YYYY-MM-DD (formatDateKey()).
-- Ver app.js ~L1271-1343 (add/toggle/delete), ~L2935-2957 (lectura).
-- =====================================================
CREATE TABLE IF NOT EXISTS day_personal_tasks (
    id             uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    owner_initials text NOT NULL,
    task_date      date NOT NULL,
    text           text NOT NULL,
    completed      boolean NOT NULL DEFAULT false,
    created_at     timestamptz DEFAULT now(),
    updated_at     timestamptz DEFAULT now()
);

ALTER TABLE day_personal_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all on day_personal_tasks"
    ON day_personal_tasks FOR ALL
    USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_day_personal_tasks_owner_date
    ON day_personal_tasks (owner_initials, task_date);
CREATE INDEX IF NOT EXISTS idx_day_personal_tasks_created_at
    ON day_personal_tasks (created_at);
