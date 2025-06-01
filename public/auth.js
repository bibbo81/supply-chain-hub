// public/auth.js
// Sistema di autenticazione migliorato con verifica token

window.auth = {
    // Verifica se l'utente è autenticato
    async checkAuth() {
        const token = localStorage.getItem('sb-access-token');
        
        if (!token) {
            return false;
        }

        // Verifica che il token sia ancora valido
        try {
            // Fix: Assicurati che supabase sia inizializzato
            if (!window.supabase) {
                console.error('Supabase not initialized');
                return false;
            }
            
            const { data: { user }, error } = await window.supabase.auth.getUser();
            
            if (error || !user) {
                // Token non valido, pulisci storage
                this.logout();
                return false;
            }
            
            return true;
        } catch (error) {
            console.error('Auth check error:', error);
            this.logout();
            return false;
        }
    },

    // Logout e pulizia
    logout() {
        localStorage.removeItem('sb-access-token');
        localStorage.removeItem('sb-refresh-token');
        // Rimuovi tutti i token Supabase
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sb-') || key.includes('supabase')) {
                localStorage.removeItem(key);
            }
        });
    },

    // Redirect al login se non autenticato
    async requireAuth() {
        const currentPath = window.location.pathname;
        
        // Non fare nulla se siamo già sulla pagina di login
        if (currentPath.includes('login.html')) {
            return false;
        }
        
        const isAuthenticated = await this.checkAuth();
        if (!isAuthenticated) {
            window.location.href = '/login.html';
            return false;
        }
        return true;
    },

    // Redirect alla dashboard se già autenticato (DA USARE SOLO SU LOGIN PAGE)
    async redirectIfAuthenticated() {
        const currentPath = window.location.pathname;
        
        // IMPORTANTE: Solo esegui questa logica se siamo sulla pagina di login
        if (!currentPath.includes('login.html')) {
            return false;
        }
        
        const isAuthenticated = await this.checkAuth();
        if (isAuthenticated) {
            // Aggiungi un piccolo delay per evitare redirect troppo rapidi
            setTimeout(() => {
                window.location.href = '/';
            }, 100);
            return true;
        }
        return false;
    }
};

// Auto-init per pagine protette (NON login)
document.addEventListener('DOMContentLoaded', async function() {
    const currentPath = window.location.pathname;
    
    // Lista di pagine che NON richiedono autenticazione
    const publicPages = ['/login.html', '/register.html', '/forgot-password.html'];
    
    // Se siamo su una pagina pubblica, non fare nulla
    if (publicPages.some(page => currentPath.includes(page))) {
        return;
    }
    
    // Per tutte le altre pagine, richiedi autenticazione
    await window.auth.requireAuth();
});

// Funzione helper per inizializzare Supabase se non già fatto
window.initSupabase = async function() {
    if (!window.supabase && window.supabaseClient) {
        window.supabase = window.supabaseClient;
    }
};