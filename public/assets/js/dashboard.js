// dashboard.js - Updated with Database-Powered Pagination

// System state
let systemMode = 'offline';
let inputAirQuality = 0;
let outputAirQuality = 0;
let efficiency = 0;
let fanState = false;
let autoMode = "ON";
let threshold = 300;
let thresholdLoaded = false;
let historyData = [];
let lastUpdateTime = new Date();
let isUpdating = false;
let lastSuccessfulUpdate = null;
let connectionRetries = 0;
let lastConnectionStatus = '';

// Pagination variables
let currentPage = 1;
let recordsPerPage = 10;
let totalRecords = 0;
let isLoadingHistory = false;

// Environment-based logger for dashboard page (matching devices.js standard)
const Logger = {
    getEnvironment: function () {
        const hostname = window.location.hostname;
        return hostname.includes('.com') ? 'production' : 'development';
    },

    isDebugEnabled: function () {
        return this.getEnvironment() === 'development';
    },

    log: function (message, data = null) {
        if (this.isDebugEnabled()) {
            console.log(`%c[DASHBOARD] ${message}`, 'color: purple; font-weight: bold;', data || '');
        }
    },

    info: function (message, data = null) {
        console.info(`%c[DASHBOARD] ${message}`, 'color: teal; font-weight: bold;', data || '');
    },

    warn: function (message, data = null) {
        console.warn(`%c[DASHBOARD] ${message}`, 'color: darkorange; font-weight: bold;', data || '');
    },

    error: function (message, error = null) {
        console.error(`%c[DASHBOARD] ${message}`, 'color: crimson; font-weight: bold;', error || '');
    },

    sanitizeData: function (data) {
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

    Logger.log('Getting base URL', { protocol, hostname, port });
    return `${protocol}//${hostname}${port ? ':' + port : ''}`;
}

// Enhanced fetch with proper token handling - MATCHING DEVICES.JS STANDARD
async function apiFetch(endpoint, options = {}) {
    const baseURL = getBaseURL();
    const token = localStorage.getItem('authToken');

    Logger.log('API fetch request', {
        endpoint,
        baseURL,
        hasToken: !!token
    });

    try {
        const defaultOptions = {
            headers: {
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        };

        // Add Authorization header if we have a token - MATCHING DEVICES.JS PATTERN
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
            Logger.warn('Authentication failed, redirecting to login');
            handleUnauthenticatedState();
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

// Authentication check - MATCHING DEVICES.JS PATTERN
async function checkAuthentication() {
    try {
        Logger.log('Checking authentication status...');

        const token = localStorage.getItem('authToken');
        if (!token) {
            Logger.warn('No auth token found');
            handleUnauthenticatedState();
            return false;
        }

        const baseURL = getBaseURL();
        const response = await fetch(`${baseURL}/api/user`, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            credentials: 'include'
        });

        Logger.log('Response from /api/user:', {
            status: response.status,
            ok: response.ok
        });

        if (response.status === 401) {
            Logger.warn('User not authenticated');
            handleUnauthenticatedState();
            return false;
        }

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const data = await response.json();
        Logger.log('User data received:', data);

        if (!data.success || !data.user || !data.user.username) {
            throw new Error(`Invalid user data received: ${JSON.stringify(data)}`);
        }

        // Update UI for authenticated user
        updateUIForAuthenticatedUser(data.user);
        Logger.info('User authenticated', { username: data.user.username });
        return true;
    } catch (error) {
        Logger.error('Auth check failed:', error);
        handleUnauthenticatedState();
        return false;
    }
}

function updateUIForAuthenticatedUser(user) {
    const username = user.username || 'User';
    Logger.log('Updating UI for authenticated user:', username);

    const usernameDisplay = document.getElementById('username-display');
    if (usernameDisplay) {
        usernameDisplay.textContent = username;
    }

    // Update localStorage for consistency
    localStorage.setItem('isAuthenticated', 'true');
    localStorage.setItem('username', username);
    document.body.classList.add('user-authenticated');
}

function handleUnauthenticatedState() {
    Logger.warn('Handling unauthenticated state');

    localStorage.removeItem('isAuthenticated');
    localStorage.removeItem('username');
    localStorage.removeItem('authToken');
    document.body.classList.remove('user-authenticated');

    // Redirect to login with current page as redirect target
    const currentPath = window.location.pathname + window.location.search;
    window.location.href = `/auth/login.html?redirect=${encodeURIComponent(currentPath)}`;
}

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

// Add logout functionality - MATCHING DEVICES.JS PATTERN
async function logoutUser() {
    Logger.info('User logging out');

    try {
        const refreshToken = localStorage.getItem('refreshToken');

        await apiFetch('/api/auth/logout', {
            method: 'POST',
            body: JSON.stringify({
                refreshToken: refreshToken
            })
        });

        Logger.info('Logout API call successful');
    } catch (error) {
        Logger.error('Logout API call failed:', error);
    } finally {
        // Always clear local storage and redirect regardless of API success/failure
        localStorage.clear();
        window.location.href = '/login';
    }
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
            handleUnauthenticatedState();
        }
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

// Initialize the page - IMPROVED WITH BETTER LOGGING
document.addEventListener('DOMContentLoaded', function () {
    Logger.log('Dashboard page loaded');
    initializeDashboard();
});

// Initialize the dashboard page - NEW FUNCTION MATCHING DEVICES.JS STRUCTURE
async function initializeDashboard() {
    try {
        const isAuth = await checkAuthentication();
        if (!isAuth) {
            Logger.warn('User not authenticated, redirecting to login');
            return;
        }

        // Check token expiration on load
        checkTokenExpiration();
        initializeTouchInteractions();

        initializeEventListeners();
        initializeMobileMenu();
        initializeGauges();
        updateConnectionStatus('reconnecting', 'Checking system mode...');

        // Show server URL in footer
        const serverUrlElement = document.getElementById('server-url');
        if (serverUrlElement) {
            serverUrlElement.textContent = window.location.hostname;
        }

        // Add logout button functionality if it exists
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function (e) {
                e.preventDefault();
                logoutUser();
            });
            Logger.log('Logout button initialized');
        }

        // Load initial historical data
        await loadInitialHistoricalData();
        await loadInitialHistoricalData();
        await loadThresholdFromDatabase();

        // Initial update
        setTimeout(() => {
            checkSystemMode();
        }, 100);

        // Set up periodic updates
        setInterval(updateData, 2000);

        // Check token expiration every minute
        setInterval(checkTokenExpiration, 60 * 1000);

        Logger.info('Dashboard initialized successfully');
    } catch (error) {
        Logger.error('Failed to initialize dashboard page', error);
        handleUnauthenticatedState();
    }
}

// ==================== DATABASE-POWERED HISTORY FUNCTIONS ====================

// Load initial historical data from database
async function loadInitialHistoricalData() {
    if (isLoadingHistory) return;

    try {
        isLoadingHistory = true;
        Logger.log('Loading initial historical data from database...');

        const deviceId = getCurrentDeviceId();
        const response = await apiFetch(`/api/readings?device_id=${deviceId}&limit=1000`);

        if (response && response.data) {
            // Transform database data to match our history format
            historyData = response.data.map(reading => ({
                timestamp: new Date(reading.timestamp),
                inputQuality: parseFloat(reading.input_air_quality) || 0,
                outputQuality: parseFloat(reading.output_air_quality) || 0,
                efficiency: parseFloat(reading.efficiency) || 0,
                fanState: Boolean(reading.fan_state),
                autoMode: reading.auto_mode === true || reading.auto_mode === 1 ? "ON" : "OFF",
                systemMode: reading.system_mode || 'offline'
            }));

            totalRecords = historyData.length;
            Logger.log(`Loaded ${historyData.length} historical records from database`);

            // Update the table with the loaded data
            updateHistoryTable();
            updateCharts();
            updateStatistics();
        }
    } catch (error) {
        Logger.error('Failed to load historical data from database:', error);
        // Initialize with empty array if database load fails
        historyData = [];
        totalRecords = 0;
    } finally {
        isLoadingHistory = false;
    }
}

// Load threshold setting from database
async function loadThresholdFromDatabase() {
    try {
        Logger.log('Loading threshold from database...');
        const deviceId = getCurrentDeviceId();

        const response = await apiFetch(`/api/settings/${deviceId}`);

        if (response && response.threshold) {
            threshold = parseInt(response.threshold);
            thresholdLoaded = true;

            // Update UI
            const thresholdSlider = document.getElementById('threshold');
            const thresholdValue = document.getElementById('threshold-value');

            if (thresholdSlider) {
                thresholdSlider.value = threshold;
            }
            if (thresholdValue) {
                thresholdValue.textContent = threshold;
            }

            Logger.log('Threshold loaded from database:', threshold);
        } else {
            Logger.log('No saved threshold found, using default:', threshold);
        }
    } catch (error) {
        Logger.error('Failed to load threshold from database:', error);
        // Keep default threshold value
    }
}

// Load paginated data from database
async function loadPaginatedData(page = 1, limit = null) {
    try {
        const deviceId = getCurrentDeviceId();
        const pageLimit = limit || recordsPerPage;

        Logger.log(`Loading paginated data - Page: ${page}, Limit: ${pageLimit}`);

        const response = await apiFetch(
            `/api/readings?device_id=${deviceId}&page=${page}&limit=${pageLimit}`
        );

        if (response && response.data) {
            // Transform database data
            const pageData = response.data.map(reading => ({
                timestamp: new Date(reading.timestamp),
                inputQuality: parseFloat(reading.input_air_quality) || 0,
                outputQuality: parseFloat(reading.output_air_quality) || 0,
                efficiency: parseFloat(reading.efficiency) || 0,
                fanState: Boolean(reading.fan_state),
                autoMode: reading.auto_mode === true || reading.auto_mode === 1 ? "ON" : "OFF",
                systemMode: reading.system_mode || 'offline'
            }));

            return {
                data: pageData,
                total: response.total || pageData.length,
                page: response.page || page,
                limit: response.limit || pageLimit
            };
        }
    } catch (error) {
        Logger.error('Failed to load paginated data:', error);
        throw error;
    }

    return { data: [], total: 0, page: 1, limit: recordsPerPage };
}

// Add event listener for records per page change
document.getElementById('records-per-page').addEventListener('change', function () {
    recordsPerPage = parseInt(this.value);
    currentPage = 1; // Reset to first page
    renderTable(); // Re-render the table
    renderPagination(); // Update pagination buttons
});

// Add current reading to history and database
function addToHistory(data) {
    // Add to local history array (for charts and real-time display)
    historyData.unshift(data);
    if (historyData.length > 200) {
        historyData.pop();
    }

    // Update displays
    updateCharts();
    updateHistoryTable();

    Logger.log('Added current reading to history', {
        input: data.inputQuality,
        output: data.outputQuality,
        efficiency: data.efficiency
    });
}

// ==================== PAGINATION FUNCTIONS ====================

async function updateHistoryTable() {
    const tableBody = document.getElementById('history-table-body');
    if (!tableBody) return;

    // Show loading state
    tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">Loading data...</td></tr>';

    try {
        // Calculate pagination
        const startIndex = (currentPage - 1) * recordsPerPage;
        const endIndex = Math.min(startIndex + recordsPerPage, historyData.length);
        const pageData = historyData.slice(startIndex, endIndex);

        Logger.log(`Updating history table - Page: ${currentPage}, Records: ${pageData.length}, Total: ${historyData.length}`);

        // Clear table
        tableBody.innerHTML = '';

        // Populate table with current page data
        if (pageData.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px;">No historical data available</td></tr>';
        } else {
            pageData.forEach(data => {
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

        updatePaginationControls();
    } catch (error) {
        Logger.error('Error updating history table:', error);
        tableBody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 20px; color: var(--danger);">Error loading data</td></tr>';
    }
}

function updatePaginationControls() {
    const totalPages = Math.ceil(historyData.length / recordsPerPage);
    const paginationInfo = document.getElementById('pagination-info');
    const paginationButtons = document.getElementById('pagination-buttons');

    // Update pagination info
    if (paginationInfo) {
        const startIndex = (currentPage - 1) * recordsPerPage + 1;
        const endIndex = Math.min(startIndex + recordsPerPage - 1, historyData.length);
        const totalRecords = historyData.length;

        paginationInfo.textContent = `Showing ${startIndex} to ${endIndex} of ${totalRecords} records`;
        Logger.log(`Pagination info: ${startIndex}-${endIndex} of ${totalRecords}`);
    }

    // Update pagination buttons
    if (paginationButtons) {
        paginationButtons.innerHTML = '';

        // Previous button
        const prevButton = document.createElement('button');
        prevButton.textContent = 'Previous';
        prevButton.className = 'pagination-btn';
        prevButton.disabled = currentPage === 1;
        prevButton.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                updateHistoryTable();
                Logger.log(`Navigated to previous page: ${currentPage}`);
            }
        });
        paginationButtons.appendChild(prevButton);

        // Page numbers - show max 5 pages for better UX
        const startPage = Math.max(1, currentPage - 2);
        const endPage = Math.min(totalPages, startPage + 4);

        for (let i = startPage; i <= endPage; i++) {
            const pageButton = document.createElement('button');
            pageButton.textContent = i;
            pageButton.className = `pagination-btn ${i === currentPage ? 'active' : ''}`;
            pageButton.addEventListener('click', () => {
                currentPage = i;
                updateHistoryTable();
                Logger.log(`Navigated to page: ${currentPage}`);
            });
            paginationButtons.appendChild(pageButton);
        }

        // Next button
        const nextButton = document.createElement('button');
        nextButton.textContent = 'Next';
        nextButton.className = 'pagination-btn';
        nextButton.disabled = currentPage === totalPages;
        nextButton.addEventListener('click', () => {
            if (currentPage < totalPages) {
                currentPage++;
                updateHistoryTable();
                Logger.log(`Navigated to next page: ${currentPage}`);
            }
        });
        paginationButtons.appendChild(nextButton);
    }
}

// Records per page change handler
function changeRecordsPerPage(value) {
    recordsPerPage = parseInt(value);
    currentPage = 1; // Reset to first page when changing records per page
    updateHistoryTable();
    Logger.log(`Records per page changed to: ${recordsPerPage}`);
}

// ==================== EXISTING FUNCTIONS (KEEP ALL YOUR ORIGINAL CODE) ====================

// Initialize gauges with proper positioning
function initializeGauges() {
    Logger.log('Initializing gauges with proper positioning');

    // Set initial positions
    updateGaugeNeedle('input', 0);
    updateGaugeNeedle('output', 0);
    updateEfficiencyGaugeNeedle(0);
}

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
        tab.addEventListener('click', function () {
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

            // Load fresh data when switching to table tab
            if (this.dataset.tab === 'table') {
                loadInitialHistoricalData();
            }
        });
    });
}

// Get the device ID
function getCurrentDeviceId() {
    const deviceId = localStorage.getItem('currentDevice') || 'esp32_air_purifier_01';
    Logger.log('Getting current device ID:', deviceId);
    return deviceId;
}

function checkSystemMode() {
    // Check authentication before making API calls
    if (!isAuthenticated()) {
        Logger.warn('Not authenticated, cannot check system mode');
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
            if (error.message === 'Authentication required') {
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

            if (error.message === 'Authentication required') {
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
        switch (status) {
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

    addToHistory({
        timestamp: new Date(),
        inputQuality: inputAirQuality,
        outputQuality: outputAirQuality,
        efficiency: efficiency,
        fanState: fanState,
        autoMode: autoMode,
        systemMode: systemMode
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

    // Update gauges with proper values
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

// Update air quality gauge needles (0-2000 PPM range) - FIXED FOR COMPACT GAUGES
function updateGaugeNeedle(type, value) {
    const needle = document.getElementById(`${type}-gauge-needle`);
    const valueElement = document.getElementById(`${type}-gauge-value`);

    Logger.log(`Updating ${type} gauge - Value: ${value}`);

    if (needle && valueElement) {
        // Convert value to angle (-135° to +135° range for 270° arc)
        const normalizedValue = Math.min(Math.max(value, 0), 2000);
        const rotation = -135 + (normalizedValue / 2000) * 270;

        needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
        valueElement.textContent = Math.round(value) + ' PPM';

        // Update value color based on air quality
        if (value < 300) {
            valueElement.style.color = 'var(--success)';
        } else if (value < 600) {
            valueElement.style.color = 'var(--warning)';
        } else {
            valueElement.style.color = 'var(--danger)';
        }

        Logger.log(`${type} gauge needle rotated to: ${rotation}deg for value: ${value}`);

        // Force browser repaint
        needle.offsetHeight;
    } else {
        Logger.warn(`${type} gauge elements not found`);
    }
}

// Update efficiency gauge needle (0-100% range) - FIXED FOR COMPACT GAUGES
function updateEfficiencyGaugeNeedle(value) {
    const needle = document.getElementById('efficiency-gauge-needle');
    const valueElement = document.getElementById('efficiency-gauge-value');

    Logger.log('Updating efficiency gauge - Value:', value);

    if (needle && valueElement) {
        // Convert value to angle (-135° to +135° range for 270° arc)
        const normalizedValue = Math.min(Math.max(value, 0), 100);
        const rotation = -135 + (normalizedValue / 100) * 270;

        needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
        valueElement.textContent = Math.round(value) + '%';

        // Update value color based on efficiency
        if (value > 70) {
            valueElement.style.color = 'var(--success)';
        } else if (value > 40) {
            valueElement.style.color = 'var(--warning)';
        } else {
            valueElement.style.color = 'var(--danger)';
        }

        Logger.log(`Efficiency gauge needle rotated to: ${rotation}deg for value: ${value}%`);

        // Force browser repaint
        needle.offsetHeight;
    } else {
        Logger.warn('Efficiency gauge elements not found');
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
    const deviceId = getCurrentDeviceId();
    Logger.log('Saving threshold to database:', { threshold, deviceId });

    apiFetch(`/api/settings/${deviceId}`, {
        method: 'PUT',
        body: JSON.stringify({ threshold: threshold })
    })
        .then(data => {
            Logger.log('Threshold saved successfully to database:', data);
            thresholdLoaded = true;
            showCommandFeedback('Threshold saved successfully', 'success');
        })
        .catch(error => {
            Logger.error('Error saving threshold to database:', error);
            if (error.message === 'Authentication required') {
                showCommandFeedback('Authentication required', 'error');
            } else {
                showCommandFeedback('Failed to save threshold', 'error');
            }
        });
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
            if (error.message === 'Authentication required') {
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

// ==================== MOBILE MENU FUNCTIONS ====================

function initializeMobileMenu() {
    const mobileMenuToggle = document.getElementById('mobile-menu-toggle');
    const mobileMenuClose = document.getElementById('mobile-menu-close');
    const mobileMenuOverlay = document.getElementById('mobile-menu-overlay');
    const mobileMenuSidebar = document.getElementById('mobile-menu-sidebar');
    const mobileLogoutBtn = document.getElementById('mobile-logout-btn');

    // Toggle mobile menu
    if (mobileMenuToggle) {
        mobileMenuToggle.addEventListener('click', function () {
            mobileMenuSidebar.classList.add('active');
            mobileMenuOverlay.classList.add('active');
            document.body.classList.add('mobile-menu-open');
        });
    }

    // Close mobile menu
    function closeMobileMenu() {
        mobileMenuSidebar.classList.remove('active');
        mobileMenuOverlay.classList.remove('active');
        document.body.classList.remove('mobile-menu-open');
    }

    if (mobileMenuClose) {
        mobileMenuClose.addEventListener('click', closeMobileMenu);
    }

    if (mobileMenuOverlay) {
        mobileMenuOverlay.addEventListener('click', closeMobileMenu);
    }

    // Mobile logout functionality
    if (mobileLogoutBtn) {
        mobileLogoutBtn.addEventListener('click', function (e) {
            e.preventDefault();
            closeMobileMenu();
            logoutUser();
        });
    }

    // Close menu when clicking on nav items (except logout)
    const mobileNavItems = document.querySelectorAll('.mobile-nav-item:not(.mobile-nav-logout)');
    mobileNavItems.forEach(item => {
        item.addEventListener('click', closeMobileMenu);
    });

    // Close menu on escape key
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && mobileMenuSidebar.classList.contains('active')) {
            closeMobileMenu();
        }
    });

    // Sync username between desktop and mobile
    syncUsernameDisplay();
}

// Sync username between desktop and mobile displays
function syncUsernameDisplay() {
    const desktopUsername = document.getElementById('username-display');
    const mobileUsername = document.getElementById('mobile-username-display');

    if (desktopUsername && mobileUsername) {
        // Initial sync
        mobileUsername.textContent = desktopUsername.textContent;

        // Observe changes to desktop username
        const observer = new MutationObserver(function (mutations) {
            mutations.forEach(function (mutation) {
                if (mutation.type === 'characterData' || mutation.type === 'childList') {
                    mobileUsername.textContent = desktopUsername.textContent;
                }
            });
        });

        observer.observe(desktopUsername, {
            characterData: true,
            childList: true,
            subtree: true
        });
    }
}

// Add touch-friendly interactions
function initializeTouchInteractions() {
    // Make buttons more touch-friendly
    const buttons = document.querySelectorAll('.toggle-btn, .save-btn, .btn');
    buttons.forEach(button => {
        button.addEventListener('touchstart', function () {
            this.style.transform = 'scale(0.95)';
        });

        button.addEventListener('touchend', function () {
            this.style.transform = 'scale(1)';
        });
    });

    // Improve slider touch experience
    const sliders = document.querySelectorAll('.slider');
    sliders.forEach(slider => {
        slider.addEventListener('touchstart', function (e) {
            e.stopPropagation();
        });
    });

    // Prevent zoom on double tap
    let lastTouchEnd = 0;
    document.addEventListener('touchend', function (event) {
        const now = (new Date()).getTime();
        if (now - lastTouchEnd <= 300) {
            event.preventDefault();
        }
        lastTouchEnd = now;
    }, false);
}

// Add gauge ticks for better visualization
function createGaugeTicks() {
    Logger.log('Creating gauge ticks for better visualization');

    // Create ticks for input and output gauges
    createGaugeTicksForType('input');
    createGaugeTicksForType('output');
    createGaugeTicksForEfficiency();
}

function createGaugeTicksForType(type) {
    const gauge = document.querySelector(`.gauge:has(#${type}-gauge-needle)`);
    if (!gauge) return;

    const ticksContainer = document.createElement('div');
    ticksContainer.className = 'gauge-ticks';

    // Major ticks every 500 PPM
    for (let i = 0; i <= 2000; i += 500) {
        const tick = document.createElement('div');
        tick.className = 'gauge-tick major';

        const angle = -135 + (i / 2000) * 270;
        tick.style.transform = `rotate(${angle}deg) translateY(-65px)`;

        ticksContainer.appendChild(tick);
    }

    // Minor ticks every 100 PPM
    for (let i = 0; i <= 2000; i += 100) {
        if (i % 500 !== 0) {
            const tick = document.createElement('div');
            tick.className = 'gauge-tick';

            const angle = -135 + (i / 2000) * 270;
            tick.style.transform = `rotate(${angle}deg) translateY(-65px)`;

            ticksContainer.appendChild(tick);
        }
    }

    gauge.appendChild(ticksContainer);
}

function createGaugeTicksForEfficiency() {
    const gauge = document.querySelector('.gauge:has(#efficiency-gauge-needle)');
    if (!gauge) return;

    const ticksContainer = document.createElement('div');
    ticksContainer.className = 'gauge-ticks';

    // Major ticks every 25%
    for (let i = 0; i <= 100; i += 25) {
        const tick = document.createElement('div');
        tick.className = 'gauge-tick major';

        const angle = -135 + (i / 100) * 270;
        tick.style.transform = `rotate(${angle}deg) translateY(-65px)`;

        ticksContainer.appendChild(tick);
    }

    // Minor ticks every 10%
    for (let i = 0; i <= 100; i += 10) {
        if (i % 25 !== 0) {
            const tick = document.createElement('div');
            tick.className = 'gauge-tick';

            const angle = -135 + (i / 100) * 270;
            tick.style.transform = `rotate(${angle}deg) translateY(-65px)`;

            ticksContainer.appendChild(tick);
        }
    }

    gauge.appendChild(ticksContainer);
}