window.__driverLoaded = true;
// Drives the real app against the in-memory stub and asserts the behaviours
// that were reported broken.
(function () {
    // Headless blocks on native dialogs; the app uses confirm() for deletes.
    window.confirm = function () { return true; };
    window.alert = function () {};
    const results = [];
    const ok = (name, cond, detail) => {
        results.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (detail ? ' | ' + detail : ''));
        flush();
    };
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function flush() {
        const failed = results.filter(r => r.indexOf('FAIL') === 0).length;
        out('TOTAL=' + results.length + ' FAILED=' + failed + '\n' + results.join('\n'));
    }

    function out(text) {
        const pre = document.getElementById('testout');
        if (pre) pre.textContent = text;
    }

    window.addEventListener('error', e => results.push('FAIL | uncaught: ' + e.message + ' @' + e.lineno));

    async function main() {
        try {
            localStorage.setItem('wtw_current_user', 'TB');
        } catch (e) { /* file:// may block storage */ }

        try {

        currentUser = 'TB';
        await enterApplication();
        await sleep(100);

        // ---- Team directory picked up AD from app_users -------------------
        ok('directory drives teamMembers (AD present)',
            teamMembers.includes('AD') && teamMembers.includes('IM'),
            JSON.stringify(teamMembers));

        // ---- 1. Add a teammate to a project ------------------------------
        switchView('ficha');
        currentProjectId = 'p1';
        renderFicha();
        await sleep(20);

        openResponsiblesPopover('p1');
        await sleep(20);
        const popover = document.getElementById('resp-popover-p1');
        ok('owner popover opens', !!popover);
        ok('owner popover lists every member as a toggle',
            !!popover && popover.querySelectorAll('.resp-popover-btn').length === teamMembers.length,
            popover ? popover.querySelectorAll('.resp-popover-btn').length + ' buttons' : 'no popover');
        ok('already-assigned owner shows as selected',
            !!popover && !!popover.querySelector('.resp-popover-btn[data-responsible="TB"].is-selected'));

        await toggleResponsible('p1', 'IM');
        await sleep(30);

        const proj = projects.find(p => p.id === 'p1');
        ok('IM added to in-memory project', proj.responsibles.includes('IM'), JSON.stringify(proj.responsibles));
        ok('IM persisted to the projects row',
            (window.__DB.projects[0].responsibles || []).includes('IM'),
            JSON.stringify(window.__DB.projects[0].responsibles));

        const badges = document.querySelectorAll('.resp-badge-header');
        const badgeText = Array.from(badges).map(b => b.textContent.trim().replace(/\s+/g, ' ')).join(',');
        ok('IM badge rendered in the project card without a reload',
            badgeText.indexOf('IM') !== -1, badgeText || '(no badges)');

        ok('popover toggle state updated in place',
            !!document.querySelector('#resp-popover-p1 .resp-popover-btn[data-responsible="IM"].is-selected'));

        // ---- 2. Remove a teammate ----------------------------------------
        await toggleResponsible('p1', 'IM');
        await sleep(30);
        ok('IM removed again', !projects.find(p => p.id === 'p1').responsibles.includes('IM'),
            JSON.stringify(projects.find(p => p.id === 'p1').responsibles));
        ok('removal persisted', !(window.__DB.projects[0].responsibles || []).includes('IM'),
            JSON.stringify(window.__DB.projects[0].responsibles));

        // put IM back for later checks
        await toggleResponsible('p1', 'IM');
        await sleep(20);
        closeResponsiblesPopover();

        // ---- 3. Rename a project -----------------------------------------
        openRenameProjectModal('p1');
        await sleep(20);
        const renameInput = document.getElementById('renameProjectInput');
        ok('rename modal prefilled with the current name',
            !!renameInput && renameInput.value === 'Claims Automation', renameInput && renameInput.value);

        renameInput.value = '  Claims Automation v2  ';
        await saveProjectRename();
        await sleep(40);

        ok('project renamed in memory (trimmed)',
            projects.find(p => p.id === 'p1').name === 'Claims Automation v2',
            projects.find(p => p.id === 'p1').name);
        ok('rename persisted', window.__DB.projects[0].name === 'Claims Automation v2', window.__DB.projects[0].name);
        ok('rename modal closed', !document.getElementById('renameProjectModal').classList.contains('active'));
        ok('sidebar shows the new name',
            (document.getElementById('projectsListActive').textContent || '').indexOf('Claims Automation v2') !== -1);

        // empty name must be rejected
        openRenameProjectModal('p1');
        await sleep(20);
        document.getElementById('renameProjectInput').value = '   ';
        await saveProjectRename();
        await sleep(20);
        ok('blank rename rejected', projects.find(p => p.id === 'p1').name === 'Claims Automation v2',
            projects.find(p => p.id === 'p1').name);
        closeRenameProjectModal();

        // ---- 4. Owners on project creation --------------------------------
        openNewProjectModal();
        await sleep(20);
        ok('new-project picker pre-selects the creator',
            newProjectOwners.length === 1 && newProjectOwners[0] === 'TB', JSON.stringify(newProjectOwners));
        ok('new-project picker renders a button per member',
            document.querySelectorAll('#projectOwners .owner-picker-btn').length === teamMembers.length);

        toggleNewProjectOwner('IM');
        toggleNewProjectOwner('JG');
        await sleep(10);
        document.getElementById('projectName').value = 'UAT Migration';
        document.getElementById('projectCountry').value = 'Portugal';
        await saveNewProject();
        await sleep(60);

        const created = window.__DB.projects.find(p => p.name === 'UAT Migration');
        ok('project created', !!created);
        ok('selected owners saved on creation',
            !!created && ['TB', 'IM', 'JG'].every(i => created.responsibles.includes(i)),
            created ? JSON.stringify(created.responsibles) : 'n/a');
        ok('country cleared after creation',
            document.getElementById('projectCountry').value === '',
            '"' + document.getElementById('projectCountry').value + '"');

        // ---- 5. Day team tasks -------------------------------------------
        switchView('daily');
        await sleep(20);
        const thursday = '2026-10-15';
        openDayPersonalTasksModal(null, thursday);
        await sleep(30);

        ok('day modal opened', document.getElementById('dayPersonalTasksModal').classList.contains('active'));
        ok('team task assignee picker rendered',
            document.querySelectorAll('#dayTeamTaskAssignees .owner-picker-btn').length === teamMembers.length);
        ok('assignee picker pre-selects me',
            dayTeamTaskAssignees.length === 1 && dayTeamTaskAssignees[0] === 'TB',
            JSON.stringify(dayTeamTaskAssignees));
        ok('project dropdown offers the projects',
            document.getElementById('dayTeamTaskProject').options.length === projects.length + 1,
            document.getElementById('dayTeamTaskProject').options.length + ' options');

        // the exact scenario from the request: Thursday, tag Jorge
        toggleDayTeamTaskAssignee('JG');
        document.getElementById('dayTeamTaskInput').value = "Move Jorge's Power Automate flow to UAT";
        const projSel = document.getElementById('dayTeamTaskProject');
        projSel.value = 'p1';
        projSel.dispatchEvent(new Event('change'));
        await addDayTeamTask();
        await sleep(40);

        const saved = window.__DB.day_tasks[0];
        ok('team task persisted', !!saved);
        ok('team task on the right date', !!saved && saved.task_date === thursday, saved && saved.task_date);
        ok('team task assigned to TB and JG',
            !!saved && saved.assignees.includes('TB') && saved.assignees.includes('JG'),
            saved ? JSON.stringify(saved.assignees) : 'n/a');
        ok('team task linked to the project', !!saved && saved.project_id === 'p1', saved && saved.project_id);
        ok('team task records its author', !!saved && saved.created_by === 'TB', saved && saved.created_by);

        const listText = document.getElementById('dayTeamTasksList').textContent;
        ok('team task shown in the modal list', listText.indexOf('Power Automate flow to UAT') !== -1);
        ok('assignee chips rendered', document.querySelectorAll('#dayTeamTasksList .day-task-chip').length >= 2,
            document.querySelectorAll('#dayTeamTasksList .day-task-chip').length + ' chips');
        ok('apostrophe in task text did not break the markup',
            !!document.querySelector('#dayTeamTasksList .day-personal-delete'));

        // text with a quote must survive the inline handler round-trip
        const taskId = dayTasks[0].id;
        await toggleDayTeamTask(taskId, true);
        await sleep(30);
        ok('team task can be completed', window.__DB.day_tasks[0].completed === true);

        // the day-header button must reflect team tasks, not just personal ones
        await toggleDayTeamTask(taskId, false);
        await sleep(30);
        ok('day header marks the day as pending',
            getDayHeaderButtonState(thursday) === 'pending', getDayHeaderButtonState(thursday));
        ok('day header title mentions the team task',
            getDayHeaderButtonTitle(thursday).indexOf('team') !== -1, getDayHeaderButtonTitle(thursday));

        // unassigned tasks count as everyone's
        window.__DB.day_tasks.push({
            id: 'unassigned-1', task_date: thursday, text: 'Nobody picked this up',
            project_id: null, assignees: [], created_by: 'AR', completed: false,
            created_at: new Date().toISOString()
        });
        await loadDayTasks();
        ok('unassigned team task counts for everyone',
            getMyDayTeamTasksByDate(thursday).length === 2,
            getMyDayTeamTasksByDate(thursday).length + ' tasks');

        // personal tasks still private and still working
        document.getElementById('dayPersonalTaskInput').value = 'My own private note';
        await addDayPersonalTask();
        await sleep(40);
        ok('personal task still saves', window.__DB.day_personal_tasks.length === 1);
        ok('personal and team lists are separate',
            document.getElementById('dayPersonalTasksList').textContent.indexOf('Power Automate') === -1);

        await deleteDayTeamTask('unassigned-1');
        await sleep(30);
        ok('team task deleted', !window.__DB.day_tasks.some(t => t.id === 'unassigned-1'));

        closeDayPersonalTasksModal();

        // ---- 6. Daily grid still renders ---------------------------------
        switchView('daily');
        renderDaily();
        await sleep(20);
        ok('daily grid renders', (document.getElementById('dailyTableContainer').textContent || '').length > 0);
        switchView('dashboard');
        await sleep(20);
        ok('dashboard renders', (document.getElementById('dashboardView').textContent || '').length > 0);
        switchView('equipo');
        await sleep(20);
        ok('team view renders', (document.getElementById('teamView').textContent || '').length > 0);
    } catch (err) {
        results.push('FAIL | driver threw: ' + (err && err.stack ? err.stack : err));
        flush();
    }
    }

    document.addEventListener('DOMContentLoaded', () => {
        results.push('INFO | load fired');
        flush();
        main().then(() => {
            results.push('INFO | driver finished');
            flush();
        }, err => {
            results.push('FAIL | main rejected: ' + (err && err.stack ? err.stack : err));
            flush();
        });
    });
})();
