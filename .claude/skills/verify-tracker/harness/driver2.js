window.__driver2Loaded = true;
// Drives the hours/capacity model, archive+bin, inline rename, the task
// detail modal and the dashboard allocation table.
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
    const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.01;

    window.addEventListener('error', e => {
        results.push('FAIL | uncaught: ' + e.message + ' @' + e.lineno);
        flush();
    });

    async function main() {
        try { localStorage.setItem('wtw_current_user', 'TB'); } catch (e) {}
        try { localStorage.removeItem('pt_capacity_units_v1'); } catch (e) {}

        currentUser = 'TB';
        await enterApplication();
        await sleep(120);

        const monday = formatDateKey(getMonday(new Date()));
        const wednesday = (() => {
            const d = getMonday(new Date());
            d.setDate(d.getDate() + 2);
            return formatDateKey(d);
        })();

        // ---- Per-person baseline from app_users.weekly_hours -------------
        ok('baseline read per person (AD is part-time 20h)',
            getUserWeeklyHours('TB') === 40 && getUserWeeklyHours('AD') === 20,
            'TB=' + getUserWeeklyHours('TB') + ' AD=' + getUserWeeklyHours('AD'));
        ok('unknown person falls back to the default',
            getUserWeeklyHours('ZZ') === 40, String(getUserWeeklyHours('ZZ')));

        // ---- Even split across responsibles ------------------------------
        switchView('daily');
        await sleep(40);
        openDailyCommentModalFromCell(new Event('click'), 'p1', wednesday);
        await sleep(40);

        ok('task form pre-selects the creator',
            dailyTaskResponsibles.length === 1 && dailyTaskResponsibles[0] === 'TB',
            JSON.stringify(dailyTaskResponsibles));

        toggleDailyTaskResponsible('JG');
        document.getElementById('commentHours').value = '8';
        onDailyTaskHoursChange();
        document.getElementById('commentText').value = 'Move the flow to UAT';
        document.getElementById('commentDescription').value = 'Needs the UAT connector re-pointed first.';
        await saveDailyComment();
        await sleep(80);

        const saved = window.__DB.daily_comments[window.__DB.daily_comments.length - 1];
        ok('task saved with both responsibles',
            !!saved && saved.responsibles.includes('TB') && saved.responsibles.includes('JG'),
            saved ? JSON.stringify(saved.responsibles) : 'none');
        ok('legacy `responsible` column still mirrored',
            !!saved && saved.responsible === 'TB', saved && saved.responsible);
        ok('estimated hours stored', !!saved && Number(saved.estimated_hours) === 8,
            saved && String(saved.estimated_hours));
        ok('description stored', !!saved && saved.description.indexOf('connector') !== -1);
        ok('even split leaves hours_by_assignee empty',
            !!saved && Object.keys(saved.hours_by_assignee || {}).length === 0,
            JSON.stringify(saved && saved.hours_by_assignee));

        const task = dailyComments.find(c => c.id === saved.id);
        ok('8h over 2 people = 4h each',
            near(getTaskHoursForUser(task, 'TB'), 4) && near(getTaskHoursForUser(task, 'JG'), 4),
            'TB=' + getTaskHoursForUser(task, 'TB') + ' JG=' + getTaskHoursForUser(task, 'JG'));
        ok('a non-responsible carries 0h', getTaskHoursForUser(task, 'IM') === 0);
        ok('task total is the sum of the shares', near(getTaskTotalHours(task), 8),
            String(getTaskTotalHours(task)));

        // ---- Capacity rolls that up --------------------------------------
        let cap = computeWeekCapacity(monday);
        ok('capacity picks up the task hours',
            near(cap.TB.taskHours, 4) && near(cap.JG.taskHours, 4),
            'TB=' + cap.TB.taskHours + ' JG=' + cap.JG.taskHours);
        ok('percent uses the person baseline', cap.TB.percent === 10,
            cap.TB.percent + '% of ' + cap.TB.baselineHours + 'h');
        ok('pending hours tracked separately', near(cap.TB.pendingHours, 4),
            String(cap.TB.pendingHours));
        ok('hours attributed to the project',
            near(cap.TB.byProject.p1, 4), JSON.stringify(cap.TB.byProject));

        // ---- Custom split overrides the even one -------------------------
        editingCommentId = saved.id;
        openDailyCommentModal(wednesday, 'p1');
        await sleep(50);
        ok('edit reopens with both responsibles',
            dailyTaskResponsibles.length === 2, JSON.stringify(dailyTaskResponsibles));

        toggleDailyTaskHoursSplit();
        await sleep(20);
        ok('split mode prefills the even share',
            near(dailyTaskHoursByAssignee.TB, 4) && near(dailyTaskHoursByAssignee.JG, 4),
            JSON.stringify(dailyTaskHoursByAssignee));

        setDailyTaskHoursFor('TB', 10);
        setDailyTaskHoursFor('JG', 2);
        await sleep(20);
        ok('total follows the custom split',
            near(document.getElementById('commentHours').value, 12),
            document.getElementById('commentHours').value);

        await saveDailyComment();
        await sleep(80);

        const saved2 = window.__DB.daily_comments.find(c => c.id === saved.id);
        ok('custom split persisted',
            !!saved2 && near(saved2.hours_by_assignee.TB, 10) && near(saved2.hours_by_assignee.JG, 2),
            JSON.stringify(saved2 && saved2.hours_by_assignee));
        ok('total rewritten as the sum', !!saved2 && near(saved2.estimated_hours, 12),
            String(saved2 && saved2.estimated_hours));

        cap = computeWeekCapacity(monday);
        ok('capacity honours the custom split',
            near(cap.TB.taskHours, 10) && near(cap.JG.taskHours, 2),
            'TB=' + cap.TB.taskHours + ' JG=' + cap.JG.taskHours);
        ok('percent follows (10/40 = 25%)', cap.TB.percent === 25, String(cap.TB.percent));

        // ---- Day tasks feed the same number ------------------------------
        window.__DB.day_tasks.push({
            id: 'dt-cap', task_date: wednesday, text: 'Pair on the deploy',
            project_id: 'p1', assignees: ['JG'], estimated_hours: 6,
            hours_by_assignee: {}, description: '', created_by: 'TB',
            completed: false, created_at: new Date().toISOString()
        });
        await loadDayTasks();
        cap = computeWeekCapacity(monday);
        ok('team day tasks count too (JG 2h + 6h)', near(cap.JG.taskHours, 8),
            String(cap.JG.taskHours));

        // ---- Completed tasks still count ---------------------------------
        window.__DB.day_tasks.push({
            id: 'dt-done', task_date: wednesday, text: 'Already finished',
            project_id: 'p1', assignees: ['IM'], estimated_hours: 5,
            hours_by_assignee: {}, description: '', created_by: 'TB',
            completed: true, created_at: new Date().toISOString()
        });
        await loadDayTasks();
        cap = computeWeekCapacity(monday);
        ok('done tasks stay in the allocation', near(cap.IM.taskHours, 5), String(cap.IM.taskHours));
        ok('but are excluded from pending', near(cap.IM.pendingHours, 0), String(cap.IM.pendingHours));

        // ---- Manual override wins ----------------------------------------
        currentProjectId = 'p1';
        switchView('ficha');
        await sleep(80);
        ok('capacity widget rendered', !!document.getElementById('capacityWidget'));
        ok('widget shows computed hours, not inputs',
            document.querySelectorAll('#capacityWidget .capacity-bar').length >= 5 &&
            document.querySelectorAll('#capacityWidget input.capacity-input').length === 0,
            document.querySelectorAll('#capacityWidget .capacity-bar').length + ' bars');

        capacityWeekStart = getMonday(new Date());
        startCapacityOverrideEdit('TB');
        await sleep(40);
        document.getElementById('capacityOverrideInput').value = '36';
        await saveCapacityOverride('TB');
        await sleep(60);

        ok('override persisted once', window.__DB.user_capacity_overrides.length === 1,
            String(window.__DB.user_capacity_overrides.length));
        cap = computeWeekCapacity(monday);
        ok('override wins over the computed hours',
            near(cap.TB.effectiveHours, 36) && cap.TB.percent === 90,
            cap.TB.effectiveHours + 'h / ' + cap.TB.percent + '%');
        ok('computed value kept alongside it', near(cap.TB.taskHours, 10),
            String(cap.TB.taskHours));

        // upsert twice must not duplicate (composite primary key)
        startCapacityOverrideEdit('TB');
        await sleep(30);
        document.getElementById('capacityOverrideInput').value = '20';
        await saveCapacityOverride('TB');
        await sleep(50);
        ok('re-saving an override updates, does not duplicate',
            window.__DB.user_capacity_overrides.length === 1 &&
            near(window.__DB.user_capacity_overrides[0].override_hours, 20),
            window.__DB.user_capacity_overrides.length + ' rows');

        await clearCapacityOverride('TB');
        await sleep(50);
        cap = computeWeekCapacity(monday);
        ok('clearing the override returns to computed',
            window.__DB.user_capacity_overrides.length === 0 && near(cap.TB.effectiveHours, 10),
            String(cap.TB.effectiveHours));

        // ---- Dashboard allocation widget ---------------------------------
        // Same widget as the project card (driver3 covers its navigation).
        switchView('dashboard');
        await sleep(90);
        const dashWidget = document.getElementById('dashboardCapacityWidget');
        const totalRow = dashWidget && dashWidget.querySelector('.capacity-total');
        ok('dashboard has a team total row', !!totalRow,
            totalRow ? totalRow.textContent.replace(/\s+/g, ' ').trim() : 'missing');
        ok('dashboard shows one bar per person',
            !!dashWidget && dashWidget.querySelectorAll('.capacity-row').length >= 5,
            dashWidget ? String(dashWidget.querySelectorAll('.capacity-row').length) : 'missing');
        const tbFigure = dashWidget && dashWidget.querySelector('.capacity-figure');
        ok('figures show percent and hours together',
            !!tbFigure && /%/.test(tbFigure.textContent) && /\/\d+(\.\d)?h/.test(tbFigure.textContent),
            tbFigure ? tbFigure.textContent.replace(/\s+/g, ' ').trim() : 'missing');
        ok('old unit-toggle table is gone', !document.querySelector('.capacity-table, .cap-toggle'));

        // ---- Inline rename from the project card --------------------------
        currentProjectId = 'p1';
        switchView('ficha');
        await sleep(70);
        const titleInput = document.querySelector('.ficha-title-input');
        ok('project name is an inline input', !!titleInput, titleInput && titleInput.value);

        titleInput.value = '  Claims Automation X  ';
        await renameProjectInline('p1', titleInput);
        await sleep(60);
        ok('inline rename trims and saves',
            window.__DB.projects.find(p => p.id === 'p1').name === 'Claims Automation X',
            window.__DB.projects.find(p => p.id === 'p1').name);

        titleInput.value = '   ';
        await renameProjectInline('p1', titleInput);
        await sleep(40);
        ok('blank inline rename reverts',
            window.__DB.projects.find(p => p.id === 'p1').name === 'Claims Automation X' &&
            titleInput.value === 'Claims Automation X',
            titleInput.value);

        // ---- Task detail modal -------------------------------------------
        const clickable = document.querySelector('.comment-text--clickable');
        ok('daily comments panel items are clickable', !!clickable);
        openTaskDetail(saved.id);
        await sleep(60);
        ok('detail modal opens',
            document.getElementById('taskDetailModal').classList.contains('active'));
        const detailText = document.getElementById('taskDetailBody').textContent;
        ok('detail shows the description', detailText.indexOf('connector') !== -1);
        ok('detail shows per-person hours',
            detailText.indexOf('10h') !== -1 && detailText.indexOf('2h') !== -1,
            detailText.replace(/\s+/g, ' ').slice(0, 120));
        ok('detail shows the total effort', detailText.indexOf('12') !== -1);

        const beforeDone = dailyComments.find(c => c.id === saved.id).completed;
        closeTaskDetailModal();
        await sleep(40);
        ok('closing the detail does not complete the task',
            dailyComments.find(c => c.id === saved.id).completed === beforeDone,
            'completed=' + dailyComments.find(c => c.id === saved.id).completed);
        ok('detail modal closed',
            !document.getElementById('taskDetailModal').classList.contains('active'));

        // ---- Archive ------------------------------------------------------
        const liveBefore = getLiveProjects().length;
        await setProjectArchived('p1', true);
        await sleep(70);
        ok('archived project leaves the live set',
            getLiveProjects().length === liveBefore - 1, String(getLiveProjects().length));
        ok('archive stamped in the database',
            !!window.__DB.projects.find(p => p.id === 'p1').archived_at);
        ok('archived project groups as archivados',
            getProjectGroup(findAnyProject('p1')) === 'archivados');
        ok('it moved to the Archived list in the sidebar',
            (document.getElementById('projectsListArchived').textContent || '').indexOf('Claims Automation X') !== -1);
        ok('and left the Active list',
            (document.getElementById('projectsListActive').textContent || '').indexOf('Claims Automation X') === -1);

        switchView('dashboard');
        await sleep(70);
        ok('dashboard excludes archived projects',
            (document.getElementById('dashboardView').textContent || '').indexOf('Claims Automation X') === -1);

        cap = computeWeekCapacity(monday);
        ok('archived project hours still count in capacity',
            near(cap.TB.taskHours, 10), String(cap.TB.taskHours));

        await setProjectArchived('p1', false);
        await sleep(60);
        ok('unarchive puts it back',
            getLiveProjects().some(p => p.id === 'p1') &&
            !window.__DB.projects.find(p => p.id === 'p1').archived_at);

        // ---- Bin ----------------------------------------------------------
        await moveProjectToBin('p1');
        await sleep(70);
        ok('binned project leaves `projects`', !projects.some(p => p.id === 'p1'));
        ok('binned project is in deletedProjects', deletedProjects.some(p => p.id === 'p1'));
        ok('soft delete only: row still exists',
            !!window.__DB.projects.find(p => p.id === 'p1') &&
            !!window.__DB.projects.find(p => p.id === 'p1').deleted_at);
        ok('its comments are untouched',
            window.__DB.daily_comments.some(c => c.project_id === 'p1'));
        ok('it shows in the Bin list',
            (document.getElementById('projectsListDeleted').textContent || '').indexOf('Claims Automation X') !== -1);
        ok('findAnyProject still resolves it', !!findAnyProject('p1'));

        switchView('ficha');
        currentProjectId = 'p1';
        renderFicha();
        await sleep(50);
        ok('binned project card shows a restore banner',
            !!document.querySelector('.ficha-state-banner--deleted'));

        await restoreProjectFromBin('p1');
        await sleep(70);
        ok('restore brings it back to projects', projects.some(p => p.id === 'p1'));
        ok('and clears deleted_at',
            !window.__DB.projects.find(p => p.id === 'p1').deleted_at);

        // ---- Permanent delete --------------------------------------------
        await moveProjectToBin('p1');
        await sleep(60);
        await deleteProjectForever('p1');
        await sleep(90);
        ok('permanent delete removes the row',
            !window.__DB.projects.some(p => p.id === 'p1'));
        ok('and it is gone from both lists',
            !projects.some(p => p.id === 'p1') && !deletedProjects.some(p => p.id === 'p1'));

        // ---- Views still render ------------------------------------------
        switchView('daily');
        await sleep(50);
        ok('daily still renders', (document.getElementById('dailyTableContainer').textContent || '').length > 0);
        switchView('dashboard');
        await sleep(50);
        ok('dashboard still renders', (document.getElementById('dashboardView').textContent || '').length > 0);
        switchView('equipo');
        await sleep(50);
        ok('team view still renders', (document.getElementById('teamView').textContent || '').length > 0);
    }

    document.addEventListener('DOMContentLoaded', () => {
        results.push('INFO | started');
        flush();
        main().then(
            () => { results.push('INFO | driver2 finished'); flush(); },
            err => { results.push('FAIL | main rejected: ' + (err && err.stack ? err.stack : err)); flush(); }
        );
    });
})();
