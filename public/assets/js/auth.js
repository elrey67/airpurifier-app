// auth.js - Fixed version with proper token sending
document.addEventListener('DOMContentLoaded', function() {
    Logger.log('Auth page loaded');
    initializeAuthPage();
});

// Initialize the auth page
async function initializeAuthPage() {
    try {
        // Check authentication status
        const isAuthenticated = await checkAuthentication();
        if (isAuthenticated) {
            Logger.info('User already authenticated, redirecting to devices');
            window.location.href = '../devices/';
            return;
        }
        
        // Set up login form
        const loginForm = document.getElementById('login-form');
        if (loginForm) {
            loginForm.addEventListener('submit', function(e) {
                e.preventDefault();
                const username = document.getElementById('username').value;
                const password = document.getElementById('password').value;
                
                authenticateUser(username, password);
            });
        }
        
    } catch (error) {
        Logger.error('Failed to initialize auth page', error);
    }
}

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
            console.log(`%c[AUTH] ${message}`, 'color: blue; font-weight: bold;', data || '');
        }
    },
    
    info: function(message, data = null) {
        console.info(`%c[AUTH] ${message}`, 'color: green; font-weight: bold;', data || '');
    },
    
    warn: function(message, data = null) {
        console.warn(`%c[AUTH] ${message}`, 'color: orange; font-weight: bold;', data || '');
    },
    
    error: function(message, error = null) {
        console.error(`%c[AUTH] ${message}`, 'color: red; font-weight: bold;', error || '');
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

// Get base URL with proper protocol
function getBaseURL() {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = window.location.port;
    
    return port ? `${protocol}//${hostname}:${port}` : `${protocol}//${hostname}`;
}

// Enhanced fetch with proper token handling
async function apiFetch(endpoint, options = {}) {
    const baseURL = getBaseURL();
    
    Logger.log('API fetch request', { 
        endpoint, 
        method: options.method || 'GET',
        hasToken: !!localStorage.getItem('authToken')
    });
    
    try {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json',
            },
            credentials: 'include'
        };
        
        // Add Authorization header if we have a token
        const token = localStorage.getItem('authToken');
        if (token) {
            defaultOptions.headers['Authorization'] = `Bearer ${token}`;
            Logger.log('Adding Authorization header with Bearer token');
        }
        
        const response = await fetch(`${baseURL}${endpoint}`, {
            ...defaultOptions,
            ...options,
            headers: {
                ...defaultOptions.headers,
                ...options.headers
            }
        });
        
        Logger.log('API response received', {
            endpoint,
            status: response.status,
            statusText: response.statusText
        });
        
        if (response.status === 401) {
            Logger.warn('Authentication failed (401) for endpoint:', endpoint);
            // Clear invalid token
            localStorage.removeItem('authToken');
            localStorage.removeItem('isAuthenticated');
            throw new Error('Authentication required');
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = { error: errorText || `HTTP ${response.status}` };
            }
            
            throw new Error(errorData.error || `Request failed with status ${response.status}`);
        }
        
        return await response.json();
        
    } catch (error) {
        Logger.error(`API call failed for ${endpoint}`, error);
        throw error;
    }
}

// Check authentication status - FIXED
async function checkAuthentication() {
    try {
        Logger.log('Checking authentication status...');
        
        const token = localStorage.getItem('authToken');
        if (!token) {
            Logger.log('No token found in localStorage');
            return false;
        }
        
        Logger.log('Token found, verifying with server', { 
            tokenLength: token.length,
            tokenPreview: token.substring(0, 20) + '...'
        });
        
        // Use direct fetch to avoid circular issues
        const baseURL = getBaseURL();
        const response = await fetch(`${baseURL}/api/user`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });
        
        Logger.log('Auth check response', {
            status: response.status,
            ok: response.ok
        });
        
        if (response.status === 401) {
            Logger.warn('Token invalid or expired');
            localStorage.removeItem('authToken');
            localStorage.removeItem('isAuthenticated');
            return false;
        }
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        Logger.log('User data received:', data);
        
        if (data.user && data.user.username) {
            Logger.info('User authenticated', { username: data.user.username });
            localStorage.setItem('isAuthenticated', 'true');
            localStorage.setItem('username', data.user.username);
            return true;
        }
        
        return false;
        
    } catch (error) {
        Logger.error('Auth check failed:', error);
        localStorage.removeItem('authToken');
        localStorage.removeItem('isAuthenticated');
        return false;
    }
}

// Main authentication function
async function authenticateUser(username, password) {
    const errorElement = document.getElementById('login-error');
    const submitButton = document.querySelector('#login-form button[type="submit"]');
    const originalButtonText = submitButton.innerHTML;

    try {
        Logger.log('Authentication attempt started', { username });
        
        // Show loading state
        submitButton.disabled = true;
        submitButton.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Signing in...';
        
        if (errorElement) {
            errorElement.style.display = 'none';
        }

        const baseURL = getBaseURL();
        const response = await fetch(`${baseURL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                username: username,
                password: password
            }),
            credentials: 'include'
        });

        Logger.log('Login API response status', { status: response.status });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Login failed' }));
            throw new Error(errorData.error || `HTTP ${response.status}`);
        }

        const data = await response.json();
        Logger.log('Login successful', Logger.sanitizeData(data));

        // Store tokens and user data
        if (data.accessToken) {
            localStorage.setItem('authToken', data.accessToken);
            localStorage.setItem('refreshToken', data.refreshToken);
            localStorage.setItem('isAuthenticated', 'true');
            localStorage.setItem('username', data.username);
            localStorage.setItem('userId', data.userId);
            localStorage.setItem('isAdmin', data.is_admin || false);
            
            Logger.info('Tokens stored successfully', {
                hasAccessToken: !!data.accessToken,
                username: data.username
            });
            
            // Show success feedback
            showLoginSuccess('Login successful! Redirecting...');
            
            // Redirect to device selection after short delay
            setTimeout(() => {
                window.location.href = '../devices/';
            }, 1000);
            
        } else {
            throw new Error('No access token received from server');
        }
        
    } catch (error) {
        Logger.error('Login error occurred', error);
        
        if (errorElement) {
            errorElement.textContent = error.message || 'Login failed. Please check your credentials.';
            errorElement.style.display = 'block';
        }
        
        // Shake animation for error feedback
        const loginCard = document.querySelector('.login-card');
        if (loginCard) {
            loginCard.style.animation = 'shake 0.5s ease-in-out';
            setTimeout(() => loginCard.style.animation = '', 500);
        }
    } finally {
        // Restore button state
        submitButton.disabled = false;
        submitButton.innerHTML = originalButtonText;
    }
}

// Show login success message
function showLoginSuccess(message) {
    Logger.log('Showing login success', { message });
    
    const successDiv = document.createElement('div');
    successDiv.className = 'form-success';
    successDiv.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    successDiv.style.cssText = `
        background: var(--success);
        color: white;
        padding: 12px 20px;
        border-radius: 5px;
        margin-bottom: 20px;
        text-align: center;
        animation: fadeIn 0.3s ease-in;
    `;
    
    const form = document.getElementById('login-form');
    if (form) {
        // Remove any existing success messages
        const existingSuccess = form.querySelector('.form-success');
        if (existingSuccess) {
            existingSuccess.remove();
        }
        
        form.insertBefore(successDiv, form.firstChild);
    }
}

// Handle unauthenticated state
function handleUnauthenticatedState() {
    Logger.warn('Handling unauthenticated state');
    
    // Clear all auth-related storage
    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('username');
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('userId');
    localStorage.removeItem('isAdmin');
    
    // Redirect to login page
    window.location.href = '/auth/login.html';
}

// Debug function to check token status
function debugTokenStatus() {
    const token = localStorage.getItem('authToken');
    const isAuthenticated = localStorage.getItem('isAuthenticated');
    const username = localStorage.getItem('username');
    
    Logger.log('Token Debug Info', {
        hasAuthToken: !!token,
        authTokenLength: token ? token.length : 0,
        isAuthenticated: isAuthenticated,
        username: username
    });
}