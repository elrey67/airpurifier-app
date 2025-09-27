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
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

// User authentication state
let currentUser = null;
let isLoggedIn = false;
let dataUpdateInterval = null;

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing login system...');
    initializeLoginSystem();
    checkAuthentication();
    
    // Show server URL in footer
    const serverUrlElement = document.getElementById('server-url');
    if (serverUrlElement) {
        serverUrlElement.textContent = window.location.hostname;
    }
});

function initializeLoginSystem() {
    const loginForm = document.getElementById('login-form');
    const logoutLink = document.getElementById('logout-link');
    const adminLink = document.getElementById('admin-link');

    // Login form submission
    loginForm.addEventListener('submit', function(e) {
        e.preventDefault();
        const username = document.getElementById('username').value;
        const password = document.getElementById('password').value;
        
        authenticateUser(username, password);
    });

    // Logout functionality
    if (logoutLink) {
        logoutLink.addEventListener('click', function(e) {
            e.preventDefault();
            logoutUser();
        });
    }

    // Admin panel link
    if (adminLink) {
        adminLink.addEventListener('click', function(e) {
            e.preventDefault();
            showAdminPanel();
        });
    }
}

function authenticateUser(username, password) {
    // Simple authentication
    const validUsers = {
        'admin': 'admin123',
        'user': 'user123',
        'operator': 'operator123'
    };

    const errorElement = document.getElementById('login-error');

    if (validUsers[username] && validUsers[username] === password) {
        currentUser = username;
        isLoggedIn = true;
        
        // Store login state
        localStorage.setItem('isLoggedIn', 'true');
        localStorage.setItem('username', username);
        
        // Switch to dashboard
        showDashboard();
        
        // Clear form and hide error
        document.getElementById('login-form').reset();
        errorElement.style.display = 'none';
        
        console.log('User authenticated:', username);
    } else {
        errorElement.textContent = 'Invalid username or password';
        errorElement.style.display = 'block';
        
        // Shake animation for error
        const loginCard = document.querySelector('.login-card');
        loginCard.style.animation = 'shake 0.5s ease-in-out';
        setTimeout(() => {
            loginCard.style.animation = '';
        }, 500);
    }
}

function checkAuthentication() {
    const storedLogin = localStorage.getItem('isLoggedIn');
    const storedUsername = localStorage.getItem('username');
    
    if (storedLogin === 'true' && storedUsername) {
        currentUser = storedUsername;
        isLoggedIn = true;
        showDashboard();
    } else {
        showLoginPage();
    }
}

function showLoginPage() {
    document.getElementById('login-page').style.display = 'flex';
    document.getElementById('dashboard').style.display = 'none';
    document.body.className = 'login-page';
    
    // Stop data updates if running
    if (dataUpdateInterval) {
        clearInterval(dataUpdateInterval);
        dataUpdateInterval = null;
    }
}

function showDashboard() {
    document.getElementById('login-page').style.display = 'none';
    document.getElementById('dashboard').style.display = 'block';
    document.body.className = '';
    
    // Update user interface
    updateUserInterface();
    
    // Initialize dashboard functionality
    initializeDashboard();
    
    // Start data updates
    startDataUpdates();
}

function updateUserInterface() {
    const welcomeElement = document.getElementById('username-display');
    if (welcomeElement && currentUser) {
        welcomeElement.textContent = currentUser;
    }
}

function initializeDashboard() {
    console.log('Initializing dashboard...');
    initializeEventListeners();
    
    // Enhanced initial status check
    updateConnectionStatus('reconnecting', 'Connecting to device and database...');
    
    // Perform initial system check with retry logic
    performInitialSystemCheck();
}

function performInitialSystemCheck() {
    let attempts = 0;
    const maxAttempts = 3;
    
    function attemptCheck() {
        attempts++;
        console.log(`Initial system check attempt ${attempts}/${maxAttempts}`);
        
        checkSystemMode();
        
        // If still reconnecting after 5 seconds, try again
        setTimeout(() => {
            const statusElement = document.getElementById('connection-status');
            if (statusElement && statusElement.classList.contains('reconnecting') && attempts < maxAttempts) {
                attemptCheck();
            }
        }, 5000);
    }
    
    attemptCheck();
}

function startDataUpdates() {
    // Clear existing interval if any
    if (dataUpdateInterval) {
        clearInterval(dataUpdateInterval);
    }
    
    // Start new interval for real-time updates
    dataUpdateInterval = setInterval(updateData, 2000);
    console.log('Data updates started');
}

function logoutUser() {
    currentUser = null;
    isLoggedIn = false;
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('username');
    
    // Stop data updates
    if (dataUpdateInterval) {
        clearInterval(dataUpdateInterval);
        dataUpdateInterval = null;
    }
    
    // Show login page
    showLoginPage();
    console.log('User logged out');
}

function showAdminPanel() {
    alert('Admin panel would open here. User: ' + currentUser);
}

function initializeEventListeners() {
    console.log('Initializing event listeners...');

    // Control event listeners
    const toggleFanBtn = document.getElementById('toggle-fan');
    const toggleModeBtn = document.getElementById('toggle-mode');
    const saveThresholdBtn = document.getElementById('save-threshold');
    const thresholdSlider = document.getElementById('threshold');
    
    if (toggleFanBtn) {
        toggleFanBtn.addEventListener('click', toggleFan);
        console.log('Fan toggle button initialized');
    }
    if (toggleModeBtn) {
        toggleModeBtn.addEventListener('click', toggleMode);
        console.log('Mode toggle button initialized');
    }
    if (saveThresholdBtn) {
        saveThresholdBtn.addEventListener('click', saveThreshold);
        console.log('Save threshold button initialized');
    }
    if (thresholdSlider) {
        thresholdSlider.addEventListener('input', updateThreshold);
        console.log('Threshold slider initialized');
    }

    // History tabs
    const historyTabs = document.querySelectorAll('.history-tab');
    console.log('Found history tabs:', historyTabs.length);
    
    historyTabs.forEach(tab => {
        tab.addEventListener('click', function() {
            document.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.history-content').forEach(c => c.classList.remove('active'));

            this.classList.add('active');
            const contentId = this.dataset.tab + '-content';
            const contentElement = document.getElementById(contentId);
            if (contentElement) {
                contentElement.classList.add('active');
                console.log('Switched to tab:', this.dataset.tab);
            }
            
            if (this.dataset.tab === 'stats') {
                updateStatistics();
            }
        });
    });
}

// FIXED: Use correct API endpoint
function checkSystemMode() {
    if (!isLoggedIn) return;
    
    console.log('Checking system mode...');
    fetch('/api/data')  // Changed from '/data' to ''
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return response.json();
            } else {
                return response.text().then(text => {
                    console.log('Non-JSON response received:', text.substring(0, 200));
                    throw new Error('Expected JSON but got: ' + contentType);
                });
            }
        })
        .then(data => {
            console.log('Data received from backend:', data);
            
            // Handle both online and offline device states
            if (data.system_mode === 'error') {
                // Backend error
                systemMode = 'offline';
                updateConnectionStatus('error', 'Backend configuration error');
            } else {
                systemMode = data.system_mode || 'offline';
                updateFromBackendData(data);
                
                // Determine connection status
                const isDeviceConnected = data.input_air_quality !== undefined && data.input_air_quality !== null;
                const isDeviceOnline = systemMode === 'online';
                
                let status, message;
                
                if (isDeviceConnected) {
                    if (isDeviceOnline) {
                        status = 'connected';
                        message = 'Connected to device via cloud database';
                    } else {
                        status = 'disconnected';
                        message = 'Device offline - Using last known data';
                    }
                } else {
                    status = 'error';
                    message = 'No device data available';
                }
                
                updateConnectionStatus(status, message);
                reconnectAttempts = 0;
            }
        })
        .catch(error => {
            console.error('Error checking system mode:', error);
            systemMode = 'offline';
            handleConnectionError(error);
        });
}

// FIXED: Use correct API endpoint
function updateData() {
    if (!isLoggedIn) return;
    
    fetch('/api/data')  // Changed from '/data' to '/api/devices/data'
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            
            const contentType = response.headers.get('content-type');
            if (contentType && contentType.includes('application/json')) {
                return response.json();
            } else {
                return response.text().then(text => {
                    console.log('Non-JSON response received:', text.substring(0, 200));
                    throw new Error('Expected JSON but got: ' + contentType);
                });
            }
        })
        .then(data => {
            console.log('Data received from backend:', data);
            
            if (data.system_mode === 'error') {
                systemMode = 'offline';
                updateConnectionStatus('error', 'Backend configuration error');
                return;
            }
            
            systemMode = data.system_mode || 'offline';
            updateFromBackendData(data);
            
            // Enhanced connection status detection
            const isDeviceConnected = data.input_air_quality !== undefined && data.input_air_quality !== null;
            const isDeviceOnline = systemMode === 'online';
            const hasValidData = data.input_air_quality > 0 || data.output_air_quality > 0;
            
            let status, message;
            
            if (!isDeviceConnected) {
                status = 'error';
                message = 'No device data available';
            } else if (isDeviceOnline) {
                status = 'connected';
                message = 'Device online - Real-time data';
            } else if (hasValidData) {
                status = 'disconnected';
                message = 'Device offline - Using cached data';
            } else {
                status = 'error';
                message = 'Device configuration error';
            }
            
            updateConnectionStatus(status, message);
            reconnectAttempts = 0;
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            handleConnectionError(error);
        });
}

function handleConnectionError(error) {
    systemMode = 'offline';
    
    if (error.message.includes('JSON')) {
        updateConnectionStatus('error', 'Device configuration error - Check ESP32 server');
    } else {
        updateConnectionStatus('error', 'Connection error - Device may be offline');
    }
    
    attemptReconnect();
}

function attemptReconnect() {
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
        
        console.log(`Attempting reconnect in ${delay}ms (attempt ${reconnectAttempts})`);
        updateConnectionStatus('reconnecting', `Reconnecting... Attempt ${reconnectAttempts}/${maxReconnectAttempts}`);
        
        setTimeout(() => {
            checkSystemMode();
        }, delay);
    } else {
        updateConnectionStatus('failed', 'Failed to connect to device. Please check ESP32 connection.');
    }
}

function updateConnectionStatus(status, message) {
    const statusElement = document.getElementById('connection-status');
    const statusText = document.getElementById('connection-text');
    
    if (!statusElement || !statusText) {
        console.error('Connection status elements not found');
        return;
    }
    
    // Clear all status classes
    statusElement.className = 'connection-status';
    statusElement.classList.add(status);
    statusText.textContent = message;
    
    // Update icon and detailed status
    const icon = statusElement.querySelector('i');
    if (icon) {
        switch(status) {
            case 'connected':
                icon.className = 'fas fa-cloud';
                statusElement.title = 'Device is online and sending real-time data';
                break;
            case 'disconnected':
                icon.className = 'fas fa-database';
                statusElement.title = 'Device is offline - showing last known data';
                break;
            case 'reconnecting':
                icon.className = 'fas fa-sync-alt fa-spin';
                statusElement.title = 'Attempting to reconnect to device';
                break;
            case 'error':
                icon.className = 'fas fa-exclamation-triangle';
                statusElement.title = 'Connection error - check device configuration';
                break;
            case 'failed':
                icon.className = 'fas fa-times-circle';
                statusElement.title = 'Failed to connect to device';
                break;
            default:
                icon.className = 'fas fa-circle';
        }
    }
    
    // Update system mode indicator in status bar with more detail
    const wifiStatusElement = document.getElementById('wifi-status');
    if (wifiStatusElement) {
        if (status === 'connected') {
            wifiStatusElement.innerHTML = "<i class='fas fa-cloud'></i> Online";
            wifiStatusElement.title = 'Device connected to cloud';
        } else if (status === 'disconnected') {
            wifiStatusElement.innerHTML = "<i class='fas fa-database'></i> Offline";
            wifiStatusElement.title = 'Device offline - using cached data';
        } else {
            wifiStatusElement.innerHTML = "<i class='fas fa-exclamation-triangle'></i> Error";
            wifiStatusElement.title = 'Connection error';
        }
    }
    
    // Update status item styling
    const systemStatusItem = document.getElementById('system-status-item');
    if (systemStatusItem) {
        systemStatusItem.className = 'status-item';
        if (status === 'connected') systemStatusItem.classList.add('online');
        else if (status === 'disconnected') systemStatusItem.classList.add('offline');
        else systemStatusItem.classList.add('error');
    }
    
    console.log(`Connection status updated: ${status} - ${message}`);
}

function updateFromBackendData(data) {
    console.log('Updating from backend data:', data);
    
    // Extract values from backend data with proper fallbacks
    inputAirQuality = parseFloat(data.input_air_quality) || 0;
    outputAirQuality = parseFloat(data.output_air_quality) || 0;
    efficiency = parseFloat(data.efficiency) || 0;
    fanState = Boolean(data.fan);
    autoMode = data.auto_mode || "ON";
    threshold = parseInt(data.threshold) || 300;
    
    console.log(`Parsed values - Input: ${inputAirQuality}, Output: ${outputAirQuality}, Efficiency: ${efficiency}, Fan: ${fanState}, Mode: ${autoMode}, Threshold: ${threshold}`);
    
    // Update threshold slider if data contains threshold
    if (data.threshold) {
        const thresholdSlider = document.getElementById('threshold');
        const thresholdValue = document.getElementById('threshold-value');
        if (thresholdSlider && thresholdValue) {
            thresholdSlider.value = threshold;
            thresholdValue.textContent = threshold;
        }
    }
    
    updateAllDisplays();
    updateButtonStates();
    
    // Only add to history if we have valid data (not zeros or errors)
    if (inputAirQuality > 0 || outputAirQuality > 0) {
        addToHistory({
            timestamp: new Date(),
            inputQuality: inputAirQuality,
            outputQuality: outputAirQuality,
            efficiency: efficiency,
            fanState: fanState,
            autoMode: autoMode,
            systemMode: systemMode,
            dataSource: systemMode === 'online' ? 'live' : 'cached'
        });
    }

    lastUpdateTime = new Date();
    updateLastUpdated();
    
    // Update data source indicator in UI
    updateDataSourceIndicator();
}

function updateDataSourceIndicator() {
    const lastUpdatedElement = document.getElementById('last-updated-full');
    if (lastUpdatedElement) {
        const now = new Date();
        const diffSec = Math.floor((now - lastUpdateTime) / 1000);
        
        let timeText;
        if (diffSec < 10) {
            timeText = 'Just now';
        } else if (diffSec < 60) {
            timeText = `${diffSec} seconds ago`;
        } else {
            timeText = `${Math.floor(diffSec / 60)} minutes ago`;
        }
        
        const sourceIcon = systemMode === 'online' ? '🌐' : '💾';
        const sourceText = systemMode === 'online' ? 'Live Data' : 'Cached Data';
        
        lastUpdatedElement.textContent = 
            `Last updated: ${lastUpdateTime.toLocaleTimeString()} (${timeText}) | ` +
            `Mode: ${systemMode.toUpperCase()} | Source: ${sourceIcon} ${sourceText}`;
    }
}

function updateAllDisplays() {
    console.log('Updating all displays...');
    
    // Update main sensor display values
    updateElementText('input-air-quality-value', Math.round(inputAirQuality) + ' PPM');
    updateElementText('output-air-quality-value', Math.round(outputAirQuality) + ' PPM');
    updateElementText('efficiency-value', Math.round(efficiency) + '%');
    
    console.log(`Display values - Input: ${Math.round(inputAirQuality)} PPM, Output: ${Math.round(outputAirQuality)} PPM, Efficiency: ${Math.round(efficiency)}%`);
    
    // Update value colors based on air quality
    updateValueColor('input-air-quality-value', inputAirQuality);
    updateValueColor('output-air-quality-value', outputAirQuality);
    
    // Update efficiency bar
    const efficiencyFill = document.getElementById('efficiency-fill');
    if (efficiencyFill) {
        efficiencyFill.style.width = Math.min(efficiency, 100) + '%';
        console.log('Efficiency bar updated to:', efficiency + '%');
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
        console.log(`Updated ${elementId}: ${text}`);
    } else {
        console.warn(`Element not found: ${elementId}`);
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
            console.log('Fan state: ON');
        } else {
            fanBtn.classList.remove('active');
            fanBtnText.textContent = 'Turn ON';
            fanStatusIndicator.textContent = 'Fan is OFF';
            fanStatusIndicator.style.background = 'var(--danger)';
            fanStatusElement.innerHTML = "<i class='fas fa-fan'></i> OFF";
            console.log('Fan state: OFF');
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
            console.log('Auto mode: ON');
        } else {
            modeBtn.classList.remove('active');
            modeBtnText.textContent = 'Switch to Auto';
            modeStatusIndicator.textContent = 'Manual Mode Active';
            modeStatusIndicator.style.background = 'var(--secondary)';
            autoStatusElement.innerHTML = "<i class='fas fa-hand-pointer'></i> MANUAL";
            console.log('Auto mode: OFF');
        }
    }
}

// Update only the gauge needles (keep values hidden)
function updateGaugeNeedle(type, value) {
    const needle = document.getElementById(`${type}-gauge-needle`);
    console.log(`Updating ${type} gauge needle - Element:`, needle, 'Value:', value);

    if (needle) {
        const rotation = Math.min(Math.max(value / 2000 * 180, 0), 180);
        needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
        console.log(`${type} gauge needle rotated to: ${rotation}deg`);
        
        // Force browser repaint to ensure the transform is applied
        needle.offsetHeight;
    } else {
        console.warn(`${type} gauge needle element not found`);
    }
}

function updateEfficiencyGaugeNeedle(value) {
    const needle = document.getElementById('efficiency-gauge-needle');
    console.log('Updating efficiency gauge needle - Element:', needle, 'Value:', value);

    if (needle) {
        const rotation = Math.min(Math.max(value / 100 * 180, 0), 180);
        needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
        console.log(`Efficiency gauge needle rotated to: ${rotation}deg`);
        
        // Force browser repaint to ensure the transform is applied
        needle.offsetHeight;
    } else {
        console.warn('Efficiency gauge needle element not found');
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
        console.log(`Updated ${elementId} color for value: ${value}`);
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
        
        console.log(`Comparison chart updated - Input: ${inputHeight}%, Output: ${outputHeight}%, Improvement: ${improvement}PPM`);
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
        lastUpdatedElement.textContent = `Last updated: ${lastUpdateTime.toLocaleTimeString()} (${displayText}) | Mode: ${systemMode.toUpperCase()}`;
    }
    
    lastUpdateTime = now;
}

function toggleFan() {
    console.log('Toggle fan clicked. Current state:', fanState);
    
    if (systemMode === 'offline') {
        alert('Device is in offline mode. Controls may have limited functionality.');
    }
    
    if (autoMode === "ON") {
        autoMode = "OFF";
        console.log('Switched to manual mode');
    }
    
    fanState = !fanState;
    console.log('New fan state:', fanState);
    
    sendCommand('fan', fanState ? 'on' : 'off');
    updateButtonStates();
}

function toggleMode() {
    console.log('Toggle mode clicked. Current mode:', autoMode);
    
    autoMode = autoMode === "ON" ? "OFF" : "ON";
    console.log('New mode:', autoMode);
    
    updateButtonStates();
    sendCommand('auto', autoMode === 'ON' ? 'ON' : 'OFF');
}

function saveThreshold() {
    console.log('Save threshold clicked. Threshold:', threshold);
    sendCommand('threshold', threshold);
}

function updateThreshold(e) {
    threshold = parseInt(e.target.value);
    updateElementText('threshold-value', threshold);
    console.log('Threshold updated to:', threshold);
}

// FIXED: Use correct API endpoint for commands
function sendCommand(command, value) {
    console.log(`Sending command: ${command}=${value}`);
    
    // Use the correct API endpoint
    fetch('/api/devices/control', {  // Changed from '/api/control' to '/api/devices/control'
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({
            command: command,
            value: value,
            device_id: 'esp32_air_purifier_01'
        })
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Failed to send command');
        }
        return response.json();
    })
    .then(data => {
        console.log('Command sent successfully:', data);
        
        // Show success feedback
        showCommandFeedback('Command sent successfully', 'success');
    })
    .catch(error => {
        console.error('Error sending command:', error);
        
        // Show error feedback
        showCommandFeedback('Command failed - device may be offline', 'error');
    });
}

function showCommandFeedback(message, type) {
    // Create or update a feedback element
    let feedbackElement = document.getElementById('command-feedback');
    if (!feedbackElement) {
        feedbackElement = document.createElement('div');
        feedbackElement.id = 'command-feedback';
        document.body.appendChild(feedbackElement);
    }
    
    feedbackElement.textContent = message;
    feedbackElement.style.background = type === 'success' ? 'var(--success)' : 'var(--danger)';
    feedbackElement.style.display = 'block';
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
        feedbackElement.style.display = 'none';
    }, 3000);
}

// History and statistics functions
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

// Add shake animation for login errors
const style = document.createElement('style');
style.textContent = `
    @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-5px); }
        75% { transform: translateX(5px); }
    }
`;
document.head.appendChild(style);