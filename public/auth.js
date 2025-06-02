// public/auth.js - Versione MINIMALE per evitare loop
(function() {
    // Sistema auth minimale
    window.auth = {
        // Check semplice senza validazione JWT
        isAuthenticated() {
            try {
                return !!localStorage.getItem('sb-access-token');
            } catch (e) {
                return false;
            }
        },

        // Logout semplice
        logout() {
            try {
                localStorage.clear();
                window.location.href = '/login.html';
            } catch (e) {
                window.location.href = '/login.html';
            }
        },

        // Get user semplice
        getCurrentUser() {
            try {
                const userStr = localStorage.getItem('user');
                return userStr ? JSON.parse(userStr) : null;
            } catch (e) {
                return null;
            }
        },

        // Store auth
        storeAuth(session, user) {
            try {
                if (session && session.access_token) {
                    localStorage.setItem('sb-access-token', session.access_token);
                    if (session.refresh_token) {
                        localStorage.setItem('sb-refresh-token', session.refresh_token);
                    }
                }
                if (user) {
                    localStorage.setItem('user', JSON.stringify(user));
                }
                return true;
            } catch (e) {
                console.error('Error storing auth:', e);
                return false;
            }
        }
    };

    // Blocca Google Analytics anche qui
    window['ga-disable-GA_MEASUREMENT_ID'] = true;
    window.ga = () => false;
    window.gtag = () => false;
})();