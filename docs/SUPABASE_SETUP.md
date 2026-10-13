# Configurar un proyecto Supabase nuevo

Pasos para migrar la app a un proyecto Supabase completamente nuevo y vacío.

## 1. Crear el proyecto

1. Entra en https://supabase.com/dashboard y pulsa **New project**.
2. Elige organización, nombre, contraseña de base de datos y región, y espera a que se aprovisione.
3. Ve a **Project Settings → API**. Ahí tienes:
   - **Project URL** (algo como `https://xxxxxxxx.supabase.co`)
   - **anon public** key (empieza por `eyJ...`)

No necesitas la **service_role** key para esta app — ver aviso de seguridad más abajo.

## 2. Crear las tablas

1. En el panel del proyecto nuevo, abre **SQL Editor → New query**.
2. Copia y pega todo el contenido de [`supabase/schema.sql`](../supabase/schema.sql) y pulsa **Run**.
   Esto crea las 10 tablas (`app_users`, `projects`, `daily_comments`, `project_capacities`, `project_weekly_tasks`, `project_statuses`, `project_notes`, `project_incidents`, `team_vacations`, `day_personal_tasks`), con RLS activada y una política permisiva `FOR ALL USING (true) WITH CHECK (true)` en cada una — la app no usa Supabase Auth, usa su propio login contra `app_users`, así que la seguridad real vive en esa capa de JS, no en Postgres.
3. Abre otra **New query**, pega el contenido de [`supabase/seed.sql`](../supabase/seed.sql) y pulsa **Run**.
   Esto siembra únicamente la tabla `app_users` con las 5 personas del equipo y la contraseña inicial compartida `WEai2026!` (ya hasheada). No se siembra ningún dato de proyectos: el proyecto nuevo arranca vacío.

## 2b. Aplicar las migraciones

`supabase/schema.sql` es la foto del esquema original, no se actualiza con cada
cambio. Después de ejecutarlo hay que pasar las migraciones **en este orden**,
cada una en su propia **New query**. Todas son idempotentes: se pueden volver a
pegar enteras sin romper nada.

| Orden | Fichero | Qué añade |
|---|---|---|
| 1 | [`migrations_weekly_incidents.sql`](../migrations_weekly_incidents.sql) | `project_weekly_tasks` y `project_incidents` |
| 2 | [`migrations_description_country_priority.sql`](../migrations_description_country_priority.sql) | `projects.description`, `projects.country`, prioridad `Crítica` y el vocabulario nuevo de fases (`Discovery`…`On Hold`) |
| 3 | [`migrations_day_tasks.sql`](../migrations_day_tasks.sql) | `day_tasks`: tareas de día compartidas y asignables (las que se ven en el modal del botón «+» de la cabecera de cada día en el Daily) |
| 4 | [`migrations_capacity_tasks_archive.sql`](../migrations_capacity_tasks_archive.sql) | Archivado y papelera de proyectos (`projects.archived_at` / `deleted_at`), jornada semanal por persona (`app_users.weekly_hours`), horas y varios responsables por tarea (`daily_comments.responsibles` / `estimated_hours` / `hours_by_assignee` / `description`, y lo mismo en `day_tasks`), y la tabla `user_capacity_overrides` |

> La migración 4 deja obsoleta la tabla `project_capacities` (capacidad manual
> en % por proyecto). No se borra, para no perder el histórico, pero la app ya
> no la lee: la capacidad se calcula a partir de las horas de las tareas. Si
> algún día quieres recuperar el espacio, `DROP TABLE project_capacities` es
> seguro una vez verificado que nadie consulta ese histórico.

Si la app ya está en marcha contra un proyecto existente, basta con ejecutar las
migraciones que falten; las ya aplicadas no hacen nada la segunda vez.

> **Si una migración falla, no se ha aplicado nada.** El SQL Editor de Supabase
> ejecuta el script entero en una transacción, así que un error a mitad aborta
> todo y la base queda como estaba. Corrige y vuelve a pegar el fichero
> completo; no hace falta limpiar nada a mano.
>
> La migración 4 es autosuficiente: si `day_tasks` no existe (porque la 3 no se
> pasó), la crea ella misma. Las 1, 2 y 3 sí esperan el orden.

## 3. Apuntar la app al proyecto nuevo

Edita `config.js` y sustituye estas dos líneas con la URL y la anon key del proyecto nuevo:

```js
const SUPABASE_URL = "https://snyvvbwkkqpecfcvvdid.supabase.co";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...";
```

(líneas 2 y 3 de `config.js`). No toques nada más del fichero.

## 4. Primer arranque

Abre la app contra el proyecto nuevo e inicia sesión con la contraseña compartida `WEai2026!` y cualquiera de las iniciales (TB, AR, AD, JG, IM).

Nota: aunque no hubieras ejecutado `seed.sql`, la app se auto-rellena sola la primera vez que alguien la carga con la tabla `app_users` vacía — ver `loadUserDirectory()` en `app.js` (alrededor de la línea 186), que usa la constante `DEFAULT_USERS` como semilla por defecto. `seed.sql` es solo una comodidad "por si acaso", no un paso obligatorio.

## Aviso de seguridad

- La **anon public** key es la única que debe ir en `config.js` — es segura para exponer en el cliente porque todo el control de acceso de esta app pasa por el login propio, no por RLS estricto.
- La **service_role** key tiene permisos totales y se salta RLS. **Nunca** debe ponerse en `config.js` ni en ningún fichero que se vaya a commitear al repositorio. Si alguna vez la necesitas para scripts de administración, guárdala solo como variable de entorno local, fuera del repo.
