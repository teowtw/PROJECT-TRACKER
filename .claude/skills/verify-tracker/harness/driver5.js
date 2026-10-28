window.__driver5Loaded = true;
// Drives the Tasks view: only my tasks (from Daily comments and day_tasks),
// creating tasks with/without project, date, time, priority, effort and
// visibility; private tasks hidden from others in Daily; undated tasks
// out of capacity; shared tasks visible to every assignee.
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
    const key = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
    // A weekday this week that is not a holiday for TB or JG, so capacity
    // numbers do not depend on when the suite runs.
    const today = key(new Date());

    DB.daily_comments.push(
        { id: 'cTB', project_id: 'p1', parent_id: null, date: today, time: '09:00', text: 'Review the UAT script',
          responsible: 'TB', responsibles: ['TB'], is_personal: false, owner_initials: 'TB', user_name: 'TB',
          urgency: 'Alta', has_incident: false, completed: false, description: '', estimated_hours: 2,
          hours_by_assignee: {}, created_at: today + 'T09:00:00Z' },
        { id: 'cJG', project_id: 'p1', parent_id: null, date: today, time: '09:10', text: 'Only for Jorge',
          responsible: 'JG', responsibles: ['JG'], is_personal: false, owner_initials: 'JG', user_name: 'JG',
          urgency: 'Normal', has_incident: false, completed: false, description: '', estimated_hours: 1,
          hours_by_assignee: {}, created_at: today + 'T09:10:00Z' }
    );

    const titles = () => Array.from(document.querySelectorAll('#tasksView .my-task-title')).map(b => b.textContent.trim());
    const fill = (fields) => {
        Object.entries(fields).forEach(([id, value]) => { document.getElementById(id).value = value; });
        onTaskEditorDateChange();
    };
    const dbTask = text => DB.day_tasks.find(t => t.text === text);

    async function main() {
        try { localStorage.setItem('wtw_current_user', 'TB'); } catch (e) {}
        currentUser = 'TB';
        await enterApplication();
        await sleep(120);

        // ---- View and menu ---------------------------------------------------
        const navBtn = document.querySelector('.view-toggle button[data-view="tasks"]');
        ok('Tasks button in the menu, with icon', !!navBtn && !!navBtn.querySelector('svg.view-ico'));
        switchView('tasks');
        await sleep(60);
        ok('menu marks Tasks as the only active view',
            navBtn.classList.contains('active') && document.querySelectorAll('.view-toggle button.active').length === 1,
            Array.from(document.querySelectorAll('.view-toggle button.active')).map(b => b.dataset.view).join(','));
        ok('Tasks view renders', document.getElementById('tasksView').classList.contains('active') &&
            document.getElementById('viewTitle').textContent === 'My Tasks');
        ok('shows my Daily task', titles().indexOf('Review the UAT script') !== -1, JSON.stringify(titles()));
        ok('hides tasks of others', titles().indexOf('Only for Jorge') === -1);
        ok('Daily task tagged with its origin', !!document.querySelector('#tasksView .my-task-source'));
        ok('pending count in the menu', document.getElementById('tasksViewCount').textContent === '1',
            document.getElementById('tasksViewCount').textContent);

        // ---- New task without project or date --------------------------------
        openTaskEditor();
        await sleep(30);
        ok('editor opens with me as assignee', JSON.stringify(taskEditorState.assignees) === '["TB"]');
        ok('without a date, time is disabled and visibility hidden',
            document.getElementById('taskEditorTime').disabled && document.getElementById('taskEditorVisibilityGroup').hidden);
        const projectOptions = Array.from(document.querySelectorAll('#taskEditorProject option')).map(o => o.textContent);
        ok('project dropdown lists live projects plus "No project"',
            projectOptions[0] === 'No project' && projectOptions.indexOf('Claims Automation') !== -1, JSON.stringify(projectOptions));

        fill({ taskEditorText: 'Prepare training slides', taskEditorDescription: 'For the Q4 session',
               taskEditorHours: '6', taskEditorPriority: 'Baja', taskEditorEffort: 'Medio', taskEditorProject: '' });
        await saveTaskEditor();
        await sleep(40);
        let t = dbTask('Prepare training slides');
        ok('undated task saved without project', !!t && t.project_id === null && t.task_date === null && t.task_time === null,
            t ? JSON.stringify({ p: t.project_id, d: t.task_date }) : 'missing');
        ok('priority, effort and hours stored', !!t && t.priority === 'Baja' && t.effort === 'Medio' && Number(t.estimated_hours) === 6);
        ok('appears under "No date"', !!document.querySelector('#tasksView .my-task-group--nodate') &&
            document.querySelector('#tasksView .my-task-group--nodate').textContent.indexOf('Prepare training slides') !== -1);
        ok('undated hours shown as unscheduled', /6h\s*unscheduled/.test(document.querySelector('#tasksView .tasks-summary').textContent),
            document.querySelector('#tasksView .tasks-summary').textContent.replace(/\s+/g, ' '));
        const capBefore = computeWeekCapacity(formatDateKey(getMonday(new Date()))).TB.taskHours;
        ok('undated task does not count toward capacity', capBefore === 2, String(capBefore));
        ok('low priority uses the quiet style', !!document.querySelector('#tasksView .my-task.prio-edge-low .prio-low'));

        // ---- New dated, shared, private task with a project -----------------
        openTaskEditor();
        await sleep(20);
        toggleTaskEditorAssignee('JG');
        fill({ taskEditorText: 'Pair on connector fix', taskEditorHours: '4', taskEditorPriority: 'Crítica',
               taskEditorProject: 'p1', taskEditorDate: today });
        ok('with a date, time and visibility become available',
            !document.getElementById('taskEditorTime').disabled && !document.getElementById('taskEditorVisibilityGroup').hidden);
        document.getElementById('taskEditorTime').value = '15:30';
        await saveTaskEditor();
        await sleep(40);
        t = dbTask('Pair on connector fix');
        ok('dated task saved with project, time and default private visibility',
            !!t && t.project_id === 'p1' && t.task_date === today && t.task_time === '15:30' && t.visibility === 'private',
            t ? JSON.stringify({ p: t.project_id, d: t.task_date, tm: t.task_time, v: t.visibility }) : 'missing');
        ok('assigned to both', !!t && JSON.stringify(t.assignees) === '["TB","JG"]', t ? JSON.stringify(t.assignees) : '');
        ok('critical priority is the loud style', !!document.querySelector('#tasksView .my-task.prio-edge-critical .prio-critical'));
        const capAfter = computeWeekCapacity(formatDateKey(getMonday(new Date())));
        ok('dated task counts toward capacity (2h each)', capAfter.TB.taskHours === 4 && capAfter.JG.taskHours === 3,
            'TB=' + capAfter.TB.taskHours + ' JG=' + capAfter.JG.taskHours);
        ok('it shows in Daily for that day', getDayTeamTasksByDate(today).some(x => x.text === 'Pair on connector fix'));

        // ---- Another user ---------------------------------------------------
        currentUser = 'JG';
        renderTasksView();
        ok('JG sees the shared task in Tasks', titles().indexOf('Pair on connector fix') !== -1, JSON.stringify(titles()));
        ok('JG does not see TB-only tasks', titles().indexOf('Prepare training slides') === -1 && titles().indexOf('Review the UAT script') === -1);
        currentUser = 'IM';
        ok('IM (not on it) cannot see the private task in Daily', !getDayTeamTasksByDate(today).some(x => x.text === 'Pair on connector fix'));
        renderTasksView();
        ok('IM sees an empty Tasks view', titles().length === 0 && /Nothing assigned/.test(document.getElementById('tasksView').textContent));
        currentUser = 'TB';

        // ---- Edit: switch to team visibility --------------------------------
        const created = dayTasks.find(x => x.text === 'Pair on connector fix');
        openTaskEditor(created.id);
        await sleep(20);
        ok('editor loads the saved values',
            document.getElementById('taskEditorText').value === 'Pair on connector fix' &&
            document.getElementById('taskEditorTime').value === '15:30' &&
            document.getElementById('taskEditorProject').value === 'p1' &&
            document.querySelector('input[name="taskEditorVisibility"]:checked').value === 'private');
        document.querySelector('input[name="taskEditorVisibility"][value="team"]').checked = true;
        await saveTaskEditor();
        await sleep(40);
        ok('visibility updated, no duplicate', DB.day_tasks.filter(x => x.text === 'Pair on connector fix').length === 1 &&
            dbTask('Pair on connector fix').visibility === 'team');
        currentUser = 'IM';
        ok('now IM sees it in Daily', getDayTeamTasksByDate(today).some(x => x.text === 'Pair on connector fix'));
        currentUser = 'TB';

        // ---- Daily day modal shows priority and time -------------------------
        switchView('daily');
        await sleep(40);
        openDayPersonalTasksModal(null, today);
        await sleep(40);
        const dayList = document.getElementById('dayTeamTasksList').innerHTML;
        ok('Daily lists time and priority', /15:30/.test(dayList) && /prio-critical/.test(dayList));
        closeDayPersonalTasksModal();

        // ---- Completion and filters ------------------------------------------
        switchView('tasks');
        await sleep(30);
        await toggleMyTask('task', dayTasks.find(x => x.text === 'Prepare training slides').id, true);
        await sleep(40);
        ok('completing hides it (done hidden by default)', titles().indexOf('Prepare training slides') === -1);
        setTasksFilter('showDone', true);
        ok('"Show done" brings it back under Done', !!document.querySelector('#tasksView .my-task-group--done'));
        setTasksFilter('showDone', false);

        await toggleMyTask('comment', 'cTB', true);
        await sleep(40);
        ok('completing a Daily task updates daily_comments', DB.daily_comments.find(c => c.id === 'cTB').completed === true);

        setTasksFilter('priority', 'critical');
        ok('priority filter', JSON.stringify(titles()) === '["Pair on connector fix"]', JSON.stringify(titles()));
        setTasksFilter('priority', '');
        setTasksFilter('project', '__none__');
        ok('"No project" filter', titles().indexOf('Pair on connector fix') === -1);
        setTasksFilter('project', '');

        // ---- Validation and delete -----------------------------------------
        openTaskEditor();
        await sleep(20);
        const before = DB.day_tasks.length;
        await saveTaskEditor();
        ok('title is required', DB.day_tasks.length === before && document.getElementById('taskEditorModal').classList.contains('active'));
        closeTaskEditor();

        await deleteMyTask(dayTasks.find(x => x.text === 'Pair on connector fix').id);
        await sleep(40);
        ok('delete removes it', !dbTask('Pair on connector fix') && titles().indexOf('Pair on connector fix') === -1);

        results.push('INFO | driver5 finished');
        flush();
    }

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => main().catch(err => { ok('driver crashed', false, err && (err.stack || err.message)); }), 50);
    });
})();
