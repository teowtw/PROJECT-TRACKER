window.__shotLoaded = true;
(function () {
    window.confirm = function () { return true; };
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    const mondayKey = () => formatDateKey(getMonday(new Date()));
    const dayKey = (offset) => {
        const d = getMonday(new Date());
        d.setDate(d.getDate() + offset);
        return formatDateKey(d);
    };

    async function run() {
        const scene = (location.hash || '#ficha').slice(1);
        try { localStorage.setItem('wtw_current_user', 'TB'); } catch (e) {}
        currentUser = 'TB';
        await enterApplication();
        await sleep(100);

        // Un segundo proyecto, para que la capacidad sea claramente
        // "de todos los proyectos" y no solo del abierto.
        window.__DB.projects.push({
            id: 'p2', name: 'KYC Renewal', start_date: '2026-08-01', end_date: null,
            phase: 'Development', bau_owner: null, stakeholders: '', benefits: '',
            description: '', country: 'Belgium', volume: 30000, fte: 0.8,
            priority: 'Media', impact: 'Medio', status: 'Ámbar', progress: 55,
            prerequisites: [], responsibles: ['JG', 'IM'],
            created_at: '2026-08-01T00:00:00Z'
        });
        window.__DB.projects.push({
            id: 'p3', name: 'Legacy Fleet Import', start_date: '2025-01-01', end_date: '2025-09-30',
            phase: 'Completed', bau_owner: null, stakeholders: '', benefits: '',
            description: '', country: 'France', volume: 0, fte: 0,
            priority: 'Baja', impact: 'Bajo', status: 'Verde', progress: 100,
            prerequisites: [], responsibles: ['TB'],
            archived_at: '2026-01-15T10:00:00Z', archived_by: 'TB',
            created_at: '2025-01-01T00:00:00Z'
        });

        // Tareas con horas repartidas, incluida una a medias.
        const tasks = [
            { id: 't1', project_id: 'p1', date: dayKey(2), text: 'Move the Power Automate flow to UAT',
              description: 'The UAT connector needs re-pointing first. Jorge has the service account.\n\nAcceptance: flow runs green twice in UAT.',
              responsible: 'TB', responsibles: ['TB', 'JG'], estimated_hours: 12,
              hours_by_assignee: { TB: 10, JG: 2 }, urgency: 'Alta', has_incident: false, completed: false },
            { id: 't2', project_id: 'p1', date: dayKey(1), text: 'Draft the savings calculation',
              description: '', responsible: 'TB', responsibles: ['TB'], estimated_hours: 6,
              hours_by_assignee: {}, urgency: 'Normal', has_incident: false, completed: true },
            { id: 't3', project_id: 'p2', date: dayKey(3), text: 'Rework the KYC business case',
              description: 'Mumbai Ops want the volumes split per entity.',
              responsible: 'JG', responsibles: ['JG', 'IM', 'AR'], estimated_hours: 18,
              hours_by_assignee: {}, urgency: 'Normal', has_incident: false, completed: false },
            { id: 't4', project_id: 'p2', date: dayKey(4), text: 'Fix the overnight connector timeout',
              description: '', responsible: 'AD', responsibles: ['AD'], estimated_hours: 14,
              hours_by_assignee: {}, urgency: 'Máxima', has_incident: true, completed: false }
        ];
        tasks.forEach(t => window.__DB.daily_comments.push(Object.assign({
            time: '09:30', is_personal: false, owner_initials: 'TB', user_name: 'TB',
            parent_id: null, created_at: new Date().toISOString()
        }, t)));

        window.__DB.day_tasks.push({
            id: 'dt1', task_date: dayKey(2), text: 'Pair on the deploy checklist',
            project_id: 'p1', assignees: ['TB', 'AR'], estimated_hours: 3,
            hours_by_assignee: {}, description: '', created_by: 'TB',
            completed: false, created_at: new Date().toISOString()
        });
        window.__DB.project_incidents.push({
            id: 'i1', project_id: 'p1', description: 'Connector keeps timing out',
            resolved: false, created_by: 'TB', created_at: new Date().toISOString()
        });
        window.__DB.project_weekly_tasks.push({
            id: 'w1', project_id: 'p1', week_start: mondayKey(),
            text: 'Finish the UAT scripts', done: false, position: 0,
            created_by: 'TB', created_at: new Date().toISOString()
        });
        window.__DB.project_notes.push({
            id: 'n1', project_id: 'p1', title: 'Access request',
            body: 'Ask IT for the UAT environment', url: null, color: 'yellow',
            created_by: 'TB', created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
        });
        // Un proyecto en la papelera, para la sección Bin.
        window.__DB.projects.push({
            id: 'p4', name: 'Abandoned POC', start_date: null, end_date: null,
            phase: 'Discovery', bau_owner: null, stakeholders: '', benefits: '',
            description: '', country: '', volume: 0, fte: 0,
            priority: 'Baja', impact: 'Bajo', status: 'Verde', progress: 0,
            prerequisites: [], responsibles: [],
            deleted_at: '2026-10-10T08:00:00Z', deleted_by: 'AR',
            created_at: '2026-02-01T00:00:00Z'
        });
        // Un override manual, para ver la marca "M".
        window.__DB.user_capacity_overrides.push({
            user_initials: 'IM', week_start: mondayKey(), override_hours: 38,
            note: 'training week', created_by: 'TB', updated_at: new Date().toISOString()
        });

        await loadDataFromSupabase(true);
        currentProjectId = 'p1';
        await sleep(60);

        if (scene === 'ficha') {
            switchView('ficha');
        } else if (scene === 'dashboard') {
            switchView('dashboard');
        } else if (scene === 'detail') {
            switchView('ficha');
            await sleep(80);
            openTaskDetail('t1');
        } else if (scene === 'menu') {
            sidebarCollapsed.archivados = false;
            sidebarCollapsed.eliminados = false;
            switchView('ficha');
            await sleep(80);
            const btn = document.querySelector('.project-item-menu-btn[data-project-id="p1"]');
            if (btn) openProjectMenu(null, 'p1', 'live');
        } else if (scene === 'taskform') {
            switchView('daily');
            await sleep(60);
            openDailyCommentModalFromCell(new Event('click'), 'p1', dayKey(2));
            await sleep(60);
            document.getElementById('commentText').value = 'Move the Power Automate flow to UAT';
            document.getElementById('commentDescription').value = 'Needs the UAT connector re-pointed first.';
            toggleDailyTaskResponsible('JG');
            document.getElementById('commentHours').value = '12';
            onDailyTaskHoursChange();
            toggleDailyTaskHoursSplit();
            setDailyTaskHoursFor('TB', 10);
            setDailyTaskHoursFor('JG', 2);
        } else if (scene === 'daycomments') {
            switchView('daily');
            await sleep(60);
            openCommentsList(new Event('click'), 'p1', dayKey(2));
            await sleep(40);
            toggleCommentDetail('t1');
        } else if (scene === 'search') {
            switchView('dashboard');
            await sleep(60);
            const input = document.getElementById('sidebarProjectSearch');
            input.value = 'kyc';
            setSidebarSearch('kyc');
        } else if (scene === 'team' || scene === 'leave') {
            // A week with every kind of absence for TB, plus a Madrid holiday.
            [['current_year', 'vacation'], ['next_year', 'vacation'], ['not_charged', 'sick_leave']].forEach(([vacation_type, absence_type], i) => {
                window.__DB.team_vacations.push({
                    id: 'v' + i, user_initials: 'TB', start_date: '2026-11-1' + (i + 1), end_date: '2026-11-1' + (i + 1),
                    status: 'planned', vacation_type, absence_type, vacation_year: 2026, days_count: 1
                });
            });
            await loadTeamVacations();
            teamViewMode = 'week';
            teamRefDate = new Date(2026, 10, 10);
            switchView('equipo');
            if (scene === 'leave') {
                await sleep(60);
                showVacationOptionsModal('TB', '2026-11-16', ['2026-11-16']);
                document.getElementById('absenceTypeSelect').value = 'sick_leave';
                onAbsenceTypeChange();
            }
        } else if (scene === 'tasks' || scene === 'taskeditor') {
            const yesterday = dayKey(-3);
            [
                { text: 'Send the steering committee pack', priority: 'Crítica', task_date: yesterday, project_id: 'p1', estimated_hours: 3, effort: 'Alto' },
                { text: 'Book the UAT room', priority: 'Media', task_date: mondayKey(), task_time: '11:00', project_id: null, estimated_hours: 0.5 },
                { text: 'Review KYC volumes with Inés', priority: 'Alta', task_date: dayKey(4), project_id: 'p2', estimated_hours: 2, assignees: ['TB', 'IM'], visibility: 'private' },
                { text: 'Learn the new Power Automate connector', priority: 'Baja', task_date: null, project_id: null, estimated_hours: 6, effort: 'Medio',
                  description: 'Self-study, no deadline. Microsoft Learn path + sandbox tenant.' }
            ].forEach((t, i) => window.__DB.day_tasks.push(Object.assign({
                id: 'mt' + i, assignees: ['TB'], created_by: 'TB', completed: false, description: '',
                hours_by_assignee: {}, visibility: 'team', task_time: null, effort: null, created_at: new Date().toISOString()
            }, t)));
            await loadDayTasks();
            switchView('tasks');
            if (scene === 'taskeditor') {
                await sleep(60);
                openTaskEditor('mt2');
            }
        } else if (scene === 'bin') {
            sidebarCollapsed.archivados = false;
            sidebarCollapsed.eliminados = false;
            currentProjectId = 'p4';
            switchView('ficha');
        }

        await sleep(150);
        if (location.search.indexOf('bottom') !== -1) {
            const area = document.querySelector('.content-area');
            if (area) area.scrollTop = area.scrollHeight;
            await sleep(120);
        }
        document.title = 'SHOT READY';
    }

    document.addEventListener('DOMContentLoaded', () => { run(); });
})();
