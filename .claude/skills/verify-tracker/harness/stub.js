// In-memory stand-in for supabase-js, faithful to the small surface app.js
// uses: from / select / insert / update / delete / upsert / eq / order /
// single, plus channel().on().subscribe().
(function () {
    const DB = {
        app_users: [
            { initials: 'TB', email: 'teo.balsalobre@wtwco.com', password_hash: 'x', weekly_hours: 40, created_at: '2026-01-01T00:00:00Z' },
            { initials: 'AR', email: 'ana.real@wtwco.com', password_hash: 'x', weekly_hours: 40, created_at: '2026-01-01T00:00:00Z' },
            { initials: 'AD', email: 'abha.dungdung@wtwco.com', password_hash: 'x', weekly_hours: 20, created_at: '2026-01-01T00:00:00Z' },
            { initials: 'JG', email: 'jorge.gazulla@wtwco.com', password_hash: 'x', weekly_hours: 40, created_at: '2026-01-01T00:00:00Z' },
            { initials: 'IM', email: 'ines.marcelino@wtwco.com', password_hash: 'x', weekly_hours: 40, created_at: '2026-01-01T00:00:00Z' }
        ],
        projects: [
            {
                id: 'p1', name: 'Claims Automation', start_date: '2026-09-01', end_date: null,
                phase: 'Development', bau_owner: null, stakeholders: '', benefits: '', description: '',
                country: 'France', volume: 50000, fte: 1.5, priority: 'Alta', impact: 'Alto',
                status: 'Verde', progress: 40, prerequisites: [], responsibles: ['TB'],
                created_at: '2026-09-01T00:00:00Z'
            }
        ],
        daily_comments: [],
        project_capacities: [],
        project_weekly_tasks: [],
        project_statuses: [],
        project_notes: [],
        project_incidents: [],
        team_vacations: [],
        day_personal_tasks: [],
        day_tasks: [],
        user_capacity_overrides: []
    };

    window.__DB = DB;
    window.__writes = [];

    let autoId = 1;
    const newId = () => 'gen-' + (autoId++);

    function matches(row, filters) {
        return filters.every(f => String(row[f.col]) === String(f.val));
    }

    function makeBuilder(table) {
        const state = { op: null, payload: null, filters: [], orders: [], single: false };

        const builder = {
            select() { if (!state.op) state.op = 'select'; return builder; },
            order(col, opts) { state.orders.push({ col, asc: !opts || opts.ascending !== false }); return builder; },
            eq(col, val) { state.filters.push({ col, val }); return builder; },
            single() { state.single = true; return builder; },
            insert(payload) { state.op = 'insert'; state.payload = payload; return builder; },
            update(payload) { state.op = 'update'; state.payload = payload; return builder; },
            upsert(payload, opts) { state.op = 'upsert'; state.payload = payload; state.onConflict = (opts && opts.onConflict) || null; return builder; },
            delete() { state.op = 'delete'; return builder; },
            then(resolve, reject) {
                let result;
                try {
                    result = run(table, state);
                } catch (err) {
                    result = { data: null, error: { message: String(err) } };
                }
                return Promise.resolve(result).then(resolve, reject);
            }
        };
        return builder;
    }

    function run(table, state) {
        if (!DB[table]) return { data: null, error: { message: 'no such table: ' + table } };
        const rows = DB[table];

        if (state.op === 'insert' || state.op === 'upsert') {
            const incoming = Array.isArray(state.payload) ? state.payload : [state.payload];
            const stored = incoming.map(r => {
                const row = Object.assign({}, r);
                if (row.id === undefined || row.id === null) row.id = newId();
                if (!row.created_at) row.created_at = new Date().toISOString();
                return row;
            });
            stored.forEach(row => {
                // Conflict key: whatever onConflict said, else the table's PK.
                // user_capacity_overrides has a COMPOSITE pk
                // (user_initials, week_start) and no id column, so a single
                // 'id' comparison would silently duplicate rows.
                const keys = state.onConflict
                    ? state.onConflict.split(',').map(k => k.trim())
                    : [table === 'app_users' ? 'initials' : 'id'];
                const idx = rows.findIndex(existing => keys.every(k => existing[k] === row[k]));
                if (idx >= 0) rows[idx] = Object.assign({}, rows[idx], row);
                else rows.push(row);
            });
            window.__writes.push({ table, op: state.op, payload: state.payload });
            const data = state.single ? stored[0] : stored;
            return { data, error: null };
        }

        if (state.op === 'update') {
            const hit = rows.filter(r => matches(r, state.filters));
            hit.forEach(r => Object.assign(r, state.payload));
            window.__writes.push({ table, op: 'update', payload: state.payload, filters: state.filters, affected: hit.length });
            return { data: hit, error: null };
        }

        if (state.op === 'delete') {
            const keep = rows.filter(r => !matches(r, state.filters));
            const removed = rows.length - keep.length;
            DB[table] = keep;
            window.__writes.push({ table, op: 'delete', filters: state.filters, affected: removed });
            return { data: null, error: null };
        }

        // select
        let out = rows.filter(r => matches(r, state.filters)).map(r => Object.assign({}, r));
        state.orders.forEach(o => {
            out.sort((a, b) => {
                const av = a[o.col], bv = b[o.col];
                if (av === bv) return 0;
                const cmp = av > bv ? 1 : -1;
                return o.asc ? cmp : -cmp;
            });
        });
        return { data: state.single ? (out[0] || null) : out, error: null };
    }

    const channelStub = {
        on() { return channelStub; },
        subscribe() { return channelStub; }
    };

    window.supabase = {
        createClient() {
            return {
                from: makeBuilder,
                channel() { return channelStub; },
                removeChannel() {}
            };
        }
    };
})();
