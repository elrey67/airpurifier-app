// Environment-based logger
const Logger = {
    getEnvironment: function() {
        const hostname = window.location.hostname;
        return hostname.includes('.com') ? 'production' : 'development';
    },
    
    isDebugEnabled: function() {
        return this.getEnvironment() === 'development';
    },
    
    log: function(message, data = null) {
        if (this.isDebugEnabled()) {
            console.log(`%c[ADMIN] ${message}`, 'color: blue; font-weight: bold;', data || '');
        }
    },
    
    info: function(message, data = null) {
        console.info(`%c[ADMIN] ${message}`, 'color: teal; font-weight: bold;', data || '');
    },
    
    warn: function(message, data = null) {
        console.warn(`%c[ADMIN] ${message}`, 'color: darkorange; font-weight: bold;', data || '');
    },
    
    error: function(message, error = null) {
        console.error(`%c[ADMIN] ${message}`, 'color: crimson; font-weight: bold;', error || '');
    },
    
    sanitizeData: function(data) {
        if (!data) return data;
        
        const sanitized = { ...data };
        const sensitiveFields = ['password', 'token', 'authToken', 'authorization', 'secret', 'key'];
        
        sensitiveFields.forEach(field => {
            if (sanitized[field]) {
                sanitized[field] = '***REDACTED***';
            }
        });
        
        return sanitized;
    }
};

class AdminApp {
    constructor() {
        // Token storage in memory instead of localStorage :cite[2]:cite[5]:cite[9]
        this.authToken = this.retrieveTokenFromStorage();
        this.refreshToken = localStorage.getItem('refreshToken'); // Keep refresh token for persistence
        this.currentUser = null;
        this.users = [];
        this.tokenRefreshTimeout = null;
         this.currentDeletionUser = null;
        this.currentEditUser = null;
        
        Logger.log('AdminApp initialized', {
            hasAuthToken: !!this.authToken,
            hasRefreshToken: !!this.refreshToken,
            environment: Logger.getEnvironment()
        });
        
        this.init();
    }
    
    /**
     * Secure token retrieval - prefers memory, falls back to localStorage during transition
     */
    retrieveTokenFromStorage() {
        // First check sessionStorage (in-memory equivalent)
        let token = sessionStorage.getItem('authToken');
        
        // Fallback to localStorage during transition period
        if (!token) {
            token = localStorage.getItem('authToken');
            if (token) {
                Logger.log('Migrating token from localStorage to sessionStorage');
                sessionStorage.setItem('authToken', token);
                // Keep localStorage for now, remove after confirming new system works
            }
        }
        
        Logger.log('Token retrieval', {
            source: token ? (sessionStorage.getItem('authToken') === token ? 'sessionStorage' : 'localStorage') : 'none',
            tokenLength: token ? token.length : 0
        });
        
        return token;
    }
    

       /**
     * Initialize modal event listeners
     */
    initializeModalListeners() {
        // Delete modal events
        const deleteModalClose = document.getElementById('delete-modal-close');
        const deleteModalCancel = document.getElementById('delete-modal-cancel');
        const deleteUserConfirm = document.getElementById('delete-user-confirm');
        
        if (deleteModalClose) deleteModalClose.addEventListener('click', () => this.closeDeleteModal());
        if (deleteModalCancel) deleteModalCancel.addEventListener('click', () => this.closeDeleteModal());
        if (deleteUserConfirm) deleteUserConfirm.addEventListener('click', () => this.confirmDeleteUser());

        // Edit modal events
        const editModalClose = document.getElementById('edit-modal-close');
        const editModalCancel = document.getElementById('edit-modal-cancel');
        const editUserConfirm = document.getElementById('edit-user-confirm');
        
        if (editModalClose) editModalClose.addEventListener('click', () => this.closeEditModal());
        if (editModalCancel) editModalCancel.addEventListener('click', () => this.closeEditModal());
        if (editUserConfirm) editUserConfirm.addEventListener('click', (e) => this.handleEditUser(e));

        // Close modals when clicking outside
        const deleteModal = document.getElementById('delete-user-modal');
        const editModal = document.getElementById('edit-user-modal');
        
        if (deleteModal) {
            deleteModal.addEventListener('click', (e) => {
                if (e.target === deleteModal) {
                    this.closeDeleteModal();
                }
            });
        }
        
        if (editModal) {
            editModal.addEventListener('click', (e) => {
                if (e.target === editModal) {
                    this.closeEditModal();
                }
            });
        }
        
        // Close modals with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                this.closeDeleteModal();
                this.closeEditModal();
            }
        });

        Logger.log('Modal event listeners initialized');
    }

    /**
     * Open delete confirmation modal
     */
    openDeleteModal(userId, username) {
        this.currentDeletionUser = { userId, username };
        
        const modal = document.getElementById('delete-user-modal');
        const userNameElement = document.getElementById('delete-user-name');
        
        userNameElement.textContent = username;
        modal.classList.add('open');
        
        Logger.log('Delete modal opened', { userId, username });
    }

    /**
     * Close delete confirmation modal
     */
    closeDeleteModal() {
        const modal = document.getElementById('delete-user-modal');
        modal.classList.remove('open');
        this.currentDeletionUser = null;
        
        Logger.log('Delete modal closed');
    }

    /**
     * Confirm and execute user deletion
     */
    async confirmDeleteUser() {
        if (!this.currentDeletionUser) {
            Logger.warn('No user selected for deletion');
            return;
        }
        
        const { userId, username } = this.currentDeletionUser;
        
        try {
            Logger.log('Confirming user deletion', { userId, username });
            
            const response = await fetch(`/api/users/${userId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}: Failed to delete user`);
            }
            
            Logger.info('User deleted successfully', { userId, username });
            
            this.closeDeleteModal();
            this.loadUsers();
            this.showMessage(`User "${username}" deleted successfully`, 'success');
            
        } catch (error) {
            Logger.error('User deletion failed', error);
            this.showMessage(error.message);
        }
    }

    /**
     * Open edit user modal
     */
    openEditModal(user) {
        this.currentEditUser = user;
        
        const modal = document.getElementById('edit-user-modal');
        document.getElementById('edit-user-id').value = user.id;
        document.getElementById('edit-username').value = user.username;
        document.getElementById('edit-is-admin').checked = user.is_admin;
        document.getElementById('edit-password').value = '';
        
        modal.classList.add('open');
        
        Logger.log('Edit modal opened', { userId: user.id, username: user.username });
    }

    /**
     * Close edit user modal
     */
    closeEditModal() {
        const modal = document.getElementById('edit-user-modal');
        modal.classList.remove('open');
        this.currentEditUser = null;
        
        Logger.log('Edit modal closed');
    }

    /**
     * Updated deleteUser method using modal instead of confirm()
     */
    async deleteUser(userId) {
        const user = this.users.find(u => u.id === userId);
        if (!user) {
            Logger.warn('User not found for deletion', { userId });
            return;
        }

        if (user.id === this.currentUser?.id) {
            Logger.warn('User attempted to delete themselves', { userId });
            this.showMessage('You cannot delete your own account');
            return;
        }

        // Use modal instead of confirm()
        Logger.log('Opening delete confirmation modal', { userId, username: user.username });
        this.openDeleteModal(userId, user.username);
    }

    /**
     * Updated editUser method to use modal
     */
    editUser(userId) {
        const user = this.users.find(u => u.id === userId);
        
        if (!user) {
            Logger.warn('User not found for editing', { userId });
            return;
        }
        
        Logger.log('Editing user via modal', { userId, username: user.username });
        this.openEditModal(user);
    }


    /**
     * Secure token storage - uses sessionStorage (in-memory behavior) :cite[9]
     */
    storeToken(token, refreshToken = null) {
        // Store in sessionStorage for in-memory like behavior :cite[9]
        sessionStorage.setItem('authToken', token);
        this.authToken = token;
        
        // Store refresh token in localStorage for persistence across tabs :cite[5]
        if (refreshToken) {
            localStorage.setItem('refreshToken', refreshToken);
            this.refreshToken = refreshToken;
        }
        
        Logger.log('Tokens stored securely', {
            authTokenStored: true,
            refreshTokenStored: !!refreshToken
        });
    }
    
    /**
     * Secure token cleanup
     */
    clearTokens() {
        sessionStorage.removeItem('authToken');
        localStorage.removeItem('refreshToken');
        localStorage.removeItem('authToken'); // Clean up old storage
        
        this.authToken = null;
        this.refreshToken = null;
        
        if (this.tokenRefreshTimeout) {
            clearTimeout(this.tokenRefreshTimeout);
            this.tokenRefreshTimeout = null;
        }
        
        Logger.log('All tokens cleared from storage');
    }
    
    init() {
        Logger.log('Initializing AdminApp');
        
        // Check authentication on page load
        if (this.authToken) {
            Logger.log('Existing token found, verifying...');
            this.verifyToken();
        } else {
            Logger.warn('No authentication token found');
            this.showLoginPage();
        }
        
        this.setupEventListeners();
    }
    
    setupEventListeners() {
        try {
            document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
            document.getElementById('logout-btn').addEventListener('click', () => this.logout());
            document.getElementById('add-user-form').addEventListener('submit', (e) => this.handleAddUser(e));
            document.getElementById('edit-user-form').addEventListener('submit', (e) => this.handleEditUser(e));
            document.getElementById('cancel-edit').addEventListener('click', () => this.hideEditModal());
            document.querySelector('.close-btn').addEventListener('click', () => this.hideEditModal());
            
            // Close modal when clicking outside
            const editModal = document.getElementById('edit-user-modal');
            if (editModal) {
                editModal.addEventListener('click', (e) => {
                    if (e.target.id === 'edit-user-modal') {
                        this.hideEditModal();
                    }
                });
            }
            
            // Event delegation for dynamically created buttons
            const usersTable = document.getElementById('users-table-body');
            if (usersTable) {
                usersTable.addEventListener('click', (e) => {
                    const target = e.target;
                    if (target.classList.contains('btn-edit')) {
                        const userId = parseInt(target.getAttribute('data-user-id'));
                        this.editUser(userId);
                    } else if (target.classList.contains('btn-delete')) {
                        const userId = parseInt(target.getAttribute('data-user-id'));
                        this.deleteUser(userId);
                    }
                });
            }
            // Initialize modal listeners
            this.initializeModalListeners();
            
            Logger.log('All event listeners setup successfully');
        } catch (error) {
            Logger.error('Error setting up event listeners', error);
        }
    }
    
    showLoginPage() {
        Logger.log('Showing login page');
        document.getElementById('login-container').classList.remove('hidden');
        document.getElementById('admin-container').classList.add('hidden');
    }
    
    showAdminPage() {
        Logger.log('Showing admin page', { user: this.currentUser?.username });
        document.getElementById('login-container').classList.add('hidden');
        document.getElementById('admin-container').classList.remove('hidden');
    }
    
    showEditModal() {
        Logger.log('Showing edit user modal');
        document.getElementById('edit-user-modal').classList.remove('hidden');
    }
    
    hideEditModal() {
        Logger.log('Hiding edit user modal');
        document.getElementById('edit-user-modal').classList.add('hidden');
    }
    
    showMessage(message, type = 'error') {
        const messageEl = document.getElementById('login-message');
        if (!messageEl) {
            Logger.warn('Message element not found');
            return;
        }
        
        messageEl.textContent = message;
        messageEl.className = `message ${type}`;
        
        Logger.log(`Showing ${type} message`, { message });
        
        // Auto-hide success messages
        if (type === 'success') {
            setTimeout(() => {
                messageEl.textContent = '';
                messageEl.className = 'message';
            }, 3000);
        }
    }
    
    async handleLogin(e) {
        e.preventDefault();
        
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        Logger.log('Login attempt', { username, hasPassword: !!password });
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            
            if (!response.ok) {
                const errorText = await response.text();
                throw new Error(errorText || 'Login failed');
            }
            
            const data = await response.json();
            Logger.log('Login successful', { 
                user: data.username, 
                isAdmin: data.is_admin,
                tokensReceived: {
                    accessToken: !!data.accessToken || !!data.token,
                    refreshToken: !!data.refreshToken
                }
            });
            
            // Store tokens using secure method
            this.storeToken(data.accessToken || data.token, data.refreshToken);
            
            // Setup token refresh before verification
            this.scheduleTokenRefresh();
            
            this.verifyToken();
            
        } catch (error) {
            Logger.error('Login failed', error);
            this.showMessage('Login failed. Please check your credentials.');
        }
    }
    
    async verifyToken() {
        if (!this.authToken) {
            Logger.warn('No token available for verification');
            this.showLoginPage();
            return;
        }
        
        try {
            Logger.log('Verifying token');
            const response = await fetch('/api/auth/verify', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Token verification failed`);
            }
            
            const data = await response.json();
            
            if (!data.valid) {
                throw new Error('Token invalid according to server');
            }
            
            this.currentUser = data.user;
            Logger.info('Token verification successful', { 
                user: this.currentUser.username,
                isAdmin: this.currentUser.is_admin 
            });
            
            // Check if user is admin
            if (!this.currentUser.is_admin) {
                Logger.warn('Non-admin user attempted admin access', { user: this.currentUser.username });
                this.showMessage('Admin access required');
                this.logout();
                return;
            }
            
            document.getElementById('user-greeting').textContent = `Welcome, ${this.currentUser.username}`;
            this.showAdminPage();
            this.loadUsers();
            
        } catch (error) {
            Logger.error('Token verification failed', error);
            
            // Attempt token refresh if verification fails
            if (await this.attemptTokenRefresh()) {
                Logger.log('Token refresh successful, retrying verification');
                this.verifyToken();
            } else {
                this.showMessage('Session expired. Please login again.');
                this.logout();
            }
        }
    }
    
    /**
     * Attempt to refresh the access token using refresh token :cite[5]
     */
    async attemptTokenRefresh() {
        if (!this.refreshToken) {
            Logger.warn('No refresh token available');
            return false;
        }
        
        try {
            Logger.log('Attempting token refresh');
            const response = await fetch('/api/auth/refresh-token', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ refreshToken: this.refreshToken })
            });
            
            if (!response.ok) {
                throw new Error(`Refresh failed: HTTP ${response.status}`);
            }
            
            const data = await response.json();
            
            if (data.success && data.accessToken) {
                this.storeToken(data.accessToken, data.refreshToken || this.refreshToken);
                Logger.info('Token refresh successful');
                return true;
            }
        } catch (error) {
            Logger.error('Token refresh failed', error);
        }
        
        return false;
    }
    
    /**
     * Schedule automatic token refresh :cite[5]
     */
    scheduleTokenRefresh() {
        // Clear existing timeout
        if (this.tokenRefreshTimeout) {
            clearTimeout(this.tokenRefreshTimeout);
        }
        
        // Refresh token 5 minutes before expiry (assuming 1 hour expiry)
        const refreshTime = 55 * 60 * 1000; // 55 minutes
        
        this.tokenRefreshTimeout = setTimeout(async () => {
            Logger.log('Performing scheduled token refresh');
            if (await this.attemptTokenRefresh()) {
                this.scheduleTokenRefresh(); // Reschedule next refresh
            } else {
                Logger.warn('Scheduled token refresh failed');
            }
        }, refreshTime);
        
        Logger.log('Token refresh scheduled', { refreshInMinutes: 55 });
    }
    
    logout() {
        Logger.info('User logging out', { user: this.currentUser?.username });
        
        // Call logout endpoint to invalidate refresh token if available
        if (this.refreshToken) {
            fetch('/api/auth/logout', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({ refreshToken: this.refreshToken })
            }).catch(err => {
                Logger.error('Logout API call failed', err);
            });
        }
        
        this.clearTokens();
        this.currentUser = null;
        this.showLoginPage();
    }
    
    async loadUsers() {
        try {
            Logger.log('Loading users list');
            const response = await fetch('/api/users', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: Failed to load users`);
            }
            
            const data = await response.json();
            this.users = data.users;
            Logger.info('Users loaded successfully', { count: this.users.length });
            this.renderUsersTable();
            
        } catch (error) {
            Logger.error('Error loading users', error);
            this.showMessage('Failed to load users');
        }
    }
    
    renderUsersTable() {
        const tableBody = document.getElementById('users-table-body');
        if (!tableBody) {
            Logger.error('Users table body not found');
            return;
        }
        
        tableBody.innerHTML = '';
        
        this.users.forEach(user => {
            const row = document.createElement('tr');
            
            row.innerHTML = `
                <td>${user.username}</td>
                <td>${user.is_admin ? 'Yes' : 'No'}</td>
                <td>${new Date(user.created_at).toLocaleDateString()}</td>
                <td>
                    <button class="btn btn-secondary btn-edit" data-user-id="${user.id}">Edit</button>
                    <button class="btn btn-danger btn-delete" data-user-id="${user.id}" 
                        ${user.id === this.currentUser?.id ? 'disabled' : ''}>
                        Delete
                    </button>
                </td>
            `;
            
            tableBody.appendChild(row);
        });
        
        Logger.log('Users table rendered', { userCount: this.users.length });
    }
    
    async handleAddUser(e) {
        e.preventDefault();
        
        const username = document.getElementById('new-username').value;
        const password = document.getElementById('new-password').value;
        const isAdmin = document.getElementById('new-is-admin').checked;
        
        Logger.log('Adding new user', { 
            username, 
            isAdmin,
            hasPassword: !!password 
        });
        
        try {
            const response = await fetch('/api/users', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify({ username, password, is_admin: isAdmin })
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}: Failed to create user`);
            }
            
            // Clear form
            document.getElementById('add-user-form').reset();
            
            // Reload users
            this.loadUsers();
            
            Logger.info('User created successfully', { username });
            this.showMessage('User created successfully', 'success');
            
        } catch (error) {
            Logger.error('Error creating user', error);
            this.showMessage(error.message);
        }
    }
    
    async handleEditUser(e) {
        e.preventDefault();
        
        const userId = document.getElementById('edit-user-id').value;
        const username = document.getElementById('edit-username').value;
        const password = document.getElementById('edit-password').value;
        const isAdmin = document.getElementById('edit-is-admin').checked;
        
        Logger.log('Updating user', { 
            userId, 
            username, 
            isAdmin,
            passwordChanged: !!password 
        });
        
        const updateData = { username, is_admin: isAdmin };
        if (password) updateData.password = password;
        
        try {
            const response = await fetch(`/api/users/${userId}`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${this.authToken}`
                },
                body: JSON.stringify(updateData)
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `HTTP ${response.status}: Failed to update user`);
            }
            
            this.hideEditModal();
            this.loadUsers();
            
            Logger.info('User updated successfully', { userId, username });
            this.showMessage('User updated successfully', 'success');
            
        } catch (error) {
            Logger.error('Error updating user', error);
            this.showMessage(error.message);
        }
    }
    

/**
 * Initialize mobile menu functionality
 */
initializeMobileMenu() {
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const mobileMenuClose = document.getElementById('mobile-menu-close');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    const mobileMenuSidebar = document.getElementById('mobile-menu-sidebar');
    const mobileLogoutBtn = document.getElementById('mobile-logout-btn');

    // Toggle mobile menu
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', () => {
            this.openMobileMenu();
        });
    }

    // Close mobile menu
    if (mobileMenuClose) {
        mobileMenuClose.addEventListener('click', () => {
            this.closeMobileMenu();
        });
    }

    if (mobileMenuOverlay) {
        mobileMenuOverlay.addEventListener('click', () => {
            this.closeMobileMenu();
        });
    }

    // Mobile logout functionality
    if (mobileLogoutBtn) {
        mobileLogoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            this.closeMobileMenu();
            this.logout();
        });
    }

    // Close menu when clicking on nav items (except logout)
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item:not(.mobile-nav-logout)');
    mobileNavItems.forEach(item => {
        item.addEventListener('click', () => {
            this.closeMobileMenu();
        });
    });

    // Close menu on escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && mobileMenuSidebar.classList.contains('active')) {
            this.closeMobileMenu();
        }
    });

    Logger.log('Mobile menu initialized');
}

/**
 * Open mobile menu
 */
openMobileMenu() {
    const mobileMenuSidebar = document.getElementById('mobile-menu-sidebar');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    
    mobileMenuSidebar.classList.add('active');
    mobileMenuOverlay.classList.add('active');
    document.body.classList.add('mobile-menu-open');
    
    Logger.log('Mobile menu opened');
}

/**
 * Close mobile menu
 */
closeMobileMenu() {
    const mobileMenuSidebar = document.getElementById('mobile-menu-sidebar');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    
    mobileMenuSidebar.classList.remove('active');
    mobileMenuOverlay.classList.remove('active');
    document.body.classList.remove('mobile-menu-open');
    
    Logger.log('Mobile menu closed');
}

/**
 * Sync user greeting between desktop and mobile
 */
syncUserGreeting() {
    const desktopGreeting = document.getElementById('user-greeting');
    const mobileGreeting = document.getElementById('mobile-user-greeting');
    
    if (desktopGreeting && mobileGreeting) {
        // Initial sync
        mobileGreeting.textContent = desktopGreeting.textContent.replace('Welcome, ', '');
        
        // Observe changes to desktop greeting
        const observer = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.type === 'characterData' || mutation.type === 'childList') {
                    mobileGreeting.textContent = desktopGreeting.textContent.replace('Welcome, ', '');
                }
            });
        });
        
        observer.observe(desktopGreeting, {
            characterData: true,
            childList: true,
            subtree: true
        });
    }
}

// Update the init method to include mobile menu
init() {
    Logger.log('Initializing AdminApp');
    
    // Check authentication on page load
    if (this.authToken) {
        Logger.log('Existing token found, verifying...');
        this.verifyToken();
    } else {
        Logger.warn('No authentication token found');
        this.showLoginPage();
    }
    
    this.setupEventListeners();
    this.initializeMobileMenu(); // Add this line
}

// Update the showAdminPage method to sync user greeting
showAdminPage() {
    Logger.log('Showing admin page', { user: this.currentUser?.username });
    document.getElementById('login-container').classList.add('hidden');
    document.getElementById('admin-container').classList.remove('hidden');
    
    // Sync user greeting for mobile
    this.syncUserGreeting();
}

setupEventListeners() {
    try {
        document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('add-user-form').addEventListener('submit', (e) => this.handleAddUser(e));
        
        // Remove these outdated listeners - they reference old modal system
        // document.getElementById('edit-user-form').addEventListener('submit', (e) => this.handleEditUser(e));
        // document.getElementById('cancel-edit').addEventListener('click', () => this.hideEditModal());
        // document.querySelector('.close-btn').addEventListener('click', () => this.hideEditModal());

        // Event delegation for dynamically created buttons
        const usersTable = document.getElementById('users-table-body');
        if (usersTable) {
            usersTable.addEventListener('click', (e) => {
                const target = e.target;
                if (target.classList.contains('btn-edit')) {
                    const userId = parseInt(target.getAttribute('data-user-id'));
                    this.editUser(userId);
                } else if (target.classList.contains('btn-delete')) {
                    const userId = parseInt(target.getAttribute('data-user-id'));
                    this.deleteUser(userId);
                }
            });
        }
        
        // Initialize modal listeners (for new modal system)
        this.initializeModalListeners();
        
        Logger.log('All event listeners setup successfully');
    } catch (error) {
        Logger.error('Error setting up event listeners', error);
    }
}

// Update the logout method to close mobile menu
logout() {
    Logger.info('User logging out', { user: this.currentUser?.username });
    
    // Close mobile menu if open
    this.closeMobileMenu();
    
    // Call logout endpoint to invalidate refresh token if available
    if (this.refreshToken) {
        fetch('/api/auth/logout', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${this.authToken}`
            },
            body: JSON.stringify({ refreshToken: this.refreshToken })
        }).catch(err => {
            Logger.error('Logout API call failed', err);
        });
    }
    
    this.clearTokens();
    this.currentUser = null;
    this.showLoginPage();
}
}

// Initialize the admin app when the page loads
let adminApp;
document.addEventListener('DOMContentLoaded', () => {
    Logger.log('=== ADMIN APP STARTING ===', {
        timestamp: new Date().toISOString(),
        userAgent: navigator.userAgent
    });
    
    adminApp = new AdminApp();
});

// In your admin page JavaScript  
document.addEventListener('DOMContentLoaded', async function() {
    const isAuthenticated = await protectRoute(true); // Require admin
    if (!isAuthenticated) return;
    
    // Load admin-specific content
    loadAdminData();
});

