---
name: extend-closed-list
description: Add a value to one of Project Tracker's closed lists (project phase such as Training, task type, priority, absence type, vacation type) consistently across the Supabase CHECK, config.js/app.js constants, labels, CSS colours, sidebar/dashboard grouping and the test harness. Use whenever a feature needs a new phase, type, status or category value.
---

# Extending a closed list in Project Tracker

Closed lists live in three places that must agree: a `CHECK` constraint in
production, a JS constant or label map, and CSS classes for colours. Miss one
and either the insert fails ("violates check constraint") or the value
renders unstyled or falls into the wrong group.

## Inventory of the lists

| List | DB | JS | Colours |
|---|---|---|---|
| Project phase | `projects_phase_check` | `PROJECT_PHASES` (config.js), `LEGACY_PHASE_MAP`, `getProjectGroup`, `PHASE_CHART_COLORS` | `.phase-color-*` |
| Priority | `projects` / `day_tasks_priority_check` | `getPriorityLabel`, `getPriorityLevel` | priority badges |
| Task type | `day_tasks` / `daily_comments` `task_type` check | label map + `is-<type>` classes | `--color-training*` |
| Absence / vacation type | `team_vacations_*_check` | absence labels, balance logic | `.vacation-*`, `.legend-swatch--*` |

Stored values follow the table's existing language (Spanish for
`priority`/`impact`/`urgency`, English for newer columns); English labels for
the UI are always produced in JS.

## Procedure

1. **Database first** (`supabase-safe-migration`): read the live constraint
   with `pg_get_constraintdef`, `GROUP BY` the column, then drop-and-recreate
   the CHECK as a **superset**. Never narrow it.
2. **Constants**: append the new value at the **end** of ordered arrays
   (`PROJECT_PHASES` order drives tables, selectors and sort-by-phase).
3. **Grouping and side effects**: grep the old values
   (`grep -n "'BAU'\|'Completed'" app.js`) to find every branch that treats
   values specially — `getProjectGroup`, sidebar sections, Daily group
   filters, dashboard KPIs, auto-complete at 100 %, search synonyms. Decide
   for each one where the new value belongs; do not let it fall through to a
   default silently.
4. **Colours**: add tokens in both the light and dark theme blocks of
   `styles.css`. Check what each colour already means before reusing it
   (green is already "personal pending" in Daily and "next year" in Team).
   Never rely on colour alone: add a text badge or icon.
5. **Old clients**: the deployed version will meet the new value before every
   browser reloads. Check it does not overwrite it (e.g. a `<select>` without
   the option defaulting to the first one). Bump `?v=` on deploy.
6. **Harness**: seed at least one row with the new value in `stub.js`, assert
   it renders in the right group/colour, and run `audit.js` in both themes.
