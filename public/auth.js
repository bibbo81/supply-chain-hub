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
            const { supabase } = await window.supabasePromise;
            const { data: { user }, error } = await supabase.auth.getUser(token);
            
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
        const isAuthenticated = await this.checkAuth();
        if (!isAuthenticated) {
            window.location.href = '/login.html';
            return false;
        }
        return true;
    },

    // Redirect alla dashboard se già autenticato
    async redirectIfAuthenticated() {
        const isAuthenticated = await this.checkAuth();
        if (isAuthenticated) {
            window.location.href = '/';
            return true;
        }
        return false;
    }
};