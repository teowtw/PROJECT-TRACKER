---
name: team-member-lifecycle
description: Add, deactivate, reactivate or edit a team member in Project Tracker (app_users, admin view, initials, default password) without losing their history. Use when touching user creation/removal, admin rights, the login, or any list or picker of people (owners, assignees, responsibles, Team calendar, capacity, dashboard).
---

# Team member lifecycle in Project Tracker

People are identified everywhere by their **initials**: `projects.responsibles`,
`day_tasks.assignees`, `daily_comments.responsible`, `team_vacations`,
`user_capacity_overrides`, chips in every view. The initials are the primary
key of `app_users` and the only link between a person and their work.

## Invariants (never break these)

1. **Never `DELETE` from `app_users`.** "Remove a user" means
   `is_active = false` + `deactivated_at` + `deactivated_by`. Their projects,
   tasks, hours and leave must stay visible so the team can review the work.
2. **Never reuse initials**, not even those of an inactive user: the new
   person would inherit someone else's history. Collision checks run against
   the whole directory, active and inactive.
3. **Renaming initials is the one allowed delete (Teo's decision, 2026-10-28).**
   `saveUserProfile` inserts the new row and deletes the old one. The old work
   stays under the old initials and is shown as an unavailable person. When
   renaming, always copy every column (names, `is_admin`, `is_active`,
   `holiday_region`) to the new row, and confirm with the user first. Treat
   initials that appear in `responsibles`/`assignees` as taken, even if they
   are no longer in `app_users`.
4. **Selectable ≠ visible.** Pickers (owners, assignees, responsibles, new
   leave) offer only `getSelectableMembers()` = active and not in
   `excludedResponsibles`. Displays, filters and history use
   `getAllMembers()`, with inactive people dimmed and labelled "unavailable".
5. **Admin is a UI role.** RLS is open ("Allow all"); hiding the Admin view is
   not security. Still re-check `isCurrentUserAdmin()` inside `switchView('admin')`
   and every admin action, and never let the last active admin lose the role
   or deactivate themselves.
6. **New users get an explicit hash** of the standard password
   `APP_LOGIN_PASSWORD` (`WEai2026!`). Use `insert`, not `upsert`, so a
   collision fails instead of overwriting someone.

## Where people show up (check every one after a change)

Run `grep -n "teamMembers" app.js` and classify each hit as *picker* or
*display*. Known places:

| Place | Kind |
|---|---|
| `syncTeamMembersInSelectors` (comment responsible) | picker |
| New-project owners, Project Details owners | picker |
| Day task assignees, Tasks editor assignees, Daily responsibles | picker |
| Daily / Tasks / Dashboard person filters | display |
| Team calendar rows and holiday groups by region | inactive hidden (their old leave stays in the DB) |
| `computeWeekCapacity`, dashboard capacity widget, per-person summary | display (inactive only when they have hours that week, via `formerMember`) |
| Login (`handleLoginAttempt`), saved session (`hasValidLoginSession`, `init`) | must reject inactive users |

Also keep in sync: `normalizeUserDirectory` and `loadUserDirectory` (new
fields must survive the `localStorage` cache `wtw_user_directory_v1`), and the
realtime handler — an `app_users` change must reset `userDirectoryLoaded`,
reload the directory and re-render, otherwise other sessions never see the
new person.

## Creating a user

1. First + last name → initials: first letter of the first given name + first
   letter of the first surname, accents stripped, upper case.
   On collision append the 2nd letter of the surname (`AR` → `ARE`), then a
   digit. Always editable; 2–4 chars `A-Z0-9`.
2. Email `firstname.lastname@wtwco.com` (accents stripped), editable;
   `app_users.email` is NOT NULL.
3. Ask for holiday region (from `HOLIDAYS_BY_REGION`) and weekly hours. If the
   region has no calendar yet, use the `update-holidays` skill.
4. After saving, show the credentials (initials + standard password) for the
   admin to hand over.

## Verifying

Use `verify-tracker`. Seed the stub with one admin, one non-admin and one
inactive member who still owns a project and tasks. Assert: the new member
appears in every picker without reload; the inactive one appears in no
picker, still shows on their old work, cannot sign in; deactivating never
sends a `.delete()` to `app_users` (spy on the stub). Only a rename does.
