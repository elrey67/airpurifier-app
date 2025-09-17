// Current data
let inputAirQuality = 0;
let outputAirQuality = 0;
let efficiency = 0;
let fanState = false;
let autoMode = "ON";
let threshold = 300;
let historyData = [];
let lastUpdateTime = new Date();

// Initialize the page
document.addEventListener('DOMContentLoaded', function () {
    // Set up control event listeners
    document.getElementById('toggle-fan').addEventListener('click', toggleFan);
    document.getElementById('toggle-mode').addEventListener('click', toggleMode);

    // Threshold slider handler
    document.getElementById('threshold').addEventListener('input', function (e) {
        threshold = parseInt(e.target.value);
        document.getElementById('threshold-value').textContent = threshold;
        // In a real implementation, you would send this to the backend
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

    // Initial update
    updateButtonStates();
    updateLastUpdated();

    // Fetch data from backend
    fetchData();

    // Set up periodic data fetching
    setInterval(fetchData, 5000);
});

// Fetch data from backend
function fetchData() {
    fetch('/data')
        .then(response => {
            if (!response.ok) {
                throw new Error('Network response was not ok');
            }
            return response.json();
        })
        .then(data => {
            // Update with real data from backend
            inputAirQuality = data.input_air_quality || 0;
            outputAirQuality = data.output_air_quality || 0;
            efficiency = data.efficiency || 0;
            fanState = data.fan || false;
            autoMode = data.auto_mode || "ON";

            // Update the display
            updateGauges(inputAirQuality, outputAirQuality);
            updateSensorValues(inputAirQuality, outputAirQuality, efficiency);
            updateButtonStates();

            // Add to history
            addToHistory({
                timestamp: new Date(),
                input: inputAirQuality,
                output: outputAirQuality,
                efficiency: efficiency,
                fanState: fanState
            });

            // Update last updated time
            lastUpdateTime = new Date();
            updateLastUpdated();
        })
        .catch(error => {
            console.error('Error fetching data:', error);
            document.getElementById('wifi-status').innerHTML = "<i class='fas fa-wifi'></i> Connection Error";
        });
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
    } else {
        fanBtn.classList.remove('active');
        fanBtnText.textContent = 'Turn ON';
        fanStatusIndicator.textContent = 'Fan is OFF';
        fanStatusIndicator.style.background = 'var(--danger)';
        document.getElementById('fan-status').innerHTML = "<i class='fas fa-fan'></i> OFF";
    }

    // Update mode button
    if (autoMode === 'ON') {
        modeBtn.classList.add('active');
        modeBtnText.textContent = 'Switch to Manual';
        modeStatusIndicator.textContent = 'Auto Mode Active';
        modeStatusIndicator.style.background = 'var(--accent)';
        document.getElementById('auto-status').innerHTML = "<i class='fas fa-robot'></i> AUTO";
    } else {
        modeBtn.classList.remove('active');
        modeBtnText.textContent = 'Switch to Auto';
        modeStatusIndicator.textContent = 'Manual Mode Active';
        modeStatusIndicator.style.background = 'var(--secondary)';
        document.getElementById('auto-status').innerHTML = "<i class='fas fa-hand-pointer'></i> MANUAL";
    }
}

// Update gauges
function updateGauges(inputValue, outputValue) {
    const inputNeedle = document.getElementById('input-gauge-needle');
    const outputNeedle = document.getElementById('output-gauge-needle');
    const inputValueElement = document.getElementById('input-gauge-value');
    const outputValueElement = document.getElementById('output-gauge-value');

    // Map values to rotation (0-2000 PPM to 0-180 degrees)
    const inputRotation = Math.min(Math.max(inputValue / 2000 * 180, 0), 180);
    const outputRotation = Math.min(Math.max(outputValue / 2000 * 180, 0), 180);

    inputNeedle.style.transform = `translateX(-50%) rotate(${inputRotation}deg)`;
    outputNeedle.style.transform = `translateX(-50%) rotate(${outputRotation}deg)`;

    inputValueElement.textContent = Math.round(inputValue) + ' PPM';
    outputValueElement.textContent = Math.round(outputValue) + ' PPM';

    // Update color based on value
    updateValueColor(inputValueElement, inputValue);
    updateValueColor(outputValueElement, outputValue);
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
function updateSensorValues(inputValue, outputValue, efficiencyValue) {
    document.getElementById('input-air-quality-value').textContent = Math.round(inputValue) + ' PPM';
    document.getElementById('output-air-quality-value').textContent = Math.round(outputValue) + ' PPM';
    document.getElementById('efficiency-value').textContent = Math.round(efficiencyValue) + '%';

    // Update colors
    updateValueColor(document.getElementById('input-air-quality-value'), inputValue);
    updateValueColor(document.getElementById('output-air-quality-value'), outputValue);

    // Efficiency color (green for good, red for poor)
    const efficiencyElement = document.getElementById('efficiency-value');
    if (efficiencyValue > 70) {
        efficiencyElement.style.color = 'var(--success)';
    } else if (efficiencyValue > 40) {
        efficiencyElement.style.color = 'var(--warning)';
    } else {
        efficiencyElement.style.color = 'var(--danger)';
    }
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

    const maxValue = Math.max(...historyData.map(d => Math.max(d.input, d.output)), 500);
    const containerWidth = chartContainer.offsetWidth;
    const barWidth = Math.min(10, (containerWidth - 20) / historyData.length);
    const spacing = 2;

    historyData.forEach((data, index) => {
        // Input bar
        const inputBar = document.createElement('div');
        inputBar.className = 'chart-bar';
        inputBar.style.height = (data.input / maxValue * 180) + 'px';
        inputBar.style.left = (index * (barWidth + spacing) + 5) + 'px';
        inputBar.style.width = (barWidth / 2) + 'px';

        if (data.input < 300) {
            inputBar.style.background = 'var(--success)';
        } else if (data.input < 600) {
            inputBar.style.background = 'var(--warning)';
        } else {
            inputBar.style.background = 'var(--danger)';
        }

        chartContainer.appendChild(inputBar);

        // Output bar
        const outputBar = document.createElement('div');
        outputBar.className = 'chart-bar';
        outputBar.style.height = (data.output / maxValue * 180) + 'px';
        outputBar.style.left = (index * (barWidth + spacing) + barWidth / 2 + 5) + 'px';
        outputBar.style.width = (barWidth / 2) + 'px';

        if (data.output < 300) {
            outputBar.style.background = 'var(--success)';
        } else if (data.output < 600) {
            outputBar.style.background = 'var(--warning)';
        } else {
            outputBar.style.background = 'var(--danger)';
        }

        chartContainer.appendChild(outputBar);
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

        const inputCell = document.createElement('td');
        inputCell.textContent = Math.round(data.input);

        const outputCell = document.createElement('td');
        outputCell.textContent = Math.round(data.output);

        const efficiencyCell = document.createElement('td');
        efficiencyCell.textContent = Math.round(data.efficiency) + '%';

        const fanCell = document.createElement('td');
        fanCell.textContent = data.fanState ? 'ON' : 'OFF';

        row.appendChild(timeCell);
        row.appendChild(inputCell);
        row.appendChild(outputCell);
        row.appendChild(efficiencyCell);
        row.appendChild(fanCell);

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

    document.getElementById('last-updated').textContent = displayText;
    document.getElementById('last-updated-full').textContent = `Last updated: ${lastUpdateTime.toLocaleTimeString()}`;
}

// Toggle fan
function toggleFan() {
    if (autoMode === "ON") {
        autoMode = "OFF";
    }
    fanState = !fanState;

    // Send command to backend
    fetch('/control?fan=' + (fanState ? 'on' : 'off') + '&auto=' + (autoMode === 'ON' ? 'on' : 'off'))
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to update fan state');
            }
            updateButtonStates();
        })
        .catch(error => {
            console.error('Error updating fan:', error);
        });
}

// Toggle mode
function toggleMode() {
    autoMode = autoMode === "ON" ? "OFF" : "ON";

    // Send command to backend
    fetch('/control?auto=' + (autoMode === 'ON' ? 'on' : 'off'))
        .then(response => {
            if (!response.ok) {
                throw new Error('Failed to update mode');
            }
            updateButtonStates();
        })
        .catch(error => {
            console.error('Error updating mode:', error);
        });
}