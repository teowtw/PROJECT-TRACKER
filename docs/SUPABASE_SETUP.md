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
