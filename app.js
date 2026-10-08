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
let currentUser = null;
const APP_LOGIN_PASSWORD = 'WEai2026!';
const APP_LOGIN_STORAGE_KEY = 'wtw_login_session_v1';
const APP_CURRENT_USER_STORAGE_KEY = 'wtw_current_user';
const APP_USERS_STORAGE_KEY = 'wtw_user_directory_v1';
const APP_USERS_TABLE = 'app_users';
const DAY_PERSONAL_TASKS_TABLE = 'day_personal_tasks';
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
            passwordHash: hash
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
        normalized[initials] = {
            initials,
            email: normalizeEmail(row.email || getDefaultEmailByInitials(initials)),
            passwordHash: String(row.passwordHash || row.password_hash || '')
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

function refreshTeamMembersFromDirectory() {
    const members = Object.keys(userDirectory).sort();
    if (members.length === 0) return;
    teamMembers.splice(0, teamMembers.length, ...members);
}

async function loadUserDirectory() {
    if (userDirectoryLoaded) return;

    const localDirectory = loadUserDirectoryFromLocalStorage();
    if (localDirectory && Object.keys(localDirectory).length > 0) {
        userDirectory = localDirectory;
        userDirectorySource = 'local';
    }

    const { data, error } = await supabaseClient
        .from(APP_USERS_TABLE)
        .select('initials,email,password_hash')
        .order('initials', { ascending: true });

    if (!error) {
        if ((data || []).length > 0) {
            const supabaseDirectory = {};
            data.forEach(row => {
                const initials = normalizeInitials(row.initials);
                if (!initials) return;
                supabaseDirectory[initials] = {
                    initials,
                    email: normalizeEmail(row.email || getDefaultEmailByInitials(initials)),
                    passwordHash: String(row.password_hash || '')
                };
            });
            userDirectory = normalizeUserDirectory(supabaseDirectory);
            userDirectorySource = 'supabase';
            saveUserDirectoryToLocalStorage();
        } else {
            const defaults = await buildDefaultUserDirectory();
            const rows = Object.values(defaults).map(u => ({
                initials: u.initials,
                email: u.email,
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

async function saveUserProfile(oldInitials, profile) {
    const oldKey = normalizeInitials(oldInitials);
    const newKey = normalizeInitials(profile && profile.initials);
    if (!newKey) throw new Error('Invalid initials');

    if (oldKey && oldKey !== newKey) {
        delete userDirectory[oldKey];
    }

    userDirectory[newKey] = {
        initials: newKey,
        email: normalizeEmail(profile.email),
        passwordHash: String(profile.passwordHash || '')
    };

    saveUserDirectoryToLocalStorage();
    refreshTeamMembersFromDirectory();

    if (userDirectorySource === 'supabase') {
        const { error: upsertError } = await supabaseClient
            .from(APP_USERS_TABLE)
            .upsert({
                initials: newKey,
                email: normalizeEmail(profile.email),
                password_hash: String(profile.passwordHash || '')
            }, { onConflict: 'initials' });

        if (upsertError) {
            throw new Error(formatSupabaseError(upsertError, 'Could not save the user to Supabase'));
        }

        if (oldKey && oldKey !== newKey) {
            await supabaseClient
                .from(APP_USERS_TABLE)
                .delete()
                .eq('initials', oldKey);
        }
    }
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
    projectModal: () => closeProjectModal()
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
    completados: false
};

// Fases heredadas de un vocabulario antiguo -> fase actual (PROJECT_PHASES)
const LEGACY_PHASE_MAP = {
    'Idea': 'Discovery',
    'En Progreso': 'Development',
    'Cerrado': 'Completed',
    'Mantenimiento': 'BAU'
};

// Grupo de trabajo de un proyecto: activos (en curso), bau (lo mantenemos nosotros) o completados
function getProjectGroup(project) {
    const phase = project && project.phase;
    if (phase === 'Completed' || phase === 'Cancelled') return 'completados';
    if (phase === 'BAU') return 'bau';
    return 'activos';
}

function countOpenIncidents(projectId) {
    return (incidents || []).filter(i => i.projectId === projectId && !i.resolved).length;
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

function getStatusText(status) {
    switch (status) {
        case 'Verde':
            return 'On Track';
        case 'Ámbar':
            return 'At Risk';
        case 'Rojo':
            return 'Blocked';
        default:
            return status || '-';
    }
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


        // Public holidays per country. Each team member follows the calendar of
        // their country (see MEMBER_COUNTRY). Holidays are marked in the Daily and
        // Team calendars but NEVER count as vacation days.
        const HOLIDAYS_BY_COUNTRY = {
            // Spain (national + Madrid) — owners: TB, AR, JG
            ES: {
                2025: [
                    '2025-01-01', '2025-01-06', '2025-04-17', '2025-04-18',
                    '2025-05-01', '2025-05-02', '2025-07-25', '2025-08-15',
                    '2025-10-12', '2025-11-01', '2025-11-09', '2025-12-06',
                    '2025-12-08', '2025-12-25'
                ],
                2026: [
                    '2026-01-01', '2026-01-06', '2026-04-02', '2026-04-03',
                    '2026-05-01', '2026-05-02', '2026-05-15', '2026-08-15',
                    '2026-10-12', '2026-11-02', '2026-11-09', '2026-12-08',
                    '2026-12-25'
                ],
                2027: [
                    '2027-01-01', '2027-01-06', '2027-03-25', '2027-03-26',
                    '2027-05-01', '2027-10-12', '2027-11-01', '2027-12-06',
                    '2027-12-08', '2027-12-25'
                ]
            },
            // Portugal (national) — owner: IM
            PT: {
                2025: [
                    '2025-01-01', '2025-04-18', '2025-04-20', '2025-04-25',
                    '2025-05-01', '2025-06-10', '2025-06-19', '2025-08-15',
                    '2025-10-05', '2025-11-01', '2025-12-01', '2025-12-08',
                    '2025-12-25'
                ],
                2026: [
                    '2026-01-01', '2026-04-03', '2026-04-05', '2026-04-25',
                    '2026-05-01', '2026-06-04', '2026-06-10', '2026-08-15',
                    '2026-10-05', '2026-11-01', '2026-12-01', '2026-12-08',
                    '2026-12-25'
                ],
                2027: [
                    '2027-01-01', '2027-03-26', '2027-03-28', '2027-04-25',
                    '2027-05-01', '2027-05-27', '2027-06-10', '2027-08-15',
                    '2027-10-05', '2027-11-01', '2027-12-01', '2027-12-08',
                    '2027-12-25'
                ]
            },
            // India (Mumbai / Maharashtra) — owner: AD. Fixed-date national holidays;
            // movable festival dates to be validated when AD joins the active roster.
            IN: {
                2025: [
                    '2025-01-26', '2025-03-14', '2025-08-15', '2025-08-27',
                    '2025-10-02', '2025-10-21', '2025-12-25'
                ],
                2026: [
                    '2026-01-26', '2026-03-04', '2026-08-15', '2026-09-14',
                    '2026-10-02', '2026-11-08', '2026-12-25'
                ],
                2027: [
                    '2027-01-26', '2027-08-15', '2027-10-02', '2027-12-25'
                ]
            }
        };

        // Which country calendar each team member follows.
        const MEMBER_COUNTRY = { TB: 'ES', AR: 'ES', JG: 'ES', IM: 'PT', AD: 'IN' };
        const COUNTRY_LABEL = { ES: 'Spain', PT: 'Portugal', IN: 'India' };

        function getMemberCountry(initials) {
            return MEMBER_COUNTRY[(initials || '').trim().toUpperCase()] || 'ES';
        }

        // Cache of flattened holiday Sets per country.
        const _holidaySetCache = {};
        function getHolidaySetForCountry(country) {
            if (!_holidaySetCache[country]) {
                const byYear = HOLIDAYS_BY_COUNTRY[country] || {};
                _holidaySetCache[country] = new Set(Object.values(byYear).flat());
            }
            return _holidaySetCache[country];
        }

        function isHolidayForMember(initials, dateKey) {
            return getHolidaySetForCountry(getMemberCountry(initials)).has(dateKey);
        }

        // Country codes that have a holiday on a given date among the active team.
        function teamHolidayCountriesOnDate(dateKey) {
            const countries = new Set(teamMembers.map(getMemberCountry));
            return Array.from(countries).filter(c => getHolidaySetForCountry(c).has(dateKey));
        }

        function isHolidayForAnyTeamMember(dateKey) {
            return teamHolidayCountriesOnDate(dateKey).length > 0;
        }

        let projects = [];
        let dailyComments = [];
        let teamVacations = [];
        let selectedVacationDays = []; // Rastrear días seleccionados para vacaciones
        let pendingVacationSelection = null;
        let vacationBalanceYear = new Date().getFullYear();
        let vacationLegendFilter = null; // null | 'current_year' | 'previous_year' | 'willis_choice'
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
            dailyViewMode = mode;
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

        function openNewProjectModal() {
            openModal('projectModal', '#projectName');
        }

        function closeProjectModal() {
            closeModal('projectModal');

            // Limpiar campos de forma SEGURA (solo si existen)
            const fields = ['projectName', 'projectStartDate', 'projectEndDate', 'volume', 'fte', 'projectStakeholders', 'projectPhase'];
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
        }

        function openResponsiblesPopover(projectId) {
            const project = projects.find(p => p.id === projectId);
            if (!project) return;
            
            const current = project.responsibles || [];
            const available = teamMembers.filter(m => !current.includes(m));
            
            if (available.length === 0) {
                showToast('All owners are already assigned', 'info');
                return;
            }
            
            // Crear un popover con botones clicables
            const popoverId = `resp-popover-${projectId}`;
            let existing = document.getElementById(popoverId);
            if (existing) existing.remove();
            
            const popover = document.createElement('div');
            popover.id = popoverId;
            popover.className = 'resp-popover';
            popover.setAttribute('role', 'dialog');
            popover.setAttribute('aria-label', 'Add owner');
            popover.innerHTML = `
                <div class="resp-popover-content">
                    <div class="resp-popover-title">Add owner</div>
                    <div class="resp-popover-buttons">
                        ${available.map(resp => `
                            <button type="button" class="resp-popover-btn" onclick="addResponsibleAndClose('${projectId}', '${resp}')">
                                ${resp}
                            </button>
                        `).join('')}
                    </div>
                    <button type="button" class="resp-popover-close" aria-label="Close" onclick="closeResponsiblesPopover('${projectId}')">✕</button>
                </div>
            `;
            
            document.body.appendChild(popover);
            setTimeout(() => document.addEventListener('click', handleResponsiblesPopoverOutsideClick), 0);
            const firstOption = popover.querySelector('.resp-popover-btn');
            if (firstOption) firstOption.focus();

            const anchor = document.querySelector(`.resp-btn-header[data-project-id="${projectId}"]`);
            if (!anchor) return;

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

        function addResponsibleAndClose(projectId, responsible) {
            const project = projects.find(p => p.id === projectId);
            if (project) {
                const updated = [...(project.responsibles || []), responsible];
                updateProjectField(projectId, 'responsibles', updated).then(() => {
                    closeResponsiblesPopover(projectId);
                });
            }
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

        function removeResponsible(projectId, responsible) {
            const project = projects.find(p => p.id === projectId);
            if (project) {
                const updated = (project.responsibles || []).filter(r => r !== responsible);
                updateProjectField(projectId, 'responsibles', updated);
            }
        }



        function generateId() {
            return Date.now().toString() + "-" + Math.random().toString(36).slice(2);
        }

        async function saveNewProject() {
            // LEER TODOS LOS CAMPOS (con los IDs exactos de tu modal)
            const nameInput = document.getElementById('projectName');
            const startDateInput = document.getElementById('projectStartDate');
            const endDateInput = document.getElementById('projectEndDate');
            const volumeInput = document.getElementById('volume');
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
            const volume = parseFloat(volumeInput.value) || 0;
            const fte = parseFloat(fteInput.value) || 0;
            const phase = phaseInput.value;
            const stakeholders = stakeholdersInput.value.trim();
            const country = countryInput ? countryInput.value.trim() : '';

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
                volume: volume,
                fte: fte,
                phase: phase,
                stakeholders: stakeholders,
                country: country,
                status: 'Verde',
                priority: 'Media',
                progress: 0,
                prerequisites: prerequisites,
                responsibles: creatorInitials ? [creatorInitials] : []
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
            volumeInput.value = '';
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
                completados: document.getElementById('projectsListCompleted')
            };

            if (!lists.activos || !lists.completados) {
                return; // Elementos no existen aún
            }

            Object.entries(lists).forEach(([group, list]) => {
                if (!list) return;
                list.innerHTML = '';
                list.className = `projects-list ${sidebarCollapsed[group] ? 'collapsed' : 'expanded'}`;
            });

            projects.forEach(project => {
                const list = lists[getProjectGroup(project)];
                if (!list) return;
                const li = document.createElement('li');
                const isActive = currentProjectId === project.id ? 'active' : '';
                li.innerHTML = `<button type="button" onclick="selectProject('${project.id}')" class="${isActive}"${isActive ? ' aria-current="true"' : ''}>${escapeHtml(project.name)}</button>`;
                list.appendChild(li);
            });

            const select = document.getElementById('commentProjectSelect');
            if (select) {
                // Conservar la selección: un refresco en tiempo real no debe vaciar el modal abierto
                const previousSelection = select.value;
                select.innerHTML = '<option value="">Select a project...</option>';
                projects.forEach(p => {
                    const opt = document.createElement('option');
                    opt.value = p.id;
                    opt.textContent = p.name;
                    select.appendChild(opt);
                });
                if (previousSelection && projects.some(p => p.id === previousSelection)) select.value = previousSelection;
            }

            requestAnimationFrame(syncSidebarListHeights);
        }

        function toggleSidebarSection(section) {
            sidebarCollapsed[section] = !sidebarCollapsed[section];
            const titleIds = { activos: 'sidebarTitleActivos', bau: 'sidebarTitleBau', completados: 'sidebarTitleCompletados' };
            const title = document.getElementById(titleIds[section]);
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

            if (currentView === 'daily') {
                // En Daily, mostrar el modo acorde al proyecto y resaltar su fila
                const selectedProject = projects.find(p => p.id === projectId);
                setDailyViewMode(getProjectGroup(selectedProject));
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

        function getDayHeaderButtonState(dateKey) {
            const tasks = getCurrentUserDayPersonalTasksByDate(dateKey);
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
            const tasks = getCurrentUserDayPersonalTasksByDate(dateKey);
            if (!tasks.length) return 'Personal tasks for the day';
            const pending = tasks.filter(t => !t.completed).length;
            if (pending > 0) return `${pending} pending in personal tasks for the day`;
            return 'Personal tasks for the day completed';
        }

        function formatDayPersonalModalTitle(dateKey) {
            const dateObj = parseDateKeyToDate(dateKey);
            if (!dateObj) return 'Personal tasks for the day';
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
            renderDayPersonalTasksModal();
            openModal('dayPersonalTasksModal', '#dayPersonalTaskInput');
        }

        function closeDayPersonalTasksModal() {
            closeModal('dayPersonalTasksModal');
            const input = document.getElementById('dayPersonalTaskInput');
            if (input) input.value = '';
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
                const holidayCountries = teamHolidayCountriesOnDate(dateKey);
                const isHoliday = holidayCountries.length > 0;

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

                const holidayTitle = isHoliday ? `Public holiday · ${holidayCountries.map(c => COUNTRY_LABEL[c] || c).join(', ')}` : '';
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
                const usersOnVacation = teamVacations
                    .filter(v => dateKey >= v.start_date && dateKey <= v.end_date)
                    .map(v => v.user_initials)
                    .filter((value, index, self) => self.indexOf(value) === index);

                const vacationBadges = usersOnVacation.map(user =>
                    `<span class="vacation-badge">${user}</span>`
                ).join('');

                html += `<th class="vacation-badges-cell">${vacationBadges}</th>`;
            });

            html += `</tr>`;
            html += `</thead><tbody>`;

            const appendProjectRow = (project) => {
                    const selectedClass = project.id === currentProjectId ? 'selected-row' : '';
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
                        let highlightClass = '';
                        if (hasTeamPending && hasPersonalPending) {
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
                            metaText = `${topLevelComments.length} comment(s) · ${escapeHtml(getUrgencyLabel(latest.urgency))}${latest.hasIncident ? ' · INCIDENT' : ''}${threadBadge}`;
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





        function openDailyCommentModalFromCell(event, projectId, dateKey) {
            event.stopPropagation();
            editingCommentId = null;
            openDailyCommentModal(dateKey, projectId);
        }

        function openDailyCommentModal(dateKey, projectIdOverride = null) {
            openModal('dailyModal', '#commentText');
            document.getElementById('dailyModalTitle').textContent = editingCommentId ? 'Edit daily comment' : 'New daily comment';

            syncTeamMembersInSelectors();

            const select = document.getElementById('commentProjectSelect');
            select.innerHTML = '<option value="">Select a project...</option>';
            projects.forEach(p => {
                const opt = document.createElement('option');
                opt.value = p.id;
                opt.textContent = p.name;
                if (p.id === (projectIdOverride || currentProjectId)) opt.selected = true;
                select.appendChild(opt);
            });
            document.getElementById('dailyModal').dataset.dateKey = dateKey;

            if (editingCommentId) {
                const comment = dailyComments.find(c => c.id === editingCommentId);
                if (comment) {
                    document.getElementById('commentProjectSelect').value = comment.projectId;
                    document.getElementById('commentResponsible').value = comment.responsible || '';
                    document.getElementById('commentUrgency').value = comment.urgency;
                    document.getElementById('commentIncident').checked = comment.hasIncident;
                    document.getElementById('commentPersonal').checked = !!comment.isPersonal;
                    document.getElementById('commentText').value = comment.text;
                }
            } else {
                document.getElementById('commentResponsible').value = '';
                document.getElementById('commentUrgency').value = 'Normal';
                document.getElementById('commentIncident').checked = false;
                document.getElementById('commentPersonal').checked = false;
                document.getElementById('commentText').value = '';
            }

            applyPersonalTaskRuleFromUI();
        }

        function applyPersonalTaskRuleFromUI() {
            const personalCheckbox = document.getElementById('commentPersonal');
            const responsibleSelect = document.getElementById('commentResponsible');
            if (!personalCheckbox || !responsibleSelect) return;

            if (personalCheckbox.checked) {
                const owner = normalizeInitials(currentUser || '');
                responsibleSelect.value = owner;
                responsibleSelect.setAttribute('disabled', 'disabled');
                responsibleSelect.title = 'For personal tasks, the owner is the creator';
            } else {
                responsibleSelect.removeAttribute('disabled');
                responsibleSelect.title = '';
            }
        }

        function onPersonalTaskToggle() {
            applyPersonalTaskRuleFromUI();
        }

        function closeDailyModal() {
            closeModal('dailyModal');
            document.getElementById('commentText').value = '';
            document.getElementById('commentResponsible').value = '';
            document.getElementById('commentUrgency').value = 'Normal';
            document.getElementById('commentIncident').checked = false;
            document.getElementById('commentPersonal').checked = false;
            document.getElementById('commentResponsible').removeAttribute('disabled');
            document.getElementById('commentResponsible').title = '';
            editingCommentId = null;
        }


        async function saveDailyComment() {
            const projectId = document.getElementById('commentProjectSelect').value;
            const isPersonal = !!document.getElementById('commentPersonal').checked;
            const manualResponsible = document.getElementById('commentResponsible').value.trim();
            const ownerInitials = normalizeInitials(currentUser || 'US');
            const responsible = isPersonal ? ownerInitials : manualResponsible;
            const urgency = document.getElementById('commentUrgency').value;
            const hasIncident = document.getElementById('commentIncident').checked;
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
                        is_personal: isPersonal,
                        owner_initials: ownerInitials,
                        urgency,
                        has_incident: hasIncident,
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
                        is_personal: isPersonal,
                        owner_initials: ownerInitials,
                        urgency,
                        has_incident: hasIncident,
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

                html += `<div class="comment-entry ${completedClass}">
                <div class="comment-checkbox-wrapper">
                    <input type="checkbox" class="comment-checkbox"
                           ${c.completed ? 'checked' : ''}
                           aria-label="Mark as completed"
                           onclick="toggleCommentCompletion(event, '${c.id}')">
                    <div class="comment-main">
                        <div class="comment-header">${formattedDate} [${escapeHtml(c.userName || "ND")}]${completedBadge}${personalBadge}</div>
                        <div class="comment-meta">Owner: [${escapeHtml(c.responsible || 'ND')}]</div>
                        <div class="comment-text">${escapeHtml(c.text).replace(/\n/g, '<br>')}</div>
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
                case 'phase':
                    update.phase = value;
                    project.phase = value;
                    renderProjectsList();
                    break;
                case 'bauOwner':
                    update.bau_owner = value || null;
                    project.bauOwner = value || '';
                    break;

                case 'volume':
                    update.volume = value;
                    project.volume = value;
                    break;
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

function handleCapacityWheel(event, userInitials, weekKey, currentValue) {
    event.preventDefault();

    const delta = event.deltaY < 0 ? 5 : -5;
    let value = parseInt(currentValue, 10);
    if (isNaN(value)) value = 0;

    let newValue = value + delta;
    if (newValue < 0) newValue = 0;
    if (newValue > 100) newValue = 100;

    updateCapacity(userInitials, weekKey, newValue);
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

function renderCapacityWidget() {
    if (!currentProjectId) return '';

    const week1Start = new Date(capacityWeekStart);

    const formatWeek = (date) => {
        const start = new Date(date);
        const end = new Date(date);
        end.setDate(end.getDate() + 4);
        return `${start.getDate()}/${start.getMonth() + 1} - ${end.getDate()}/${end.getMonth() + 1}`;
    };

            let html = `<div class='widget-box capacity-widget' id='capacityWidget'>
        <div class='widget-header'>
            <div class="widget-title">Weekly Capacity</div>
        </div>

        <div class="capacity-week-nav widget-week-nav">
            <button type="button" class="widget-nav-btn" onclick="previousCapacityWeek()" aria-label="Previous week">◀</button>
            <div class="capacity-week-info">${formatWeek(week1Start)}</div>
            <button type="button" class="widget-nav-btn" onclick="nextCapacityWeek()" aria-label="Next week">▶</button>
        </div>
        
        <div class="capacity-weeks-container">`;

            // Current week only (navigable via the arrows above)
            html += renderWeekBlock(week1Start);

            html += `</div></div>`;
            return html;
        }

        function renderWeekBlock(weekStart, label) {
            const weekKey = formatDateKey(weekStart);

            let html = `<div class="capacity-week-block">
        ${label ? `<div class="capacity-week-label">${label}</div>` : ''}`;

            teamMembers.forEach(user => {
                const existing = projectCapacities.find(c =>
                    c.projectId === currentProjectId &&
                    c.userInitials === user &&
                    c.weekStart === weekKey
                );

                const value = existing ? existing.capacityPercent : 0;

                html += `<div class="capacity-user-row">
            <div class="capacity-user-icon">${user}</div>
            <div class="capacity-input-wrapper">
                <input type="number"
                       class="capacity-input"
                       aria-label="Capacity for ${user} this week (%)"
                       value="${value}"
                       min="0"
                       max="100"
                       onchange="updateCapacity('${user}', '${weekKey}', this.value)"
                       onwheel="handleCapacityWheel(event, '${user}', '${weekKey}', this.value)"
                       onclick="this.select()"
                       placeholder="0">
                <span class="capacity-percent-symbol">%</span>
            </div>
        </div>`;
            });

            html += `</div>`;
            return html;
        }

        async function updateCapacity(userInitials, weekStart, value) {
            let capacity = parseInt(value);
            if (isNaN(capacity)) capacity = 0;
            if (capacity < 0) capacity = 0;
            if (capacity > 100) capacity = 100;

            const existingIndex = projectCapacities.findIndex(c =>
                c.projectId === currentProjectId &&
                c.userInitials === userInitials &&
                c.weekStart === weekStart
            );

            if (existingIndex >= 0) {
                // Actualizar
                projectCapacities[existingIndex].capacityPercent = capacity;

                const { error } = await supabaseClient
                    .from('project_capacities')
                    .update({ capacity_percent: capacity })
                    .eq('id', projectCapacities[existingIndex].id);

                if (error) { console.error(error); showToast('Could not save capacity', 'error'); }
            } else {
                // Crear
                const newId = generateId();
                const newCapacity = {
                    id: newId,
                    projectId: currentProjectId,
                    userInitials,
                    weekStart,
                    capacityPercent: capacity
                };

                projectCapacities.push(newCapacity);

                const { error } = await supabaseClient
                    .from('project_capacities')
                    .insert({
                        id: newId,
                        project_id: currentProjectId,
                        user_initials: userInitials,
                        week_start: weekStart,
                        capacity_percent: capacity
                    });

                if (error) { console.error(error); showToast('Could not save capacity', 'error'); }
            }

            renderCapacityWidgetInPlace();
        }

        function previousCapacityWeek() {
            capacityWeekStart.setDate(capacityWeekStart.getDate() - 7);
            renderCapacityWidgetInPlace();
        }

        function nextCapacityWeek() {
            capacityWeekStart.setDate(capacityWeekStart.getDate() + 7);
            renderCapacityWidgetInPlace();
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


        function renderFicha() {
            if (!currentProjectId) {
                document.getElementById('fichaView').innerHTML = `<div class="empty-state">Select a project to see its details.</div>`;
                return;
            }

            const project = projects.find(p => p.id === currentProjectId);
            if (!project) {
                document.getElementById('fichaView').innerHTML = `<div class="empty-state">Project not found.</div>`;
                return;
            }

            // Progress
            const progressPercent = project.progress || 0;
            const RING_C = 188.5; // 2·π·30
            const ringOffset = RING_C - (RING_C * progressPercent / 100);

            // --- Main render ---
            let html = `<div class="ficha-header">
    <div class="project-meta-row">
        <div class="project-title-section">
            <div class="ficha-title">${escapeHtml(project.name)}
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
                            <span class="resp-badge-header">${escapeHtml(resp)} <button type="button" onclick="removeResponsible('${project.id}', '${resp}')" class="resp-remove-header" title="Remove ${escapeHtml(resp)}" aria-label="Remove owner ${escapeHtml(resp)}">✕</button></span>
                        `).join('') : ''}
                    </div>
                </span>
            </div>
        </div>

        <div class="progress-indicator-centered">
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
            <div class="status-badge status-${(project.status || 'Verde').toLowerCase()}" role="button" tabindex="0" aria-haspopup="true" aria-label="Status: ${getStatusText(project.status || 'Verde')}. Click to change" onclick="toggleIndicatorDropdown(event, 'status')" onkeydown="handleIndicatorKey(event, 'status')">
                <span class="status-icon">${getStatusIcon(project.status || 'Verde')}</span>
                <span class="status-text">${getStatusText(project.status || "Verde")}</span>
                <div class="indicator-dropdown" id="dropdown-status">
                    <div class="indicator-option ${(project.status || 'Verde') === 'Verde' ? 'selected' : ''}" role="button" tabindex="0" onclick="updateIndicator(event, '${project.id}', 'status', 'Verde')" onkeydown="activateOnEnterOrSpace(event)"><span class="status-dot status-dot--verde"></span> On Track</div>
                    <div class="indicator-option ${project.status === 'Ámbar' ? 'selected' : ''}" role="button" tabindex="0" onclick="updateIndicator(event, '${project.id}', 'status', 'Ámbar')" onkeydown="activateOnEnterOrSpace(event)"><span class="status-dot status-dot--ámbar"></span> At Risk</div>
                    <div class="indicator-option ${project.status === 'Rojo' ? 'selected' : ''}" role="button" tabindex="0" onclick="updateIndicator(event, '${project.id}', 'status', 'Rojo')" onkeydown="activateOnEnterOrSpace(event)"><span class="status-dot status-dot--rojo"></span> Blocked</div>
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
        <div class="ficha-field">
            <div class="ficha-label">Savings (€)</div>
            <div class="ficha-value">
                <input type="number"
                       placeholder="0.00"
                       aria-label="Savings in euros"
                       step="0.01"
                       min="0"
                       value="${project.volume || ''}"
                       onchange="updateProjectField('${project.id}','volume', this.value)">
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
            <div class="ficha-label">Savings (FTE)</div>
            <div class="ficha-value">
                <input type="number"
                       placeholder="0.0"
                       aria-label="Savings in FTE"
                       step="0.1"
                       min="0"
                       value="${project.fte || ''}"
                       onchange="updateProjectField('${project.id}','fte', this.value)">
            </div>
        </div>
        <div class="ficha-field">
            <div class="ficha-label">BAU owner</div>
            <div class="ficha-value">
                <select aria-label="BAU owner" title="Who maintains the solution once the project ends" onchange="updateProjectField('${project.id}','bauOwner', this.value)">
                    ${renderBauOwnerOptions(project.bauOwner)}
                </select>
            </div>
        </div>
        </div>
    </section>`;

            // Weekly Capacity sits to the right of Details (same row).
            html += renderCapacityWidget();

            // Main sections (prerequisites + daily comments) as bento cards.
            const showPrerequisites = Array.isArray(project.prerequisites) && project.prerequisites.length > 0;



            // Prerequisites
            if (showPrerequisites) {

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

                    const responsable = comment.responsible || 'ND';

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
                            <span class="comment-resp-chip">Owner: <strong>${escapeHtml(responsable)}</strong></span>
                         </div>
                         
                         ${completedBadge}${personalBadge}
                    </div>
                </div>
                <div class="comment-text comment-indent">
                    ${escapeHtml(comment.text).replace(/\n/g, '<br>')}
                </div>
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
    'On Hold': 'phase-color-hold'
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

    const radius = 54;
    const circumference = 2 * Math.PI * radius;
    let offsetAccum = 0;

    const segments = counts.map(entry => {
        const fraction = entry.count / total;
        const dash = fraction * circumference;
        const seg = `<circle class="donut-segment ${PHASE_CHART_COLORS[entry.phase] || 'phase-color-discovery'}" cx="70" cy="70" r="${radius}"
            fill="none" stroke-width="20"
            stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}"
            stroke-dashoffset="${(-offsetAccum).toFixed(2)}"
            transform="rotate(-90 70 70)">
            <title>${escapeHtml(entry.phase)}: ${entry.count} (${Math.round(fraction * 100)}%)</title>
        </circle>`;
        offsetAccum += dash;
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
            <svg viewBox="0 0 140 140" class="donut-svg" role="img" aria-label="Project distribution by phase">
                ${segments}
                <text x="70" y="65" text-anchor="middle" class="donut-center-value u-figure">${total}</text>
                <text x="70" y="82" text-anchor="middle" class="donut-center-label u-kicker">Projects</text>
            </svg>
            <ul class="donut-legend">${legend}</ul>
        </div>
    </div>`;
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
                <input type="text" id="dashFilterProyecto" class="dash-filter-input" placeholder="Search..." aria-label="Search project" value="${escapeHtml(dashboardFilters.proyecto || '')}">
            </div>

            <div class="dash-filter-dropdown">
                <button type="button" class="dash-filter-trigger" onclick="toggleDashFilterMenu(event,'status')">Status${(dashboardFilters.estados||[]).length ? ` (${dashboardFilters.estados.length})` : ''} ▾</button>
                <div class="${dashFilterMenuClass('status')}">
                    <div class="dash-pills dash-pills--menu">
                        <button type="button" class="dash-pill dash-pill--verde${(dashboardFilters.estados||[]).includes('Verde') ? ' active' : ''}" aria-pressed="${(dashboardFilters.estados||[]).includes('Verde')}" onclick="toggleDashFilter('estados','Verde')"><span class="dash-dot dash-dot--verde"></span> On Track</button>
                        <button type="button" class="dash-pill dash-pill--ambar${(dashboardFilters.estados||[]).includes('Ámbar') ? ' active' : ''}" aria-pressed="${(dashboardFilters.estados||[]).includes('Ámbar')}" onclick="toggleDashFilter('estados','Ámbar')"><span class="dash-dot dash-dot--ambar"></span> At Risk</button>
                        <button type="button" class="dash-pill dash-pill--rojo${(dashboardFilters.estados||[]).includes('Rojo') ? ' active' : ''}" aria-pressed="${(dashboardFilters.estados||[]).includes('Rojo')}" onclick="toggleDashFilter('estados','Rojo')"><span class="dash-dot dash-dot--rojo"></span> Blocked</button>
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
        if (dashboardFilters.proyecto) {
            const txt = dashboardFilters.proyecto.toLowerCase();
            const name = (p.name || '').toLowerCase();
            if (!name.includes(txt)) return false;
        }

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

    let totalVolume = 0;
    let totalFte = 0;

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
                        ${renderSortableHeader('volume', 'Savings €', dashboardSort, 'toggleDashboardSort')}
                        ${renderSortableHeader('fte', 'Savings FTE', dashboardSort, 'toggleDashboardSort')}
                    </tr>
                </thead>
                <tbody>`;

    // Aplicar ordenamiento
    const sortedProjects = sortDashboardProjects(filteredProjects);

    if (!sortedProjects.length) {
        html += `<tr><td colspan="10" class="table-empty">No projects match the selected filters.</td></tr>`;
    }

    sortedProjects.forEach(p => {
        const start = formatDateDisplay(p.startDate);
        const end = formatDateDisplay(p.endDate);
        const progress = isNaN(parseInt(p.progress, 10)) ? 0 : parseInt(p.progress, 10);
        const volume = Number(p.volume) || 0;
        const fte = Number(p.fte) || 0;
        totalVolume += volume;
        totalFte += fte;
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
            <td><span class="badge badge-status badge-${(p.status || 'Verde').toLowerCase()}">${getStatusText(p.status) || '-'}</span></td>
            <td>
                <div class="progress-bar-container" role="progressbar" aria-label="Progress" aria-valuenow="${progress}" aria-valuemin="0" aria-valuemax="100">
                    <div class="progress-bar-fill" style="width: ${progress}%"></div>
                    <span class="progress-bar-text">${progress}%</span>
                </div>
            </td>
            <td class="dash-num-center">${volume.toLocaleString('en-GB')}</td>
            <td class="dash-num-center">${fte.toLocaleString('en-GB', { minimumFractionDigits: 1 })}</td>
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
                    <div class="summary-label">Total savings €</div>
                    <div class="summary-value">${totalVolume.toLocaleString('en-GB')} €</div>
                </div>
                <div class="summary-item">
                    <div class="summary-label">Total savings FTE</div>
                    <div class="summary-value">${totalFte.toLocaleString('en-GB', { minimumFractionDigits: 1 })}</div>
                </div>
            </div>
        </div>
    </div>`;

    // Widget de dedicación
    const week1Start = new Date(capacityWeekStart);
    const week2Start = new Date(capacityWeekStart);
    week2Start.setDate(week2Start.getDate() + 7);

    const week1Key = formatDateKey(week1Start);
    const week2Key = formatDateKey(week2Start);

    html += `
    <div class="dashboard-capacity-section">
        <div class="capacity-card">
            <h3 class="capacity-title">Team Weekly Allocation</h3>
            <p class="capacity-subtitle">Sum of allocated capacity across all projects. Over 100% means overload.</p>
            <table class="capacity-table">
                <thead>
                    <tr>
                        <th>User</th>
                        <th class="dash-num-center">Current</th>
                        <th class="dash-num-center">Next</th>
                    </tr>
                </thead>
                <tbody>`;

    teamMembers.forEach(user => {
        const capsWeek1 = projectCapacities.filter(c =>
            c.userInitials === user && c.weekStart === week1Key
        );
        const capsWeek2 = projectCapacities.filter(c =>
            c.userInitials === user && c.weekStart === week2Key
        );

        const percent1 = capsWeek1.reduce((sum, c) => sum + (c.capacityPercent || 0), 0);
        const percent2 = capsWeek2.reduce((sum, c) => sum + (c.capacityPercent || 0), 0);

        const colorClass1 = percent1 > 100 ? 'overcapacity' : percent1 >= 80 ? 'high-capacity' : '';
        const colorClass2 = percent2 > 100 ? 'overcapacity' : percent2 >= 80 ? 'high-capacity' : '';

        html += `
                    <tr>
                        <td class="cap-user"><div class="user-avatar">${user}</div></td>
                        <td class="cap-percent dash-num-center ${colorClass1}">${percent1}%</td>
                        <td class="cap-percent dash-num-center ${colorClass2}">${percent2}%</td>
                    </tr>`;
    });

    html += `
                </tbody>
            </table>
        </div>
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
                const statusOrder = { 'Rojo': 3, 'Ámbar': 2, 'Verde': 1 };
                aVal = statusOrder[a.status] || 0;
                bVal = statusOrder[b.status] || 0;
                break;
            case 'progress':
                aVal = parseInt(a.progress, 10) || 0;
                bVal = parseInt(b.progress, 10) || 0;
                break;
            case 'volume':
                aVal = Number(a.volume) || 0;
                bVal = Number(b.volume) || 0;
                break;
            case 'fte':
                aVal = Number(a.fte) || 0;
                bVal = Number(b.fte) || 0;
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
            dashboard: 'Projects Dashboard'
        };

        function switchView(view) {
            if (!VIEW_TITLES[view]) return;
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
        }



        async function loadDataFromSupabase(skipRender = false) {
            // Todas las lecturas son independientes: se lanzan en paralelo
            const [, , , , , , projectsResult, commentsResult] = await Promise.all([
                loadCapacities(),
                loadProjectStatuses(),
                loadProjectNotes(),
                loadWeeklyTasks(),
                loadIncidents(),
                loadDayPersonalTasks(),
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

            projects = (projData || []).map(p => ({
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
                volume: p.volume || "",
                prerequisites: p.prerequisites || [],
                priority: p.priority || "Media",
                impact: p.impact || "Medio",
                status: p.status || "Verde",
                progress: p.progress || 0,
                fte: p.fte,
                responsibles: sanitizeResponsiblesList(p.responsibles),
                createdAt: p.created_at
            }));

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
                isPersonal: !!c.is_personal,
                ownerInitials: normalizeInitials(c.owner_initials || c.user_name || ''),
                urgency: c.urgency || 'Normal',
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
                currentProjectId = activeProject ? activeProject.id : projects[0].id;
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
                await loadDataFromSupabase(true);
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

        ['projects', 'daily_comments', 'project_notes', 'project_weekly_tasks', 'project_incidents', DAY_PERSONAL_TASKS_TABLE]
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
            const holidaysLoaded = Object.hasOwn(HOLIDAYS_BY_COUNTRY.ES || {}, year);
            const holidayCalendarStatus = (teamViewMode === 'year' && !holidaysLoaded)
                ? `<div class="holiday-calendar-status holiday-calendar-status--pending" role="status">Official ${year} public holidays pending validation.</div>`
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
            <li class="legend-filterable${vacationLegendFilter === 'willis_choice' ? ' legend-active' : ''}" tabindex="0" role="button" onclick="toggleVacationLegendFilter('willis_choice')" onkeydown="activateOnEnterOrSpace(event)" title="Highlight WTW Choice only"><span class="legend-swatch legend-swatch--willis"></span>WTW Choice</li>
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
            const isHoliday = isHolidayForMember(member, dateKey);

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
                if (vacation.vacation_type === 'current_year') cellClass += ' vacation-current-year';
                else if (vacation.vacation_type === 'previous_year') cellClass += ' vacation-previous-year';
                else if (vacation.vacation_type === 'willis_choice') cellClass += ' vacation-willis-choice';
                if (vacationLegendFilter && vacation.vacation_type !== vacationLegendFilter) cellClass += ' legend-dim';
            }

            const tooltip = `${member} · ${date.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })}${isHoliday ? ' · Public holiday' : ''}${vacation ? ' · Leave' : ''}`;
            return `<td class="${cellClass.trim()}" onclick="toggleVacation('${member}', '${dateKey}', event)" title="${tooltip}"></td>`;
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
                currentMonth.getFullYear(),
                ...teamVacations.map(getVacationAccrualYear).filter(Number.isInteger)
            ])].sort((a, b) => b - a);
            if (!availableYears.includes(vacationBalanceYear)) {
                vacationBalanceYear = currentYear;
            }

            // Calcular totales por usuario
            const summary = teamMembers.map(member => {
                const vacationDays = teamVacations
                    .filter(v =>
                        v.user_initials === member &&
                        v.vacation_type !== 'willis_choice' &&
                        getVacationAccrualYear(v) === vacationBalanceYear
                    )
                    .reduce((sum, v) => sum + (Number(v.days_count) || 0), 0);

                const willisChoiceDays = teamVacations
                    .filter(v =>
                        v.user_initials === member &&
                        v.vacation_type === 'willis_choice' &&
                        getVacationAccrualYear(v) === vacationBalanceYear
                    )
                    .reduce((sum, v) => sum + (Number(v.days_count) || 0), 0);

                return {
                    member,
                    vacationDays,
                    willisChoiceDays,
                    total: vacationDays + willisChoiceDays
                };
            });

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
                    </div>`;
                }).join('')}
            </div>
            <p class="chart-footnote">Balance bar against ${STANDARD_VACATION_DAYS_PER_YEAR} reference days/year (adjustable). WTW Choice is shown separately, with no fixed cap.</p>

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
                while (cursor <= end) {
                    if (cursor.getFullYear() === year) {
                        monthTotals[cursor.getMonth()] += 1;
                    }
                    cursor.setDate(cursor.getDate() + 1);
                }
            });

            const maxTotal = Math.max(...monthTotals, 1);
            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

            const bars = monthTotals.map((total, i) => {
                const heightPct = Math.max(Math.round((total / maxTotal) * 100), total > 0 ? 6 : 0);
                return `
                <div class="vacation-month-bar-wrap" title="${monthNames[i]} ${year}: ${total} person-day(s)">
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
                const confirmDelete = confirm(`Remove ${existing.days_count} leave day(s)?`);
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
            const selectionLabel = document.getElementById('vacationSelectionLabel');
            if (!modal || !typeSelect || !selectionLabel || datesToAdd.length === 0) return;

            pendingVacationSelection = { member, dates: datesToAdd };
            typeSelect.innerHTML = `
                <option value="current_year">Current year (${currentYear})</option>
                <option value="previous_year">Previous year (${previousYear})</option>
                <option value="willis_choice">WTW Choice (${currentYear})</option>
            `;
            selectionLabel.textContent = `${datesToAdd.length} ${datesToAdd.length === 1 ? 'full day' : 'full days'}`;
            openModal('vacationOptionsModal', '#vacationTypeSelect');
        }

        function closeVacationOptionsModal() {
            closeModal('vacationOptionsModal');
            pendingVacationSelection = null;
        }

        async function saveVacationSelection() {
            if (!pendingVacationSelection) return;

            const typeSelect = document.getElementById('vacationTypeSelect');
            const vacationType = typeSelect && typeSelect.value;
            if (!['current_year', 'previous_year', 'willis_choice'].includes(vacationType)) return;

            const currentYear = new Date().getFullYear();
            const vacationYear = vacationType === 'previous_year' ? currentYear - 1 : currentYear;
            const selection = pendingVacationSelection;
            closeVacationOptionsModal();
            await addVacationWithDateRange(selection.member, selection.dates, vacationType, vacationYear);
        }

        async function addVacationWithDateRange(member, dateKeysArray, vacationType, vacationYear) {
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
                days_count: 1
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
            showToast(`${vacationRecords.length} leave day${vacationRecords.length === 1 ? '' : 's'} added`, 'success');
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
                    passwordHash: nextPasswordHash
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

            const savedUser = normalizeInitials(localStorage.getItem(APP_CURRENT_USER_STORAGE_KEY));
            if (savedUser && userDirectory[savedUser]) {
                currentUser = savedUser;
            } else if (currentUser && userDirectory[currentUser]) {
                // Mantener el usuario fijado por la sesión válida.
            } else {
                currentUser = Object.keys(userDirectory).sort()[0] || 'IS';
            }

            localStorage.setItem(APP_CURRENT_USER_STORAGE_KEY, currentUser);

            // 2. ACTUALIZAR INTERFAZ CON EL USUARIO CARGADO
            updateUserDisplay();
            syncTeamMembersInSelectors();

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
