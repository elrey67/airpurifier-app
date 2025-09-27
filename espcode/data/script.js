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

// Initialize the page
document.addEventListener('DOMContentLoaded', function() {
    console.log('DOM loaded, initializing air purifier dashboard...');
    initializeEventListeners();
    updateConnectionStatus('reconnecting', 'Checking system mode...');
    
    // Show server URL in footer
    const serverUrlElement = document.getElementById('server-url');
    if (serverUrlElement) {
        serverUrlElement.textContent = window.location.hostname;
    }
    
    // Initial update
    setTimeout(() => {
        checkSystemMode();
    }, 100);
    
    // Set up periodic updates
    setInterval(updateData, 2000); // Update every 2 seconds
});

function initializeEventListeners() {
    console.log('Initializing event listeners...');

        const sensorGrid = document.querySelector('.sensors-grid');
    console.log('Sensor grid element:', sensorGrid);
    
    const sensorCards = document.querySelectorAll('.sensor-card');
    console.log('Sensor cards found:', sensorCards.length);
    
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

function checkSystemMode() {
    console.log('Checking system mode...');
    fetch('/data')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            console.log('Data received from ESP32:', data);
            systemMode = data.system_mode || 'offline';
            updateFromBackendData(data);
            updateConnectionStatus(
                systemMode === 'online' ? 'connected' : 'disconnected',
                systemMode === 'online' ? 'Connected to cloud database' : 'Running on local sensor data'
            );
        })
        .catch(error => {
            console.error('Error checking system mode:', error);
            systemMode = 'offline';
            updateConnectionStatus('error', 'Failed to connect to device');
        });
}

function updateData() {
    fetch('/data')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            systemMode = data.system_mode || 'offline';
            updateFromBackendData(data);
            
            updateConnectionStatus(
                systemMode === 'online' ? 'connected' : 'disconnected',
                systemMode === 'online' ? 'Connected to cloud database' : 'Running on local sensor data'
            );
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            updateConnectionStatus('error', 'Connection error');
        });
}

function updateConnectionStatus(status, message) {
    const statusElement = document.getElementById('connection-status');
    const statusText = document.getElementById('connection-text');
    
    if (!statusElement || !statusText) {
        console.error('Connection status elements not found');
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
                icon.className = 'fas fa-microchip';
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
            ? "<i class='fas fa-cloud'></i> Cloud" 
            : "<i class='fas fa-microchip'></i> Local";
    }
}

function updateFromBackendData(data) {
    console.log('Updating from backend data:', data);
    
    // Extract values from ESP32 data with proper parsing
    inputAirQuality = parseFloat(data.input_air_quality) || 0;
    outputAirQuality = parseFloat(data.output_air_quality) || 0;
    efficiency = parseFloat(data.efficiency) || 0;
    fanState = Boolean(data.fan);
    autoMode = data.auto_mode || "ON";
    
    console.log(`Parsed values - Input: ${inputAirQuality}, Output: ${outputAirQuality}, Efficiency: ${efficiency}, Fan: ${fanState}, Mode: ${autoMode}`);
    
    updateAllDisplays();
    updateButtonStates();
    updateLastUpdated();
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

function sendCommand(command, value) {
    console.log(`Sending command: ${command}=${value}`);
    
    fetch('/control?' + command + '=' + value)
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to send command');
            }
            return response.text();
        })
        .then(data => {
            console.log('Command sent successfully:', data);
        })
        .catch(error => {
            console.error('Error sending command:', error);
            alert('Command may not have reached the device. Please check connection.');
        });
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