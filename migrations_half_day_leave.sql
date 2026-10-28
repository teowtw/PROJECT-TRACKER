-- =====================================================
-- MIGRACIÓN: medio día de ausencia (noviembre 2026)
--
-- Ejecutar en el SQL Editor de Supabase. Es idempotente: se puede
-- pegar entera más de una vez sin romper nada.
--
-- SOLO AÑADE una columna con DEFAULT. No borra filas ni columnas, no
-- cambia tipos y no toca ningún CHECK existente.
--
-- Por qué una columna nueva y no days_count = 0.5: days_count es
-- integer, y cambiarle el tipo está fuera de las reglas (nada de
-- ALTER COLUMN ... TYPE en producción). Una ausencia de medio día se
-- guarda como una fila de un día (start_date = end_date,
-- days_count = 1) con day_portion = 'am' o 'pm', y la app la cuenta
-- como 0,5 días en el saldo, en la capacidad y en los gráficos.
--
-- Mientras no se despliegue la app nueva, la versión publicada no lee
-- la columna: todas las filas existentes son 'full' (el DEFAULT) y
-- se comportan exactamente igual que hoy.
-- =====================================================


-- =====================================================
-- 0. COPIA DE SEGURIDAD
-- Solo crea; IF NOT EXISTS evita pisar la foto buena si se repite.
-- =====================================================
CREATE SCHEMA IF NOT EXISTS backup_20261029;
CREATE TABLE IF NOT EXISTS backup_20261029.team_vacations AS TABLE public.team_vacations;


-- =====================================================
-- 1. PORCIÓN DEL DÍA (team_vacations.day_portion)
--   full -> día completo (todo lo que existe hoy)
--   am   -> solo la mañana
--   pm   -> solo la tarde
-- =====================================================
ALTER TABLE team_vacations ADD COLUMN IF NOT EXISTS day_portion text NOT NULL DEFAULT 'full';
ALTER TABLE team_vacations DROP CONSTRAINT IF EXISTS team_vacations_day_portion_check;
ALTER TABLE team_vacations ADD CONSTRAINT team_vacations_day_portion_check
    CHECK (day_portion IN ('full', 'am', 'pm'));


-- =====================================================
-- 2. COMPROBACIÓN (en una query APARTE, después de la migración)
-- a) El recuento debe ser IDÉNTICO al de antes (52 el 28-oct) y a la copia.
-- b) Todo lo existente quedó como 'full'.
-- =====================================================

-- SELECT (SELECT count(*) FROM team_vacations) live, (SELECT count(*) FROM backup_20261029.team_vacations) backup;
-- SELECT day_portion, count(*) FROM team_vacations GROUP BY 1;
-- SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'team_vacations_day_portion_check';
