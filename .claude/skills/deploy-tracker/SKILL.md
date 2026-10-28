---
name: deploy-tracker
description: Pre-flight checklist and procedure for publishing Project Tracker to GitHub Pages. Use when the user asks to deploy, publish, push live, or release a change to index.html, app.js, styles.css or config.js.
---

# Deploying Project Tracker

Pushing to `main` publishes the site: `.github/workflows/deploy-pages.yml`
uploads the whole repo root to GitHub Pages on every push. There is no
build step and no staging site, so **a push is a production release**.
Always ask the user for confirmation before pushing.

## Pre-flight (all must pass)

1. **Database first.** If the change reads or writes a column or table that
   a pending `migrations_*.sql` creates, the user must have run that
   migration and pasted back the verification output. Otherwise stop.
2. **Tests.** Run `verify-tracker`: `driver.js` and `driver2.js` at
   `FAILED=0`, and the audit at 0 dark-mode failures. Report the counts.
3. **English UI.** Every user-visible string you added (labels, toasts,
   tooltips, `aria-label`, placeholders, empty states) is in English. Code
   comments may stay in Spanish, matching the file.
4. **Cache-busting.** Bump the `?v=YYYYMMDD` suffix on `styles.css`,
   `config.js` and `app.js` in `index.html`, all three to the same value.
   Without that, browsers keep serving the old `app.js` against the new markup.
5. **No stray files.** `git status`: only intended files are staged. The
   whole root is published, so never commit `.env`, backups, CSV exports,
   screenshots or plan drafts unless the user asks for it.
6. **Syntax.** A JavaScript syntax error in `app.js` blanks the whole app
   for everyone. The harness catches it (`#testout` stays `pending`), so
   never skip step 2.

## Release

- Commit on a branch and open a PR, or commit to `main` if that is what the
  user does. `deploy.ps1` commits only the site files with `--only` and
  pushes. Note that it still prints an old URL (`sanchezig.github.io`)
  while the remote is `teowtw/PROJECT-TRACKER`, so check the live URL with
  `gh api repos/teowtw/PROJECT-TRACKER/pages --jq .html_url`.
- Watch the run: `gh run list --workflow deploy-pages.yml --limit 1`.

## Post-deploy smoke test (on the live site, hard refresh)

Log in → Daily grid renders and the week navigation works → open a day's
comments → open Project Details of a real project (capacity, weekly, notes
widgets) → Team calendar (year view) → Dashboard. Check the browser console
for errors. Open a second window and check that a change appears in the
first one through realtime.

## Rollback

`git revert <sha>` and push. Migrations are additive with backward-compatible
defaults, so old code runs fine on the new schema. Never roll the database back.
