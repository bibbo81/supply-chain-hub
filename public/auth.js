// public/auth.js - Versione SAFARI FIX
(function() {
    'use strict';
    
    // Detect Safari
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    
    // Sistema auth con fix per Safari
    window.auth = {
        // Storage wrapper per gestire Safari
        storage: {
            setItem(key, value) {
                try {
                    localStorage.setItem(key, value);
                    // Fallback per Safari con sessionStorage
                    if (isSafari) {
                        sessionStorage.setItem(key, value);
                    }
                    return true;
                } catch (e) {
                    console.error('Storage error:', e);
                    // Fallback con cookie per Safari
                    if (isSafari) {
                        document.cookie = `${key}=${encodeURIComponent(value)}; path=/; max-age=86400; SameSite=Lax`;
                    }
                    return false;
                }
            },
            
            getItem(key) {
                try {
                    // Prima prova localStorage
                    let value = localStorage.getItem(key);
                    
                    // Se Safari e non trova in localStorage, prova sessionStorage
                    if (isSafari && !value) {
                        value = sessionStorage.getItem(key);
                    }
                    
                    // Ultimo tentativo con cookie per Safari
                    if (isSafari && !value) {
                        const match = document.cookie.match(new RegExp('(^| )' + key + '=([^;]+)'));
                        value = match ? decodeURIComponent(match[2]) : null;
                    }
                    
                    return value;
                } catch (e) {
                    console.error('Storage get error:', e);
                    return null;
                }
            },
            
            removeItem(key) {
                try {
                    localStorage.removeItem(key);
                    if (isSafari) {
                        sessionStorage.removeItem(key);
                        // Rimuovi anche il cookie
                        document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax`;
                    }
                } catch (e) {
                    console.error('Storage remove error:', e);
                }
            },
            
            clear() {
                try {
                    localStorage.clear();
                    if (isSafari) {
                        sessionStorage.clear();
                        // Clear auth cookies
                        ['sb-access-token', 'sb-refresh-token', 'user', 'supabase.auth.token'].forEach(key => {
                            document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax`;
                        });
                    }
                } catch (e) {
                    console.error('Storage clear error:', e);
                }
            }
        },

        // Check semplice con storage wrapper
        isAuthenticated() {
            try {
                const token = this.storage.getItem('sb-access-token');
                
                // Extra check per Safari - verifica che il token sia valido
                if (isSafari && token) {
                    // Verifica base che il token sembri un JWT
                    const parts = token.split('.');
                    if (parts.length !== 3) {
                        console.log('[Auth] Invalid token format, clearing...');
                        this.storage.removeItem('sb-access-token');
                        return false;
                    }
                }
                
                return !!token;
            } catch (e) {
                console.error('[Auth] Error checking authentication:', e);
                return false;
            }
        },

        // Logout con storage wrapper
        logout() {
            try {
                console.log('[Auth] Logging out...');
                this.storage.clear();
                
                // Force redirect con replace per evitare history issues
                window.location.replace('/login.html');
            } catch (e) {
                console.error('[Auth] Logout error:', e);
                // Force redirect anche in caso di errore
                window.location.replace('/login.html');
            }
        },

        // Get user con storage wrapper
        getCurrentUser() {
            try {
                const userStr = this.storage.getItem('user');
                if (!userStr) return null;
                
                const user = JSON.parse(userStr);
                
                // Validazione base per Safari
                if (isSafari && (!user || !user.email)) {
                    console.log('[Auth] Invalid user data, clearing...');
                    this.storage.removeItem('user');
                    return null;
                }
                
                return user;
            } catch (e) {
                console.error('[Auth] Error getting user:', e);
                return null;
            }
        },

        // Store auth con storage wrapper
        storeAuth(session, user) {
            try {
                if (session && session.access_token) {
                    this.storage.setItem('sb-access-token', session.access_token);
                    
                    if (session.refresh_token) {
                        this.storage.setItem('sb-refresh-token', session.refresh_token);
                    }
                    
                    // Store full session per Supabase compatibility
                    this.storage.setItem('supabase.auth.token', JSON.stringify(session));
                }
                
                if (user) {
                    this.storage.setItem('user', JSON.stringify(user));
                }
                
                return true;
            } catch (e) {
                console.error('[Auth] Error storing auth:', e);
                return false;
            }
        },

        // Metodo per verificare se siamo in una pagina di auth
        isAuthPage() {
            const path = window.location.pathname;
            return path === '/login.html' || path === '/register.html' || path === '/';
        },

        // Metodo per gestire redirect con protezione loop
        handleRedirect(authenticated) {
            const currentPath = window.location.pathname;
            
            // Se siamo già dove dovremmo essere, non fare nulla
            if (authenticated && currentPath === '/dashboard.html') {
                console.log('[Auth] Already on dashboard, no redirect needed');
                return;
            }
            
            if (!authenticated && (currentPath === '/login.html' || currentPath === '/')) {
                console.log('[Auth] Already on login page, no redirect needed');
                return;
            }
            
            // Aggiungi flag per prevenire redirect multipli
            if (window._authRedirecting) {
                console.log('[Auth] Already redirecting, skipping...');
                return;
            }
            
            window._authRedirecting = true;
            
            if (authenticated) {
                console.log('[Auth] Redirecting to dashboard...');
                window.location.replace('/dashboard.html');
            } else {
                console.log('[Auth] Redirecting to login...');
                window.location.replace('/login.html');
            }
        }
    };

    // Blocca Google Analytics anche qui
    window['ga-disable-GA_MEASUREMENT_ID'] = true;
    window['google-analytics'] = false;
    window.ga = () => false;
    window.gtag = () => false;
    
    // Log Safari detection
    if (isSafari) {
        console.log('[Auth] Safari browser detected, using enhanced storage handling');
    }
})();