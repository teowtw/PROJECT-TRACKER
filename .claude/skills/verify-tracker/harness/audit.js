window.__auditLoaded = true;
// Walks every element that paints its own text, works out the colour actually
// behind it, and reports WCAG contrast failures. Run in both themes.
(function () {
    window.confirm = function () { return true; };
    window.alert = function () {};
    // Colour transitions would otherwise be sampled mid-flight and report
    // intermediate values as failures.
    var noAnim = document.createElement('style');
    noAnim.textContent = '*,*::before,*::after{transition:none !important;animation:none !important}';
    document.addEventListener('DOMContentLoaded', function () { document.head.appendChild(noAnim); });

    const lines = [];
    const sleep = ms => new Promise(r => setTimeout(r, ms));

    function out(text) {
        const pre = document.getElementById('testout');
        if (pre) pre.textContent = text;
    }

    function parseColor(str) {
        const m = String(str).match(/rgba?\(([^)]+)\)/);
        if (!m) return null;
        const parts = m[1].split(',').map(s => parseFloat(s.trim()));
        return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
    }

    function over(fg, bg) {
        // fg composited onto bg
        const a = fg.a;
        return {
            r: fg.r * a + bg.r * (1 - a),
            g: fg.g * a + bg.g * (1 - a),
            b: fg.b * a + bg.b * (1 - a),
            a: 1
        };
    }

    function lum(c) {
        const f = v => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
        };
        return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
    }

    function ratio(a, b) {
        const la = lum(a), lb = lum(b);
        const hi = Math.max(la, lb), lo = Math.min(la, lb);
        return (hi + 0.05) / (lo + 0.05);
    }

    // Effective background behind el: composite every semi-transparent layer
    // up the tree onto the page canvas.
    function effectiveBg(el) {
        const layers = [];
        let node = el;
        let hitGradient = false;
        while (node && node !== document.documentElement) {
            const cs = getComputedStyle(node);
            if (cs.backgroundImage && cs.backgroundImage !== 'none') hitGradient = true;
            const bg = parseColor(cs.backgroundColor);
            if (bg && bg.a > 0) {
                layers.push(bg);
                if (bg.a === 1) break;
            }
            node = node.parentElement;
        }
        const rootBg = parseColor(getComputedStyle(document.documentElement).backgroundColor) ||
                       { r: 255, g: 255, b: 255, a: 1 };
        let acc = rootBg.a === 1 ? rootBg : { r: 255, g: 255, b: 255, a: 1 };
        for (let i = layers.length - 1; i >= 0; i--) acc = over(layers[i], acc);
        return { color: acc, hitGradient: hitGradient };
    }

    function hasOwnText(el) {
        for (const n of el.childNodes) {
            if (n.nodeType === 3 && n.textContent.trim().length > 0) return true;
        }
        return false;
    }

    function describe(el) {
        let s = el.tagName.toLowerCase();
        if (el.id) s += '#' + el.id;
        if (el.className && typeof el.className === 'string') {
            s += '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
        }
        return s;
    }

    function audit(label) {
        const failures = [];
        let checked = 0;

        document.querySelectorAll('body *').forEach(el => {
            if (!hasOwnText(el)) return;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return;
            const rect = el.getBoundingClientRect();
            if (rect.width === 0 && rect.height === 0) return;
            if (el.closest('.visually-hidden')) return;
            if (el.id === 'testout') return;
            if (el.id === 'testout' || el.closest('#testout')) return;

            const fg = parseColor(cs.color);
            if (!fg || fg.a === 0) return;
            const bgInfo = effectiveBg(el);
            const fgOn = over(fg, bgInfo.color);
            const r = ratio(fgOn, bgInfo.color);

            const size = parseFloat(cs.fontSize);
            const weight = parseInt(cs.fontWeight, 10) || 400;
            const large = size >= 24 || (size >= 18.66 && weight >= 700);
            const threshold = large ? 3 : 4.5;

            checked++;
            if (r < threshold) {
                failures.push({
                    sel: describe(el),
                    ratio: r.toFixed(2),
                    need: threshold,
                    color: cs.color,
                    bg: 'rgb(' + Math.round(bgInfo.color.r) + ',' + Math.round(bgInfo.color.g) + ',' + Math.round(bgInfo.color.b) + ')',
                    gradient: bgInfo.hitGradient,
                    text: (el.textContent || '').trim().slice(0, 28)
                });
            }
        });

        lines.push('=== ' + label + ' === checked ' + checked + ' text nodes, ' + failures.length + ' below threshold');
        failures
            .sort((a, b) => parseFloat(a.ratio) - parseFloat(b.ratio))
            .slice(0, 25)
            .forEach(f => {
                lines.push('  ' + f.ratio + ':1 (need ' + f.need + ') ' + f.sel +
                           ' | fg ' + f.color + ' on ' + f.bg + (f.gradient ? ' [gradient nearby]' : '') +
                           ' | "' + f.text + '"');
            });
        out(lines.join('\n'));
    }

    async function run() {
        try { localStorage.setItem('wtw_current_user', 'TB'); } catch (e) {}
        currentUser = 'TB';
        await enterApplication();
        await sleep(100);

        // Seed a bit of content so widgets are not empty.
        window.__DB.day_tasks.push({
            id: 'dt1', task_date: formatDateKey(new Date()), text: 'Move the flow to UAT',
            project_id: 'p1', assignees: ['TB', 'JG'], created_by: 'TB', completed: false,
            created_at: new Date().toISOString()
        });
        window.__DB.project_incidents.push({
            id: 'i1', project_id: 'p1', description: 'Connector keeps timing out',
            resolved: false, created_by: 'TB', created_at: new Date().toISOString()
        });
        window.__DB.project_incidents.push({
            id: 'i2', project_id: 'p1', description: 'Old issue, fixed',
            resolved: true, created_by: 'TB', created_at: new Date().toISOString()
        });
        window.__DB.project_weekly_tasks.push({
            id: 'w1', project_id: 'p1', week_start: formatDateKey(getMonday(new Date())),
            text: 'Finish UAT scripts', done: false, position: 0, created_by: 'TB',
            created_at: new Date().toISOString()
        });
        window.__DB.project_notes.push({
            id: 'n1', project_id: 'p1', title: 'Access request', body: 'Ask IT for the UAT env',
            url: null, color: 'yellow', created_by: 'TB',
            created_at: new Date().toISOString(), updated_at: new Date().toISOString()
        });
        window.__DB.project_statuses.push({
            id: 's1', project_id: 'p1', status_text: 'Waiting on the UAT environment',
            user_initials: 'TB', created_at: new Date().toISOString()
        });
        window.__DB.daily_comments.push({
            id: 'c1', project_id: 'p1', parent_id: null, date: formatDateKey(new Date()),
            time: '09:00', text: 'Flow deployed to test', responsible: 'JG', is_personal: false,
            owner_initials: 'TB', user_name: 'TB', urgency: 'Alta', has_incident: true,
            completed: false, created_at: new Date().toISOString(),
            responsibles: ['JG', 'TB'], description: 'Check the run history before closing.', estimated_hours: 4
        });
        // One task per priority level, so every badge colour gets audited.
        ['Normal', 'Máxima'].forEach((urgency, i) => window.__DB.daily_comments.push({
            id: 'cu' + i, project_id: 'p1', parent_id: null, date: formatDateKey(new Date()),
            time: '10:0' + i, text: 'Urgency sample ' + urgency, responsible: 'TB', responsibles: ['TB'],
            is_personal: false, owner_initials: 'TB', user_name: 'TB', urgency, has_incident: false,
            completed: false, created_at: new Date().toISOString()
        }));
        // One task per priority in the Tasks view, so every edge/badge is audited.
        [['Baja', 'Bajo'], ['Media', null], ['Alta', 'Alto'], ['Crítica', 'Medio']].forEach(([priority, effort], i) => {
            window.__DB.day_tasks.push({
                id: 'at' + i, task_date: i % 2 ? formatDateKey(new Date()) : null, task_time: i === 1 ? '10:30' : null,
                text: 'Priority sample ' + priority, project_id: i === 2 ? 'p1' : null, assignees: ['TB', 'JG'],
                created_by: 'TB', completed: false, description: i === 3 ? 'Blocking the release' : '',
                estimated_hours: 2, hours_by_assignee: {}, priority, effort,
                visibility: i === 1 ? 'private' : 'team', created_at: new Date().toISOString()
            });
        });

        // One leave day of each kind, so every calendar cell style is audited.
        [['current_year', 'vacation'], ['next_year', 'vacation'], ['not_charged', 'sick_leave']].forEach(([vacation_type, absence_type], i) => {
            const d = getMonday(new Date());
            d.setDate(d.getDate() + i);
            window.__DB.team_vacations.push({
                id: 'v' + i, user_initials: 'TB', start_date: formatDateKey(d), end_date: formatDateKey(d),
                status: 'planned', vacation_type, absence_type, vacation_year: new Date().getFullYear(), days_count: 1
            });
        });
        // Training (green), a personal pending task (blue), admins and an
        // unavailable member, so the November 2026 styles are audited too.
        window.__DB.app_users.forEach(u => { u.is_admin = u.initials === 'TB'; u.is_active = true; u.first_name = u.initials; u.last_name = 'Sample'; });
        window.__DB.app_users.push({ initials: 'XX', email: 'xx@wtwco.com', password_hash: 'x', weekly_hours: 40,
            first_name: 'Xavier', last_name: 'Xu', is_admin: false, is_active: false, deactivated_at: '2026-10-01T00:00:00Z' });
        window.__DB.projects.push({ id: 'pT', name: "TB's Training", phase: 'Training', responsibles: ['TB', 'XX'],
            prerequisites: [], priority: 'Media', impact: 'Medio', status: 'Verde', progress: 0, created_at: new Date().toISOString() });
        window.__DB.daily_comments.push({
            id: 'cT', project_id: 'pT', parent_id: null, date: formatDateKey(new Date()), time: '11:00',
            text: 'Course: Power BI', responsible: 'TB', responsibles: ['TB'], is_personal: false, owner_initials: 'TB',
            user_name: 'TB', urgency: 'Normal', has_incident: false, completed: false, task_type: 'training',
            estimated_hours: 3, created_at: new Date().toISOString()
        }, {
            id: 'cP', project_id: 'p1', parent_id: null, date: (() => { const d = getMonday(new Date()); d.setDate(d.getDate() + 4); return formatDateKey(d); })(),
            time: '12:00', text: 'Personal reminder', responsible: 'TB', responsibles: ['TB'], is_personal: true,
            owner_initials: 'TB', user_name: 'TB', urgency: 'Normal', has_incident: false, completed: false, created_at: new Date().toISOString()
        });
        window.__DB.day_tasks.push({ id: 'atT', task_date: formatDateKey(new Date()), text: 'Training sample', project_id: 'pT',
            assignees: ['TB'], created_by: 'TB', completed: false, estimated_hours: 1, hours_by_assignee: {}, priority: 'Media',
            visibility: 'team', task_type: 'training', created_at: new Date().toISOString() });
        await loadUserDirectory(true);
        syncAdminNavButton();
        await loadTeamVacations();
        await loadDataFromSupabase(true);

        const themes = ['dark', 'light'];
        for (const theme of themes) {
            applyTheme(theme);
            await sleep(250);

            switchView('daily');
            await sleep(40);
            audit(theme + ' / Daily');

            currentProjectId = 'p1';
            switchView('ficha');
            await sleep(60);
            audit(theme + ' / Project card');

            switchView('dashboard');
            await sleep(60);
            audit(theme + ' / Dashboard');

            switchView('equipo');
            await sleep(60);
            audit(theme + ' / Team');

            switchView('tasks');
            await sleep(60);
            audit(theme + ' / Tasks view');
            openTaskEditor();
            await sleep(30);
            document.getElementById('taskEditorDate').value = formatDateKey(new Date());
            onTaskEditorDateChange();
            audit(theme + ' / Task editor');
            closeTaskEditor();
            await sleep(30);
            switchView('equipo');
            await sleep(40);

            showVacationOptionsModal('TB', formatDateKey(new Date()), [formatDateKey(new Date())]);
            await sleep(40);
            document.getElementById('absenceTypeSelect').value = 'sick_leave';
            onAbsenceTypeChange();
            audit(theme + ' / Leave modal (sick leave)');
            closeVacationOptionsModal();
            await sleep(30);

            switchView('daily');
            await sleep(250);
            openDayPersonalTasksModal(null, formatDateKey(new Date()));
            await sleep(50);
            audit(theme + ' / Day tasks modal');
            closeDayPersonalTasksModal();

            openNewProjectModal();
            await sleep(40);
            audit(theme + ' / New project modal');
            closeProjectModal();

            currentProjectId = 'p1';
            switchView('ficha');
            await sleep(50);
            openResponsiblesPopover('p1');
            await sleep(40);
            audit(theme + ' / Owner popover');
            closeResponsiblesPopover();
            if (dailyComments && dailyComments.length) {
                const first = dailyComments.find(c => !c.parentId);
                if (first) {
                    openTaskDetail(first.id);
                    await sleep(60);
                    audit(theme + ' / Task detail');
                    closeTaskDetailModal();
                    await sleep(30);
                }
            }

            // Day Comments with the task detail expanded (urgency badge + description)
            switchView('daily');
            await sleep(30);
            openCommentsList(new Event('click'), 'p1', formatDateKey(new Date()));
            await sleep(40);
            toggleCommentDetail('c1');
            await sleep(40);
            audit(theme + ' / Day comments expanded');
            expandedCommentDetails.clear();
            closeCommentsListModal();
            await sleep(30);

            // Sidebar search with a highlighted match and a no-match message
            setSidebarSearch('claims');
            await sleep(30);
            audit(theme + ' / Sidebar search');
            setSidebarSearch('zzzz');
            await sleep(30);
            audit(theme + ' / Sidebar search no match');
            clearSidebarSearch();
            currentProjectId = 'p1';
            switchView('ficha');
            await sleep(50);

            sidebarCollapsed.archivados = false;
            sidebarCollapsed.eliminados = false;
            renderProjectsList();
            await sleep(40);
            const menuBtn = document.querySelector('.project-item-menu-btn');
            if (menuBtn) {
                openProjectMenu(null, menuBtn.dataset.projectId, 'live');
                await sleep(60);
                audit(theme + ' / Project menu');
                closeProjectMenu();
                await sleep(30);
            }

            currentProjectId = 'pT';
            switchView('ficha');
            await sleep(60);
            audit(theme + ' / Training card (unavailable owner)');

            switchView('admin');
            await sleep(40);
            audit(theme + ' / Admin view');
            openAdminUserModal();
            document.getElementById('adminFirstName').value = 'Laura';
            document.getElementById('adminLastName').value = 'Gomez Ruiz';
            onAdminNameInput();
            await sleep(30);
            audit(theme + ' / Add member modal');
            closeAdminUserModal();
            await sleep(30);

            switchView('daily');
            await sleep(30);
            openDailyCommentModalFromCell(new Event('click'), 'p1', formatDateKey(new Date()));
            await sleep(50);
            toggleDailyTaskResponsible('JG');
            const hoursField = document.getElementById('commentHours');
            if (hoursField) { hoursField.value = '6'; onDailyTaskHoursChange(); }
            toggleDailyTaskHoursSplit();
            await sleep(50);
            audit(theme + ' / Task form with hours split');
            closeDailyModal();
            await sleep(30);
        }

        lines.push('AUDIT DONE');
        out(lines.join('\n'));
    }

    document.addEventListener('DOMContentLoaded', () => {
        run().catch(err => {
            lines.push('AUDIT THREW: ' + (err && err.stack ? err.stack : err));
            out(lines.join('\n'));
        });
    });
})();
