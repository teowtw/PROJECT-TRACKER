// Configuración de Supabase (WE AI Implementation Analysts — proyecto nuevo)
const SUPABASE_URL = "https://uidqrmzxvhnaolhkeihb.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_mmOKpLqnfXWhYQpMMOsANw_EahBub-8";

const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Standard prerequisites for every project
const STANDARD_PREREQUISITES = [
    "Business Case",
    "Stakeholders",
    "Savings Calculation",
    "Approvals",
    "Project Plan",
    "Communications",
    "BAU Handover",
    "Testing",
    "Dashboards"
];

// Project lifecycle phases. Order defines the order in tables and selectors.
// BAU = the project has finished and our team keeps the maintenance.
// If another team owns the BAU, the project moves from Hypercare to Completed/Cancelled.
const PROJECT_PHASES = ['Discovery', 'Design', 'Development', 'Testing', 'Pilot', 'Production', 'Hypercare', 'BAU', 'Completed', 'Cancelled', 'On Hold'];

// Who owns the BAU once the project has finished
const BAU_OWNERS = [
    { value: '', label: 'Undefined' },
    { value: 'propio', label: 'Our team' },
    { value: 'otro', label: 'Another team' }
];
