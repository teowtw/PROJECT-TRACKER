window.__driver3Loaded = true;
// Drives the October 2026 feedback features: task detail inside
// Day Comments, the sidebar project search, the dashboard capacity
// widget, the view icons, and the priority colour scale.
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

    function todayKey() {
        const d = new Date();
        return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    }

    // Seed before the app reads the store.
    const DB = window.__DB;
    const today = todayKey();
    DB.projects.push({
        id: 'p2', name: 'Operación Payroll', start_date: '2026-09-01', end_date: null,
        phase: 'Testing', bau_owner: null, stakeholders: 'HR Iberia', benefits: '', description: 'Monthly payroll reconciliation bot',
        country: 'Spain', volume: 0, fte: 0, priority: 'Media', impact: 'Medio',
        status: 'Verde', progress: 10, prerequisites: [], responsibles: ['JG'],
        created_at: '2026-09-02T00:00:00Z'
    });
    DB.daily_comments.push({
        id: 'c1', project_id: 'p1', parent_id: null, date: today, time: '09:00',
        text: 'Deploy connector to UAT', responsible: 'TB', responsibles: ['TB', 'JG'],
        is_personal: false, owner_initials: 'TB', user_name: 'TB', urgency: 'Máxima',
        has_incident: false, completed: false, description: 'Needs the new API key from IT',
        estimated_hours: 6, hours_by_assignee: {}, created_at: today + 'T09:00:00Z'
    });

    async function main() {
        try { localStorage.setItem('wtw_current_user', 'TB'); } catch (e) {}
        currentUser = 'TB';
        await enterApplication();
        await sleep(120);

        // ---- 1. Task detail inside Day Comments --------------------------
        openCommentsList(new Event('click'), 'p1', today);
        await sleep(60);
        const list = document.getElementById('commentsListContainer');
        ok('day comments lists all responsibles',
            list.textContent.indexOf('TB, JG') !== -1, list.textContent.replace(/\s+/g, ' ').slice(0, 140));
        ok('urgency badge visible without expanding',
            !!list.querySelector('.prio-badge.prio-critical'));
        ok('description hidden until expanded',
            list.textContent.indexOf('API key') === -1);

        const toggle = list.querySelector('.comment-text--clickable');
        ok('task title is a disclosure button',
            !!toggle && toggle.getAttribute('aria-expanded') === 'false');
        toggle.click();
        await sleep(60);
        const list2 = document.getElementById('commentsListContainer');
        ok('clicking the task shows the description',
            list2.textContent.indexOf('Needs the new API key from IT') !== -1);
        ok('detail shows urgency label', list2.querySelector('.comment-detail .prio-critical') !== null);
        ok('detail shows per-person hours (6h / 2 = 3h)',
            list2.querySelector('.comment-detail').textContent.indexOf('3h') !== -1);
        ok('disclosure reports expanded',
            list2.querySelector('.comment-text--clickable').getAttribute('aria-expanded') === 'true');

        // Survives a realtime-style re-render
        renderCommentsListContent('p1', today);
        ok('expanded state survives a re-render',
            document.getElementById('commentsListContainer').textContent.indexOf('API key') !== -1);

        document.querySelector('.comment-detail-open').click();
        await sleep(60);
        ok('"Open full details" opens the task modal on top',
            document.getElementById('taskDetailModal').classList.contains('active') &&
            document.getElementById('commentsListModal').classList.contains('active'));
        closeTopModal();
        await sleep(40);
        ok('Esc-style close only closes the detail',
            !document.getElementById('taskDetailModal').classList.contains('active') &&
            document.getElementById('commentsListModal').classList.contains('active'));

        document.querySelector('#commentsListContainer .comment-text--clickable').click();
        await sleep(40);
        ok('clicking again collapses', document.getElementById('commentsListContainer').textContent.indexOf('API key') === -1);
        closeCommentsListModal();

        ok('priority level mapping',
            getPriorityLevel('Baja') === 'low' && getPriorityLevel('Crítica') === 'critical' &&
            getUrgencyLevel('Normal') === 'medium' && getUrgencyLevel('Alta') === 'high');


        // ---- 2. Sidebar project search ------------------------------------
        const input = document.getElementById('sidebarProjectSearch');
        ok('search box sits between New Project and the lists',
            !!input && input.closest('.sidebar') &&
            document.querySelector('.btn-new-project').compareDocumentPosition(input) & Node.DOCUMENT_POSITION_FOLLOWING &&
            input.compareDocumentPosition(document.getElementById('sidebarTitleActivos')) & Node.DOCUMENT_POSITION_FOLLOWING);

        const sidebarNames = () => Array.from(document.querySelectorAll('#sidebar .projects-list:not([hidden]) .project-item-select')).map(b => b.textContent.trim());

        input.value = 'operacion';
        input.dispatchEvent(new Event('input'));
        await sleep(30);
        ok('accent-insensitive match', JSON.stringify(sidebarNames()) === '["Operación Payroll"]', JSON.stringify(sidebarNames()));
        ok('match is highlighted', !!document.querySelector('#sidebar .project-item-select mark'));

        setSidebarSearch('reconciliation');
        ok('matches the description', JSON.stringify(sidebarNames()) === '["Operación Payroll"]', JSON.stringify(sidebarNames()));
        setSidebarSearch('france claims');
        ok('multi-word AND across fields (country + name)', JSON.stringify(sidebarNames()) === '["Claims Automation"]', JSON.stringify(sidebarNames()));
        setSidebarSearch('jorge');
        ok('matches an owner by e-mail name', JSON.stringify(sidebarNames()) === '["Operación Payroll"]', JSON.stringify(sidebarNames()));
        setSidebarSearch('testing');
        ok('matches the phase', sidebarNames().indexOf('Operación Payroll') !== -1, JSON.stringify(sidebarNames()));

        setSidebarSearch('zzzz');
        ok('no-match message shown', !document.getElementById('sidebarSearchEmpty').hidden &&
            document.getElementById('sidebarSearchEmpty').textContent.indexOf('zzzz') !== -1);
        ok('empty sections hidden while searching', document.getElementById('sidebarTitleActivos').hidden === true);

        // Archived projects are found too, and the section opens on its own
        projects.find(p => p.id === 'p2').archivedAt = '2026-10-01T00:00:00Z';
        setSidebarSearch('payroll');
        ok('finds archived projects and expands that section',
            document.getElementById('projectsListArchived').classList.contains('expanded') &&
            sidebarNames().indexOf('Operación Payroll') !== -1);
        ok('remembered collapse state untouched', sidebarCollapsed.archivados === true);
        projects.find(p => p.id === 'p2').archivedAt = null;

        input.value = 'claims';
        input.dispatchEvent(new Event('input'));
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await sleep(30);
        ok('Esc clears the search', input.value === '' && sidebarSearchQuery === '' &&
            !document.getElementById('sidebarTitleActivos').hidden && sidebarNames().length >= 2);

        setSidebarSearch('payroll');
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        await sleep(60);
        ok('Enter opens the first match', currentProjectId === 'p2', String(currentProjectId));
        clearSidebarSearch();

        input.blur();
        window.dispatchEvent(new KeyboardEvent('keydown', { key: '/', bubbles: true }));
        await sleep(20);
        ok('"/" focuses the search box', document.activeElement === input);
        input.blur();

        // Dashboard uses the same matcher
        switchView('dashboard');
        await sleep(60);
        setDashboardFilter('proyecto', 'operacion');
        await sleep(60);
        const dashTable = document.querySelector('#dashboardView .dashboard-table');
        const dashText = dashTable ? dashTable.textContent : '(no .dashboard-table)';
        ok('dashboard search is accent-insensitive too',
            dashText.indexOf('Operación Payroll') !== -1 && dashText.indexOf('Claims Automation') === -1);
        setDashboardFilter('proyecto', '');
        await sleep(40);

        // ---- 4. Dashboard Team Weekly Allocation = project Weekly Capacity
        DB.day_tasks.push({
            id: 't1', task_date: today, text: 'Payroll test run', project_id: 'p2', assignees: ['TB'],
            created_by: 'TB', completed: false, description: '', estimated_hours: 4, hours_by_assignee: {},
            created_at: today + 'T10:00:00Z', updated_at: today + 'T10:00:00Z'
        });
        await loadDayTasks();
        capacityWeekStart = getMonday(new Date());
        dashboardCapacityWeekStart = getMonday(new Date());
        switchView('dashboard');
        await sleep(80);
        let dw = document.getElementById('dashboardCapacityWidget');
        ok('dashboard renders the Weekly Capacity widget', !!dw && dw.classList.contains('capacity-widget'));
        ok('titled Team Weekly Allocation', !!dw && dw.querySelector('.widget-title').textContent.trim() === 'Team Weekly Allocation');
        ok('it is the last block of the dashboard',
            !!dw && document.getElementById('dashboardView').lastElementChild.contains(dw));
        ok('current week badge shown', !!dw && !!dw.querySelector('.week-current-badge'));

        const cap = computeWeekCapacity(formatDateKey(getMonday(new Date())));
        const tbRow = Array.from(dw.querySelectorAll('.capacity-row')).find(r => r.querySelector('.capacity-user-icon').textContent.trim() === 'TB');
        ok('TB figures match computeWeekCapacity',
            !!tbRow && tbRow.querySelector('.capacity-figure').textContent.indexOf(cap.TB.percent + '%') !== -1 &&
            tbRow.querySelector('.capacity-figure').textContent.indexOf(formatHours(cap.TB.effectiveHours) + '/' + formatHours(cap.TB.baselineHours) + 'h') !== -1,
            tbRow ? tbRow.querySelector('.capacity-figure').textContent.replace(/\s+/g, ' ') : 'missing');
        ok('detail breaks hours down by project',
            !!tbRow && tbRow.querySelector('.capacity-row-detail').textContent.indexOf('Operación Payroll') !== -1 &&
            tbRow.querySelector('.capacity-row-detail').textContent.indexOf('Claims Automation') !== -1,
            tbRow ? tbRow.querySelector('.capacity-row-detail').textContent : '');

        // Same numbers as the project card widget
        currentProjectId = 'p1';
        switchView('ficha');
        await sleep(80);
        const fichaTotal = document.querySelector('#capacityWidget .capacity-total').textContent.replace(/\s+/g, ' ').trim();
        switchView('dashboard');
        await sleep(80);
        dw = document.getElementById('dashboardCapacityWidget');
        ok('team total identical to the project card',
            dw.querySelector('.capacity-total').textContent.replace(/\s+/g, ' ').trim() === fichaTotal, fichaTotal);

        // Navigation is independent
        dw.querySelectorAll('.widget-nav-btn')[1].click();
        await sleep(40);
        dw = document.getElementById('dashboardCapacityWidget');
        ok('next week moves the dashboard widget', !dw.querySelector('.week-current-badge'));
        ok('...without moving the project card week',
            formatDateKey(capacityWeekStart) === formatDateKey(getMonday(new Date())));
        dw.querySelectorAll('.widget-nav-btn')[0].click();
        await sleep(40);
        ok('previous week comes back', !!document.querySelector('#dashboardCapacityWidget .week-current-badge'));

        // Manual override from the dashboard; only one input id in the DOM
        startCapacityOverrideEdit('JG', 'dashboard');
        await sleep(30);
        ok('override editor opens in the dashboard only',
            !!document.getElementById('dashboardCapacityOverrideInput') && !document.getElementById('capacityOverrideInput'));
        document.getElementById('dashboardCapacityOverrideInput').value = '30';
        await saveCapacityOverride('JG', 'dashboard');
        await sleep(40);
        ok('dashboard override saved for the dashboard week',
            DB.user_capacity_overrides.some(o => o.user_initials === 'JG' && o.week_start === formatDateKey(getMonday(new Date())) && Number(o.override_hours) === 30));
        ok('both widgets show the override',
            /75%/.test(document.querySelector('#dashboardCapacityWidget').textContent) &&
            /75%/.test(document.querySelector('#capacityWidget').textContent));
        await clearCapacityOverride('JG', 'dashboard');
        await sleep(30);
        ok('override cleared', !DB.user_capacity_overrides.some(o => o.user_initials === 'JG'));

        // ---- 5a. View icons ------------------------------------------------
        const viewButtons = Array.from(document.querySelectorAll('.view-toggle button'));
        ok('every view button has an SVG icon',
            viewButtons.length >= 4 && viewButtons.every(b => b.querySelector('svg.view-ico[aria-hidden="true"]')),
            viewButtons.length + ' buttons');
        ok('icons inherit the text colour',
            viewButtons.every(b => getComputedStyle(b.querySelector('svg')).stroke !== 'none'));

        results.push('INFO | driver3 finished');
        flush();
    }

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => main().catch(err => { ok('driver crashed', false, err && (err.stack || err.message)); }), 50);
    });
})();
