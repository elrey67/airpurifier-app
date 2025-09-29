// System state
let systemMode = 'offline';
let inputAirQuality = 0;
let outputAirQuality = 0;
let efficiency = 0;
let fanState = false;
let autoMode = "ON";
let threshold = 300;
let historyData = [];
let lastUpdateTime = new Date();
let isUpdating = false;
let lastSuccessfulUpdate = null;
let connectionRetries = 0;
let lastConnectionStatus = '';

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
            console.log(`%c[DASHBOARD] ${message}`, 'color: purple; font-weight: bold;', data || '');
        }
    },
    
    info: function(message, data = null) {
        console.info(`%c[DASHBOARD] ${message}`, 'color: teal; font-weight: bold;', data || '');
    },
    
    warn: function(message, data = null) {
        console.warn(`%c[DASHBOARD] ${message}`, 'color: darkorange; font-weight: bold;', data || '');
    },
    
    error: function(message, error = null) {
        console.error(`%c[DASHBOARD] ${message}`, 'color: crimson; font-weight: bold;', error || '');
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

// Check if user is authenticated
function isAuthenticated() {
    const token = localStorage.getItem('authToken');
    if (!token || token === 'null' || token === 'undefined') {
        Logger.warn('No valid authentication token found');
        return false;
    }
    
    try {
        // Check if token is expired
        const payload = JSON.parse(atob(token.split('.')[1]));
        const expirationTime = payload.exp * 1000;
        const currentTime = Date.now();
        
        if (expirationTime <= currentTime) {
            Logger.warn('Authentication token has expired');
            return false;
        }
        
        return true;
    } catch (error) {
        Logger.error('Error validating token:', error);
        return false;
    }
}

// Get base URL with proper protocol
function getBaseURL() {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const port = window.location.port;
    
    Logger.log('Getting base URL', { protocol, hostname, port });
    return `${protocol}//${hostname}${port ? ':' + port : ''}`;
}

// Enhanced fetch with automatic token refresh
async function apiFetch(endpoint, options = {}) {
    const baseURL = getBaseURL();
    let token = localStorage.getItem('authToken');
    
    // Check authentication first
    if (!token || token === 'null' || token === 'undefined') {
        Logger.warn('No authentication token available, redirecting to login');
        redirectToLogin();
        throw new Error('Not authenticated');
    }
    
    Logger.log('API fetch request', { 
        endpoint, 
        baseURL,
        hasToken: !!token 
    });
    
    const defaultOptions = {
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}`
        },
        credentials: 'include'
    };
    
    try {
        const response = await fetch(`${baseURL}${endpoint}`, {
            ...defaultOptions,
            ...options
        });
        
        Logger.log('API response received', {
            endpoint,
            status: response.status,
            statusText: response.statusText
        });
        
        // Handle token expiration (401 Unauthorized)
        if (response.status === 401) {
            Logger.warn('Token expired or invalid, attempting refresh');
            
            // Try to refresh the token
            const refreshSuccess = await refreshToken();
            if (refreshSuccess) {
                // Retry the request with new token
                token = localStorage.getItem('authToken');
                defaultOptions.headers.Authorization = `Bearer ${token}`;
                
                const retryResponse = await fetch(`${baseURL}${endpoint}`, {
                    ...defaultOptions,
                    ...options
                });
                
                if (!retryResponse.ok) {
                    if (retryResponse.status === 401) {
                        Logger.error('Token refresh failed, redirecting to login');
                        redirectToLogin();
                        throw new Error('Authentication failed');
                    }
                    throw new Error(`Request failed with status ${retryResponse.status}`);
                }
                
                const data = await retryResponse.json();
                Logger.log('API request successful after token refresh', {
                    endpoint,
                    data: Logger.sanitizeData(data)
                });
                
                return data;
            } else {
                // Refresh failed, redirect to login
                Logger.error('Token refresh failed, redirecting to login');
                redirectToLogin();
                throw new Error('Authentication failed');
            }
        }
        
        if (!response.ok) {
            const errorText = await response.text();
            let errorData;
            try {
                errorData = JSON.parse(errorText);
            } catch {
                errorData = { error: errorText || `HTTP ${response.status}` };
            }
            
            Logger.warn('API request failed', {
                endpoint,
                status: response.status,
                error: errorData.error
            });
            
            throw new Error(errorData.error || `Request failed with status ${response.status}`);
        }
        
        const data = await response.json();
        Logger.log('API request successful', {
            endpoint,
            data: Logger.sanitizeData(data)
        });
        
        return data;
    } catch (error) {
        Logger.error(`API call failed for ${endpoint}`, error);
        throw error;
    }
}

// Token refresh function
async function refreshToken() {
    try {
        Logger.log('Attempting token refresh');
        
        const baseURL = getBaseURL();
        const refreshToken = localStorage.getItem('refreshToken');
        
        if (!refreshToken || refreshToken === 'null' || refreshToken === 'undefined') {
            Logger.warn('No refresh token found');
            return false;
        }
        
        const response = await fetch(`${baseURL}/api/auth/refresh`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ refreshToken }),
            credentials: 'include'
        });
        
        if (response.ok) {
            const data = await response.json();
            if (data.accessToken) {
                localStorage.setItem('authToken', data.accessToken);
                Logger.log('Token refreshed successfully');
                return true;
            } else {
                Logger.warn('Token refresh response missing accessToken');
                return false;
            }
        } else {
            Logger.warn('Token refresh failed', { status: response.status });
            return false;
        }
    } catch (error) {
        Logger.error('Token refresh error', error);
        return false;
    }
}

// Redirect to login
function redirectToLogin() {
    Logger.info('Redirecting to login page');
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentDevice');
    localStorage.removeItem('currentDeviceName');
    
    // Show a user-friendly message
    showAuthError();
    
    // Redirect after a short delay
    setTimeout(() => {
        window.location.href = '/auth/login.html';
    }, 2000);
}

// Show authentication error message
function showAuthError() {
    // Create or update error message
    let errorElement = document.getElementById('auth-error-message');
    if (!errorElement) {
        errorElement = document.createElement('div');
        errorElement.id = 'auth-error-message';
        errorElement.style.cssText = `
            position: fixed;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            background: #dc3545;
            color: white;
            padding: 20px 30px;
            border-radius: 8px;
            z-index: 10001;
            font-size: 16px;
            font-weight: bold;
            text-align: center;
            box-shadow: 0 4px 20px rgba(0,0,0,0.3);
        `;
        document.body.appendChild(errorElement);
    }
    
    errorElement.innerHTML = `
        <div>⚠️ Session Expired</div>
        <div style="font-size: 14px; margin-top: 10px;">
            Please log in again. Redirecting to login page...
        </div>
    `;
    errorElement.style.display = 'block';
}

// Add logout functionality
function logout() {
    Logger.info('User initiated logout');
    localStorage.removeItem('authToken');
    localStorage.removeItem('refreshToken');
    localStorage.removeItem('currentDevice');
    localStorage.removeItem('currentDeviceName');
    window.location.href = '/auth/login.html';
}

// Check token expiration on page load
function checkTokenExpiration() {
    const token = localStorage.getItem('authToken');
    if (token && token !== 'null' && token !== 'undefined') {
        try {
            const payload = JSON.parse(atob(token.split('.')[1]));
            const expirationTime = payload.exp * 1000; // Convert to milliseconds
            const currentTime = Date.now();
            
            // If token expires in less than 5 minutes, refresh it
            if (expirationTime - currentTime < 5 * 60 * 1000) {
                Logger.log('Token expiring soon, refreshing...');
                refreshToken();
            }
        } catch (error) {
            Logger.error('Error checking token expiration', error);
            // If token is malformed, remove it and redirect
            localStorage.removeItem('authToken');
            redirectToLogin();
        }
    }
}

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    Logger.log('DOM loaded, initializing air purifier dashboard...');
    
    // Check authentication first
    if (!isAuthenticated()) {
        Logger.warn('User not authenticated, redirecting to login');
        redirectToLogin();
        return;
    }
    
    // Check token expiration on load
    checkTokenExpiration();
    
    initializeEventListeners();
    updateConnectionStatus('reconnecting', 'Checking system mode...');
    
    // Show server URL in footer
    const serverUrlElement = document.getElementById('server-url');
    if (serverUrlElement) {
        serverUrlElement.textContent = window.location.hostname;
    }
    
    // Add logout button functionality if it exists
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', logout);
        Logger.log('Logout button initialized');
    }
    
    // Initial update
    setTimeout(() => {
        checkSystemMode();
    }, 100);
    
    // Set up periodic updates
    setInterval(updateData, 2000);
    
    // Check token expiration every minute
    setInterval(checkTokenExpiration, 60 * 1000);
});

function initializeEventListeners() {
    Logger.log('Initializing event listeners...');

    // Control event listeners
    const toggleFanBtn = document.getElementById('toggle-fan');
    const toggleModeBtn = document.getElementById('toggle-mode');
    const saveThresholdBtn = document.getElementById('save-threshold');
    const thresholdSlider = document.getElementById('threshold');
    
    if (toggleFanBtn) {
        toggleFanBtn.addEventListener('click', toggleFan);
        Logger.log('Fan toggle button initialized');
    }
    if (toggleModeBtn) {
        toggleModeBtn.addEventListener('click', toggleMode);
        Logger.log('Mode toggle button initialized');
    }
    if (saveThresholdBtn) {
        saveThresholdBtn.addEventListener('click', saveThreshold);
        Logger.log('Save threshold button initialized');
    }
    if (thresholdSlider) {
        thresholdSlider.addEventListener('input', updateThreshold);
        Logger.log('Threshold slider initialized');
    }

    // History tabs
    const historyTabs = document.querySelectorAll('.history-tab');
    Logger.log('Found history tabs:', historyTabs.length);
    
    historyTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.history-content').forEach(c => c.classList.remove('active'));

            this.classList.add('active');
            const contentId = this.dataset.tab + '-content';
            const contentElement = document.getElementById(contentId);
            if (contentElement) {
                contentElement.classList.add('active');
                Logger.log('Switched to tab:', this.dataset.tab);
            }
            
            if (this.dataset.tab === 'stats') {
                updateStatistics();
            }
        });
    });
}

// Get the device ID
function getCurrentDeviceId() {
    return 'esp32_air_purifier_01';
}

function checkSystemMode() {
    // Check authentication before making API calls
    if (!isAuthenticated()) {
        Logger.warn('Not authenticated, cannot check system mode');
        redirectToLogin();
        return;
    }

    Logger.log('Checking system mode via database API...');
    const deviceId = getCurrentDeviceId();
    
    apiFetch(`/api/device-status?device_id=${deviceId}`)
    .then(data => {
        Logger.log('System status received from database:', data);
        
        // SIMPLE LOGIC: Just use the status field from backend
        systemMode = data.status || 'offline';
        
        Logger.log('System mode determined:', systemMode);
        
        // Set initial connection status based on backend status
        const initialStatus = systemMode === 'online' ? 'connected' : 'disconnected';
        const initialMessage = systemMode === 'online' ? 
            'Device online - Real-time data' : 
            'Device offline - Using cached data';
            
        lastConnectionStatus = systemMode;
        updateConnectionStatus(initialStatus, initialMessage);
    })
    .catch(error => {
        Logger.error('Error checking system mode:', error);
        systemMode = 'offline';
        lastConnectionStatus = 'offline';
        if (error.message === 'Not authenticated' || error.message === 'Authentication failed') {
            updateConnectionStatus('error', 'Authentication required');
        } else {
            updateConnectionStatus('error', 'Failed to connect to database');
        }
    });
}

function updateData() {
    // Check authentication before making API calls
    if (!isAuthenticated()) {
        Logger.warn('Not authenticated, skipping data update');
        return;
    }

    // Prevent overlapping updates
    if (isUpdating) {
        Logger.log('Data update skipped - previous update still in progress');
        return;
    }
    
    isUpdating = true;
    const deviceId = getCurrentDeviceId();
    Logger.log('Fetching data from database API for device:', deviceId);
    
    apiFetch(`/api/latest-data?device_id=${deviceId}`)
    .then(data => {
        Logger.log('Data received from database:', data);
        
        if (!data || data.error) {
            throw new Error(data?.error || 'Invalid data received');
        }
        
        // SIMPLE LOGIC: Just use the status field from backend
        systemMode = data.status || 'offline';
        
        updateFromBackendData(data);
        lastSuccessfulUpdate = Date.now();
        connectionRetries = 0;
        
        // SIMPLE STATUS UPDATE: Just use the backend status
        updateConnectionStatusBasedOnBackend(data);
    })
    .catch(error => {
        Logger.error('Error fetching data:', error);
        
        if (error.message === 'Not authenticated' || error.message === 'Authentication failed') {
            updateConnectionStatus('error', 'Authentication required');
            // Don't increment retries for auth errors
            return;
        }
        
        connectionRetries++;
        
        // Only show error status after multiple failures
        if (connectionRetries >= 3) {
            updateConnectionStatus('error', `Connection error - ${error.message}`);
        } else {
            Logger.log(`Connection retry ${connectionRetries}/3`);
            updateConnectionStatus('reconnecting', `Reconnecting... (attempt ${connectionRetries}/3)`);
        }
    })
    .finally(() => {
        isUpdating = false;
    });
}

// SIMPLIFIED: Just use the backend's status directly
function updateConnectionStatusBasedOnBackend(data) {
    // ULTRA SIMPLE: Just use the status field directly
    const status = data.status === 'online' ? 'connected' : 'disconnected';
    const message = data.status === 'online' 
        ? 'Device online - Real-time data' 
        : 'Device offline - Using cached data';
    
    // Only update if status actually changed
    if (lastConnectionStatus !== data.status) {
        lastConnectionStatus = data.status;
        updateConnectionStatus(status, message);
        Logger.log('Connection status updated:', { status, message, systemMode: data.status });
    }
}

function updateConnectionStatus(status, message) {
    const statusElement = document.getElementById('connection-status');
    const statusText = document.getElementById('connection-text');
    
    if (!statusElement || !statusText) {
        Logger.error('Connection status elements not found');
        return;
    }
    
    statusElement.className = 'connection-status';
    statusElement.classList.add(status);
    statusText.textContent = message;
    
    // Update icon
    const icon = statusElement.querySelector('i');
    if (icon) {
        switch(status) {
            case 'connected':
                icon.className = 'fas fa-cloud';
                break;
            case 'disconnected':
                icon.className = 'fas fa-database';
                break;
            case 'reconnecting':
                icon.className = 'fas fa-sync-alt fa-spin';
                break;
            case 'error':
            case 'failed':
                icon.className = 'fas fa-exclamation-triangle';
                break;
            default:
                icon.className = 'fas fa-circle';
        }
    }
    
    // Update mode indicator in status bar
    const wifiStatusElement = document.getElementById('wifi-status');
    if (wifiStatusElement) {
        wifiStatusElement.innerHTML = systemMode === 'online' 
            ? "<i class='fas fa-cloud'></i> Online" 
            : "<i class='fas fa-database'></i> Offline";
    }
    
    Logger.log('Connection status updated:', { status, message, systemMode });
}

function updateFromBackendData(data) {
    Logger.log('Updating from backend data:', data);
    
    // Use the main 'status' field from backend
    systemMode = data.status || 'offline';
    
    // Extract values from database data structure
    const deviceData = data.data || data;

    inputAirQuality = parseFloat(deviceData.input_air_quality) || 0;
    outputAirQuality = parseFloat(deviceData.output_air_quality) || 0;
    efficiency = parseFloat(deviceData.efficiency) || 0;
    fanState = Boolean(deviceData.fan_state);
    autoMode = deviceData.auto_mode === true || deviceData.auto_mode === 1 ? "ON" : "OFF";
    
    Logger.log('Processed values:', {
        inputAirQuality,
        outputAirQuality,
        efficiency,
        fanState,
        autoMode,
        systemMode
    });
    
    updateAllDisplays();
    updateButtonStates();
    updateLastUpdated();
}

function updateAllDisplays() {
    Logger.log('Updating all displays...');
    
    // Update main sensor display values
    updateElementText('input-air-quality-value', Math.round(inputAirQuality) + ' PPM');
    updateElementText('output-air-quality-value', Math.round(outputAirQuality) + ' PPM');
    updateElementText('efficiency-value', Math.round(efficiency) + '%');
    
    Logger.log(`Display values - Input: ${Math.round(inputAirQuality)} PPM, Output: ${Math.round(outputAirQuality)} PPM, Efficiency: ${Math.round(efficiency)}%`);
    
    // Update value colors based on air quality
    updateValueColor('input-air-quality-value', inputAirQuality);
    updateValueColor('output-air-quality-value', outputAirQuality);
    
    // Update efficiency bar
    const efficiencyFill = document.getElementById('efficiency-fill');
    if (efficiencyFill) {
        efficiencyFill.style.width = Math.min(efficiency, 100) + '%';
        Logger.log('Efficiency bar updated to:', efficiency + '%');
    }
    
    // Update efficiency value color
    const efficiencyElement = document.getElementById('efficiency-value');
    if (efficiencyElement) {
        if (efficiency > 70) {
            efficiencyElement.style.color = 'var(--success)';
        } else if (efficiency > 40) {
            efficiencyElement.style.color = 'var(--warning)';
        } else {
            efficiencyElement.style.color = 'var(--danger)';
        }
    }
    
    // Update gauges (needles only - values remain hidden)
    updateGaugeNeedle('input', inputAirQuality);
    updateGaugeNeedle('output', outputAirQuality);
    updateEfficiencyGaugeNeedle(efficiency);
    
    // Update comparison chart
    updateComparisonChart();
    
    // Update status bar efficiency
    const efficiencyStatus = document.getElementById('efficiency-status');
    if (efficiencyStatus) {
        efficiencyStatus.innerHTML = `<i class='fas fa-chart-line'></i> ${Math.round(efficiency)}%`;
    }
}

// Helper function to safely update element text
function updateElementText(elementId, text) {
    const element = document.getElementById(elementId);
    if (element) {
        element.textContent = text;
        Logger.log(`Updated ${elementId}: ${text}`);
    } else {
        Logger.warn(`Element not found: ${elementId}`);
    }
}

function updateButtonStates() {
    const fanBtn = document.getElementById('toggle-fan');
    const modeBtn = document.getElementById('toggle-mode');
    const fanStatusIndicator = document.getElementById('fan-status-indicator');
    const modeStatusIndicator = document.getElementById('mode-status-indicator');
    const fanBtnText = document.getElementById('fan-btn-text');
    const modeBtnText = document.getElementById('mode-btn-text');
    const fanStatusElement = document.getElementById('fan-status');
    const autoStatusElement = document.getElementById('auto-status');

    // Update fan button
    if (fanBtn && fanStatusIndicator && fanBtnText && fanStatusElement) {
        if (fanState) {
            fanBtn.classList.add('active');
            fanBtnText.textContent = 'Turn OFF';
            fanStatusIndicator.textContent = 'Fan is ON';
            fanStatusIndicator.style.background = 'var(--success)';
            fanStatusElement.innerHTML = "<i class='fas fa-fan'></i> ON";
            Logger.log('Fan state: ON');
        } else {
            fanBtn.classList.remove('active');
            fanBtnText.textContent = 'Turn ON';
            fanStatusIndicator.textContent = 'Fan is OFF';
            fanStatusIndicator.style.background = 'var(--danger)';
            fanStatusElement.innerHTML = "<i class='fas fa-fan'></i> OFF";
            Logger.log('Fan state: OFF');
        }
    }

    // Update mode button
    if (modeBtn && modeStatusIndicator && modeBtnText && autoStatusElement) {
        if (autoMode === 'ON') {
            modeBtn.classList.add('active');
            modeBtnText.textContent = 'Switch to Manual';
            modeStatusIndicator.textContent = 'Auto Mode Active';
            modeStatusIndicator.style.background = 'var(--accent)';
            autoStatusElement.innerHTML = "<i class='fas fa-robot'></i> AUTO";
            Logger.log('Auto mode: ON');
        } else {
            modeBtn.classList.remove('active');
            modeBtnText.textContent = 'Switch to Auto';
            modeStatusIndicator.textContent = 'Manual Mode Active';
            modeStatusIndicator.style.background = 'var(--secondary)';
            autoStatusElement.innerHTML = "<i class='fas fa-hand-pointer'></i> MANUAL";
            Logger.log('Auto mode: OFF');
        }
    }
}

// Update only the gauge needles (keep values hidden)
function updateGaugeNeedle(type, value) {
    const needle = document.getElementById(`${type}-gauge-needle`);
    Logger.log(`Updating ${type} gauge needle - Element:`, needle, 'Value:', value);

    if (needle) {
        const rotation = Math.min(Math.max(value / 2000 * 180, 0), 180);
        needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
        Logger.log(`${type} gauge needle rotated to: ${rotation}deg`);
        
        // Force browser repaint to ensure the transform is applied
        needle.offsetHeight;
    } else {
        Logger.warn(`${type} gauge needle element not found`);
    }
}

function updateEfficiencyGaugeNeedle(value) {
    const needle = document.getElementById('efficiency-gauge-needle');
    Logger.log('Updating efficiency gauge needle - Element:', needle, 'Value:', value);

    if (needle) {
        const rotation = Math.min(Math.max(value / 100 * 180, 0), 180);
        needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
        Logger.log(`Efficiency gauge needle rotated to: ${rotation}deg`);
        
        // Force browser repaint to ensure the transform is applied
        needle.offsetHeight;
    } else {
        Logger.warn('Efficiency gauge needle element not found');
    }
}

function updateValueColor(elementId, value) {
    const element = document.getElementById(elementId);
    if (element) {
        if (value < 300) {
            element.style.color = 'var(--success)';
        } else if (value < 600) {
            element.style.color = 'var(--warning)';
        } else {
            element.style.color = 'var(--danger)';
        }
        Logger.log(`Updated ${elementId} color for value: ${value}`);
    }
}

function updateComparisonChart() {
    const inputBar = document.getElementById('input-comparison-bar');
    const outputBar = document.getElementById('output-comparison-bar');
    const improvementElement = document.getElementById('improvement-amount');
    
    if (inputBar && outputBar && improvementElement) {
        const maxValue = Math.max(inputAirQuality, outputAirQuality, 500);
        const inputHeight = (inputAirQuality / maxValue) * 100;
        const outputHeight = (outputAirQuality / maxValue) * 100;
        const improvement = inputAirQuality - outputAirQuality;
        
        inputBar.style.height = inputHeight + '%';
        outputBar.style.height = outputHeight + '%';
        improvementElement.textContent = Math.round(improvement);
        
        Logger.log(`Comparison chart updated - Input: ${inputHeight}%, Output: ${outputHeight}%, Improvement: ${improvement}PPM`);
    }
}

function updateLastUpdated() {
    const now = new Date();
    const diffSec = Math.floor((now - lastUpdateTime) / 1000);

    let displayText;
    if (diffSec < 10) {
        displayText = 'Just now';
    } else if (diffSec < 60) {
        displayText = `${diffSec} seconds ago`;
    } else {
        displayText = `${Math.floor(diffSec / 60)} minutes ago`;
    }

    const lastUpdatedElement = document.getElementById('last-updated-full');
    if (lastUpdatedElement) {
        const sourceIcon = systemMode === 'online' ? '🌐' : '💾';
        const sourceText = systemMode === 'online' ? 'Live Data' : 'Cached Data';
        
        lastUpdatedElement.textContent = 
            `Last updated: ${lastUpdateTime.toLocaleTimeString()} (${displayText}) | ` +
            `Mode: ${systemMode.toUpperCase()} | Source: ${sourceIcon} ${sourceText}`;
    }
    
    lastUpdateTime = now;
    
    Logger.log('Last updated display refreshed', { 
        systemMode, 
        displayText, 
        lastUpdateTime: lastUpdateTime.toLocaleTimeString() 
    });
}

function toggleFan() {
    Logger.log('Toggle fan clicked. Current state:', fanState);
    
    if (systemMode === 'offline') {
        alert('Device is in offline mode. Controls may have limited functionality.');
    }
    
    if (autoMode === "ON") {
        autoMode = "OFF";
        Logger.log('Switched to manual mode');
    }
    
    fanState = !fanState;
    Logger.log('New fan state:', fanState);
    
    sendCommand('fan', fanState ? 'on' : 'off');
    updateButtonStates();
}

function toggleMode() {
    Logger.log('Toggle mode clicked. Current mode:', autoMode);
    
    autoMode = autoMode === "ON" ? "OFF" : "ON";
    Logger.log('New mode:', autoMode);
    
    updateButtonStates();
    sendCommand('auto', autoMode === 'ON' ? 'ON' : 'OFF');
}

function saveThreshold() {
    Logger.log('Save threshold clicked. Threshold:', threshold);
    sendCommand('threshold', threshold);
}

function updateThreshold(e) {
    threshold = parseInt(e.target.value);
    updateElementText('threshold-value', threshold);
    Logger.log('Threshold updated to:', threshold);
}

function sendCommand(command, value) {
    const deviceId = getCurrentDeviceId();
    Logger.log('Sending command via database API:', { command, value, deviceId });
    
    apiFetch('/api/command', {
        method: 'POST',
        body: JSON.stringify({
            command: command,
            value: value,
            device_id: deviceId
        })
    })
    .then(data => {
        Logger.log('Command sent successfully via database API:', data);
        showCommandFeedback('Command sent successfully', 'success');
    })
    .catch(error => {
        Logger.error('Error sending command via database API:', error);
        if (error.message === 'Not authenticated' || error.message === 'Authentication failed') {
            showCommandFeedback('Authentication required', 'error');
        } else {
            showCommandFeedback('Command failed - device may be offline', 'error');
        }
    });
}

function showCommandFeedback(message, type) {
    Logger.log('Showing command feedback:', { message, type });
    
    let feedbackElement = document.getElementById('command-feedback');
    if (!feedbackElement) {
        feedbackElement = document.createElement('div');
        feedbackElement.id = 'command-feedback';
        feedbackElement.style.cssText = `
            position: fixed;
            top: 20px;
            right: 20px;
            padding: 10px 20px;
            border-radius: 5px;
            color: white;
            z-index: 10000;
            font-weight: bold;
        `;
        document.body.appendChild(feedbackElement);
    }
    
    feedbackElement.textContent = message;
    feedbackElement.style.background = 
        type === 'success' ? '#28a745' : 
        type === 'warning' ? '#ffc107' : '#dc3545';
    feedbackElement.style.display = 'block';
    
    setTimeout(() => {
        feedbackElement.style.display = 'none';
    }, 3000);
}

// History and statistics functions (simplified)
function addToHistory(data) {
    historyData.unshift(data);
    if (historyData.length > 50) {
        historyData.pop();
    }
    updateCharts();
    updateHistoryTable();
}

function updateCharts() {
    updateChart('input', historyData.map(d => d.inputQuality));
    updateChart('output', historyData.map(d => d.outputQuality));
    updateChart('efficiency', historyData.map(d => d.efficiency));
}

function updateChart(type, values) {
    const chartContainer = document.getElementById(`${type}-chart-container`);
    if (!chartContainer || values.length === 0) return;
    
    chartContainer.innerHTML = '';

    const maxValue = type === 'efficiency' ? 100 : Math.max(...values, 500);
    const containerWidth = chartContainer.offsetWidth;
    const barWidth = Math.min(8, (containerWidth - 20) / values.length);
    const spacing = 2;

    values.forEach((value, index) => {
        const bar = document.createElement('div');
        bar.className = 'chart-bar';
        bar.style.height = (value / maxValue * 180) + 'px';
        bar.style.left = (index * (barWidth + spacing) + 5) + 'px';
        bar.style.width = barWidth + 'px';

        if (type === 'efficiency') {
            if (value > 70) bar.style.background = 'var(--success)';
            else if (value > 40) bar.style.background = 'var(--warning)';
            else bar.style.background = 'var(--danger)';
        } else {
            if (value < 300) bar.style.background = 'var(--success)';
            else if (value < 600) bar.style.background = 'var(--warning)';
            else bar.style.background = 'var(--danger)';
        }

        chartContainer.appendChild(bar);
    });
}

function updateHistoryTable() {
    const tableBody = document.getElementById('history-table-body');
    if (!tableBody) return;
    
    tableBody.innerHTML = '';

    historyData.forEach(data => {
        const row = document.createElement('tr');

        const timeCell = document.createElement('td');
        timeCell.textContent = formatTime(data.timestamp);

        const inputCell = document.createElement('td');
        inputCell.textContent = Math.round(data.inputQuality);
        updateValueColorElement(inputCell, data.inputQuality);

        const outputCell = document.createElement('td');
        outputCell.textContent = Math.round(data.outputQuality);
        updateValueColorElement(outputCell, data.outputQuality);

        const efficiencyCell = document.createElement('td');
        efficiencyCell.textContent = Math.round(data.efficiency) + '%';
        if (data.efficiency > 70) efficiencyCell.style.color = 'var(--success)';
        else if (data.efficiency > 40) efficiencyCell.style.color = 'var(--warning)';
        else efficiencyCell.style.color = 'var(--danger)';

        const fanCell = document.createElement('td');
        fanCell.textContent = data.fanState ? 'ON' : 'OFF';
        fanCell.style.color = data.fanState ? 'var(--success)' : 'var(--danger)';

        const modeCell = document.createElement('td');
        modeCell.textContent = data.autoMode;

        const sourceCell = document.createElement('td');
        sourceCell.textContent = data.systemMode === 'online' ? 'Cloud' : 'Local';
        sourceCell.style.color = data.systemMode === 'online' ? 'var(--success)' : 'var(--warning)';

        row.appendChild(timeCell);
        row.appendChild(inputCell);
        row.appendChild(outputCell);
        row.appendChild(efficiencyCell);
        row.appendChild(fanCell);
        row.appendChild(modeCell);
        row.appendChild(sourceCell);

        tableBody.appendChild(row);
    });
}

function updateStatistics() {
    if (historyData.length === 0) return;
    
    const inputValues = historyData.map(d => d.inputQuality);
    const outputValues = historyData.map(d => d.outputQuality);
    const efficiencyValues = historyData.map(d => d.efficiency);
    
    const currentInput = inputValues[0];
    const currentOutput = outputValues[0];
    const averageEfficiency = Math.round(efficiencyValues.reduce((a, b) => a + b, 0) / efficiencyValues.length);
    const maxImprovement = Math.round(Math.max(...inputValues.map((val, idx) => val - outputValues[idx])));
    
    updateElementText('current-input-value', currentInput + ' PPM');
    updateElementText('current-output-value', currentOutput + ' PPM');
    updateElementText('average-efficiency-value', averageEfficiency + '%');
    updateElementText('max-improvement-value', maxImprovement + ' PPM');
    
    updateValueColor('current-input-value', currentInput);
    updateValueColor('current-output-value', currentOutput);
    
    const avgEffElement = document.getElementById('average-efficiency-value');
    if (avgEffElement) {
        if (averageEfficiency > 70) avgEffElement.style.color = 'var(--success)';
        else if (averageEfficiency > 40) avgEffElement.style.color = 'var(--warning)';
        else avgEffElement.style.color = 'var(--danger)';
    }
}

function updateValueColorElement(element, value) {
    if (value < 300) {
        element.style.color = 'var(--success)';
    } else if (value < 600) {
        element.style.color = 'var(--warning)';
    } else {
        element.style.color = 'var(--danger)';
    }
}

function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}