---
name: update-holidays
description: Add or correct public-holiday calendars per team member's region in Project Tracker (HOLIDAYS_BY_REGION / DEFAULT_MEMBER_REGION / HOLIDAY_REGION_PENDING_YEARS in app.js). Use when a new year needs loading, a member joins or moves, or someone reports a day wrongly marked (or not marked) as a holiday.
---

# Maintaining holiday calendars

Holidays block leave booking (`addVacationWithDateRange` drops them) and are
painted in the Daily and Team calendars. A wrong date has a direct cost:
someone cannot book a real working day, or a holiday gets charged as leave.

## Each member follows a region, not a country

| Member | Region code | Calendar = national + regional + local |
|---|---|---|
| AR, JG | `ES-MD` | Spain + Comunidad de Madrid + Madrid city (San Isidro, Almudena) |
| TB | `ES-VC-ALC` | Spain + Comunitat Valenciana + Alicante city (Santa Faz, Fogueres) |
| IM | `PT-LIS` | Portugal + Lisbon municipal (Santo António, 13 June) |
| AD | `IN-MH` | India + Maharashtra / Mumbai |

Confirm this table with the user before changing it; it is personal data
they gave and may change.

## Sources (use official ones, never a blog list)

- Spain national: the BOE "Resolución ... relación de fiestas laborales" for the year.
- Madrid: BOCM (regional) and Ayuntamiento de Madrid (two local days).
- Valencia: DOGV "calendario laboral" and the municipal resolution if a town is given.
- Portugal: Código do Trabalho art. 234 (national) and the Câmara Municipal de Lisboa (13 June).
- Mumbai: the Maharashtra Government GR on public holidays (General Administration Department).

Movable feasts (Easter, Diwali, Ganesh Chaturthi, Eid) must come from the
source for that exact year. Do not compute them.

When a holiday falls on a Sunday, check whether the region moves it to Monday
(Spain often does, region by region, e.g. 2 Nov 2026). The source says so explicitly.

## Procedure

1. Search the sources above for the target year and list each date with its
   name and source, in a table for the user. Get approval before editing.
2. Edit `HOLIDAYS_BY_REGION` keeping dates sorted, one comment line naming
   each holiday, and `YYYY-MM-DD` keys (they are compared as strings).
3. **Check for conflicts with existing leave.** Give the user a list of
   `team_vacations` rows that now land on that member's holiday (the harness
   or a console snippet over `teamVacations` with `isHolidayForMember`).
   **Never delete them automatically.** The user decides.
4. Add a `verify-tracker` assertion: one date that is a holiday in one
   region but not another (e.g. `2026-11-09` is a holiday for AR, not for TB),
   and that leave on it can be booked by TB but not by AR.
5. The Team view warns "public holidays still incomplete for …" for every
   team region whose year is missing from `HOLIDAYS_BY_REGION` or listed in
   `HOLIDAY_REGION_PENDING_YEARS` (e.g. Alicante 2027 until the DOGV publishes
   its local days in November). Remove the year from that list once the
   calendar is complete.
6. Holidays also reduce weekly capacity (`getWeekDaysOff`), so a wrong date
   moves the capacity numbers too. `driver4.js` covers this.
