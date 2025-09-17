// Current data
let airQuality = 0;
let fanState = false;
let autoMode = "ON";
let threshold = 300;
let historyData = [];
let lastUpdateTime = new Date();
let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

// Initialize the page
document.addEventListener('DOMContentLoaded', function () {
    // Set up control event listeners
    document.getElementById('toggle-fan').addEventListener('click', toggleFan);
    document.getElementById('toggle-mode').addEventListener('click', toggleMode);
    document.getElementById('save-threshold').addEventListener('click', saveThreshold);

    // Threshold slider handler
    document.getElementById('threshold').addEventListener('input', function (e) {
        threshold = parseInt(e.target.value);
        document.getElementById('threshold-value').textContent = threshold;
        updateThresholdGauge(threshold);
    });

    // History tabs
    document.querySelectorAll('.history-tab').forEach(tab => {
        tab.addEventListener('click', function () {
            document.querySelectorAll('.history-tab').forEach(t => t.classList.remove('active'));
            document.querySelectorAll('.history-content').forEach(c => c.classList.remove('active'));

            this.classList.add('active');
            document.getElementById(this.dataset.tab + '-content').classList.add('active');
        });
    });

    // Show server URL in footer
    document.getElementById('server-url').textContent = window.location.hostname;

    // Initial update
    updateButtonStates();
    updateLastUpdated();

    // Connect to WebSocket for real-time updates
    connectWebSocket();

    // Set up periodic data fetching as fallback
    setInterval(fetchData, 10000);
});

// Connect to WebSocket for real-time updates
function connectWebSocket() {
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}`;
    
    try {
        ws = new WebSocket(wsUrl);
        
        ws.onopen = () => {
            console.log('WebSocket connected');
            reconnectAttempts = 0;
            updateConnectionStatus('connected', 'Connected to server');
        };
        
        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);
            handleWebSocketMessage(data);
        };
        
        ws.onclose = () => {
            console.log('WebSocket disconnected');
            updateConnectionStatus('disconnected', 'Disconnected from server');
            attemptReconnect();
        };
        
        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            updateConnectionStatus('error', 'Connection error');
        };
    } catch (error) {
        console.error('WebSocket connection failed:', error);
        updateConnectionStatus('error', 'WebSocket not supported');
        // Fall back to polling
        setInterval(fetchData, 5000);
    }
}

function attemptReconnect() {
    if (reconnectAttempts < maxReconnectAttempts) {
        reconnectAttempts++;
        const delay = Math.min(1000 * Math.pow(2, reconnectAttempts), 10000);
        
        console.log(`Attempting reconnect in ${delay}ms (attempt ${reconnectAttempts})`);
        updateConnectionStatus('reconnecting', `Reconnecting in ${delay/1000}s...`);
        
        setTimeout(() => {
            connectWebSocket();
        }, delay);
    } else {
        updateConnectionStatus('failed', 'Failed to connect to server');
        // Fall back to polling
        setInterval(fetchData, 5000);
    }
}

function handleWebSocketMessage(data) {
    switch (data.type) {
        case 'status_update':
            updateFromBackendData(data);
            break;
        // Add other message types as needed
    }
}

function updateConnectionStatus(status, message) {
    const statusElement = document.getElementById('connection-status');
    const statusText = document.getElementById('connection-text');
    const icon = statusElement.querySelector('i');
    
    statusText.textContent = message;
    
    switch (status) {
        case 'connected':
            statusElement.style.color = 'var(--success)';
            icon.className = 'fas fa-check-circle';
            break;
        case 'disconnected':
        case 'reconnecting':
            statusElement.style.color = 'var(--warning)';
            icon.className = 'fas fa-exclamation-circle';
            break;
        case 'error':
        case 'failed':
            statusElement.style.color = 'var(--danger)';
            icon.className = 'fas fa-times-circle';
            break;
    }
}

// Fetch data from backend
function fetchData() {
    fetch('/api/latest-data')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            updateFromBackendData(data);
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            document.getElementById('wifi-status').innerHTML = "<i class='fas fa-wifi'></i> Connection Error";
            updateConnectionStatus('error', 'Failed to fetch data');
        });
}

function updateFromBackendData(data) {
    // Update with real data from backend
    airQuality = data.data?.air_quality || 0;
    fanState = data.data?.fan_state || false;
    autoMode = data.data?.auto_mode ? "ON" : "OFF";
    
    // Update the display
    updateGauge(airQuality);
    updateSensorValues(airQuality, fanState, autoMode);
    updateButtonStates();

    // Add to history
    addToHistory({
        timestamp: new Date(data.last_updated || new Date()),
        airQuality: airQuality,
        fanState: fanState,
        autoMode: autoMode
    });

    // Update device status
    updateDeviceStatus(data.status);
    
    // Update last updated time
    lastUpdateTime = new Date();
    updateLastUpdated();
}

function updateDeviceStatus(status) {
    const deviceStatusElement = document.getElementById('device-status');
    
    if (status === 'online') {
        deviceStatusElement.innerHTML = "<i class='fas fa-microchip'></i> Online";
        deviceStatusElement.style.color = 'var(--success)';
        document.getElementById('wifi-status').innerHTML = "<i class='fas fa-wifi'></i> Connected";
    } else {
        deviceStatusElement.innerHTML = "<i class='fas fa-microchip'></i> Offline";
        deviceStatusElement.style.color = 'var(--danger)';
        document.getElementById('wifi-status').innerHTML = "<i class='fas fa-wifi'></i> Device Offline";
    }
}

// Update button states
function updateButtonStates() {
    const fanBtn = document.getElementById('toggle-fan');
    const modeBtn = document.getElementById('toggle-mode');
    const fanStatusIndicator = document.getElementById('fan-status-indicator');
    const modeStatusIndicator = document.getElementById('mode-status-indicator');
    const fanBtnText = document.getElementById('fan-btn-text');
    const modeBtnText = document.getElementById('mode-btn-text');

    // Update fan button
    if (fanState) {
        fanBtn.classList.add('active');
        fanBtnText.textContent = 'Turn OFF';
        fanStatusIndicator.textContent = 'Fan is ON';
        fanStatusIndicator.style.background = 'var(--success)';
        document.getElementById('fan-status').innerHTML = "<i class='fas fa-fan'></i> ON";
        document.getElementById('fan-display-value').textContent = 'ON';
        document.getElementById('fan-display-value').style.color = 'var(--success)';
    } else {
        fanBtn.classList.remove('active');
        fanBtnText.textContent = 'Turn ON';
        fanStatusIndicator.textContent = 'Fan is OFF';
        fanStatusIndicator.style.background = 'var(--danger)';
        document.getElementById('fan-status').innerHTML = "<i class='fas fa-fan'></i> OFF";
        document.getElementById('fan-display-value').textContent = 'OFF';
        document.getElementById('fan-display-value').style.color = 'var(--danger)';
    }

    // Update mode button
    if (autoMode === 'ON') {
        modeBtn.classList.add('active');
        modeBtnText.textContent = 'Switch to Manual';
        modeStatusIndicator.textContent = 'Auto Mode Active';
        modeStatusIndicator.style.background = 'var(--accent)';
        document.getElementById('auto-status').innerHTML = "<i class='fas fa-robot'></i> AUTO";
        document.getElementById('mode-display-value').textContent = 'AUTO';
    } else {
        modeBtn.classList.remove('active');
        modeBtnText.textContent = 'Switch to Auto';
        modeStatusIndicator.textContent = 'Manual Mode Active';
        modeStatusIndicator.style.background = 'var(--secondary)';
        document.getElementById('auto-status').innerHTML = "<i class='fas fa-hand-pointer'></i> MANUAL";
        document.getElementById('mode-display-value').textContent = 'MANUAL';
    }
}

// Update gauge
function updateGauge(value) {
    const needle = document.getElementById('gauge-needle');
    const valueElement = document.getElementById('gauge-value');

    // Map values to rotation (0-2000 PPM to 0-180 degrees)
    const rotation = Math.min(Math.max(value / 2000 * 180, 0), 180);

    needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
    valueElement.textContent = Math.round(value) + ' PPM';

    // Update color based on value
    updateValueColor(valueElement, value);
}

// Update threshold gauge
function updateThresholdGauge(value) {
    const needle = document.getElementById('threshold-gauge-needle');
    const valueElement = document.getElementById('threshold-gauge-value');

    // Map values to rotation (100-1000 PPM to 0-180 degrees)
    const rotation = Math.min(Math.max((value - 100) / 900 * 180, 0), 180);

    needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;
    valueElement.textContent = Math.round(value) + ' PPM';
    valueElement.style.color = 'var(--accent)';
}

// Update value color based on air quality
function updateValueColor(element, value) {
    if (value < 300) {
        element.style.color = 'var(--success)'; // Good
    } else if (value < 600) {
        element.style.color = 'var(--warning)'; // Moderate
    } else {
        element.style.color = 'var(--danger)'; // Poor
    }
}

// Update sensor values
function updateSensorValues(airValue, fanValue, modeValue) {
    document.getElementById('air-quality-value').textContent = Math.round(airValue) + ' PPM';
    updateValueColor(document.getElementById('air-quality-value'), airValue);
}

// Add data point to history
function addToHistory(data) {
    // Add to beginning of array
    historyData.unshift(data);

    // Keep only the last 50 readings
    if (historyData.length > 50) {
        historyData.pop();
    }

    // Update chart
    updateChart();

    // Update table
    updateHistoryTable();
}

// Update chart
function updateChart() {
    const chartContainer = document.getElementById('chart-container');
    chartContainer.innerHTML = '';

    if (historyData.length === 0) return;

    const maxValue = Math.max(...historyData.map(d => d.airQuality), 500);
    const containerWidth = chartContainer.offsetWidth;
    const barWidth = Math.min(10, (containerWidth - 20) / historyData.length);
    const spacing = 2;

    historyData.forEach((data, index) => {
        // Air quality bar
        const bar = document.createElement('div');
        bar.className = 'chart-bar';
        bar.style.height = (data.airQuality / maxValue * 180) + 'px';
        bar.style.left = (index * (barWidth + spacing) + 5) + 'px';
        bar.style.width = barWidth + 'px';

        if (data.airQuality < 300) {
            bar.style.background = 'var(--success)';
        } else if (data.airQuality < 600) {
            bar.style.background = 'var(--warning)';
        } else {
            bar.style.background = 'var(--danger)';
        }

        chartContainer.appendChild(bar);
    });
}

// Update history table
function updateHistoryTable() {
    const tableBody = document.getElementById('history-table-body');
    tableBody.innerHTML = '';

    historyData.forEach(data => {
        const row = document.createElement('tr');

        const timeCell = document.createElement('td');
        timeCell.textContent = formatTime(data.timestamp);

        const airQualityCell = document.createElement('td');
        airQualityCell.textContent = Math.round(data.airQuality);
        updateValueColor(airQualityCell, data.airQuality);

        const fanCell = document.createElement('td');
        fanCell.textContent = data.fanState ? 'ON' : 'OFF';
        fanCell.style.color = data.fanState ? 'var(--success)' : 'var(--danger)';

        const modeCell = document.createElement('td');
        modeCell.textContent = data.autoMode;

        row.appendChild(timeCell);
        row.appendChild(airQualityCell);
        row.appendChild(fanCell);
        row.appendChild(modeCell);

        tableBody.appendChild(row);
    });
}

// Format time for display
function formatTime(date) {
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

// Update last updated time
function updateLastUpdated() {
    const now = new Date();
    const diffMs = now - lastUpdateTime;
    const diffSec = Math.floor(diffMs / 1000);

    let displayText;
    if (diffSec < 10) {
        displayText = 'Just now';
    } else if (diffSec < 60) {
        displayText = `${diffSec} seconds ago`;
    } else {
        displayText = `${Math.floor(diffSec / 60)} minutes ago`;
    }

    document.getElementById('last-updated-full').textContent = `Last updated: ${lastUpdateTime.toLocaleTimeString()}`;
}

// Toggle fan
function toggleFan() {
    if (autoMode === "ON") {
        // If switching to manual mode, update UI immediately
        autoMode = "OFF";
        updateButtonStates();
    }
    
    // Toggle fan state
    fanState = !fanState;

    // Send command to backend
    sendCommand('fan', fanState ? 'on' : 'off');
    
    // If we're in auto mode, also send the mode change
    if (autoMode === "OFF") {
        sendCommand('auto', 'OFF');
    }
}

// Toggle mode
function toggleMode() {
    autoMode = autoMode === "ON" ? "OFF" : "ON";
    
    // Update UI immediately for better responsiveness
    updateButtonStates();
    
    // Send command to backend
    sendCommand('auto', autoMode === 'ON' ? 'ON' : 'OFF');
}

// Save threshold
function saveThreshold() {
    sendCommand('threshold', threshold);
}

// Send command to backend
function sendCommand(command, value) {
    fetch('/api/command', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({
            command: command,
            value: value
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
    })
    .catch(error => {
        console.error('Error sending command:', error);
        alert('Failed to send command to device. Please try again.');
    });
}