window.__driver6Loaded = true;
// Drives the November 2026 features: savings in hours (h/year) instead of €,
// the Training phase (own sidebar/Daily group, out of portfolio KPIs, hours
// in capacity), green training tasks (task_type) in every task form and view,
// and the Admin view: create members with generated initials and the standard
// password, mark them unavailable (never delete), reactivate, and how
// unavailable people disappear from pickers but stay on their old work.
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
    const today = key(new Date());
    const html = id => (document.getElementById(id) || {}).innerHTML || '';
    const user = i => DB.app_users.find(u => u.initials === i);
    const appUserDeletes = () => window.__writes.filter(w => w.table === 'app_users' && w.op === 'delete');

    // ---- Seed -----------------------------------------------------------------
    const names = { TB: ['Teo', 'Balsalobre'], AR: ['Ana', 'Real'], JG: ['Jorge', 'Gazulla'], IM: ['Inês', 'Marcelino'], AD: ['Abha', 'Dungdung'] };
    DB.app_users.forEach(u => {
        u.first_name = names[u.initials][0];
        u.last_name = names[u.initials][1];
        u.is_admin = u.initials === 'TB' || u.initials === 'AR';
        u.is_active = true;
        u.holiday_region = u.initials === 'JG' ? 'ES-MD' : null;
    });
    // Someone who already left: still owns a project and an open task.
    DB.app_users.push({ initials: 'XX', email: 'xavier.xu@wtwco.com', password_hash: 'x', weekly_hours: 40,
        first_name: 'Xavier', last_name: 'Xu', is_admin: false, is_active: false,
        deactivated_at: '2026-10-01T10:00:00Z', deactivated_by: 'AR', created_at: '2026-01-01T00:00:00Z' });

    DB.projects.push(
        { id: 'p2', name: 'Legacy Connector', start_date: '2026-03-01', end_date: null, phase: 'Development',
          bau_owner: null, stakeholders: '', benefits: '', description: '', country: 'Spain', volume: 0, fte: 0,
          savings_hours: 1200, priority: 'Media', impact: 'Medio', status: 'Verde', progress: 10,
          prerequisites: [], responsibles: ['XX', 'TB'], created_at: '2026-03-01T00:00:00Z' },
        { id: 'pT', name: "Teo's Training", start_date: null, end_date: null, phase: 'Training',
          bau_owner: null, stakeholders: '', benefits: '', description: '', country: '', volume: 0, fte: 0,
          savings_hours: null, priority: 'Media', impact: 'Medio', status: 'Verde', progress: 0,
          prerequisites: [], responsibles: ['TB'], created_at: '2026-10-01T00:00:00Z' }
    );
    DB.daily_comments.push(
        { id: 'cTrain', project_id: 'pT', parent_id: null, date: today, time: '09:00', text: 'Power Platform course',
          responsible: 'TB', responsibles: ['TB'], is_personal: false, owner_initials: 'TB', user_name: 'TB',
          urgency: 'Normal', has_incident: false, completed: false, description: '', estimated_hours: 3,
          hours_by_assignee: {}, task_type: 'training', created_at: today + 'T09:00:00Z' },
        { id: 'cWork', project_id: 'p1', parent_id: null, date: today, time: '10:00', text: 'Normal work item',
          responsible: 'TB', responsibles: ['TB'], is_personal: false, owner_initials: 'TB', user_name: 'TB',
          urgency: 'Normal', has_incident: false, completed: false, description: '', estimated_hours: 1,
          hours_by_assignee: {}, created_at: today + 'T10:00:00Z' }
    );
    DB.day_tasks.push({ id: 'tXX', task_date: today, text: 'Handover notes', project_id: 'p2', assignees: ['XX'],
        description: '', estimated_hours: 2, hours_by_assignee: {}, priority: 'Media', effort: null, task_time: null,
        visibility: 'team', created_by: 'XX', completed: false, created_at: today + 'T08:00:00Z' });

    async function main() {
        try { localStorage.clear(); localStorage.setItem('wtw_current_user', 'TB'); } catch (e) {}
        currentUser = 'TB';
        await enterApplication();
        await sleep(150);

        // =========================================================== SAVINGS
        ok('new project modal has no € field', !document.getElementById('volume') && !!document.getElementById('savingsHours'));
        ok('new project modal label is in hours', /Savings \(h\/year\)/.test(document.querySelector('label[for="savingsHours"]').textContent));

        switchView('dashboard');
        await sleep(60);
        const dash = html('dashboardView');
        ok('dashboard column is Savings h/year', dash.indexOf('Savings h/year') !== -1);
        ok('no € anywhere in the dashboard', dash.indexOf('€') === -1);
        ok('dashboard total in hours', /Total savings \(hours\/year\)/.test(dash) && dash.indexOf('1,200 h') !== -1);

        currentProjectId = 'p1';
        switchView('ficha');
        await sleep(40);
        const ficha1 = html('fichaView');
        ok('ficha savings field is in hours', ficha1.indexOf('aria-label="Savings in hours per year"') !== -1 && ficha1.indexOf('Savings (€)') === -1);
        ok('old € savings shown read-only as legacy', ficha1.indexOf('Previously recorded: 50,000 €') !== -1);
        await updateProjectField('p1', 'savingsHours', '800');
        const p1Write = window.__writes.filter(w => w.table === 'projects' && w.op === 'update').pop();
        ok('editing savings writes savings_hours, not volume',
            p1Write && p1Write.payload.savings_hours === 800 && !('volume' in p1Write.payload), JSON.stringify(p1Write && p1Write.payload));
        ok('€ value is kept in the database', DB.projects.find(p => p.id === 'p1').volume === 50000);
        renderFicha();
        ok('legacy hint disappears once hours are set', html('fichaView').indexOf('Previously recorded') === -1);

        // =========================================================== TRAINING
        ok('Training is a phase option', PROJECT_PHASES.indexOf('Training') === PROJECT_PHASES.length - 1);
        ok('sidebar has a Training section with the project',
            html('projectsListTraining').indexOf("Teo's Training") !== -1 && html('projectsListActive').indexOf("Teo's Training") === -1);

        switchView('dashboard');
        await sleep(40);
        const projectsStat = document.querySelector('#dashboardView .stat-card .stat-value').textContent.trim();
        ok('Training projects are not counted in the portfolio KPIs', projectsStat === '2', projectsStat);
        const dashNames = Array.from(document.querySelectorAll('#dashboardView .dashboard-table .dash-name')).map(td => td.textContent);
        ok('Training projects are not listed in the dashboard table', dashNames.indexOf("Teo's Training") === -1 && dashNames.length === 2, JSON.stringify(dashNames));

        const week = getMonday(new Date());
        const cap = computeWeekCapacity(formatDateKey(week));
        ok('training hours count toward capacity', cap.TB && cap.TB.taskHours >= 4, cap.TB && cap.TB.taskHours);

        switchView('daily');
        setDailyViewMode('activos');
        await sleep(40);
        const daily = html('dailyTableContainer');
        ok('Daily shows a Training group', daily.indexOf('daily-group-row--training') !== -1 && /Training \(1\)/.test(daily));
        ok('training project row is marked', !!document.querySelector('#dailyTableContainer tr.training-row'));
        const trainingCell = document.querySelector('#dailyTableContainer tr.training-row td.has-training');
        ok('training task paints the Daily cell green', !!trainingCell);
        ok('training cell carries a TRAINING badge, not only colour', !!(trainingCell && trainingCell.querySelector('.training-badge')));
        const workRow = Array.from(document.querySelectorAll('#dailyTableContainer tr')).find(tr => tr.textContent.indexOf('Claims Automation') !== -1);
        ok('standard task cell is not green', workRow && !workRow.querySelector('.has-training'));

        // Colours: training green differs from the (now blue) personal highlight.
        const probe = cls => {
            const t = document.createElement('table'); t.className = 'daily-table';
            t.innerHTML = `<tr><td class="daily-cell ${cls}">x</td></tr>`;
            document.body.appendChild(t);
            const c = getComputedStyle(t.querySelector('td')).borderLeftColor;
            t.remove();
            return c;
        };
        ok('personal highlight is no longer green', probe('has-comment-personal') !== probe('has-training'),
            probe('has-comment-personal') + ' vs ' + probe('has-training'));

        // New project modal with the Training phase.
        openNewProjectModal();
        await sleep(20);
        document.getElementById('projectPhase').value = 'Training';
        onNewProjectPhaseChange();
        const hiddenBusiness = Array.from(document.querySelectorAll('#projectModal [data-not-training]')).every(el => el.hidden);
        ok('Training hides savings, country and stakeholders', hiddenBusiness);
        ok('Training proposes "<First name>\'s Training"', document.getElementById('projectName').value === "Teo's Training",
            document.getElementById('projectName').value);
        document.getElementById('projectName').value = 'Teo Training 2';
        document.getElementById('savingsHours').value = '99';
        await saveNewProject();
        await sleep(40);
        const created = DB.projects.find(p => p.name === 'Teo Training 2');
        ok('Training project saved with its phase and no savings',
            created && created.phase === 'Training' && created.savings_hours === null && !('volume' in created), JSON.stringify(created));
        currentProjectId = created.id;
        switchView('ficha');
        await sleep(30);
        const fichaT = html('fichaView');
        ok('Training card has no prerequisites or savings', fichaT.indexOf('Prerequisites') === -1 && fichaT.indexOf('Savings (h/year)') === -1);
        ok('Training card shows hours this year', fichaT.indexOf('Training hours this year') !== -1);
        currentProjectId = 'pT';
        renderFicha();
        ok('Training card sums the hours per person', /TB · 3h/.test(html('fichaView')), (html('fichaView').match(/training-hours-total">[^<]*/) || [''])[0]);

        // Daily comment modal: preselected for a Training project, saved as training.
        currentProjectId = 'pT';
        openDailyCommentModal(today, 'pT');
        await sleep(20);
        ok('Daily task form ticks Training for a Training project', document.getElementById('commentTraining').checked);
        document.getElementById('commentProjectSelect').value = 'p1';
        syncTrainingCheckbox('commentTraining', 'p1');
        ok('switching to a normal project unticks it', !document.getElementById('commentTraining').checked);
        document.getElementById('commentProjectSelect').value = 'pT';
        document.getElementById('commentTraining').checked = true;
        document.getElementById('commentText').value = 'Azure fundamentals';
        await saveDailyComment();
        await sleep(40);
        const savedComment = DB.daily_comments.find(c => c.text === 'Azure fundamentals');
        ok('Daily task saved with task_type training', savedComment && savedComment.task_type === 'training', savedComment && savedComment.task_type);
        const workWrite = DB.daily_comments.find(c => c.id === 'cWork');
        ok('existing task without the column stays standard', normalizeTaskType(workWrite.task_type) === 'standard');

        // Tasks editor.
        openTaskEditor();
        await sleep(20);
        ok('Tasks editor starts unticked without project', !document.getElementById('taskEditorTraining').checked);
        document.getElementById('taskEditorText').value = 'Copilot workshop';
        document.getElementById('taskEditorProject').value = 'pT';
        syncTrainingCheckbox('taskEditorTraining', 'pT');
        document.getElementById('taskEditorDate').value = today;
        onTaskEditorDateChange();
        await saveTaskEditor();
        await sleep(40);
        const savedTask = DB.day_tasks.find(t => t.text === 'Copilot workshop');
        ok('Tasks editor saves task_type training', savedTask && savedTask.task_type === 'training');
        switchView('tasks');
        await sleep(40);
        const trainingItem = Array.from(document.querySelectorAll('#tasksView .my-task')).find(li => li.textContent.indexOf('Copilot workshop') !== -1);
        ok('Tasks view paints training tasks green with a badge',
            !!trainingItem && trainingItem.classList.contains('is-training') && !!trainingItem.querySelector('.training-badge'));
        const dailyTrainingItem = Array.from(document.querySelectorAll('#tasksView .my-task')).find(li => li.textContent.indexOf('Power Platform course') !== -1);
        ok('Daily-origin training task is green in Tasks too', !!dailyTrainingItem && dailyTrainingItem.classList.contains('is-training'));
        openTaskEditor(savedTask.id);
        await sleep(20);
        ok('editing keeps the Training tick', document.getElementById('taskEditorTraining').checked);
        closeTaskEditor();

        // Quick team task in the day modal.
        dayPersonalTasksModalContext.dateKey = today;
        dayTeamTaskProjectId = '';
        onDayTeamTaskProjectChange('pT');
        ok('day team task form ticks Training for a Training project', document.getElementById('dayTeamTaskTraining').checked);
        document.getElementById('dayTeamTaskInput').value = 'Read the RPA guide';
        await addDayTeamTask();
        await sleep(40);
        ok('day team task saved as training', (DB.day_tasks.find(t => t.text === 'Read the RPA guide') || {}).task_type === 'training');

        // ============================================================== ADMIN
        const navAdmin = document.getElementById('navAdminBtn');
        ok('admin sees the Admin button with a gear icon', navAdmin && !navAdmin.hidden && !!navAdmin.querySelector('svg.view-ico'));
        switchView('admin');
        await sleep(30);
        ok('Admin view renders', currentView === 'admin' && document.getElementById('adminView').classList.contains('active') &&
            document.getElementById('viewTitle').textContent === 'Team Management');
        const adminRows = Array.from(document.querySelectorAll('#adminView tbody tr'));
        ok('lists every member, unavailable ones last', adminRows.length === 6 && adminRows[5].textContent.indexOf('XX') !== -1);
        ok('unavailable member shows since when', /Unavailable since 01\/10\/2026/.test(adminRows[5].textContent), adminRows[5].textContent.replace(/\s+/g, ' '));
        const myRow = adminRows.find(r => r.textContent.indexOf('(you)') !== -1);
        ok('admin cannot deactivate themselves', myRow && Array.from(myRow.querySelectorAll('button')).find(b => b.textContent === 'Mark unavailable').disabled);

        // Initials and email generation.
        ok('initials: first letter of name + first surname', generateUserInitials('Laura', 'Gómez') === 'LG');
        ok('initials: on collision add the second surname', generateUserInitials('Ana', 'Rodríguez Gil') === 'ARG', generateUserInitials('Ana', 'Rodríguez Gil'));
        ok('initials: no second surname -> number', generateUserInitials('Alberto', 'Ruiz') === 'AR2', generateUserInitials('Alberto', 'Ruiz'));
        ok('initials: particles are not surnames', generateUserInitials('María', 'de la Cruz') === 'MC');
        ok('initials of unavailable people are taken too', generateUserInitials('Xenia', 'Xavi') === 'XX2');
        ok('email: name.surname@wtwco.com without accents', generateUserEmail('Inés', 'Gómez Pérez') === 'ines.gomez@wtwco.com');

        // Create a member through the modal.
        openAdminUserModal();
        await sleep(20);
        document.getElementById('adminFirstName').value = 'Laura';
        document.getElementById('adminLastName').value = 'Gómez';
        onAdminNameInput();
        ok('modal previews initials and email', document.getElementById('adminInitials').value === 'LG' &&
            document.getElementById('adminEmail').value === 'laura.gomez@wtwco.com');
        document.getElementById('adminRegion').value = 'PT-LIS';
        await saveAdminUser();
        await sleep(30);
        const lg = user('LG');
        const standardHash = await hashTextSha256('WEai2026!');
        ok('member created in app_users', lg && lg.first_name === 'Laura' && lg.last_name === 'Gómez' && lg.is_active === true && lg.is_admin === false);
        ok('with the standard password WEai2026!', lg && lg.password_hash === standardHash);
        ok('with the chosen holiday region', lg && lg.holiday_region === 'PT-LIS');
        ok('created with insert, never upsert', window.__writes.some(w => w.table === 'app_users' && w.op === 'insert') &&
            !window.__writes.some(w => w.table === 'app_users' && w.op === 'upsert' && JSON.stringify(w.payload).indexOf('"LG"') !== -1));
        ok('credentials shown to hand over', /Username: LG/.test(document.getElementById('adminCredentials').textContent) &&
            /Password: WEai2026!/.test(document.getElementById('adminCredentials').textContent));
        closeAdminUserModal();

        // The new member shows up everywhere people can be picked.
        ok('new member is in teamMembers', teamMembers.indexOf('LG') !== -1);
        openNewProjectModal();
        await sleep(10);
        ok('new member offered as project owner', html('projectOwners').indexOf('LG') !== -1);
        closeProjectModal();
        openTaskEditor();
        await sleep(10);
        ok('new member offered as task assignee', html('taskEditorAssignees').indexOf('LG') !== -1);
        closeTaskEditor();
        openDailyCommentModal(today, 'p1');
        await sleep(10);
        ok('new member offered as Daily responsible', html('commentResponsibles').indexOf('LG') !== -1);
        closeDailyModal();
        switchView('equipo');
        await sleep(60);
        ok('new member has a row in the Team calendar', html('teamView').indexOf('>LG<') !== -1);
        ok('new member has a capacity row', !!computeWeekCapacity(formatDateKey(week)).LG);
        switchView('admin');

        // Collision is refused.
        openAdminUserModal();
        await sleep(10);
        document.getElementById('adminFirstName').value = 'Tomas';
        document.getElementById('adminLastName').value = 'Blanco';
        onAdminNameInput();
        document.getElementById('adminInitials').value = 'TB';
        onAdminInitialsInput();
        const usersBefore = DB.app_users.length;
        await saveAdminUser();
        ok('taken initials are refused', DB.app_users.length === usersBefore && /already used/.test(document.getElementById('adminUserError').textContent));
        closeAdminUserModal();

        // Mark unavailable.
        await deactivateUser('LG');
        await sleep(20);
        ok('unavailable = is_active false, with who and when', user('LG').is_active === false && user('LG').deactivated_by === 'TB' && !!user('LG').deactivated_at);
        ok('the row is NOT deleted', !!user('LG') && appUserDeletes().length === 0);
        ok('unavailable member leaves teamMembers', teamMembers.indexOf('LG') === -1 && teamMembers.indexOf('XX') === -1);
        openNewProjectModal();
        await sleep(10);
        ok('unavailable member no longer offered as owner', html('projectOwners').indexOf('LG') === -1 && html('projectOwners').indexOf('XX') === -1);
        closeProjectModal();
        switchView('equipo');
        await sleep(60);
        ok('unavailable member leaves the Team calendar', html('teamView').indexOf('>LG<') === -1 && html('teamView').indexOf('>XX<') === -1);
        ok('no free capacity row for unavailable people', !computeWeekCapacity(formatDateKey(week)).LG);
        const capXX = computeWeekCapacity(formatDateKey(week)).XX;
        ok('but their logged hours still count (former member)', capXX && capXX.formerMember === true && capXX.taskHours === 2);

        // Their old work stays visible, greyed out.
        currentProjectId = 'p2';
        switchView('ficha');
        await sleep(30);
        const xxBadge = Array.from(document.querySelectorAll('#fichaView .resp-badge-header')).find(b => b.textContent.indexOf('XX') !== -1);
        ok('old project still shows the unavailable owner', !!xxBadge);
        ok('greyed out with a tooltip', xxBadge && xxBadge.getAttribute('data-unavailable') === 'true' && /No longer available/.test(xxBadge.title));
        ok('their project and task are untouched', DB.projects.find(p => p.id === 'p2').responsibles.indexOf('XX') !== -1 && !!DB.day_tasks.find(t => t.id === 'tXX'));
        switchView('daily');
        await sleep(30);
        ok('Daily owner filter still offers them to review their work', /value="XX"/.test(html('dailyRespFilter')));

        // An unavailable person cannot sign in.
        document.getElementById('loginInitials').value = 'XX';
        document.getElementById('loginPassword').value = 'whatever';
        await handleLoginAttempt();
        ok('unavailable member cannot sign in', /no longer active/.test(document.getElementById('loginError').textContent),
            document.getElementById('loginError').textContent);

        // Reactivate.
        switchView('admin');
        await reactivateUser('LG');
        ok('reactivate brings them back', user('LG').is_active === true && user('LG').deactivated_at === null && teamMembers.indexOf('LG') !== -1);

        // Reset password.
        DB.app_users.find(u => u.initials === 'LG').password_hash = 'changed';
        userDirectory.LG.passwordHash = 'changed';
        await resetUserPassword('LG');
        ok('reset password goes back to the standard one', user('LG').password_hash === standardHash);

        // Realtime: another admin adds someone; it arrives without reloading.
        DB.app_users.push({ initials: 'NB', email: 'nora.blum@wtwco.com', password_hash: standardHash, weekly_hours: 40,
            first_name: 'Nora', last_name: 'Blum', is_admin: false, is_active: true, created_at: new Date().toISOString() });
        await handleRealtimeChange();
        await sleep(30);
        ok('a member added elsewhere appears via realtime', teamMembers.indexOf('NB') !== -1);

        // Non-admins: no button, and switchView refuses.
        currentUser = 'JG';
        syncAdminNavButton();
        ok('non-admin does not see the Admin button', document.getElementById('navAdminBtn').hidden && currentView !== 'admin');
        switchView('admin');
        ok('non-admin cannot open the Admin view', currentView !== 'admin');

        // Renaming initials in Settings: the old row is deleted (decision of
        // 2026-10-28) but every column is carried over and the work stays.
        localStorage.setItem('wtw_current_user', 'JG');
        openUserSettingsModal();
        document.getElementById('settingsInitials').value = 'JGA';
        await saveUserSettings();
        await sleep(30);
        const jga = user('JGA');
        ok('rename creates the new row with all columns', jga && jga.first_name === 'Jorge' && jga.holiday_region === 'ES-MD' && jga.is_active === true,
            JSON.stringify(jga));
        ok('rename deletes only the old app_users row', !user('JG') && appUserDeletes().length === 1);
        openUserSettingsModal();
        document.getElementById('settingsInitials').value = 'XX';
        await saveUserSettings();
        ok('renaming to initials of an unavailable member is refused', !!user('JGA') && /already exists|used by someone/.test(document.getElementById('settingsError').textContent),
            document.getElementById('settingsError').textContent);
        closeUserSettingsModal();

        // Admin rename keeps admin.
        currentUser = 'AR';
        localStorage.setItem('wtw_current_user', 'AR');
        openUserSettingsModal();
        document.getElementById('settingsInitials').value = 'ARE';
        await saveUserSettings();
        await sleep(20);
        ok('an admin who renames stays admin', user('ARE') && user('ARE').is_admin === true && isCurrentUserAdmin());

        // ========================================= PROJECT STATUS (6 values)
        currentUser = 'TB';
        localStorage.setItem('wtw_current_user', 'TB');
        currentProjectId = 'p1';
        switchView('ficha');
        await sleep(30);
        const statusOptions = Array.from(document.querySelectorAll('#dropdown-status .indicator-option')).map(o => o.textContent.trim());
        ok('status menu offers the six statuses', JSON.stringify(statusOptions) === JSON.stringify(['On Track', 'At Risk', 'Blocked', 'On Hold', 'Cancelled', 'Done']),
            JSON.stringify(statusOptions));
        await updateIndicator(new Event('click'), 'p1', 'status', 'Cancelado');
        await sleep(20);
        ok('marking Cancelled saves the Spanish value', DB.projects.find(p => p.id === 'p1').status === 'Cancelado');
        const badge = document.querySelector('#fichaView .status-badge');
        ok('card badge shows Cancelled with its own style', badge && badge.classList.contains('status-cancelado') && /Cancelled/.test(badge.textContent));
        ok('old values keep their classes', getStatusCssKey('Ámbar') === 'ámbar' && getStatusCssKey('Verde') === 'verde' && getStatusCssKey(undefined) === 'verde');
        await updateIndicator(new Event('click'), 'p1', 'status', 'En pausa');
        ok('On Hold label', getStatusText('En pausa') === 'On Hold' && getStatusText('Completado') === 'Done');
        switchView('dashboard');
        openDashFilterMenu = 'status';
        renderDashboard();
        await sleep(20);
        const pills = Array.from(document.querySelectorAll('#dashboardView .dash-pills--menu .dash-pill')).filter(b => /On Track|At Risk|Blocked|On Hold|Cancelled|Done/.test(b.textContent));
        ok('dashboard status filter has the six statuses', pills.length === 6, pills.length);
        toggleDashFilter('estados', 'En pausa');
        await sleep(20);
        const onHoldNames = Array.from(document.querySelectorAll('#dashboardView .dashboard-table .dash-name')).map(td => td.textContent);
        ok('filtering by On Hold works', JSON.stringify(onHoldNames) === '["Claims Automation"]', JSON.stringify(onHoldNames));
        toggleDashFilter('estados', 'En pausa');
        openDashFilterMenu = null;

        // ============================================ ESTIMATED / REAL FTE
        ok('new project modal says Estimated savings (FTE)', /Estimated savings \(FTE\)/.test(document.querySelector('label[for="fte"]').textContent));
        currentProjectId = 'p1';
        switchView('ficha');
        await sleep(20);
        const fichaFte = html('fichaView');
        ok('card has Estimated and Real savings (FTE)', fichaFte.indexOf('Estimated savings (FTE)') !== -1 && fichaFte.indexOf('Real savings (FTE)') !== -1);
        await updateProjectField('p1', 'realFte', '0.8');
        ok('real savings saved in real_fte', DB.projects.find(p => p.id === 'p1').real_fte === 0.8 && DB.projects.find(p => p.id === 'p1').fte === 1.5);
        switchView('dashboard');
        await sleep(30);
        const dashFte = html('dashboardView');
        ok('dashboard shows Est. FTE and Real FTE columns', dashFte.indexOf('Est. FTE') !== -1 && dashFte.indexOf('Real FTE') !== -1);
        ok('dashboard totals real savings', /Total real savings FTE[\s\S]*?0\.8/.test(dashFte));
        await updateProjectField('p1', 'realFte', '');
        ok('clearing real savings stores null (not measured)', DB.projects.find(p => p.id === 'p1').real_fte === null);

        // ====================================== STICKY DAILY HEADER + MENU
        for (let i = 0; i < 30; i++) {
            DB.projects.push({ id: 'bulk' + i, name: 'Bulk project ' + i, phase: 'Development', status: 'Verde',
                priority: 'Media', impact: 'Medio', progress: 0, prerequisites: [], responsibles: ['TB'], created_at: '2026-01-01T00:00:00Z' });
        }
        await loadDataFromSupabase(true);
        switchView('daily');
        setDailyViewMode('activos');
        await sleep(60);
        const container = document.getElementById('dailyTableContainer');
        const thead = document.querySelector('#dailyTableContainer .daily-table thead');
        ok('Daily header is sticky', thead && getComputedStyle(thead).position === 'sticky');
        ok('the table scrolls inside its container', container.scrollHeight > container.clientHeight,
            container.scrollHeight + ' vs ' + container.clientHeight);
        container.scrollTop = 600;
        await sleep(30);
        const stuck = Math.abs(thead.getBoundingClientRect().top - container.getBoundingClientRect().top) <= 2;
        ok('after scrolling down, the header row stays at the top', container.scrollTop > 0 && stuck,
            'scrollTop=' + container.scrollTop + ' theadTop=' + Math.round(thead.getBoundingClientRect().top) + ' containerTop=' + Math.round(container.getBoundingClientRect().top));
        ok('the header still shows the day names', /Monday/.test(thead.textContent) && /PROJECT|Project/.test(thead.textContent));
        container.scrollTop = 0;

        const sideContent = document.querySelector('.sidebar-content');
        ok('sidebar menu scrolls with a visible scrollbar', getComputedStyle(sideContent).overflowY === 'auto' &&
            getComputedStyle(sideContent).scrollbarWidth !== 'none');
        // Las listas del sidebar animan su max-height (syncSidebarListHeights
        // en requestAnimationFrame): se mide cuando ha terminado.
        renderProjectsList();
        syncSidebarListHeights();
        await sleep(600);
        ok('sidebar menu has room to scroll with 30+ projects', sideContent.scrollHeight > sideContent.clientHeight,
            sideContent.scrollHeight + ' vs ' + sideContent.clientHeight);

        results.push('INFO | driver6 finished');
        flush();
    }

    document.addEventListener('DOMContentLoaded', () => {
        setTimeout(() => main().catch(err => { ok('driver crashed', false, err && (err.stack || err.message)); }), 50);
    });
})();
