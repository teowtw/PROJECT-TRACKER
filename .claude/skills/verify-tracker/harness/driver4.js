window.__driver4Loaded = true;
// Drives regional public holidays, absence types (vacation / sick leave /
// personal matter), "Next year" balance, absence privacy and the capacity
// reduction for days off. Dates are fixed (Nov 2026) so the result does
// not depend on the day the suite runs.
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
    const rowsFor = (user, date) => DB.team_vacations.filter(v => v.user_initials === user && v.start_date === date);

    async function main() {
        try { localStorage.setItem('wtw_current_user', 'TB'); } catch (e) {}
        currentUser = 'TB';
        await enterApplication();
        await sleep(120);

        // ---- Regions ------------------------------------------------------
        ok('default regions', getMemberRegion('TB') === 'ES-VC-ALC' && getMemberRegion('AR') === 'ES-MD' &&
            getMemberRegion('JG') === 'ES-MD' && getMemberRegion('IM') === 'PT-LIS' && getMemberRegion('AD') === 'IN-MH',
            ['TB', 'AR', 'JG', 'IM', 'AD'].map(getMemberRegion).join(','));
        ok('9 Nov 2026 (Almudena) is a holiday in Madrid only',
            isHolidayForMember('AR', '2026-11-09') && isHolidayForMember('JG', '2026-11-09') && !isHolidayForMember('TB', '2026-11-09'));
        ok('7 Dec 2026 is a holiday in Madrid (was missing before)', isHolidayForMember('AR', '2026-12-07') && !isHolidayForMember('TB', '2026-12-07'));
        ok('Santa Faz (16 Apr 2026) is a holiday in Alicante only', isHolidayForMember('TB', '2026-04-16') && !isHolidayForMember('AR', '2026-04-16'));
        ok('Easter Monday 2026 is a Valencian holiday, not a Madrid one', isHolidayForMember('TB', '2026-04-06') && !isHolidayForMember('AR', '2026-04-06'));
        ok('Santo António (13 Jun) is a Lisbon holiday', isHolidayForMember('IM', '2027-06-13') && !isHolidayForMember('TB', '2027-06-13'));
        ok('holiday name is available', getHolidayName('ES-MD', '2026-11-09').indexOf('Almudena') !== -1);

        userDirectory.IM.holidayRegion = normalizeHolidayRegion('es-md');
        ok('app_users.holiday_region overrides the default', getMemberRegion('IM') === 'ES-MD' && isHolidayForMember('IM', '2026-11-09'));
        userDirectory.IM.holidayRegion = normalizeHolidayRegion('XX-NOPE');
        ok('unknown region codes are ignored', getMemberRegion('IM') === 'PT-LIS');

        // ---- The reported bug: TB can now book 9 Nov 2026 ----------------
        await addVacationWithDateRange('TB', ['2026-11-09'], 'current_year', 2026);
        ok('TB can book leave on 9 Nov 2026', rowsFor('TB', '2026-11-09').length === 1);
        await addVacationWithDateRange('AR', ['2026-11-09'], 'current_year', 2026);
        ok('AR still cannot (it is her holiday)', rowsFor('AR', '2026-11-09').length === 0);
        ok('existing inserts default to vacation', rowsFor('TB', '2026-11-09')[0].absence_type === 'vacation');

        // ---- Absence modal ------------------------------------------------
        switchView('equipo');
        await sleep(60);
        showVacationOptionsModal('TB', '2026-11-10', ['2026-11-10']);
        await sleep(30);
        const typeOptions = Array.from(document.querySelectorAll('#vacationTypeSelect option')).map(o => o.value);
        const reasonOptions = Array.from(document.querySelectorAll('#absenceTypeSelect option')).map(o => o.textContent);
        ok('balance offers Next year', typeOptions.indexOf('next_year') !== -1, typeOptions.join(','));
        ok('reasons offered', JSON.stringify(reasonOptions) === '["Vacation","Sick leave","Personal matter"]', JSON.stringify(reasonOptions));
        ok('balance selector visible for vacation', document.getElementById('vacationTypeGroup').hidden === false);

        document.getElementById('absenceTypeSelect').value = 'sick_leave';
        onAbsenceTypeChange();
        ok('balance selector hidden for sick leave', document.getElementById('vacationTypeGroup').hidden === true);
        await saveVacationSelection();
        await sleep(40);
        const sick = rowsFor('TB', '2026-11-10')[0];
        ok('sick leave saved as not charged',
            !!sick && sick.absence_type === 'sick_leave' && sick.vacation_type === 'not_charged',
            sick ? sick.absence_type + '/' + sick.vacation_type : 'missing');

        showVacationOptionsModal('TB', '2026-11-11', ['2026-11-11']);
        await sleep(20);
        document.getElementById('absenceTypeSelect').value = 'vacation';
        onAbsenceTypeChange();
        document.getElementById('vacationTypeSelect').value = 'next_year';
        await saveVacationSelection();
        await sleep(40);
        const next = rowsFor('TB', '2026-11-11')[0];
        const thisYear = new Date().getFullYear();
        ok('Next year stored against next year',
            !!next && next.vacation_type === 'next_year' && Number(next.vacation_year) === thisYear + 1,
            next ? next.vacation_type + ' ' + next.vacation_year : 'missing');

        showVacationOptionsModal('TB', '2026-11-12', ['2026-11-12']);
        await sleep(20);
        document.getElementById('absenceTypeSelect').value = 'personal';
        onAbsenceTypeChange();
        await saveVacationSelection();
        await sleep(40);
        ok('personal matter saved', (rowsFor('TB', '2026-11-12')[0] || {}).absence_type === 'personal');

        // ---- Balance: only vacation counts ----------------------------------
        vacationBalanceYear = 2026;
        renderTeamView();
        await sleep(40);
        const tbRow = () => Array.from(document.querySelectorAll('.vacation-balance-row'))
            .find(r => r.querySelector('.vacation-balance-name').textContent.trim() === 'TB');
        ok('balance counts only the vacation day (1.0)', /^1\.0/.test(tbRow().querySelector('.vacation-balance-figure').textContent.trim()),
            tbRow().querySelector('.vacation-balance-figure').textContent.trim());
        ok('owner sees the reasons', /1 sick leave/.test(tbRow().textContent) && /1 personal matter/.test(tbRow().textContent),
            tbRow().textContent.replace(/\s+/g, ' '));

        vacationBalanceYear = thisYear + 1;
        renderTeamView();
        await sleep(30);
        ok('next-year day shows in next year balance', /^1\.0/.test(tbRow().querySelector('.vacation-balance-figure').textContent.trim()),
            tbRow().querySelector('.vacation-balance-figure').textContent.trim());

        // ---- Privacy: another user only sees "Absent" -----------------------
        const sickRow = teamVacations.find(v => v.start_date === '2026-11-10');
        ok('owner tooltip shows the reason', describeAbsenceFor(sickRow, 'TB') === 'Sick leave');
        ok('others see "Absent"', describeAbsenceFor(sickRow, 'JG') === 'Absent');
        ok('vacation still reads as Leave for everyone',
            describeAbsenceFor(teamVacations.find(v => v.start_date === '2026-11-09'), 'JG') === 'Leave');

        currentUser = 'JG';
        vacationBalanceYear = 2026;
        teamViewMode = 'week';
        teamRefDate = new Date(2026, 10, 10);
        renderTeamView();
        await sleep(40);
        const calendarHtml = Array.from(document.querySelectorAll('#teamView .calendar-table')).map(t => t.innerHTML).join('') + tbRow().innerHTML;
        ok('JG never sees the reason of TB (calendar cells + TB summary row)', calendarHtml.length > 0 && !/sick/i.test(calendarHtml) && !/personal matter/i.test(calendarHtml));
        ok('JG sees TB as absent in the summary', /2 absent/.test(tbRow().textContent), tbRow().textContent.replace(/\s+/g, ' '));
        ok('absence cell uses the neutral style', !!document.querySelector('#teamView td.absence-other'));
        currentUser = 'TB';

        // ---- Capacity reduced by days off -----------------------------------
        // Week of Mon 9 Nov 2026: AR/JG have Almudena (1 holiday);
        // TB has vacation Mon, sick Tue, next-year vacation Wed, personal Thu (4 days off);
        // AD has Diwali (Bali Pratipada) on Tue 10 Nov in Mumbai.
        const cap = computeWeekCapacity('2026-11-09');
        ok('AR available hours drop by the holiday (40 -> 32)', cap.AR.baselineHours === 32 && cap.AR.daysOff.holidays === 1,
            cap.AR.baselineHours + 'h');
        ok('TB available hours drop by all absences, charged or not (40 -> 8)', cap.TB.baselineHours === 8 && cap.TB.daysOff.absences === 4,
            cap.TB.baselineHours + 'h');
        ok('IM (Lisbon) is unaffected', cap.IM.baselineHours === 40, cap.IM.baselineHours + 'h');
        ok('AD part-time base minus Diwali (20 -> 16)', cap.AD.baselineHours === 16 && cap.AD.daysOff.holidays === 1, cap.AD.baselineHours + 'h');

        dashboardCapacityWeekStart = new Date(2026, 10, 9);
        switchView('dashboard');
        await sleep(80);
        const dw = document.getElementById('dashboardCapacityWidget');
        const arRow = Array.from(dw.querySelectorAll('.capacity-row')).find(r => r.querySelector('.capacity-user-icon').textContent.trim() === 'AR');
        ok('widget explains the reduction', !!arRow && /1 holiday/.test(arRow.textContent) && /\/32h/.test(arRow.textContent),
            arRow ? arRow.textContent.replace(/\s+/g, ' ') : 'missing');
        const tbCap = Array.from(dw.querySelectorAll('.capacity-row')).find(r => r.querySelector('.capacity-user-icon').textContent.trim() === 'TB');
        ok('widget does not leak the absence reason', !!tbCap && /4 days off/.test(tbCap.textContent) && !/sick/i.test(tbCap.textContent),
            tbCap ? tbCap.textContent.replace(/\s+/g, ' ') : 'missing');

        // ---- Daily header names who is off ---------------------------------
        currentWeekStart = new Date(2026, 10, 9);
        switchView('daily');
        await sleep(80);
        const badge = document.querySelector('.holiday-badge');
        ok('Daily holiday badge says where and for whom',
            !!badge && /Madrid \(AR, JG\): Almudena/.test(badge.getAttribute('title')),
            badge ? badge.getAttribute('title') : 'no badge');

        // ---- Pending calendars warning ---------------------------------------
        switchView('equipo');
        teamViewMode = 'year';
        currentMonth = new Date(2027, 0, 1);
        renderTeamView();
        await sleep(40);
        const status = document.querySelector('.holiday-calendar-status');
        ok('2027 warns about incomplete regions',
            !!status && /Alicante/.test(status.textContent) && /Mumbai/.test(status.textContent) && !/Madrid/.test(status.textContent),
            status ? status.textContent : 'none');
        currentMonth = new Date(2026, 0, 1);
        renderTeamView();
        await sleep(30);
        ok('2026 is complete, no warning', !document.querySelector('.holiday-calendar-status'));

        results.push('INFO | driver4 finished');
        flush();
    }

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => main().catch(err => { ok('driver crashed', false, err && (err.stack || err.message)); }), 50);
    });
})();
