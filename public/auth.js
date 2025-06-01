// auth.js - Authentication Manager for Supply Chain Hub
// This file should be included in all protected pages

class AuthManager {
    constructor() {
        // Initialize properties
        this.supabase = null;
        this.currentUser = null;
        this.currentSession = null;
        this.organizationId = null;
        this.initialized = false;
    }

    // Initialize Supabase and authentication
    async init(options = {}) {
        const { redirectToLogin = true, publicPage = false } = options;
        
        try {
            // First, fetch configuration from Netlify function
            const configResponse = await fetch('/.netlify/functions/config');
            if (!configResponse.ok) {
                throw new Error('Failed to fetch config');
            }
            
            const config = await configResponse.json();
            
            // Dynamically import Supabase
            const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm');
            
            // Initialize Supabase client
            this.supabase = createClient(config.supabaseUrl, config.supabaseAnonKey);
            
            // Make supabase available globally for other scripts
            window.supabase = this.supabase;
            
            // Get current session
            const { data: { session }, error } = await this.supabase.auth.getSession();
            
            if (error) throw error;
            
            if (session) {
                this.currentSession = session;
                this.currentUser = session.user;
                this.organizationId = session.user.user_metadata?.organizzazione_id;
                
                // Update auth header for API calls
                this.updateAuthHeader();
                
                // Set up auto-refresh
                this.setupAutoRefresh();
                
                // Update UI with user info
                this.updateUserInterface();
                
                // Dispatch event for other scripts
                window.dispatchEvent(new CustomEvent('authReady', {
                    detail: {
                        user: this.currentUser,
                        session: this.currentSession,
                        organizationId: this.organizationId
                    }
                }));
                
                this.initialized = true;
                return true;
            } else if (!publicPage && redirectToLogin) {
                // No session and not a public page, redirect to login
                window.location.href = '/login.html';
                return false;
            }
            
            this.initialized = true;
            return false;
        } catch (error) {
            console.error('Auth initialization error:', error);
            if (!publicPage && redirectToLogin) {
                window.location.href = '/login.html';
            }
            return false;
        }
    }

    // Update auth header for all fetch requests
    updateAuthHeader() {
        // Store token for easy access in API calls
        if (this.currentSession) {
            localStorage.setItem('supabase.auth.token', this.currentSession.access_token);
        }
    }

    // Set up automatic token refresh
    setupAutoRefresh() {
        // Listen for auth state changes
        this.supabase.auth.onAuthStateChange((event, session) => {
            if (event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') {
                this.currentSession = session;
                this.currentUser = session?.user;
                this.organizationId = session?.user.user_metadata?.organizzazione_id;
                this.updateAuthHeader();
                this.updateUserInterface();
            } else if (event === 'SIGNED_OUT') {
                this.handleLogout();
            }
        });
    }

    // Update UI elements with user information
    updateUserInterface() {
        // Update user email in header if element exists
        const userEmailElement = document.getElementById('userEmail');
        if (userEmailElement && this.currentUser) {
            userEmailElement.textContent = this.currentUser.email;
        }
        
        // Update user name in header if element exists
        const userNameElement = document.getElementById('userName');
        if (userNameElement && this.currentUser) {
            userNameElement.textContent = this.currentUser.email.split('@')[0];
        }
        
        // Update organization name if element exists
        const orgNameElement = document.getElementById('orgName');
        if (orgNameElement && this.currentUser) {
            orgNameElement.textContent = this.currentUser.user_metadata?.nome_organizzazione || 'Organizzazione';
        }
        
        // Add logout functionality to logout button if exists
        const logoutButton = document.getElementById('logoutButton');
        if (logoutButton) {
            logoutButton.removeEventListener('click', this.logout); // Remove any existing listener
            logoutButton.addEventListener('click', () => this.logout());
        }
    }

    // Get authorization header for API calls
    getAuthHeader() {
        if (this.currentSession) {
            return {
                'Authorization': `Bearer ${this.currentSession.access_token}`,
                'Content-Type': 'application/json'
            };
        }
        return {
            'Content-Type': 'application/json'
        };
    }

    // Make authenticated API call
    async apiCall(url, options = {}) {
        // Wait for initialization if needed
        if (!this.initialized) {
            await this.init({ redirectToLogin: false });
        }
        
        const defaultOptions = {
            headers: this.getAuthHeader()
        };
        
        const finalOptions = {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...(options.headers || {})
            }
        };
        
        try {
            const response = await fetch(url, finalOptions);
            
            // Handle 401 Unauthorized
            if (response.status === 401) {
                // Try to refresh token
                const { data, error } = await this.supabase.auth.refreshSession();
                if (!error && data.session) {
                    // Retry with new token
                    finalOptions.headers.Authorization = `Bearer ${data.session.access_token}`;
                    return fetch(url, finalOptions);
                } else {
                    // Refresh failed, redirect to login
                    this.handleLogout();
                }
            }
            
            return response;
        } catch (error) {
            console.error('API call error:', error);
            throw error;
        }
    }

    // Logout user
    async logout() {
        try {
            const { error } = await this.supabase.auth.signOut();
            if (error) throw error;
            this.handleLogout();
        } catch (error) {
            console.error('Logout error:', error);
            // Force logout anyway
            this.handleLogout();
        }
    }

    // Handle logout cleanup
    handleLogout() {
        // Clear local storage
        localStorage.removeItem('supabase.auth.token');
        localStorage.removeItem('rememberMe');
        
        // Clear instance variables
        this.currentUser = null;
        this.currentSession = null;
        this.organizationId = null;
        
        // Redirect to login
        window.location.href = '/login.html';
    }

    // Get current user info
    getUser() {
        return this.currentUser;
    }

    // Get current organization ID
    getOrganizationId() {
        return this.organizationId || 'bb70d86e-bf38-4a85-adc3-76be46705d52'; // Fallback to test org
    }

    // Check if user has specific role
    hasRole(role) {
        return this.currentUser?.user_metadata?.ruolo === role;
    }

    // Check if user is admin
    isAdmin() {
        return this.hasRole('admin');
    }
}

// Create global auth instance
window.authManager = new AuthManager();

// Helper function for protected pages
async function requireAuth(options = {}) {
    return await window.authManager.init(options);
}

// Helper function for API calls
async function authenticatedFetch(url, options = {}) {
    return await window.authManager.apiCall(url, options);
}

// Auto-initialize on protected pages (all pages except login)
if (!window.location.pathname.endsWith('/login.html')) {
    window.authManager.init();
}