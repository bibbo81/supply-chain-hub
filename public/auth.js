// public/auth.js
// Sistema di autenticazione SENZA auto-redirect

window.auth = {
    // Verifica se l'utente è autenticato (semplificata)
    isAuthenticated() {
        const token = localStorage.getItem('sb-access-token') || 
                     localStorage.getItem('supabase.auth.token');
        return !!token;
    },

    // Logout e pulizia
    logout() {
        // Pulisci tutti i token
        localStorage.removeItem('sb-access-token');
        localStorage.removeItem('sb-refresh-token');
        localStorage.removeItem('supabase.auth.token');
        localStorage.removeItem('user');
        
        // Rimuovi tutti i token Supabase
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sb-') || key.includes('supabase')) {
                localStorage.removeItem(key);
            }
        });
        
        // Redirect al login
        window.location.href = '/login.html';
    },

    // Get current user
    getCurrentUser() {
        try {
            const userStr = localStorage.getItem('user');
            return userStr ? JSON.parse(userStr) : null;
        } catch (e) {
            return null;
        }
    },

    // Store auth data
    storeAuth(session, user) {
        if (session && session.access_token) {
            localStorage.setItem('sb-access-token', session.access_token);
            localStorage.setItem('supabase.auth.token', JSON.stringify(session));
            if (session.refresh_token) {
                localStorage.setItem('sb-refresh-token', session.refresh_token);
            }
        }
        if (user) {
            localStorage.setItem('user', JSON.stringify(user));
        }
    }
};

// NESSUN AUTO-INIT! 
// Le pagine devono chiamare manualmente le funzioni di auth quando necessario