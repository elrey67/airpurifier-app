// Authentication logic
document.addEventListener('DOMContentLoaded', function() {
    const loginForm = document.getElementById('login-form');
    
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        authenticateUser(username, password);
    });
    
    // Check if already logged in
    checkAuthentication();
});

// Get base URL with proper protocol and port
function getBaseURL() {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = window.location.port;
    
    Logger.log('Getting base URL', { protocol, hostname, port });
    
    // Always include port if it exists (even for IP addresses)
    if (port) {
        return `${protocol}//${hostname}:${port}`;
    } else {
        return `${protocol}//${hostname}`;
    }
}

// Environment-based logger
// Environment-based logger
const Logger = {
    // Determine environment - .com means production, everything else is development
    getEnvironment: function() {
        const hostname = window.location.hostname;
        return hostname.includes('.com') ? 'production' : 'development';
    },
    
    // Check if debug logging is enabled
    isDebugEnabled: function() {
        return this.getEnvironment() === 'development';
    },
    
    // Log levels - Fixed to use proper console formatting
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
    
    // Secure logging - never log sensitive data
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

async function authenticateUser(username, password) {
    const errorElement = document.getElementById('login-error');

    try {
        Logger.log('Authentication attempt started', { 
            username: username, 
            environment: Logger.getEnvironment() 
        });
        
        const baseURL = getBaseURL();
        Logger.log('Using base URL', { baseURL });
        
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

        Logger.log('Login API response received', { 
            status: response.status,
            statusText: response.statusText
        });

        if (!response.ok) {
            const errorData = await response.json().catch(() => ({ error: 'Login failed' }));
            const errorMessage = errorData.error || `HTTP ${response.status}: ${response.statusText}`;
            
            Logger.warn('Login failed', {
                status: response.status,
                error: errorMessage
            });
            
            throw new Error(errorMessage);
        }

        const data = await response.json();
        Logger.log('Login successful', Logger.sanitizeData(data));

        // CORRECTED: User data is directly in the response, not under 'user' property
        localStorage.setItem('authToken', data.token);
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('username', data.username);  // Direct access
        localStorage.setItem('userId', data.userId);      // Direct access
        localStorage.setItem('isAdmin', data.is_admin || false); // Use fallback
        
        Logger.info('User authenticated successfully', {
            username: data.username,
            userId: data.userId,
            isAdmin: data.is_admin || false
        });
        
        // Redirect to device selection
        window.location.href = '../devices/';
        
    } catch (error) {
        Logger.error('Login error occurred', error);
        
        errorElement.textContent = error.message || 'Login failed. Please check your credentials.';
        errorElement.style.display = 'block';
        
        // Shake animation
        const loginCard = document.querySelector('.login-card');
        loginCard.style.animation = 'shake 0.5s ease-in-out';
        setTimeout(() => loginCard.style.animation = '', 500);
    }
}

async function checkAuthentication() {
    const token = localStorage.getItem('authToken');
    
    Logger.log('Checking authentication status', {
        hasToken: !!token,
        environment: Logger.getEnvironment()
    });
    
    if (!token) {
        Logger.log('No auth token found, user not authenticated');
        return;
    }

    try {
        const baseURL = getBaseURL();
        Logger.log('Verifying authentication token');
        
        const response = await fetch(`${baseURL}/api/auth/verify`, {
            headers: {
                'Authorization': `Bearer ${token}`
            },
            credentials: 'include'
        });

        Logger.log('Token verification response', {
            status: response.status,
            statusText: response.statusText
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();
        Logger.log('Token verification result', Logger.sanitizeData(data));

        if (data.valid) {
            Logger.info('User already authenticated, redirecting to devices page');
            // Already logged in, redirect to devices page
            window.location.href = '../devices/';
        } else {
            Logger.warn('Token invalid, clearing storage');
            // Token invalid, clear storage
            localStorage.clear();
        }
    } catch (error) {
        Logger.error('Auth verification failed', error);
        localStorage.clear();
    }
}