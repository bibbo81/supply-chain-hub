// public/auth.js - SAFARI COMPLETE FIX
(function() {
    'use strict';
    
    // Detect Safari
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !window.MSStream;
    
    console.log('[Auth] Browser:', { isSafari, isIOS });
    
    // Sistema auth con fix completo per Safari
    window.auth = {
        // Flag per debug
        _debug: true,
        
        // Check se siamo in loop
        isInLoop() {
            const loopKey = 'auth_loop_check';
            const now = Date.now();
            const lastCheck = parseInt(localStorage.getItem(loopKey) || '0');
            
            // Se l'ultimo check è stato meno di 2 secondi fa, siamo in loop
            if (now - lastCheck < 2000) {
                console.warn('[Auth] Loop detected!');
                return true;
            }
            
            localStorage.setItem(loopKey, now.toString());
            return false;
        },
        
        // Check authentication con metodo Safari-safe
        isAuthenticated() {
            try {
                // Se siamo in loop, return false per forzare login
                if (this.isInLoop()) {
                    return false;
                }
                
                // Prova metodi multipli per trovare il token
                let token = null;
                
                // Metodo 1: localStorage standard
                try {
                    token = localStorage.getItem('sb-access-token');
                    if (this._debug && token) console.log('[Auth] Token found in localStorage');
                } catch (e) {
                    console.warn('[Auth] localStorage not available');
                }
                
                // Metodo 2: sessionStorage (per Safari private browsing)
                if (!token) {
                    try {
                        token = sessionStorage.getItem('sb-access-token');
                        if (this._debug && token) console.log('[Auth] Token found in sessionStorage');
                    } catch (e) {
                        console.warn('[Auth] sessionStorage not available');
                    }
                }
                
                // Metodo 3: Cerca nel cookie (Safari fallback)
                if (!token && (isSafari || isIOS)) {
                    const cookies = document.cookie.split(';');
                    for (let cookie of cookies) {
                        const [key, value] = cookie.trim().split('=');
                        if (key === 'sb-access-token') {
                            token = decodeURIComponent(value);
                            if (this._debug) console.log('[Auth] Token found in cookie');
                            break;
                        }
                    }
                }
                
                // Metodo 4: Check Supabase session object
                if (!token) {
                    try {
                        const sessionStr = localStorage.getItem('supabase.auth.token');
                        if (sessionStr) {
                            const session = JSON.parse(sessionStr);
                            token = session?.access_token;
                            if (this._debug && token) console.log('[Auth] Token found in Supabase session');
                        }
                    } catch (e) {
                        // Ignore parse errors
                    }
                }
                
                // Validazione base del token
                if (token && typeof token === 'string') {
                    // Check formato JWT base (3 parti separate da .)
                    const parts = token.split('.');
                    if (parts.length === 3) {
                        if (this._debug) console.log('[Auth] Valid token format detected');
                        return true;
                    } else {
                        console.warn('[Auth] Invalid token format');
                        this.clearAuth();
                        return false;
                    }
                }
                
                if (this._debug) console.log('[Auth] No valid token found');
                return false;
                
            } catch (e) {
                console.error('[Auth] Error checking authentication:', e);
                return false;
            }
        },
        
        // Clear all auth data
        clearAuth() {
            console.log('[Auth] Clearing all auth data...');
            
            // Clear localStorage
            try {
                ['sb-access-token', 'sb-refresh-token', 'user', 'supabase.auth.token'].forEach(key => {
                    localStorage.removeItem(key);
                });
            } catch (e) {
                console.warn('[Auth] Could not clear localStorage');
            }
            
            // Clear sessionStorage
            try {
                ['sb-access-token', 'sb-refresh-token', 'user', 'supabase.auth.token'].forEach(key => {
                    sessionStorage.removeItem(key);
                });
            } catch (e) {
                console.warn('[Auth] Could not clear sessionStorage');
            }
            
            // Clear cookies (Safari)
            if (isSafari || isIOS) {
                ['sb-access-token', 'sb-refresh-token', 'user'].forEach(key => {
                    document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT; SameSite=Lax`;
                    document.cookie = `${key}=; path=/; expires=Thu, 01 Jan 1970 00:00:01 GMT;`; // Senza SameSite per compatibilità
                });
            }
        },
        
        // Logout
        logout() {
            console.log('[Auth] Logging out...');
            this.clearAuth();
            
            // Clear loop check
            localStorage.removeItem('auth_loop_check');
            
            // Usa replace invece di href per evitare history issues
            setTimeout(() => {
                window.location.replace('/login.html');
            }, 100);
        },
        
        // Get current user
        getCurrentUser() {
            try {
                // Prova localStorage
                let userStr = localStorage.getItem('user');
                
                // Prova sessionStorage
                if (!userStr) {
                    userStr = sessionStorage.getItem('user');
                }
                
                // Prova cookie (Safari)
                if (!userStr && (isSafari || isIOS)) {
                    const cookies = document.cookie.split(';');
                    for (let cookie of cookies) {
                        const [key, value] = cookie.trim().split('=');
                        if (key === 'user') {
                            userStr = decodeURIComponent(value);
                            break;
                        }
                    }
                }
                
                if (userStr) {
                    const user = JSON.parse(userStr);
                    if (user && user.email) {
                        return user;
                    }
                }
                
                return null;
            } catch (e) {
                console.error('[Auth] Error getting user:', e);
                return null;
            }
        },
        
        // Store auth - multi-method per Safari
        storeAuth(session, user) {
            console.log('[Auth] Storing auth data...');
            
            try {
                if (session && session.access_token) {
                    // Store in localStorage
                    try {
                        localStorage.setItem('sb-access-token', session.access_token);
                        if (session.refresh_token) {
                            localStorage.setItem('sb-refresh-token', session.refresh_token);
                        }
                        localStorage.setItem('supabase.auth.token', JSON.stringify(session));
                    } catch (e) {
                        console.warn('[Auth] Could not store in localStorage');
                    }
                    
                    // Store in sessionStorage (Safari private browsing)
                    try {
                        sessionStorage.setItem('sb-access-token', session.access_token);
                        if (session.refresh_token) {
                            sessionStorage.setItem('sb-refresh-token', session.refresh_token);
                        }
                        sessionStorage.setItem('supabase.auth.token', JSON.stringify(session));
                    } catch (e) {
                        console.warn('[Auth] Could not store in sessionStorage');
                    }
                    
                    // Store in cookie (Safari fallback)
                    if (isSafari || isIOS) {
                        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
                        document.cookie = `sb-access-token=${encodeURIComponent(session.access_token)}; path=/; expires=${expires}; SameSite=Lax`;
                        if (session.refresh_token) {
                            document.cookie = `sb-refresh-token=${encodeURIComponent(session.refresh_token)}; path=/; expires=${expires}; SameSite=Lax`;
                        }
                    }
                }
                
                if (user) {
                    const userStr = JSON.stringify(user);
                    
                    // Store in multiple places
                    try {
                        localStorage.setItem('user', userStr);
                    } catch (e) {
                        console.warn('[Auth] Could not store user in localStorage');
                    }
                    
                    try {
                        sessionStorage.setItem('user', userStr);
                    } catch (e) {
                        console.warn('[Auth] Could not store user in sessionStorage');
                    }
                    
                    if (isSafari || isIOS) {
                        const expires = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toUTCString();
                        document.cookie = `user=${encodeURIComponent(userStr)}; path=/; expires=${expires}; SameSite=Lax`;
                    }
                }
                
                // Clear loop check on successful store
                localStorage.removeItem('auth_loop_check');
                
                return true;
            } catch (e) {
                console.error('[Auth] Error storing auth:', e);
                return false;
            }
        }
    };
    
    // Blocca Google Analytics
    window['ga-disable-GA_MEASUREMENT_ID'] = true;
    window.ga = () => false;
    window.gtag = () => false;
})();