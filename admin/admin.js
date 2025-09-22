class AdminApp {
    constructor() {
        this.authToken = localStorage.getItem('authToken');
        this.currentUser = null;
        this.users = [];
        
        this.init();
    }
    
    init() {
        // Check authentication on page load
        if (this.authToken) {
            this.verifyToken();
        } else {
            this.showLoginPage();
        }
        
        // Set up event listeners
        document.getElementById('login-form').addEventListener('submit', (e) => this.handleLogin(e));
        document.getElementById('logout-btn').addEventListener('click', () => this.logout());
        document.getElementById('add-user-form').addEventListener('submit', (e) => this.handleAddUser(e));
        document.getElementById('edit-user-form').addEventListener('submit', (e) => this.handleEditUser(e));
        document.getElementById('cancel-edit').addEventListener('click', () => this.hideEditModal());
        document.querySelector('.close-btn').addEventListener('click', () => this.hideEditModal());
        
        // Close modal when clicking outside
        document.getElementById('edit-user-modal').addEventListener('click', (e) => {
            if (e.target.id === 'edit-user-modal') {
                this.hideEditModal();
            }
        });
        
        // Event delegation for dynamically created buttons
        document.getElementById('users-table-body').addEventListener('click', (e) => {
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
    
    showLoginPage() {
        document.getElementById('login-container').classList.remove('hidden');
        document.getElementById('admin-container').classList.add('hidden');
    }
    
    showAdminPage() {
        document.getElementById('login-container').classList.add('hidden');
        document.getElementById('admin-container').classList.remove('hidden');
    }
    
    showEditModal() {
        document.getElementById('edit-user-modal').classList.remove('hidden');
    }
    
    hideEditModal() {
        document.getElementById('edit-user-modal').classList.add('hidden');
    }
    
    showMessage(message, type = 'error') {
        const messageEl = document.getElementById('login-message');
        messageEl.textContent = message;
        messageEl.className = `message ${type}`;
        
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
        
        try {
            const response = await fetch('/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            });
            
            if (!response.ok) {
                throw new Error('Login failed');
            }
            
            const data = await response.json();
            this.authToken = data.token;
            localStorage.setItem('authToken', this.authToken);
            this.verifyToken();
            
        } catch (error) {
            this.showMessage('Login failed. Please check your credentials.');
            console.error('Login error:', error);
        }
    }
    
    async verifyToken() {
        try {
            const response = await fetch('/api/auth/verify', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Token verification failed');
            }
            
            const data = await response.json();
            this.currentUser = data.user;
            
            // Check if user is admin
            if (!this.currentUser.is_admin) {
                this.showMessage('Admin access required');
                this.logout();
                return;
            }
            
            document.getElementById('user-greeting').textContent = `Welcome, ${this.currentUser.username}`;
            this.showAdminPage();
            this.loadUsers();
            
        } catch (error) {
            this.showMessage('Session expired. Please login again.');
            this.logout();
            console.error('Token verification error:', error);
        }
    }

    
    
    logout() {
        localStorage.removeItem('authToken');
        this.authToken = null;
        this.currentUser = null;
        this.showLoginPage();
    }
    
    async loadUsers() {
        try {
            const response = await fetch('/api/users', {
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (!response.ok) {
                throw new Error('Failed to load users');
            }
            
            const data = await response.json();
            this.users = data.users;
            this.renderUsersTable();
            
        } catch (error) {
            this.showMessage('Failed to load users');
            console.error('Error loading users:', error);
        }
    }
    
    renderUsersTable() {
        const tableBody = document.getElementById('users-table-body');
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
                        ${user.id === this.currentUser.id ? 'disabled' : ''}>
                        Delete
                    </button>
                </td>
            `;
            
            tableBody.appendChild(row);
        });
    }
    
    async handleAddUser(e) {
        e.preventDefault();
        
        const username = document.getElementById('new-username').value;
        const password = document.getElementById('new-password').value;
        const isAdmin = document.getElementById('new-is-admin').checked;
        
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
                throw new Error(errorData.error || 'Failed to create user');
            }
            
            // Clear form
            document.getElementById('add-user-form').reset();
            
            // Reload users
            this.loadUsers();
            
            this.showMessage('User created successfully', 'success');
            
        } catch (error) {
            this.showMessage(error.message);
            console.error('Error creating user:', error);
        }
    }
    
    editUser(userId) {
        const user = this.users.find(u => u.id === userId);
        
        if (!user) return;
        
        document.getElementById('edit-user-id').value = user.id;
        document.getElementById('edit-username').value = user.username;
        document.getElementById('edit-is-admin').checked = user.is_admin;
        document.getElementById('edit-password').value = '';
        
        this.showEditModal();
    }
    
    async handleEditUser(e) {
        e.preventDefault();
        
        const userId = document.getElementById('edit-user-id').value;
        const username = document.getElementById('edit-username').value;
        const password = document.getElementById('edit-password').value;
        const isAdmin = document.getElementById('edit-is-admin').checked;
        
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
                throw new Error(errorData.error || 'Failed to update user');
            }
            
            this.hideEditModal();
            this.loadUsers();
            
            this.showMessage('User updated successfully', 'success');
            
        } catch (error) {
            this.showMessage(error.message);
            console.error('Error updating user:', error);
        }
    }
    
    async deleteUser(userId) {
        if (!confirm('Are you sure you want to delete this user? This action cannot be undone.')) {
            return;
        }
        
        try {
            const response = await fetch(`/api/users/${userId}`, {
                method: 'DELETE',
                headers: {
                    'Authorization': `Bearer ${this.authToken}`
                }
            });
            
            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || 'Failed to delete user');
            }
            
            this.loadUsers();
            
            this.showMessage('User deleted successfully', 'success');
            
        } catch (error) {
            this.showMessage(error.message);
            console.error('Error deleting user:', error);
        }
    }
}

// Initialize the admin app when the page loads
let adminApp;
document.addEventListener('DOMContentLoaded', () => {
    adminApp = new AdminApp();
});