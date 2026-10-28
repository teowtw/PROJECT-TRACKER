// ===== Tema claro/oscuro (Paper & Ink) =====
const APP_THEME_STORAGE_KEY = 'pt_theme';

function getStoredTheme() {
    try {
        return localStorage.getItem(APP_THEME_STORAGE_KEY);
    } catch {
        return null;
    }
}

function applyTheme(theme) {
    const resolved = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.setAttribute('data-theme', resolved);
    const toggle = document.getElementById('themeToggleBtn');
    if (toggle) {
        toggle.textContent = resolved === 'dark' ? '◑ Light mode' : '◐ Dark mode';
        toggle.setAttribute('aria-pressed', resolved === 'dark' ? 'true' : 'false');
    }
}

function initTheme() {
    applyTheme(getStoredTheme() || 'dark');
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    const next = current === 'dark' ? 'light' : 'dark';
    try {
        localStorage.setItem(APP_THEME_STORAGE_KEY, next);
    } catch {
        // Ignorar fallos de storage local.
    }
    applyTheme(next);
}

// Permite añadir o editar la URL de un prerrequisito desde la ficha
function normalizeDocumentationUrl(rawUrl) {
    const value = (rawUrl || '').trim();
    if (!value) return '';

    let candidate = value;
    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(candidate)) {
        candidate = `https://${candidate}`;
    }

    try {
        const parsed = new URL(candidate);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
            return null;
        }
        return parsed.toString();
    } catch {
        return null;
    }
}

function handlePrereqClick(event, projectId, prereqName) {
    event.stopPropagation();
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    let prereqs = project.prerequisites || [];
    let item = prereqs.find(p => p.name === prereqName);
    let currentUrl = item && item.url ? item.url : '';
    const rawUrl = prompt('Enter the documentation URL for "' + prereqName + '" (leave empty to remove it):', currentUrl);

    if (rawUrl === null) return;

    const normalizedUrl = normalizeDocumentationUrl(rawUrl);
    if (normalizedUrl === null) {
        showToast('Invalid URL. Use a valid http(s) URL.', 'error');
        return;
    }

    if (!item) {
        if (!normalizedUrl) return;
        item = { name: prereqName, done: false, na: false };
        prereqs.push(item);
    }

    if (normalizedUrl) {
        item.url = normalizedUrl;
    } else {
        delete item.url;
    }

    updateProjectField(projectId, 'prerequisites', prereqs).then(() => {
        currentProjectId = projectId;
        renderFicha();
    });
}

// ========== CONFIGURACIÓN PRODUCCIÓN ==========

// =====================================================
// =========== CONFIGURACIÓN Y VARIABLES GLOBALES ======
// =====================================================

let projectStatuses = [];
let projectNotes = [];
let projectNoteEditorState = {
    isOpen: false,
    editNoteId: null
};
let weeklyTasks = [];
let incidents = [];
let dayPersonalTasks = [];
// Tareas de día compartidas del equipo (tabla day_tasks). Ver
// migrations_day_tasks.sql.
let dayTasks = [];
// Overrides manuales de capacidad por (persona, semana). Ver
// migrations_capacity_tasks_archive.sql.
let capacityOverrides = [];
let currentUser = null;
const APP_LOGIN_PASSWORD = 'WEai2026!';
const APP_LOGIN_STORAGE_KEY = 'wtw_login_session_v1';
const APP_CURRENT_USER_STORAGE_KEY = 'wtw_current_user';
const APP_USERS_STORAGE_KEY = 'wtw_user_directory_v1';
const APP_USERS_TABLE = 'app_users';
const DAY_PERSONAL_TASKS_TABLE = 'day_personal_tasks';
const DAY_TASKS_TABLE = 'day_tasks';
const CAPACITY_OVERRIDES_TABLE = 'user_capacity_overrides';
const APP_LOGIN_EXPIRY_DAYS = 30;
// Equipo WE AI Implementation Analysts. Contraseña inicial compartida (ver
// APP_LOGIN_PASSWORD); cada persona puede cambiarla luego desde su perfil.
const DEFAULT_USERS = [
    { initials: 'TB', email: 'teo.balsalobre@wtwco.com' },
    { initials: 'AR', email: 'ana.real@wtwco.com' },
    { initials: 'AD', email: 'abha.dungdung@wtwco.com' },
    { initials: 'JG', email: 'jorge.gazulla@wtwco.com' },
    { initials: 'IM', email: 'ines.marcelino@wtwco.com' }
];
let userDirectory = {};
let userDirectorySource = 'local';
let userDirectoryLoaded = false;
let defaultPasswordHashCache = null;
let appInitialized = false;

function normalizeInitials(value) {
    return (value || '').trim().toUpperCase();
}

function normalizeEmail(value) {
    return (value || '').trim().toLowerCase();
}

// Jornada semanal de una persona, saneada. Es el denominador de todos
// los porcentajes de capacidad, así que un 0 o una cadena vacía
// provocaría divisiones por cero: se cae al valor por defecto.
// El tope son las horas que tiene una semana.
function normalizeWeeklyHours(value) {
    const hours = Number(value);
    if (!Number.isFinite(hours) || hours <= 0) return DEFAULT_WEEKLY_HOURS;
    return Math.min(hours, 168);
}

async function hashTextSha256(value) {
    const text = String(value || '');
    if (!window.crypto || !window.crypto.subtle) {
        // Fallback for non-secure contexts where SubtleCrypto is unavailable.
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = ((hash << 5) - hash) + text.charCodeAt(i);
            hash |= 0;
        }
        return `fallback_${(hash >>> 0).toString(16).padStart(8, '0')}`;
    }
    const bytes = new TextEncoder().encode(text);
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function getDefaultPasswordHash() {
    if (!defaultPasswordHashCache) {
        defaultPasswordHashCache = await hashTextSha256(APP_LOGIN_PASSWORD);
    }
    return defaultPasswordHashCache;
}

function getDefaultEmailByInitials(initials) {
    const normalized = normalizeInitials(initials);
    const found = DEFAULT_USERS.find(u => u.initials === normalized);
    return found ? found.email : '';
}

async function buildDefaultUserDirectory() {
    const hash = await getDefaultPasswordHash();
    const directory = {};
    DEFAULT_USERS.forEach(user => {
        directory[user.initials] = {
            initials: user.initials,
            email: user.email,
            passwordHash: hash,
            weeklyHours: DEFAULT_WEEKLY_HOURS
        };
    });
    return directory;
}

function normalizeUserDirectory(rawDirectory) {
    const normalized = {};
    const source = rawDirectory && typeof rawDirectory === 'object' ? rawDirectory : {};

    Object.keys(source).forEach(key => {
        const row = source[key] || {};
        const initials = normalizeInitials(row.initials || key);
        if (!initials) return;
        const pick = (camel, snake) => row[camel] !== undefined ? row[camel] : row[snake];
        normalized[initials] = {
            initials,
            email: normalizeEmail(row.email || getDefaultEmailByInitials(initials)),
            passwordHash: String(row.passwordHash || row.password_hash || ''),
            weeklyHours: normalizeWeeklyHours(pick('weeklyHours', 'weekly_hours')),
            holidayRegion: normalizeHolidayRegion(pick('holidayRegion', 'holiday_region')),
            // migrations_training_hours_admin.sql. Sin la columna (o en una
            // caché local antigua) todo el mundo es activo y nadie es admin.
            firstName: String(pick('firstName', 'first_name') || '').trim(),
            lastName: String(pick('lastName', 'last_name') || '').trim(),
            isAdmin: pick('isAdmin', 'is_admin') === true,
            isActive: pick('isActive', 'is_active') !== false,
            deactivatedAt: pick('deactivatedAt', 'deactivated_at') || null,
            deactivatedBy: normalizeInitials(pick('deactivatedBy', 'deactivated_by') || '')
        };
    });

    return normalized;
}

function saveUserDirectoryToLocalStorage() {
    try {
        localStorage.setItem(APP_USERS_STORAGE_KEY, JSON.stringify(userDirectory));
    } catch {
        // Ignorar fallos de storage local.
    }
}

function loadUserDirectoryFromLocalStorage() {
    try {
        const raw = localStorage.getItem(APP_USERS_STORAGE_KEY);
        if (!raw) return null;
        return normalizeUserDirectory(JSON.parse(raw));
    } catch {
        return null;
    }
}

// teamMembers = personas ACTIVAS: es lo que alimenta todos los selectores
// (owners, asignados, responsables), el calendario de Team y las filas de
// capacidad. Alguien dado de baja sale de ahí, pero su trabajo sigue
// guardado con sus iniciales y se ve en gris (ver isMemberActive).
function refreshTeamMembersFromDirectory() {
    const members = Object.keys(userDirectory).filter(i => userDirectory[i].isActive !== false).sort();
    if (members.length === 0) return;
    teamMembers.splice(0, teamMembers.length, ...members);
}

// force: volver a leer de Supabase aunque ya se hubiera cargado (p. ej.
// cuando otro admin da de alta o de baja a alguien, vía realtime).
async function loadUserDirectory(force = false) {
    if (userDirectoryLoaded && !force) return;

    const localDirectory = loadUserDirectoryFromLocalStorage();
    if (localDirectory && Object.keys(localDirectory).length > 0) {
        userDirectory = localDirectory;
        userDirectorySource = 'local';
    }

    const { data, error } = await supabaseClient
        .from(APP_USERS_TABLE)
        .select('*')
        .order('initials', { ascending: true });

    if (!error) {
        if ((data || []).length > 0) {
            const supabaseDirectory = {};
            data.forEach(row => {
                const initials = normalizeInitials(row.initials);
                if (!initials) return;
                supabaseDirectory[initials] = row;
            });
            userDirectory = normalizeUserDirectory(supabaseDirectory);
            userDirectorySource = 'supabase';
            saveUserDirectoryToLocalStorage();
        } else {
            const defaults = await buildDefaultUserDirectory();
            const rows = Object.values(defaults).map(u => ({
                initials: u.initials,
                email: u.email,
                weekly_hours: u.weeklyHours,
                password_hash: u.passwordHash
            }));

            const { error: upsertError } = await supabaseClient
                .from(APP_USERS_TABLE)
                .upsert(rows, { onConflict: 'initials' });

            if (!upsertError) {
                userDirectory = defaults;
                userDirectorySource = 'supabase';
                saveUserDirectoryToLocalStorage();
            }
        }
    }

    if (Object.keys(userDirectory).length === 0) {
        userDirectory = await buildDefaultUserDirectory();
        userDirectorySource = 'local';
        saveUserDirectoryToLocalStorage();
    }

    refreshTeamMembersFromDirectory();
    userDirectoryLoaded = true;
}

function getCurrentUserProfile() {
    const initials = normalizeInitials(currentUser);
    return userDirectory[initials] || null;
}

function getUserEmailByInitials(initials) {
    const normalized = normalizeInitials(initials);
    const profile = userDirectory[normalized];
    return profile ? profile.email : '';
}

function isCurrentUserAdmin() {
    const profile = getCurrentUserProfile();
    return !!profile && profile.isAdmin && profile.isActive !== false;
}

// Iniciales que no están en el directorio (p. ej. las antiguas de
// alguien que se cambió las iniciales) cuentan como no disponibles.
function isMemberActive(initials) {
    const profile = userDirectory[normalizeInitials(initials)];
    return !!profile && profile.isActive !== false;
}

function getMemberFullName(initials) {
    const profile = userDirectory[normalizeInitials(initials)];
    if (!profile) return '';
    return [profile.firstName, profile.lastName].filter(Boolean).join(' ');
}

// Atributos de un chip de persona: tooltip con el nombre y, si ya no está
// disponible, data-unavailable para pintarlo en gris.
function getMemberChipAttrs(initials) {
    const name = getMemberFullName(initials);
    if (isMemberActive(initials)) {
        return name ? ` title="${escapeHtml(name)}"` : '';
    }
    return ` data-unavailable="true" title="${escapeHtml((name ? name + ' · ' : '') + 'No longer available')}"`;
}

// Fila de app_users a partir de un perfil del directorio. Se mandan
// SIEMPRE todas las columnas: el upsert parcial que había hacía que
// cambiar de iniciales perdiera la región, el nombre o el rol de admin.
function buildAppUserRow(profile) {
    return {
        initials: profile.initials,
        email: normalizeEmail(profile.email),
        password_hash: String(profile.passwordHash || ''),
        weekly_hours: normalizeWeeklyHours(profile.weeklyHours),
        holiday_region: profile.holidayRegion || null,
        first_name: profile.firstName || null,
        last_name: profile.lastName || null,
        is_admin: !!profile.isAdmin,
        is_active: profile.isActive !== false,
        deactivated_at: profile.deactivatedAt || null,
        deactivated_by: profile.deactivatedBy || null
    };
}

async function saveUserProfile(oldInitials, profile) {
    const oldKey = normalizeInitials(oldInitials);
    const newKey = normalizeInitials(profile && profile.initials);
    if (!newKey) throw new Error('Invalid initials');

    const previous = userDirectory[oldKey] || userDirectory[newKey] || {};
    if (oldKey && oldKey !== newKey) {
        delete userDirectory[oldKey];
    }

    userDirectory[newKey] = Object.assign({}, previous, {
        initials: newKey,
        email: normalizeEmail(profile.email),
        passwordHash: String(profile.passwordHash || ''),
        weeklyHours: normalizeWeeklyHours(profile.weeklyHours)
    });

    saveUserDirectoryToLocalStorage();
    refreshTeamMembersFromDirectory();

    if (userDirectorySource === 'supabase') {
        const { error: upsertError } = await supabaseClient
            .from(APP_USERS_TABLE)
            .upsert(buildAppUserRow(userDirectory[newKey]), { onConflict: 'initials' });

        if (upsertError) {
            throw new Error(formatSupabaseError(upsertError, 'Could not save the user to Supabase'));
        }

        // Cambio de iniciales: se borra la fila antigua de app_users
        // (decisión de Teo, 28-oct-2026). Es el ÚNICO delete sobre app_users:
        // dar de baja a alguien es is_active = false. Proyectos y tareas no
        // se tocan y siguen con las iniciales antiguas, que la app muestra en
        // gris como persona no disponible.
        if (oldKey && oldKey !== newKey) {
            await supabaseClient
                .from(APP_USERS_TABLE)
                .delete()
                .eq('initials', oldKey);
        }
    }
}

// Cambios de un admin sobre otra persona (baja, reactivar, reset de
// contraseña, rol). Siempre update, nunca delete: el historial se conserva.
async function updateAppUser(initials, changes) {
    const key = normalizeInitials(initials);
    const profile = userDirectory[key];
    if (!profile) throw new Error('User not found');
    const next = Object.assign({}, profile, changes);
    const row = buildAppUserRow(next);
    delete row.initials;
    const { error } = await supabaseClient.from(APP_USERS_TABLE).update(row).eq('initials', key);
    if (error) throw new Error(formatSupabaseError(error, 'Could not update the user'));
    userDirectory[key] = next;
    saveUserDirectoryToLocalStorage();
    refreshTeamMembersFromDirectory();
}

async function createAppUser(profile) {
    const row = buildAppUserRow(profile);
    // insert y no upsert: si las iniciales ya existen, que falle en vez de
    // sobrescribir a otra persona.
    const { error } = await supabaseClient.from(APP_USERS_TABLE).insert(row);
    if (error) throw new Error(formatSupabaseError(error, 'Could not create the user'));
    userDirectory[row.initials] = normalizeUserDirectory({ [row.initials]: row })[row.initials];
    saveUserDirectoryToLocalStorage();
    refreshTeamMembersFromDirectory();
}

// =====================================================
// ================ FEEDBACK (TOASTS) ==================
// Avisos no bloqueantes. type: info | success | warning | error
// options.key permite reutilizar un mismo toast (p. ej. autoguardado)
// =====================================================

function showToast(message, type = 'info', options = {}) {
    const { duration = (type === 'error' ? 5000 : 3200), key = null } = options;
    const container = document.getElementById('toastContainer');
    if (!container) {
        if (type === 'error' || type === 'warning') window.alert(message);
        return;
    }

    let toast = key ? container.querySelector(`.toast[data-key="${key}"]`) : null;
    const isNew = !toast;
    if (isNew) {
        toast = document.createElement('div');
        if (key) toast.dataset.key = key;
        toast.addEventListener('click', () => dismissToast(toast));
        container.appendChild(toast);
    } else {
        clearTimeout(Number(toast.dataset.timer));
    }

    toast.className = `toast toast--${type}${isNew ? '' : ' is-visible'}`;
    toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
    toast.textContent = message;
    if (isNew) requestAnimationFrame(() => toast.classList.add('is-visible'));
    toast.dataset.timer = String(setTimeout(() => dismissToast(toast), duration));
}

function dismissToast(toast) {
    if (!toast || !toast.isConnected) return;
    clearTimeout(Number(toast.dataset.timer));
    toast.classList.remove('is-visible');
    setTimeout(() => toast.remove(), 220);
}

// =====================================================
// ================= GESTIÓN DE MODALES ================
// Apertura/cierre centralizados: foco inicial, devolución
// del foco al cerrar, Escape y cierre por fondo (opcional).
// =====================================================

const MODAL_CLOSE_HANDLERS = {
    dailyModal: () => closeDailyModal(),
    commentsListModal: () => closeCommentsListModal(),
    dayPersonalTasksModal: () => closeDayPersonalTasksModal(),
    vacationOptionsModal: () => closeVacationOptionsModal(),
    userSettingsModal: () => closeUserSettingsModal(),
    projectModal: () => closeProjectModal(),
    renameProjectModal: () => closeRenameProjectModal(),
    taskDetailModal: () => closeTaskDetailModal(),
    taskEditorModal: () => closeTaskEditor(),
    adminUserModal: () => closeAdminUserModal()
};
const modalOpenerStack = [];

function openModal(id, focusSelector = null) {
    const modal = document.getElementById(id);
    if (!modal) return;
    if (!modal.classList.contains('active')) {
        modalOpenerStack.push({ id, opener: document.activeElement });
        modal.classList.add('active');
    }
    const target = (focusSelector && modal.querySelector(focusSelector)) || modal.querySelector('.modal-content');
    setTimeout(() => {
        // Instantánea tras rellenar el formulario (el llamante lo rellena justo después de openModal)
        if (modal.hasAttribute('data-dirty-check')) modal.dataset.snapshot = getModalFormSnapshot(modal);
        if (target) target.focus({ preventScroll: true });
    }, 0);
}

function getModalFormSnapshot(modal) {
    return Array.from(modal.querySelectorAll('input, select, textarea'))
        .map(el => (el.type === 'checkbox' || el.type === 'radio') ? String(el.checked) : el.value)
        .join('\u0001');
}

function isModalDirty(modal) {
    if (!modal || !modal.hasAttribute('data-dirty-check')) return false;
    return modal.dataset.snapshot !== undefined && modal.dataset.snapshot !== getModalFormSnapshot(modal);
}

function closeModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    modal.classList.remove('active');
    delete modal.dataset.snapshot;
    if (modal.contains(document.activeElement)) document.activeElement.blur();
    const idx = modalOpenerStack.map(entry => entry.id).lastIndexOf(id);
    if (idx === -1) return;
    const { opener } = modalOpenerStack.splice(idx, 1)[0];
    const anotherOpen = document.querySelector('.modal.active');
    if (!anotherOpen && opener && typeof opener.focus === 'function' && document.contains(opener) && opener !== document.body) {
        setTimeout(() => opener.focus({ preventScroll: true }), 0);
    }
}

function closeTopModal() {
    const top = modalOpenerStack[modalOpenerStack.length - 1];
    const fallback = document.querySelector('.modal.active');
    const id = top ? top.id : (fallback ? fallback.id : null);
    if (!id) return false;
    if (isModalDirty(document.getElementById(id)) && !confirm('You have unsaved changes. Discard them?')) return true;
    const handler = MODAL_CLOSE_HANDLERS[id];
    if (handler) handler(); else closeModal(id);
    return true;
}

// Indicadores (prioridad, impacto, estado) operables con teclado
function handleIndicatorKey(event, type) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    toggleIndicatorDropdown(event, type);
    const firstOption = document.querySelector(`#dropdown-${type} .indicator-option`);
    if (firstOption) firstOption.focus();
}

// =====================================================
// =============== FUNCIONES COMPARTIDAS ===============
// (utilidades, helpers, actualización de campos, etc.)
// =====================================================

let sidebarCollapsed = {
    activos: false,
    bau: false,
    training: false,
    completados: false,
    // Archivados y papelera arrancan plegados: son secciones de consulta,
    // no de trabajo diario.
    archivados: true,
    eliminados: true
};

// Fases heredadas de un vocabulario antiguo -> fase actual (PROJECT_PHASES)
const LEGACY_PHASE_MAP = {
    'Idea': 'Discovery',
    'En Progreso': 'Development',
    'Cerrado': 'Completed',
    'Mantenimiento': 'BAU'
};

function isTrainingProject(project) {
    return !!project && project.phase === TRAINING_PHASE;
}

// Grupo de trabajo de un proyecto. El archivado se comprueba ANTES de la
// fase: un proyecto archivado sale de Activos/BAU/Completados y pasa a su
// propia sección, conserve la fase que conserve.
// Training tiene grupo propio: no es portfolio (no cuenta en los KPIs del
// dashboard) pero sus horas sí computan capacidad.
function getProjectGroup(project) {
    if (isProjectArchived(project)) return 'archivados';
    const phase = project && project.phase;
    if (phase === TRAINING_PHASE) return 'training';
    if (phase === 'Completed' || phase === 'Cancelled') return 'completados';
    if (phase === 'BAU') return 'bau';
    return 'activos';
}

// Tipo de tarea (daily_comments.task_type / day_tasks.task_type).
// Training se pinta en verde en Daily y Tasks.
const TASK_TYPE_STANDARD = 'standard';
const TASK_TYPE_TRAINING = 'training';

function normalizeTaskType(value) {
    return value === TASK_TYPE_TRAINING ? TASK_TYPE_TRAINING : TASK_TYPE_STANDARD;
}

function isTrainingTask(task) {
    return !!task && task.taskType === TASK_TYPE_TRAINING;
}

// Tipo por defecto de una tarea nueva según su proyecto: en un proyecto
// Training, la tarea es de training salvo que se cambie a mano.
function getDefaultTaskTypeForProject(projectId) {
    const project = projectId ? projects.find(p => p.id === projectId) : null;
    return isTrainingProject(project) ? TASK_TYPE_TRAINING : TASK_TYPE_STANDARD;
}

function renderTrainingBadge() {
    return '<span class="training-badge">Training</span>';
}

// Savings en horas al año. Vacío = sin indicar (null), no 0: así el
// dashboard distingue "no se ha calculado" de "no ahorra nada".
function parseOptionalNonNegative(value) {
    if (value === null || value === undefined || String(value).trim() === '') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? number : null;
}

function parseSavingsHours(value) {
    return parseOptionalNonNegative(value);
}

function formatSavingsHours(value) {
    const hours = parseSavingsHours(value);
    return hours === null ? '-' : `${hours.toLocaleString('en-GB', { maximumFractionDigits: 1 })} h`;
}

// =====================================================
// ============ BÚSQUEDA DE PROYECTOS ==================
// La comparten el buscador del sidebar y el del dashboard, para que
// la misma consulta encuentre lo mismo en los dos sitios.
//   - sin mayúsculas ni acentos ("operacion" encuentra "Operación")
//   - por palabras, y TODAS deben aparecer (en cualquier orden)
//   - en varios campos, no solo el nombre
// =====================================================

function normalizeSearchText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase();
}

function getSearchTokens(query) {
    return normalizeSearchText(query).split(/\s+/).filter(Boolean);
}

// Palabras que el equipo usa y que no coinciden literalmente con el
// dato guardado (fases y estados se guardan en otro vocabulario).
const SEARCH_SYNONYMS = {
    done: 'completed', finished: 'completed', closed: 'completed',
    maintenance: 'bau', hold: 'on hold', paused: 'on hold',
    green: 'verde', amber: 'ambar', red: 'rojo',
    blocked: 'rojo', risk: 'ambar', cancelled: 'cancel'
};

function getProjectSearchHaystack(project) {
    const members = (project.responsibles || []).map(initials => `${initials} ${getUserEmailByInitials(initials) || ''}`);
    return normalizeSearchText([
        project.name,
        project.description,
        project.country,
        project.phase,
        project.stakeholders,
        project.benefits,
        project.status,
        getPriorityLabel(project.priority),
        ...members
    ].join(' \u0001 '));
}

function projectMatchesQuery(project, query) {
    const tokens = getSearchTokens(query);
    if (!tokens.length) return true;
    const haystack = getProjectSearchHaystack(project);
    return tokens.every(token => haystack.includes(token) || (SEARCH_SYNONYMS[token] && haystack.includes(SEARCH_SYNONYMS[token])));
}

// Marca con <mark> las palabras buscadas dentro de `text`, respetando el
// texto original (con acentos) aunque la comparación se haga sin ellos.
function highlightSearchMatches(text, query) {
    const source = String(text || '');
    const tokens = getSearchTokens(query);
    if (!tokens.length) return escapeHtml(source);

    let normalized = '';
    const originIndex = [];
    for (let i = 0; i < source.length; i++) {
        for (const ch of normalizeSearchText(source[i])) {
            normalized += ch;
            originIndex.push(i);
        }
    }

    const marked = new Array(source.length).fill(false);
    tokens.forEach(token => {
        let from = normalized.indexOf(token);
        while (from !== -1) {
            for (let k = from; k < from + token.length; k++) marked[originIndex[k]] = true;
            from = normalized.indexOf(token, from + token.length);
        }
    });

    let html = '';
    let open = false;
    for (let i = 0; i < source.length; i++) {
        if (marked[i] && !open) { html += '<mark>'; open = true; }
        if (!marked[i] && open) { html += '</mark>'; open = false; }
        html += escapeHtml(source[i]);
    }
    if (open) html += '</mark>';
    return html;
}

// =====================================================
// ========= PROYECTOS: ARCHIVADO Y PAPELERA ===========
//
// `projects` contiene solo los proyectos NO borrados (vivos +
// archivados). Los de la papelera viven aparte, en deletedProjects.
// Se hace así a propósito: cualquier vista, filtro o selector que ya
// recorría `projects` sigue funcionando sin poder colar por descuido
// un proyecto que el usuario ha tirado. Para que reaparezca hay que
// restaurarlo explícitamente.
//
// El archivado sí se queda en `projects`, porque getProjectGroup() lo
// desvía a su propia sección y sus horas históricas deben seguir
// contando en la capacidad de las semanas pasadas.
// =====================================================

let deletedProjects = [];

function isProjectArchived(project) {
    return !!(project && project.archivedAt);
}

// Proyectos "vivos": ni archivados ni en la papelera. Es lo que deben
// usar el dashboard y los selectores al crear algo nuevo.
function getLiveProjects() {
    return projects.filter(p => !isProjectArchived(p));
}

// Busca en vivos, archivados y papelera. La ficha la necesita para
// poder abrir un proyecto archivado o restaurado.
function findAnyProject(projectId) {
    return projects.find(p => p.id === projectId)
        || deletedProjects.find(p => p.id === projectId)
        || null;
}

function countOpenIncidents(projectId) {
    return (incidents || []).filter(i => i.projectId === projectId && !i.resolved).length;
}

// =====================================================
// ============== CAPACIDAD POR HORAS ==================
//
// Única fuente de verdad para "cuántas horas tiene X esta semana".
// La usan el widget de la ficha de proyecto y la tabla del dashboard,
// así que los dos números no pueden discrepar por construcción.
//
// Modelo:
//   - Una tarea (daily_comments o day_tasks) tiene estimated_hours =
//     esfuerzo TOTAL, y una lista de responsables.
//   - Por defecto las horas se reparten a partes iguales entre los
//     responsables. hours_by_assignee permite un reparto explícito
//     {"TB": 8, "JG": 2} cuando la realidad no es simétrica (lo que
//     se estimó en 5 h acabó siendo 8 para uno y 2 para el otro).
//   - La semana de una tarea es la del lunes de su fecha.
//   - Cuentan las completadas además de las pendientes: el objetivo
//     es ver la carga ASIGNADA a la semana, no lo que falta. Las
//     pendientes se calculan aparte para poder mostrarlas al lado.
//   - Un override manual en user_capacity_overrides gana al cálculo.
//
// Limitación conocida y deliberada: las tareas personales de otras
// personas no están en memoria (loadDataFromSupabase las filtra por
// privacidad), así que sus horas no suman en la capacidad que tú ves.
// Son to-dos privados por diseño; no se puede tener las dos cosas.
// =====================================================

const DEFAULT_WEEKLY_HOURS = 40;

// Jornada semanal de una persona: el denominador de todos los %.
function getUserWeeklyHours(initials) {
    const profile = userDirectory[normalizeInitials(initials)];
    const hours = Number(profile && profile.weeklyHours);
    return Number.isFinite(hours) && hours > 0 ? hours : DEFAULT_WEEKLY_HOURS;
}

// Responsables de una tarea, venga de donde venga. Acepta los tres
// formatos que existen en la base: responsibles[] (daily_comments
// actual), assignees[] (day_tasks) y responsible como texto único
// (daily_comments heredados que la migración no tocó).
function getTaskAssignees(task) {
    if (!task) return [];
    if (Array.isArray(task.responsibles) && task.responsibles.length) return task.responsibles;
    if (Array.isArray(task.assignees) && task.assignees.length) return task.assignees;
    const single = normalizeInitials(task.responsible || '');
    return single ? [single] : [];
}

// Reparto explícito de horas, saneado: claves en mayúsculas y valores
// numéricos >= 0. Llega como jsonb, así que puede traer cualquier cosa.
function normalizeHoursByAssignee(raw) {
    const out = {};
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
    Object.keys(raw).forEach(key => {
        const initials = normalizeInitials(key);
        const hours = Number(raw[key]);
        if (!initials || !Number.isFinite(hours) || hours < 0) return;
        out[initials] = hours;
    });
    return out;
}

// Horas que una tarea carga sobre `user`. 0 si no es responsable.
function getTaskHoursForUser(task, user) {
    const assignees = getTaskAssignees(task);
    const key = normalizeInitials(user);
    if (!assignees.includes(key)) return 0;

    // Reparto explícito, si lo hay para esta persona.
    const map = task.hoursByAssignee || {};
    if (Object.prototype.hasOwnProperty.call(map, key)) {
        const explicit = Number(map[key]);
        if (Number.isFinite(explicit)) return Math.max(0, explicit);
    }

    const total = Number(task.estimatedHours) || 0;
    if (total <= 0 || !assignees.length) return 0;
    return total / assignees.length;
}

// Total real de una tarea = lo que carga a cada responsable sumado.
// Con reparto personalizado puede no coincidir con estimatedHours,
// así que esto es lo que hay que mostrar como "total".
function getTaskTotalHours(task) {
    return getTaskAssignees(task).reduce((sum, u) => sum + getTaskHoursForUser(task, u), 0);
}

function getWeekKeyForDateKey(dateKey) {
    const parsed = parseDateKeyToDate(dateKey);
    return parsed ? formatDateKey(getMonday(parsed)) : null;
}

// Tareas que caen en la semana indicada. Las respuestas de un hilo
// (parentId) no son tareas y no cuentan horas.
function getTasksForWeek(weekKey) {
    const comments = (dailyComments || [])
        .filter(c => !c.parentId && getWeekKeyForDateKey(c.date) === weekKey);
    const teamDayTasks = (dayTasks || [])
        .filter(t => getWeekKeyForDateKey(t.date) === weekKey);
    return comments.concat(teamDayTasks);
}

// Días laborables de la semana (lunes a viernes) que la persona NO
// tiene libres. Un festivo de su región o cualquier ausencia (también
// bajas y asuntos personales, aunque no carguen saldo) le quita ese día
// de capacidad: una semana con 2 días libres son 3/5 de su jornada.
function getWeekDaysOff(user, weekKey) {
    const monday = parseDateKeyToDate(weekKey);
    const result = { holidays: 0, absences: 0 };
    if (!monday) return result;
    const initials = normalizeInitials(user);
    for (let i = 0; i < 5; i++) {
        const day = new Date(monday);
        day.setDate(day.getDate() + i);
        const dateKey = formatDateKey(day);
        if (isHolidayForMember(initials, dateKey)) {
            result.holidays += 1;
        } else {
            // Un medio día (mañana o tarde) quita medio día de capacidad.
            const absence = (teamVacations || []).find(v =>
                normalizeInitials(v.user_initials) === initials && dateKey >= v.start_date && dateKey <= v.end_date);
            if (absence) result.absences += isHalfDayLeave(absence) ? 0.5 : 1;
        }
    }
    return result;
}

// Carga de una semana, por persona. Siempre devuelve entrada para
// todo el equipo, aunque no tenga nada asignado, para que el widget
// pueda pintar la plantilla completa.
function computeWeekCapacity(weekKey) {
    const blank = (user, extra) => {
        const fullWeekHours = getUserWeeklyHours(user);
        const daysOff = getWeekDaysOff(user, weekKey);
        const workdays = 5 - daysOff.holidays - daysOff.absences;
        return Object.assign({
            user,
            fullWeekHours,
            daysOff,
            baselineHours: Math.round((fullWeekHours * workdays / 5) * 10) / 10,
            taskHours: 0,
            pendingHours: 0,
            taskCount: 0,
            byProject: {},
            overrideHours: null,
            note: ''
        }, extra || {});
    };

    const result = {};
    teamMembers.forEach(user => { result[user] = blank(user); });

    getTasksForWeek(weekKey).forEach(task => {
        getTaskAssignees(task).forEach(user => {
            // Alguien que ya no está en el directorio puede seguir
            // apareciendo en tareas antiguas: se le crea entrada para
            // que esas horas no desaparezcan del total del equipo.
            if (!result[user]) result[user] = blank(user, { formerMember: true });

            const hours = getTaskHoursForUser(task, user);
            if (hours <= 0) return;

            const entry = result[user];
            entry.taskHours += hours;
            entry.taskCount += 1;
            if (!task.completed) entry.pendingHours += hours;

            const projectKey = task.projectId || '__none__';
            entry.byProject[projectKey] = (entry.byProject[projectKey] || 0) + hours;
        });
    });

    Object.keys(result).forEach(user => {
        const entry = result[user];
        const override = (capacityOverrides || []).find(o =>
            o.userInitials === user && o.weekStart === weekKey
        );
        if (override) {
            entry.overrideHours = Number(override.overrideHours) || 0;
            entry.note = override.note || '';
        }
        entry.effectiveHours = entry.overrideHours !== null ? entry.overrideHours : entry.taskHours;
        // Semana entera libre: no hay base sobre la que medir. Se mide
        // contra la jornada completa para que horas asignadas no queden
        // escondidas tras un 0%.
        const denominator = entry.baselineHours > 0 ? entry.baselineHours : entry.fullWeekHours;
        entry.percent = denominator > 0
            ? Math.round((entry.effectiveHours / denominator) * 100)
            : 0;
    });

    return result;
}

// "7,5 h" sin decimales inútiles: 8 -> "8", 7.5 -> "7.5".
function formatHours(value) {
    const hours = Number(value) || 0;
    const rounded = Math.round(hours * 10) / 10;
    return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

// Clase de color compartida por el widget y el dashboard, para que
// "sobrecargado" signifique lo mismo en los dos sitios.
function capacityLoadClass(percent) {
    if (percent > 100) return 'overcapacity';
    if (percent >= 80) return 'high-capacity';
    return '';
}
function escapeHtml(text) {
    if (!text) return '';
    const map = {
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    };
    return String(text).replace(/[&<>"']/g, char => map[char]);
}

// Activa el elemento (click) con Enter o Espacio: para th/div/span que actúan como botón
function activateOnEnterOrSpace(event) {
    if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        event.currentTarget.click();
    }
}

function renderSortableHeader(column, label, sortState, toggleFnName) {
    const isSorted = sortState.column === column;
    const indicator = isSorted ? (sortState.direction === 'asc' ? '▲' : '▼') : '';
    const ariaSort = isSorted ? (sortState.direction === 'asc' ? 'ascending' : 'descending') : 'none';
    return `<th class="sortable-header" tabindex="0" aria-sort="${ariaSort}" title="Sort by ${escapeHtml(label)}" onclick="${toggleFnName}('${column}')" onkeydown="activateOnEnterOrSpace(event)">${label} <span class="sort-indicator" aria-hidden="true">${indicator}</span></th>`;
}

function formatSupabaseError(error, fallbackMessage) {
    if (!error) return fallbackMessage || 'Unknown error';

    const parts = [error.message, error.details, error.hint]
        .filter(Boolean)
        .map(p => String(p).trim())
        .filter(Boolean);

    if (parts.length > 0) return parts.join(' | ');
    return fallbackMessage || 'Unknown error';
}

function getStatusIcon(status) {
    // Minimalist status glyph; colour is applied by CSS via the status-* class.
    return '●';
}

function renderPhaseOptions(selectedPhase) {
    return PROJECT_PHASES.map(phase =>
        `<option value="${phase}" ${phase === selectedPhase ? 'selected' : ''}>${phase}</option>`
    ).join('');
}

function renderBauOwnerOptions(selectedOwner) {
    return BAU_OWNERS.map(owner =>
        `<option value="${owner.value}" ${owner.value === (selectedOwner || '') ? 'selected' : ''}>${owner.label}</option>`
    ).join('');
}

function syncPhaseSelectors() {
    const select = document.getElementById('projectPhase');
    if (select) select.innerHTML = renderPhaseOptions(PROJECT_PHASES[0]);
}

// Estados de un proyecto (projects.status). Valores guardados en español,
// etiquetas en inglés. css = sufijo de las clases status-*, badge-*,
// status-dot--* y dash-pill--* (los tres primeros se conservan como
// estaban para no romper estilos). rank = orden de gravedad al ordenar
// la tabla del dashboard. Ver migrations_training_hours_admin.sql (1b).
const PROJECT_STATUSES = [
    { value: 'Verde', label: 'On Track', css: 'verde', dot: 'verde', rank: 2 },
    { value: 'Ámbar', label: 'At Risk', css: 'ámbar', dot: 'ambar', rank: 4 },
    { value: 'Rojo', label: 'Blocked', css: 'rojo', dot: 'rojo', rank: 5 },
    { value: 'En pausa', label: 'On Hold', css: 'pausa', dot: 'pausa', rank: 3 },
    { value: 'Cancelado', label: 'Cancelled', css: 'cancelado', dot: 'cancelado', rank: 0 },
    { value: 'Completado', label: 'Done', css: 'completado', dot: 'completado', rank: 1 }
];

function getStatusDef(status) {
    return PROJECT_STATUSES.find(s => s.value === (status || 'Verde')) || PROJECT_STATUSES[0];
}

function getStatusCssKey(status) {
    return getStatusDef(status).css;
}

function getStatusText(status) {
    const def = PROJECT_STATUSES.find(s => s.value === status);
    return def ? def.label : (status || '-');
}

// Priority/impact are stored in Spanish for data compatibility; display in English.
function getPriorityLabel(value) {
    return { Baja: 'Low', Media: 'Medium', Alta: 'High', 'Crítica': 'Critical' }[value] || value || 'Medium';
}
function getImpactLabel(value) {
    return { Bajo: 'Low', Medio: 'Medium', Alto: 'High' }[value] || value || 'Medium';
}
// Urgency is stored in Spanish (Normal/Alta/Máxima) for logic compatibility; display in English.
function getUrgencyLabel(value) {
    return { Normal: 'Normal', Alta: 'High', 'Máxima': 'Critical' }[value] || value || 'Normal';
}

// Escala visual única de prioridad (low < medium < high < critical) para
// que una tarea urgente se lea igual de llamativa en todas las vistas.
// La urgencia de daily_comments no tiene nivel "bajo": Normal = medium.
function getUrgencyLevel(value) {
    return { Normal: 'medium', Alta: 'high', 'Máxima': 'critical' }[value] || 'medium';
}
function getPriorityLevel(value) {
    return { Baja: 'low', Media: 'medium', Alta: 'high', 'Crítica': 'critical' }[value] || 'medium';
}
function renderPriorityBadge(level, label) {
    return `<span class="prio-badge prio-${level}">${escapeHtml(label)}</span>`;
}

function toggleIndicatorDropdown(event, type) {
    event.stopPropagation();
    document.querySelectorAll('.indicator-dropdown').forEach(d => d.classList.remove('active'));
    const dropdown = document.getElementById(`dropdown-${type}`);
    if (dropdown) {
        dropdown.classList.add('active');
    }
    setTimeout(() => {
        document.addEventListener('click', closeAllDropdowns, { once: true });
    }, 10);
}

function closeAllDropdowns() {
    document.querySelectorAll('.indicator-dropdown').forEach(d => d.classList.remove('active'));
}

async function updateIndicator(event, projectId, field, value) {
    event.stopPropagation();
    closeAllDropdowns();

    const project = projects.find(p => p.id === projectId);
    if (project) {
        project[field] = value;
    }

    await updateProjectField(projectId, field, value);
    renderFicha();
}


        // =====================================================
        // ========== FESTIVOS POR REGIÓN (no por país) =========
        // Cada persona sigue el calendario de SU ciudad: nacional +
        // autonómico + los dos festivos locales. Por país no basta: el
        // 9-nov es festivo en Madrid ciudad y no en Alicante. Los festivos
        // se pintan en Daily y Team y NUNCA cuentan como vacaciones.
        //
        // Fuentes (para actualizar, ver la skill update-holidays):
        //   ES-MD     BOCM (Decreto 75/2025) + Ayto. Madrid; 2027: BOE-A-2026-21254
        //   ES-VC-ALC GVA (Decreto 100/2025) + DOGV 14-11-2025 (locales Alicante);
        //             2027: BOE-A-2026-21254, locales de 2027 aún sin publicar
        //   PT-LIS    Código do Trabalho art. 234 + Câmara de Lisboa (13 jun)
        //   IN-MH     Notificación GAD Maharashtra 2026 (fuente secundaria)
        // 2025 es un año pasado: se conserva lo que había, sin revalidar.
        // =====================================================
        const HOLIDAYS_BY_REGION = {
            // Madrid ciudad — AR, JG
            'ES-MD': {
                2025: {
                    '2025-01-01': 'New Year', '2025-01-06': 'Epiphany', '2025-04-17': 'Maundy Thursday',
                    '2025-04-18': 'Good Friday', '2025-05-01': 'Labour Day', '2025-05-02': 'Community of Madrid Day',
                    '2025-07-25': 'Saint James', '2025-08-15': 'Assumption', '2025-10-12': 'National Day',
                    '2025-11-01': 'All Saints', '2025-11-09': 'Almudena (Madrid city)', '2025-12-06': 'Constitution Day',
                    '2025-12-08': 'Immaculate Conception', '2025-12-25': 'Christmas'
                },
                2026: {
                    '2026-01-01': 'New Year', '2026-01-06': 'Epiphany', '2026-04-02': 'Maundy Thursday',
                    '2026-04-03': 'Good Friday', '2026-05-01': 'Labour Day', '2026-05-02': 'Community of Madrid Day',
                    '2026-05-15': 'San Isidro (Madrid city)', '2026-08-15': 'Assumption', '2026-10-12': 'National Day',
                    '2026-11-02': 'All Saints (moved to Monday)', '2026-11-09': 'Almudena (Madrid city)',
                    '2026-12-07': 'Constitution Day (moved to Monday)', '2026-12-08': 'Immaculate Conception',
                    '2026-12-25': 'Christmas'
                },
                2027: {
                    '2027-01-01': 'New Year', '2027-01-06': 'Epiphany', '2027-03-19': 'Saint Joseph',
                    '2027-03-25': 'Maundy Thursday', '2027-03-26': 'Good Friday', '2027-05-01': 'Labour Day',
                    '2027-05-15': 'San Isidro (Madrid city)', '2027-08-16': 'Assumption (moved to Monday)',
                    '2027-10-12': 'National Day', '2027-11-01': 'All Saints', '2027-11-09': 'Almudena (Madrid city)',
                    '2027-12-06': 'Constitution Day', '2027-12-08': 'Immaculate Conception', '2027-12-25': 'Christmas'
                }
            },
            // Alicante (Comunitat Valenciana) — TB
            'ES-VC-ALC': {
                2025: {
                    '2025-01-01': 'New Year', '2025-01-06': 'Epiphany', '2025-03-19': 'Saint Joseph',
                    '2025-04-18': 'Good Friday', '2025-04-21': 'Easter Monday', '2025-05-01': 'Labour Day',
                    '2025-06-23': 'Fogueres de Sant Joan (Alicante)', '2025-06-24': 'Saint John',
                    '2025-08-15': 'Assumption', '2025-10-09': 'Valencian Community Day', '2025-11-01': 'All Saints',
                    '2025-12-06': 'Constitution Day', '2025-12-08': 'Immaculate Conception', '2025-12-25': 'Christmas'
                },
                2026: {
                    '2026-01-01': 'New Year', '2026-01-06': 'Epiphany', '2026-03-19': 'Saint Joseph',
                    '2026-04-03': 'Good Friday', '2026-04-06': 'Easter Monday', '2026-04-16': 'Santa Faz (Alicante)',
                    '2026-05-01': 'Labour Day', '2026-06-23': 'Fogueres de Sant Joan (Alicante)',
                    '2026-06-24': 'Saint John', '2026-08-15': 'Assumption', '2026-10-09': 'Valencian Community Day',
                    '2026-10-12': 'National Day', '2026-12-08': 'Immaculate Conception', '2026-12-25': 'Christmas'
                },
                // Solo nacional + autonómico: los 2 locales de Alicante se publican en el DOGV (nov.)
                2027: {
                    '2027-01-01': 'New Year', '2027-01-06': 'Epiphany', '2027-03-19': 'Saint Joseph',
                    '2027-03-26': 'Good Friday', '2027-03-29': 'Easter Monday', '2027-05-01': 'Labour Day',
                    '2027-10-09': 'Valencian Community Day', '2027-10-12': 'National Day', '2027-11-01': 'All Saints',
                    '2027-12-06': 'Constitution Day', '2027-12-08': 'Immaculate Conception', '2027-12-25': 'Christmas'
                }
            },
            // Lisboa — IM
            'PT-LIS': {
                2025: {
                    '2025-01-01': 'New Year', '2025-04-18': 'Good Friday', '2025-04-20': 'Easter',
                    '2025-04-25': 'Freedom Day', '2025-05-01': 'Labour Day', '2025-06-10': 'Portugal Day',
                    '2025-06-13': 'Santo António (Lisbon)', '2025-06-19': 'Corpus Christi', '2025-08-15': 'Assumption',
                    '2025-10-05': 'Republic Day', '2025-11-01': 'All Saints', '2025-12-01': 'Restoration of Independence',
                    '2025-12-08': 'Immaculate Conception', '2025-12-25': 'Christmas'
                },
                2026: {
                    '2026-01-01': 'New Year', '2026-04-03': 'Good Friday', '2026-04-05': 'Easter',
                    '2026-04-25': 'Freedom Day', '2026-05-01': 'Labour Day', '2026-06-04': 'Corpus Christi',
                    '2026-06-10': 'Portugal Day', '2026-06-13': 'Santo António (Lisbon)', '2026-08-15': 'Assumption',
                    '2026-10-05': 'Republic Day', '2026-11-01': 'All Saints', '2026-12-01': 'Restoration of Independence',
                    '2026-12-08': 'Immaculate Conception', '2026-12-25': 'Christmas'
                },
                2027: {
                    '2027-01-01': 'New Year', '2027-03-26': 'Good Friday', '2027-03-28': 'Easter',
                    '2027-04-25': 'Freedom Day', '2027-05-01': 'Labour Day', '2027-05-27': 'Corpus Christi',
                    '2027-06-10': 'Portugal Day', '2027-06-13': 'Santo António (Lisbon)', '2027-08-15': 'Assumption',
                    '2027-10-05': 'Republic Day', '2027-11-01': 'All Saints', '2027-12-01': 'Restoration of Independence',
                    '2027-12-08': 'Immaculate Conception', '2027-12-25': 'Christmas'
                }
            },
            // Mumbai (Maharashtra) — AD
            'IN-MH': {
                2025: {
                    '2025-01-26': 'Republic Day', '2025-03-14': 'Holi', '2025-08-15': 'Independence Day',
                    '2025-08-27': 'Ganesh Chaturthi', '2025-10-02': 'Gandhi Jayanti', '2025-10-21': 'Diwali',
                    '2025-12-25': 'Christmas'
                },
                2026: {
                    '2026-01-26': 'Republic Day', '2026-02-15': 'Mahashivratri', '2026-02-19': 'Shivaji Maharaj Jayanti',
                    '2026-03-03': 'Holi', '2026-03-19': 'Gudi Padwa', '2026-03-21': 'Ramzan Id',
                    '2026-03-26': 'Ram Navami', '2026-03-31': 'Mahavir Jayanti', '2026-04-03': 'Good Friday',
                    '2026-04-14': 'Ambedkar Jayanti', '2026-05-01': 'Maharashtra Day / Buddha Purnima',
                    '2026-05-28': 'Bakri Id', '2026-06-26': 'Muharram', '2026-08-15': 'Independence Day',
                    '2026-08-26': 'Id-E-Milad', '2026-09-14': 'Ganesh Chaturthi', '2026-10-02': 'Gandhi Jayanti',
                    '2026-10-20': 'Dussehra', '2026-11-08': 'Diwali (Lakshmi Pujan)', '2026-11-10': 'Diwali (Bali Pratipada)',
                    '2026-11-24': 'Guru Nanak Jayanti', '2026-12-25': 'Christmas'
                },
                // Solo fiestas de fecha fija: la lista GAD de 2027 aún no está publicada
                2027: {
                    '2027-01-26': 'Republic Day', '2027-05-01': 'Maharashtra Day', '2027-08-15': 'Independence Day',
                    '2027-10-02': 'Gandhi Jayanti', '2027-12-25': 'Christmas'
                }
            }
        };

        const HOLIDAY_REGION_LABEL = { 'ES-MD': 'Madrid', 'ES-VC-ALC': 'Alicante', 'PT-LIS': 'Lisbon', 'IN-MH': 'Mumbai' };

        // Años cuyo calendario de esa región está incompleto (faltan los
        // locales o la lista oficial). Se avisa en la vista Team.
        const HOLIDAY_REGION_PENDING_YEARS = { 'ES-VC-ALC': [2027], 'IN-MH': [2027] };

        // Región por defecto de cada persona. app_users.holiday_region, si
        // trae un código conocido, manda sobre esta tabla.
        const DEFAULT_MEMBER_REGION = { TB: 'ES-VC-ALC', AR: 'ES-MD', JG: 'ES-MD', IM: 'PT-LIS', AD: 'IN-MH' };
        const FALLBACK_HOLIDAY_REGION = 'ES-MD';

        function normalizeHolidayRegion(value) {
            const code = String(value || '').trim().toUpperCase();
            return HOLIDAYS_BY_REGION[code] ? code : '';
        }

        function getMemberRegion(initials) {
            const key = normalizeInitials(initials);
            const fromDirectory = userDirectory[key] && userDirectory[key].holidayRegion;
            return fromDirectory || DEFAULT_MEMBER_REGION[key] || FALLBACK_HOLIDAY_REGION;
        }

        function getHolidayName(region, dateKey) {
            const byYear = HOLIDAYS_BY_REGION[region] || {};
            const year = byYear[Number(String(dateKey).slice(0, 4))];
            return (year && year[dateKey]) || '';
        }

        function isHolidayForMember(initials, dateKey) {
            return !!getHolidayName(getMemberRegion(initials), dateKey);
        }

        // Quién del equipo tiene festivo ese día, agrupado por región:
        // [{ region, label, name, members: ['AR', 'JG'] }]
        function teamHolidaysOnDate(dateKey) {
            const byRegion = {};
            teamMembers.forEach(member => {
                const region = getMemberRegion(member);
                const name = getHolidayName(region, dateKey);
                if (!name) return;
                if (!byRegion[region]) byRegion[region] = { region, label: HOLIDAY_REGION_LABEL[region] || region, name, members: [] };
                byRegion[region].members.push(member);
            });
            return Object.values(byRegion);
        }

        function isHolidayForAnyTeamMember(dateKey) {
            return teamHolidaysOnDate(dateKey).length > 0;
        }

        function describeTeamHolidays(dateKey) {
            return teamHolidaysOnDate(dateKey)
                .map(h => `${h.label} (${h.members.join(', ')}): ${h.name}`)
                .join(' · ');
        }

        // Regiones del equipo cuyo calendario de `year` falta o está incompleto.
        function getPendingHolidayRegions(year) {
            const regions = new Set(teamMembers.map(getMemberRegion));
            return Array.from(regions).filter(region =>
                !(HOLIDAYS_BY_REGION[region] || {})[year] ||
                (HOLIDAY_REGION_PENDING_YEARS[region] || []).includes(year));
        }

        let projects = [];
        let dailyComments = [];
        let teamVacations = [];
        let selectedVacationDays = []; // Rastrear días seleccionados para vacaciones
        let pendingVacationSelection = null;
        let vacationBalanceYear = new Date().getFullYear();
        let vacationLegendFilter = null; // null | 'current_year' | 'previous_year' | 'next_year' | 'willis_choice' | 'absence'

        // Motivo de la ausencia (team_vacations.absence_type). Solo las
        // vacaciones cargan saldo; el resto se guarda con vacation_type
        // 'not_charged'. El motivo concreto solo lo ve el titular: para los
        // demás es "Absent" (es un dato personal, una baja es de salud).
        const ABSENCE_TYPES = {
            vacation: 'Vacation',
            sick_leave: 'Sick leave',
            personal: 'Personal matter'
        };
        const CHARGED_VACATION_TYPES = ['current_year', 'previous_year', 'next_year', 'willis_choice'];

        function getAbsenceType(vacation) {
            return ABSENCE_TYPES[vacation && vacation.absence_type] ? vacation.absence_type : 'vacation';
        }

        // Medio día: team_vacations.day_portion = 'am' | 'pm' (ver
        // migrations_half_day_leave.sql). Sin la columna, o 'full', es un
        // día entero. days_count es integer en la BD, así que la duración
        // real se calcula aquí y NUNCA se lee days_count directamente.
        const DAY_PORTIONS = { full: 'Full day', am: 'Morning', pm: 'Afternoon' };

        function getDayPortion(vacation) {
            const portion = vacation && vacation.day_portion;
            return portion === 'am' || portion === 'pm' ? portion : 'full';
        }

        function isHalfDayLeave(vacation) {
            return getDayPortion(vacation) !== 'full';
        }

        function getLeaveDays(vacation) {
            if (isHalfDayLeave(vacation)) return 0.5;
            return Number(vacation && vacation.days_count) || 0;
        }

        function formatLeaveDays(days) {
            return days.toLocaleString('en-GB', { maximumFractionDigits: 1 });
        }

        function isVacationAbsence(vacation) {
            return getAbsenceType(vacation) === 'vacation' && vacation.vacation_type !== 'not_charged';
        }

        // Texto de la ausencia según quién mira.
        function describeAbsenceFor(vacation, viewer) {
            if (isVacationAbsence(vacation)) return 'Leave';
            return normalizeInitials(vacation.user_initials) === normalizeInitials(viewer)
                ? ABSENCE_TYPES[getAbsenceType(vacation)]
                : 'Absent';
        }
        // Días anuales de referencia usados solo para la barra de balance visual del resumen de vacaciones.
        const STANDARD_VACATION_DAYS_PER_YEAR = 22;
        let currentMonth = new Date();
        let sidebarAutoCollapsed = false; // Indica si el sidebar fue colapsado automáticamente por la vista Equipo
        let calendarZoom = 0; // 0=compact(8px) 1=medium(16px) 2=detail(28px)
        const ZOOM_LEVELS = [
            { w: 8,  font: 6,   hdrH: 18 },   // compact: números pequeños
            { w: 16, font: 8,   hdrH: 24 },   // medium:  números más grandes
            { w: 28, font: 10,  hdrH: 30 },   // detail:  números claramente legibles
        ];
        const teamMembers = ['TB', 'AR', 'JG', 'IM']; // WE AI Implementation Analysts
        const excludedResponsibles = ['DH'];

        function isExcludedResponsible(value) {
            return excludedResponsibles.includes((value || '').trim().toUpperCase());
        }

        // Opciones de un selector de personas: los activos y, al final, los
        // que ya estaban elegidos pero ya no están disponibles, para que se
        // vean (en gris) y se puedan quitar. Nunca se ofrecen para añadir.
        function withSelectedUnavailable(activeOptions, selected) {
            const extra = (selected || []).filter(m => !activeOptions.includes(m) && !isExcludedResponsible(m));
            return activeOptions.concat(extra);
        }

        function sanitizeResponsiblesList(value) {
            const source = Array.isArray(value) ? value : [];
            const unique = [];
            const seen = new Set();

            source.forEach(item => {
                const normalized = (item || '').trim().toUpperCase();
                if (!normalized || isExcludedResponsible(normalized) || seen.has(normalized)) return;
                seen.add(normalized);
                unique.push(normalized);
            });

            return unique;
        }

        let currentProjectId = null;
        let currentWeekStart = getMonday(new Date());
        let editingCommentId = null;
        let commentsListContext = { projectId: null, dateKey: null };
        let dayPersonalTasksModalContext = { dateKey: null };
        let expandedCommentThreads = new Set();
        let activeReplyCommentId = null;
        let dailyFilters = {
            proyecto: '',
            estados: [],
            fechaInicio: '',
            responsibles: []
        };
        let dailyResponsibleDropdownOpen = false;
        let dailyEstadoDropdownOpen = false;

        function handleEstadoDropdownOutsideClick(e) {
            const wrapper = document.querySelector('.estado-filter-wrapper');
            if (!wrapper || !wrapper.contains(e.target)) {
                document.removeEventListener('click', handleEstadoDropdownOutsideClick);
                dailyEstadoDropdownOpen = false;
                renderDaily();
            }
        }

        function syncTeamMembersInSelectors() {
            const responsibleSelect = document.getElementById('commentResponsible');
            if (!responsibleSelect) return;

            const previousValue = (responsibleSelect.value || '').trim().toUpperCase();

            responsibleSelect.innerHTML = '<option value="">No owner</option>' +
                teamMembers.map(member => `<option value="${member}">${member}</option>`).join('');

            if (previousValue) {
                const exists = teamMembers.includes(previousValue);
                if (exists) {
                    responsibleSelect.value = previousValue;
                } else if (!isExcludedResponsible(previousValue)) {
                    const customOption = document.createElement('option');
                    customOption.value = previousValue;
                    customOption.textContent = previousValue;
                    responsibleSelect.appendChild(customOption);
                    responsibleSelect.value = previousValue;
                }
            }
        }

        let dailyViewMode = 'activos';
        let dailyBauGroupCollapsed = false;
        let dailyTrainingGroupCollapsed = false;
        let dashboardFilters = {
    proyecto: '',
    fases: [],
    prioridades: [],
    impactos: [],
    estados: [],
    owners: [],
    countries: [],
    fechaInicioDesde: '',
    fechaInicioHasta: '',
    fechaFinDesde: '',
    fechaFinHasta: ''
};

// Which dashboard filter dropdown is currently open (null = none), mirrors
// the dailyResponsibleDropdownOpen pattern since renderDashboard() does a
// full innerHTML replace on every filter change.
let openDashFilterMenu = null;

function toggleDashFilterMenu(event, key) {
    event.stopPropagation();
    openDashFilterMenu = (openDashFilterMenu === key) ? null : key;
    renderDashboard();
    if (openDashFilterMenu) {
        setTimeout(() => document.addEventListener('click', closeDashFilterMenuOnOutsideClick), 0);
    }
}

function closeDashFilterMenuOnOutsideClick(event) {
    if (event.target.closest('.dash-filter-dropdown')) return;
    openDashFilterMenu = null;
    document.removeEventListener('click', closeDashFilterMenuOnOutsideClick);
    renderDashboard();
}

let dashboardSort = {
    column: null,
    direction: 'asc'
};

let dailySort = {
    column: null,
    direction: 'asc'
};

function toggleDashFilter(key, value) {
    const arr = dashboardFilters[key];
    const idx = arr.indexOf(value);
    if (idx === -1) arr.push(value);
    else arr.splice(idx, 1);
    renderDashboard();
}

function setDashboardFilter(field, value) {
  dashboardFilters[field] = value;
  
  // Guardar el elemento activo y su posición del cursor ANTES de re-renderizar
  const activeElement = document.activeElement;
  const isFilterInput = activeElement && activeElement.id === 'dashFilterProyecto';
  let cursorPosition = 0;
  
  if (isFilterInput) {
    cursorPosition = activeElement.selectionStart;
  }
  
  // Re-renderizar
  renderDashboard();
  
  // Restaurar el foco y la posición del cursor DESPUÉS de re-renderizar
  if (isFilterInput) {
    setTimeout(() => {
      const newInput = document.getElementById('dashFilterProyecto');
      if (newInput) {
        newInput.focus();
        newInput.setSelectionRange(cursorPosition, cursorPosition);
      }
    }, 0);
  }
}



// =====================================================
// ====================== DAILY ========================
// (tabla semanal, filtros, comentarios diarios, etc.)
// =====================================================

        function setDailyViewMode(mode) {
            // Los proyectos Training no tienen pestaña: se ven en un grupo
            // propio dentro de Active, para que todo el equipo los vea.
            dailyViewMode = mode === 'training' ? 'activos' : mode;
            if (mode === 'training') dailyTrainingGroupCollapsed = false;
            [['btnDailyActivos', 'activos'], ['btnDailyBau', 'bau'], ['btnDailyCompletados', 'completados']].forEach(([id, value]) => {
                const btn = document.getElementById(id);
                if (!btn) return;
                const isActive = mode === value;
                btn.classList.toggle('active', isActive);
                btn.setAttribute('aria-pressed', String(isActive));
            });
            renderDaily();
        }


        function getMonday(date) {
            const d = new Date(date);
            const day = d.getDay();
            const diff = d.getDate() - day + (day === 0 ? -6 : 1);
            return new Date(d.setDate(diff));
        }

        function getWeekDates(mondayDate) {
            const dates = [];
            for (let i = 0; i < 5; i++) {
                const date = new Date(mondayDate);
                date.setDate(date.getDate() + i);
                dates.push(date);
            }
            return dates;
        }

        // Daily range: 'week' (Mon–Fri) or 'month' (all working days of the month).
        let dailyRange = 'week';

        function getDailyDates() {
            if (dailyRange === 'month') {
                const y = currentWeekStart.getFullYear();
                const m = currentWeekStart.getMonth();
                const daysInMonth = new Date(y, m + 1, 0).getDate();
                const days = [];
                for (let d = 1; d <= daysInMonth; d++) {
                    const dt = new Date(y, m, d);
                    const dow = dt.getDay();
                    if (dow >= 1 && dow <= 5) days.push(dt); // working days only
                }
                return days;
            }
            return getWeekDates(currentWeekStart);
        }

        function setDailyRange(range) {
            if (!['week', 'month'].includes(range)) return;
            dailyRange = range;
            const t = new Date();
            if (range === 'month') {
                currentWeekStart = new Date(t.getFullYear(), t.getMonth(), 1);
            } else {
                currentWeekStart = getMonday(t);
            }
            const weekBtn = document.getElementById('btnDailyWeek');
            const monthBtn = document.getElementById('btnDailyMonth');
            if (weekBtn) { weekBtn.classList.toggle('active', range === 'week'); weekBtn.setAttribute('aria-pressed', String(range === 'week')); }
            if (monthBtn) { monthBtn.classList.toggle('active', range === 'month'); monthBtn.setAttribute('aria-pressed', String(range === 'month')); }
            renderDaily();
        }

        function previousWeek() {
            if (dailyRange === 'month') {
                currentWeekStart = new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth() - 1, 1);
            } else {
                currentWeekStart = new Date(currentWeekStart);
                currentWeekStart.setDate(currentWeekStart.getDate() - 7);
            }
            renderDaily();
        }

        function nextWeek() {
            if (dailyRange === 'month') {
                currentWeekStart = new Date(currentWeekStart.getFullYear(), currentWeekStart.getMonth() + 1, 1);
            } else {
                currentWeekStart = new Date(currentWeekStart);
                currentWeekStart.setDate(currentWeekStart.getDate() + 7);
            }
            renderDaily();
        }

        function goToday() {
            const t = new Date();
            currentWeekStart = dailyRange === 'month' ? new Date(t.getFullYear(), t.getMonth(), 1) : getMonday(t);
            renderDaily();
        }

        function updateWeekInfo() {
            const el = document.getElementById('weekInfo');
            if (!el) return;
            if (dailyRange === 'month') {
                el.textContent = currentWeekStart.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
                return;
            }
            const dates = getWeekDates(currentWeekStart);
            if (!dates.length) return;
            const startStr = dates[0].toLocaleDateString('en-GB');
            const endStr = dates[dates.length - 1].toLocaleDateString('en-GB');
            el.textContent = `${startStr} - ${endStr}`;
        }

        // Owners ticked in the "New Project" modal. Held outside the DOM so
        // the picker can be re-rendered on every click without losing state.
        let newProjectOwners = [];

        function openNewProjectModal() {
            // Pre-select the creator: they are almost always an owner, and the
            // Daily owner filter keys off this list.
            const creator = normalizeInitials(currentUser || '');
            newProjectOwners = (creator && teamMembers.includes(creator)) ? [creator] : [];
            renderNewProjectOwners();
            onNewProjectPhaseChange();
            openModal('projectModal', '#projectName');
        }

        // Training: se ocultan los campos de negocio (savings, país,
        // stakeholders) y, si el nombre está vacío, se propone
        // "<Nombre>'s Training".
        function onNewProjectPhaseChange() {
            const phaseInput = document.getElementById('projectPhase');
            const isTraining = !!phaseInput && phaseInput.value === TRAINING_PHASE;
            document.querySelectorAll('#projectModal [data-not-training]').forEach(el => { el.hidden = isTraining; });
            const hint = document.getElementById('projectPhaseTrainingHint');
            if (hint) hint.hidden = !isTraining;

            const nameInput = document.getElementById('projectName');
            if (!nameInput) return;
            if (isTraining && !nameInput.value.trim()) {
                nameInput.value = getDefaultTrainingProjectName();
            } else if (!isTraining && nameInput.value === getDefaultTrainingProjectName()) {
                // Se había propuesto al elegir Training y se ha vuelto atrás.
                nameInput.value = '';
            }
        }

        function getDefaultTrainingProjectName() {
            const profile = getCurrentUserProfile();
            const firstName = profile && profile.firstName ? profile.firstName : normalizeInitials(currentUser || '');
            return firstName ? `${firstName}'s Training` : 'Training';
        }

        function renderNewProjectOwners() {
            const host = document.getElementById('projectOwners');
            if (!host) return;

            const options = teamMembers.filter(m => !isExcludedResponsible(m));
            if (!options.length) {
                host.innerHTML = '<p class="owner-picker-hint">No team members available.</p>';
                return;
            }

            host.innerHTML = options.map(member => {
                const on = newProjectOwners.includes(member);
                return `<button type="button"
                        class="owner-picker-btn${on ? ' is-selected' : ''}"
                        aria-pressed="${on}"
                        title="${on ? 'Remove' : 'Add'} ${escapeHtml(member)}"
                        onclick="toggleNewProjectOwner(${jsArg(member)})">
                        <span class="owner-picker-check" aria-hidden="true">${on ? '✓' : '+'}</span>${escapeHtml(member)}
                    </button>`;
            }).join('');
        }

        function toggleNewProjectOwner(member) {
            newProjectOwners = newProjectOwners.includes(member)
                ? newProjectOwners.filter(m => m !== member)
                : [...newProjectOwners, member];
            renderNewProjectOwners();
        }

        function closeProjectModal() {
            closeModal('projectModal');

            // Limpiar campos de forma SEGURA (solo si existen)
            // projectCountry se añadió a la lista: antes se quedaba con el
            // valor del proyecto anterior al crear dos seguidos.
            const fields = ['projectName', 'projectStartDate', 'projectEndDate', 'savingsHours', 'fte', 'projectStakeholders', 'projectCountry', 'projectPhase'];
            fields.forEach(id => {
                const input = document.getElementById(id);
                if (input) {
                    if (input.type === 'select-one') {
                        input.value = input.options[0]?.value || '';
                    } else {
                        input.value = '';
                    }
                }
            });
            onNewProjectPhaseChange();

            newProjectOwners = [];
            renderNewProjectOwners();
        }

        // =====================================================
        // =============== RENOMBRAR PROYECTO ==================
        // =====================================================

        let renamingProjectId = null;

        function openRenameProjectModal(projectId) {
            const project = projects.find(p => p.id === projectId);
            if (!project) return;

            renamingProjectId = projectId;
            const input = document.getElementById('renameProjectInput');
            if (input) {
                input.value = project.name || '';
                // Preselect so typing replaces the old name straight away.
                setTimeout(() => input.select(), 0);
            }
            openModal('renameProjectModal', '#renameProjectInput');
        }

        function closeRenameProjectModal() {
            closeModal('renameProjectModal');
            renamingProjectId = null;
        }

        // Renombrado en línea desde la ficha: el título es un input, igual
        // que la descripción. Se dispara en onchange (blur o Enter), no en
        // cada tecla, para no escribir en Supabase por cada letra.
        async function renameProjectInline(projectId, input) {
            if (!input) return;
            const project = findAnyProject(projectId);
            if (!project) return;

            const name = input.value.trim();
            if (!name) {
                // Un nombre vacío dejaría el proyecto sin identificar en el
                // sidebar: se revierte y se avisa.
                input.value = project.name;
                showToast('The project name cannot be empty.', 'warning');
                return;
            }
            if (name === project.name) return;

            await updateProjectField(projectId, 'name', name);
            input.value = name;
            renderProjectsList();
            showToast('Project renamed', 'success', { key: 'autosave', duration: 1500 });
        }

        async function saveProjectRename() {
            const input = document.getElementById('renameProjectInput');
            if (!input || !renamingProjectId) return;

            const name = input.value.trim();
            if (!name) {
                showToast('Enter the project name.', 'warning');
                input.focus();
                return;
            }

            const projectId = renamingProjectId;
            const project = projects.find(p => p.id === projectId);
            if (!project) {
                closeRenameProjectModal();
                return;
            }

            if (name === project.name) {
                closeRenameProjectModal();
                return;
            }

            // Close before saving so the modal dirty-check does not ask about
            // the change we are in the middle of committing.
            closeRenameProjectModal();

            await updateProjectField(projectId, 'name', name);
            renderProjectsList();
            renderActiveView();
            showToast('Project renamed', 'success');
        }

        // Safe argument for an inline on* handler: JSON-quotes the value and
        // then HTML-escapes it, so an apostrophe in user data (initials, task
        // text, project names) cannot break out of the attribute and silently
        // kill the handler. Use this instead of writing '${value}' by hand.
        function jsArg(value) {
            return escapeHtml(JSON.stringify(value === undefined || value === null ? '' : String(value)));
        }

        // Owner picker. Every team member is a toggle, so the same popover
        // adds and removes. It used to only list members who were NOT yet
        // owners and bail out with "all owners are already assigned" once
        // everybody was on, which left no way to take someone off except the
        // tiny cross on the badge.
        function openResponsiblesPopover(projectId) {
            const alreadyOpen = !!document.getElementById(`resp-popover-${projectId}`);
            closeResponsiblesPopover();
            // Second click on the same "+" closes it again.
            if (alreadyOpen) return;
            showResponsiblesPopover(projectId);
        }

        function showResponsiblesPopover(projectId) {
            const project = projects.find(p => p.id === projectId);
            if (!project) return;

            // Resolve the anchor BEFORE touching the DOM. The old version
            // appended the popover and then returned early when the anchor was
            // missing, leaving an orphan popover pinned at the top-left corner.
            const anchor = document.querySelector(`.resp-btn-header[data-project-id="${projectId}"]`);
            if (!anchor) return;

            const current = project.responsibles || [];
            const options = teamMembers.filter(m => !isExcludedResponsible(m));
            // Owners who are no longer in the directory still need a way out.
            const orphans = current.filter(r => !options.includes(r) && !isExcludedResponsible(r));

            const popover = document.createElement('div');
            popover.id = `resp-popover-${projectId}`;
            popover.className = 'resp-popover';
            popover.setAttribute('role', 'dialog');
            popover.setAttribute('aria-label', `Owners of ${project.name}`);
            popover.innerHTML = `
                <div class="resp-popover-content">
                    <div class="resp-popover-title">Owners</div>
                    <div class="resp-popover-buttons">
                        ${options.concat(orphans).map(resp => {
                            const on = current.includes(resp);
                            return `<button type="button"
                                    class="resp-popover-btn${on ? ' is-selected' : ''}"${options.includes(resp) ? '' : ' data-unavailable="true"'}
                                    data-responsible="${escapeHtml(resp)}"
                                    aria-pressed="${on}"
                                    title="${on ? 'Remove' : 'Add'} ${escapeHtml(resp)}"
                                    onclick="toggleResponsible(${jsArg(projectId)}, ${jsArg(resp)})">
                                    <span class="resp-popover-check" aria-hidden="true">${on ? '✓' : '+'}</span>${escapeHtml(resp)}
                                </button>`;
                        }).join('')}
                    </div>
                    <p class="resp-popover-hint">Click a name to add or remove it.</p>
                    <button type="button" class="resp-popover-close" aria-label="Close" onclick="closeResponsiblesPopover(${jsArg(projectId)})">✕</button>
                </div>
            `;

            document.body.appendChild(popover);
            setTimeout(() => document.addEventListener('click', handleResponsiblesPopoverOutsideClick), 0);
            const firstOption = popover.querySelector('.resp-popover-btn');
            if (firstOption) firstOption.focus();

            const anchorRect = anchor.getBoundingClientRect();
            const scrollX = window.scrollX || window.pageXOffset;
            const scrollY = window.scrollY || window.pageYOffset;

            requestAnimationFrame(() => {
                const popoverRect = popover.getBoundingClientRect();
                let left = anchorRect.left + scrollX;
                let top = anchorRect.bottom + scrollY + 8;

                const maxLeft = scrollX + window.innerWidth - popoverRect.width - 12;
                if (left > maxLeft) left = Math.max(scrollX + 12, maxLeft);

                popover.style.left = `${left}px`;
                popover.style.top = `${top}px`;
            });
        }

        async function toggleResponsible(projectId, responsible) {
            const project = projects.find(p => p.id === projectId);
            if (!project) return;

            const current = project.responsibles || [];
            const adding = !current.includes(responsible);
            const updated = adding
                ? [...current, responsible]
                : current.filter(r => r !== responsible);

            await updateProjectField(projectId, 'responsibles', updated);

            // Repaint the owner badges in the project card and the sidebar.
            // updateProjectField only wrote to Supabase and to the in-memory
            // project, so without this the popover looked like it had done
            // nothing at all until a full reload.
            renderProjectsList();
            renderActiveView();

            // Update the popover in place instead of rebuilding it: it is a
            // child of document.body so the re-render above does not touch it,
            // and replacing it mid-click would make the outside-click handler
            // think the click landed outside and close it.
            syncResponsiblesPopoverState(projectId);
        }

        function syncResponsiblesPopoverState(projectId) {
            const popover = document.getElementById(`resp-popover-${projectId}`);
            if (!popover) return;

            const project = projects.find(p => p.id === projectId);
            const current = (project && project.responsibles) || [];

            popover.querySelectorAll('.resp-popover-btn').forEach(btn => {
                const resp = btn.dataset.responsible || '';
                const on = current.includes(resp);
                btn.classList.toggle('is-selected', on);
                btn.setAttribute('aria-pressed', String(on));
                btn.title = `${on ? 'Remove' : 'Add'} ${resp}`;
                const check = btn.querySelector('.resp-popover-check');
                if (check) check.textContent = on ? '✓' : '+';
            });
        }

        function closeResponsiblesPopover(projectId) {
            const popovers = projectId
                ? [document.getElementById(`resp-popover-${projectId}`)]
                : Array.from(document.querySelectorAll('.resp-popover'));
            popovers.forEach(el => el && el.remove());
            document.removeEventListener('click', handleResponsiblesPopoverOutsideClick);
        }

        function handleResponsiblesPopoverOutsideClick(event) {
            const popover = document.querySelector('.resp-popover');
            if (!popover) {
                document.removeEventListener('click', handleResponsiblesPopoverOutsideClick);
                return;
            }
            if (popover.contains(event.target) || (event.target.closest && event.target.closest('.resp-btn-header'))) return;
            closeResponsiblesPopover();
        }

        async function removeResponsible(projectId, responsible) {
            const project = projects.find(p => p.id === projectId);
            if (!project) return;

            const updated = (project.responsibles || []).filter(r => r !== responsible);
            await updateProjectField(projectId, 'responsibles', updated);
            renderProjectsList();
            renderActiveView();
        }



        function generateId() {
            return Date.now().toString() + "-" + Math.random().toString(36).slice(2);
        }

        async function saveNewProject() {
            // LEER TODOS LOS CAMPOS (con los IDs exactos de tu modal)
            const nameInput = document.getElementById('projectName');
            const startDateInput = document.getElementById('projectStartDate');
            const endDateInput = document.getElementById('projectEndDate');
            const savingsHoursInput = document.getElementById('savingsHours');
            const fteInput = document.getElementById('fte');
            const phaseInput = document.getElementById('projectPhase');
            const stakeholdersInput = document.getElementById('projectStakeholders');
            const countryInput = document.getElementById('projectCountry');

            // VALIDAR NOMBRE
            const name = nameInput.value.trim();
            if (!name) {
                showToast('Enter the project name.', 'warning');
                nameInput.focus();
                return;
            }

            // LEER VALORES
            const startDate = startDateInput.value || null;
            const endDate = endDateInput.value || null;
            const phase = phaseInput.value;
            // En un proyecto Training los campos de negocio están ocultos:
            // no se guarda lo que hubiera quedado escrito en ellos.
            const isTraining = phase === TRAINING_PHASE;
            const savingsHours = isTraining ? null : parseSavingsHours(savingsHoursInput.value);
            const fte = isTraining ? 0 : (parseFloat(fteInput.value) || 0);
            const stakeholders = isTraining ? '' : stakeholdersInput.value.trim();
            const country = (countryInput && !isTraining) ? countryInput.value.trim() : '';

            // PRERREQUISITOS ESTÁNDAR
            const prerequisites = (typeof STANDARD_PREREQUISITES !== 'undefined' ? STANDARD_PREREQUISITES : []).map(pName => ({
                name: pName,
                done: false,
                na: false
            }));

            // OBJETO PARA SUPABASE
            // Auto-assign the creator as owner so the project shows up when
            // filtering the Daily by the logged-in user's initials.
            const creatorInitials = normalizeInitials(currentUser || '');
            const projectRow = {
                name: name,
                start_date: startDate,
                end_date: endDate,
                savings_hours: savingsHours,
                fte: fte,
                phase: phase,
                stakeholders: stakeholders,
                country: country,
                status: 'Verde',
                priority: 'Media',
                progress: 0,
                prerequisites: prerequisites,
                responsibles: sanitizeResponsiblesList(newProjectOwners.length ? newProjectOwners : (creatorInitials ? [creatorInitials] : []))
            };

            // console.log("📤 Creando proyecto:", projectRow);

            // GUARDAR EN SUPABASE
            const { data, error } = await supabaseClient
                .from('projects')
                .insert(projectRow)
                .select()
                .single();

            if (error) {
                console.error("❌ Error:", error);
                showToast("Error saving project: " + error.message, 'error');
                return;
            }

            // console.log("✅ Proyecto creado:", data);

            // LIMPIAR FORMULARIO (esto evita que queden los valores marcados)
            nameInput.value = '';
            startDateInput.value = '';
            endDateInput.value = '';
            savingsHoursInput.value = '';
            fteInput.value = '';
            stakeholdersInput.value = '';
            if (countryInput) countryInput.value = '';
            phaseInput.value = PROJECT_PHASES[0]; // Reset to the default phase

            // CERRAR MODAL, RECARGAR DATOS Y ABRIR LA FICHA DEL NUEVO PROYECTO
            closeProjectModal();
            await loadDataFromSupabase(true);

            if (data && data.id) {
                currentProjectId = data.id;
                renderProjectsList();
                switchView('ficha');
            } else {
                renderActiveView();
            }
            showToast('Project created', 'success');
        }





        function syncSidebarListHeights() {
            const lists = document.querySelectorAll('.projects-list');
            lists.forEach(list => {
                if (list.classList.contains('collapsed')) {
                    list.style.setProperty('--projects-list-max-height', '0px');
                } else {
                    list.style.setProperty('--projects-list-max-height', `${list.scrollHeight}px`);
                }
            });
        }

        function renderProjectsList() {
            const lists = {
                activos: document.getElementById('projectsListActive'),
                bau: document.getElementById('projectsListBau'),
                training: document.getElementById('projectsListTraining'),
                completados: document.getElementById('projectsListCompleted'),
                archivados: document.getElementById('projectsListArchived'),
                eliminados: document.getElementById('projectsListDeleted')
            };

            if (!lists.activos || !lists.completados) {
                return; // Elementos no existen aún
            }

            // Con búsqueda activa: solo proyectos que casan, y cada sección
            // con resultados se despliega SIN tocar sidebarCollapsed, para
            // que al borrar la búsqueda vuelva a como el usuario la tenía.
            const searching = getSearchTokens(sidebarSearchQuery).length > 0;
            const matches = project => !searching || projectMatchesQuery(project, sidebarSearchQuery);
            const visibleLive = projects.filter(matches);
            const visibleDeleted = deletedProjects.filter(matches);
            const matchCountByGroup = { activos: 0, bau: 0, training: 0, completados: 0, archivados: 0, eliminados: visibleDeleted.length };
            visibleLive.forEach(p => { matchCountByGroup[getProjectGroup(p)] += 1; });

            Object.entries(lists).forEach(([group, list]) => {
                if (!list) return;
                list.innerHTML = '';
                const collapsed = searching ? matchCountByGroup[group] === 0 : sidebarCollapsed[group];
                list.className = `projects-list ${collapsed ? 'collapsed' : 'expanded'}`;
                const title = document.getElementById(SIDEBAR_TITLE_IDS[group]);
                if (title) {
                    // Durante la búsqueda se ocultan las secciones vacías
                    title.hidden = searching && matchCountByGroup[group] === 0;
                    list.hidden = title.hidden;
                    title.setAttribute('aria-expanded', String(!collapsed));
                    const icon = title.querySelector('.section-toggle-icon');
                    if (icon) icon.setAttribute('data-collapsed', collapsed ? 'true' : 'false');
                }
            });

            const emptyMsg = document.getElementById('sidebarSearchEmpty');
            const totalMatches = visibleLive.length + visibleDeleted.length;
            if (emptyMsg) {
                emptyMsg.hidden = !searching || totalMatches > 0;
                emptyMsg.textContent = searching ? `No projects match “${sidebarSearchQuery.trim()}”.` : '';
            }
            const status = document.getElementById('sidebarSearchStatus');
            if (status) status.textContent = searching ? `${totalMatches} ${totalMatches === 1 ? 'project' : 'projects'} found` : '';

            // Un <li> de proyecto: el botón de selección y el menú "..."
            // que aparece al pasar el ratón por encima.
            const buildItem = (project, state) => {
                const li = document.createElement('li');
                li.className = 'project-item';
                const isActive = currentProjectId === project.id;
                li.innerHTML = `
                    <button type="button" class="project-item-select${isActive ? ' active' : ''}"${isActive ? ' aria-current="true"' : ''}
                            onclick="selectProject(${jsArg(project.id)})">${highlightSearchMatches(project.name, sidebarSearchQuery)}</button>
                    <button type="button" class="project-item-menu-btn" data-project-id="${escapeHtml(project.id)}"
                            title="Project options" aria-label="Options for ${escapeHtml(project.name)}" aria-haspopup="true"
                            onclick="openProjectMenu(event, ${jsArg(project.id)}, ${jsArg(state)})">⋯</button>`;
                return li;
            };

            visibleLive.forEach(project => {
                const group = getProjectGroup(project);
                const list = lists[group];
                if (!list) return;
                list.appendChild(buildItem(project, group === 'archivados' ? 'archived' : 'live'));
            });

            visibleDeleted.forEach(project => {
                if (!lists.eliminados) return;
                lists.eliminados.appendChild(buildItem(project, 'deleted'));
            });

            // Contadores: con las secciones plegadas es la única pista de
            // que hay algo archivado o en la papelera.
            const archivedCount = projects.filter(p => isProjectArchived(p)).length;
            const archivedBadge = document.getElementById('sidebarCountArchived');
            if (archivedBadge) archivedBadge.textContent = archivedCount ? String(archivedCount) : '';
            const deletedBadge = document.getElementById('sidebarCountDeleted');
            if (deletedBadge) deletedBadge.textContent = deletedProjects.length ? String(deletedProjects.length) : '';

            if (!lists.archivados || !archivedCount) {
                // nada que pintar
            }
            if (lists.archivados && !archivedCount) {
                lists.archivados.innerHTML = '<li class="project-item-empty">Nothing archived.</li>';
            }
            if (lists.eliminados && !deletedProjects.length) {
                lists.eliminados.innerHTML = '<li class="project-item-empty">Bin is empty.</li>';
            }

            // Los selectores de proyecto solo ofrecen proyectos vivos: no
            // tiene sentido crear una tarea en algo archivado o borrado.
            const select = document.getElementById('commentProjectSelect');
            if (select) {
                // Conservar la selección: un refresco en tiempo real no debe vaciar el modal abierto
                const previousSelection = select.value;
                select.innerHTML = '<option value="">Select a project...</option>';
                getLiveProjects().forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    select.appendChild(opt);
                });
                if (previousSelection && projects.some(p => p.id === previousSelection)) select.value = previousSelection;
            }

            requestAnimationFrame(syncSidebarListHeights);
        }

        // =====================================================
        // ===== MENÚ "..." DE PROYECTO (renombrar/archivar/...) =====
        // Se monta en document.body, no dentro del <li>: la lista del
        // sidebar tiene overflow y un menú anidado quedaría recortado.
        // =====================================================

        function openProjectMenu(event, projectId, state) {
            if (event) event.stopPropagation();

            const alreadyOpen = document.getElementById('projectMenu');
            closeProjectMenu();
            // Segundo clic en el mismo "..." lo cierra.
            if (alreadyOpen && alreadyOpen.dataset.projectId === projectId) return;

            const project = findAnyProject(projectId);
            if (!project) return;

            const anchor = document.querySelector(`.project-item-menu-btn[data-project-id="${CSS.escape(projectId)}"]`);
            if (!anchor) return;

            const id = jsArg(projectId);
            let items;
            if (state === 'deleted') {
                items = `
                    <button type="button" class="project-menu-item" onclick="restoreProjectFromBin(${id})">
                        <span class="project-menu-ico" aria-hidden="true">⤺</span>Restore
                    </button>
                    <div class="project-menu-sep"></div>
                    <button type="button" class="project-menu-item project-menu-item--danger" onclick="deleteProjectForever(${id})">
                        <span class="project-menu-ico" aria-hidden="true">🗑</span>Delete permanently
                    </button>`;
            } else if (state === 'archived') {
                items = `
                    <button type="button" class="project-menu-item" onclick="renameProjectFromMenu(${id})">
                        <span class="project-menu-ico" aria-hidden="true">✎</span>Rename
                    </button>
                    <button type="button" class="project-menu-item" onclick="setProjectArchived(${id}, false)">
                        <span class="project-menu-ico" aria-hidden="true">⤺</span>Unarchive
                    </button>
                    <div class="project-menu-sep"></div>
                    <button type="button" class="project-menu-item project-menu-item--danger" onclick="moveProjectToBin(${id})">
                        <span class="project-menu-ico" aria-hidden="true">🗑</span>Move to bin
                    </button>`;
            } else {
                items = `
                    <button type="button" class="project-menu-item" onclick="renameProjectFromMenu(${id})">
                        <span class="project-menu-ico" aria-hidden="true">✎</span>Rename
                    </button>
                    <button type="button" class="project-menu-item" onclick="setProjectArchived(${id}, true)">
                        <span class="project-menu-ico" aria-hidden="true">🗄</span>Archive
                    </button>
                    <div class="project-menu-sep"></div>
                    <button type="button" class="project-menu-item project-menu-item--danger" onclick="moveProjectToBin(${id})">
                        <span class="project-menu-ico" aria-hidden="true">🗑</span>Move to bin
                    </button>`;
            }

            const menu = document.createElement('div');
            menu.id = 'projectMenu';
            menu.className = 'project-menu';
            menu.dataset.projectId = projectId;
            menu.setAttribute('role', 'menu');
            menu.setAttribute('aria-label', `Options for ${project.name}`);
            menu.innerHTML = `<div class="project-menu-title">${escapeHtml(project.name)}</div>${items}`;

            document.body.appendChild(menu);
            setTimeout(() => document.addEventListener('click', handleProjectMenuOutsideClick), 0);

            const first = menu.querySelector('.project-menu-item');
            if (first) first.focus();

            const rect = anchor.getBoundingClientRect();
            requestAnimationFrame(() => {
                const menuRect = menu.getBoundingClientRect();
                let left = rect.right + (window.scrollX || 0) + 6;
                let top = rect.top + (window.scrollY || 0);

                const maxLeft = (window.scrollX || 0) + window.innerWidth - menuRect.width - 12;
                if (left > maxLeft) left = Math.max((window.scrollX || 0) + 12, maxLeft);

                const maxTop = (window.scrollY || 0) + window.innerHeight - menuRect.height - 12;
                if (top > maxTop) top = Math.max((window.scrollY || 0) + 12, maxTop);

                menu.style.left = `${left}px`;
                menu.style.top = `${top}px`;
            });
        }

        function closeProjectMenu() {
            const menu = document.getElementById('projectMenu');
            if (menu) menu.remove();
            document.removeEventListener('click', handleProjectMenuOutsideClick);
        }

        function handleProjectMenuOutsideClick(event) {
            const menu = document.getElementById('projectMenu');
            if (!menu) {
                document.removeEventListener('click', handleProjectMenuOutsideClick);
                return;
            }
            if (menu.contains(event.target)) return;
            if (event.target.closest && event.target.closest('.project-item-menu-btn')) return;
            closeProjectMenu();
        }

        function renameProjectFromMenu(projectId) {
            closeProjectMenu();
            openRenameProjectModal(projectId);
        }

        // =====================================================
        // ======= ARCHIVAR / PAPELERA / RESTAURAR =============
        // =====================================================

        async function setProjectArchived(projectId, archived) {
            closeProjectMenu();
            const project = findAnyProject(projectId);
            if (!project) return;

            const stamp = archived ? new Date().toISOString() : null;
            const who = archived ? normalizeInitials(currentUser || '') : null;

            const { error } = await supabaseClient
                .from('projects')
                .update({ archived_at: stamp, archived_by: who })
                .eq('id', projectId);

            if (error) {
                console.error(error);
                showToast(formatSupabaseError(error, 'Could not archive the project'), 'error');
                return;
            }

            project.archivedAt = stamp;
            project.archivedBy = who || '';

            // Si el proyecto archivado era el que estaba abierto, saltar a
            // uno vivo: dejar la ficha de un proyecto archivado abierta
            // invita a seguir trabajando en él.
            if (archived && currentProjectId === projectId) {
                const next = getLiveProjects()[0];
                currentProjectId = next ? next.id : null;
            }

            // La sección donde acaba de aparecer tiene que estar visible.
            if (archived) sidebarCollapsed.archivados = false;

            renderProjectsList();
            renderActiveView();
            showToast(archived ? 'Project archived' : 'Project unarchived', 'success');
        }

        // Borrado blando: el proyecto va a la papelera con todo su
        // histórico intacto. Ver migrations_capacity_tasks_archive.sql.
        async function moveProjectToBin(projectId) {
            closeProjectMenu();
            const project = findAnyProject(projectId);
            if (!project) return;

            if (!confirm(`Move "${project.name}" to the bin?\n\nIt disappears from the views but nothing is lost: you can restore it from the Bin section.`)) return;

            const stamp = new Date().toISOString();
            const who = normalizeInitials(currentUser || '');

            const { error } = await supabaseClient
                .from('projects')
                .update({ deleted_at: stamp, deleted_by: who })
                .eq('id', projectId);

            if (error) {
                console.error(error);
                showToast(formatSupabaseError(error, 'Could not move the project to the bin'), 'error');
                return;
            }

            project.deletedAt = stamp;
            project.deletedBy = who;
            projects = projects.filter(p => p.id !== projectId);
            deletedProjects.unshift(project);

            if (currentProjectId === projectId) {
                const next = getLiveProjects()[0];
                currentProjectId = next ? next.id : null;
            }

            sidebarCollapsed.eliminados = false;
            renderProjectsList();
            renderActiveView();
            showToast('Moved to bin', 'success');
        }

        async function restoreProjectFromBin(projectId) {
            closeProjectMenu();
            const project = deletedProjects.find(p => p.id === projectId);
            if (!project) return;

            const { error } = await supabaseClient
                .from('projects')
                .update({ deleted_at: null, deleted_by: null })
                .eq('id', projectId);

            if (error) {
                console.error(error);
                showToast(formatSupabaseError(error, 'Could not restore the project'), 'error');
                return;
            }

            project.deletedAt = null;
            project.deletedBy = '';
            deletedProjects = deletedProjects.filter(p => p.id !== projectId);
            projects.push(project);

            // Vuelve a la sección que le toque por fase, o a Archivados si
            // además estaba archivado cuando se tiró.
            const group = getProjectGroup(project);
            sidebarCollapsed[group] = false;

            renderProjectsList();
            renderActiveView();
            showToast('Project restored', 'success');
        }

        // Borrado DEFINITIVO. Esto sí es un DELETE real, y todas las tablas
        // hijas cuelgan con ON DELETE CASCADE, así que se lleva comentarios,
        // notas, incidencias y capacidades. Doble confirmación a propósito.
        async function deleteProjectForever(projectId) {
            closeProjectMenu();
            const project = deletedProjects.find(p => p.id === projectId);
            if (!project) return;

            const commentCount = (dailyComments || []).filter(c => c.projectId === projectId).length;
            const warning = `Delete "${project.name}" permanently?\n\n` +
                `This cannot be undone. It also deletes its comments${commentCount ? ` (${commentCount})` : ''}, notes, incidents and weekly goals.`;
            if (!confirm(warning)) return;
            if (!confirm(`Last check: permanently delete "${project.name}"?`)) return;

            const { error } = await supabaseClient
                .from('projects')
                .delete()
                .eq('id', projectId);

            if (error) {
                console.error(error);
                showToast(formatSupabaseError(error, 'Could not delete the project'), 'error');
                return;
            }

            deletedProjects = deletedProjects.filter(p => p.id !== projectId);
            if (currentProjectId === projectId) {
                const next = getLiveProjects()[0];
                currentProjectId = next ? next.id : null;
            }

            // Recargar: el cascade ha borrado filas de varias tablas que
            // seguimos teniendo en memoria.
            await loadDataFromSupabase(true);
            renderProjectsList();
            renderActiveView();
            showToast('Project permanently deleted', 'success');
        }

        const SIDEBAR_TITLE_IDS = { activos: 'sidebarTitleActivos', bau: 'sidebarTitleBau', training: 'sidebarTitleTraining', completados: 'sidebarTitleCompletados', archivados: 'sidebarTitleArchivados', eliminados: 'sidebarTitleEliminados' };

        // Texto del buscador del sidebar. El <input> es HTML estático (no se
        // re-renderiza), así que el tiempo real no le roba el foco.
        let sidebarSearchQuery = '';

        function setSidebarSearch(value) {
            sidebarSearchQuery = String(value || '');
            renderProjectsList();
        }

        function clearSidebarSearch() {
            const input = document.getElementById('sidebarProjectSearch');
            if (input) input.value = '';
            setSidebarSearch('');
        }

        function handleSidebarSearchKey(event) {
            if (event.key === 'Escape') {
                // Primer Esc limpia; si ya está vacío, se deja al manejador global
                if (!sidebarSearchQuery) return;
                event.preventDefault();
                event.stopPropagation();
                clearSidebarSearch();
            } else if (event.key === 'Enter') {
                event.preventDefault();
                const first = document.querySelector('#sidebar .projects-list:not([hidden]) .project-item-select');
                if (first) first.click();
            } else if (event.key === 'ArrowDown') {
                event.preventDefault();
                const first = document.querySelector('#sidebar .projects-list:not([hidden]) .project-item-select');
                if (first) first.focus();
            }
        }

        function focusSidebarSearch() {
            const sidebar = document.getElementById('sidebar');
            if (window.matchMedia('(max-width: 768px)').matches) {
                if (sidebar && !sidebar.classList.contains('mobile-open')) toggleMobileSidebar();
            } else if (sidebar && sidebar.classList.contains('collapsed')) {
                setSidebarCollapsed(false);
                sidebarAutoCollapsed = false;
            }
            const input = document.getElementById('sidebarProjectSearch');
            if (input) { input.focus(); input.select(); }
        }

        function toggleSidebarSection(section) {
            sidebarCollapsed[section] = !sidebarCollapsed[section];
            const title = document.getElementById(SIDEBAR_TITLE_IDS[section]);
            if (title) {
                title.setAttribute('aria-expanded', String(!sidebarCollapsed[section]));
                const icon = title.querySelector('.section-toggle-icon');
                if (icon) icon.setAttribute('data-collapsed', sidebarCollapsed[section] ? 'true' : 'false');
            }
            renderProjectsList();
        }

        function selectProject(projectId) {
            closeMobileSidebar();
            currentProjectId = projectId;
            renderProjectsList();

            const selectedProject = findAnyProject(projectId);
            // El Daily solo tiene pestañas para activos/BAU/completados. Un
            // proyecto archivado o en la papelera no cabe ahí, así que se
            // abre su ficha (en modo consulta) en lugar de dejar el Daily
            // en un modo que no existe.
            const group = getProjectGroup(selectedProject);
            const showableInDaily = selectedProject && !selectedProject.deletedAt && group !== 'archivados';

            if (currentView === 'daily' && showableInDaily) {
                // En Daily, mostrar el modo acorde al proyecto y resaltar su fila
                setDailyViewMode(group);
            } else {
                // Desde cualquier otra vista, abrir la ficha del proyecto
                switchView('ficha');
            }
        }


        function formatDateDisplay(isoDate) {
            if (!isoDate) return '';
            const d = new Date(isoDate);
            if (isNaN(d)) return isoDate;
            const dd = String(d.getDate()).padStart(2, '0');
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const yyyy = d.getFullYear();
            return `${dd}/${mm}/${yyyy}`;
        }

        function formatDateKey(date) {
            const year = date.getFullYear();
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        }

        function getCommentOwnerInitials(comment) {
            return normalizeInitials((comment && (comment.ownerInitials || comment.userName)) || '');
        }

        function isPersonalComment(comment) {
            return !!(comment && comment.isPersonal);
        }

        function canCurrentUserViewComment(comment) {
            if (!comment) return false;
            if (!isPersonalComment(comment)) return true;
            const owner = getCommentOwnerInitials(comment);
            return owner && owner === normalizeInitials(currentUser);
        }

        function canCurrentUserManageComment(comment) {
            if (!comment) return false;
            if (!isPersonalComment(comment)) return true;
            const owner = getCommentOwnerInitials(comment);
            return owner && owner === normalizeInitials(currentUser);
        }

        function getVisibleCommentsByProjectDate(projectId, dateKey) {
            return dailyComments.filter(c =>
                c.projectId === projectId &&
                c.date === dateKey &&
                canCurrentUserViewComment(c)
            );
        }

        function getVisibleCommentsByProject(projectId) {
            return dailyComments.filter(c => c.projectId === projectId && canCurrentUserViewComment(c));
        }

        function commentCountsForCell(topLevelComments) {
            const owner = normalizeInitials(currentUser);
            const pendingTeam = topLevelComments.filter(c =>
                !c.completed &&
                !c.isPersonal &&
                (c.responsible === currentUser || !c.responsible)
            ).length;
            const pendingPersonal = topLevelComments.filter(c =>
                !c.completed &&
                c.isPersonal &&
                getCommentOwnerInitials(c) === owner
            ).length;

            return { pendingTeam, pendingPersonal };
        }

        function parseDateKeyToDate(dateKey) {
            const raw = String(dateKey || '').trim();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
            const d = new Date(`${raw}T00:00:00`);
            if (isNaN(d.getTime())) return null;
            return d;
        }

        function isWeekendDate(dateObj) {
            if (!dateObj) return false;
            const day = dateObj.getDay();
            return day === 0 || day === 6;
        }

        function shiftBusinessDate(dateKey, direction) {
            const safeDirection = direction < 0 ? -1 : 1;
            let cursor = parseDateKeyToDate(dateKey) || new Date();

            do {
                cursor.setDate(cursor.getDate() + safeDirection);
            } while (isWeekendDate(cursor));

            return formatDateKey(cursor);
        }

        function getCurrentUserDayPersonalTasksByDate(dateKey) {
            const owner = normalizeInitials(currentUser || '');
            return (dayPersonalTasks || []).filter(t =>
                t.ownerInitials === owner &&
                t.date === dateKey
            );
        }

        // Team tasks for a day, newest meaningful order: pending first, then
        // by creation. Shared with everybody, unlike day_personal_tasks.
        // Una tarea "private" solo la ven su creador y sus asignados; las
        // de equipo, todos. Ocultación de interfaz: RLS sigue abierta.
        function isDayTaskInvolvingMe(task) {
            const me = normalizeInitials(currentUser || '');
            return !!me && (task.createdBy === me || (task.assignees || []).includes(me));
        }

        function canCurrentUserSeeDayTask(task) {
            return task.visibility !== 'private' || isDayTaskInvolvingMe(task);
        }

        function getDayTeamTasksByDate(dateKey) {
            return (dayTasks || []).filter(t => t.date === dateKey && canCurrentUserSeeDayTask(t));
        }

        // Team tasks on that day that are mine: either assigned to me or left
        // unassigned (nobody picked them up yet, so they are everyone's).
        function getMyDayTeamTasksByDate(dateKey) {
            const me = normalizeInitials(currentUser || '');
            return getDayTeamTasksByDate(dateKey).filter(t =>
                t.assignees.includes(me) || t.assignees.length === 0
            );
        }

        // The "+" in the Daily day header reflects what the logged-in user
        // still has to do that day: their private tasks plus the team tasks
        // that are on their plate.
        function getDayHeaderButtonState(dateKey) {
            const tasks = getCurrentUserDayPersonalTasksByDate(dateKey)
                .concat(getMyDayTeamTasksByDate(dateKey));
            if (!tasks.length) return 'none';
            const hasPending = tasks.some(t => !t.completed);
            return hasPending ? 'pending' : 'done';
        }

        function getDayHeaderButtonClass(dateKey) {
            const state = getDayHeaderButtonState(dateKey);
            if (state === 'pending') return 'is-pending';
            if (state === 'done') return 'is-done';
            return '';
        }

        function getDayHeaderButtonTitle(dateKey) {
            const personalPending = getCurrentUserDayPersonalTasksByDate(dateKey).filter(t => !t.completed).length;
            const teamPending = getMyDayTeamTasksByDate(dateKey).filter(t => !t.completed).length;
            const total = personalPending + teamPending;

            if (total === 0) {
                const state = getDayHeaderButtonState(dateKey);
                return state === 'done' ? 'Tasks for the day completed' : 'Tasks for the day';
            }

            const parts = [];
            if (teamPending > 0) parts.push(`${teamPending} team`);
            if (personalPending > 0) parts.push(`${personalPending} personal`);
            return `${total} pending for the day (${parts.join(', ')})`;
        }

        function formatDayPersonalModalTitle(dateKey) {
            const dateObj = parseDateKeyToDate(dateKey);
            if (!dateObj) return 'Tasks for the day';
            const weekday = dateObj.toLocaleDateString('en-GB', { weekday: 'long' });
            const niceWeekday = weekday.charAt(0).toUpperCase() + weekday.slice(1);
            const niceDate = dateObj.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });
            return `${niceWeekday} ${niceDate}`;
        }

        function openDayPersonalTasksModal(event, dateKey) {
            if (event) {
                event.stopPropagation();
            }
            dayPersonalTasksModalContext.dateKey = dateKey;
            // Start the team-task form clean, with the current user already
            // on it: "I am working on this" is the common case.
            resetDayTeamTaskForm();
            renderDayPersonalTasksModal();
            openModal('dayPersonalTasksModal', '#dayTeamTaskInput');
        }

        function closeDayPersonalTasksModal() {
            closeModal('dayPersonalTasksModal');
            const input = document.getElementById('dayPersonalTaskInput');
            if (input) input.value = '';
            const teamInput = document.getElementById('dayTeamTaskInput');
            if (teamInput) teamInput.value = '';
        }

        function previousDayPersonalTasksDate() {
            const current = dayPersonalTasksModalContext.dateKey || formatDateKey(new Date());
            dayPersonalTasksModalContext.dateKey = shiftBusinessDate(current, -1);
            renderDayPersonalTasksModal();
        }

        function nextDayPersonalTasksDate() {
            const current = dayPersonalTasksModalContext.dateKey || formatDateKey(new Date());
            dayPersonalTasksModalContext.dateKey = shiftBusinessDate(current, 1);
            renderDayPersonalTasksModal();
        }

        function renderDayPersonalTasksModal() {
            const dateKey = dayPersonalTasksModalContext.dateKey || formatDateKey(new Date());
            dayPersonalTasksModalContext.dateKey = dateKey;

            const titleEl = document.getElementById('dayPersonalTasksTitle');
            if (titleEl) titleEl.textContent = formatDayPersonalModalTitle(dateKey);

            renderDayTeamTasksSection(dateKey);
            renderDayPersonalTasksList(dateKey);
        }

        function renderDayPersonalTasksList(dateKey) {
            const listEl = document.getElementById('dayPersonalTasksList');
            if (!listEl) return;

            const tasks = getCurrentUserDayPersonalTasksByDate(dateKey)
                .slice()
                .sort((a, b) => {
                    if (a.completed !== b.completed) return a.completed ? 1 : -1;
                    return new Date(b.createdAt) - new Date(a.createdAt);
                });

            if (!tasks.length) {
                listEl.innerHTML = '<div class="empty-state empty-state--compact">No personal tasks for this day.</div>';
                return;
            }

            let html = '<div class="day-personal-list">';
            tasks.forEach(task => {
                html += `
                <div class="day-personal-item${task.completed ? ' done' : ''}">
                    <label class="day-personal-item-main">
                        <input type="checkbox" ${task.completed ? 'checked' : ''} onchange="toggleDayPersonalTask('${task.id}', this.checked)">
                        <span>${escapeHtml(task.text)}</span>
                    </label>
                    <button type="button" class="day-personal-delete" onclick="deleteDayPersonalTask('${task.id}')" title="Delete task" aria-label="Delete task: ${escapeHtml(task.text)}">×</button>
                </div>`;
            });
            html += '</div>';

            listEl.innerHTML = html;
        }

        async function addDayPersonalTask() {
            const input = document.getElementById('dayPersonalTaskInput');
            if (!input) return;
            const text = input.value.trim();
            if (!text) {
                input.focus();
                return;
            }

            const dateKey = dayPersonalTasksModalContext.dateKey || formatDateKey(new Date());
            const owner = normalizeInitials(currentUser || 'US');

            const { error } = await supabaseClient
                .from(DAY_PERSONAL_TASKS_TABLE)
                .insert({
                    owner_initials: owner,
                    task_date: dateKey,
                    text,
                    completed: false
                });

            if (error) {
                console.error(error);
                showToast('Error saving personal task for the day', 'error');
                return;
            }

            input.value = '';
            await loadDayPersonalTasks();
            renderDayPersonalTasksModal();
            renderActiveView();
        }

        async function toggleDayPersonalTask(taskId, done) {
            const owner = normalizeInitials(currentUser || 'US');
            const { error } = await supabaseClient
                .from(DAY_PERSONAL_TASKS_TABLE)
                .update({ completed: !!done })
                .eq('id', taskId)
                .eq('owner_initials', owner);

            if (error) {
                console.error(error);
                showToast('Error updating personal task for the day', 'error');
                return;
            }

            await loadDayPersonalTasks();
            renderDayPersonalTasksModal();
            renderActiveView();
        }

        async function deleteDayPersonalTask(taskId) {
            const confirmed = confirm('Delete this personal task for the day?');
            if (!confirmed) return;

            const owner = normalizeInitials(currentUser || 'US');
            const { error } = await supabaseClient
                .from(DAY_PERSONAL_TASKS_TABLE)
                .delete()
                .eq('id', taskId)
                .eq('owner_initials', owner);

            if (error) {
                console.error(error);
                showToast('Error deleting personal task for the day', 'error');
                return;
            }

            await loadDayPersonalTasks();
            renderDayPersonalTasksModal();
            renderActiveView();
        }

        // =====================================================
        // ============ TAREAS DE DÍA DEL EQUIPO ===============
        // Shared counterpart of day_personal_tasks: same day-by-day
        // rhythm, but visible to everyone and assignable, so you can
        // put "move the Power Automate flow to UAT" on Thursday and
        // tag whoever needs to know or lend a hand.
        //
        // Lives in the same modal as the personal tasks (the "+" in
        // the Daily day header). Project is optional: not every day
        // task belongs to a project.
        // =====================================================

        // Assignees ticked in the new-team-task form. Held outside the DOM so
        // the picker survives its own re-render.
        let dayTeamTaskAssignees = [];

        // Project chosen in the new-team-task form. Also kept outside the DOM:
        // the modal is re-rendered by the realtime handler, and reading the
        // selection back off the <select> would lose an explicit "No project"
        // (empty value) and silently snap it back to the current project.
        let dayTeamTaskProjectId = '';

        async function loadDayTasks() {
            const { data, error } = await supabaseClient
                .from(DAY_TASKS_TABLE)
                .select('*')
                .order('task_date', { ascending: true })
                .order('created_at', { ascending: true });

            if (error) {
                console.error('Error loading team tasks for the day:', formatSupabaseError(error, 'Could not load team tasks for the day'));
                dayTasks = [];
                return;
            }

            dayTasks = (data || []).map(t => ({
                id: t.id,
                date: t.task_date,
                text: t.text || '',
                projectId: t.project_id || null,
                assignees: sanitizeResponsiblesList(t.assignees),
                description: t.description || '',
                estimatedHours: Number(t.estimated_hours) || 0,
                hoursByAssignee: normalizeHoursByAssignee(t.hours_by_assignee),
                // Columnas de la vista Tasks (migrations_tasks_absences_regions.sql).
                // Los defaults reproducen cómo se comportaba una tarea de día antes.
                priority: ['Baja', 'Media', 'Alta', 'Crítica'].includes(t.priority) ? t.priority : 'Media',
                effort: ['Bajo', 'Medio', 'Alto'].includes(t.effort) ? t.effort : '',
                time: /^\d{2}:\d{2}$/.test(t.task_time || '') ? t.task_time : '',
                visibility: t.visibility === 'private' ? 'private' : 'team',
                // migrations_training_hours_admin.sql
                taskType: normalizeTaskType(t.task_type),
                createdBy: normalizeInitials(t.created_by || ''),
                completed: !!t.completed,
                createdAt: t.created_at,
                updatedAt: t.updated_at || t.created_at
            }));
        }

        async function loadCapacityOverrides() {
            const { data, error } = await supabaseClient
                .from(CAPACITY_OVERRIDES_TABLE)
                .select('*');

            if (error) {
                // La tabla puede no existir todavía si no se ha pasado la
                // migración. No es fatal: sin overrides la capacidad es
                // simplemente la calculada.
                console.error('Error loading capacity overrides:', formatSupabaseError(error, 'Could not load capacity overrides'));
                capacityOverrides = [];
                return;
            }

            capacityOverrides = (data || []).map(o => ({
                userInitials: normalizeInitials(o.user_initials),
                weekStart: o.week_start,
                overrideHours: Number(o.override_hours) || 0,
                note: o.note || '',
                createdBy: normalizeInitials(o.created_by || '')
            }));
        }

        function resetDayTeamTaskForm() {
            const me = normalizeInitials(currentUser || '');
            dayTeamTaskAssignees = (me && teamMembers.includes(me)) ? [me] : [];

            const input = document.getElementById('dayTeamTaskInput');
            if (input) input.value = '';

            const projectSelect = document.getElementById('dayTeamTaskProject');
            dayTeamTaskProjectId = (currentProjectId && projects.some(p => p.id === currentProjectId))
                ? currentProjectId
                : '';
            if (projectSelect) projectSelect.value = dayTeamTaskProjectId;
            syncTrainingCheckbox('dayTeamTaskTraining', dayTeamTaskProjectId);
        }

        function onDayTeamTaskProjectChange(value) {
            dayTeamTaskProjectId = value || '';
            syncTrainingCheckbox('dayTeamTaskTraining', dayTeamTaskProjectId);
        }

        // Al elegir proyecto, la casilla Training se marca si el proyecto es
        // Training. Después se puede cambiar a mano.
        function syncTrainingCheckbox(checkboxId, projectId) {
            const box = document.getElementById(checkboxId);
            if (box) box.checked = getDefaultTaskTypeForProject(projectId) === TASK_TYPE_TRAINING;
        }

        function readTaskTypeFromCheckbox(checkboxId) {
            const box = document.getElementById(checkboxId);
            return box && box.checked ? TASK_TYPE_TRAINING : TASK_TYPE_STANDARD;
        }

        function renderDayTeamTaskAssignees() {
            const host = document.getElementById('dayTeamTaskAssignees');
            if (!host) return;

            const options = teamMembers.filter(m => !isExcludedResponsible(m));
            if (!options.length) {
                host.innerHTML = '<p class="owner-picker-hint">No team members available.</p>';
                return;
            }

            host.innerHTML = options.map(member => {
                const on = dayTeamTaskAssignees.includes(member);
                return `<button type="button"
                        class="owner-picker-btn${on ? ' is-selected' : ''}"
                        aria-pressed="${on}"
                        title="${on ? 'Unassign' : 'Assign'} ${escapeHtml(member)}"
                        onclick="toggleDayTeamTaskAssignee(${jsArg(member)})">
                        <span class="owner-picker-check" aria-hidden="true">${on ? '✓' : '+'}</span>${escapeHtml(member)}
                    </button>`;
            }).join('');
        }

        function toggleDayTeamTaskAssignee(member) {
            dayTeamTaskAssignees = dayTeamTaskAssignees.includes(member)
                ? dayTeamTaskAssignees.filter(m => m !== member)
                : [...dayTeamTaskAssignees, member];
            renderDayTeamTaskAssignees();
        }

        // Rebuilt on every render so a renamed, created or deleted project is
        // reflected without reopening the modal. The current selection is
        // preserved across the rebuild.
        function renderDayTeamTaskProjectOptions() {
            const select = document.getElementById('dayTeamTaskProject');
            if (!select) return;

            const sorted = projects.slice().sort((a, b) => (a.name || '').localeCompare(b.name || ''));

            select.innerHTML = '<option value="">No project</option>' +
                sorted.map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');

            // Drop a selection whose project has since been deleted.
            if (dayTeamTaskProjectId && !projects.some(p => p.id === dayTeamTaskProjectId)) {
                dayTeamTaskProjectId = '';
            }
            select.value = dayTeamTaskProjectId;
        }

        function renderDayTeamTasksSection(dateKey) {
            renderDayTeamTaskProjectOptions();
            renderDayTeamTaskAssignees();

            const listEl = document.getElementById('dayTeamTasksList');
            if (!listEl) return;

            const me = normalizeInitials(currentUser || '');
            const tasks = getDayTeamTasksByDate(dateKey)
                .slice()
                .sort((a, b) => {
                    if (a.completed !== b.completed) return a.completed ? 1 : -1;
                    return new Date(b.createdAt) - new Date(a.createdAt);
                });

            if (!tasks.length) {
                listEl.innerHTML = '<div class="empty-state empty-state--compact">No team tasks for this day.</div>';
                return;
            }

            let html = '<div class="day-personal-list">';
            tasks.forEach(task => {
                const project = task.projectId ? projects.find(p => p.id === task.projectId) : null;
                const mine = task.assignees.includes(me);

                const assigneeChips = task.assignees.length
                    ? task.assignees.map(a => `<span class="day-task-chip${a === me ? ' is-me' : ''}"${getMemberChipAttrs(a)}>${escapeHtml(a)}</span>`).join('')
                    : '<span class="day-task-chip day-task-chip--none">Unassigned</span>';

                const projectChip = project
                    ? `<span class="day-task-project">${escapeHtml(project.name)}</span>`
                    : '';

                html += `
                <div class="day-personal-item day-task-item prio-edge-${getPriorityLevel(task.priority)}${task.completed ? ' done' : ''}${mine ? ' is-mine' : ''}${isTrainingTask(task) ? ' is-training' : ''}">
                    <label class="day-personal-item-main">
                        <input type="checkbox" ${task.completed ? 'checked' : ''} onchange="toggleDayTeamTask(${jsArg(task.id)}, this.checked)">
                        <span class="day-task-body">
                            <span class="day-task-text">${task.time ? `<span class="day-task-time">${escapeHtml(task.time)}</span> ` : ''}${escapeHtml(task.text)}</span>
                            <span class="day-task-meta">${isTrainingTask(task) ? renderTrainingBadge() : ''}${renderPriorityBadge(getPriorityLevel(task.priority), getPriorityLabel(task.priority))}${task.visibility === 'private' ? '<span class="completion-badge completion-badge--private">PRIVATE</span>' : ''}${projectChip}${assigneeChips}${task.createdBy ? `<span class="day-task-author">by ${escapeHtml(task.createdBy)}</span>` : ''}</span>
                        </span>
                    </label>
                    <button type="button" class="day-personal-delete" onclick="deleteDayTeamTask(${jsArg(task.id)})" title="Delete task" aria-label="Delete team task: ${escapeHtml(task.text)}">×</button>
                </div>`;
            });
            html += '</div>';

            listEl.innerHTML = html;
        }

        async function addDayTeamTask() {
            const input = document.getElementById('dayTeamTaskInput');
            if (!input) return;

            const text = input.value.trim();
            if (!text) {
                input.focus();
                return;
            }

            const dateKey = dayPersonalTasksModalContext.dateKey || formatDateKey(new Date());
            const projectId = dayTeamTaskProjectId || null;

            const { error } = await supabaseClient
                .from(DAY_TASKS_TABLE)
                .insert({
                    task_date: dateKey,
                    text,
                    project_id: projectId,
                    assignees: sanitizeResponsiblesList(dayTeamTaskAssignees),
                    task_type: readTaskTypeFromCheckbox('dayTeamTaskTraining'),
                    created_by: normalizeInitials(currentUser || 'US'),
                    completed: false
                });

            if (error) {
                console.error(error);
                showToast(formatSupabaseError(error, 'Error saving team task for the day'), 'error');
                return;
            }

            input.value = '';
            await loadDayTasks();
            renderDayPersonalTasksModal();
            renderActiveView();
            showToast('Team task added', 'success');
        }

        async function toggleDayTeamTask(taskId, done) {
            const { error } = await supabaseClient
                .from(DAY_TASKS_TABLE)
                .update({ completed: !!done, updated_at: new Date().toISOString() })
                .eq('id', taskId);

            if (error) {
                console.error(error);
                showToast(formatSupabaseError(error, 'Error updating team task for the day'), 'error');
                return;
            }

            await loadDayTasks();
            renderDayPersonalTasksModal();
            renderActiveView();
        }

        async function deleteDayTeamTask(taskId) {
            const confirmed = confirm('Delete this team task? It will disappear for everyone.');
            if (!confirmed) return;

            const { error } = await supabaseClient
                .from(DAY_TASKS_TABLE)
                .delete()
                .eq('id', taskId);

            if (error) {
                console.error(error);
                showToast(formatSupabaseError(error, 'Error deleting team task for the day'), 'error');
                return;
            }

            await loadDayTasks();
            renderDayPersonalTasksModal();
            renderActiveView();
        }

        // =====================================================
        // ===================== VISTA TASKS ====================
        // Lo que tiene asignado el usuario conectado, venga de donde
        // venga: tareas de Daily (daily_comments, con proyecto) y tareas
        // de day_tasks (con o sin proyecto, con o sin fecha). Cada uno ve
        // solo lo suyo. Las tareas nuevas se crean en day_tasks:
        //   - sin fecha  -> solo aquí, y no cuentan en la capacidad
        //   - con fecha  -> también en Daily ese día, y sí cuentan
        // =====================================================

        let tasksFilters = { project: '', priority: '', showDone: false };
        let taskEditorState = { id: null, assignees: [] };

        // Elemento común de la lista, sea un comentario de Daily o una day_task.
        function buildMyTaskItem(source, task, me) {
            const isComment = source === 'comment';
            return {
                source,
                id: task.id,
                title: task.text || '',
                description: task.description || '',
                projectId: task.projectId || null,
                date: task.date || '',
                time: isComment ? '' : (task.time || ''),
                level: isComment ? getUrgencyLevel(task.urgency) : getPriorityLevel(task.priority),
                levelLabel: isComment ? getUrgencyLabel(task.urgency) : getPriorityLabel(task.priority),
                effort: isComment ? '' : (task.effort || ''),
                myHours: getTaskHoursForUser(task, me),
                totalHours: getTaskTotalHours(task),
                assignees: getTaskAssignees(task),
                completed: !!task.completed,
                taskType: normalizeTaskType(task.taskType),
                isPrivate: isComment ? !!task.isPersonal : task.visibility === 'private',
                canEdit: isComment ? canCurrentUserManageComment(task) : isDayTaskInvolvingMe(task)
            };
        }

        function getMyTaskItems() {
            const me = normalizeInitials(currentUser || '');
            if (!me) return [];
            const fromDaily = (dailyComments || [])
                .filter(c => !c.parentId && canCurrentUserViewComment(c) &&
                    (getTaskAssignees(c).includes(me) || (isPersonalComment(c) && getCommentOwnerInitials(c) === me)))
                .map(c => buildMyTaskItem('comment', c, me));
            const fromDayTasks = (dayTasks || [])
                .filter(isDayTaskInvolvingMe)
                .map(t => buildMyTaskItem('task', t, me));
            return fromDaily.concat(fromDayTasks);
        }

        const PRIORITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 };

        // Grupo temporal de una tarea respecto a hoy.
        function getMyTaskGroup(item, todayKey, weekEndKey) {
            if (item.completed) return 'done';
            if (!item.date) return 'nodate';
            if (item.date < todayKey) return 'overdue';
            if (item.date === todayKey) return 'today';
            if (item.date <= weekEndKey) return 'week';
            return 'later';
        }

        const MY_TASK_GROUPS = [
            ['overdue', 'Overdue'],
            ['today', 'Today'],
            ['week', 'Later this week'],
            ['later', 'Upcoming'],
            ['nodate', 'No date'],
            ['done', 'Done']
        ];

        function updateTasksViewCount() {
            const badge = document.getElementById('tasksViewCount');
            if (!badge) return;
            const pending = getMyTaskItems().filter(i => !i.completed).length;
            badge.textContent = pending ? String(pending) : '';
        }

        function setTasksFilter(field, value) {
            tasksFilters[field] = field === 'showDone' ? !!value : String(value || '');
            renderTasksView();
        }

        function renderMyTaskItem(item) {
            const me = normalizeInitials(currentUser || '');
            const project = item.projectId ? findAnyProject(item.projectId) : null;
            const others = item.assignees.filter(a => a !== me);
            const when = item.date
                ? `${formatDateDisplay(item.date)}${item.time ? ` · ${escapeHtml(item.time)}` : ''}`
                : '';
            const hours = item.myHours > 0
                ? `${formatHours(item.myHours)}h${item.totalHours > item.myHours ? ` of ${formatHours(item.totalHours)}h` : ''}`
                : '';
            const effortLabel = item.effort ? getImpactLabel(item.effort) : '';
            const titleAction = item.source === 'comment'
                ? `openTaskDetail(${jsArg(item.id)})`
                : (item.canEdit ? `openTaskEditor(${jsArg(item.id)})` : '');

            return `<li class="my-task prio-edge-${item.level}${item.completed ? ' done' : ''}${isTrainingTask(item) ? ' is-training' : ''}">
                <input type="checkbox" class="my-task-check" ${item.completed ? 'checked' : ''}
                       aria-label="Mark “${escapeHtml(item.title)}” as done"
                       ${item.canEdit ? '' : 'disabled'}
                       onchange="toggleMyTask(${jsArg(item.source)}, ${jsArg(item.id)}, this.checked)">
                <div class="my-task-body">
                    ${titleAction
                        ? `<button type="button" class="my-task-title" onclick="${titleAction}">${escapeHtml(item.title)}</button>`
                        : `<span class="my-task-title">${escapeHtml(item.title)}</span>`}
                    ${item.description ? `<p class="my-task-desc">${escapeHtml(item.description)}</p>` : ''}
                    <div class="my-task-meta">
                        ${isTrainingTask(item) ? renderTrainingBadge() : ''}
                        ${renderPriorityBadge(item.level, item.levelLabel)}
                        ${effortLabel ? `<span class="my-task-chip" title="Effort">Effort: ${escapeHtml(effortLabel)}</span>` : ''}
                        ${project ? `<span class="day-task-project">${escapeHtml(project.name)}</span>` : '<span class="my-task-chip my-task-chip--muted">No project</span>'}
                        ${when ? `<span class="my-task-chip">${when}</span>` : ''}
                        ${hours ? `<span class="my-task-chip" title="Your share of the estimated hours">${hours}</span>` : ''}
                        ${others.map(a => `<span class="day-task-chip"${getMemberChipAttrs(a)}>${escapeHtml(a)}</span>`).join('')}
                        ${item.isPrivate ? '<span class="completion-badge completion-badge--private">PRIVATE</span>' : ''}
                        ${item.source === 'comment' ? '<span class="my-task-source" title="Created from Daily">Daily</span>' : ''}
                    </div>
                </div>
                ${item.source === 'task' && item.canEdit ? `<div class="my-task-actions">
                    <button type="button" class="comment-action-btn" onclick="openTaskEditor(${jsArg(item.id)})" aria-label="Edit task: ${escapeHtml(item.title)}">✏️ Edit</button>
                    <button type="button" class="comment-action-btn comment-action-btn--danger" onclick="deleteMyTask(${jsArg(item.id)})" aria-label="Delete task: ${escapeHtml(item.title)}">🗑️</button>
                </div>` : ''}
            </li>`;
        }

        function renderTasksView() {
            const container = document.getElementById('tasksView');
            if (!container) return;

            const todayKey = formatDateKey(new Date());
            const weekEnd = getMonday(new Date());
            weekEnd.setDate(weekEnd.getDate() + 6);
            const weekEndKey = formatDateKey(weekEnd);
            const thisWeekKey = formatDateKey(getMonday(new Date()));

            const all = getMyTaskItems();
            const pending = all.filter(i => !i.completed);
            const pendingWeekHours = pending
                .filter(i => i.date && getWeekKeyForDateKey(i.date) === thisWeekKey)
                .reduce((sum, i) => sum + i.myHours, 0);
            const unscheduledHours = pending.filter(i => !i.date).reduce((sum, i) => sum + i.myHours, 0);

            const visible = all.filter(i =>
                (!tasksFilters.project || (tasksFilters.project === '__none__' ? !i.projectId : i.projectId === tasksFilters.project)) &&
                (!tasksFilters.priority || i.level === tasksFilters.priority));

            const groups = {};
            visible.forEach(item => {
                const key = getMyTaskGroup(item, todayKey, weekEndKey);
                (groups[key] = groups[key] || []).push(item);
            });
            Object.values(groups).forEach(list => list.sort((a, b) =>
                (a.date || '9999').localeCompare(b.date || '9999') ||
                (a.time || '99').localeCompare(b.time || '99') ||
                PRIORITY_RANK[a.level] - PRIORITY_RANK[b.level]));

            const projectIds = [...new Set(all.map(i => i.projectId).filter(Boolean))];
            const projectOptions = projectIds
                .map(id => findAnyProject(id))
                .filter(Boolean)
                .sort((a, b) => a.name.localeCompare(b.name))
                .map(p => `<option value="${escapeHtml(p.id)}" ${tasksFilters.project === p.id ? 'selected' : ''}>${escapeHtml(p.name)}</option>`)
                .join('');
            const prioOption = (value, label) => `<option value="${value}" ${tasksFilters.priority === value ? 'selected' : ''}>${label}</option>`;

            const groupsHtml = MY_TASK_GROUPS
                .filter(([key]) => key !== 'done' || tasksFilters.showDone)
                .filter(([key]) => (groups[key] || []).length)
                .map(([key, label]) => `
                <section class="my-task-group my-task-group--${key}" aria-label="${label}">
                    <h3 class="my-task-group-title">${label}<span class="my-task-group-count">${groups[key].length}</span></h3>
                    <ul class="my-task-list">${groups[key].map(renderMyTaskItem).join('')}</ul>
                </section>`).join('');

            container.innerHTML = `
            <div class="tasks-header">
                <div class="tasks-summary">
                    <div class="tasks-summary-item"><span class="tasks-summary-value u-figure">${pending.length}</span><span class="tasks-summary-label">pending</span></div>
                    <div class="tasks-summary-item"><span class="tasks-summary-value u-figure">${formatHours(pendingWeekHours)}h</span><span class="tasks-summary-label">pending this week</span></div>
                    <div class="tasks-summary-item" title="Tasks without a date do not count toward weekly capacity"><span class="tasks-summary-value u-figure">${formatHours(unscheduledHours)}h</span><span class="tasks-summary-label">unscheduled</span></div>
                </div>
                <button type="button" class="btn btn-primary tasks-new-btn" onclick="openTaskEditor()">+ New task</button>
            </div>
            <div class="tasks-filters" role="group" aria-label="Filter tasks">
                <label>Project
                    <select onchange="setTasksFilter('project', this.value)">
                        <option value="">All</option>
                        <option value="__none__" ${tasksFilters.project === '__none__' ? 'selected' : ''}>No project</option>
                        ${projectOptions}
                    </select>
                </label>
                <label>Priority
                    <select onchange="setTasksFilter('priority', this.value)">
                        <option value="">All</option>
                        ${prioOption('critical', 'Critical')}${prioOption('high', 'High')}${prioOption('medium', 'Medium')}${prioOption('low', 'Low')}
                    </select>
                </label>
                <label class="checkbox-label">
                    <input type="checkbox" ${tasksFilters.showDone ? 'checked' : ''} onchange="setTasksFilter('showDone', this.checked)">
                    Show done
                </label>
            </div>
            ${groupsHtml || `<div class="empty-state">${all.length ? 'No tasks match these filters.' : 'Nothing assigned to you yet. Use “+ New task” to add one.'}</div>`}`;
        }

        async function toggleMyTask(source, id, done) {
            if (source === 'comment') {
                const comment = (dailyComments || []).find(c => c.id === id);
                if (!comment || comment.completed === !!done) return;
                if (await setCommentCompletion(id)) renderActiveView();
                else renderTasksView();
                return;
            }
            await toggleDayTeamTask(id, done);
        }

        async function deleteMyTask(taskId) {
            const task = (dayTasks || []).find(t => t.id === taskId);
            if (!task || !isDayTaskInvolvingMe(task)) return;
            if (!confirm(`Delete “${task.text}”? It disappears for everyone on it.`)) return;
            const { error } = await supabaseClient.from(DAY_TASKS_TABLE).delete().eq('id', taskId);
            if (error) {
                console.error(error);
                showToast(formatSupabaseError(error, 'Error deleting the task'), 'error');
                return;
            }
            await loadDayTasks();
            renderActiveView();
            showToast('Task deleted', 'success');
        }

        // ---------- Editor de tarea ----------

        function renderTaskEditorAssignees() {
            const host = document.getElementById('taskEditorAssignees');
            if (!host) return;
            const me = normalizeInitials(currentUser || '');
            host.innerHTML = withSelectedUnavailable(teamMembers.filter(m => !isExcludedResponsible(m)), taskEditorState.assignees).map(member => {
                const on = taskEditorState.assignees.includes(member);
                return `<button type="button" class="owner-picker-btn${on ? ' is-selected' : ''}" aria-pressed="${on}"${isMemberActive(member) ? '' : ' data-unavailable="true"'}
                        title="${on ? 'Remove' : 'Add'} ${escapeHtml(member)}${member === me ? ' (you)' : ''}"
                        onclick="toggleTaskEditorAssignee(${jsArg(member)})">
                        <span class="owner-picker-check" aria-hidden="true">${on ? '✓' : '+'}</span>${escapeHtml(member)}
                    </button>`;
            }).join('');
        }

        function toggleTaskEditorAssignee(member) {
            const list = taskEditorState.assignees;
            const idx = list.indexOf(member);
            if (idx === -1) list.push(member); else list.splice(idx, 1);
            renderTaskEditorAssignees();
        }

        // Hora y visibilidad solo tienen sentido con fecha.
        function onTaskEditorDateChange() {
            const hasDate = !!document.getElementById('taskEditorDate').value;
            const time = document.getElementById('taskEditorTime');
            time.disabled = !hasDate;
            if (!hasDate) time.value = '';
            document.getElementById('taskEditorVisibilityGroup').hidden = !hasDate;
            document.getElementById('taskEditorScheduleHint').textContent = hasDate
                ? 'Shows in Daily on that day and counts toward your weekly capacity.'
                : 'Without a date the task stays in Tasks only and does not count toward capacity.';
        }

        function openTaskEditor(taskId = null) {
            const task = taskId ? (dayTasks || []).find(t => t.id === taskId) : null;
            if (taskId && (!task || !isDayTaskInvolvingMe(task))) return;
            const me = normalizeInitials(currentUser || '');

            taskEditorState = {
                id: task ? task.id : null,
                assignees: task ? task.assignees.slice() : ((me && teamMembers.includes(me)) ? [me] : [])
            };

            const projectSelect = document.getElementById('taskEditorProject');
            const live = getLiveProjects().slice().sort((a, b) => a.name.localeCompare(b.name));
            const current = task && task.projectId && !live.some(p => p.id === task.projectId) ? findAnyProject(task.projectId) : null;
            projectSelect.innerHTML = '<option value="">No project</option>' +
                live.concat(current ? [current] : [])
                    .map(p => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.name)}</option>`).join('');
            projectSelect.value = task ? (task.projectId || '') : '';

            document.getElementById('taskEditorTitle').textContent = task ? 'Edit Task' : 'New Task';
            document.getElementById('taskEditorText').value = task ? task.text : '';
            document.getElementById('taskEditorDescription').value = task ? task.description : '';
            document.getElementById('taskEditorPriority').value = task ? task.priority : 'Media';
            document.getElementById('taskEditorEffort').value = task ? task.effort : '';
            document.getElementById('taskEditorHours').value = task && task.estimatedHours ? task.estimatedHours : '';
            document.getElementById('taskEditorDate').value = task ? (task.date || '') : '';
            document.getElementById('taskEditorTime').value = task ? (task.time || '') : '';
            const visibility = task ? task.visibility : 'private';
            document.querySelectorAll('input[name="taskEditorVisibility"]').forEach(r => { r.checked = r.value === visibility; });
            if (task) {
                document.getElementById('taskEditorTraining').checked = isTrainingTask(task);
            } else {
                syncTrainingCheckbox('taskEditorTraining', projectSelect.value);
            }

            renderTaskEditorAssignees();
            onTaskEditorDateChange();
            openModal('taskEditorModal', '#taskEditorText');
        }

        function closeTaskEditor() {
            closeModal('taskEditorModal');
            taskEditorState = { id: null, assignees: [] };
        }

        async function saveTaskEditor() {
            const textInput = document.getElementById('taskEditorText');
            const text = textInput.value.trim();
            if (!text) {
                showToast('Add a title for the task', 'warning');
                textInput.focus();
                return;
            }

            const date = document.getElementById('taskEditorDate').value || null;
            const time = date ? (document.getElementById('taskEditorTime').value || null) : null;
            const hours = Math.min(1000, Math.max(0, Number(document.getElementById('taskEditorHours').value) || 0));
            const assignees = sanitizeResponsiblesList(taskEditorState.assignees);
            const checkedVisibility = document.querySelector('input[name="taskEditorVisibility"]:checked');
            const existing = taskEditorState.id ? (dayTasks || []).find(t => t.id === taskEditorState.id) : null;

            // El reparto personalizado por persona se conserva solo si no han
            // cambiado ni el total ni las personas; si no, vuelve a partes iguales.
            const sameSplit = existing && existing.estimatedHours === hours &&
                existing.assignees.slice().sort().join() === assignees.slice().sort().join();

            const payload = {
                text,
                description: document.getElementById('taskEditorDescription').value.trim(),
                project_id: document.getElementById('taskEditorProject').value || null,
                priority: document.getElementById('taskEditorPriority').value || 'Media',
                effort: document.getElementById('taskEditorEffort').value || null,
                estimated_hours: hours,
                hours_by_assignee: sameSplit ? existing.hoursByAssignee : {},
                assignees,
                task_date: date,
                task_time: time,
                visibility: date && checkedVisibility ? checkedVisibility.value : 'private',
                task_type: readTaskTypeFromCheckbox('taskEditorTraining'),
                updated_at: new Date().toISOString()
            };

            const query = existing
                ? supabaseClient.from(DAY_TASKS_TABLE).update(payload).eq('id', existing.id)
                : supabaseClient.from(DAY_TASKS_TABLE).insert(Object.assign(payload, {
                    created_by: normalizeInitials(currentUser || 'US'),
                    completed: false
                }));
            const { error } = await query;

            if (error) {
                console.error(error);
                showToast(formatSupabaseError(error, 'Error saving the task'), 'error');
                return;
            }

            closeTaskEditor();
            await loadDayTasks();
            renderActiveView();
            showToast(existing ? 'Task updated' : (date ? 'Task added to Tasks and Daily' : 'Task added'), 'success');
        }

        function renderDaily() {
            // 1. Si no hay proyectos en absoluto (base de datos vacía), mostrar mensaje inicial
            if (!projects.length) {
                const filterContainer = document.getElementById('dailyRespFilter');
                if (filterContainer) filterContainer.innerHTML = '';
                document.getElementById('dailyTableContainer').innerHTML = '<div class="empty-state">Create a project to start using the daily.</div>';
                return;
            }

            updateWeekInfo();
            const weekDates = getDailyDates();
            const dailyColspan = weekDates.length + 3;
            const todayKey = formatDateKey(new Date());

            const estadosUnicos = Array.from(
                new Set(projects.map(p => p.phase || 'No phase'))
            ).filter(x => x);

            // Aplicar filtros
            const applyDailyFilters = (list) => {
                let result = list;

                if (dailyFilters.proyecto && dailyFilters.proyecto.trim()) {
                    const txt = dailyFilters.proyecto.trim().toLowerCase();
                    result = result.filter(p =>
                        (p.name || '').toLowerCase().includes(txt)
                    );
                }

                if (dailyFilters.estados && dailyFilters.estados.length > 0) {
                    result = result.filter(
                        p => dailyFilters.estados.includes(p.phase || 'No phase')
                    );
                }

                if (dailyFilters.fechaInicio) {
                    result = result.filter(p =>
                        p.startDate && p.startDate.slice(0, 10) >= dailyFilters.fechaInicio
                    );
                }

                // Filtrar por responsables si hay seleccionados
                if (dailyFilters.responsibles && dailyFilters.responsibles.length > 0) {
                    result = result.filter(p => {
                        const projectResponsibles = p.responsibles || [];
                        return dailyFilters.responsibles.some(resp => projectResponsibles.includes(resp));
                    });
                }

                return result;
            };

            const filteredProjects = applyDailyFilters(projects.filter(p => getProjectGroup(p) === dailyViewMode));

            // En Activos, los BAU solo aparecen si tienen incidencias abiertas o comentarios esta semana
            const bauProjects = projects.filter(p => getProjectGroup(p) === 'bau');
            const bauHasActivity = (p) =>
                countOpenIncidents(p.id) > 0 ||
                weekDates.some(date => getVisibleCommentsByProjectDate(p.id, formatDateKey(date)).length > 0);
            const bauActivityProjects = dailyViewMode === 'activos'
                ? applyDailyFilters(bauProjects.filter(bauHasActivity))
                : [];

            // En Activos, todos los proyectos Training en su propio grupo:
            // así el equipo ve de un vistazo quién está en formación.
            const trainingProjects = dailyViewMode === 'activos'
                ? applyDailyFilters(projects.filter(p => getProjectGroup(p) === 'training'))
                : [];

            const bauTabButton = document.getElementById('btnDailyBau');
            if (bauTabButton) {
                const bauWithIncidents = bauProjects.filter(p => countOpenIncidents(p.id) > 0).length;
                bauTabButton.innerHTML = bauWithIncidents
                    ? `BAU <span class="daily-mode-badge" title="${bauWithIncidents} open incident(s)">${bauWithIncidents}</span>`
                    : 'BAU';
            }


            // <--- CAMBIO 1: ELIMINADO EL BLOQUE QUE RETORNABA EARLY SI NO HABÍA RESULTADOS
            // (Antes aquí había un if (!filteredProjects.length) { ... return; } que borraba la tabla)

            // Obtener responsables para el filtro:
            // 1) catálogo del equipo, 2) responsables existentes en datos históricos
            const allResponsibles = Array.from(new Set([
                ...teamMembers,
                ...projects.flatMap(p => p.responsibles || [])
            ])).sort();

            const filterContainer = document.getElementById('dailyRespFilter');
            if (filterContainer) {
                if (!allResponsibles.length) {
                    filterContainer.innerHTML = '';
                } else {
                    const selectedCount = dailyFilters.responsibles.length;
                    const selectedLabel = selectedCount > 0 ? `Owners (${selectedCount})` : 'Owners: all';
                    filterContainer.innerHTML = `
                        <div class="daily-resp-filter">
                            <button type="button" class="daily-resp-trigger${selectedCount ? ' is-filtered' : ''}"
                                aria-expanded="${dailyResponsibleDropdownOpen}"
                                aria-controls="dailyResponsibleOptions"
                                onclick="toggleDailyResponsibleDropdown(event)">
                                <span>${selectedLabel}</span><span class="daily-resp-chevron" aria-hidden="true">▾</span>
                            </button>
                            <div class="daily-resp-menu" id="dailyResponsibleOptions" ${dailyResponsibleDropdownOpen ? '' : 'hidden'} onclick="event.stopPropagation()">
                                <div class="daily-resp-menu-header">
                                    <span>Filter by owner</span>
                                    ${selectedCount ? '<button type="button" class="daily-resp-clear" onclick="clearDailyResponsibleFilter(event)">Clear</button>' : ''}
                                </div>
                                ${allResponsibles.map(resp => {
                                    const checked = dailyFilters.responsibles.includes(resp) ? 'checked' : '';
                                    return `<label class="daily-resp-option"><input type="checkbox" value="${escapeHtml(resp)}" ${checked} onchange="toggleDailyResponsibleFilter(this.value)"><span>${escapeHtml(resp)}</span></label>`;
                                }).join('')}
                            </div>
                        </div>`;
                }
            }

            let html = '<table class="daily-table"><thead>';

            const modeLabels = { activos: 'active', bau: 'in BAU', completados: 'completed' };
            const tituloTabla = { activos: 'Project (active)', bau: 'Project (BAU)', completados: 'Project (completed)' }[dailyViewMode];
            html += '<tr>' +
                renderSortableHeader('name', tituloTabla, dailySort, 'toggleDailySort') +
                renderSortableHeader('status', 'Status', dailySort, 'toggleDailySort') +
                renderSortableHeader('startDate', 'Start date', dailySort, 'toggleDailySort');

            weekDates.forEach((date) => {
                const dateKey = formatDateKey(date);
                const isToday = dateKey === todayKey;
                const holidayDescription = describeTeamHolidays(dateKey);
                const isHoliday = holidayDescription.length > 0;

                const dayNameRaw = date.toLocaleDateString('en-GB', { weekday: 'long' });
                const dayName = dayNameRaw.charAt(0).toUpperCase() + dayNameRaw.slice(1);
                const dateStr = date.toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric' });

                let headerClass = 'day-header';
                if (isToday) {
                    headerClass += ' today-header';
                }
                if (isHoliday) {
                    headerClass += ' holiday-header';
                }

                const holidayTitle = isHoliday ? `Public holiday · ${holidayDescription}` : '';
                const holidayBadge = isHoliday ? `<span class="holiday-badge" title="${escapeHtml(holidayTitle)}">HOLIDAY</span>` : '';
                const dayTaskBtnClass = getDayHeaderButtonClass(dateKey);
                const dayTaskBtnTitle = escapeHtml(getDayHeaderButtonTitle(dateKey));
                const dayTaskBtn = `<button type="button" class="day-header-task-btn ${dayTaskBtnClass}" title="${dayTaskBtnTitle}" aria-label="${dayTaskBtnTitle} (${dayName} ${dateStr})" onclick="openDayPersonalTasksModal(event, '${dateKey}')">+</button>`;

                html += `<th class="${headerClass}"${isToday ? ' aria-current="date"' : ''}>${holidayBadge}${dayTaskBtn}${dayName}<br>${dateStr}</th>`;
            });

            html += '</tr>';

            // FILA DE FILTROS (Se dibuja siempre)
            html += '<tr class="filter-row">';

            html += '<th><input class="filter-input" type="text" placeholder="Filter..." aria-label="Filter by project name" ' +
                'value="' + escapeHtml(dailyFilters.proyecto) + '" ' +
                'oninput="onFilterChange(\'proyecto\', this.value)"></th>';

            {
                const selCount = dailyFilters.estados.length;
                const allSel = selCount === estadosUnicos.length && selCount > 0;
                const btnLabel = selCount === 0 ? 'All' : selCount === 1 ? dailyFilters.estados[0] : selCount + ' phases';
                const hasActive = selCount > 0 ? ' active' : '';
                let estadoHtml = `<div class="estado-filter-wrapper">
  <button type="button" class="estado-filter-btn${hasActive}" aria-haspopup="true" aria-expanded="${dailyEstadoDropdownOpen}" aria-label="Filter by phase: ${escapeHtml(btnLabel)}" onclick="event.stopPropagation();toggleDailyEstadoDropdown()">${btnLabel} <span class="estado-arrow">&#9660;</span></button>`;
                if (dailyEstadoDropdownOpen) {
                    const jsonEstados = JSON.stringify(estadosUnicos).replace(/"/g, '&quot;');
                    estadoHtml += `<div class="estado-filter-dropdown" onclick="event.stopPropagation()">
  <label class="estado-filter-option estado-filter-selectall">
    <input type="checkbox" ${allSel ? 'checked' : ''} onchange="toggleDailyEstadoAll(${jsonEstados})">
    <span>(Select all)</span>
  </label>
  <div class="estado-filter-separator"></div>`;
                    estadosUnicos.forEach(est => {
                        const chk = dailyFilters.estados.includes(est) ? 'checked' : '';
                        estadoHtml += `<label class="estado-filter-option"><input type="checkbox" ${chk} data-estado="${escapeHtml(est)}" onchange="toggleDailyEstadoFilter(this.dataset.estado)"><span>${escapeHtml(est)}</span></label>`;
                    });
                    estadoHtml += '</div>';
                }
                estadoHtml += '</div>';
                html += '<th class="filter-cell filter-cell--dropdown">' + estadoHtml + '</th>';
            }

            html += '<th><input class="filter-input" type="date" aria-label="Start date from" ' +
                'value="' + dailyFilters.fechaInicio + '" ' +
                'oninput="onFilterChange(\'fechaInicio\', this.value || \'\')"></th>'; // <--- OJO: Asegúrate de manejar el string vacío

            weekDates.forEach(date => {
                const dateKey = formatDateKey(date);
                const dayAbsences = teamVacations
                    .filter(v => dateKey >= v.start_date && dateKey <= v.end_date)
                    .filter((v, index, self) => self.findIndex(o => o.user_initials === v.user_initials) === index);

                // Medio día: "½" junto a las iniciales y el detalle en el tooltip.
                const vacationBadges = dayAbsences.map(v => isHalfDayLeave(v)
                    ? `<span class="vacation-badge vacation-badge--half" title="${escapeHtml(v.user_initials)}: ${DAY_PORTIONS[getDayPortion(v)].toLowerCase()} off">${escapeHtml(v.user_initials)}½</span>`
                    : `<span class="vacation-badge">${escapeHtml(v.user_initials)}</span>`
                ).join('');

                html += `<th class="vacation-badges-cell">${vacationBadges}</th>`;
            });

            html += `</tr>`;
            html += `</thead><tbody>`;

            const appendProjectRow = (project) => {
                    const selectedClass = (project.id === currentProjectId ? 'selected-row' : '') + (isTrainingProject(project) ? ' training-row' : '');
                    const openIncidents = getProjectGroup(project) === 'bau' ? countOpenIncidents(project.id) : 0;
                    const incidentBadge = openIncidents
                        ? ` <span class="bau-incident-badge" title="${openIncidents} open incident(s)">${openIncidents}</span>`
                        : '';
                    html += `<tr class="${selectedClass}" onclick="onRowClick('${project.id}')">
                    <td class="project-name-cell"><button type="button" class="project-name-link" title="Open project card" onclick="onProjectNameClick(event, '${project.id}')">${escapeHtml(project.name)}</button>${incidentBadge}</td>
                    <td>
                        <select class="state-select" aria-label="Phase of ${escapeHtml(project.name)}"
                                onclick="event.stopPropagation()"
                                onchange="updateProjectPhaseFromDaily(event, '${project.id}')">
                            ${renderPhaseOptions(project.phase)}
                        </select>
                    </td>
                    <td>${formatDateDisplay(project.startDate)}</td>`;

                    weekDates.forEach((date) => {
                        const dateKey = formatDateKey(date);

                        const cellComments = getVisibleCommentsByProjectDate(project.id, dateKey);
                        const topLevelComments = cellComments.filter(c => !c.parentId);
                        const replyComments = cellComments.filter(c => !!c.parentId);
                        const threadsWithReplies = new Set(replyComments.map(r => r.parentId)).size;

                        const { pendingTeam, pendingPersonal } = commentCountsForCell(topLevelComments);
                        const hasTeamPending = pendingTeam > 0;
                        const hasPersonalPending = pendingPersonal > 0;
                        const isHoliday = isHolidayForAnyTeamMember(dateKey);
                        const isToday = dateKey === todayKey;
                        // Training gana a los demás resaltados: es lo que el
                        // equipo tiene que reconocer de un vistazo.
                        const hasTraining = topLevelComments.some(isTrainingTask);
                        let highlightClass = '';
                        if (hasTraining) {
                            highlightClass = ' has-training';
                        } else if (hasTeamPending && hasPersonalPending) {
                            highlightClass = ' has-comment-mixed';
                        } else if (hasTeamPending) {
                            highlightClass = ' has-comment';
                        } else if (hasPersonalPending) {
                            highlightClass = ' has-comment-personal';
                        }
                        const baseClass = `daily-cell${highlightClass}`;
                        const holidayClass = isHoliday ? ' holiday-cell' : '';
                        const todayClass = isToday ? ' today-cell' : '';
                        const cellClass = baseClass + holidayClass + todayClass;

                        let previewText = '';
                        let metaText = '';
                        if (topLevelComments.length > 0) {
                            const latest = topLevelComments.slice().sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))[0];
                            const shortText = latest.text.length > 60 ? latest.text.slice(0, 60) + '…' : latest.text;
                            previewText = escapeHtml(shortText.replace(/\n/g, ' '));
                            const threadBadge = threadsWithReplies > 0 ? ` · <span class="cell-thread-badge">${threadsWithReplies}</span>` : '';
                            metaText = `${hasTraining ? renderTrainingBadge() + ' ' : ''}${topLevelComments.length} comment(s) · ${escapeHtml(getUrgencyLabel(latest.urgency))}${latest.hasIncident ? ' · INCIDENT' : ''}${threadBadge}`;
                        }

                        html += `<td class="${cellClass}">
                        <div class="daily-cell-content">
                            <div class="daily-cell-preview">${previewText}</div>
                            ${metaText ? `<div class="daily-cell-meta">${metaText}</div>` : ''}
                            <div class="daily-actions">
                                ${topLevelComments.length > 0 ? `<button type="button" class="daily-action-btn" title="View comments" aria-label="View comments for ${escapeHtml(project.name)} on ${dateKey}" onclick="openCommentsList(event, '${project.id}', '${dateKey}')">View</button>` : ''}
                                <button type="button" class="daily-action-btn daily-action-btn--add" title="Add comment" aria-label="Add comment to ${escapeHtml(project.name)} on ${dateKey}" onclick="openDailyCommentModalFromCell(event, '${project.id}', '${dateKey}')">+</button>
                            </div>
                        </div>
                    </td>`;
                    });

                    html += '</tr>';
            };

            // Colspan: 3 fixed columns + N day columns
            if (!filteredProjects.length) {
                html += `<tr>
                        <td colspan="${dailyColspan}" class="table-empty">
                            No ${modeLabels[dailyViewMode]} projects match the selected filters.
                        </td>
                     </tr>`;
            } else {
                sortDailyProjects(filteredProjects).forEach(appendProjectRow);
            }

            if (bauActivityProjects.length) {
                html += `<tr class="daily-group-row">
                        <td colspan="${dailyColspan}">
                            <button type="button" class="daily-group-toggle" aria-expanded="${!dailyBauGroupCollapsed}" onclick="toggleDailyBauGroup()">
                                <span class="section-toggle-icon" data-collapsed="${dailyBauGroupCollapsed}" aria-hidden="true"></span>BAU with activity (${bauActivityProjects.length})
                            </button>
                        </td>
                     </tr>`;
                if (!dailyBauGroupCollapsed) {
                    sortDailyProjects(bauActivityProjects).forEach(appendProjectRow);
                }
            }

            if (trainingProjects.length) {
                html += `<tr class="daily-group-row daily-group-row--training">
                        <td colspan="${dailyColspan}">
                            <button type="button" class="daily-group-toggle" aria-expanded="${!dailyTrainingGroupCollapsed}" onclick="toggleDailyTrainingGroup()">
                                <span class="section-toggle-icon" data-collapsed="${dailyTrainingGroupCollapsed}" aria-hidden="true"></span>Training (${trainingProjects.length})
                            </button>
                        </td>
                     </tr>`;
                if (!dailyTrainingGroupCollapsed) {
                    sortDailyProjects(trainingProjects).forEach(appendProjectRow);
                }
            }

            html += '</tbody></table>';
            document.getElementById('dailyTableContainer').innerHTML = html;
            document.removeEventListener('click', handleEstadoDropdownOutsideClick);
            if (dailyEstadoDropdownOpen) {
                setTimeout(() => document.addEventListener('click', handleEstadoDropdownOutsideClick), 0);
            }
        }


        function onRowClick(projectId) {
            currentProjectId = projectId;
            renderProjectsList();
            renderDaily();
        }

        function onProjectNameClick(event, projectId) {
            event.stopPropagation();
            goToFichaFromDaily(projectId);
        }

        function goToFichaFromDaily(projectId) {
            currentProjectId = projectId;
            renderProjectsList();
            switchView('ficha');
        }

        function onFilterChange(field, value) {
  dailyFilters[field] = value;
  
  // Guardar el elemento activo y su posición del cursor ANTES de re-renderizar
  const activeElement = document.activeElement;
  const isFilterInput = activeElement && activeElement.classList.contains('filter-input') && activeElement.type === 'text';
  let cursorPosition = 0;
  
  if (isFilterInput) {
    cursorPosition = activeElement.selectionStart;
  }
  
  // Re-renderizar
  renderDaily();
  
  // Restaurar el foco y la posición del cursor DESPUÉS de re-renderizar
  if (isFilterInput) {
    setTimeout(() => {
      const newInput = document.querySelector('.filter-input[type="text"]');
      if (newInput) {
        newInput.focus();
        newInput.setSelectionRange(cursorPosition, cursorPosition);
      }
    }, 0);
  }
}

        function toggleDailyEstadoDropdown() {
            dailyEstadoDropdownOpen = !dailyEstadoDropdownOpen;
            renderDaily();
        }

        function toggleDailyEstadoFilter(value) {
            const idx = dailyFilters.estados.indexOf(value);
            if (idx === -1) {
                dailyFilters.estados.push(value);
            } else {
                dailyFilters.estados.splice(idx, 1);
            }
            renderDaily();
        }

        function toggleDailyEstadoAll(estadosUnicos) {
            if (dailyFilters.estados.length === estadosUnicos.length) {
                dailyFilters.estados = [];
            } else {
                dailyFilters.estados = [...estadosUnicos];
            }
            renderDaily();
        }

        function toggleDailyResponsibleDropdown(event) {
            event.stopPropagation();
            dailyResponsibleDropdownOpen = !dailyResponsibleDropdownOpen;
            if (dailyResponsibleDropdownOpen) {
                document.addEventListener('click', closeDailyResponsibleDropdownOnOutsideClick);
            } else {
                document.removeEventListener('click', closeDailyResponsibleDropdownOnOutsideClick);
            }
            renderDaily();
        }

        function closeDailyResponsibleDropdownOnOutsideClick(event) {
            const filter = document.querySelector('.daily-resp-filter');
            if (filter && filter.contains(event.target)) return;
            dailyResponsibleDropdownOpen = false;
            document.removeEventListener('click', closeDailyResponsibleDropdownOnOutsideClick);
            renderDaily();
        }

        function toggleDailyResponsibleFilter(responsible) {
            const selected = dailyFilters.responsibles;
            const index = selected.indexOf(responsible);
            if (index === -1) selected.push(responsible);
            else selected.splice(index, 1);
            renderDaily();
        }

        function clearDailyResponsibleFilter(event) {
            event.stopPropagation();
            dailyFilters.responsibles = [];
            renderDaily();
        }


        async function updateProjectPhaseFromDaily(event, projectId) {
            event.stopPropagation();
            const newPhase = event.target.value;
            await updateProjectField(projectId, 'phase', newPhase);
            setDailyViewMode(getProjectGroup({ phase: newPhase }));
        }

        function toggleDailyBauGroup() {
            dailyBauGroupCollapsed = !dailyBauGroupCollapsed;
            renderDaily();
        }

        function toggleDailyTrainingGroup() {
            dailyTrainingGroupCollapsed = !dailyTrainingGroupCollapsed;
            renderDaily();
        }





        function openDailyCommentModalFromCell(event, projectId, dateKey) {
            event.stopPropagation();
            editingCommentId = null;
            openDailyCommentModal(dateKey, projectId);
        }

        // =====================================================
        // ===== TAREAS DEL DAILY: RESPONSABLES Y HORAS ========
        //
        // Una tarea puede tener varios responsables y unas horas
        // estimadas. Por defecto las horas se reparten a partes
        // iguales; "Split per person" permite un reparto explícito
        // cuando la realidad no es simétrica (lo presupuestado en 5 h
        // acabó siendo 8 para uno y 2 para el otro).
        //
        // El estado del formulario vive fuera del DOM para que los
        // pickers se puedan repintar sin perder lo ya elegido.
        // =====================================================

        let dailyTaskResponsibles = [];
        let dailyTaskHoursCustom = false;
        let dailyTaskHoursByAssignee = {};

        function renderDailyTaskResponsibles() {
            const host = document.getElementById('commentResponsibles');
            if (!host) return;

            const isPersonal = !!(document.getElementById('commentPersonal') || {}).checked;
            // Activos + los ya elegidos que ya no lo están (en gris): se
            // pueden quitar, pero no añadir.
            const options = withSelectedUnavailable(teamMembers.filter(m => !isExcludedResponsible(m)), dailyTaskResponsibles);

            if (!options.length) {
                host.innerHTML = '<p class="owner-picker-hint">No team members available.</p>';
                return;
            }

            host.innerHTML = options.map(member => {
                const on = dailyTaskResponsibles.includes(member);
                return `<button type="button"
                        class="owner-picker-btn${on ? ' is-selected' : ''}"${isMemberActive(member) ? '' : ' data-unavailable="true"'}
                        aria-pressed="${on}"
                        ${isPersonal ? 'disabled title="A personal task always belongs to you"' : `title="${on ? 'Remove' : 'Add'} ${escapeHtml(member)}"`}
                        onclick="toggleDailyTaskResponsible(${jsArg(member)})">
                        <span class="owner-picker-check" aria-hidden="true">${on ? '✓' : '+'}</span>${escapeHtml(member)}
                    </button>`;
            }).join('');

            // Espejo en el select oculto: la columna `responsible` de
            // daily_comments sigue guardando el primero de la lista.
            const mirror = document.getElementById('commentResponsible');
            if (mirror) {
                const first = dailyTaskResponsibles[0] || '';
                if (first && !Array.from(mirror.options).some(o => o.value === first)) {
                    const opt = document.createElement('option');
                    opt.value = first;
                    opt.textContent = first;
                    mirror.appendChild(opt);
                }
                mirror.value = first;
            }
        }

        function toggleDailyTaskResponsible(member) {
            const personal = document.getElementById('commentPersonal');
            if (personal && personal.checked) return;

            dailyTaskResponsibles = dailyTaskResponsibles.includes(member)
                ? dailyTaskResponsibles.filter(m => m !== member)
                : [...dailyTaskResponsibles, member];

            // Un reparto a medida deja de tener sentido si cambia quién
            // participa: se vuelve al reparto a partes iguales.
            dailyTaskHoursByAssignee = {};
            dailyTaskHoursCustom = false;

            renderDailyTaskResponsibles();
            renderDailyTaskHoursSplit();
        }

        function onDailyTaskHoursChange() {
            // Al tocar el total se recalcula el reparto desde cero.
            dailyTaskHoursByAssignee = {};
            dailyTaskHoursCustom = false;
            renderDailyTaskHoursSplit();
        }

        function getDailyTaskTotalHoursInput() {
            const input = document.getElementById('commentHours');
            const hours = Number(input && input.value);
            return Number.isFinite(hours) && hours > 0 ? Math.min(hours, 1000) : 0;
        }

        function toggleDailyTaskHoursSplit() {
            if (!dailyTaskResponsibles.length) {
                showToast('Pick who is responsible first.', 'warning');
                return;
            }
            dailyTaskHoursCustom = !dailyTaskHoursCustom;
            if (dailyTaskHoursCustom) {
                // Precargar con el reparto a partes iguales para que editar
                // sea ajustar, no empezar de cero.
                const total = getDailyTaskTotalHoursInput();
                const share = dailyTaskResponsibles.length ? total / dailyTaskResponsibles.length : 0;
                dailyTaskHoursByAssignee = {};
                dailyTaskResponsibles.forEach(u => { dailyTaskHoursByAssignee[u] = Math.round(share * 10) / 10; });
            } else {
                dailyTaskHoursByAssignee = {};
            }
            renderDailyTaskHoursSplit();
        }

        function setDailyTaskHoursFor(member, value) {
            const hours = Number(value);
            dailyTaskHoursByAssignee[member] = Number.isFinite(hours) && hours >= 0 ? Math.min(hours, 1000) : 0;
            // El total es siempre la suma del reparto, para que las dos
            // cifras no puedan contradecirse.
            const total = Object.values(dailyTaskHoursByAssignee).reduce((s, h) => s + (Number(h) || 0), 0);
            const input = document.getElementById('commentHours');
            if (input) input.value = Math.round(total * 10) / 10;
            renderDailyTaskHoursSplit();
        }

        function renderDailyTaskHoursSplit() {
            const host = document.getElementById('commentHoursSplit');
            const btn = document.getElementById('commentHoursSplitBtn');
            if (!host) return;

            if (btn) {
                btn.textContent = dailyTaskHoursCustom ? 'Split evenly' : 'Split per person';
                btn.setAttribute('aria-pressed', String(dailyTaskHoursCustom));
            }

            const total = getDailyTaskTotalHoursInput();

            if (!dailyTaskHoursCustom) {
                if (!dailyTaskResponsibles.length || total <= 0) {
                    host.innerHTML = '';
                    return;
                }
                const share = total / dailyTaskResponsibles.length;
                host.innerHTML = `<p class="hours-split-summary">${formatHours(share)}h each for ${dailyTaskResponsibles.map(escapeHtml).join(', ')}</p>`;
                return;
            }

            host.innerHTML = `<div class="hours-split-rows">${dailyTaskResponsibles.map(member => `
                <div class="hours-split-row">
                    <label class="hours-split-user" for="hoursFor_${escapeHtml(member)}">${escapeHtml(member)}</label>
                    <input type="number" id="hoursFor_${escapeHtml(member)}" min="0" max="1000" step="0.5"
                           value="${dailyTaskHoursByAssignee[member] !== undefined ? dailyTaskHoursByAssignee[member] : 0}"
                           onchange="setDailyTaskHoursFor(${jsArg(member)}, this.value)">
                    <span class="hours-split-unit">h</span>
                </div>`).join('')}</div>
                <p class="hours-split-summary">Total ${formatHours(total)}h</p>`;
        }

        // =====================================================
        // ======== DETALLE AMPLIADO DE UNA TAREA ==============
        // El panel Daily comments solo tiene sitio para el titular.
        // Al pulsar una tarea se abre centrada con todo el detalle.
        // Cerrar (fondo, Escape o "Close") NO la completa.
        // =====================================================

        let taskDetailId = null;

        function openTaskDetail(commentId) {
            const comment = (dailyComments || []).find(c => c.id === commentId);
            if (!comment) return;

            taskDetailId = commentId;
            renderTaskDetail();
            openModal('taskDetailModal');
        }

        function closeTaskDetailModal() {
            closeModal('taskDetailModal');
            taskDetailId = null;
        }

        function editTaskFromDetail() {
            const comment = (dailyComments || []).find(c => c.id === taskDetailId);
            if (!comment) return;
            closeTaskDetailModal();
            editingCommentId = comment.id;
            openDailyCommentModal(comment.date, comment.projectId);
        }

        function renderTaskDetail() {
            const comment = (dailyComments || []).find(c => c.id === taskDetailId);
            const body = document.getElementById('taskDetailBody');
            const titleEl = document.getElementById('taskDetailTitle');
            if (!body) return;

            if (!comment) {
                // La tarea puede haber desaparecido por un refresco en
                // tiempo real mientras estaba abierta.
                body.innerHTML = '<div class="empty-state empty-state--compact">This task no longer exists.</div>';
                if (titleEl) titleEl.textContent = 'Task';
                const editBtn = document.getElementById('taskDetailEditBtn');
                if (editBtn) editBtn.style.display = 'none';
                return;
            }

            const editBtn = document.getElementById('taskDetailEditBtn');
            if (editBtn) editBtn.style.display = '';

            const project = findAnyProject(comment.projectId);
            const assignees = getTaskAssignees(comment);
            const totalHours = getTaskTotalHours(comment);
            const me = normalizeInitials(currentUser || '');

            if (titleEl) titleEl.textContent = comment.completed ? 'Task · done' : 'Task';

            const replies = (dailyComments || [])
                .filter(c => c.parentId === comment.id)
                .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));

            const hoursRow = assignees.length
                ? assignees.map(u => {
                    const h = getTaskHoursForUser(comment, u);
                    return `<span class="day-task-chip${u === me ? ' is-me' : ''}"${getMemberChipAttrs(u)}>${escapeHtml(u)}${h > 0 ? ` · ${formatHours(h)}h` : ''}</span>`;
                }).join('')
                : '<span class="day-task-chip day-task-chip--none">Unassigned</span>';

            body.innerHTML = `
                <h3 class="task-detail-heading">${escapeHtml(comment.text).replace(/\n/g, '<br>')}</h3>

                <div class="task-detail-meta">
                    ${project ? `<span class="day-task-project">${escapeHtml(project.name)}</span>` : ''}
                    ${isTrainingTask(comment) ? renderTrainingBadge() : ''}
                    <span class="task-detail-date">${formatDateDisplay(comment.date)}</span>
                    ${renderPriorityBadge(getUrgencyLevel(comment.urgency), getUrgencyLabel(comment.urgency))}
                    ${comment.hasIncident ? '<span class="task-detail-incident">INCIDENT</span>' : ''}
                    ${comment.isPersonal ? '<span class="completion-badge completion-badge--private">PRIVATE</span>' : ''}
                    ${comment.completed ? '<span class="completion-badge">DONE</span>' : ''}
                </div>

                <div class="task-detail-block">
                    <div class="task-detail-label">Responsible</div>
                    <div class="day-task-meta">${hoursRow}</div>
                </div>

                <div class="task-detail-block">
                    <div class="task-detail-label">Estimated effort</div>
                    <div class="task-detail-value">${totalHours > 0 ? `${formatHours(totalHours)} h total` : 'Not estimated'}${
                        totalHours > 0 && assignees.length > 1
                            ? (Object.keys(comment.hoursByAssignee || {}).length ? ' · split per person' : ' · split evenly')
                            : ''
                    }</div>
                </div>

                <div class="task-detail-block">
                    <div class="task-detail-label">Description</div>
                    <div class="task-detail-value task-detail-description">${
                        comment.description
                            ? escapeHtml(comment.description).replace(/\n/g, '<br>')
                            : '<span class="task-detail-empty">No description. Use Edit to add context, links or blockers.</span>'
                    }</div>
                </div>

                <div class="task-detail-block">
                    <div class="task-detail-label">Created</div>
                    <div class="task-detail-value">${escapeHtml(comment.userName || 'ND')}${comment.time ? ` · ${escapeHtml(comment.time)}` : ''}</div>
                </div>

                ${replies.length ? `<div class="task-detail-block">
                    <div class="task-detail-label">${replies.length} ${replies.length === 1 ? 'reply' : 'replies'}</div>
                    <div class="task-detail-replies">${replies.map(r => `
                        <div class="reply-entry"><div class="reply-thread-line"></div><div class="reply-body">
                            <div class="reply-header"><strong>${escapeHtml(r.userName || 'ND')}</strong> · ${formatDateDisplay(r.date || comment.date)}</div>
                            <div class="reply-text">${escapeHtml(r.text).replace(/\n/g, '<br>')}</div>
                        </div></div>`).join('')}</div>
                </div>` : ''}

                <div class="task-detail-actions">
                    <label class="checkbox-label">
                        <input type="checkbox" ${comment.completed ? 'checked' : ''}
                               onchange="toggleCommentCompletionFromDetail(event, ${jsArg(comment.id)})">
                        Mark as done
                    </label>
                </div>`;
        }

        async function toggleCommentCompletionFromDetail(event, commentId) {
            if (event) event.stopPropagation();
            const comment = (dailyComments || []).find(c => c.id === commentId);
            if (!comment) return;

            const { error } = await supabaseClient
                .from('daily_comments')
                .update({ completed: !comment.completed })
                .eq('id', commentId);

            if (error) {
                console.error(error);
                showToast('Error updating the task', 'error');
                return;
            }

            comment.completed = !comment.completed;
            renderTaskDetail();
            renderActiveView();
        }
        function openDailyCommentModal(dateKey, projectIdOverride = null) {
            openModal('dailyModal', '#commentText');
            document.getElementById('dailyModalTitle').textContent = editingCommentId ? 'Edit task' : 'New task';

            syncTeamMembersInSelectors();

            const select = document.getElementById('commentProjectSelect');
            select.innerHTML = '<option value="">Select a project...</option>';
            // Solo proyectos vivos: no se crean tareas en algo archivado.
            // Al editar, el proyecto de la tarea se añade aunque ya no lo
            // esté, para no perder la referencia al guardar.
            const selectable = getLiveProjects();
            const editedComment = editingCommentId
                ? dailyComments.find(c => c.id === editingCommentId)
                : null;
            if (editedComment && !selectable.some(p => p.id === editedComment.projectId)) {
                const owner = findAnyProject(editedComment.projectId);
                if (owner) selectable.push(owner);
            }
            selectable.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                if (p.id === (projectIdOverride || currentProjectId)) opt.selected = true;
                select.appendChild(opt);
            });
            document.getElementById('dailyModal').dataset.dateKey = dateKey;

            const hoursInput = document.getElementById('commentHours');
            const descInput = document.getElementById('commentDescription');

            if (editedComment) {
                document.getElementById('commentProjectSelect').value = editedComment.projectId;
                document.getElementById('commentUrgency').value = editedComment.urgency;
                document.getElementById('commentIncident').checked = editedComment.hasIncident;
                document.getElementById('commentPersonal').checked = !!editedComment.isPersonal;
                document.getElementById('commentTraining').checked = isTrainingTask(editedComment);
                document.getElementById('commentText').value = editedComment.text;
                if (descInput) descInput.value = editedComment.description || '';

                dailyTaskResponsibles = getTaskAssignees(editedComment).slice();
                dailyTaskHoursByAssignee = Object.assign({}, editedComment.hoursByAssignee || {});
                // Si la tarea traía reparto explícito, se abre ya en modo
                // "por persona" para que se vea y se pueda ajustar.
                dailyTaskHoursCustom = Object.keys(dailyTaskHoursByAssignee).length > 0;
                if (hoursInput) hoursInput.value = editedComment.estimatedHours || '';
            } else {
                document.getElementById('commentUrgency').value = 'Normal';
                document.getElementById('commentIncident').checked = false;
                document.getElementById('commentPersonal').checked = false;
                syncTrainingCheckbox('commentTraining', select.value);
                document.getElementById('commentText').value = '';
                if (descInput) descInput.value = '';
                if (hoursInput) hoursInput.value = '';

                // Por defecto, quien crea la tarea es responsable.
                const me = normalizeInitials(currentUser || '');
                dailyTaskResponsibles = (me && teamMembers.includes(me)) ? [me] : [];
                dailyTaskHoursByAssignee = {};
                dailyTaskHoursCustom = false;
            }

            renderDailyTaskResponsibles();
            renderDailyTaskHoursSplit();
            applyPersonalTaskRuleFromUI();
        }

        // Una tarea personal es privada y solo tuya, así que no admite
        // varios responsables: la lista se fuerza a ti y se bloquea.
        function applyPersonalTaskRuleFromUI() {
            const personalCheckbox = document.getElementById('commentPersonal');
            if (!personalCheckbox) return;

            const hint = document.getElementById('commentResponsiblesHint');

            if (personalCheckbox.checked) {
                const owner = normalizeInitials(currentUser || '');
                dailyTaskResponsibles = owner ? [owner] : [];
                dailyTaskHoursByAssignee = {};
                dailyTaskHoursCustom = false;
                if (hint) hint.textContent = 'A personal task is always yours alone.';
            } else if (hint) {
                hint.textContent = 'Pick everyone working on this. Hours are split between them.';
            }

            renderDailyTaskResponsibles();
            renderDailyTaskHoursSplit();
        }

        function onPersonalTaskToggle() {
            applyPersonalTaskRuleFromUI();
        }

        function closeDailyModal() {
            closeModal('dailyModal');
            document.getElementById('commentText').value = '';
            document.getElementById('commentUrgency').value = 'Normal';
            document.getElementById('commentIncident').checked = false;
            document.getElementById('commentPersonal').checked = false;
            document.getElementById('commentTraining').checked = false;

            const desc = document.getElementById('commentDescription');
            if (desc) desc.value = '';
            const hours = document.getElementById('commentHours');
            if (hours) hours.value = '';

            dailyTaskResponsibles = [];
            dailyTaskHoursByAssignee = {};
            dailyTaskHoursCustom = false;

            editingCommentId = null;
        }


        async function saveDailyComment() {
            const projectId = document.getElementById('commentProjectSelect').value;
            const isPersonal = !!document.getElementById('commentPersonal').checked;
            const ownerInitials = normalizeInitials(currentUser || 'US');

            // Una tarea personal es siempre del creador, pase lo que pase
            // en el picker.
            const responsibles = isPersonal
                ? (ownerInitials ? [ownerInitials] : [])
                : sanitizeResponsiblesList(dailyTaskResponsibles);

            // `responsible` (texto, columna antigua) se sigue escribiendo
            // con el primero de la lista. Ver migración: hay consultas del
            // equipo que la usan.
            const responsible = responsibles[0] || '';

            // Reparto de horas. Solo se guarda el jsonb si de verdad hay
            // reparto a medida y para gente que sigue siendo responsable;
            // si no, el reparto a partes iguales se deduce del total.
            const estimatedHoursRaw = Number(document.getElementById('commentHours') && document.getElementById('commentHours').value);
            let estimatedHours = Number.isFinite(estimatedHoursRaw) && estimatedHoursRaw > 0
                ? Math.min(estimatedHoursRaw, 1000)
                : 0;

            let hoursByAssignee = {};
            if (dailyTaskHoursCustom && responsibles.length) {
                responsibles.forEach(u => {
                    const value = Number(dailyTaskHoursByAssignee[u]);
                    hoursByAssignee[u] = Number.isFinite(value) && value > 0 ? Math.min(value, 1000) : 0;
                });
                // El total pasa a ser la suma, para que nunca discrepe.
                estimatedHours = Object.values(hoursByAssignee).reduce((s, h) => s + h, 0);
                if (estimatedHours <= 0) hoursByAssignee = {};
            }

            const description = (document.getElementById('commentDescription') || {}).value || '';
            const urgency = document.getElementById('commentUrgency').value;
            const hasIncident = document.getElementById('commentIncident').checked;
            const taskType = readTaskTypeFromCheckbox('commentTraining');
            const text = document.getElementById('commentText').value.trim();
            const dateKey = document.getElementById('dailyModal').dataset.dateKey;

            // console.log('Guardando comentario...', { projectId, text, editingCommentId });

            if (!projectId || !text) {
                showToast('Please complete the required fields.', 'warning');
                return;
            }

            const now = new Date();
            const hours = String(now.getHours()).padStart(2, '0');
            const minutes = String(now.getMinutes()).padStart(2, '0');
            const timeStr = `${hours}:${minutes}`;

            const wasEditing = !!editingCommentId;
            const savedProjectId = projectId;
            const savedDateKey = dateKey;

            if (editingCommentId) {
                // console.log('Actualizando comentario existente:', editingCommentId);
                const { data, error } = await supabaseClient
                    .from('daily_comments')
                    .update({
                        project_id: projectId,
                        date: dateKey,
                        time: timeStr,
                        responsible,
                        responsibles,
                        description,
                        estimated_hours: estimatedHours,
                        hours_by_assignee: hoursByAssignee,
                        is_personal: isPersonal,
                        owner_initials: ownerInitials,
                        urgency,
                        has_incident: hasIncident,
                        task_type: taskType,
                        text
                    })
                    .eq('id', editingCommentId)
                    .select();

                // console.log('Resultado UPDATE:', { data, error });

                if (error) {
                    console.error(error);
                    showToast('Error updating comment', 'error');
                    return;
                }

                if (!data || data.length === 0) {
                    console.error('UPDATE did not affect any row');
                    showToast('The comment to update was not found', 'error');
                    return;
                }
            } else {
                // console.log('Insertando nuevo comentario');
                const newId = generateId();
                const { error } = await supabaseClient
                    .from('daily_comments')
                    .insert({
                        id: newId,
                        project_id: projectId,
                        date: dateKey,
                        time: timeStr,
                        responsible,
                        responsibles,
                        description,
                        estimated_hours: estimatedHours,
                        hours_by_assignee: hoursByAssignee,
                        is_personal: isPersonal,
                        owner_initials: ownerInitials,
                        urgency,
                        has_incident: hasIncident,
                        task_type: taskType,
                        user_name: currentUser,
                        text
                    });

                if (error) {
                    console.error(error);
                    showToast('Error saving comment', 'error');
                    return;
                }
            }

            if (urgency === 'Máxima') {
                showToast(`Comment saved with critical urgency${responsible ? ` for ${responsible}` : ''}`, 'warning');
            } else {
                showToast(wasEditing ? 'Comment updated' : 'Comment saved', 'success');
            }

            closeDailyModal();
            await loadDataFromSupabase(true);
            renderActiveView();

            if (wasEditing) {
                openCommentsList(new Event('click'), savedProjectId, savedDateKey);
            }
        }





        function openCommentsList(event, projectId, dateKey) {
            event.stopPropagation();
            commentsListContext.projectId = projectId;
            commentsListContext.dateKey = dateKey;
            renderCommentsListContent(projectId, dateKey);
            openModal('commentsListModal');
        }

        function formatDateTimeEuropeMadrid(dateInput, fallbackDateKey = '', fallbackTime = '') {
            let normalizedInput = dateInput;
            if (typeof dateInput === 'string') {
                const trimmed = dateInput.trim();
                const isoNoZonePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;
                const spacedNoZonePattern = /^\d{4}-\d{2}-\d{2}\s\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?$/;
                const hasZonePattern = /(Z|[+\-]\d{2}:\d{2})$/i;
                if (!hasZonePattern.test(trimmed)) {
                    if (isoNoZonePattern.test(trimmed)) {
                        normalizedInput = `${trimmed}Z`;
                    } else if (spacedNoZonePattern.test(trimmed)) {
                        normalizedInput = `${trimmed.replace(' ', 'T')}Z`;
                    }
                }
            }

            const dateObj = normalizedInput ? new Date(normalizedInput) : null;
            if (dateObj && !Number.isNaN(dateObj.getTime())) {
                const parts = new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'Europe/Madrid',
                    day: '2-digit',
                    month: '2-digit',
                    year: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                    hour12: false
                }).formatToParts(dateObj);

                const partValues = {};
                parts.forEach(p => {
                    if (p.type !== 'literal') partValues[p.type] = p.value;
                });

                return {
                    date: `${partValues.day}/${partValues.month}/${partValues.year}`,
                    time: `${partValues.hour}:${partValues.minute}`
                };
            }

            let fallbackDate = '';
            if (/^\d{4}-\d{2}-\d{2}$/.test(fallbackDateKey)) {
                const [yyFull, mm, dd] = fallbackDateKey.split('-');
                fallbackDate = `${dd}/${mm}/${yyFull.slice(-2)}`;
            }

            const fallbackClock = (fallbackTime || '').slice(0, 5);
            return {
                date: fallbackDate,
                time: fallbackClock
            };
        }

        function renderCommentsListContent(projectId, dateKey) {
            const allComments = getVisibleCommentsByProjectDate(projectId, dateKey);
            const topLevel = allComments
                .filter(c => !c.parentId)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

            const repliesMap = {};
            allComments
                .filter(c => c.parentId)
                .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
                .forEach(r => {
                    if (!repliesMap[r.parentId]) repliesMap[r.parentId] = [];
                    repliesMap[r.parentId].push(r);
                });

            const container = document.getElementById('commentsListContainer');
            if (topLevel.length === 0) {
                container.innerHTML = '<div class="empty-state empty-state--compact">No comments for this day.</div>';
                return;
            }

            let html = `<div class="comments-box">`;
            topLevel.forEach(c => {
                const replies = repliesMap[c.id] || [];
                const hasReplies = replies.length > 0;
                const isExpanded = expandedCommentThreads.has(c.id);
                const isReplying = activeReplyCommentId === c.id;

                const dateObj = new Date(c.date + 'T00:00:00');
                const dd = String(dateObj.getDate()).padStart(2, '0');
                const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                const yy = String(dateObj.getFullYear()).slice(-2);
                const formattedDate = `${dd}/${mm}/${yy}`;

                const completedClass = c.completed ? 'completed' : '';
                const completedBadge = c.completed ? '<span class="completion-badge">✓ COMPLETED</span>' : '';
                const personalBadge = c.isPersonal ? '<span class="completion-badge completion-badge--private">PRIVATE</span>' : '';
                const owners = getTaskAssignees(c);
                const isDetailOpen = expandedCommentDetails.has(c.id);
                const urgencyBadge = renderPriorityBadge(getUrgencyLevel(c.urgency), getUrgencyLabel(c.urgency));

                html += `<div class="comment-entry ${completedClass}${isTrainingTask(c) ? ' is-training' : ''}">
                <div class="comment-checkbox-wrapper">
                    <input type="checkbox" class="comment-checkbox"
                           ${c.completed ? 'checked' : ''}
                           aria-label="Mark as completed"
                           onclick="toggleCommentCompletion(event, '${c.id}')">
                    <div class="comment-main">
                        <div class="comment-header">${formattedDate} [${escapeHtml(c.userName || "ND")}]${completedBadge}${personalBadge}${isTrainingTask(c) ? ' ' + renderTrainingBadge() : ''}</div>
                        <div class="comment-meta">Owner: [${escapeHtml(owners.length ? owners.join(', ') : 'ND')}] ${urgencyBadge}${c.description ? ' <span class="comment-desc-hint" title="Has a description">📝</span>' : ''}</div>
                        <button type="button" class="comment-text comment-text--clickable" aria-expanded="${isDetailOpen}"
                                aria-controls="commentDetail_${c.id}" title="${isDetailOpen ? 'Hide details' : 'Show details'}"
                                onclick="toggleCommentDetail(${jsArg(c.id)})">${escapeHtml(c.text).replace(/\n/g, '<br>')}</button>
                        ${isDetailOpen ? renderCommentDetailInline(c) : ''}
                    </div>
                </div>
                <div class="comment-actions">
                    <button type="button" class="comment-action-btn comment-reply-btn" onclick="toggleReplyForm('${c.id}')">↩ Reply</button>
                    <button type="button" class="comment-action-btn" onclick="editComment('${c.id}')">✏️ Edit</button>
                    <button type="button" class="comment-action-btn comment-action-btn--danger" onclick="deleteComment('${c.id}')">🗑️ Delete</button>
                </div>`;

                if (hasReplies) {
                    html += `<div class="comment-thread-footer">
                    <button type="button" class="comment-action-btn comment-thread-btn" aria-expanded="${isExpanded}" onclick="toggleCommentThread('${c.id}')">💬 ${replies.length} ${replies.length === 1 ? 'reply' : 'replies'} ${isExpanded ? '▲' : '▼'}</button>
                </div>`;
                }

                if (isReplying) {
                    html += `<div class="reply-form">
                    <textarea class="reply-textarea" aria-label="Reply" id="replyText_${c.id}" placeholder="Write your reply..." rows="2"></textarea>
                    <div class="reply-form-actions">
                        <button type="button" class="comment-action-btn btn-reply-send" onclick="saveCommentReply('${c.id}', '${projectId}', '${dateKey}')">Send</button>
                        <button type="button" class="comment-action-btn btn-reply-send-mail" onclick="saveCommentReply('${c.id}', '${projectId}', '${dateKey}', true)">Send and email</button>
                        <button type="button" class="comment-action-btn" onclick="cancelReplyForm()">Cancel</button>
                    </div>
                </div>`;
                }

                if (isExpanded && hasReplies) {
                    html += `<div class="comment-replies">`;
                    replies.forEach(r => {
                        const rDateTime = formatDateTimeEuropeMadrid(r.createdAt, r.date || dateKey, r.time || '');
                        const rDate = rDateTime.date;
                        const rTime = rDateTime.time;
                        html += `<div class="reply-entry">
                        <div class="reply-thread-line"></div>
                        <div class="reply-body">
                            <div class="reply-header">${rDate} ${rTime} · <strong>${escapeHtml(r.userName || 'ND')}</strong></div>
                            <div class="reply-text">${escapeHtml(r.text).replace(/\n/g, '<br>')}</div>
                            <button type="button" class="comment-action-btn reply-delete-btn" title="Delete reply" aria-label="Delete reply" onclick="deleteComment('${r.id}')">🗑️</button>
                        </div>
                    </div>`;
                    });
                    html += '</div>';
                }

                html += '</div>';
            });
            html += '</div>';
            container.innerHTML = html;

            if (isReplying_focus_id) {
                setTimeout(() => {
                    const ta = document.getElementById('replyText_' + isReplying_focus_id);
                    if (ta) ta.focus();
                }, 0);
                isReplying_focus_id = null;
            }
        }

        let isReplying_focus_id = null;

        // Detalle desplegable de una tarea dentro de "Day Comments". Vive en
        // un Set (como expandedCommentThreads) para sobrevivir a los
        // re-renders del tiempo real mientras el modal está abierto.
        const expandedCommentDetails = new Set();

        function toggleCommentDetail(commentId) {
            if (expandedCommentDetails.has(commentId)) expandedCommentDetails.delete(commentId);
            else expandedCommentDetails.add(commentId);
            if (commentsListContext.projectId && commentsListContext.dateKey) {
                renderCommentsListContent(commentsListContext.projectId, commentsListContext.dateKey);
            }
        }

        function renderCommentDetailInline(comment) {
            const me = normalizeInitials(currentUser || '');
            const assignees = getTaskAssignees(comment);
            const totalHours = getTaskTotalHours(comment);
            const ownerChips = assignees.length
                ? assignees.map(u => {
                    const h = getTaskHoursForUser(comment, u);
                    return `<span class="day-task-chip${u === me ? ' is-me' : ''}"${getMemberChipAttrs(u)}>${escapeHtml(u)}${h > 0 ? ` · ${formatHours(h)}h` : ''}</span>`;
                }).join('')
                : '<span class="day-task-chip day-task-chip--none">Unassigned</span>';

            return `<div class="comment-detail" id="commentDetail_${escapeHtml(comment.id)}">
                <div class="comment-detail-grid">
                    <div class="task-detail-label">Urgency</div>
                    <div>${renderPriorityBadge(getUrgencyLevel(comment.urgency), getUrgencyLabel(comment.urgency))}${comment.hasIncident ? ' <span class="task-detail-incident">INCIDENT</span>' : ''}</div>
                    <div class="task-detail-label">Responsible</div>
                    <div class="day-task-meta">${ownerChips}</div>
                    <div class="task-detail-label">Effort</div>
                    <div class="task-detail-value">${totalHours > 0 ? `${formatHours(totalHours)} h total` : 'Not estimated'}</div>
                </div>
                <div class="task-detail-label">Description</div>
                <div class="task-detail-value task-detail-description">${
                    comment.description
                        ? escapeHtml(comment.description).replace(/\n/g, '<br>')
                        : '<span class="task-detail-empty">No description.</span>'
                }</div>
                <button type="button" class="comment-action-btn comment-detail-open" onclick="openTaskDetail(${jsArg(comment.id)})">Open full details ↗</button>
            </div>`;
        }

        function toggleCommentThread(commentId) {
            if (expandedCommentThreads.has(commentId)) {
                expandedCommentThreads.delete(commentId);
            } else {
                expandedCommentThreads.add(commentId);
            }
            const { projectId, dateKey } = commentsListContext;
            renderCommentsListContent(projectId, dateKey);
        }

        function toggleReplyForm(commentId) {
            if (activeReplyCommentId === commentId) {
                activeReplyCommentId = null;
            } else {
                activeReplyCommentId = commentId;
                expandedCommentThreads.add(commentId);
                isReplying_focus_id = commentId;
            }
            const { projectId, dateKey } = commentsListContext;
            renderCommentsListContent(projectId, dateKey);
        }

        function cancelReplyForm() {
            activeReplyCommentId = null;
            const { projectId, dateKey } = commentsListContext;
            renderCommentsListContent(projectId, dateKey);
        }

        function openCorporateEmailDraft(to, subject, body) {
            const recipient = (to || '').trim();
            if (!recipient) return false;
            const mailto = `mailto:${encodeURIComponent(recipient)}?subject=${encodeURIComponent(subject || '')}&body=${encodeURIComponent(body || '')}`;
            window.location.href = mailto;
            return true;
        }

        function notifyCommentAuthorByEmail(parentComment, replyText, projectId, dateKey) {
            if (!parentComment) {
                showToast('Could not identify the original comment to send the email.', 'error');
                return;
            }

            const authorInitials = normalizeInitials(parentComment.userName || parentComment.responsible || '');
            const recipientEmail = getUserEmailByInitials(authorInitials);

            if (!recipientEmail) {
                showToast(`No email configured for ${authorInitials || 'the original author'}.`, 'warning');
                return;
            }

            const parentText = (parentComment.text || '').trim();
            const subject = '[Project Manager] New reply to comment';
            const body = [
                'Original comment:',
                parentText || '(no text)',
                '',
                'Reply:',
                replyText
            ].join('\n');

            const opened = openCorporateEmailDraft(recipientEmail, subject, body);
            if (!opened) {
                showToast('Could not open the email client.', 'error');
            }
        }

        // Inserta una respuesta a un comentario (lógica compartida Daily/Ficha)
        async function submitCommentReply(textareaId, parentId, projectId, dateKey, notifyByEmail) {
            const ta = document.getElementById(textareaId);
            if (!ta) return false;
            const text = ta.value.trim();
            if (!text) {
                ta.focus();
                return false;
            }
            const parentComment = dailyComments.find(c => c.id === parentId) || null;
            if (!canCurrentUserViewComment(parentComment)) {
                showToast('You do not have permission to reply to this comment.', 'warning');
                return false;
            }

            const now = new Date();
            const timeStr = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');

            const { error } = await supabaseClient
                .from('daily_comments')
                .insert({
                    id: generateId(),
                    project_id: projectId,
                    date: dateKey,
                    time: timeStr,
                    responsible: currentUser,
                    urgency: 'Normal',
                    has_incident: false,
                    user_name: currentUser,
                    text,
                    parent_id: parentId,
                    is_personal: !!(parentComment && parentComment.isPersonal),
                    owner_initials: parentComment ? getCommentOwnerInitials(parentComment) : normalizeInitials(currentUser || 'US')
                });

            if (error) {
                console.error(error);
                showToast('Error saving the reply', 'error');
                return false;
            }

            if (notifyByEmail) {
                notifyCommentAuthorByEmail(parentComment, text, projectId, dateKey);
            }

            activeReplyCommentId = null;
            expandedCommentThreads.add(parentId);
            await loadDataFromSupabase(true);
            showToast('Reply saved', 'success');
            return true;
        }

        async function saveCommentReply(parentId, projectId, dateKey, notifyByEmail = false) {
            const saved = await submitCommentReply('replyText_' + parentId, parentId, projectId, dateKey, notifyByEmail);
            if (!saved) return;
            renderCommentsListContent(projectId, dateKey);
            renderActiveView();
        }

        function toggleCommentThreadFromFicha(commentId) {
            if (expandedCommentThreads.has(commentId)) {
                expandedCommentThreads.delete(commentId);
            } else {
                expandedCommentThreads.add(commentId);
            }
            renderFicha();
        }

        function toggleReplyFormFromFicha(commentId) {
            if (activeReplyCommentId === commentId) {
                activeReplyCommentId = null;
                renderFicha();
                return;
            }

            activeReplyCommentId = commentId;
            expandedCommentThreads.add(commentId);
            renderFicha();
            setTimeout(() => {
                const ta = document.getElementById('replyTextFicha_' + commentId);
                if (ta) ta.focus();
            }, 0);
        }

        function cancelReplyFormFromFicha() {
            activeReplyCommentId = null;
            renderFicha();
        }

        async function saveCommentReplyFromFicha(parentId, projectId, dateKey, notifyByEmail = false) {
            const saved = await submitCommentReply('replyTextFicha_' + parentId, parentId, projectId, dateKey, notifyByEmail);
            if (saved) renderFicha();
        }



        // Cambia el estado completado de un comentario (lógica compartida Daily/Ficha)
        async function setCommentCompletion(commentId) {
            const comment = dailyComments.find(c => c.id === commentId);
            if (!comment) return false;
            if (!canCurrentUserManageComment(comment)) {
                showToast('You do not have permission to modify this comment.', 'warning');
                return false;
            }

            const newCompletedState = !comment.completed;
            const { error } = await supabaseClient
                .from('daily_comments')
                .update({ completed: newCompletedState })
                .eq('id', commentId);

            if (error) {
                console.error(error);
                showToast('Error updating the comment status', 'error');
                return false;
            }

            comment.completed = newCompletedState;
            return true;
        }

        async function toggleCommentCompletion(event, commentId) {
            event.stopPropagation();
            if (!(await setCommentCompletion(commentId))) return;
            const { projectId, dateKey } = commentsListContext;
            if (projectId && dateKey) {
                renderCommentsListContent(projectId, dateKey);
            }
            renderActiveView();
        }

        async function toggleCommentCompletionFromFicha(event, commentId) {
            event.stopPropagation();
            if (!(await setCommentCompletion(commentId))) return;
            renderFicha();
        }

        // ===================================================

        function closeCommentsListModal() {
            closeModal('commentsListModal');
            activeReplyCommentId = null;
            expandedCommentThreads.clear();
        }

        function openAddCommentFromList() {
            const { projectId, dateKey } = commentsListContext;
            editingCommentId = null;
            closeCommentsListModal();
            openDailyCommentModal(dateKey, projectId);
        }

        function editComment(commentId) {
            // console.log('Editando comentario:', commentId);
            editingCommentId = commentId;
            const comment = dailyComments.find(c => c.id === commentId);
            if (!comment) {
                console.error('Comentario no encontrado:', commentId);
                return;
            }
            if (!canCurrentUserManageComment(comment)) {
                showToast('You do not have permission to edit this comment.', 'warning');
                return;
            }
            // console.log('Comentario encontrado:', comment);
            closeCommentsListModal();
            openDailyCommentModal(comment.date, comment.projectId);
        }


        async function deleteComment(commentId) {
            const comment = dailyComments.find(c => c.id === commentId);
            if (comment && !canCurrentUserManageComment(comment)) {
                showToast('You do not have permission to delete this comment.', 'warning');
                return;
            }

            const isReply = !!(comment && comment.parentId);
            const confirmed = confirm(isReply ? 'Delete this reply?' : 'Are you sure you want to delete this comment?');
            if (!confirmed) return;

            const { projectId, dateKey } = commentsListContext;

            const { error } = await supabaseClient
                .from('daily_comments')
                .delete()
                .eq('id', commentId);

            if (error) {
                console.error(error);
                showToast('Error deleting comment', 'error');
                return;
            }

            await loadDataFromSupabase(true);
            renderActiveView();
            showToast('Comment deleted', 'success');

            if (projectId && dateKey) {
                openCommentsList(new Event('click'), projectId, dateKey);
            }
        }



        async function updateProjectField(projectId, field, value) {
            const project = projects.find(p => p.id === projectId);
            if (!project) return;

            let update = {};
            switch (field) {
                case 'name':
                    update.name = value;
                    project.name = value;
                    renderProjectsList();
                    break;
                case 'startDate':
                    update.start_date = value || null;
                    project.startDate = value || null;
                    break;
                case 'endDate':
                    update.end_date = value || null;
                    project.endDate = value || null;
                    break;
                case 'phase': {
                    // Entrar o salir de Training cambia qué campos tiene la
                    // ficha (sin savings, BAU owner ni prerrequisitos).
                    const trainingChanged = (value === TRAINING_PHASE) !== isTrainingProject(project);
                    update.phase = value;
                    project.phase = value;
                    renderProjectsList();
                    if (trainingChanged && currentView === 'ficha' && currentProjectId === projectId) renderFicha();
                    break;
                }
                case 'bauOwner':
                    update.bau_owner = value || null;
                    project.bauOwner = value || '';
                    break;

                // volume (€) ya no se edita: los savings son en horas al año.
                // La columna se conserva con los valores antiguos.
                case 'savingsHours': {
                    const hours = parseSavingsHours(value);
                    update.savings_hours = hours;
                    project.savingsHours = hours;
                    break;
                }
                case 'stakeholders':
                    update.stakeholders = value;
                    project.stakeholders = value;
                    break;
                case 'description':
                    update.description = value;
                    project.description = value;
                    break;
                case 'country':
                    update.country = value;
                    project.country = value;
                    break;
                case 'benefits':
                    update.benefits = value;
                    project.benefits = value;
                    break;
                case 'progress':  // <--- ¡ESTO ES LO QUE FALTABA!
                    update.progress = value;
                    project.progress = value;
                    break;
                case 'prerequisites':
                    update.prerequisites = value;
                    project.prerequisites = value;
                    break;
                case 'priority':
                    update.priority = value;
                    project.priority = value;
                    break;
                case 'impact':
                    update.impact = value;
                    project.impact = value;
                    break;
                case 'status':
                    update.status = value;
                    project.status = value;
                    break;
                case 'fte':
                    const fteVal = parseFloat(value) || 0;
                    update.fte = fteVal;   // <--- ESTO ES CRUCIAL (minúsculas)
                    project.fte = fteVal;  // Actualización local (lo que ves en consola)
                    break;
                // Ahorro real medido (real_fte). Vacío = aún sin medir (null).
                case 'realFte': {
                    const realFte = parseOptionalNonNegative(value);
                    update.real_fte = realFte;
                    project.realFte = realFte;
                    break;
                }
                case 'responsibles':
                    const cleanedResponsibles = sanitizeResponsiblesList(value);
                    update.responsibles = cleanedResponsibles;
                    project.responsibles = cleanedResponsibles;
                    break;


            }



            // Actualización optimista en UI (ya hecha arriba en 'project')

            // Enviar a Supabase
            const { error } = await supabaseClient
                .from('projects')
                .update(update)
                .eq('id', projectId);

            if (error) {
                console.error('Error updating project field:', error);
                showToast('Error saving the field ' + field, 'error');
            } else {
                showToast('Changes saved', 'success', { key: 'autosave', duration: 1500 });
            }
        }


        async function updateProjectProgress(projectId, value) {
    let progress = parseInt(value);
    if (isNaN(progress)) progress = 0;
    if (progress < 0) progress = 0;
    if (progress > 100) progress = 100;

    // Save the progress
    await updateProjectField(projectId, 'progress', progress);

    // Business rule: reaching 100% automatically marks the project as Completed.
    const project = projects.find(p => p.id === projectId);
    if (progress === 100 && project && project.phase !== 'Completed' && project.phase !== 'Cancelled') {
        project.phase = 'Completed';
        await updateProjectField(projectId, 'phase', 'Completed');
        renderProjectsList();
        showToast('Progress reached 100% — project marked as Completed.', 'success');
    }

    // Refresh the view
    renderFicha();
}

function handleProgressWheel(event, projectId, currentValue) {
    event.preventDefault();

    const delta = event.deltaY < 0 ? 5 : -5; // sube/baja de 5 en 5
    let value = parseInt(currentValue, 10);
    if (isNaN(value)) value = 0;

    let newValue = value + delta;
    if (newValue < 0) newValue = 0;
    if (newValue > 100) newValue = 100;

    const input = document.getElementById(`progressInput${projectId}`);
    if (input) {
        input.value = newValue;
    }

    updateProjectProgress(projectId, newValue);
}


// =====================================================
// ================= CAPACIDAD SEMANAL =================
// (capacidad por semana y miembro del equipo)
// =====================================================

let capacityWeekStart = getMonday(new Date());
let weeklyTasksWeekStart = getMonday(new Date());
let projectCapacities = [];

async function loadCapacities() {
    const { data, error } = await supabaseClient
        .from('project_capacities')
        .select('*');

    if (error) {
        console.error(error);
        return;
    }

    projectCapacities = (data || []).map(c => ({
        id: c.id,
        projectId: c.project_id,
        userInitials: c.user_initials,
        weekStart: c.week_start,
        capacityPercent: c.capacity_percent || 0
    }));
}

// =====================================================
// ============ WIDGET DE CAPACIDAD SEMANAL ============
//
// Ya no son casillas de % a mano. Ahora sale de computeWeekCapacity(),
// que suma las horas de TODAS las tareas de la semana de cada persona
// en TODOS los proyectos. Así, estando en la ficha de un proyecto, se
// ve si a quien le quieres dar una tarea le queda hueco en la semana
// o lo tiene lleno con otras cosas.
//
// Cada fila muestra dos cosas distintas a propósito:
//   - la carga TOTAL de la persona (todos los proyectos), que es lo
//     que decide si puede con más trabajo;
//   - cuánto de esa carga es de ESTE proyecto, para situarla.
// =====================================================

// Fila cuyo override se está editando: { user, weekKey, scope } o null.
let capacityOverrideEditing = null;

// El mismo widget se pinta en dos sitios. Cada uno navega su propia
// semana (moverse en el dashboard no mueve la ficha) y tiene sus
// propios ids, porque la ficha sigue en el DOM, oculta, al cambiar de
// vista y dos inputs con el mismo id se pisarían.
//   project   -> ficha, con el detalle "Xh here" del proyecto abierto
//   dashboard -> al final del dashboard, con el desglose por proyectos
let dashboardCapacityWeekStart = getMonday(new Date());

const CAPACITY_WIDGET_SCOPES = {
    project: {
        widgetId: 'capacityWidget',
        inputId: 'capacityOverrideInput',
        getWeekStart: () => capacityWeekStart
    },
    dashboard: {
        widgetId: 'dashboardCapacityWidget',
        inputId: 'dashboardCapacityOverrideInput',
        getWeekStart: () => dashboardCapacityWeekStart
    }
};

function getCapacityScope(scope) {
    return CAPACITY_WIDGET_SCOPES[scope] ? scope : 'project';
}

function renderCapacityWidget() {
    if (!currentProjectId) return '';
    return buildCapacityWidgetHtml('project');
}

function renderDashboardCapacityWidget() {
    return buildCapacityWidgetHtml('dashboard');
}

// "4h Claims · 2h Payroll · 1h no project": de qué proyectos sale la
// carga de una persona. Solo para el dashboard, donde no hay "aquí".
function describeCapacityByProject(byProject) {
    return Object.entries(byProject || {})
        .filter(([, hours]) => hours > 0)
        .sort((a, b) => b[1] - a[1])
        .map(([projectId, hours]) => {
            const project = projectId === '__none__' ? null : findAnyProject(projectId);
            const name = project ? project.name : (projectId === '__none__' ? 'no project' : 'unknown project');
            return `${formatHours(hours)}h ${escapeHtml(name)}`;
        });
}

function buildCapacityWidgetHtml(scope) {
    scope = getCapacityScope(scope);
    const config = CAPACITY_WIDGET_SCOPES[scope];
    const projectId = scope === 'project' ? currentProjectId : null;
    const prevFn = scope === 'project' ? 'previousCapacityWeek()' : 'previousDashboardCapacityWeek()';
    const nextFn = scope === 'project' ? 'nextCapacityWeek()' : 'nextDashboardCapacityWeek()';

    const weekStart = new Date(config.getWeekStart());
    const weekKey = formatDateKey(weekStart);
    const capacity = computeWeekCapacity(weekKey);

    const formatWeek = (date) => {
        const start = new Date(date);
        const end = new Date(date);
        end.setDate(end.getDate() + 4);
        return `${start.getDate()}/${start.getMonth() + 1} - ${end.getDate()}/${end.getMonth() + 1}`;
    };

    const isCurrentWeek = weekKey === formatDateKey(getMonday(new Date()));

    // Orden: el equipo en su orden habitual, y al final quien ya no
    // está en el directorio pero aún arrastra horas de tareas viejas.
    const rows = teamMembers
        .map(u => capacity[u])
        .filter(Boolean)
        .concat(Object.values(capacity).filter(e => e.formerMember));

    const teamAllocated = rows.reduce((sum, e) => sum + e.effectiveHours, 0);
    const teamBaseline = rows.reduce((sum, e) => sum + e.baselineHours, 0);
    const teamPercent = teamBaseline > 0 ? Math.round((teamAllocated / teamBaseline) * 100) : 0;

    let html = `<div class='widget-box capacity-widget${scope === 'dashboard' ? ' capacity-widget--dashboard' : ''}' id='${config.widgetId}'>
        <div class='widget-header'>
            <div class="widget-title">${scope === 'dashboard' ? 'Team Weekly Allocation' : 'Weekly Capacity'}</div>
            <span class="capacity-widget-hint" title="Hours come from the estimated effort on every task assigned to each person that week, across all projects.">all projects</span>
        </div>

        <div class="capacity-week-nav widget-week-nav">
            <button type="button" class="widget-nav-btn" onclick="${prevFn}" aria-label="Previous week">◀</button>
            <div class="capacity-week-info">${formatWeek(weekStart)}${isCurrentWeek ? ' <span class="week-current-badge">CURRENT</span>' : ''}</div>
            <button type="button" class="widget-nav-btn" onclick="${nextFn}" aria-label="Next week">▶</button>
        </div>

        <div class="capacity-rows">`;

    rows.forEach(entry => {
        const thisProjectHours = projectId ? (entry.byProject[projectId] || 0) : 0;
        const loadClass = capacityLoadClass(entry.percent);
        const barWidth = Math.min(100, entry.percent);
        const isEditing = capacityOverrideEditing
            && capacityOverrideEditing.scope === scope
            && capacityOverrideEditing.user === entry.user
            && capacityOverrideEditing.weekKey === weekKey;

        // Detalle secundario: de qué se compone la carga.
        const details = [];
        if (thisProjectHours > 0) details.push(`${formatHours(thisProjectHours)}h here`);
        if (!projectId && entry.overrideHours === null) details.push(...describeCapacityByProject(entry.byProject));
        if (entry.pendingHours > 0 && entry.overrideHours === null) details.push(`${formatHours(entry.pendingHours)}h pending`);
        if (entry.overrideHours !== null) details.push(`manual${entry.note ? `: ${escapeHtml(entry.note)}` : ''}`);
        if (!details.length) details.push(entry.taskCount ? 'no hours estimated' : 'nothing assigned');
        // Por qué la base es menor que la jornada: sin decir el motivo de
        // la ausencia (eso solo lo ve el titular en Team).
        const offParts = [];
        if (entry.daysOff && entry.daysOff.holidays) offParts.push(`${entry.daysOff.holidays} holiday${entry.daysOff.holidays === 1 ? '' : 's'}`);
        if (entry.daysOff && entry.daysOff.absences) offParts.push(`${entry.daysOff.absences} day${entry.daysOff.absences === 1 ? '' : 's'} off`);
        if (offParts.length) details.push(`<span class="capacity-days-off" title="Available hours reduced from ${formatHours(entry.fullWeekHours)}h">${offParts.join(' + ')}</span>`);

        html += `<div class="capacity-row${entry.overrideHours !== null ? ' is-overridden' : ''}">
            <div class="capacity-user-icon" title="${escapeHtml(entry.user)}${entry.formerMember ? ' (no longer in the team)' : ''}">${escapeHtml(entry.user)}</div>
            <div class="capacity-row-body">
                <div class="capacity-row-top">
                    <div class="capacity-bar" role="img" aria-label="${entry.percent}% of ${formatHours(entry.baselineHours)} hours">
                        <div class="capacity-bar-fill ${loadClass}" style="width:${barWidth}%"></div>
                    </div>
                    <button type="button" class="capacity-figure ${loadClass}"
                            title="Click to set a manual value for this week"
                            onclick="startCapacityOverrideEdit(${jsArg(entry.user)}, '${scope}')">
                        <strong>${entry.percent}%</strong>
                        <span class="capacity-figure-hours">${formatHours(entry.effectiveHours)}/${formatHours(entry.baselineHours)}h</span>
                    </button>
                </div>
                <div class="capacity-row-detail">${details.join(' · ')}</div>
                ${isEditing ? `<div class="capacity-override-form">
                    <label class="visually-hidden" for="${config.inputId}">Manual hours for ${escapeHtml(entry.user)}</label>
                    <input type="number" id="${config.inputId}" min="0" max="1000" step="0.5"
                           value="${entry.overrideHours !== null ? entry.overrideHours : formatHours(entry.taskHours)}"
                           onkeydown="if(event.key==='Enter'){event.preventDefault();saveCapacityOverride(${jsArg(entry.user)}, '${scope}');}if(event.key==='Escape'){event.stopPropagation();cancelCapacityOverrideEdit('${scope}');}">
                    <span class="capacity-override-unit">h</span>
                    <button type="button" class="btn btn-primary capacity-override-save" onclick="saveCapacityOverride(${jsArg(entry.user)}, '${scope}')">Save</button>
                    ${entry.overrideHours !== null ? `<button type="button" class="comment-action-btn" onclick="clearCapacityOverride(${jsArg(entry.user)}, '${scope}')">Use calculated</button>` : ''}
                    <button type="button" class="comment-action-btn" onclick="cancelCapacityOverrideEdit('${scope}')">Cancel</button>
                </div>` : ''}
            </div>
        </div>`;
    });

    html += `</div>
        <div class="capacity-total ${capacityLoadClass(teamPercent)}">
            <span>Team</span>
            <strong>${formatHours(teamAllocated)}/${formatHours(teamBaseline)}h · ${teamPercent}%</strong>
        </div>
    </div>`;

    return html;
}

// Repinta las dos copias del widget: un override cambia los números de
// ambas, y la oculta debe estar al día cuando se vuelva a ella.
function renderAllCapacityWidgetsInPlace() {
    renderCapacityWidgetInPlace();
    renderDashboardCapacityWidgetInPlace();
}

function startCapacityOverrideEdit(user, scope = 'project') {
    scope = getCapacityScope(scope);
    const config = CAPACITY_WIDGET_SCOPES[scope];
    const weekKey = formatDateKey(config.getWeekStart());
    capacityOverrideEditing = { user: normalizeInitials(user), weekKey, scope };
    renderAllCapacityWidgetsInPlace();
    const input = document.getElementById(config.inputId);
    if (input) { input.focus(); input.select(); }
}

function cancelCapacityOverrideEdit() {
    capacityOverrideEditing = null;
    renderAllCapacityWidgetsInPlace();
}

// El override se guarda en HORAS (ver migración): es la unidad real
// del modelo, y el % depende de la jornada de cada persona.
async function saveCapacityOverride(user, scope = 'project') {
    scope = getCapacityScope(scope);
    const config = CAPACITY_WIDGET_SCOPES[scope];
    const input = document.getElementById(config.inputId);
    if (!input) return;

    const initials = normalizeInitials(user);
    const weekKey = formatDateKey(config.getWeekStart());
    let hours = Number(input.value);
    if (!Number.isFinite(hours) || hours < 0) hours = 0;
    hours = Math.min(hours, 1000);

    const { error } = await supabaseClient
        .from(CAPACITY_OVERRIDES_TABLE)
        .upsert({
            user_initials: initials,
            week_start: weekKey,
            override_hours: hours,
            created_by: normalizeInitials(currentUser || ''),
            updated_at: new Date().toISOString()
        }, { onConflict: 'user_initials,week_start' });

    if (error) {
        console.error(error);
        showToast(formatSupabaseError(error, 'Could not save the manual capacity'), 'error');
        return;
    }

    const existing = capacityOverrides.find(o => o.userInitials === initials && o.weekStart === weekKey);
    if (existing) {
        existing.overrideHours = hours;
    } else {
        capacityOverrides.push({
            userInitials: initials,
            weekStart: weekKey,
            overrideHours: hours,
            note: '',
            createdBy: normalizeInitials(currentUser || '')
        });
    }

    capacityOverrideEditing = null;
    renderAllCapacityWidgetsInPlace();
    showToast('Manual capacity saved', 'success', { key: 'autosave', duration: 1500 });
}

async function clearCapacityOverride(user, scope = 'project') {
    scope = getCapacityScope(scope);
    const initials = normalizeInitials(user);
    const weekKey = formatDateKey(CAPACITY_WIDGET_SCOPES[scope].getWeekStart());

    const { error } = await supabaseClient
        .from(CAPACITY_OVERRIDES_TABLE)
        .delete()
        .eq('user_initials', initials)
        .eq('week_start', weekKey);

    if (error) {
        console.error(error);
        showToast(formatSupabaseError(error, 'Could not clear the manual capacity'), 'error');
        return;
    }

    capacityOverrides = capacityOverrides.filter(o =>
        !(o.userInitials === initials && o.weekStart === weekKey)
    );

    capacityOverrideEditing = null;
    renderAllCapacityWidgetsInPlace();
    showToast('Back to the calculated value', 'success', { key: 'autosave', duration: 1500 });
}

        function previousCapacityWeek() {
            capacityWeekStart.setDate(capacityWeekStart.getDate() - 7);
            renderCapacityWidgetInPlace();
        }

        function nextCapacityWeek() {
            capacityWeekStart.setDate(capacityWeekStart.getDate() + 7);
            renderCapacityWidgetInPlace();
        }

        function previousDashboardCapacityWeek() {
            dashboardCapacityWeekStart.setDate(dashboardCapacityWeekStart.getDate() - 7);
            renderDashboardCapacityWidgetInPlace();
        }

        function nextDashboardCapacityWeek() {
            dashboardCapacityWeekStart.setDate(dashboardCapacityWeekStart.getDate() + 7);
            renderDashboardCapacityWidgetInPlace();
        }

        function renderDashboardCapacityWidgetInPlace() {
            replaceWidgetInPlace('dashboardCapacityWidget', renderDashboardCapacityWidget());
        }

        function replaceWidgetInPlace(id, html) {
            const existing = document.getElementById(id);
            if (!existing) return;
            const tmp = document.createElement('template');
            tmp.innerHTML = html.trim();
            const next = tmp.content.firstElementChild;
            if (next) existing.replaceWith(next);
        }

        function renderCapacityWidgetInPlace() {
            replaceWidgetInPlace('capacityWidget', renderCapacityWidget());
        }

        // =====================================================
        // ================= WEEKLY WIDGET =====================
        // =====================================================

        function previousWeeklyWeek() {
            weeklyTasksWeekStart.setDate(weeklyTasksWeekStart.getDate() - 7);
            renderWeeklyWidgetInPlace();
        }

        function nextWeeklyWeek() {
            weeklyTasksWeekStart.setDate(weeklyTasksWeekStart.getDate() + 7);
            renderWeeklyWidgetInPlace();
        }

        function renderWeeklyWidgetInPlace() {
            replaceWidgetInPlace('weeklyWidget', renderWeeklyWidget());
        }

        async function addWeeklyTask() {
            const input = document.getElementById('weeklyNewTask');
            if (!input) return;
            const text = input.value.trim();
            if (!text || !currentProjectId) return;

            const weekKey = formatDateKey(weeklyTasksWeekStart);
            const position = weeklyTasks.filter(t => t.projectId === currentProjectId && t.weekStart === weekKey).length;

            const { error } = await supabaseClient
                .from('project_weekly_tasks')
                .insert({
                    project_id: currentProjectId,
                    week_start: weekKey,
                    text: text,
                    done: false,
                    position: position,
                    created_by: currentUser || 'US'
                });

            if (error) { console.error('Error añadiendo tarea semanal:', error); showToast('Could not save change', 'error'); return; }
            await loadWeeklyTasks();
            renderWeeklyWidgetInPlace();
        }

        async function toggleWeeklyTask(id, done) {
            const { error } = await supabaseClient
                .from('project_weekly_tasks')
                .update({ done: done })
                .eq('id', id);

            if (error) { console.error(error); showToast('Could not save change', 'error'); return; }
            await loadWeeklyTasks();
            renderWeeklyWidgetInPlace();
        }

        async function deleteWeeklyTask(id) {
            if (!confirm('Delete this weekly goal?')) return;
            const { error } = await supabaseClient
                .from('project_weekly_tasks')
                .delete()
                .eq('id', id);

            if (error) { console.error(error); showToast('Could not save change', 'error'); return; }
            await loadWeeklyTasks();
            renderWeeklyWidgetInPlace();
        }

        function renderWeeklyWidget() {
            if (!currentProjectId) return '';

            const weekKey = formatDateKey(weeklyTasksWeekStart);
            const tasks = (weeklyTasks || []).filter(t => t.projectId === currentProjectId && t.weekStart === weekKey);

            const todayMonday = getMonday(new Date());
            const isCurrentWeek = weekKey === formatDateKey(todayMonday);

            const start = new Date(weeklyTasksWeekStart);
            const end = new Date(weeklyTasksWeekStart);
            end.setDate(end.getDate() + 6);
            const weekLabel = `${start.getDate()}/${start.getMonth() + 1} — ${end.getDate()}/${end.getMonth() + 1}`;

            // ISO week number
            const tmp = new Date(Date.UTC(start.getFullYear(), start.getMonth(), start.getDate()));
            const dayNum = tmp.getUTCDay() || 7;
            tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
            const weekNum = Math.ceil((((tmp - yearStart) / 86400000) + 1) / 7);

            const done = tasks.filter(t => t.done).length;
            const total = tasks.length;
            const pct = total > 0 ? Math.round(done / total * 100) : 0;

            let html = `<div class="widget-box weekly-widget" id="weeklyWidget">
        <div class="widget-header">
            <div class="widget-title">📋 Weekly</div>
            ${total > 0 ? `<span class="weekly-count-badge">${done}/${total}</span>` : ''}
        </div>
        <div class="weekly-week-nav widget-week-nav">
            <button type="button" class="widget-nav-btn" onclick="previousWeeklyWeek()" aria-label="Previous week">◀</button>
            <div class="weekly-week-info">
                <span class="weekly-week-num">Wk ${weekNum}</span>
                <span class="weekly-week-dates">${weekLabel}</span>
                ${isCurrentWeek ? '<span class="week-current-badge">Current</span>' : ''}
            </div>
            <button type="button" class="widget-nav-btn" onclick="nextWeeklyWeek()" aria-label="Next week">▶</button>
        </div>`;

            if (total > 0) {
                html += `<div class="weekly-progress-bar" role="progressbar" aria-label="Completed goals" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><div class="weekly-progress-fill" style="width:${pct}%"></div></div>`;
            }

            html += `<div class="weekly-tasks-list">`;

            if (!tasks.length) {
                html += `<div class="empty-state empty-state--compact">No goals this week. Add the first one below.</div>`;
            } else {
                tasks.forEach(task => {
                    html += `
                <div class="weekly-task-item${task.done ? ' task-done' : ''}">
                    <label class="weekly-task-check">
                        <input type="checkbox" ${task.done ? 'checked' : ''} aria-label="Completed: ${escapeHtml(task.text)}" onchange="toggleWeeklyTask('${task.id}', this.checked)">
                    </label>
                    <span class="weekly-task-text">${escapeHtml(task.text)}</span>
                    <button type="button" class="weekly-task-delete" onclick="deleteWeeklyTask('${task.id}')" title="Delete goal" aria-label="Delete goal: ${escapeHtml(task.text)}">×</button>
                </div>`;
                });
            }

            html += `</div>
        <div class="weekly-add-row">
            <input type="text" id="weeklyNewTask" class="weekly-new-task-input" placeholder="New goal..." aria-label="New weekly goal"
                onkeydown="if(event.key==='Enter') addWeeklyTask()">
            <button type="button" class="weekly-add-btn" onclick="addWeeklyTask()" title="Add goal" aria-label="Add goal">+</button>
        </div>
    </div>`;

            return html;
        }






        // 1. Función para cargar estados desde Supabase
        async function loadProjectStatuses() {
    const { data, error } = await supabaseClient
        .from('project_statuses')
        .select()
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error cargando estados:', error);
        return;
    }

    // CONVERSIÓN CORRECTA de snake_case (DB) a camelCase (App)
    projectStatuses = data.map(s => ({
        id: s.id,
        projectId: s.project_id,        // ← De project_id a projectId
        statusText: s.status_text,      // ← De status_text a statusText
        userInitials: s.user_initials,  // ← De user_initials a userInitials
        createdAt: s.created_at         // ← De created_at a createdAt
    }));
}

        async function loadProjectNotes() {
    const { data, error } = await supabaseClient
        .from('project_notes')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading notes:', formatSupabaseError(error, 'Could not load notes'));
        projectNotes = [];
        return;
    }

    projectNotes = (data || []).map(n => ({
        id: n.id,
        projectId: n.project_id,
        title: n.title || '',
        body: n.body || '',
        url: n.url || '',
        color: n.color || 'yellow',
        createdBy: n.created_by || 'US',
        createdAt: n.created_at,
        updatedAt: n.updated_at || n.created_at
    }));
}

        async function loadWeeklyTasks() {
    const { data, error } = await supabaseClient
        .from('project_weekly_tasks')
        .select('*')
        .order('position', { ascending: true });

    if (error) {
        console.error('Error loading weekly tasks:', formatSupabaseError(error, 'Could not load weekly tasks'));
        weeklyTasks = [];
        return;
    }

    weeklyTasks = (data || []).map(t => ({
        id: t.id,
        projectId: t.project_id,
        weekStart: t.week_start,
        text: t.text || '',
        done: !!t.done,
        position: t.position || 0,
        createdBy: t.created_by || 'US',
        createdAt: t.created_at
    }));
}

        async function loadIncidents() {
    const { data, error } = await supabaseClient
        .from('project_incidents')
        .select('*')
        .order('created_at', { ascending: false });

    if (error) {
        console.error('Error loading incidents:', formatSupabaseError(error, 'Could not load incidents'));
        incidents = [];
        return;
    }

    incidents = (data || []).map(i => ({
        id: i.id,
        projectId: i.project_id,
        description: i.description || '',
        resolved: !!i.resolved,
        createdBy: i.created_by || 'US',
        createdAt: i.created_at
    }));
}

        async function loadDayPersonalTasks() {
    const { data, error } = await supabaseClient
        .from(DAY_PERSONAL_TASKS_TABLE)
        .select('*')
        .order('task_date', { ascending: true })
        .order('created_at', { ascending: true });

    if (error) {
        console.error('Error loading personal tasks for the day:', formatSupabaseError(error, 'Could not load personal tasks for the day'));
        dayPersonalTasks = [];
        return;
    }

    dayPersonalTasks = (data || []).map(t => ({
        id: t.id,
        ownerInitials: normalizeInitials(t.owner_initials || ''),
        date: t.task_date,
        text: t.text || '',
        completed: !!t.completed,
        createdAt: t.created_at,
        updatedAt: t.updated_at || t.created_at
    }));
}


        // Función para pintar el widget con Historial y Scroll
function renderLastStatusWidget() {
    if (!currentProjectId) return '';

    const allStatuses = (projectStatuses || [])
        .filter(s => s.projectId === currentProjectId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));  // ← CORREGIDO

    const last = allStatuses[0];
    const older = allStatuses.slice(1);

    let html = `
    <div class="widget-box last-status-widget">
        <div class="widget-header">
            <div class="widget-title">Latest Update</div>
        </div>
        
        <div id="status-display-area">`;

    if (last) {
    const d = new Date(last.createdAt);
    const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
    
    html += `
    <div class="current-status-highlight">
        <div class="status-meta status-meta--current">
            ${dateStr} - ${escapeHtml(last.userInitials)}
        </div>
        <div class="status-content">${escapeHtml(last.statusText)}</div>
    </div>`;
    } else {
        html += `<div class="empty-state empty-state--compact">No updates recorded yet.</div>`;
    }

    if (older.length > 0) {
        html += `
        <div class="status-history-title">Previous history</div>
        <div class="status-history-container">`;
        
        older.forEach(s => {
            const d = new Date(s.createdAt);  // ← CORREGIDO
            const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
            
            html += `
            <div class="history-item">
                <div class="status-meta">
                    <span>${dateStr}</span>
                    <span>${escapeHtml(s.userInitials)}</span>
                </div>
                <div class="history-text">${escapeHtml(s.statusText)}</div>
            </div>`;
        });
        
        html += `</div>`;
    }

    html += `</div>`;

    html += `
        <div class="status-input-area">
            <textarea id="newStatusTextWidget" placeholder="Write an update..." aria-label="New status update"></textarea>
            <button type="button" class="btn-save-status" onclick="saveProjectStatus()">Post</button>
        </div>
    </div>`;

    return html;
}




        // 3. Función para guardar
        async function saveProjectStatus() {
    // Buscar el textarea con el ID correcto
    const textarea = document.getElementById('newStatusTextWidget');
    const text = textarea ? textarea.value.trim() : '';
    
    if (!text) {
        showToast('Please write something', 'warning');
        return;
    }

    const newStatus = {
        id: generateId(),
        project_id: currentProjectId,
        status_text: text,
        user_initials: currentUser || 'US',
        created_at: new Date().toISOString()
    };

    const { error } = await supabaseClient
        .from('project_statuses')
        .insert(newStatus);
        
    if (error) {
        console.error(error);
        showToast('Error saving', 'error');
        return;
    }

    projectStatuses.unshift({
        id: newStatus.id,
        projectId: newStatus.project_id,
        statusText: newStatus.status_text,
        userInitials: newStatus.user_initials,
        createdAt: newStatus.created_at
    });

    if (textarea) textarea.value = '';
    renderFicha();
    showToast('Update posted', 'success');
}

        function openProjectNoteEditor(noteId = null) {
    projectNoteEditorState.isOpen = true;
    projectNoteEditorState.editNoteId = noteId;
    renderFicha();
    setTimeout(() => {
        const titleInput = document.getElementById('projectNoteTitle');
        if (titleInput) titleInput.focus();
    }, 0);
}

        function closeProjectNoteEditor() {
    projectNoteEditorState.isOpen = false;
    projectNoteEditorState.editNoteId = null;
    renderFicha();
}

        function getProjectNotesByCurrentProject() {
    return (projectNotes || [])
        .filter(n => n.projectId === currentProjectId)
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

        async function saveProjectNote() {
    if (!currentProjectId) return;

    const titleEl = document.getElementById('projectNoteTitle');
    const bodyEl = document.getElementById('projectNoteBody');
    const urlEl = document.getElementById('projectNoteUrl');
    const colorEl = document.getElementById('projectNoteColor');

    const title = titleEl ? titleEl.value.trim() : '';
    const body = bodyEl ? bodyEl.value.trim() : '';
    const rawUrl = urlEl ? urlEl.value.trim() : '';
    const color = colorEl ? colorEl.value : 'yellow';

    if (!title && !body && !rawUrl) {
        showToast('Add at least a title, content or URL.', 'warning');
        return;
    }

    const normalizedUrl = normalizeDocumentationUrl(rawUrl);
    if (normalizedUrl === null) {
        showToast('Invalid URL. Use a valid http(s) URL.', 'error');
        return;
    }

    const nowIso = new Date().toISOString();
    const editId = projectNoteEditorState.editNoteId;

    if (editId) {
        const payload = {
            title,
            body,
            url: normalizedUrl || null,
            color,
            updated_at: nowIso
        };

        const { error } = await supabaseClient
            .from('project_notes')
            .update(payload)
            .eq('id', editId);

        if (error) {
            const details = formatSupabaseError(error, 'Could not update the note');
            console.error('Error updating note:', details);
            showToast('Error updating note: ' + details, 'error');
            return;
        }
    } else {
        const payload = {
            id: generateId(),
            project_id: currentProjectId,
            title,
            body,
            url: normalizedUrl || null,
            color,
            created_by: currentUser || 'US',
            created_at: nowIso,
            updated_at: nowIso
        };

        const { error } = await supabaseClient
            .from('project_notes')
            .insert(payload);

        if (error) {
            const details = formatSupabaseError(error, 'Could not save the note');
            console.error('Error saving note:', details);
            showToast('Error saving note: ' + details, 'error');
            return;
        }
    }

    projectNoteEditorState.isOpen = false;
    projectNoteEditorState.editNoteId = null;
    await loadProjectNotes();
    renderFicha();
    showToast(editId ? 'Note updated' : 'Note saved', 'success');
}

        async function deleteProjectNote(noteId) {
    const confirmDelete = confirm('Delete this note?');
    if (!confirmDelete) return;

    const { error } = await supabaseClient
        .from('project_notes')
        .delete()
        .eq('id', noteId);

    if (error) {
        const details = formatSupabaseError(error, 'Could not delete the note');
        console.error('Error deleting note:', details);
        showToast('Error deleting note: ' + details, 'error');
        return;
    }

    if (projectNoteEditorState.editNoteId === noteId) {
        projectNoteEditorState.editNoteId = null;
        projectNoteEditorState.isOpen = false;
    }

    await loadProjectNotes();
    renderFicha();
    showToast('Note deleted', 'success');
}

        function renderProjectNotesWidget() {
    if (!currentProjectId) return '';

    const notes = getProjectNotesByCurrentProject();
    const editingNote = projectNoteEditorState.editNoteId
        ? notes.find(n => n.id === projectNoteEditorState.editNoteId)
        : null;

    const noteTitle = editingNote ? editingNote.title : '';
    const noteBody = editingNote ? editingNote.body : '';
    const noteUrl = editingNote ? editingNote.url : '';
    const noteColor = editingNote ? (editingNote.color || 'yellow') : 'yellow';

    let html = `<div class="widget-box project-notes-widget">
        <div class="widget-header notes-widget-header">
            <div class="widget-title">Project Notes</div>
            <button type="button" class="notes-add-btn" onclick="openProjectNoteEditor()" title="New note" aria-label="New note">+</button>
        </div>`;

    if (projectNoteEditorState.isOpen) {
        html += `
        <div class="project-note-editor">
            <input id="projectNoteTitle" type="text" maxlength="120" placeholder="Short title" aria-label="Note title" value="${escapeHtml(noteTitle)}">
            <textarea id="projectNoteBody" placeholder="General info, context, links, to-dos..." aria-label="Note content">${escapeHtml(noteBody)}</textarea>
            <input id="projectNoteUrl" type="url" inputmode="url" autocomplete="off" placeholder="https://... (optional)" aria-label="Note link" value="${escapeHtml(noteUrl)}">
            <div class="project-note-editor-row">
                <select id="projectNoteColor" aria-label="Note color">
                    <option value="yellow" ${noteColor === 'yellow' ? 'selected' : ''}>Yellow</option>
                    <option value="mint" ${noteColor === 'mint' ? 'selected' : ''}>Mint</option>
                    <option value="salmon" ${noteColor === 'salmon' ? 'selected' : ''}>Salmon</option>
                    <option value="sky" ${noteColor === 'sky' ? 'selected' : ''}>Sky</option>
                </select>
                <button type="button" class="btn-save-note" onclick="saveProjectNote()">Save</button>
                <button type="button" class="btn-cancel-note" onclick="closeProjectNoteEditor()">Cancel</button>
            </div>
        </div>`;
    }

    if (!notes.length) {
        html += `<div class="empty-state empty-state--compact">No notes yet. Press + to create the first one.</div>`;
        html += `</div>`;
        return html;
    }

    html += `<div class="project-notes-list">`;

    notes.forEach(note => {
        const updatedDate = note.updatedAt ? new Date(note.updatedAt) : null;
        const dateText = updatedDate
            ? updatedDate.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' })
            : '';

        html += `
        <article class="project-note-card note-color-${escapeHtml(note.color || 'yellow')}">
            <div class="project-note-card-header">
                <div class="project-note-title">${escapeHtml(note.title || 'Quick note')}</div>
                <div class="project-note-actions">
                    <button type="button" onclick="openProjectNoteEditor('${note.id}')" title="Edit note">Edit</button>
                    <button type="button" class="project-note-delete" onclick="deleteProjectNote('${note.id}')" title="Delete note" aria-label="Delete note">×</button>
                </div>
            </div>
            ${note.body ? `<div class="project-note-body">${escapeHtml(note.body).replace(/\n/g, '<br>')}</div>` : ''}
            ${note.url ? `<a class="project-note-link" href="${escapeHtml(note.url)}" target="_blank" rel="noopener noreferrer">Open link</a>` : ''}
            <div class="project-note-meta">${dateText}${note.createdBy ? ` | ${escapeHtml(note.createdBy)}` : ''}</div>
        </article>`;
    });

    html += `</div></div>`;
    return html;
}





        // =====================================================
        // ================= INCIDENCIAS WIDGET ================
        // =====================================================

        function renderIncidentsWidgetInPlace() {
            replaceWidgetInPlace('incidentsWidget', renderIncidentsWidget());
        }

        async function addIncident() {
            const input = document.getElementById('incidentNewText');
            if (!input) return;
            const description = input.value.trim();
            if (!description || !currentProjectId) return;

            const { error } = await supabaseClient
                .from('project_incidents')
                .insert({
                    project_id: currentProjectId,
                    description: description,
                    resolved: false,
                    created_by: currentUser || 'US'
                });

            if (error) { console.error('Error añadiendo incidencia:', error); showToast('Could not save change', 'error'); return; }
            await loadIncidents();
            renderIncidentsWidgetInPlace();
        }

        async function toggleIncident(id, resolved) {
            const { error } = await supabaseClient
                .from('project_incidents')
                .update({ resolved: resolved })
                .eq('id', id);

            if (error) { console.error(error); showToast('Could not save change', 'error'); return; }
            await loadIncidents();
            renderIncidentsWidgetInPlace();
        }

        async function deleteIncident(id) {
            if (!confirm('Delete this incident?')) return;
            const { error } = await supabaseClient
                .from('project_incidents')
                .delete()
                .eq('id', id);

            if (error) { console.error(error); showToast('Could not save change', 'error'); return; }
            await loadIncidents();
            renderIncidentsWidgetInPlace();
        }

        function renderIncidentsWidget() {
            if (!currentProjectId) return '';

            const projectIncidents = (incidents || []).filter(i => i.projectId === currentProjectId);
            const open = projectIncidents.filter(i => !i.resolved);
            const resolvedList = projectIncidents.filter(i => i.resolved);
            const all = [...open, ...resolvedList];

            let html = `<div class="widget-box incidents-widget" id="incidentsWidget">
        <div class="widget-header">
            <div class="widget-title">Incidents</div>
            ${open.length > 0 ? `<span class="incidents-open-badge">${open.length} open</span>` : ''}
        </div>
        <div class="incidents-list">`;

            if (!all.length) {
                html += `<div class="empty-state empty-state--compact">No incidents recorded.</div>`;
            } else {
                all.forEach(incident => {
                    const dateStr = new Date(incident.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit' });
                    html += `
                <div class="incident-item ${incident.resolved ? 'incident-resolved' : 'incident-open'}">
                    <label class="incident-check" title="${incident.resolved ? 'Reopen' : 'Mark resolved'}">
                        <input type="checkbox" ${incident.resolved ? 'checked' : ''} aria-label="${incident.resolved ? 'Reopen' : 'Mark resolved'}: ${escapeHtml(incident.description)}" onchange="toggleIncident('${incident.id}', this.checked)">
                    </label>
                    <div class="incident-content">
                        <span class="incident-text">${escapeHtml(incident.description)}</span>
                        <span class="incident-meta">${dateStr}${incident.createdBy ? ` &middot; ${escapeHtml(incident.createdBy)}` : ''}</span>
                    </div>
                    <button type="button" class="incident-delete" onclick="deleteIncident('${incident.id}')" title="Delete incident" aria-label="Delete incident: ${escapeHtml(incident.description)}">&times;</button>
                </div>`;
                });
            }

            html += `</div>
        <div class="weekly-add-row">
            <input type="text" id="incidentNewText" class="weekly-new-task-input" placeholder="Describe incident..." aria-label="New incident"
                onkeydown="if(event.key==='Enter') addIncident()">
            <button type="button" class="weekly-add-btn" onclick="addIncident()" title="Add incident" aria-label="Add incident">+</button>
        </div>
    </div>`;

            return html;
        }


        // =====================================================
        // ================= FICHA DE PROYECTO =================
        // (detalle, progreso, prerrequisitos, comentarios, etc.)
        // =====================================================


        // Savings en € de antes del cambio a horas: se enseñan en solo
        // lectura mientras el proyecto no tenga savings_hours, para que
        // el owner sepa qué había y lo pase a horas.
        function renderLegacyEuroSavingsHint(project) {
            const euros = Number(project && project.volume) || 0;
            if (euros <= 0 || parseSavingsHours(project.savingsHours) !== null) return '';
            return `<p class="ficha-legacy-hint">Previously recorded: ${euros.toLocaleString('en-GB')} €. Savings are now tracked in hours per year.</p>`;
        }

        // Horas registradas en un proyecto Training durante el año en curso,
        // por persona. Suma tareas de Daily y tareas de día con fecha.
        function getTrainingHoursThisYear(projectId) {
            const year = String(new Date().getFullYear());
            const byUser = {};
            const tasks = (dailyComments || []).filter(c => !c.parentId && c.projectId === projectId)
                .concat((dayTasks || []).filter(t => t.projectId === projectId));
            tasks.forEach(task => {
                if (!task.date || !String(task.date).startsWith(year)) return;
                getTaskAssignees(task).forEach(user => {
                    const hours = getTaskHoursForUser(task, user);
                    if (hours > 0) byUser[user] = (byUser[user] || 0) + hours;
                });
            });
            return byUser;
        }

        function renderTrainingFichaFields(project) {
            const byUser = getTrainingHoursThisYear(project.id);
            const users = Object.keys(byUser).sort();
            const total = users.reduce((sum, u) => sum + byUser[u], 0);
            return `<div class="ficha-field ficha-field--wide">
            <div class="ficha-label">Training hours this year</div>
            <div class="ficha-value">
                <span class="training-hours-total">${formatHours(total)} h</span>
                ${users.map(u => `<span class="day-task-chip"${getMemberChipAttrs(u)}>${escapeHtml(u)} · ${formatHours(byUser[u])}h</span>`).join('')}
                <p class="form-hint">Log each training as a task in this project, with its hours and the Training option ticked.</p>
            </div>
        </div>`;
        }

        function renderFicha() {
            if (!currentProjectId) {
                document.getElementById('fichaView').innerHTML = `<div class="empty-state">Select a project to see its details.</div>`;
                return;
            }

            // findAnyProject y no projects.find: desde la papelera o desde
            // Archivados se puede abrir la ficha para consultarla.
            const project = findAnyProject(currentProjectId);
            if (!project) {
                document.getElementById('fichaView').innerHTML = `<div class="empty-state">Project not found.</div>`;
                return;
            }

            const isTraining = isTrainingProject(project);

            // Progress
            const progressPercent = project.progress || 0;
            const RING_C = 188.5; // 2·π·30
            const ringOffset = RING_C - (RING_C * progressPercent / 100);

            // Aviso cuando la ficha no es de un proyecto vivo, para que
            // nadie edite un proyecto archivado creyendo que está activo.
            let stateBanner = '';
            if (project.deletedAt) {
                stateBanner = `<div class="ficha-state-banner ficha-state-banner--deleted" role="status">
        <span>In the bin${project.deletedBy ? ` · moved by ${escapeHtml(project.deletedBy)}` : ''}${project.deletedAt ? ` · ${formatDateDisplay(String(project.deletedAt).slice(0, 10))}` : ''}</span>
        <button type="button" class="section-action-btn" onclick="restoreProjectFromBin(${jsArg(project.id)})">Restore</button>
    </div>`;
            } else if (isProjectArchived(project)) {
                stateBanner = `<div class="ficha-state-banner" role="status">
        <span>Archived${project.archivedBy ? ` by ${escapeHtml(project.archivedBy)}` : ''}${project.archivedAt ? ` · ${formatDateDisplay(String(project.archivedAt).slice(0, 10))}` : ''}</span>
        <button type="button" class="section-action-btn" onclick="setProjectArchived(${jsArg(project.id)}, false)">Unarchive</button>
    </div>`;
            }

            // --- Main render ---
            let html = `${stateBanner}<div class="ficha-header">
    <div class="project-meta-row">
        <div class="project-title-section">
            <div class="ficha-title"><input type="text" class="ficha-title-input" value="${escapeHtml(project.name)}"
                       aria-label="Project name" title="Click to rename"
                       onchange="renameProjectInline(${jsArg(project.id)}, this)"
                       onkeydown="if(event.key==='Enter'){event.preventDefault();this.blur();}if(event.key==='Escape'){this.value=${jsArg(project.name)};this.blur();}">
                <span class="project-mini-indicators">
                    <span class="mini-indicator priority-${(project.priority || 'Media').toLowerCase()}" role="button" tabindex="0" aria-haspopup="true" aria-label="Priority: ${getPriorityLabel(project.priority)}. Click to change" onclick="toggleIndicatorDropdown(event, 'priority')" onkeydown="handleIndicatorKey(event, 'priority')">
                        <span class="mini-label">Priority:</span>
                        <span class="mini-value">${getPriorityLabel(project.priority)}</span>
                        <div class="indicator-dropdown" id="dropdown-priority">
                            <div class="indicator-option ${project.priority === 'Baja' ? 'selected' : ''}" role="button" tabindex="0" onclick="updateIndicator(event, '${project.id}', 'priority', 'Baja')" onkeydown="activateOnEnterOrSpace(event)">Low</div>
                            <div class="indicator-option ${(project.priority || 'Media') === 'Media' ? 'selected' : ''}" role="button" tabindex="0" onclick="updateIndicator(event, '${project.id}', 'priority', 'Media')" onkeydown="activateOnEnterOrSpace(event)">Medium</div>
                            <div class="indicator-option ${project.priority === 'Alta' ? 'selected' : ''}" role="button" tabindex="0" onclick="updateIndicator(event, '${project.id}', 'priority', 'Alta')" onkeydown="activateOnEnterOrSpace(event)">High</div>
                            <div class="indicator-option ${project.priority === 'Crítica' ? 'selected' : ''}" role="button" tabindex="0" onclick="updateIndicator(event, '${project.id}', 'priority', 'Crítica')" onkeydown="activateOnEnterOrSpace(event)">Critical</div>
                        </div>
                    </span>
                    <span class="mini-indicator impact-${(project.impact || 'Medio').toLowerCase()}" role="button" tabindex="0" aria-haspopup="true" aria-label="Impact: ${getImpactLabel(project.impact)}. Click to change" onclick="toggleIndicatorDropdown(event, 'impact')" onkeydown="handleIndicatorKey(event, 'impact')">
                        <span class="mini-label">Impact:</span>
                        <span class="mini-value">${getImpactLabel(project.impact)}</span>
                        <div class="indicator-dropdown" id="dropdown-impact">
                            <div class="indicator-option ${project.impact === 'Bajo' ? 'selected' : ''}" role="button" tabindex="0" onclick="updateIndicator(event, '${project.id}', 'impact', 'Bajo')" onkeydown="activateOnEnterOrSpace(event)">Low</div>
                            <div class="indicator-option ${(project.impact || 'Medio') === 'Medio' ? 'selected' : ''}" role="button" tabindex="0" onclick="updateIndicator(event, '${project.id}', 'impact', 'Medio')" onkeydown="activateOnEnterOrSpace(event)">Medium</div>
                            <div class="indicator-option ${project.impact === 'Alto' ? 'selected' : ''}" role="button" tabindex="0" onclick="updateIndicator(event, '${project.id}', 'impact', 'Alto')" onkeydown="activateOnEnterOrSpace(event)">High</div>
                        </div>
                    </span>
                    <button type="button" class="resp-btn-header" data-project-id="${project.id}" title="Add owner" aria-label="Add owner" onclick="openResponsiblesPopover('${project.id}')">+</button>
                    <div class="resp-badges-header">
                        ${project.responsibles && project.responsibles.length > 0 ? project.responsibles.map(resp => `
                            <span class="resp-badge-header"${getMemberChipAttrs(resp)}>${escapeHtml(resp)} <button type="button" onclick="removeResponsible('${project.id}', '${resp}')" class="resp-remove-header" title="Remove ${escapeHtml(resp)}" aria-label="Remove owner ${escapeHtml(resp)}">✕</button></span>
                        `).join('') : ''}
                    </div>
                </span>
            </div>
        </div>

        <div class="progress-indicator-centered"${isTraining ? ' hidden' : ''}>
            <div class="progress-ring-wrap" title="Project progress">
                <svg class="progress-ring" viewBox="0 0 72 72" width="72" height="72" aria-hidden="true">
                    <defs>
                        <linearGradient id="progressGrad" x1="0" y1="0" x2="1" y2="1">
                            <stop offset="0%" stop-color="var(--progress-grad-from)" />
                            <stop offset="100%" stop-color="var(--progress-grad-to)" />
                        </linearGradient>
                    </defs>
                    <circle class="progress-ring-bg" cx="36" cy="36" r="30" />
                    <circle class="progress-ring-progress" cx="36" cy="36" r="30"
                            style="stroke-dasharray: ${RING_C}; stroke-dashoffset: ${ringOffset};" />
                </svg>
                <div class="progress-center">
                    <div class="progress-value">
                        <input type="number"
                               class="progress-input"
                               value="${progressPercent}"
                               min="0"
                               max="100"
                               id="progressInput${project.id}"
                               aria-label="Project progress (%)"
                               onchange="updateProjectProgress('${project.id}', this.value)"
                               onwheel="handleProgressWheel(event, '${project.id}', this.value)"
                               onclick="this.select()" />
                        <span class="progress-percent" aria-hidden="true">%</span>
                    </div>
                    <span class="progress-label" aria-hidden="true">Progress</span>
                </div>
            </div>
        </div>

        <div class="status-badge-container">
            <div class="status-badge status-${getStatusCssKey(project.status)}" role="button" tabindex="0" aria-haspopup="true" aria-label="Status: ${getStatusText(project.status || 'Verde')}. Click to change" onclick="toggleIndicatorDropdown(event, 'status')" onkeydown="handleIndicatorKey(event, 'status')">
                <span class="status-icon">${getStatusIcon(project.status || 'Verde')}</span>
                <span class="status-text">${getStatusText(project.status || "Verde")}</span>
                <div class="indicator-dropdown" id="dropdown-status">
                    ${PROJECT_STATUSES.map(s => `<div class="indicator-option ${getStatusDef(project.status).value === s.value ? 'selected' : ''}" role="button" tabindex="0" onclick="updateIndicator(event, '${project.id}', 'status', ${jsArg(s.value)})" onkeydown="activateOnEnterOrSpace(event)"><span class="status-dot status-dot--${s.dot}"></span> ${s.label}</div>`).join('')}
                </div>
            </div>
        </div>
    </div>

    <textarea class="ficha-description-input" rows="1" placeholder="Add a short project description..."
        aria-label="Project description"
        onchange="updateProjectField('${project.id}','description', this.value)">${escapeHtml(project.description || '')}</textarea>

    </div>`;

            // Details card (project fields) — first cell of the bento grid.
            html += `<div class="ficha-bento">
    <section class="bento-card bento-card--details">
        <h3 class="bento-title">Details</h3>
        <div class="ficha-fields-grid">
        <div class="ficha-field">
            <div class="ficha-label">Start date</div>
            <div class="ficha-value">
                <input type="date" aria-label="Start date" value="${project.startDate || ''}" onchange="updateProjectField('${project.id}','startDate', this.value)">
            </div>
        </div>
        <div class="ficha-field">
            <div class="ficha-label">End date</div>
            <div class="ficha-value">
                <input type="date" aria-label="End date" value="${project.endDate || ''}" onchange="updateProjectField('${project.id}','endDate', this.value)">
            </div>
        </div>
        <div class="ficha-field">
            <div class="ficha-label">Phase</div>
            <div class="ficha-value">
                <select aria-label="Phase" onchange="updateProjectField('${project.id}','phase', this.value)">
                    ${renderPhaseOptions(project.phase)}
                </select>
            </div>
        </div>
        ${isTraining ? renderTrainingFichaFields(project) : `<div class="ficha-field">
            <div class="ficha-label">Savings (h/year)</div>
            <div class="ficha-value">
                <input type="number"
                       placeholder="0"
                       aria-label="Savings in hours per year"
                       step="0.5"
                       min="0"
                       value="${project.savingsHours === null || project.savingsHours === undefined ? '' : project.savingsHours}"
                       onchange="updateProjectField('${project.id}','savingsHours', this.value)">
                ${renderLegacyEuroSavingsHint(project)}
            </div>
        </div>
        <div class="ficha-field">
            <div class="ficha-label">Stakeholders</div>
            <div class="ficha-value">
                <input type="text" aria-label="Stakeholders" value="${escapeHtml(project.stakeholders || '')}" onchange="updateProjectField('${project.id}','stakeholders', this.value)">
            </div>
        </div>
        <div class="ficha-field">
            <div class="ficha-label">Country</div>
            <div class="ficha-value">
                <input type="text" aria-label="Country" value="${escapeHtml(project.country || '')}" onchange="updateProjectField('${project.id}','country', this.value)">
            </div>
        </div>
        <div class="ficha-field">
            <div class="ficha-label">Estimated savings (FTE)</div>
            <div class="ficha-value">
                <input type="number"
                       placeholder="0.0"
                       aria-label="Estimated savings in FTE"
                       step="0.1"
                       min="0"
                       value="${project.fte || ''}"
                       onchange="updateProjectField('${project.id}','fte', this.value)">
            </div>
        </div>
        <div class="ficha-field">
            <div class="ficha-label">Real savings (FTE)</div>
            <div class="ficha-value">
                <input type="number"
                       placeholder="Not measured yet"
                       aria-label="Real savings in FTE"
                       title="Savings actually measured once the solution is live"
                       step="0.1"
                       min="0"
                       value="${project.realFte === null || project.realFte === undefined ? '' : project.realFte}"
                       onchange="updateProjectField('${project.id}','realFte', this.value)">
            </div>
        </div>
        <div class="ficha-field">
            <div class="ficha-label">BAU owner</div>
            <div class="ficha-value">
                <select aria-label="BAU owner" title="Who maintains the solution once the project ends" onchange="updateProjectField('${project.id}','bauOwner', this.value)">
                    ${renderBauOwnerOptions(project.bauOwner)}
                </select>
            </div>
        </div>`}
        </div>
    </section>`;

            // Weekly Capacity sits to the right of Details (same row).
            html += renderCapacityWidget();

            // Prerequisites & Documentation: siempre se muestra, con los
            // ítems estándar a false/N/A por defecto si el proyecto aún
            // no tiene datos guardados (antes se ocultaba la sección
            // entera cuando project.prerequisites estaba vacío o ausente).
            // Un proyecto Training no es un proyecto de negocio: sin prerrequisitos.
            if (!isTraining) {

                html += `<section class="bento-card bento-card--prereq">
        <h3 class="bento-title">Prerequisites &amp; Documentation</h3>
        <div class="checkbox-group-2col">`;

                // 1. Obtenemos lo que tiene guardado el proyecto actualmente
                let currentPrereqs = project.prerequisites || [];

                // 2. Iteramos SIEMPRE sobre la lista estándar (para asegurar el orden y que salgan todos)
                STANDARD_PREREQUISITES.forEach((stdName, index) => {
                    // Buscamos si el proyecto ya tiene datos guardados para este item
                    // Si no los tiene, usamos valores por defecto (false)
                    const savedItem = currentPrereqs.find(p => p.name === stdName) || { done: false, na: false };
                    const isDone = savedItem.done;
                    const isNa = savedItem.na;
                    const url = savedItem.url;
                    const safeUrl = url ? escapeHtml(url) : '';
                    // Clases CSS condicionales
                    let labelClass = '';
                    if (isDone) labelClass = 'completed';
                    else if (isNa) labelClass = 'na-active';
                    // Si es N/A, deshabilitamos el checkbox principal
                    const mainDisabled = isNa ? 'disabled' : '';
                    html += `
        <div class="prereq-item-row${isNa ? ' is-na' : ''}${isDone ? ' is-done' : ''}">
            <div class="prereq-left">
                <input type="checkbox"
                       class="prereq-checkbox"
                       aria-label="${stdName} completed"
                       ${isDone ? 'checked' : ''}
                       ${mainDisabled}
                       onchange="togglePrereqStatus('${project.id}', '${stdName}', 'done', this.checked)">
                `;
                    if (url) {
                        html += `<a href="${safeUrl}" class="prereq-label prereq-link ${labelClass}" target="_blank" rel="noopener noreferrer"
                            onclick="event.stopPropagation();"
                            oncontextmenu="event.preventDefault(); handlePrereqClick(event, '${project.id}', '${stdName}'); return false;"
                            title="Open documentation">${stdName}</a>
                            <button type="button" class="prereq-url-btn" title="Edit documentation URL" aria-label="Edit documentation URL for ${stdName}"
                            onclick="handlePrereqClick(event, '${project.id}', '${stdName}')">✎</button>`;
                    } else {
                        html += `<button type="button" class="prereq-label prereq-add-url ${labelClass}"
                            onclick="handlePrereqClick(event, '${project.id}', '${stdName}')"
                            title="Add documentation URL">${stdName}</button>`;
                    }
                    html += `
            </div>
            <div class="prereq-na-wrapper">
                <label for="na-${index}" title="Not applicable">N/A</label>
                <input type="checkbox" 
                       id="na-${index}"
                       class="prereq-na-checkbox"
                       ${isNa ? 'checked' : ''}
                       onchange="togglePrereqStatus('${project.id}', '${stdName}', 'na', this.checked)">
            </div>
        </div>`;
                });
                html += `</div></section>`;

            }

            // Weekly (goals) + Project Notes sit side by side, below Prerequisites.
            html += renderWeeklyWidget();
            html += renderProjectNotesWidget();

            // Last Update + Incidents, below the row above.
            html += renderLastStatusWidget();
            html += renderIncidentsWidget();

            // --- Comentarios (FORMATO EXACTO DAILY, CON HILOS) ---
            const projectComments = getVisibleCommentsByProject(currentProjectId);
            const projectTopLevelComments = projectComments
                .filter(c => !c.parentId)
                .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
            const projectRepliesByParent = {};
            projectComments
                .filter(c => !!c.parentId)
                .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
                .forEach(r => {
                    if (!projectRepliesByParent[r.parentId]) projectRepliesByParent[r.parentId] = [];
                    projectRepliesByParent[r.parentId].push(r);
                });

            const fichaTodayKey = formatDateKey(new Date());
            html += `<section class="bento-card bento-card--comments">
        <div class="bento-title bento-title--row">
            <span>Daily comments (${projectComments.length})</span>
            <span class="bento-title-actions">
                <button type="button" class="section-action-btn section-action-btn--accent" onclick="openDailyCommentModalFromCell(event, '${project.id}', '${fichaTodayKey}')">+ Add comment</button>
                <button type="button" class="section-action-btn" onclick="goToDailyFromFicha()">View in Daily</button>
            </span>
        </div>`;

            if (projectTopLevelComments.length === 0) {
                html += `<div class="empty-state">No comments yet. Use “+ Add comment” or the Daily view.</div>`;
            } else {
                html += `<div class="comments-box">`;
                projectTopLevelComments.forEach(comment => {
                    const replies = projectRepliesByParent[comment.id] || [];
                    const hasReplies = replies.length > 0;
                    const isExpanded = expandedCommentThreads.has(comment.id);
                    const isReplying = activeReplyCommentId === comment.id;

                    // Formatear fecha
                    const dateObj = new Date(comment.date + 'T00:00:00');
                    const dd = String(dateObj.getDate()).padStart(2, '0');
                    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
                    const yy = String(dateObj.getFullYear()).slice(-2);
                    const formattedDate = `${dd}/${mm}/${yy}`;

                    // Responsables y horas: lo que convierte el panel en un
                    // panel de tareas y no solo de comentarios.
                    const assignees = getTaskAssignees(comment);
                    const me = normalizeInitials(currentUser || '');
                    const ownerChips = assignees.length
                        ? assignees.map(u => {
                            const h = getTaskHoursForUser(comment, u);
                            return `<span class="day-task-chip${u === me ? ' is-me' : ''}"${getMemberChipAttrs(u)}>${escapeHtml(u)}${h > 0 ? ` · ${formatHours(h)}h` : ''}</span>`;
                        }).join('')
                        : '<span class="day-task-chip day-task-chip--none">Unassigned</span>';
                    const totalHours = getTaskTotalHours(comment);
                    const hoursChip = totalHours > 0
                        ? `<span class="comment-hours-chip" title="Estimated effort">${formatHours(totalHours)}h</span>`
                        : '';
                    const descChip = comment.description
                        ? '<span class="comment-desc-chip" title="Has a description">≡</span>'
                        : '';

                    // Author initials (whoever wrote the comment); defaults to 'User'.
                    const autorName = escapeHtml(comment.userName || 'User');
                    const iniciales = escapeHtml((comment.userName || 'User').substring(0, 2).toUpperCase());

                    const isCompleted = comment.completed;
                    const completedClass = isCompleted ? 'completed' : '';
                    const completedBadge = isCompleted ? '<span class="completion-badge">DONE</span>' : '';
                    const personalBadge = comment.isPersonal ? '<span class="completion-badge completion-badge--private">PRIVATE</span>' : '';

                    html += `
            <div class="comment-entry ${completedClass}">
                <div class="comment-header">
                    <div class="comment-checkbox-wrapper">
                         <input type="checkbox" class="comment-checkbox"
                                ${isCompleted ? 'checked' : ''}
                                aria-label="Mark as done"
                                onclick="toggleCommentCompletionFromFicha(event, '${comment.id}')">
                         <div class="comment-avatar" title="Author: ${autorName}">${iniciales}</div>
                         <div class="comment-head-meta">
                            <span class="comment-date">${formattedDate}</span>
                            <span class="comment-owner-chips">${ownerChips}</span>
                            ${hoursChip}${descChip}
                         </div>

                         ${completedBadge}${personalBadge}
                    </div>
                </div>
                <button type="button" class="comment-text comment-indent comment-text--clickable"
                        title="Open task details"
                        onclick="openTaskDetail(${jsArg(comment.id)})">
                    ${escapeHtml(comment.text).replace(/\n/g, '<br>')}
                </button>
                <div class="comment-actions comment-actions--inline comment-indent">
                    ${hasReplies ? `<button type="button" class="comment-action-btn comment-thread-btn" aria-expanded="${isExpanded}" onclick="toggleCommentThreadFromFicha('${comment.id}')">${replies.length} ${replies.length === 1 ? 'reply' : 'replies'} ${isExpanded ? '▲' : '▼'}</button>` : ''}
                    <button type="button" class="comment-action-btn comment-reply-btn" onclick="toggleReplyFormFromFicha('${comment.id}')">↩ Reply</button>
                </div>
                ${isReplying ? `<div class="reply-form comment-indent">
                    <textarea class="reply-textarea" aria-label="Reply" id="replyTextFicha_${comment.id}" placeholder="Write your reply..." rows="2"></textarea>
                    <div class="reply-form-actions">
                        <button type="button" class="comment-action-btn btn-reply-send" onclick="saveCommentReplyFromFicha('${comment.id}', '${comment.projectId}', '${comment.date}')">Send</button>
                        <button type="button" class="comment-action-btn btn-reply-send-mail" onclick="saveCommentReplyFromFicha('${comment.id}', '${comment.projectId}', '${comment.date}', true)">Send &amp; email</button>
                        <button type="button" class="comment-action-btn" onclick="cancelReplyFormFromFicha()">Cancel</button>
                    </div>
                </div>` : ''}
                ${isExpanded && hasReplies ? `<div class="comment-replies comment-indent">${replies.map(r => {
                        const rDateTime = formatDateTimeEuropeMadrid(r.createdAt, r.date || comment.date, r.time || '');
                        const rDate = rDateTime.date;
                        const rTime = rDateTime.time;
                        return `<div class="reply-entry"><div class="reply-thread-line"></div><div class="reply-body"><div class="reply-header">${rDate} ${rTime} · <strong>${escapeHtml(r.userName || 'ND')}</strong></div><div class="reply-text">${escapeHtml(r.text).replace(/\n/g, '<br>')}</div></div></div>`;
                    }).join('')}</div>` : ''}
            </div>`;
                });
                html += `</div>`;
            }

            html += `</section>`; // close .bento-card--comments

            html += `</div>`; // close .ficha-bento

            document.getElementById('fichaView').innerHTML = html;


        }

// Horas mensuales equivalentes a 1 FTE, usadas solo para presentar
// "horas ahorradas" en el histograma del dashboard a partir del campo fte.
const FTE_MONTHLY_HOURS = 160;

const PHASE_CHART_COLORS = {
    'Discovery': 'phase-color-discovery',
    'Design': 'phase-color-design',
    'Development': 'phase-color-development',
    'Testing': 'phase-color-testing',
    'Pilot': 'phase-color-pilot',
    'Production': 'phase-color-production',
    'Hypercare': 'phase-color-hypercare',
    'BAU': 'phase-color-bau',
    'Completed': 'phase-color-completed',
    'Cancelled': 'phase-color-cancelled',
    'On Hold': 'phase-color-hold',
    'Training': 'phase-color-training'
};

function buildPhaseDonutHtml(projectsForChart) {
    const order = (typeof PROJECT_PHASES !== 'undefined' && PROJECT_PHASES.length) ? PROJECT_PHASES : Object.keys(PHASE_CHART_COLORS);
    const counts = order.map(phase => ({
        phase,
        count: projectsForChart.filter(p => (p.phase || 'Discovery') === phase).length
    })).filter(entry => entry.count > 0);

    const total = counts.reduce((sum, e) => sum + e.count, 0);
    if (!total) {
        return `<div class="chart-card"><h3 class="chart-title">Projects by Phase</h3><div class="chart-empty">No data to display.</div></div>`;
    }

    const radius = 70;
    const cx = 70, cy = 70;
    let startAngle = -Math.PI / 2;

    const segments = counts.map((entry, idx) => {
        const fraction = entry.count / total;
        const sliceAngle = fraction * 2 * Math.PI;
        const endAngle = startAngle + sliceAngle;

        const x1 = cx + radius * Math.cos(startAngle);
        const y1 = cy + radius * Math.sin(startAngle);
        const x2 = cx + radius * Math.cos(endAngle);
        const y2 = cy + radius * Math.sin(endAngle);
        const largeArc = sliceAngle > Math.PI ? 1 : 0;

        const path = `M ${cx} ${cy} L ${x1} ${y1} A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2} Z`;

        const seg = `<path class="pie-segment ${PHASE_CHART_COLORS[entry.phase] || 'phase-color-discovery'}"
            d="${path}"
            style="cursor: pointer;"
            onclick="toggleDashFilter('fases','${entry.phase}')"
            onmouseover="showPieTooltip(event, '${escapeHtml(entry.phase)}', ${entry.count})"
            onmouseout="hidePieTooltip()">
            <title>${escapeHtml(entry.phase)}: ${entry.count} (${Math.round(fraction * 100)}%)</title>
        </path>`;

        startAngle = endAngle;
        return seg;
    }).join('');

    const legend = counts.map(entry => `
        <li class="donut-legend-item" tabindex="0" role="button"
            onclick="toggleDashFilter('fases','${entry.phase}')"
            onkeydown="activateOnEnterOrSpace(event)"
            title="Filter by ${escapeHtml(entry.phase)}">
            <span class="donut-legend-swatch ${PHASE_CHART_COLORS[entry.phase] || 'phase-color-discovery'}"></span>
            <span class="donut-legend-label">${escapeHtml(entry.phase)}</span>
            <span class="donut-legend-value u-figure">${entry.count}</span>
        </li>`).join('');

    return `
    <div class="chart-card">
        <h3 class="chart-title">📋 Projects by Phase</h3>
        <div class="donut-chart-body">
            <svg viewBox="0 0 140 140" class="donut-svg pie-chart" role="img" aria-label="Project distribution by phase">
                ${segments}
            </svg>
            <div id="pieTooltip" class="pie-tooltip" style="display:none;"></div>
            <ul class="donut-legend">${legend}</ul>
        </div>
    </div>`;
}

function showPieTooltip(event, phase, count) {
    const tooltip = document.getElementById('pieTooltip');
    tooltip.textContent = `${phase}: ${count} project${count !== 1 ? 's' : ''}`;
    tooltip.style.display = 'block';
    tooltip.style.left = event.pageX + 'px';
    tooltip.style.top = (event.pageY - 30) + 'px';
}

function hidePieTooltip() {
    const tooltip = document.getElementById('pieTooltip');
    tooltip.style.display = 'none';
}

function buildSavingsHistogramHtml(projectsForChart) {
    const confirmed = projectsForChart.filter(p => (p.phase === 'BAU' || p.phase === 'Completed') && Number(p.fte) > 0);

    if (!confirmed.length) {
        return `<div class="chart-card"><h3 class="chart-title">Hours Saved (BAU/Completed)</h3><div class="chart-empty">No BAU or Completed projects with FTE savings yet.</div></div>`;
    }

    const buckets = {};
    confirmed.forEach(p => {
        const dateStr = p.endDate || p.createdAt;
        const monthKey = dateStr ? String(dateStr).slice(0, 7) : 'No date';
        const hours = Number(p.fte) * FTE_MONTHLY_HOURS;
        buckets[monthKey] = (buckets[monthKey] || 0) + hours;
    });

    const monthKeys = Object.keys(buckets).sort();
    const maxValue = Math.max(...monthKeys.map(k => buckets[k]));
    let cumulative = 0;
    const cumulativeValues = monthKeys.map(k => (cumulative += buckets[k]));
    const maxCumulative = Math.max(...cumulativeValues, 1);

    const chartWidth = 480;
    const chartHeight = 160;
    const padding = 28;
    const innerWidth = chartWidth - padding * 2;
    const innerHeight = chartHeight - padding * 2;
    const barSlot = innerWidth / monthKeys.length;
    const barWidth = Math.min(36, barSlot * 0.55);

    const bars = monthKeys.map((key, i) => {
        const value = buckets[key];
        const barHeight = maxValue > 0 ? (value / maxValue) * innerHeight : 0;
        const x = padding + i * barSlot + (barSlot - barWidth) / 2;
        const y = padding + innerHeight - barHeight;
        const label = formatMonthLabelShort(key);
        return `
            <rect class="histogram-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(barHeight, 1).toFixed(1)}" rx="3">
                <title>${label}: ${Math.round(value).toLocaleString('en-GB')} h</title>
            </rect>
            <text x="${(x + barWidth / 2).toFixed(1)}" y="${chartHeight - 6}" text-anchor="middle" class="histogram-axis-label">${label}</text>`;
    }).join('');

    const linePoints = monthKeys.map((key, i) => {
        const x = padding + i * barSlot + barSlot / 2;
        const y = padding + innerHeight - (cumulativeValues[i] / maxCumulative) * innerHeight;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(' ');

    const totalHours = Math.round(cumulative);

    return `
    <div class="chart-card">
        <h3 class="chart-title">Hours Saved (BAU/Completed)</h3>
        <div class="histogram-total u-figure">${totalHours.toLocaleString('en-GB')} h <span class="histogram-total-label u-kicker">cumulative</span></div>
        <svg viewBox="0 0 ${chartWidth} ${chartHeight}" class="histogram-svg" role="img" aria-label="Histogram of hours saved per month">
            <line x1="${padding}" y1="${padding + innerHeight}" x2="${chartWidth - padding}" y2="${padding + innerHeight}" class="histogram-axis-line" />
            ${bars}
            <polyline points="${linePoints}" class="histogram-trend-line" fill="none" />
        </svg>
        <p class="chart-footnote">Estimated at ${FTE_MONTHLY_HOURS}h/month per saved FTE. Line = cumulative.</p>
    </div>`;
}

function formatMonthLabelShort(monthKey) {
    if (!monthKey || monthKey === 'No date') return 'N/D';
    const [year, month] = monthKey.split('-');
    const names = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const idx = parseInt(month, 10) - 1;
    return `${names[idx] || month}'${(year || '').slice(2)}`;
}

function renderDashboard() {
    const container = document.getElementById('dashboardView');

    container.innerHTML = '';

    // Sombra deliberada de la global `projects`: el dashboard solo
    // reporta sobre proyectos vivos. Declarándolo aquí, las ~15
    // lecturas de `projects` que hay más abajo excluyen los archivados
    // sin tener que tocarlas una por una. Los borrados ya no están en
    // la global (viven en deletedProjects). Los Training tampoco: no
    // son portfolio (sus horas sí salen en el widget de capacidad, que
    // lee la global).
    const projects = getLiveProjects().filter(p => !isTrainingProject(p));

    if (!projects || !projects.length) {
        container.innerHTML = `<div class="empty-state">No projects yet. Create one to see the dashboard.</div>`;
        return;
    }

    // Valores únicos para filtros
    const fases = Array.from(new Set(projects.map(p => p.phase).filter(Boolean))).sort();
    const impactos = Array.from(new Set(projects.map(p => p.impact).filter(Boolean))).sort();
    const estados = Array.from(new Set(projects.map(p => p.status).filter(Boolean))).sort();
    const owners = Array.from(new Set(projects.flatMap(p => p.responsibles || []).filter(Boolean))).sort();
    const countries = Array.from(new Set(projects.map(p => p.country).filter(Boolean))).sort();
    // Priority is a fixed 4-level scale, shown regardless of what's in the data yet.
    const PRIORITY_FILTER_OPTIONS = ['Crítica', 'Alta', 'Media', 'Baja'];

    // Contar filtros activos
    const activeFiltersCount = [
        dashboardFilters.proyecto,
        (dashboardFilters.fases || []).length > 0,
        (dashboardFilters.prioridades || []).length > 0,
        (dashboardFilters.impactos || []).length > 0,
        (dashboardFilters.estados || []).length > 0,
        (dashboardFilters.owners || []).length > 0,
        (dashboardFilters.countries || []).length > 0,
        dashboardFilters.fechaInicioDesde,
        dashboardFilters.fechaInicioHasta,
        dashboardFilters.fechaFinDesde,
        dashboardFilters.fechaFinHasta
    ].filter(Boolean).length;

    const dashFilterMenuClass = key => `dash-filter-menu${openDashFilterMenu === key ? ' active' : ''}`;

    // BARRA DE FILTROS — pills/chips
    let html = `
    <div class="dashboard-hero">
        <h2 class="dashboard-hero-title">Portfolio Intelligence</h2>
        <p class="dashboard-hero-subtitle">Centralized visibility across projects, deliverables, benefits and team capacity.</p>
    </div>
    <div class="dash-filters">
        <div class="dash-filter-row">
            <div class="dash-filter-group">
                <span class="dash-filter-label">Project</span>
                <input type="text" id="dashFilterProyecto" class="dash-filter-input" placeholder="Search projects…" title="Name, description, owner, country or phase" aria-label="Search projects by name, description, owner, country or phase" value="${escapeHtml(dashboardFilters.proyecto || '')}">
            </div>

            <div class="dash-filter-dropdown">
                <button type="button" class="dash-filter-trigger" onclick="toggleDashFilterMenu(event,'status')">Status${(dashboardFilters.estados||[]).length ? ` (${dashboardFilters.estados.length})` : ''} ▾</button>
                <div class="${dashFilterMenuClass('status')}">
                    <div class="dash-pills dash-pills--menu">
                        ${PROJECT_STATUSES.map(s => {
                            const on = (dashboardFilters.estados || []).includes(s.value);
                            return `<button type="button" class="dash-pill dash-pill--${s.dot}${on ? ' active' : ''}" aria-pressed="${on}" onclick="toggleDashFilter('estados',${jsArg(s.value)})"><span class="dash-dot dash-dot--${s.dot}"></span> ${s.label}</button>`;
                        }).join('')}
                    </div>
                </div>
            </div>

            <div class="dash-filter-dropdown">
                <button type="button" class="dash-filter-trigger" onclick="toggleDashFilterMenu(event,'phase')">Phase${(dashboardFilters.fases||[]).length ? ` (${dashboardFilters.fases.length})` : ''} ▾</button>
                <div class="${dashFilterMenuClass('phase')}">
                    <div class="dash-pills dash-pills--menu">
                        ${fases.length ? fases.map(f => `<button type="button" class="dash-pill${(dashboardFilters.fases||[]).includes(f) ? ' active' : ''}" aria-pressed="${(dashboardFilters.fases||[]).includes(f)}" onclick="toggleDashFilter('fases','${f}')">${f}</button>`).join('') : '<div class="dash-filter-menu-empty">No phases yet</div>'}
                    </div>
                </div>
            </div>

            <div class="dash-filter-dropdown">
                <button type="button" class="dash-filter-trigger" onclick="toggleDashFilterMenu(event,'priority')">Priority${(dashboardFilters.prioridades||[]).length ? ` (${dashboardFilters.prioridades.length})` : ''} ▾</button>
                <div class="${dashFilterMenuClass('priority')}">
                    <div class="dash-pills dash-pills--menu">
                        ${PRIORITY_FILTER_OPTIONS.map(p => `<button type="button" class="dash-pill${(dashboardFilters.prioridades||[]).includes(p) ? ' active' : ''}" aria-pressed="${(dashboardFilters.prioridades||[]).includes(p)}" onclick="toggleDashFilter('prioridades','${p}')">${getPriorityLabel(p)}</button>`).join('')}
                    </div>
                </div>
            </div>

            <div class="dash-filter-dropdown">
                <button type="button" class="dash-filter-trigger" onclick="toggleDashFilterMenu(event,'impact')">Impact${(dashboardFilters.impactos||[]).length ? ` (${dashboardFilters.impactos.length})` : ''} ▾</button>
                <div class="${dashFilterMenuClass('impact')}">
                    <div class="dash-pills dash-pills--menu">
                        ${impactos.length ? impactos.map(i => `<button type="button" class="dash-pill${(dashboardFilters.impactos||[]).includes(i) ? ' active' : ''}" aria-pressed="${(dashboardFilters.impactos||[]).includes(i)}" onclick="toggleDashFilter('impactos','${i}')">${getImpactLabel(i)}</button>`).join('') : '<div class="dash-filter-menu-empty">No impacts yet</div>'}
                    </div>
                </div>
            </div>

            <div class="dash-filter-dropdown">
                <button type="button" class="dash-filter-trigger" onclick="toggleDashFilterMenu(event,'owner')">Owner${(dashboardFilters.owners||[]).length ? ` (${dashboardFilters.owners.length})` : ''} ▾</button>
                <div class="${dashFilterMenuClass('owner')}">
                    <div class="dash-pills dash-pills--menu">
                        ${owners.length ? owners.map(o => `<button type="button" class="dash-pill${(dashboardFilters.owners||[]).includes(o) ? ' active' : ''}" aria-pressed="${(dashboardFilters.owners||[]).includes(o)}" onclick="toggleDashFilter('owners','${o}')">${escapeHtml(o)}</button>`).join('') : '<div class="dash-filter-menu-empty">No owners yet</div>'}
                    </div>
                </div>
            </div>

            <div class="dash-filter-dropdown">
                <button type="button" class="dash-filter-trigger" onclick="toggleDashFilterMenu(event,'country')">Country${(dashboardFilters.countries||[]).length ? ` (${dashboardFilters.countries.length})` : ''} ▾</button>
                <div class="${dashFilterMenuClass('country')}">
                    <div class="dash-pills dash-pills--menu">
                        ${countries.length ? countries.map(c => `<button type="button" class="dash-pill${(dashboardFilters.countries||[]).includes(c) ? ' active' : ''}" aria-pressed="${(dashboardFilters.countries||[]).includes(c)}" onclick="toggleDashFilter('countries','${c}')">${escapeHtml(c)}</button>`).join('') : '<div class="dash-filter-menu-empty">No countries yet</div>'}
                    </div>
                </div>
            </div>

            <div class="dash-filter-dropdown">
                <button type="button" class="dash-filter-trigger" onclick="toggleDashFilterMenu(event,'dates')">Date range${(dashboardFilters.fechaInicioDesde||dashboardFilters.fechaInicioHasta||dashboardFilters.fechaFinDesde||dashboardFilters.fechaFinHasta) ? ' •' : ''} ▾</button>
                <div class="${dashFilterMenuClass('dates')} dash-filter-menu--dates">
                    <div class="dash-filter-group">
                        <span class="dash-filter-label">Start</span>
                        <div class="dash-date-range">
                            <input type="date" class="dash-filter-input dash-date-input" value="${dashboardFilters.fechaInicioDesde || ''}" aria-label="Start from" onchange="setDashboardFilter('fechaInicioDesde', this.value)">
                            <span class="dash-date-sep">→</span>
                            <input type="date" class="dash-filter-input dash-date-input" value="${dashboardFilters.fechaInicioHasta || ''}" aria-label="Start to" onchange="setDashboardFilter('fechaInicioHasta', this.value)">
                        </div>
                    </div>
                    <div class="dash-filter-group">
                        <span class="dash-filter-label">End</span>
                        <div class="dash-date-range">
                            <input type="date" class="dash-filter-input dash-date-input" value="${dashboardFilters.fechaFinDesde || ''}" aria-label="End from" onchange="setDashboardFilter('fechaFinDesde', this.value)">
                            <span class="dash-date-sep">→</span>
                            <input type="date" class="dash-filter-input dash-date-input" value="${dashboardFilters.fechaFinHasta || ''}" aria-label="End to" onchange="setDashboardFilter('fechaFinHasta', this.value)">
                        </div>
                    </div>
                </div>
            </div>

            <div class="dash-filter-group dash-filter-group--action">
                <button type="button" class="btn-clear-filters" onclick="clearDashboardFilters()"${activeFiltersCount ? '' : ' disabled'}>
                    Clear${activeFiltersCount > 0 ? ` (${activeFiltersCount})` : ''}
                </button>
            </div>
        </div>
    </div>
    `;

    // Aplicar filtros
    const filteredProjects = projects.filter(p => {
        if (dashboardFilters.proyecto && !projectMatchesQuery(p, dashboardFilters.proyecto)) return false;

        if (dashboardFilters.fases && dashboardFilters.fases.length > 0) {
            if (!dashboardFilters.fases.includes(p.phase)) return false;
        }

        if (dashboardFilters.prioridades && dashboardFilters.prioridades.length > 0) {
    if (!dashboardFilters.prioridades.includes(p.priority)) return false;
}

        if (dashboardFilters.impactos && dashboardFilters.impactos.length > 0) {
            if (!dashboardFilters.impactos.includes(p.impact)) return false;
        }

        if (dashboardFilters.estados && dashboardFilters.estados.length > 0) {
            if (!dashboardFilters.estados.includes(p.status)) return false;
        }

        if (dashboardFilters.owners && dashboardFilters.owners.length > 0) {
            const owners = p.responsibles || [];
            if (!dashboardFilters.owners.some(o => owners.includes(o))) return false;
        }

        if (dashboardFilters.countries && dashboardFilters.countries.length > 0) {
            if (!dashboardFilters.countries.includes(p.country)) return false;
        }

        if (dashboardFilters.fechaInicioDesde) {
            if (!p.startDate || p.startDate < dashboardFilters.fechaInicioDesde) return false;
        }

        if (dashboardFilters.fechaInicioHasta) {
            if (!p.startDate || p.startDate > dashboardFilters.fechaInicioHasta) return false;
        }

        if (dashboardFilters.fechaFinDesde) {
            if (!p.endDate || p.endDate < dashboardFilters.fechaFinDesde) return false;
        }

        if (dashboardFilters.fechaFinHasta) {
            if (!p.endDate || p.endDate > dashboardFilters.fechaFinHasta) return false;
        }

        return true;
    });

    let totalSavingsHours = 0;
    let totalFte = 0;
    let totalRealFte = 0;

    // Tabla de proyectos
    html += `
    <div class="dashboard-content">
        <div class="dashboard-stats">
            <div class="stat-card">
                <span class="stat-icon" aria-hidden="true">📁</span>
                <div class="stat-label">Projects</div>
                <div class="stat-value">${filteredProjects.length}</div>
            </div>
            <div class="stat-card">
                <span class="stat-icon" aria-hidden="true">🚀</span>
                <div class="stat-label">Active</div>
                <div class="stat-value">${filteredProjects.filter(p => getProjectGroup(p) === 'activos').length}</div>
            </div>
            <div class="stat-card">
                <span class="stat-icon" aria-hidden="true">🔁</span>
                <div class="stat-label">BAU</div>
                <div class="stat-value">${filteredProjects.filter(p => getProjectGroup(p) === 'bau').length}</div>
            </div>
            <div class="stat-card">
                <span class="stat-icon" aria-hidden="true">✅</span>
                <div class="stat-label">Completed</div>
                <div class="stat-value">${filteredProjects.filter(p => getProjectGroup(p) === 'completados').length}</div>
            </div>
        </div>

        <div class="dashboard-charts">
            ${buildPhaseDonutHtml(filteredProjects)}
            ${buildSavingsHistogramHtml(filteredProjects)}
        </div>

        <div class="dashboard-table-container">
            <table class="dashboard-table">
                <thead>
                    <tr>
                        ${renderSortableHeader('name', 'Project', dashboardSort, 'toggleDashboardSort')}
                        ${renderSortableHeader('startDate', 'Start', dashboardSort, 'toggleDashboardSort')}
                        ${renderSortableHeader('endDate', 'End', dashboardSort, 'toggleDashboardSort')}
                        ${renderSortableHeader('phase', 'Phase', dashboardSort, 'toggleDashboardSort')}
                        ${renderSortableHeader('priority', 'Priority', dashboardSort, 'toggleDashboardSort')}
                        ${renderSortableHeader('impact', 'Impact', dashboardSort, 'toggleDashboardSort')}
                        ${renderSortableHeader('status', 'Status', dashboardSort, 'toggleDashboardSort')}
                        ${renderSortableHeader('progress', 'Progress', dashboardSort, 'toggleDashboardSort')}
                        ${renderSortableHeader('savingsHours', 'Savings h/year', dashboardSort, 'toggleDashboardSort')}
                        ${renderSortableHeader('fte', 'Est. FTE', dashboardSort, 'toggleDashboardSort')}
                        ${renderSortableHeader('realFte', 'Real FTE', dashboardSort, 'toggleDashboardSort')}
                    </tr>
                </thead>
                <tbody>`;

    // Aplicar ordenamiento
    const sortedProjects = sortDashboardProjects(filteredProjects);

    if (!sortedProjects.length) {
        html += `<tr><td colspan="11" class="table-empty">No projects match the selected filters.</td></tr>`;
    }

    sortedProjects.forEach(p => {
        const start = formatDateDisplay(p.startDate);
        const end = formatDateDisplay(p.endDate);
        const progress = isNaN(parseInt(p.progress, 10)) ? 0 : parseInt(p.progress, 10);
        const savingsHours = parseSavingsHours(p.savingsHours);
        const fte = Number(p.fte) || 0;
        totalSavingsHours += savingsHours || 0;
        totalFte += fte;
        const realFte = parseOptionalNonNegative(p.realFte);
        totalRealFte += realFte || 0;
        html += `
        <tr class="dashboard-row" tabindex="0" onclick="hideStatusTooltip(); selectProject('${p.id}')" onkeydown="activateOnEnterOrSpace(event)"
            onmouseenter="showStatusTooltip(event, '${p.id}')"
            onmouseleave="hideStatusTooltip()">
            <td class="dash-name">${escapeHtml(p.name || 'Untitled')}</td>
            <td>${start || '-'}</td>
            <td>${end || '-'}</td>
            <td><span class="badge badge-fase">${p.phase || '-'}</span></td>
            <td><span class="badge badge-${(p.priority || 'Media').toLowerCase()}">${p.priority ? getPriorityLabel(p.priority) : '-'}</span></td>
            <td><span class="badge badge-${(p.impact || 'Medio').toLowerCase()}">${p.impact ? getImpactLabel(p.impact) : '-'}</span></td>
            <td><span class="badge badge-status badge-${getStatusCssKey(p.status)}">${getStatusText(p.status) || '-'}</span></td>
            <td>
                <div class="progress-bar-container" role="progressbar" aria-label="Progress" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
                    <div class="progress-bar-fill" style="width: ${progress}%"></div>
                    <span class="progress-bar-text">${progress}%</span>
                </div>
            </td>
            <td class="dash-num-center">${formatSavingsHours(savingsHours)}</td>
            <td class="dash-num-center">${fte.toLocaleString('en-GB', { minimumFractionDigits: 1 })}</td>
            <td class="dash-num-center">${realFte === null ? '-' : realFte.toLocaleString('en-GB', { minimumFractionDigits: 1 })}</td>
        </tr>`;
    });

    html += `
                </tbody>
            </table>
        </div>

        <div class="dashboard-summary">
            <div class="summary-title">Totals</div>
            <div class="summary-row">
                <div class="summary-item">
                    <div class="summary-label">Total savings (hours/year)</div>
                    <div class="summary-value">${formatSavingsHours(totalSavingsHours)}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Total estimated savings FTE</div>
                    <div class="summary-value">${totalFte.toLocaleString('en-GB', { minimumFractionDigits: 1 })}</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Total real savings FTE</div>
                    <div class="summary-value">${totalRealFte.toLocaleString('en-GB', { minimumFractionDigits: 1 })}</div>
                </div>
            </div>
        </div>
    </div>`;

    // Widget de dedicación del equipo: el MISMO widget "Weekly Capacity"
    // de la ficha (mismo computeWeekCapacity()), con su propia semana y
    // el desglose por proyectos en vez de "Xh here".
    html += `
    <div class="dashboard-capacity-section">
        ${renderDashboardCapacityWidget()}
    </div>`;

    container.innerHTML = html;

    // Solo necesitamos listener para el texto (preservar cursor al teclear)
    setTimeout(() => {
        const proyectoInput = document.getElementById('dashFilterProyecto');
        if (proyectoInput) {
            proyectoInput.addEventListener('input', (e) => {
                const cursorPos = e.target.selectionStart;
                dashboardFilters.proyecto = e.target.value;
                renderDashboard();
                setTimeout(() => {
                    const newInput = document.getElementById('dashFilterProyecto');
                    if (newInput) { newInput.focus(); newInput.setSelectionRange(cursorPos, cursorPos); }
                }, 0);
            });
        }
    }, 0);

}



function clearDashboardFilters() {
    dashboardFilters = {
        proyecto: '',
        fases: [],
        prioridades: [],
        impactos: [],
        estados: [],
        owners: [],
        countries: [],
        fechaInicioDesde: '',
        fechaInicioHasta: '',
        fechaFinDesde: '',
        fechaFinHasta: ''
    };
    renderDashboard();
}

function showStatusTooltip(event, projectId) {
    const statuses = (projectStatuses || [])
        .filter(s => s.projectId === projectId)
        .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));

    let tooltip = document.getElementById('dashStatusTooltip');
    if (!tooltip) {
        tooltip = document.createElement('div');
        tooltip.id = 'dashStatusTooltip';
        tooltip.className = 'dash-status-tooltip';
        document.body.appendChild(tooltip);
    }

    if (!statuses.length) {
        tooltip.style.display = 'none';
        return;
    }

    const last = statuses[0];
    const d = new Date(last.createdAt);
    const dateStr = d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: '2-digit' });

    tooltip.innerHTML = `
        <div class="dst-header">
            <span class="dst-date">${dateStr}</span>
            <span class="dst-user">${escapeHtml(last.userInitials || '')}</span>
        </div>
        <div class="dst-text">${escapeHtml(last.statusText || '')}</div>`;

    tooltip.style.display = 'block';
    positionStatusTooltip(event, tooltip);
}

function positionStatusTooltip(event, tooltip) {
    const pad = 14;
    const tw = tooltip.offsetWidth || 280;
    const th = tooltip.offsetHeight || 80;
    let x = event.clientX + pad;
    let y = event.clientY + pad;
    if (x + tw > window.innerWidth - 8) x = event.clientX - tw - pad;
    if (y + th > window.innerHeight - 8) y = event.clientY - th - pad;
    tooltip.style.left = x + 'px';
    tooltip.style.top  = y + 'px';
}

function hideStatusTooltip() {
    const tooltip = document.getElementById('dashStatusTooltip');
    if (tooltip) tooltip.style.display = 'none';
}

function toggleDashboardSort(column) {
    if (dashboardSort.column === column) {
        // Si es la misma columna, invertir la dirección
        dashboardSort.direction = dashboardSort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        // Si es una columna diferente, establecer orden ascendente
        dashboardSort.column = column;
        dashboardSort.direction = 'asc';
    }
    renderDashboard();
}


function sortDashboardProjects(projects) {
    if (!dashboardSort.column) return projects;
    
    const sorted = [...projects].sort((a, b) => {
        let aVal, bVal;
        
        switch(dashboardSort.column) {
            case 'name':
                aVal = (a.name || '').toLowerCase();
                bVal = (b.name || '').toLowerCase();
                break;
            case 'startDate':
                aVal = a.startDate || '';
                bVal = b.startDate || '';
                break;
            case 'endDate':
                aVal = a.endDate || '';
                bVal = b.endDate || '';
                break;
            case 'phase':
                aVal = (a.phase || '').toLowerCase();
                bVal = (b.phase || '').toLowerCase();
                break;
            case 'priority':
                const priorityOrder = { 'Alta': 3, 'Media': 2, 'Baja': 1 };
                aVal = priorityOrder[a.priority] || 0;
                bVal = priorityOrder[b.priority] || 0;
                break;
            case 'impact':
                const impactOrder = { 'Alto': 3, 'Medio': 2, 'Bajo': 1 };
                aVal = impactOrder[a.impact] || 0;
                bVal = impactOrder[b.impact] || 0;
                break;
            case 'status':
                aVal = getStatusDef(a.status).rank;
                bVal = getStatusDef(b.status).rank;
                break;
            case 'progress':
                aVal = parseInt(a.progress, 10) || 0;
                bVal = parseInt(b.progress, 10) || 0;
                break;
            case 'savingsHours':
                aVal = parseSavingsHours(a.savingsHours) || 0;
                bVal = parseSavingsHours(b.savingsHours) || 0;
                break;
            case 'fte':
                aVal = Number(a.fte) || 0;
                bVal = Number(b.fte) || 0;
                break;
            case 'realFte':
                aVal = parseOptionalNonNegative(a.realFte) || 0;
                bVal = parseOptionalNonNegative(b.realFte) || 0;
                break;
            default:
                return 0;
        }
        
        if (aVal < bVal) {
            return dashboardSort.direction === 'asc' ? -1 : 1;
        }
        if (aVal > bVal) {
            return dashboardSort.direction === 'asc' ? 1 : -1;
        }
        return 0;
    });
    
    return sorted;
}

function toggleDailySort(column) {
    if (dailySort.column === column) {
        // Si es la misma columna, invertir la dirección
        dailySort.direction = dailySort.direction === 'asc' ? 'desc' : 'asc';
    } else {
        // Si es una columna diferente, establecer orden ascendente
        dailySort.column = column;
        dailySort.direction = 'asc';
    }
    renderDaily();
}


function sortDailyProjects(projects) {
    if (!dailySort.column) return projects;
    
    const sorted = [...projects].sort((a, b) => {
        let aVal, bVal;
        
        switch(dailySort.column) {
            case 'name':
                aVal = (a.name || '').toLowerCase();
                bVal = (b.name || '').toLowerCase();
                break;
            case 'status':
                aVal = PROJECT_PHASES.indexOf(a.phase) + 1;
                bVal = PROJECT_PHASES.indexOf(b.phase) + 1;
                break;
            case 'startDate':
                aVal = a.startDate || '';
                bVal = b.startDate || '';
                break;
            default:
                return 0;
        }
        
        if (aVal < bVal) {
            return dailySort.direction === 'asc' ? -1 : 1;
        }
        if (aVal > bVal) {
            return dailySort.direction === 'asc' ? 1 : -1;
        }
        return 0;
    });
    
    return sorted;
}

        function goToDailyFromFicha() {
            if (!currentProjectId) return;
            switchView('daily');
        }


        async function togglePrereqStatus(projectId, prereqName, type, isChecked) {
            const project = projects.find(p => p.id === projectId);
            if (!project) return;

            // Aseguramos que existe el array
            if (!Array.isArray(project.prerequisites)) {
                project.prerequisites = [];
            }

            // Buscamos el índice de este prerrequisito en los datos del proyecto
            let itemIndex = project.prerequisites.findIndex(p => p.name === prereqName);

            // Si no existe (porque es un proyecto viejo o nuevo campo), lo añadimos
            if (itemIndex === -1) {
                project.prerequisites.push({
                    name: prereqName,
                    done: false,
                    na: false
                });
                itemIndex = project.prerequisites.length - 1;
            }

            // LÓGICA DE ACTUALIZACIÓN
            if (type === 'done') {
                // Si marcamos "Hecho", guardamos el valor
                project.prerequisites[itemIndex].done = isChecked;

                // (Opcional) Si marcas Hecho, podrías desmarcar N/A si quisieras:
                // if(isChecked) project.prerequisites[itemIndex].na = false;

            } else if (type === 'na') {
                // Si marcamos "N/A"
                project.prerequisites[itemIndex].na = isChecked;

                // Si activamos N/A, desactivamos "Hecho" automáticamente
                if (isChecked) {
                    project.prerequisites[itemIndex].done = false;
                }
            }

            // 1. Actualizamos la vista inmediatamente para que el usuario vea el cambio
            renderFicha();

            // 2. Guardamos en Supabase silenciosamente
            await updateProjectField(projectId, 'prerequisites', project.prerequisites);
        }



        // =====================================================
        // =========== NAVEGACIÓN E INICIALIZACIÓN APP =========
        // (cambio de vistas, carga inicial, tiempo real, etc.)
        // =====================================================



        let currentView = 'daily';

        const VIEW_TITLES = {
            daily: 'Daily',
            ficha: 'Project Card',
            equipo: 'Team Calendar',
            dashboard: 'Projects Dashboard',
            tasks: 'My Tasks',
            admin: 'Team Management'
        };

        function switchView(view) {
            if (!VIEW_TITLES[view]) return;
            // Ocultar el botón no basta: se comprueba el rol también aquí.
            if (view === 'admin' && !isCurrentUserAdmin()) return;
            closeMobileSidebar();
            closeAllDropdowns();
            closeResponsiblesPopover();

            // Si salimos de Equipo y el sidebar fue colapsado automáticamente, restaurarlo
            if (view !== 'equipo' && sidebarAutoCollapsed) {
                setSidebarCollapsed(false);
                sidebarAutoCollapsed = false;
            }

            // El calendario anual tiene miles de celdas: se libera al salir de Equipo
            if (currentView === 'equipo' && view !== 'equipo') {
                const teamView = document.getElementById('teamView');
                if (teamView) teamView.innerHTML = '';
            }

            currentView = view;

            document.querySelectorAll('.content-area > [data-view]').forEach(section => {
                section.classList.toggle('active', section.dataset.view === view);
            });
            document.querySelectorAll('.view-toggle button').forEach(btn => {
                const isActive = btn.dataset.view === view;
                btn.classList.toggle('active', isActive);
                btn.setAttribute('aria-pressed', String(isActive));
            });
            const titleEl = document.getElementById('viewTitle');
            if (titleEl) titleEl.textContent = VIEW_TITLES[view];

            if (view === 'equipo') {
                // Contraer el sidebar automáticamente para ganar visibilidad en el calendario anual
                const sidebar = document.getElementById('sidebar');
                if (sidebar && window.matchMedia('(min-width: 769px)').matches && !sidebar.classList.contains('collapsed')) {
                    setSidebarCollapsed(true);
                    sidebarAutoCollapsed = true;
                }
            }

            renderActiveView();
        }

        function renderActiveView() {
            if (currentView === 'daily') renderDaily();
            else if (currentView === 'ficha') renderFicha();
            else if (currentView === 'equipo') renderTeamView();
            else if (currentView === 'dashboard') renderDashboard();
            else if (currentView === 'tasks') renderTasksView();
            else if (currentView === 'admin') renderAdminView();
            updateTasksViewCount();
        }



        async function loadDataFromSupabase(skipRender = false) {
            // Todas las lecturas son independientes: se lanzan en paralelo
            // OJO: el destructuring es posicional. Si añades una lectura a
            // este array, añade también un hueco aquí o projectsResult pasará
            // a apuntar a la lectura equivocada.
            const [, , , , , , , , projectsResult, commentsResult] = await Promise.all([
                loadCapacities(),
                loadProjectStatuses(),
                loadProjectNotes(),
                loadWeeklyTasks(),
                loadIncidents(),
                loadDayPersonalTasks(),
                loadDayTasks(),
                loadCapacityOverrides(),
                supabaseClient.from('projects').select('*').order('created_at', { ascending: true }),
                supabaseClient.from('daily_comments').select('*').order('created_at', { ascending: true })
            ]);

            const { data: projData, error: projError } = projectsResult;
            if (projError) {
                console.error(projError);
                showToast('Error loading projects', 'error');
                return;
            }

            const { data: comData, error: comError } = commentsResult;
            if (comError) {
                console.error(comError);
                showToast('Error loading comments', 'error');
                return;
            }

            const mapProjectRow = (p) => ({
                id: p.id,
                name: p.name || '(No name)',
                startDate: p.start_date || null,
                endDate: p.end_date || null,
                benefits: p.benefits || "",
                // Nombres de fase heredados de un vocabulario antiguo -> fase actual
                phase: LEGACY_PHASE_MAP[p.phase] || p.phase || "Discovery",
                bauOwner: p.bau_owner || '',
                stakeholders: p.stakeholders || "",
                description: p.description || "",
                country: p.country || "",
                // volume = savings en € heredados: ya no se editan, solo se
                // enseñan como "legacy" mientras no haya savings_hours.
                volume: p.volume || "",
                savingsHours: parseSavingsHours(p.savings_hours),
                prerequisites: p.prerequisites || [],
                priority: p.priority || "Media",
                impact: p.impact || "Medio",
                status: p.status || "Verde",
                progress: p.progress || 0,
                fte: p.fte,
                realFte: parseOptionalNonNegative(p.real_fte),
                responsibles: sanitizeResponsiblesList(p.responsibles),
                archivedAt: p.archived_at || null,
                archivedBy: p.archived_by || '',
                deletedAt: p.deleted_at || null,
                deletedBy: p.deleted_by || '',
                createdAt: p.created_at
            });

            // Los borrados se apartan en deletedProjects. Todo lo que ya
            // recorría `projects` (daily, dashboard, selectores, capacidad)
            // deja de verlos sin tener que tocar cada sitio.
            const allProjectRows = (projData || []).map(mapProjectRow);
            projects = allProjectRows.filter(p => !p.deletedAt);
            deletedProjects = allProjectRows
                .filter(p => p.deletedAt)
                .sort((a, b) => new Date(b.deletedAt) - new Date(a.deletedAt));

            const projectsWithExcludedResponsibles = (projData || [])
                .map(p => {
                    const cleaned = sanitizeResponsiblesList(p.responsibles);
                    const original = Array.isArray(p.responsibles)
                        ? p.responsibles.map(item => (item || '').trim().toUpperCase()).filter(Boolean)
                        : [];

                    const hasChanges = cleaned.length !== original.length ||
                        cleaned.some((item, idx) => item !== original[idx]);

                    if (!hasChanges) return null;
                    return { id: p.id, responsibles: cleaned };
                })
                .filter(Boolean);

            if (projectsWithExcludedResponsibles.length > 0) {
                await Promise.all(
                    projectsWithExcludedResponsibles.map(item =>
                        supabaseClient
                            .from('projects')
                            .update({ responsibles: item.responsibles })
                            .eq('id', item.id)
                    )
                );
            }




            const mappedComments = (comData || []).map(c => ({
                id: c.id,
                projectId: c.project_id,
                date: c.date,
                time: c.time,
                responsible: c.responsible,
                // Fuente de verdad para los responsables. Si la fila es
                // anterior a la migración y aún no tiene array, se cae al
                // responsable único para no perderlo.
                responsibles: sanitizeResponsiblesList(
                    (Array.isArray(c.responsibles) && c.responsibles.length)
                        ? c.responsibles
                        : (c.responsible ? [c.responsible] : [])
                ),
                description: c.description || '',
                estimatedHours: Number(c.estimated_hours) || 0,
                hoursByAssignee: normalizeHoursByAssignee(c.hours_by_assignee),
                isPersonal: !!c.is_personal,
                ownerInitials: normalizeInitials(c.owner_initials || c.user_name || ''),
                urgency: c.urgency || 'Normal',
                taskType: normalizeTaskType(c.task_type),
                hasIncident: !!c.has_incident,
                text: c.text || '',
                completed: !!c.completed,
                userName: c.user_name || 'US',
                parentId: c.parent_id || null,
                createdAt: c.created_at
            }));

            // Refuerzo de privacidad: las tareas personales de otros usuarios
            // no se conservan en memoria del cliente actual.
            dailyComments = mappedComments.filter(c => canCurrentUserViewComment(c));


            renderProjectsList();
            if (projects.length > 0 && !currentProjectId) {
                // Seleccionar el primer proyecto ACTIVO (en curso; si no hay, en BAU)
                const activeProject = projects.find(p => getProjectGroup(p) === 'activos')
                    || projects.find(p => getProjectGroup(p) === 'bau');
                currentProjectId = activeProject ? activeProject.id : (getLiveProjects()[0] || projects[0]).id;
            }
            updateWeekInfo();

            if (!skipRender) {
                renderActiveView();
            }
        }



        // =====================================================
        // ================= TIEMPO REAL (SUPABASE) ============
        // Un único manejador: recarga datos y refresca la vista
        // activa y los modales abiertos. Si el usuario está
        // escribiendo, el refresco se pospone hasta que suelte el foco.
        // =====================================================

        let realtimeRefreshPending = false;
        let realtimeInFlight = false;

        function isUserTypingInApp() {
            const el = document.activeElement;
            if (!el) return false;
            const isTextField = el.tagName === 'TEXTAREA' ||
                (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type));
            if (!isTextField) return false;
            return !!el.closest('.content-area, #commentsListModal, #dayPersonalTasksModal');
        }

        function refreshOpenOverlays() {
            const listModal = document.getElementById('commentsListModal');
            if (listModal && listModal.classList.contains('active') && commentsListContext.projectId && commentsListContext.dateKey) {
                renderCommentsListContent(commentsListContext.projectId, commentsListContext.dateKey);
            }
            const dayModal = document.getElementById('dayPersonalTasksModal');
            if (dayModal && dayModal.classList.contains('active')) {
                renderDayPersonalTasksModal();
            }
            const detailModal = document.getElementById('taskDetailModal');
            if (detailModal && detailModal.classList.contains('active') && taskDetailId) {
                renderTaskDetail();
            }
        }

        async function handleRealtimeChange() {
            if (!appInitialized) return;
            if (isUserTypingInApp() || realtimeInFlight) {
                realtimeRefreshPending = true;
                return;
            }
            realtimeInFlight = true;
            realtimeRefreshPending = false;
            try {
                // Las ausencias van aparte: loadDataFromSupabase no las lee
                // (y su destructuring posicional no admite colarlas ahí).
                // El directorio también: un alta o baja hecha por un admin
                // tiene que llegar a los selectores de todos sin recargar.
                await Promise.all([loadDataFromSupabase(true), loadTeamVacations(), loadUserDirectory(true)]);
                if (!isMemberActive(currentUser)) {
                    showToast('Your account is no longer active.', 'warning');
                    setTimeout(logoutCurrentUser, 1500);
                    return;
                }
                syncTeamMembersInSelectors();
                syncAdminNavButton();
                renderActiveView();
                refreshOpenOverlays();
            } finally {
                realtimeInFlight = false;
                if (realtimeRefreshPending) setTimeout(handleRealtimeChange, 50);
            }
        }

        document.addEventListener('focusout', () => {
            if (!realtimeRefreshPending) return;
            setTimeout(() => {
                if (realtimeRefreshPending && !isUserTypingInApp()) handleRealtimeChange();
            }, 50);
        });

        ['projects', 'daily_comments', 'project_notes', 'project_weekly_tasks', 'project_incidents', 'team_vacations', DAY_PERSONAL_TASKS_TABLE, DAY_TASKS_TABLE, CAPACITY_OVERRIDES_TABLE, APP_USERS_TABLE]
            .forEach(table => {
                supabaseClient
                    .channel(`${table}-changes`)
                    .on('postgres_changes', { event: '*', schema: 'public', table }, handleRealtimeChange)
                    .subscribe();
            });


        // =====================================================
        // =================== VISTA DE EQUIPO =================
        // (calendario, vacaciones, resúmenes de equipo, etc.)
        // =====================================================


        // Team calendar view mode: 'week' | 'month' | 'year'
        let teamViewMode = 'year';
        let teamRefDate = new Date();

        function setTeamViewMode(mode) {
            if (!['week', 'month', 'year'].includes(mode)) return;
            teamViewMode = mode;
            renderTeamView();
        }

        function teamPrev() {
            if (teamViewMode === 'year') currentMonth = new Date(currentMonth.getFullYear() - 1, 0, 1);
            else if (teamViewMode === 'month') teamRefDate = new Date(teamRefDate.getFullYear(), teamRefDate.getMonth() - 1, 1);
            else teamRefDate = new Date(teamRefDate.getFullYear(), teamRefDate.getMonth(), teamRefDate.getDate() - 7);
            renderTeamView();
        }

        function teamNext() {
            if (teamViewMode === 'year') currentMonth = new Date(currentMonth.getFullYear() + 1, 0, 1);
            else if (teamViewMode === 'month') teamRefDate = new Date(teamRefDate.getFullYear(), teamRefDate.getMonth() + 1, 1);
            else teamRefDate = new Date(teamRefDate.getFullYear(), teamRefDate.getMonth(), teamRefDate.getDate() + 7);
            renderTeamView();
        }

        function teamToday() {
            teamRefDate = new Date();
            currentMonth = new Date();
            renderTeamView();
        }

        function renderTeamView() {
            const container = document.getElementById('teamView');

            const year = currentMonth.getFullYear();
            // Aviso por región: "Alicante, Mumbai" en vez de un genérico,
            // para que se sepa qué calendario falta por cargar.
            const visibleYear = teamViewMode === 'year' ? year : teamRefDate.getFullYear();
            const pendingRegions = getPendingHolidayRegions(visibleYear).map(r => HOLIDAY_REGION_LABEL[r] || r);
            const holidayCalendarStatus = pendingRegions.length
                ? `<div class="holiday-calendar-status holiday-calendar-status--pending" role="status">${visibleYear} public holidays still incomplete for ${escapeHtml(pendingRegions.join(', '))}: local holidays not published yet.</div>`
                : '';

            // Navigation label depends on the active view mode.
            let navLabel;
            if (teamViewMode === 'year') {
                navLabel = `${year}`;
            } else if (teamViewMode === 'month') {
                navLabel = teamRefDate.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
            } else {
                const ws = getMonday(teamRefDate);
                const we = new Date(ws); we.setDate(we.getDate() + 6);
                const opt = { day: 'numeric', month: 'short' };
                navLabel = `${ws.toLocaleDateString('en-GB', opt)} – ${we.toLocaleDateString('en-GB', opt)}, ${ws.getFullYear()}`;
            }

            const segBtn = (mode, label) =>
                `<button type="button" class="team-view-seg-btn${teamViewMode === mode ? ' active' : ''}" aria-pressed="${teamViewMode === mode}" onclick="setTeamViewMode('${mode}')">${label}</button>`;

            let html = `
    <div class="team-header">
        <div class="team-view-toggle" role="group" aria-label="Calendar range">
            ${segBtn('week', 'Week')}${segBtn('month', 'Month')}${segBtn('year', 'Year')}
        </div>
        <div class="month-navigation">
            <button type="button" class="month-nav-btn" onclick="teamPrev()" aria-label="Previous">←</button>
            <button type="button" class="month-nav-btn" onclick="teamToday()">Today</button>
            <div class="current-month">${navLabel}</div>
            <button type="button" class="month-nav-btn" onclick="teamNext()" aria-label="Next">→</button>
        </div>
        <div class="calendar-zoom-controls">
            <button type="button" class="zoom-btn" onclick="zoomCalendar(-1)" title="Zoom out" aria-label="Zoom out">−</button>
            <span class="zoom-label">Zoom</span>
            <button type="button" class="zoom-btn" onclick="zoomCalendar(1)" title="Zoom in" aria-label="Zoom in">+</button>
        </div>
        <button type="button" class="month-nav-btn month-nav-btn--accent" onclick="openVacationModal()">+ Add leave${selectedVacationDays.length ? ` (${selectedVacationDays.length})` : ''}</button>
    </div>
    ${holidayCalendarStatus}
    <div class="calendar-help">
        <p class="calendar-hint">Click a day in your own row to mark leave. Ctrl+Click to select several days, then press “Add leave”. Click a marked day to remove it.</p>
        <ul class="calendar-legend" aria-label="Calendar legend">
            <li class="legend-filterable${vacationLegendFilter === 'current_year' ? ' legend-active' : ''}" tabindex="0" role="button" onclick="toggleVacationLegendFilter('current_year')" onkeydown="activateOnEnterOrSpace(event)" title="Highlight current year only"><span class="legend-swatch legend-swatch--current"></span>Current year</li>
            <li class="legend-filterable${vacationLegendFilter === 'previous_year' ? ' legend-active' : ''}" tabindex="0" role="button" onclick="toggleVacationLegendFilter('previous_year')" onkeydown="activateOnEnterOrSpace(event)" title="Highlight previous year only"><span class="legend-swatch legend-swatch--previous"></span>Previous year</li>
            <li class="legend-filterable${vacationLegendFilter === 'next_year' ? ' legend-active' : ''}" tabindex="0" role="button" onclick="toggleVacationLegendFilter('next_year')" onkeydown="activateOnEnterOrSpace(event)" title="Highlight next year only"><span class="legend-swatch legend-swatch--next"></span>Next year</li>
            <li class="legend-filterable${vacationLegendFilter === 'willis_choice' ? ' legend-active' : ''}" tabindex="0" role="button" onclick="toggleVacationLegendFilter('willis_choice')" onkeydown="activateOnEnterOrSpace(event)" title="Highlight WTW Choice only"><span class="legend-swatch legend-swatch--willis"></span>WTW Choice</li>
            <li class="legend-filterable${vacationLegendFilter === 'absence' ? ' legend-active' : ''}" tabindex="0" role="button" onclick="toggleVacationLegendFilter('absence')" onkeydown="activateOnEnterOrSpace(event)" title="Highlight absences that do not use the leave balance"><span class="legend-swatch legend-swatch--absence"></span>Absence (not charged)</li>
            <li title="Morning off: top-left half. Afternoon off: bottom-right half."><span class="legend-swatch legend-swatch--half"></span>Half day</li>
            <li><span class="legend-swatch legend-swatch--selected"></span>Selected</li>
            <li><span class="legend-swatch legend-swatch--holiday"></span>Public holiday</li>
            <li><span class="legend-swatch legend-swatch--weekend"></span>Weekend</li>
            <li><span class="legend-swatch legend-swatch--today"></span>Today</li>
        </ul>
    </div>
`;

            // Calendar (per active mode)
            if (teamViewMode === 'week') html += renderTeamWeekCalendar();
            else if (teamViewMode === 'month') html += renderTeamMonthCalendar();
            else html += renderMonthCalendar();

            // Vacation summary
            html += renderVacationSummary();

            container.innerHTML = html;
            // Re-apply the zoom after each render (CSS vars are lost when the DOM is rewritten)
            applyZoom();
        }

        // Builds a single calendar body cell for a member/date, with per-person
        // holidays. `extra` adds view-specific classes (e.g. month-separator).
        function buildTeamDayCell(member, date, extra = '') {
            const dateKey = formatDateKey(date);
            const todayKey = formatDateKey(new Date());
            const dayOfWeek = date.getDay();
            const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
            const holidayName = getHolidayName(getMemberRegion(member), dateKey);
            const isHoliday = !!holidayName;

            const vacation = teamVacations.find(v =>
                v.user_initials === member && dateKey >= v.start_date && dateKey <= v.end_date
            );
            const isSelected = selectedVacationDays.some(d => d.member === member && d.dateKey === dateKey);

            let cellClass = extra;
            if (isWeekend) cellClass += ' weekend';
            if (isHoliday) cellClass += ' holiday';
            if (isSelected) cellClass += ' vacation-selected';
            if (dateKey === todayKey) cellClass += ' today-cell';
            if (vacation) {
                const legendKey = isVacationAbsence(vacation) ? vacation.vacation_type : 'absence';
                if (legendKey === 'absence') cellClass += ' absence-other';
                else if (vacation.vacation_type === 'current_year') cellClass += ' vacation-current-year';
                else if (vacation.vacation_type === 'previous_year') cellClass += ' vacation-previous-year';
                else if (vacation.vacation_type === 'next_year') cellClass += ' vacation-next-year';
                else if (vacation.vacation_type === 'willis_choice') cellClass += ' vacation-willis-choice';
                if (vacationLegendFilter && legendKey !== vacationLegendFilter) cellClass += ' legend-dim';
                if (isHalfDayLeave(vacation)) cellClass += ` leave-half leave-half--${getDayPortion(vacation)}`;
            }

            const portionText = vacation && isHalfDayLeave(vacation) ? ` (${DAY_PORTIONS[getDayPortion(vacation)].toLowerCase()} only)` : '';
            const tooltip = `${member} · ${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}${isHoliday ? ` · Public holiday: ${holidayName}` : ''}${vacation ? ` · ${describeAbsenceFor(vacation, currentUser)}${portionText}` : ''}`;
            return `<td class="${cellClass.trim()}" onclick="toggleVacation('${member}', '${dateKey}', event)" title="${escapeHtml(tooltip)}"></td>`;
        }

        // YEAR view: two stacked semesters (original layout).
        function renderMonthCalendar() {
            const year = currentMonth.getFullYear();

            const semesters = [
                { label: 'H1', months: [0, 1, 2, 3, 4, 5] },
                { label: 'H2', months: [6, 7, 8, 9, 10, 11] }
            ];

            let html = '';

            semesters.forEach(semester => {
                html += `<div class="semester-block">
    <div class="semester-label">${semester.label} · ${year}</div>
    <div class="calendar-scroll-container">
    <table class="calendar-table calendar-table--compact">`;

                // THEAD: month labels + day numbers
                html += `<thead><tr>`;
                html += `<th class="name-column"></th>`;

                semester.months.forEach((m, idx) => {
                    const daysInMonth = new Date(year, m + 1, 0).getDate();
                    const monthName = new Date(year, m, 1).toLocaleDateString('en-GB', { month: 'long' });
                    const sep = idx > 0 ? ' month-separator' : '';
                    html += `<th class="month-header${sep}" colspan="${daysInMonth}">${monthName}</th>`;
                });
                html += `</tr><tr>`;
                html += `<th class="name-column"></th>`;

                semester.months.forEach((m, monthIndex) => {
                    const daysInMonth = new Date(year, m + 1, 0).getDate();
                    for (let day = 1; day <= daysInMonth; day++) {
                        const dayOfWeek = new Date(year, m, day).getDay();
                        const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
                        const weekendClass = isWeekend ? ' weekend-header' : '';
                        const sepClass = (day === 1 && monthIndex > 0) ? ' month-separator' : '';
                        html += `<th class="day-header${weekendClass}${sepClass}">${day}</th>`;
                    }
                });
                html += `</tr></thead>`;

                // TBODY: member rows
                html += `<tbody>`;
                teamMembers.forEach(member => {
                    html += `<tr><td class="name-column">${member}</td>`;
                    semester.months.forEach((m, monthIndex) => {
                        const daysInMonth = new Date(year, m + 1, 0).getDate();
                        for (let day = 1; day <= daysInMonth; day++) {
                            const extra = (day === 1 && monthIndex > 0) ? 'month-separator' : '';
                            html += buildTeamDayCell(member, new Date(year, m, day), extra);
                        }
                    });
                    html += `</tr>`;
                });
                html += `</tbody></table><div class="today-line"></div></div></div>`;
            });

            return html;
        }

        // MONTH view: one month, day columns.
        function renderTeamMonthCalendar() {
            const year = teamRefDate.getFullYear();
            const m = teamRefDate.getMonth();
            const daysInMonth = new Date(year, m + 1, 0).getDate();
            const weekdayInitials = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

            let html = `<div class="semester-block">
    <div class="calendar-scroll-container">
    <table class="calendar-table calendar-table--compact calendar-table--month">`;

            // Weekday initials
            html += `<thead><tr><th class="name-column"></th>`;
            for (let day = 1; day <= daysInMonth; day++) {
                const dow = new Date(year, m, day).getDay();
                const we = (dow === 0 || dow === 6) ? ' weekend-header' : '';
                html += `<th class="day-header${we}">${weekdayInitials[dow]}</th>`;
            }
            html += `</tr><tr><th class="name-column"></th>`;
            for (let day = 1; day <= daysInMonth; day++) {
                const dow = new Date(year, m, day).getDay();
                const we = (dow === 0 || dow === 6) ? ' weekend-header' : '';
                html += `<th class="day-header${we}">${day}</th>`;
            }
            html += `</tr></thead><tbody>`;

            teamMembers.forEach(member => {
                html += `<tr><td class="name-column">${member}</td>`;
                for (let day = 1; day <= daysInMonth; day++) {
                    html += buildTeamDayCell(member, new Date(year, m, day));
                }
                html += `</tr>`;
            });
            html += `</tbody></table><div class="today-line"></div></div></div>`;
            return html;
        }

        // WEEK view: 7 days of the week containing teamRefDate.
        function renderTeamWeekCalendar() {
            const ws = getMonday(teamRefDate);
            const days = [];
            for (let i = 0; i < 7; i++) {
                const d = new Date(ws); d.setDate(ws.getDate() + i); days.push(d);
            }

            let html = `<div class="semester-block">
    <div class="calendar-scroll-container">
    <table class="calendar-table calendar-table--week">`;

            html += `<thead><tr><th class="name-column"></th>`;
            days.forEach(d => {
                const dow = d.getDay();
                const we = (dow === 0 || dow === 6) ? ' weekend-header' : '';
                const name = d.toLocaleDateString('en-GB', { weekday: 'short' });
                const dateStr = d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
                html += `<th class="week-day-header${we}">${name}<br><span class="week-day-date">${dateStr}</span></th>`;
            });
            html += `</tr></thead><tbody>`;

            teamMembers.forEach(member => {
                html += `<tr><td class="name-column">${member}</td>`;
                days.forEach(d => { html += buildTeamDayCell(member, d); });
                html += `</tr>`;
            });
            html += `</tbody></table><div class="today-line"></div></div></div>`;
            return html;
        }



        function renderVacationSummary() {
            const currentYear = new Date().getFullYear();
            const availableYears = [...new Set([
                currentYear,
                currentYear - 1,
                currentYear + 1,
                currentMonth.getFullYear(),
                ...teamVacations.map(getVacationAccrualYear).filter(Number.isInteger)
            ])].sort((a, b) => b - a);
            if (!availableYears.includes(vacationBalanceYear)) {
                vacationBalanceYear = currentYear;
            }

            // Calcular totales por usuario. Solo las vacaciones restan saldo;
            // bajas y asuntos personales van aparte y por año natural.
            const sumDays = list => list.reduce((sum, v) => sum + getLeaveDays(v), 0);
            const summary = teamMembers.map(member => {
                const own = teamVacations.filter(v => v.user_initials === member);
                const charged = own.filter(v => isVacationAbsence(v) && getVacationAccrualYear(v) === vacationBalanceYear);
                const vacationDays = sumDays(charged.filter(v => v.vacation_type !== 'willis_choice'));
                const willisChoiceDays = sumDays(charged.filter(v => v.vacation_type === 'willis_choice'));

                const otherAbsences = own.filter(v =>
                    !isVacationAbsence(v) && Number(String(v.start_date || '').slice(0, 4)) === vacationBalanceYear);
                const otherByType = {};
                otherAbsences.forEach(v => {
                    const type = getAbsenceType(v);
                    otherByType[type] = (otherByType[type] || 0) + getLeaveDays(v);
                });

                return {
                    member,
                    vacationDays,
                    willisChoiceDays,
                    otherDays: sumDays(otherAbsences),
                    otherByType,
                    total: vacationDays + willisChoiceDays
                };
            });

            // El desglose por motivo solo para el titular; el resto ve el total.
            const describeOtherAbsences = s => {
                if (!s.otherDays) return '';
                if (s.member !== normalizeInitials(currentUser || '')) return `${formatLeaveDays(s.otherDays)} absent`;
                return Object.entries(s.otherByType)
                    .map(([type, days]) => `${formatLeaveDays(days)} ${ABSENCE_TYPES[type].toLowerCase()}`)
                    .join(' · ');
            };

            return `
        <div class="vacation-summary">
            <div class="vacation-summary-heading">
                <h3 class="summary-title">Leave usage</h3>
                <label class="vacation-year-filter">
                    <span>Usage year</span>
                    <select aria-label="Leave usage year" onchange="setVacationBalanceYear(this.value)">
                        ${availableYears.map(year => `<option value="${year}" ${year === vacationBalanceYear ? 'selected' : ''}>${year}</option>`).join('')}
                    </select>
                </label>
            </div>

            <div class="vacation-balance-list">
                ${summary.map(s => {
                    const pct = Math.min(100, Math.round((s.vacationDays / STANDARD_VACATION_DAYS_PER_YEAR) * 100));
                    const barColor = s.vacationDays > STANDARD_VACATION_DAYS_PER_YEAR ? 'balance-negative'
                        : pct >= 80 ? 'balance-attention' : 'balance-positive';
                    return `
                    <div class="vacation-balance-row">
                        <div class="vacation-balance-name">${s.member}</div>
                        <div class="vacation-balance-track" role="progressbar" aria-valuenow="${s.vacationDays}" aria-valuemin="0" aria-valuemax="${STANDARD_VACATION_DAYS_PER_YEAR}">
                            <div class="vacation-balance-fill ${barColor}" style="width:${pct}%"></div>
                        </div>
                        <div class="vacation-balance-figure u-figure">${s.vacationDays.toFixed(1)}<span class="vacation-balance-max">/${STANDARD_VACATION_DAYS_PER_YEAR}</span></div>
                        ${s.willisChoiceDays ? `<div class="vacation-balance-willis">+${s.willisChoiceDays.toFixed(1)} WTW</div>` : ''}
                        ${s.otherDays ? `<div class="vacation-balance-other" title="Not charged to the leave balance">${escapeHtml(describeOtherAbsences(s))}</div>` : ''}
                    </div>`;
                }).join('')}
            </div>
            <p class="chart-footnote">Balance bar against ${STANDARD_VACATION_DAYS_PER_YEAR} reference days/year (adjustable). WTW Choice is shown separately, with no fixed cap. Sick leave and personal matters never use the balance.</p>

            ${buildVacationMonthDistributionHtml(vacationBalanceYear)}
        </div>
    `;
        }

        function buildVacationMonthDistributionHtml(year) {
            const monthTotals = new Array(12).fill(0);
            teamVacations.forEach(v => {
                if (!v.start_date || !v.end_date) return;
                const start = new Date(v.start_date);
                const end = new Date(v.end_date);
                if (isNaN(start) || isNaN(end)) return;
                const cursor = new Date(start);
                const perDay = isHalfDayLeave(v) ? 0.5 : 1;
                while (cursor <= end) {
                    if (cursor.getFullYear() === year) {
                        monthTotals[cursor.getMonth()] += perDay;
                    }
                    cursor.setDate(cursor.getDate() + 1);
                }
            });

            const maxTotal = Math.max(...monthTotals, 1);
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            const bars = monthTotals.map((total, i) => {
                const heightPct = Math.max(Math.round((total / maxTotal) * 100), total > 0 ? 6 : 0);
                return `
                <div class="vacation-month-bar-wrap" title="${monthNames[i]} ${year}: ${formatLeaveDays(total)} person-day(s)">
                    <div class="vacation-month-bar" style="height:${heightPct}%"></div>
                    <span class="vacation-month-bar-label">${monthNames[i]}</span>
                </div>`;
            }).join('');

            return `
            <div class="vacation-month-distribution">
                <h4 class="chart-title">Leave concentration by month (${year})</h4>
                <div class="vacation-month-bar-chart">${bars}</div>
            </div>`;
        }

        function getVacationAccrualYear(vacation) {
            const storedYear = Number(vacation.vacation_year);
            if (Number.isInteger(storedYear) && storedYear > 0) return storedYear;

            const dateYear = Number(String(vacation.start_date || '').slice(0, 4));
            return vacation.vacation_type === 'previous_year' ? dateYear - 1 : dateYear;
        }

        function toggleVacationLegendFilter(type) {
            vacationLegendFilter = vacationLegendFilter === type ? null : type;
            renderTeamView();
        }

        function setVacationBalanceYear(year) {
            const parsedYear = Number(year);
            if (!Number.isInteger(parsedYear)) return;
            vacationBalanceYear = parsedYear;
            renderTeamView();
        }



        function applyZoom() {
            const { w, font, hdrH } = ZOOM_LEVELS[calendarZoom];
            document.querySelectorAll('.calendar-table--compact').forEach(t => {
                t.style.setProperty('--day-w',     w    + 'px');
                t.style.setProperty('--day-font',  font + 'px');
                t.style.setProperty('--day-hdr-h', hdrH + 'px');
            });
            // Reposicionar línea de hoy: primer intento rápido + segundo de seguridad
            // (en el primer render el layout puede no estar listo a los 50ms)
            setTimeout(positionTodayLines, 50);
            setTimeout(positionTodayLines, 600);
        }

        function positionTodayLines() {
            document.querySelectorAll('.today-line').forEach(line => {
                const container = line.parentElement;
                const table     = container.querySelector('table');
                const todayCell = table ? table.querySelector('tbody td.today-cell') : null;
                if (!todayCell) { line.style.display = 'none'; return; }

                // offsetLeft es relativo al offsetParent = .calendar-scroll-container (position:relative)
                // offsetWidth captura el ancho real de la celda incluyendo borders
                line.style.display = 'block';
                line.style.left   = todayCell.offsetLeft + 'px';
                line.style.width  = todayCell.offsetWidth + 'px';
                line.style.height = table.offsetHeight + 'px';
            });
        }

        function zoomCalendar(dir) {
            calendarZoom = Math.max(0, Math.min(ZOOM_LEVELS.length - 1, calendarZoom + dir));
            applyZoom();
        }

        function previousYear() {
            currentMonth = new Date(currentMonth.getFullYear() - 1, 0, 1);
            renderTeamView();
        }

        function nextYear() {
            currentMonth = new Date(currentMonth.getFullYear() + 1, 0, 1);
            renderTeamView();
        }

        function setSidebarCollapsed(collapsed) {
            const sidebar = document.getElementById('sidebar');
            const btn = document.getElementById('sidebarToggle');
            if (!sidebar) return;
            sidebar.classList.toggle('collapsed', collapsed);
            if (btn) {
                btn.textContent = collapsed ? '▶' : '◀';
                btn.title = collapsed ? 'Expand panel' : 'Collapse panel';
                btn.setAttribute('aria-label', btn.title);
                btn.setAttribute('aria-expanded', String(!collapsed));
            }
        }

        function toggleSidebar() {
            const sidebar = document.getElementById('sidebar');
            if (!sidebar) return;
            if (window.matchMedia('(max-width: 768px)').matches) {
                closeMobileSidebar();
                return;
            }
            setSidebarCollapsed(!sidebar.classList.contains('collapsed'));
            sidebarAutoCollapsed = false; // el usuario ha decidido manualmente
        }

        function toggleMobileSidebar() {
            const sidebar = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebarBackdrop');
            const menuButton = document.getElementById('mobileMenuToggle');
            if (!sidebar || !backdrop || !menuButton) return;

            const isOpen = sidebar.classList.toggle('mobile-open');
            backdrop.classList.toggle('active', isOpen);
            menuButton.setAttribute('aria-expanded', String(isOpen));
            document.body.classList.toggle('mobile-sidebar-open', isOpen);
            const sidebarToggle = document.getElementById('sidebarToggle');
            if (sidebarToggle) {
                sidebarToggle.textContent = isOpen ? '×' : '◀';
                sidebarToggle.title = isOpen ? 'Close menu' : 'Collapse panel';
                sidebarToggle.setAttribute('aria-label', sidebarToggle.title);
            }
            if (isOpen && sidebarToggle) sidebarToggle.focus();
        }

        function closeMobileSidebar() {
            const sidebar = document.getElementById('sidebar');
            const backdrop = document.getElementById('sidebarBackdrop');
            const menuButton = document.getElementById('mobileMenuToggle');
            if (!sidebar || !backdrop || !menuButton) return;

            sidebar.classList.remove('mobile-open');
            backdrop.classList.remove('active');
            menuButton.setAttribute('aria-expanded', 'false');
            document.body.classList.remove('mobile-sidebar-open');
            const sidebarToggle = document.getElementById('sidebarToggle');
            if (sidebarToggle) {
                sidebarToggle.textContent = '◀';
                sidebarToggle.title = 'Collapse panel';
                sidebarToggle.setAttribute('aria-label', sidebarToggle.title);
            }
            if (document.activeElement && sidebar.contains(document.activeElement)) menuButton.focus();
        }

        function toggleVacation(member, dateKey, event) {
            if (member !== currentUser) {
                showToast('You can only mark your own leave', 'warning');
                return;
            }

            // Si es Ctrl+Clic, agregar a la selección múltiple
            if (event && event.ctrlKey) {
                event.preventDefault();
                const index = selectedVacationDays.findIndex(
                    d => d.member === member && d.dateKey === dateKey
                );

                if (index > -1) {
                    // Ya está seleccionado, remover
                    selectedVacationDays.splice(index, 1);
                } else {
                    // Agregar a la selección
                    selectedVacationDays.push({ member, dateKey });
                }

                renderTeamView();
                return;
            }

            // Clic normal: verificar si ya existe vacación en este día
            const existing = teamVacations.find(v =>
                v.user_initials === member &&
                v.start_date <= dateKey &&
                v.end_date >= dateKey
            );

            // Si existe vacación, permitir eliminarla siempre
            if (existing) {
                const confirmDelete = confirm(isHalfDayLeave(existing)
                    ? `Remove this half-day leave (${DAY_PORTIONS[getDayPortion(existing)].toLowerCase()})?`
                    : `Remove ${formatLeaveDays(getLeaveDays(existing))} leave day(s)?`);
                if (confirmDelete) {
                    deleteVacation(existing.id);
                }
                return;
            }

            // Si NO es Ctrl+Clic y hay selecciones previas sin vacaciones, mostrar alerta
            if (selectedVacationDays.length > 0) {
                showToast('You already have days selected. Use the “Add leave” button to confirm, or Ctrl+Click the days to deselect them.', 'warning');
                return;
            }

            // Comportamiento normal: clic simple sin selecciones previas y sin vacaciones existentes
            showVacationOptionsModal(member, dateKey, [dateKey]);
        }

        function showVacationOptionsModal(member, startDateKey, dateKeysArray = []) {
            const currentYear = new Date().getFullYear();
            const previousYear = currentYear - 1;
            const datesToAdd = [...new Set(dateKeysArray.length > 0 ? dateKeysArray : [startDateKey])].filter(Boolean);
            const modal = document.getElementById('vacationOptionsModal');
            const typeSelect = document.getElementById('vacationTypeSelect');
            const absenceSelect = document.getElementById('absenceTypeSelect');
            const selectionLabel = document.getElementById('vacationSelectionLabel');
            if (!modal || !typeSelect || !absenceSelect || !selectionLabel || datesToAdd.length === 0) return;

            pendingVacationSelection = { member, dates: datesToAdd };
            absenceSelect.innerHTML = Object.entries(ABSENCE_TYPES)
                .map(([value, label]) => `<option value="${value}">${label}</option>`).join('');
            typeSelect.innerHTML = `
                <option value="current_year">Current year (${currentYear})</option>
                <option value="previous_year">Previous year (${previousYear})</option>
                <option value="next_year">Next year (${currentYear + 1})</option>
                <option value="willis_choice">WTW Choice (${currentYear})</option>
            `;
            // Medio día solo con un día seleccionado: con varios, cada día
            // es completo (un medio día suelto se marca aparte).
            const single = datesToAdd.length === 1;
            document.querySelectorAll('input[name="leaveDayPortion"]').forEach(r => {
                r.checked = r.value === 'full';
                if (r.value !== 'full') r.disabled = !single;
            });
            const portionHint = document.getElementById('leaveDayPortionHint');
            if (portionHint) portionHint.hidden = single;
            onLeaveDayPortionChange();
            onAbsenceTypeChange();
            openModal('vacationOptionsModal', '#absenceTypeSelect');
        }

        // Solo las vacaciones cargan saldo: para el resto se oculta el selector.
        function onAbsenceTypeChange() {
            const absenceSelect = document.getElementById('absenceTypeSelect');
            const group = document.getElementById('vacationTypeGroup');
            const hint = document.getElementById('absenceTypeHint');
            const isVacation = !absenceSelect || absenceSelect.value === 'vacation';
            if (group) group.hidden = !isVacation;
            if (hint) {
                hint.textContent = isVacation
                    ? 'Uses your leave balance.'
                    : 'Does not use your leave balance. Only you see the reason; the team sees “Absent”.';
            }
        }

        function getSelectedLeaveDayPortion() {
            const checked = document.querySelector('input[name="leaveDayPortion"]:checked');
            const value = checked ? checked.value : 'full';
            return DAY_PORTIONS[value] ? value : 'full';
        }

        function onLeaveDayPortionChange() {
            const label = document.getElementById('vacationSelectionLabel');
            if (!label || !pendingVacationSelection) return;
            const count = pendingVacationSelection.dates.length;
            const portion = getSelectedLeaveDayPortion();
            label.textContent = portion === 'full'
                ? `${count} ${count === 1 ? 'full day' : 'full days'}`
                : `Half day · ${DAY_PORTIONS[portion].toLowerCase()} (counts as 0.5 days)`;
        }

        function closeVacationOptionsModal() {
            closeModal('vacationOptionsModal');
            pendingVacationSelection = null;
        }

        async function saveVacationSelection() {
            if (!pendingVacationSelection) return;

            const absenceSelect = document.getElementById('absenceTypeSelect');
            const absenceType = absenceSelect ? absenceSelect.value : 'vacation';
            if (!ABSENCE_TYPES[absenceType]) return;

            const typeSelect = document.getElementById('vacationTypeSelect');
            const vacationType = absenceType === 'vacation' ? (typeSelect && typeSelect.value) : 'not_charged';
            if (absenceType === 'vacation' && !CHARGED_VACATION_TYPES.includes(vacationType)) return;

            const currentYear = new Date().getFullYear();
            const vacationYear = vacationType === 'previous_year' ? currentYear - 1
                : vacationType === 'next_year' ? currentYear + 1
                : currentYear;
            const selection = pendingVacationSelection;
            const dayPortion = selection.dates.length === 1 ? getSelectedLeaveDayPortion() : 'full';
            closeVacationOptionsModal();
            await addVacationWithDateRange(selection.member, selection.dates, vacationType, vacationYear, absenceType, dayPortion);
        }

        async function addVacationWithDateRange(member, dateKeysArray, vacationType, vacationYear, absenceType = 'vacation', dayPortion = 'full') {
            if (!dateKeysArray || dateKeysArray.length === 0) return;

            // Weekends and public holidays are non-working days, so they never
            // count as leave: drop them before inserting.
            const requested = dateKeysArray.length;
            dateKeysArray = dateKeysArray.filter(dateKey => {
                const d = new Date(dateKey + 'T00:00:00');
                const dow = d.getDay();
                if (dow === 0 || dow === 6) return false;
                if (isHolidayForMember(member, dateKey)) return false;
                return true;
            });
            selectedVacationDays = [];
            if (dateKeysArray.length === 0) {
                renderTeamView();
                showToast('Those days are weekends or public holidays — not counted as leave.', 'info');
                return;
            }
            if (dateKeysArray.length < requested) {
                showToast(`${requested - dateKeysArray.length} weekend/holiday day(s) skipped (non-working days).`, 'info');
            }

            // One independent record per day so individual days can be removed
            // without affecting the rest.
            const vacationRecords = dateKeysArray.map(dateKey => ({
                user_initials: member,
                start_date: dateKey,
                end_date: dateKey,
                status: 'planned',
                vacation_type: vacationType,
                vacation_year: vacationYear,
                absence_type: absenceType,
                // days_count es integer: el medio día va en day_portion.
                days_count: 1,
                day_portion: dayPortion
            }));

            const { error } = await supabaseClient
                .from('team_vacations')
                .insert(vacationRecords);

            if (error) {
                console.error(error);
                showToast('Error adding leave', 'error');
                return;
            }

            selectedVacationDays = [];
            await loadTeamVacations();
            renderTeamView();
            const label = absenceType === 'vacation' ? 'leave' : ABSENCE_TYPES[absenceType].toLowerCase();
            showToast(dayPortion !== 'full'
                ? `Half day of ${label} added (${DAY_PORTIONS[dayPortion].toLowerCase()})`
                : `${vacationRecords.length} ${label} day${vacationRecords.length === 1 ? '' : 's'} added`, 'success');
        }

        async function deleteVacation(vacationId) {
            const { error } = await supabaseClient
                .from('team_vacations')
                .delete()
                .eq('id', vacationId);

            if (error) {
                console.error(error);
                showToast('Error removing leave', 'error');
                return;
            }

            await loadTeamVacations();
            renderTeamView();
            showToast('Leave removed', 'success');
        }

        async function loadTeamVacations() {
            const { data, error } = await supabaseClient
                .from('team_vacations')
                .select('*')
                .order('start_date', { ascending: true });

            if (error) {
                console.error(error);
                return;
            }

            teamVacations = data;
        }

        function openVacationModal() {
            if (selectedVacationDays.length === 0) {
                showToast('Please select days using Ctrl+Click on the calendar', 'info');
                return;
            }

            // Agrupar por miembro (debería haber solo uno, pero lo hacemos robusto)
            const members = [...new Set(selectedVacationDays.map(d => d.member))];

            if (members.length > 1) {
                showToast('You have selected days from different team members. Please select only your own days.', 'warning');
                return;
            }

            const member = members[0];
            const dateKeys = selectedVacationDays.map(d => d.dateKey);

            showVacationOptionsModal(member, null, dateKeys);
        }



        function updateUserDisplay() {
            const userIconEl = document.querySelector('.user-icon');
            const userNameEl = document.getElementById('currentUserDisplay');
            if (!userIconEl) return;

            const initials = normalizeInitials(currentUser || 'US');
            userIconEl.textContent = initials.substring(0, 2);
            if (userNameEl) {
                userNameEl.textContent = '';
            }
        }

        function openUserSettingsModal() {
            const modal = document.getElementById('userSettingsModal');
            if (!modal) return;

            const profile = getCurrentUserProfile() || {
                initials: normalizeInitials(currentUser || ''),
                email: ''
            };

            const initialsInput = document.getElementById('settingsInitials');
            const emailInput = document.getElementById('settingsEmail');
            const passwordInput = document.getElementById('settingsPassword');
            const passwordConfirmInput = document.getElementById('settingsPasswordConfirm');
            const errorEl = document.getElementById('settingsError');

            if (initialsInput) initialsInput.value = profile.initials || '';
            if (emailInput) emailInput.value = profile.email || '';
            const weeklyHoursInput = document.getElementById('settingsWeeklyHours');
            if (weeklyHoursInput) weeklyHoursInput.value = normalizeWeeklyHours(profile.weeklyHours);
            if (passwordInput) passwordInput.value = '';
            if (passwordConfirmInput) passwordConfirmInput.value = '';
            if (errorEl) errorEl.textContent = '';

            openModal('userSettingsModal', '#settingsInitials');
        }

        function closeUserSettingsModal() {
            closeModal('userSettingsModal');
        }

        async function saveUserSettings() {
            const initialsInput = document.getElementById('settingsInitials');
            const emailInput = document.getElementById('settingsEmail');
            const passwordInput = document.getElementById('settingsPassword');
            const passwordConfirmInput = document.getElementById('settingsPasswordConfirm');
            const errorEl = document.getElementById('settingsError');
            if (!initialsInput || !emailInput || !passwordInput || !passwordConfirmInput || !errorEl) return;

            errorEl.textContent = '';

            const newInitials = normalizeInitials(initialsInput.value);
            const newEmail = normalizeEmail(emailInput.value);
            const newPassword = passwordInput.value || '';
            const newPasswordConfirm = passwordConfirmInput.value || '';

            if (!newInitials) {
                errorEl.textContent = 'Initials are required.';
                initialsInput.focus();
                return;
            }

            if (!newEmail || !newEmail.includes('@')) {
                errorEl.textContent = 'Enter a valid email.';
                emailInput.focus();
                return;
            }

            const currentInitials = normalizeInitials(currentUser);
            const existing = userDirectory[newInitials];
            if (existing && newInitials !== currentInitials) {
                errorEl.textContent = `Another user with initials ${newInitials} already exists.`;
                initialsInput.focus();
                return;
            }
            // Iniciales que ya aparecen en datos (de alguien que se las cambió
            // o se dio de baja): reutilizarlas mezclaría dos historiales.
            if (newInitials !== currentInitials && getTakenInitials().has(newInitials)) {
                errorEl.textContent = `${newInitials} was used by someone before. Pick other initials.`;
                initialsInput.focus();
                return;
            }
            // Cambiar de iniciales borra la fila antigua de app_users (decisión
            // de Teo, 28-oct-2026). El trabajo anterior no se toca: sigue con
            // las iniciales antiguas y deja de estar ligado a esta persona.
            if (newInitials !== currentInitials && !confirm(
                `Change your initials from ${currentInitials} to ${newInitials}?\n\n` +
                `Your previous projects and tasks will stay under ${currentInitials} (shown greyed out) and will no longer be linked to you. ` +
                `From now on you sign in as ${newInitials}.`)) {
                return;
            }

            if (newPassword || newPasswordConfirm) {
                if (newPassword.length < 6) {
                    errorEl.textContent = 'The password must be at least 6 characters.';
                    passwordInput.focus();
                    return;
                }
                if (newPassword !== newPasswordConfirm) {
                    errorEl.textContent = 'The password confirmation does not match.';
                    passwordConfirmInput.focus();
                    return;
                }
            }

            const existingProfile = getCurrentUserProfile() || {};
            const nextPasswordHash = newPassword
                ? await hashTextSha256(newPassword)
                : String(existingProfile.passwordHash || await getDefaultPasswordHash());

            try {
                await saveUserProfile(currentInitials, {
                    initials: newInitials,
                    email: newEmail,
                    passwordHash: nextPasswordHash,
                    weeklyHours: normalizeWeeklyHours(
                        (document.getElementById('settingsWeeklyHours') || {}).value
                    )
                });
            } catch (error) {
                errorEl.textContent = error && error.message ? error.message : 'Error saving settings.';
                return;
            }

            currentUser = newInitials;
            localStorage.setItem(APP_CURRENT_USER_STORAGE_KEY, currentUser);
            persistLoginSession(currentUser);

            updateUserDisplay();
            syncTeamMembersInSelectors();
            renderActiveView();
            refreshOpenOverlays();
            closeUserSettingsModal();
            showToast('Settings saved', 'success');
        }

        // =====================================================
        // ============ ADMIN: GESTIÓN DE USUARIOS =============
        // Solo para app_users.is_admin (Ana Real y Teo Balsalobre).
        // OJO: con RLS abierta esto es control de interfaz, no seguridad.
        // Dar de baja = is_active false: la persona sale de los selectores,
        // del calendario y de la capacidad futura, no puede entrar, y su
        // trabajo antiguo se sigue viendo con sus iniciales en gris.
        // Ver la skill team-member-lifecycle.
        // =====================================================

        const EMAIL_DOMAIN = 'wtwco.com';
        // Partículas que no cuentan como apellido para las iniciales
        // ("María de la Cruz" -> MC).
        const NAME_PARTICLES = ['de', 'del', 'la', 'las', 'los', 'y', 'da', 'das', 'do', 'dos', 'van', 'von', 'di'];

        let adminUserForm = { initialsEdited: false, emailEdited: false, created: null };

        function syncAdminNavButton() {
            const btn = document.getElementById('navAdminBtn');
            const isAdmin = isCurrentUserAdmin();
            if (btn) btn.hidden = !isAdmin;
            if (!isAdmin && currentView === 'admin') switchView('daily');
        }

        function toAsciiLetters(value) {
            return normalizeSearchText(value).replace(/[^a-z0-9 ]/g, ' ').trim();
        }

        function splitPersonName(firstName, lastName) {
            const given = toAsciiLetters(firstName).split(/\s+/).filter(Boolean);
            const surnames = toAsciiLetters(lastName).split(/\s+/).filter(w => w && !NAME_PARTICLES.includes(w));
            return { given, surnames };
        }

        // Todas las iniciales que ya significan algo: las del directorio
        // (activas o no) y las que aparecen en datos guardados, aunque ya no
        // estén en app_users (p. ej. las antiguas de quien se las cambió).
        // Reutilizarlas mezclaría el historial de dos personas.
        function getTakenInitials() {
            const taken = new Set(Object.keys(userDirectory));
            excludedResponsibles.forEach(i => taken.add(i));
            const add = value => { const i = normalizeInitials(value); if (i) taken.add(i); };
            projects.concat(deletedProjects || []).forEach(p => (p.responsibles || []).forEach(add));
            (dailyComments || []).forEach(c => { getTaskAssignees(c).forEach(add); add(c.userName); add(c.ownerInitials); });
            (dayTasks || []).forEach(t => { (t.assignees || []).forEach(add); add(t.createdBy); });
            (teamVacations || []).forEach(v => add(v.user_initials));
            return taken;
        }

        // Iniciales = 1ª letra del nombre + 1ª del primer apellido (Teo
        // Balsalobre -> TB). Si ya existen, se añade la inicial del segundo
        // apellido (Ana Real Gómez -> ARG). Si aun así chocan, o no hay
        // segundo apellido, un número. El admin las puede editar.
        function generateUserInitials(firstName, lastName, taken = getTakenInitials()) {
            const { given, surnames } = splitPersonName(firstName, lastName);
            if (!given.length || !surnames.length) return '';
            const base = (given[0][0] + surnames[0][0]).toUpperCase();
            if (!taken.has(base)) return base;
            if (surnames[1]) {
                const withSecond = base + surnames[1][0].toUpperCase();
                if (!taken.has(withSecond)) return withSecond;
            }
            for (let n = 2; n < 100; n++) {
                if (!taken.has(base + n)) return base + n;
            }
            return '';
        }

        function generateUserEmail(firstName, lastName) {
            const { given, surnames } = splitPersonName(firstName, lastName);
            if (!given.length || !surnames.length) return '';
            return `${given[0]}.${surnames[0]}@${EMAIL_DOMAIN}`;
        }

        function getMemberWorkSummary(initials) {
            const key = normalizeInitials(initials);
            const liveProjects = getLiveProjects().filter(p => (p.responsibles || []).includes(key)).length;
            const openTasks = (dailyComments || []).filter(c => !c.parentId && !c.completed && getTaskAssignees(c).includes(key)).length
                + (dayTasks || []).filter(t => !t.completed && (t.assignees || []).includes(key)).length;
            return { liveProjects, openTasks };
        }

        function renderAdminView() {
            const container = document.getElementById('adminView');
            if (!container) return;
            if (!isCurrentUserAdmin()) {
                container.innerHTML = '<div class="empty-state">Only admins can manage users.</div>';
                return;
            }

            const me = normalizeInitials(currentUser || '');
            const people = Object.values(userDirectory).sort((a, b) =>
                (a.isActive === b.isActive ? 0 : (a.isActive ? -1 : 1)) || a.initials.localeCompare(b.initials));
            const activeAdmins = people.filter(p => p.isAdmin && p.isActive).length;

            const rows = people.map(p => {
                const fullName = [p.firstName, p.lastName].filter(Boolean).join(' ');
                const nameHtml = fullName ? escapeHtml(fullName) : '<span class="admin-muted">No name</span>';
                const region = p.holidayRegion || getMemberRegion(p.initials);
                const isMe = p.initials === me;
                const lastAdmin = p.isAdmin && p.isActive && activeAdmins <= 1;
                const status = p.isActive
                    ? '<span class="admin-status admin-status--active">Active</span>'
                    : `<span class="admin-status admin-status--off">Unavailable${p.deactivatedAt ? ` since ${formatDateDisplay(String(p.deactivatedAt).slice(0, 10))}` : ''}</span>`;
                const actions = p.isActive
                    ? `<button type="button" class="comment-action-btn" onclick="toggleAdminRole(${jsArg(p.initials)})" ${isMe || (lastAdmin) ? 'disabled title="You cannot remove your own admin role or the last admin"' : ''}>${p.isAdmin ? 'Remove admin' : 'Make admin'}</button>
                       <button type="button" class="comment-action-btn" onclick="resetUserPassword(${jsArg(p.initials)})">Reset password</button>
                       <button type="button" class="comment-action-btn comment-action-btn--danger" onclick="deactivateUser(${jsArg(p.initials)})" ${isMe || lastAdmin ? 'disabled title="You cannot deactivate yourself or the last admin"' : ''}>Mark unavailable</button>`
                    : `<button type="button" class="comment-action-btn" onclick="reactivateUser(${jsArg(p.initials)})">Reactivate</button>`;
                return `<tr class="${p.isActive ? '' : 'admin-row--off'}">
                    <td><strong>${escapeHtml(p.initials)}</strong>${isMe ? ' <span class="admin-muted">(you)</span>' : ''}</td>
                    <td>${nameHtml}</td>
                    <td>${escapeHtml(p.email || '')}</td>
                    <td>${escapeHtml(HOLIDAY_REGION_LABEL[region] || region)}</td>
                    <td class="dash-num-center">${formatHours(p.weeklyHours)} h</td>
                    <td>${p.isAdmin ? '<span class="admin-role">Admin</span>' : 'Member'}</td>
                    <td>${status}</td>
                    <td class="admin-actions">${actions}</td>
                </tr>`;
            }).join('');

            container.innerHTML = `
                <div class="admin-header">
                    <div>
                        <h2 class="admin-title">Team members</h2>
                        <p class="admin-subtitle">New members sign in with their initials and the standard password. Marking someone unavailable keeps all their projects, tasks and hours; they just can no longer sign in or be picked.</p>
                    </div>
                    <button type="button" class="btn btn-primary admin-add-btn" onclick="openAdminUserModal()">+ Add member</button>
                </div>
                <div class="dashboard-table-container">
                    <table class="dashboard-table admin-table">
                        <thead><tr>
                            <th>Initials</th><th>Name</th><th>Email</th><th>Holidays</th><th>Week</th><th>Role</th><th>Status</th><th>Actions</th>
                        </tr></thead>
                        <tbody>${rows}</tbody>
                    </table>
                </div>`;
        }

        function openAdminUserModal() {
            if (!isCurrentUserAdmin()) return;
            adminUserForm = { initialsEdited: false, emailEdited: false, created: null };
            ['adminFirstName', 'adminLastName', 'adminInitials', 'adminEmail'].forEach(id => {
                const el = document.getElementById(id);
                if (el) el.value = '';
            });
            const regionSelect = document.getElementById('adminRegion');
            if (regionSelect) {
                regionSelect.innerHTML = Object.keys(HOLIDAYS_BY_REGION)
                    .map(code => `<option value="${escapeHtml(code)}">${escapeHtml(HOLIDAY_REGION_LABEL[code] || code)}</option>`).join('');
                regionSelect.value = FALLBACK_HOLIDAY_REGION;
            }
            const hours = document.getElementById('adminWeeklyHours');
            if (hours) hours.value = DEFAULT_WEEKLY_HOURS;
            const isAdminBox = document.getElementById('adminIsAdmin');
            if (isAdminBox) isAdminBox.checked = false;
            setAdminUserModalStep('form');
            openModal('adminUserModal', '#adminFirstName');
        }

        function closeAdminUserModal() {
            closeModal('adminUserModal');
            adminUserForm = { initialsEdited: false, emailEdited: false, created: null };
        }

        function setAdminUserModalStep(step) {
            const form = document.getElementById('adminUserFormStep');
            const done = document.getElementById('adminUserDoneStep');
            if (form) form.hidden = step !== 'form';
            if (done) done.hidden = step !== 'done';
            const errorEl = document.getElementById('adminUserError');
            if (errorEl) errorEl.textContent = '';
        }

        // Vista previa en vivo de iniciales y email mientras se escribe el
        // nombre, salvo que el admin ya los haya editado a mano.
        function onAdminNameInput() {
            const first = document.getElementById('adminFirstName').value;
            const last = document.getElementById('adminLastName').value;
            if (!adminUserForm.initialsEdited) document.getElementById('adminInitials').value = generateUserInitials(first, last);
            if (!adminUserForm.emailEdited) document.getElementById('adminEmail').value = generateUserEmail(first, last);
            updateAdminInitialsHint();
        }

        function onAdminInitialsInput() {
            adminUserForm.initialsEdited = true;
            const input = document.getElementById('adminInitials');
            input.value = input.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4);
            updateAdminInitialsHint();
        }

        function onAdminEmailInput() {
            adminUserForm.emailEdited = true;
        }

        function updateAdminInitialsHint() {
            const hint = document.getElementById('adminInitialsHint');
            if (!hint) return;
            const initials = normalizeInitials(document.getElementById('adminInitials').value);
            const { given, surnames } = splitPersonName(
                document.getElementById('adminFirstName').value,
                document.getElementById('adminLastName').value);
            const base = given.length && surnames.length ? (given[0][0] + surnames[0][0]).toUpperCase() : '';
            if (initials && getTakenInitials().has(initials)) {
                hint.textContent = `${initials} is already used by someone (current or past). Pick other initials.`;
            } else if (base && initials && initials !== base) {
                hint.textContent = `${base} is already taken, so the initial of the second surname (or a number) was added.`;
            } else {
                hint.textContent = 'This is the username they will sign in with.';
            }
        }

        async function saveAdminUser() {
            if (!isCurrentUserAdmin()) return;
            const errorEl = document.getElementById('adminUserError');
            const firstName = document.getElementById('adminFirstName').value.trim();
            const lastName = document.getElementById('adminLastName').value.trim();
            const initials = normalizeInitials(document.getElementById('adminInitials').value);
            const email = normalizeEmail(document.getElementById('adminEmail').value);
            const fail = (message, focusId) => {
                errorEl.textContent = message;
                const el = document.getElementById(focusId);
                if (el) el.focus();
            };

            if (!firstName) return fail('First name is required.', 'adminFirstName');
            if (!lastName) return fail('Last name is required.', 'adminLastName');
            if (!/^[A-Z0-9]{2,4}$/.test(initials)) return fail('Initials must be 2 to 4 letters or digits.', 'adminInitials');
            if (getTakenInitials().has(initials)) return fail(`${initials} is already used by someone (current or past).`, 'adminInitials');
            if (!email || !email.includes('@')) return fail('Enter a valid email.', 'adminEmail');

            const profile = {
                initials,
                email,
                passwordHash: await getDefaultPasswordHash(),
                weeklyHours: normalizeWeeklyHours(document.getElementById('adminWeeklyHours').value),
                holidayRegion: normalizeHolidayRegion(document.getElementById('adminRegion').value),
                firstName,
                lastName,
                isAdmin: !!document.getElementById('adminIsAdmin').checked,
                isActive: true,
                deactivatedAt: null,
                deactivatedBy: ''
            };

            try {
                await createAppUser(profile);
            } catch (error) {
                return fail(error && error.message ? error.message : 'Could not create the user.', 'adminInitials');
            }

            adminUserForm.created = profile;
            document.getElementById('adminCredentials').textContent =
                `Name: ${firstName} ${lastName}\nUsername: ${initials}\nPassword: ${APP_LOGIN_PASSWORD}`;
            setAdminUserModalStep('done');
            // Ya está guardado: cerrar con Escape no debe preguntar por cambios.
            const modalEl = document.getElementById('adminUserModal');
            if (modalEl) modalEl.dataset.snapshot = getModalFormSnapshot(modalEl);
            syncTeamMembersInSelectors();
            renderActiveView();
            showToast(`${initials} added to the team`, 'success');
        }

        async function copyAdminCredentials() {
            const text = document.getElementById('adminCredentials').textContent;
            try {
                await navigator.clipboard.writeText(text);
                showToast('Credentials copied', 'success');
            } catch {
                showToast('Could not copy. Select the text and copy it manually.', 'warning');
            }
        }

        async function runAdminUserChange(initials, changes, successMessage) {
            try {
                await updateAppUser(initials, changes);
            } catch (error) {
                showToast(error && error.message ? error.message : 'Could not update the user.', 'error');
                return;
            }
            syncTeamMembersInSelectors();
            renderActiveView();
            showToast(successMessage, 'success');
        }

        async function deactivateUser(initials) {
            const key = normalizeInitials(initials);
            if (!isCurrentUserAdmin() || key === normalizeInitials(currentUser)) return;
            const { liveProjects, openTasks } = getMemberWorkSummary(key);
            const ok = confirm(`Mark ${key} as unavailable?\n\n` +
                `${liveProjects} project(s) and ${openTasks} open task(s) list ${key}. They will keep showing ${key} (greyed out) so the team can review the work, ` +
                `but ${key} can no longer sign in, be picked as owner or assignee, or appear in the Team calendar.`);
            if (!ok) return;
            await runAdminUserChange(key, {
                isActive: false,
                deactivatedAt: new Date().toISOString(),
                deactivatedBy: normalizeInitials(currentUser)
            }, `${key} is now unavailable`);
        }

        async function reactivateUser(initials) {
            const key = normalizeInitials(initials);
            if (!isCurrentUserAdmin()) return;
            await runAdminUserChange(key, { isActive: true, deactivatedAt: null, deactivatedBy: '' }, `${key} is active again`);
        }

        async function resetUserPassword(initials) {
            const key = normalizeInitials(initials);
            if (!isCurrentUserAdmin()) return;
            if (!confirm(`Reset the password of ${key} to the standard one (${APP_LOGIN_PASSWORD})?`)) return;
            await runAdminUserChange(key, { passwordHash: await getDefaultPasswordHash() }, `Password of ${key} reset`);
        }

        async function toggleAdminRole(initials) {
            const key = normalizeInitials(initials);
            const profile = userDirectory[key];
            if (!isCurrentUserAdmin() || !profile || key === normalizeInitials(currentUser)) return;
            await runAdminUserChange(key, { isAdmin: !profile.isAdmin }, profile.isAdmin ? `${key} is no longer an admin` : `${key} is now an admin`);
        }

        function clearLoginSession() {
            try {
                localStorage.removeItem(APP_LOGIN_STORAGE_KEY);
            } catch {
                // Ignorar fallos de storage local.
            }
        }

        function logoutCurrentUser() {
            clearLoginSession();
            appInitialized = false;
            window.location.reload();
        }




        async function init() {
            await loadUserDirectory();

            // Una sesión guardada de alguien que ya no está activo (dado de
            // baja, o que cambió sus iniciales en otro navegador) se cierra.
            const sessionUser = normalizeInitials(localStorage.getItem(APP_CURRENT_USER_STORAGE_KEY) || currentUser);
            if (sessionUser && userDirectory[sessionUser] && !isMemberActive(sessionUser)) {
                logoutCurrentUser();
                return;
            }

            const savedUser = normalizeInitials(localStorage.getItem(APP_CURRENT_USER_STORAGE_KEY));
            if (savedUser && isMemberActive(savedUser)) {
                currentUser = savedUser;
            } else if (currentUser && isMemberActive(currentUser)) {
                // Mantener el usuario fijado por la sesión válida.
            } else {
                currentUser = teamMembers.slice().sort()[0] || 'IS';
            }

            localStorage.setItem(APP_CURRENT_USER_STORAGE_KEY, currentUser);

            // 2. ACTUALIZAR INTERFAZ CON EL USUARIO CARGADO
            updateUserDisplay();
            syncTeamMembersInSelectors();
            syncAdminNavButton();

            syncPhaseSelectors();

            // 3. CARGAR DATOS
            await loadTeamVacations();
            await loadDataFromSupabase();
        }

        async function enterApplication() {
            if (appInitialized) return;
            appInitialized = true;

            const loginScreen = document.getElementById('loginScreen');
            const appShell = document.getElementById('appShell');

            if (appShell) {
                appShell.classList.remove('app-shell--hidden');
            }

            if (loginScreen) {
                loginScreen.style.display = 'none';
            }

            await init();
        }

        function hasValidLoginSession() {
            try {
                const raw = localStorage.getItem(APP_LOGIN_STORAGE_KEY);
                if (!raw) return false;

                const parsed = JSON.parse(raw);
                const expiresAt = Number(parsed && parsed.expiresAt);
                if (!expiresAt || Date.now() > expiresAt) {
                    clearLoginSession();
                    return false;
                }

                const initials = normalizeInitials(parsed && parsed.initials);
                if (!initials) {
                    clearLoginSession();
                    return false;
                }

                currentUser = initials;
                localStorage.setItem(APP_CURRENT_USER_STORAGE_KEY, initials);

                return true;
            } catch {
                return false;
            }
        }

        function persistLoginSession(initials) {
            try {
                const ttlMs = APP_LOGIN_EXPIRY_DAYS * 24 * 60 * 60 * 1000;
                const normalizedInitials = normalizeInitials(initials || currentUser);
                const payload = {
                    createdAt: Date.now(),
                    expiresAt: Date.now() + ttlMs,
                    initials: normalizedInitials
                };

                localStorage.setItem(APP_LOGIN_STORAGE_KEY, JSON.stringify(payload));
            } catch {
                // Si el navegador bloquea storage, simplemente pedirá login en cada carga.
            }
        }

        async function handleLoginAttempt() {
            const initialsInput = document.getElementById('loginInitials');
            const passwordInput = document.getElementById('loginPassword');
            const loginButton = document.getElementById('loginButton');
            const loginError = document.getElementById('loginError');
            if (!passwordInput || !loginButton || !loginError) return;

            if (!initialsInput) {
                loginError.textContent = 'The login screen is out of date. Reload with Ctrl+F5.';
                return;
            }

            loginError.textContent = '';
            loginButton.disabled = true;
            loginButton.textContent = 'Signing in...';

            try {
                await loadUserDirectory();

                const enteredInitials = normalizeInitials(initialsInput.value);
                if (!enteredInitials) {
                    loginError.textContent = 'Enter your initials.';
                    initialsInput.focus();
                    return;
                }

                const profile = userDirectory[enteredInitials];
                if (!profile) {
                    loginError.textContent = 'User not found.';
                    initialsInput.focus();
                    initialsInput.select();
                    return;
                }
                if (profile.isActive === false) {
                    loginError.textContent = 'This account is no longer active. Contact an admin.';
                    initialsInput.focus();
                    initialsInput.select();
                    return;
                }

                const enteredPassword = passwordInput.value || '';
                const enteredHash = await hashTextSha256(enteredPassword);
                const expectedHash = String(profile.passwordHash || await getDefaultPasswordHash());

                if (enteredHash !== expectedHash) {
                    loginError.textContent = 'Incorrect password.';
                    passwordInput.focus();
                    passwordInput.select();
                    return;
                }

                passwordInput.value = '';
                currentUser = enteredInitials;
                localStorage.setItem(APP_CURRENT_USER_STORAGE_KEY, currentUser);
                persistLoginSession(currentUser);
                await enterApplication();
            } catch (error) {
                console.error('Login error:', error);
                const message = error && error.message ? error.message : 'Unexpected error during login.';
                loginError.textContent = `Could not sign in: ${message}`;
            } finally {
                loginButton.disabled = false;
                loginButton.textContent = 'Sign in';
            }
        }

        function setupLoginScreen() {
            const loginScreen = document.getElementById('loginScreen');
            const appShell = document.getElementById('appShell');

            if (!loginScreen || !appShell) {
                void init();
                return;
            }

            if (hasValidLoginSession()) {
                void enterApplication();
                return;
            }

            const loginForm = document.getElementById('loginForm');
            const loginButton = document.getElementById('loginButton');
            const initialsInput = document.getElementById('loginInitials');

            if (loginForm) {
                loginForm.addEventListener('submit', (event) => {
                    event.preventDefault();
                    void handleLoginAttempt();
                });
            } else if (loginButton) {
                loginButton.addEventListener('click', () => {
                    void handleLoginAttempt();
                });
            }

            if (initialsInput) {
                setTimeout(() => initialsInput.focus(), 0);
            }
        }


        window.addEventListener('load', setupLoginScreen);
        window.addEventListener('load', initTheme);
        window.addEventListener('keydown', event => {
            // "/" o Ctrl+K: ir al buscador de proyectos (no si se está escribiendo o hay un modal)
            const wantsSearch = (event.key === '/' && !event.ctrlKey && !event.metaKey && !event.altKey)
                || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k');
            if (wantsSearch && appInitialized && !document.querySelector('.modal.active')) {
                const el = document.activeElement;
                const typing = el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable ||
                    (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit'].includes(el.type)));
                if (!typing || event.key.toLowerCase() === 'k') {
                    event.preventDefault();
                    focusSidebarSearch();
                    return;
                }
            }
            if (event.key !== 'Escape') return;
            if (closeTopModal()) return;
            if (document.querySelector('.resp-popover')) { closeResponsiblesPopover(); return; }
            if (document.querySelector('.indicator-dropdown.active')) { closeAllDropdowns(); return; }
            closeMobileSidebar();
        });

        // Cierre por clic en el fondo, solo en modales marcados con data-backdrop-close
        // (listas y confirmaciones; nunca formularios con texto que se perdería)
        let backdropPointerDownTarget = null;
        document.addEventListener('pointerdown', event => { backdropPointerDownTarget = event.target; });
        document.addEventListener('click', event => {
            const target = event.target;
            if (!(target instanceof HTMLElement) || !target.classList.contains('modal')) return;
            if (backdropPointerDownTarget !== target) return;
            if (!target.classList.contains('active') || !target.hasAttribute('data-backdrop-close')) return;
            const handler = MODAL_CLOSE_HANDLERS[target.id];
            if (handler) handler(); else closeModal(target.id);
        });
        window.addEventListener('resize', () => {
            if (window.matchMedia('(max-width: 768px)').matches) {
                document.getElementById('sidebar')?.classList.remove('collapsed');
                closeMobileSidebar();
            }
            requestAnimationFrame(syncSidebarListHeights);
        });
