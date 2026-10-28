---
name: verify-tracker
description: Run Project Tracker against a stubbed Supabase in headless Edge to prove a change works - functional assertions, WCAG contrast audit in both themes, and UI screenshots. Use after editing app.js, index.html or styles.css, or whenever asked to test, verify, check contrast, or screenshot this app. There is no npm test here; this is the test suite.
---

# Verifying Project Tracker

This app is a no-build, three-file front end (`index.html`, `app.js`, `styles.css`)
talking to Supabase from the browser. There is no test runner, no Node and no
Python on the dev machine. The only JS engine available is **Microsoft Edge**,
so verification runs the real app headlessly against an in-memory fake Supabase.

Never verify a change by reading the diff alone. Run the harness.

## Why a stub and not the real database

`config.js` points at the live production Supabase. Driving tests against it
would create and delete real projects, comments and leave records belonging to
the team. `harness/stub.js` replaces `window.supabase.createClient` with an
in-memory store that implements the slice of the client this app uses
(`from / select / insert / update / upsert / delete / eq / order / single`,
plus `channel().on().subscribe()`), and seeds the five real team initials.

## Running it

Everything happens in the scratchpad so nothing lands in the repo.

1. **Copy the harness to the scratchpad** (`stub.js`, `driver.js`, `audit.js`,
   `shot.js` from `harness/`).

2. **Generate the page from the real `index.html`** — never hand-maintain a copy
   of it, or the harness silently tests stale markup. Regenerate it every run:

   ```bash
   sed \
     -e '/fonts.googleapis.com/d' -e '/fonts.gstatic.com/d' -e '/calendar.ico/d' \
     -e 's|src="logo.svg"|src=""|' \
     -e "s|href=\"styles.css[^\"]*\"|href=\"$BASE/styles.css\"|" \
     -e "s|<script src=\"https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.49.1/dist/umd/supabase.js\"></script>|<script src=\"$TMP/stub.js\"></script><script src=\"$TMP/driver.js\"></script>|" \
     -e "s|<script src=\"config.js[^\"]*\"></script>|<script src=\"$BASE/config.js\"></script>|" \
     -e "s|<script src=\"app.js[^\"]*\"></script>|<script src=\"$BASE/app.js\"></script><pre id=\"testout\">pending</pre>|" \
     index.html > "$TMP/test.html"
   ```

   The `[^\"]*` swallows the cache-busting `?v=YYYYMMDD` suffix that
   `index.html` puts on all three assets. Without it the substitutions
   silently miss, the page loads no app, and every driver reports `pending`.
   After generating, `grep -c "$BASE/app.js" "$TMP/test.html"` must print 1.

   `$BASE` is a `file:///` URL to the project dir (percent-encode the spaces in
   `OneDrive - Willis Towers Watson`); `$TMP` is the scratchpad. Swap
   `driver.js` for `audit.js` or `shot.js` to build the other two pages.

3. **Run Edge headless and read the result out of the DOM:**

   ```bash
   timeout 110 "/c/Program Files (x86)/Microsoft/Edge/Application/msedge.exe" \
     --headless=new --disable-gpu --no-sandbox --allow-file-access-from-files \
     --virtual-time-budget=20000 --window-size=1600,1000 \
     --dump-dom "$TMP/test.html" 2>/dev/null \
     | sed -n '/<pre id="testout">/,/<\/pre>/p' | sed 's/<[^>]*>//g'
   ```

   Then `taskkill //F //IM msedge.exe` — headless Edge does not always exit.

## Four traps that will waste your time

These are all learned the hard way; each one produces a confusing non-failure.

1. **`window.onload` never fires.** `index.html` pulls Google Fonts, and with no
   network those requests hang, so `load` never arrives and nothing runs. The
   `sed` above deletes the font/favicon/logo tags, and the drivers hook
   `DOMContentLoaded` rather than `load`.

2. **`confirm()` blocks forever.** Deletes go through `confirm()`, and headless
   Edge has no dialog handler, so the run hangs until the timeout. Every driver
   stubs `window.confirm` to return `true`.

3. **Colour transitions get sampled mid-flight.** `body` and several components
   transition `color` over 150-200ms, so measuring right after a theme switch
   reports meaningless in-between values as contrast failures. `audit.js`
   injects a `transition:none !important` stylesheet and waits 250ms after
   `applyTheme()`.

4. **A syntax error in your driver looks like "no output".** The page renders,
   `#testout` still says `pending`, and nothing explains why. Check the driver
   parses before blaming the app:

   ```bash
   printf '%s\n' '<!DOCTYPE html><html><head><script>window.__e=[];window.addEventListener("error",function(e){window.__e.push(e.message+" @line "+e.lineno)});</script><script src="'"$TMP"'/driver.js"></script></head><body><pre id="o">x</pre><script>document.getElementById("o").textContent=JSON.stringify(window.__e)</script></body></html>' > "$TMP/dcheck.html"
   ```

   Run that through `--dump-dom`; an empty `[]` means the driver is clean.

## The three drivers

| Driver | What it does | Pass condition |
|---|---|---|
| `driver.js` | Owners picker, project rename modal, project creation, team day tasks, and all four views. | `FAILED=0` (45 assertions) |
| `driver2.js` | The hours/capacity model (even split, custom split, per-person baselines, done-vs-pending, manual overrides), archive, bin, permanent delete, inline rename, task detail modal, dashboard allocation widget. | `FAILED=0` (70 assertions) |
| `driver3.js` | Task detail inside Day Comments, sidebar + dashboard project search, the dashboard copy of the Weekly Capacity widget (independent week, scoped override ids), view icons, priority colour scale. | `FAILED=0` (45 assertions) |
| `driver4.js` | Regional holidays (`HOLIDAYS_BY_REGION`, `getMemberRegion`, `app_users.holiday_region` override), absence types and privacy ("Absent" for others), Next year balance, capacity reduced by holidays/days off. Uses fixed Nov 2026 dates. | `FAILED=0` (38 assertions) |
| `driver5.js` | The Tasks view: only my tasks (Daily comments + day_tasks), create/edit/delete with optional project, date, time, priority, effort and visibility; private tasks hidden from others in Daily; undated tasks out of capacity; filters and "Show done". | `FAILED=0` (38 assertions) |
| `audit.js` | Computes real WCAG ratios from `getComputedStyle`, compositing semi-transparent layers up the tree, across 17 screens in **both** themes. | **0 below threshold in dark**; see known light-mode exceptions below |
| `shot.js` | Seeds realistic multi-project data with hours and opens one screen for a screenshot. Scenes: `#ficha`, `#dashboard`, `#detail`, `#menu`, `#taskform`, `#bin`, `#daycomments`, `#search`, `#team`, `#leave`, `#tasks`, `#taskeditor`. Add `?bottom` to scroll to the end of the view first. | Read the PNG and look at it |

Run **all five drivers**: they cover different areas. Add an
assertion for every behaviour you change. The `ok(name, cond, detail)` helper
reports incrementally, so a hang still shows how far it got.

## The capacity model, in one place

If you touch hours, assert against `computeWeekCapacity(weekKey)`; it is the
single source of truth behind both the project-card widget and the dashboard
table, so a bug there shows up in two places at once. The rules it encodes:

- A task's `estimated_hours` is **total** effort, split evenly between its
  responsibles unless `hours_by_assignee` names a share for them.
- Editing any per-person share rewrites `estimated_hours` to the sum, so the
  total and the parts can never disagree.
- Both `daily_comments` and `day_tasks` contribute hours.
- Completed tasks still count toward the week's allocation; `pendingHours`
  tracks what is left.
- The denominator is `app_users.weekly_hours` per person (the stub gives AD
  20h on purpose, so a part-time baseline is always under test).
- A row in `user_capacity_overrides` wins over the computed value.
- The denominator shrinks by 1/5 per weekday the person has off: a public
  holiday of THEIR region or any `team_vacations` day (sick leave and
  personal matters too, even though they never use the leave balance).

## Reading the contrast audit

Dark mode must come back **0 below threshold**. If it does not, the cause is
almost always one of the two failure modes this stylesheet is prone to: a
hardcoded light surface under token text that flipped near-white, or hardcoded
dark ink on a token surface that flipped dark. Fix it with the design tokens
(`--color-surface`, `--color-well`, `--color-text`, `--color-accent` for filled
purple with white text, `--color-accent-text` for accent text on a tinted chip)
rather than a new hardcoded value.

Light mode still reports a handful of items. Three are audit artefacts, not
bugs, and should be ignored: `.project-item-select.active` (the walker misses the
sidebar own opaque background; the real pairing is white on --color-sidebar,
about 8:1), and the two `.dashboard-hero-*` lines (white on a
dark gradient the audit cannot read). The rest are pre-existing WTW
semantic-palette values used as small text (`badge-alta` 2.46:1, `badge-verde`
2.94:1, `required-mark` 3.91:1). Those are a deliberate open item, not a
regression — do not "fix" them without asking, since it means changing brand
colours.

`span.vacation-badge` (the initials chips in the Daily header for people on
leave) is another gradient artefact: white on a purple gradient, around 6:1 in
reality. It only appears in the audit since the seed includes leave days.
