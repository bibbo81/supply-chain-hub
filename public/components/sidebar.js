// Sidebar Component for Supply Chain Hub
class Sidebar {
    constructor() {
        this.isOpen = false;
        this.init();
    }

    init() {
        // Inject sidebar HTML into the page
        this.injectSidebar();
        // Add event listeners
        this.attachEventListeners();
        // Set active page
        this.setActivePage();
    }

    injectSidebar() {
        const sidebarHTML = `
            <!-- Hamburger Menu Button -->
            <button class="hamburger-menu" id="hamburgerMenu" aria-label="Menu">
                <span></span>
                <span></span>
                <span></span>
            </button>

            <!-- Sidebar Overlay -->
            <div class="sidebar-overlay" id="sidebarOverlay"></div>

            <!-- Sidebar -->
            <nav class="sidebar" id="sidebar">
                <div class="sidebar-header">
                    <h2>Supply Chain Hub</h2>
                    <button class="close-btn" id="closeSidebar" aria-label="Chiudi menu">
                        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="18" y1="6" x2="6" y2="18"></line>
                            <line x1="6" y1="6" x2="18" y2="18"></line>
                        </svg>
                    </button>
                </div>
                
                <div class="sidebar-content">
                    <ul class="nav-links">
                        <li>
                            <a href="/" data-page="dashboard">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <rect x="3" y="3" width="7" height="7"></rect>
                                    <rect x="14" y="3" width="7" height="7"></rect>
                                    <rect x="14" y="14" width="7" height="7"></rect>
                                    <rect x="3" y="14" width="7" height="7"></rect>
                                </svg>
                                <span>Dashboard</span>
                            </a>
                        </li>
                        <li>
                            <a href="/backend-spedizioni.html" data-page="spedizioni">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M1 3h7c.6 0 1 .4 1 1v16c0 .6-.4 1-1 1H1"></path>
                                    <path d="M5 2v20"></path>
                                    <path d="M8 10h13"></path>
                                    <path d="M8 14h13"></path>
                                    <path d="M8 18h13"></path>
                                </svg>
                                <span>Spedizioni</span>
                            </a>
                        </li>
                        <li>
                            <a href="/import-file.html" data-page="import">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                                    <polyline points="7 10 12 15 17 10"></polyline>
                                    <line x1="12" y1="15" x2="12" y2="3"></line>
                                </svg>
                                <span>Importa File</span>
                            </a>
                        </li>
                        <li>
                            <a href="/api-management.html" data-page="api">
                                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                                </svg>
                                <span>Gestione API</span>
                            </a>
                        </li>
                    </ul>

                    <div class="sidebar-divider"></div>

                    <div class="sidebar-section">
                        <h3>Costi Import</h3>
                        <ul class="nav-links">
                            <li>
                                <a href="/costi-mare.html" data-page="costi-mare">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M2 21c.6.5 1.2 1 2.5 1C7 22 7 20 9.5 20s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2c1.3 0 1.9-.5 2.5-1"></path>
                                        <path d="M2 16c.6.5 1.2 1 2.5 1C7 17 7 15 9.5 15s2.5 2 5 2 2.5-2 5-2 2.5 2 5 2c1.3 0 1.9-.5 2.5-1"></path>
                                        <path d="M8 3l1 2"></path>
                                        <path d="M16 3l-1 2"></path>
                                        <path d="M9 5h6"></path>
                                        <path d="M12 5v7"></path>
                                    </svg>
                                    <span>Import Mare</span>
                                </a>
                            </li>
                            <li>
                                <a href="/costi-aerea.html" data-page="costi-aerea">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"></path>
                                        <polyline points="3.27 6.96 12 12.01 20.73 6.96"></polyline>
                                        <line x1="12" y1="22.08" x2="12" y2="12"></line>
                                    </svg>
                                    <span>Import Aereo</span>
                                </a>
                            </li>
                            <li>
                                <a href="/costi-parcel.html" data-page="costi-parcel">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M16 16l2.83 2.83m5.17-5.66l-5.66-5.66m-7.51 0l-5.66 5.66m5.66 5.66L5.17 7.17"></path>
                                        <circle cx="11" cy="11" r="8"></circle>
                                    </svg>
                                    <span>Import Parcel</span>
                                </a>
                            </li>
                        </ul>
                    </div>

                    <div class="sidebar-divider"></div>

                    <div class="sidebar-section">
                        <h3>Strumenti</h3>
                        <ul class="nav-links">
                            <li>
                                <a href="/analisi.html" data-page="analisi">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <line x1="18" y1="20" x2="18" y2="10"></line>
                                        <line x1="12" y1="20" x2="12" y2="4"></line>
                                        <line x1="6" y1="20" x2="6" y2="14"></line>
                                    </svg>
                                    <span>Analisi</span>
                                </a>
                            </li>
                            <li>
                                <a href="/report.html" data-page="report">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                                        <polyline points="14 2 14 8 20 8"></polyline>
                                        <line x1="16" y1="13" x2="8" y2="13"></line>
                                        <line x1="16" y1="17" x2="8" y2="17"></line>
                                        <polyline points="10 9 9 9 8 9"></polyline>
                                    </svg>
                                    <span>Report</span>
                                </a>
                            </li>
                        </ul>
                    </div>
                </div>

                <div class="sidebar-footer">
                    <div class="user-info">
                        <div class="user-avatar">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"></path>
                                <circle cx="12" cy="7" r="4"></circle>
                            </svg>
                        </div>
                        <div class="user-details">
                            <span class="user-name">Utente</span>
                            <span class="user-org">Organizzazione</span>
                        </div>
                    </div>
                    <button class="logout-btn" id="logoutBtn">
                        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path>
                            <polyline points="16 17 21 12 16 7"></polyline>
                            <line x1="21" y1="12" x2="9" y2="12"></line>
                        </svg>
                    </button>
                </div>
            </nav>
        `;

        // Add sidebar styles
        this.injectStyles();

        // Insert sidebar into body
        document.body.insertAdjacentHTML('afterbegin', sidebarHTML);
    }

    injectStyles() {
        const styles = `
            <style>
                /* Variables */
                :root {
                    --sidebar-width: 280px;
                    --primary-color: #3b82f6;
                    --primary-hover: #2563eb;
                    --bg-sidebar: rgba(255, 255, 255, 0.95);
                    --bg-sidebar-dark: rgba(17, 24, 39, 0.95);
                    --text-primary: #1f2937;
                    --text-secondary: #6b7280;
                    --border-color: rgba(229, 231, 235, 0.5);
                    --transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
                }

                /* Dark mode support */
                @media (prefers-color-scheme: dark) {
                    :root {
                        --bg-sidebar: rgba(17, 24, 39, 0.95);
                        --text-primary: #f3f4f6;
                        --text-secondary: #9ca3af;
                        --border-color: rgba(55, 65, 81, 0.5);
                    }
                }

                /* Hamburger Menu */
                .hamburger-menu {
                    position: fixed;
                    top: 20px;
                    left: 20px;
                    z-index: 1001;
                    width: 48px;
                    height: 48px;
                    border: none;
                    background: var(--bg-sidebar);
                    backdrop-filter: blur(10px);
                    border-radius: 12px;
                    cursor: pointer;
                    display: flex;
                    flex-direction: column;
                    justify-content: center;
                    align-items: center;
                    gap: 4px;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                    transition: var(--transition);
                }

                .hamburger-menu:hover {
                    transform: scale(1.05);
                    box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
                }

                .hamburger-menu span {
                    display: block;
                    width: 20px;
                    height: 2px;
                    background: var(--text-primary);
                    transition: var(--transition);
                }

                .hamburger-menu.active span:nth-child(1) {
                    transform: rotate(45deg) translate(5px, 5px);
                }

                .hamburger-menu.active span:nth-child(2) {
                    opacity: 0;
                }

                .hamburger-menu.active span:nth-child(3) {
                    transform: rotate(-45deg) translate(5px, -5px);
                }

                /* Sidebar Overlay */
                .sidebar-overlay {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: 100%;
                    height: 100%;
                    background: rgba(0, 0, 0, 0.5);
                    backdrop-filter: blur(2px);
                    z-index: 999;
                    opacity: 0;
                    visibility: hidden;
                    transition: var(--transition);
                }

                .sidebar-overlay.active {
                    opacity: 1;
                    visibility: visible;
                }

                /* Sidebar */
                .sidebar {
                    position: fixed;
                    top: 0;
                    left: 0;
                    width: var(--sidebar-width);
                    height: 100vh;
                    background: var(--bg-sidebar);
                    backdrop-filter: blur(10px);
                    border-right: 1px solid var(--border-color);
                    z-index: 1000;
                    transform: translateX(-100%);
                    transition: var(--transition);
                    overflow-y: auto;
                    display: flex;
                    flex-direction: column;
                }

                .sidebar.active {
                    transform: translateX(0);
                    box-shadow: 4px 0 20px rgba(0, 0, 0, 0.1);
                }

                /* Sidebar Header */
                .sidebar-header {
                    padding: 20px;
                    border-bottom: 1px solid var(--border-color);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }

                .sidebar-header h2 {
                    font-size: 1.25rem;
                    font-weight: 600;
                    color: var(--text-primary);
                    margin: 0;
                }

                .close-btn {
                    width: 36px;
                    height: 36px;
                    border: none;
                    background: transparent;
                    color: var(--text-secondary);
                    cursor: pointer;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: var(--transition);
                }

                .close-btn:hover {
                    background: rgba(229, 231, 235, 0.5);
                    color: var(--text-primary);
                }

                /* Sidebar Content */
                .sidebar-content {
                    flex: 1;
                    padding: 20px 0;
                    overflow-y: auto;
                }

                .sidebar-section {
                    padding: 0 20px;
                    margin-bottom: 20px;
                }

                .sidebar-section h3 {
                    font-size: 0.75rem;
                    font-weight: 600;
                    color: var(--text-secondary);
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 10px;
                }

                .sidebar-divider {
                    height: 1px;
                    background: var(--border-color);
                    margin: 20px 0;
                }

                /* Navigation Links */
                .nav-links {
                    list-style: none;
                    padding: 0;
                    margin: 0;
                }

                .nav-links li {
                    margin-bottom: 4px;
                }

                .nav-links a {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px 20px;
                    color: var(--text-primary);
                    text-decoration: none;
                    transition: var(--transition);
                    position: relative;
                    overflow: hidden;
                }

                .nav-links a::before {
                    content: '';
                    position: absolute;
                    left: 0;
                    top: 0;
                    width: 4px;
                    height: 100%;
                    background: var(--primary-color);
                    transform: translateX(-100%);
                    transition: transform 0.3s ease;
                }

                .nav-links a:hover {
                    background: rgba(59, 130, 246, 0.1);
                    color: var(--primary-color);
                }

                .nav-links a:hover::before,
                .nav-links a.active::before {
                    transform: translateX(0);
                }

                .nav-links a.active {
                    background: rgba(59, 130, 246, 0.1);
                    color: var(--primary-color);
                    font-weight: 500;
                }

                .nav-links svg {
                    flex-shrink: 0;
                }

                /* Sidebar Footer */
                .sidebar-footer {
                    padding: 20px;
                    border-top: 1px solid var(--border-color);
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .user-info {
                    flex: 1;
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .user-avatar {
                    width: 40px;
                    height: 40px;
                    background: rgba(59, 130, 246, 0.1);
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    color: var(--primary-color);
                }

                .user-details {
                    display: flex;
                    flex-direction: column;
                }

                .user-name {
                    font-size: 0.875rem;
                    font-weight: 500;
                    color: var(--text-primary);
                }

                .user-org {
                    font-size: 0.75rem;
                    color: var(--text-secondary);
                }

                .logout-btn {
                    width: 36px;
                    height: 36px;
                    border: none;
                    background: transparent;
                    color: var(--text-secondary);
                    cursor: pointer;
                    border-radius: 8px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    transition: var(--transition);
                }

                .logout-btn:hover {
                    background: rgba(239, 68, 68, 0.1);
                    color: #ef4444;
                }

                /* Responsive */
                @media (max-width: 768px) {
                    :root {
                        --sidebar-width: 240px;
                    }
                }

                /* Content adjustment when sidebar is open */
                body.sidebar-open {
                    overflow: hidden;
                }
            </style>
        `;

        document.head.insertAdjacentHTML('beforeend', styles);
    }

    attachEventListeners() {
        const hamburger = document.getElementById('hamburgerMenu');
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        const closeBtn = document.getElementById('closeSidebar');
        const logoutBtn = document.getElementById('logoutBtn');

        // Toggle sidebar
        hamburger.addEventListener('click', () => this.toggleSidebar());
        closeBtn.addEventListener('click', () => this.closeSidebar());
        overlay.addEventListener('click', () => this.closeSidebar());

        // Close on escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && this.isOpen) {
                this.closeSidebar();
            }
        });

        // Handle logout
        logoutBtn.addEventListener('click', () => this.handleLogout());

        // Update user info when loaded
        this.updateUserInfo();
    }

    toggleSidebar() {
        this.isOpen = !this.isOpen;
        const sidebar = document.getElementById('sidebar');
        const overlay = document.getElementById('sidebarOverlay');
        const hamburger = document.getElementById('hamburgerMenu');

        if (this.isOpen) {
            sidebar.classList.add('active');
            overlay.classList.add('active');
            hamburger.classList.add('active');
            document.body.classList.add('sidebar-open');
        } else {
            sidebar.classList.remove('active');
            overlay.classList.remove('active');
            hamburger.classList.remove('active');
            document.body.classList.remove('sidebar-open');
        }
    }

    closeSidebar() {
        this.isOpen = false;
        document.getElementById('sidebar').classList.remove('active');
        document.getElementById('sidebarOverlay').classList.remove('active');
        document.getElementById('hamburgerMenu').classList.remove('active');
        document.body.classList.remove('sidebar-open');
    }

    setActivePage() {
        const currentPath = window.location.pathname;
        const links = document.querySelectorAll('.nav-links a');
        
        links.forEach(link => {
            link.classList.remove('active');
            if (link.getAttribute('href') === currentPath) {
                link.classList.add('active');
            }
        });
    }

    updateUserInfo() {
        // Get user info from localStorage or session
        const userInfo = JSON.parse(localStorage.getItem('userInfo') || '{}');
        
        if (userInfo.name) {
            document.querySelector('.user-name').textContent = userInfo.name;
        }
        
        if (userInfo.organization) {
            document.querySelector('.user-org').textContent = userInfo.organization;
        }
    }

    handleLogout() {
        if (confirm('Sei sicuro di voler uscire?')) {
            // Clear session data
            localStorage.removeItem('userInfo');
            localStorage.removeItem('authToken');
            
            // Redirect to login page
            window.location.href = '/login.html';
        }
    }
}

// Initialize sidebar when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
    window.sidebar = new Sidebar();
});

// Export for use in other modules
window.Sidebar = Sidebar;
