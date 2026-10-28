window.__driver7Loaded = true;
// Drives half-day leave (team_vacations.day_portion = 'am' | 'pm'): the
// Duration choice in the leave modal (only for a single day), what gets
// stored (days_count stays 1, an integer column), and that a half day
// counts as 0.5 everywhere: leave balance, weekly capacity, month chart,
// the Team calendar cell (diagonal half) and the Daily header badge.
// Uses fixed November 2026 dates (TB is in Alicante: no holiday 9-13 Nov).
(function () {
    window.confirm = function () { return true; };
    window.alert = function () {};

    const results = [];
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function out(text) {
        const pre = document.getElementById('testout');
        if (pre) pre.textContent = text;
    }
    function flush() {
        const failed = results.filter(r => r.indexOf('FAIL') === 0).length;
        out('TOTAL=' + results.length + ' FAILED=' + failed + '\n' + results.join('\n'));
    }
    const ok = (name, cond, detail) => {
        results.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
        flush();
    };

    window.addEventListener('error', e => {
        results.push('FAIL | uncaught: ' + e.message + ' @' + e.lineno);
        flush();
    });

    const DB = window.__DB;
    const rowsOn = (who, day) => DB.team_vacations.filter(v => v.user_initials === who && v.start_date === day);

    async function main() {
        try { localStorage.clear(); localStorage.setItem('wtw_current_user', 'TB'); } catch (e) {}
        currentUser = 'TB';
        await enterApplication();
        await sleep(120);

        // ---- Modal: Duration choice ------------------------------------------
        showVacationOptionsModal('TB', '2026-11-11', ['2026-11-11']);
        await sleep(20);
        const radios = Array.from(document.querySelectorAll('input[name="leaveDayPortion"]'));
        ok('leave modal offers Full day / Morning / Afternoon', radios.map(r => r.value).join() === 'full,am,pm');
        ok('full day is the default', radios[0].checked);
        ok('half days enabled for a single day', !radios[1].disabled && !radios[2].disabled);
        radios[1].checked = true;
        onLeaveDayPortionChange();
        ok('label explains it counts as 0.5', /Half day · morning \(counts as 0\.5 days\)/.test(document.getElementById('vacationSelectionLabel').textContent),
            document.getElementById('vacationSelectionLabel').textContent);
        await saveVacationSelection();
        await sleep(30);
        const am = rowsOn('TB', '2026-11-11')[0];
        ok('morning saved as day_portion am', am && am.day_portion === 'am');
        ok('days_count stays 1 (integer column)', am && am.days_count === 1);
        ok('still a vacation charged to the current year', am && am.absence_type === 'vacation' && am.vacation_type === 'current_year');

        // Afternoon of sick leave on another day.
        showVacationOptionsModal('TB', '2026-11-12', ['2026-11-12']);
        await sleep(10);
        document.querySelector('input[name="leaveDayPortion"][value="pm"]').checked = true;
        document.getElementById('absenceTypeSelect').value = 'sick_leave';
        onAbsenceTypeChange();
        await saveVacationSelection();
        await sleep(30);
        const pm = rowsOn('TB', '2026-11-12')[0];
        ok('afternoon of sick leave saved', pm && pm.day_portion === 'pm' && pm.absence_type === 'sick_leave' && pm.vacation_type === 'not_charged');

        // Several days: half day not allowed, always full.
        showVacationOptionsModal('TB', '2026-11-16', ['2026-11-16', '2026-11-17']);
        await sleep(10);
        const multi = Array.from(document.querySelectorAll('input[name="leaveDayPortion"]'));
        ok('half days disabled when several days are selected', multi[1].disabled && multi[2].disabled && !document.getElementById('leaveDayPortionHint').hidden);
        multi[1].checked = true; // even if forced, it is ignored
        await saveVacationSelection();
        await sleep(30);
        ok('multi-day booking is saved as full days', rowsOn('TB', '2026-11-16')[0].day_portion === 'full' && rowsOn('TB', '2026-11-17')[0].day_portion === 'full');

        // Reopening resets to full day.
        showVacationOptionsModal('TB', '2026-11-18', ['2026-11-18']);
        await sleep(10);
        ok('modal resets to Full day', document.querySelector('input[name="leaveDayPortion"][value="full"]').checked);
        closeVacationOptionsModal();

        // ---- Counting --------------------------------------------------------
        ok('a half day counts as 0.5', getLeaveDays(am) === 0.5 && getLeaveDays({ days_count: 1 }) === 1 && getLeaveDays({ days_count: 1, day_portion: 'full' }) === 1);
        ok('rows without the column count as full days', !isHalfDayLeave({ days_count: 1 }));

        const off = getWeekDaysOff('TB', '2026-11-09');
        ok('capacity: two half days = 1 day off that week', off.absences === 1 && off.holidays === 0, JSON.stringify(off));
        const cap = computeWeekCapacity('2026-11-09').TB;
        ok('capacity baseline shrinks by half a day each', cap && cap.baselineHours === 32, cap && cap.baselineHours);
        const capNext = computeWeekCapacity('2026-11-16').TB;
        ok('full days still remove a whole day', capNext && capNext.baselineHours === 24, capNext && capNext.baselineHours);

        currentMonth = new Date(2026, 10, 1);
        vacationBalanceYear = 2026;
        const summaryHtml = renderVacationSummary();
        const tbRow = (summaryHtml.split('vacation-balance-row').find(chunk => chunk.indexOf('>TB<') !== -1) || '');
        ok('leave balance: 0.5 + 2 full days = 2.5', /2\.5<span class="vacation-balance-max">/.test(tbRow), tbRow.replace(/\s+/g, ' ').slice(0, 200));
        ok('sick half day listed apart, as 0.5', /0\.5 sick leave/.test(tbRow));
        const monthHtml = buildVacationMonthDistributionHtml(2026);
        ok('month chart counts 3 person-days in November (0.5 + 0.5 + 1 + 1)', /Nov 2026: 3 person-day/.test(monthHtml),
            (monthHtml.match(/Nov 2026: [^"]*/) || [''])[0]);

        // ---- Team calendar ---------------------------------------------------
        switchView('equipo');
        await sleep(80);
        const amCell = Array.from(document.querySelectorAll('#teamView td.leave-half--am')).find(td => /TB · Wed 11 Nov/.test(td.title));
        ok('calendar cell for the morning is split (am)', !!amCell, amCell ? amCell.className : 'none');
        ok('tooltip says morning only', amCell && /morning only/.test(amCell.title));
        const pmCell = Array.from(document.querySelectorAll('#teamView td.leave-half--pm')).find(td => /TB · Thu 12 Nov/.test(td.title));
        ok('calendar cell for the afternoon is split (pm), keeping its absence style', !!pmCell && pmCell.classList.contains('absence-other'));
        if (amCell) {
            const after = getComputedStyle(amCell, '::after');
            ok('half cell really covers half (clip-path on ::after)', after.content !== 'none' && after.clipPath && after.clipPath !== 'none', after.clipPath);
        }
        ok('legend explains half days', /Half day/.test(document.getElementById('teamView').innerHTML));

        // ---- Daily header ----------------------------------------------------
        switchView('daily');
        currentWeekStart = getMonday(new Date(2026, 10, 11));
        renderDaily();
        await sleep(30);
        const halfBadge = document.querySelector('#dailyTableContainer .vacation-badge--half');
        ok('Daily header marks the half day with ½', !!halfBadge && halfBadge.textContent === 'TB½' && /morning off/.test(halfBadge.title));

        // ---- Removing --------------------------------------------------------
        let asked = '';
        window.confirm = msg => { asked = msg; return true; };
        switchView('equipo');
        await sleep(40);
        toggleVacation('TB', '2026-11-11', null);
        await sleep(40);
        ok('removing asks about the half day', /half-day leave \(morning\)/.test(asked), asked);
        ok('and removes only that row', rowsOn('TB', '2026-11-11').length === 0 && rowsOn('TB', '2026-11-12').length === 1);

        results.push('INFO | driver7 finished');
        flush();
    }

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => main().catch(err => { ok('driver crashed', false, err && (err.stack || err.message)); }), 50);
    });
})();
