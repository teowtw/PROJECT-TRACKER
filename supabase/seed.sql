-- =====================================================
-- SEED: app_users
-- Ejecutar después de schema.sql en el SQL Editor del proyecto
-- Supabase nuevo.
--
-- Contraseña inicial compartida para todo el equipo: WEai2026!
-- (ver APP_LOGIN_PASSWORD en app.js). El hash es el SHA-256 en
-- hexadecimal minúsculas de esa cadena exacta, calculado tal como
-- lo hace hashTextSha256() en el cliente.
--
-- Esto es un "belt-and-suspenders": si la tabla app_users está
-- vacía, loadUserDirectory() (app.js ~L186-244) la auto-rellena con
-- DEFAULT_USERS la primera vez que alguien carga la app, así que
-- este seed no es estrictamente necesario, pero deja los usuarios
-- listos desde el primer momento sin depender de ese paso.
--
-- No se siembra ninguna otra tabla: el proyecto nuevo debe empezar
-- sin proyectos, comentarios, notas, incidencias ni vacaciones.
-- =====================================================

INSERT INTO app_users (initials, email, password_hash) VALUES
    ('TB', 'teo.balsalobre@wtwco.com',  '64aeab154d5243f1c67943c097da06a65680e76be9d6d915ba5a9fd941203f75'),
    ('AR', 'ana.real@wtwco.com',        '64aeab154d5243f1c67943c097da06a65680e76be9d6d915ba5a9fd941203f75'),
    ('AD', 'abha.dungdung@wtwco.com',   '64aeab154d5243f1c67943c097da06a65680e76be9d6d915ba5a9fd941203f75'),
    ('JG', 'jorge.gazulla@wtwco.com',   '64aeab154d5243f1c67943c097da06a65680e76be9d6d915ba5a9fd941203f75'),
    ('IM', 'ines.marcelino@wtwco.com',  '64aeab154d5243f1c67943c097da06a65680e76be9d6d915ba5a9fd941203f75')
ON CONFLICT (initials) DO UPDATE SET
    email         = EXCLUDED.email,
    password_hash = EXCLUDED.password_hash;
