// public/auth.js
// Sistema di autenticazione SENZA auto-redirect e con protezione anti-loop

window.auth = {
    // Flag per prevenire loop
    _redirecting: false,
    
    // Verifica se l'utente è autenticato
    isAuthenticated() {
        // Usa SOLO sb-access-token come fonte di verità
        const token = localStorage.getItem('sb-access-token');
        
        // Verifica che il token sia valido (non scaduto)
        if (token) {
            try {
                // Decodifica il JWT per verificare l'expiry
                const payload = JSON.parse(atob(token.split('.')[1]));
                const now = Date.now() / 1000;
                
                if (payload.exp && payload.exp > now) {
                    return true;
                }
            } catch (e) {
                console.error('Token validation error:', e);
            }
        }
        
        return false;
    },

    // Logout e pulizia completa
    logout() {
        // Imposta flag per prevenire loop durante logout
        this._redirecting = true;
        
        // Pulisci TUTTI i token e dati
        const keysToRemove = [
            'sb-access-token',
            'sb-refresh-token',
            'supabase.auth.token',
            'user',
            'dashboardConfig' // Anche la config dashboard
        ];
        
        // Rimuovi chiavi specifiche
        keysToRemove.forEach(key => localStorage.removeItem(key));
        
        // Rimuovi tutte le chiavi Supabase
        Object.keys(localStorage).forEach(key => {
            if (key.startsWith('sb-') || key.includes('supabase')) {
                localStorage.removeItem(key);
            }
        });
        
        // Redirect al login con protezione anti-loop
        setTimeout(() => {
            window.location.replace('/login.html');
        }, 100);
    },

    // Get current user con validazione
    getCurrentUser() {
        try {
            // Prima verifica che sia autenticato
            if (!this.isAuthenticated()) {
                return null;
            }
            
            const userStr = localStorage.getItem('user');
            return userStr ? JSON.parse(userStr) : null;
        } catch (e) {
            console.error('Error getting user:', e);
            return null;
        }
    },

    // Store auth data con pulizia preventiva
    storeAuth(session, user) {
        if (!session || !session.access_token) {
            console.error('Invalid session data');
            return false;
        }
        
        // Prima pulisci vecchi token per evitare conflitti
        this.cleanupOldTokens();
        
        // Salva SOLO i token necessari
        localStorage.setItem('sb-access-token', session.access_token);
        
        if (session.refresh_token) {
            localStorage.setItem('sb-refresh-token', session.refresh_token);
        }
        
        if (user) {
            localStorage.setItem('user', JSON.stringify(user));
        }
        
        return true;
    },
    
    // Pulizia token vecchi/duplicati
    cleanupOldTokens() {
        // Lista di chiavi obsolete da rimuovere
        const obsoleteKeys = [
            'supabase.auth.token',
            'supabase.auth.user',
            'supabase.auth.expires_at'
        ];
        
        obsoleteKeys.forEach(key => localStorage.removeItem(key));
    },
    
    // Redirect sicuro con protezione anti-loop
    safeRedirect(url, delay = 100) {
        if (this._redirecting) {
            console.log('Redirect already in progress, skipping...');
            return;
        }
        
        this._redirecting = true;
        
        setTimeout(() => {
            window.location.replace(url);
        }, delay);
    },
    
    // Check auth con protezione per le pagine
    checkAuthForPage(pageType = 'protected') {
        const isAuth = this.isAuthenticated();
        const currentPath = window.location.pathname;
        
        console.log(`[Auth Check] Page: ${currentPath}, Type: ${pageType}, Authenticated: ${isAuth}`);
        
        // Se siamo già nella pagina corretta, non fare nulla
        if (pageType === 'public' && !isAuth && currentPath.includes('login')) {
            return true;
        }
        
        if (pageType === 'protected' && isAuth && currentPath.includes('dashboard')) {
            return true;
        }
        
        // Gestisci redirect necessari
        if (pageType === 'protected' && !isAuth) {
            console.log('Not authenticated, redirecting to login...');
            this.safeRedirect('/login.html');
            return false;
        }
        
        if (pageType === 'public' && isAuth) {
            console.log('Already authenticated, redirecting to dashboard...');
            this.safeRedirect('/dashboard.html');
            return false;
        }
        
        return true;
    }
};

// Inizializzazione al caricamento
document.addEventListener('DOMContentLoaded', () => {
    // Pulisci token obsoleti all'avvio
    window.auth.cleanupOldTokens();
    
    // Log stato auth per debug
    console.log('[Auth Init] Current auth status:', window.auth.isAuthenticated());
});