// Device selection logic
document.addEventListener('DOMContentLoaded', function() {
    Logger.log('Device selection page loaded');
    checkAuthentication();
    loadUserDevices();
    
    document.getElementById('logout-btn').addEventListener('click', logoutUser);
    document.getElementById('add-device-form').addEventListener('submit', addNewDevice);
    
    // Set up periodic status updates for all devices
    setInterval(updateDevicesStatus, 5000); // Update every 5 seconds
});

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
            console.log(`%c[DEVICES] ${message}`, 'color: purple; font-weight: bold;', data || '');
        }
    },
    
    info: function(message, data = null) {
        console.info(`%c[DEVICES] ${message}`, 'color: teal; font-weight: bold;', data || '');
    },
    
    warn: function(message, data = null) {
        console.warn(`%c[DEVICES] ${message}`, 'color: darkorange; font-weight: bold;', data || '');
    },
    
    error: function(message, error = null) {
        console.error(`%c[DEVICES] ${message}`, 'color: crimson; font-weight: bold;', error || '');
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
    
    Logger.log('Getting base URL', { protocol, hostname, port });
    return `${protocol}//${hostname}${port ? ':' + port : ''}`;
}

// Enhanced fetch with error handling
async function apiFetch(endpoint, options = {}) {
    const baseURL = getBaseURL();
    const token = localStorage.getItem('authToken');
    
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

async function checkAuthentication() {
    const token = localStorage.getItem('authToken');
    
    Logger.log('Checking authentication', { hasToken: !!token });
    
    if (!token) {
        Logger.warn('No auth token found, redirecting to login');
        window.location.href = '../auth/login.html';
        return;
    }

    try {
        const data = await apiFetch('/api/auth/verify');
        
        if (!data.valid) {
            Logger.warn('Token invalid, clearing storage and redirecting');
            localStorage.clear();
            window.location.href = '../auth/login.html';
            return;
        }

        Logger.info('User authenticated', { username: data.user.username });
        document.getElementById('username-display').textContent = data.user.username;
    } catch (error) {
        Logger.error('Auth verification failed', error);
        localStorage.clear();
        window.location.href = '../auth/login.html';
    }
}

async function loadUserDevices() {
    Logger.log('Loading user devices with real-time status');
    
    try {
        const devices = await apiFetch('/api/devices/my-devices');
        fetch(`/api/latest-data?device_id=${deviceId}`, {
        headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
        },
        credentials: 'include'
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Network response was not ok');
        }
        return response.json();
    })
    .then(data => {
        console.log('Data received from database:', data);
        
        if (!data || data.error) {
            throw new Error(data?.error || 'Invalid data received');
        }
        
        // Use the same status detection logic
        if (data.status) {
            systemMode = data.status;
        } else if (data.is_online !== undefined) {
            systemMode = data.is_online ? 'online' : 'offline';
        } else {
            systemMode = 'offline';
        }
        
        updateFromBackendData(data);
        lastSuccessfulUpdate = Date.now();
        connectionRetries = 0; // Reset retries on successful update
        
        // Update connection status with improved logic
        updateConnectionStatusIfChanged(data);
    })
        
        // Enhance devices with real-time status from current_status table
        const enhancedDevices = await Promise.all(
            devices.map(async (device) => {
                try {
                    // Fetch current status for each device
                    const statusData = await apiFetch(`/api/device-status?device_id=${device.device_id}`);
                    return {
                        ...device,
                        status: statusData.status || 'offline',
                        system_mode: statusData.system_mode || 'offline',
                        online: statusData.is_online || false,
                        last_seen: statusData.last_updated || device.last_seen
                    };
                } catch (error) {
                    Logger.warn(`Could not fetch status for device ${device.device_id}`, error);
                    return {
                        ...device,
                        status: 'offline',
                        system_mode: 'offline',
                        online: false
                    };
                }
            })
        );
        
        Logger.log('Enhanced devices loaded', { count: enhancedDevices.length });
        
        if (enhancedDevices.length === 0) {
            Logger.info('No devices found, showing welcome message');
            showWelcomeMessage();
        } else {
            Logger.info('Displaying enhanced devices', { count: enhancedDevices.length });
            displayDevices(enhancedDevices);
        }
    } catch (error) {
        Logger.error('Error loading enhanced devices from API, falling back to basic load', error);
        
        // Fallback to basic device loading without status enhancement
        try {
            const basicDevices = await apiFetch('/api/devices/my-devices');
            if (basicDevices.length === 0) {
                showWelcomeMessage();
            } else {
                displayDevices(basicDevices);
            }
        } catch (fallbackError) {
            Logger.error('Both API calls failed, using localStorage fallback', fallbackError);
            
            // Final fallback to localStorage
            const localDevices = JSON.parse(localStorage.getItem('userDevices')) || [];
            Logger.log('LocalStorage devices', { count: localDevices.length });
            
            if (localDevices.length === 0) {
                showWelcomeMessage();
            } else {
                displayDevices(localDevices);
            }
        }
    }
}

function showWelcomeMessage() {
    Logger.log('Showing welcome message');
    
    const devicesList = document.getElementById('devices-list');
    devicesList.innerHTML = `
        <div class="welcome-message">
            <div class="welcome-icon">
                <i class="fas fa-wind fa-3x"></i>
            </div>
            <h3>Welcome to Air Purifier Control!</h3>
            <p>Get started by adding your first air purifier device below.</p>
            <div class="welcome-features">
                <div class="feature">
                    <i class="fas fa-tachometer-alt"></i>
                    <span>Real-time monitoring</span>
                </div>
                <div class="feature">
                    <i class="fas fa-chart-line"></i>
                    <span>Historical data</span>
                </div>
                <div class="feature">
                    <i class="fas fa-cog"></i>
                    <span>Remote control</span>
                </div>
            </div>
        </div>
    `;
}

function displayDevices(devices) {
    Logger.log('Displaying devices', { count: devices.length });
    
    const devicesList = document.getElementById('devices-list');
    devicesList.innerHTML = '';
    
    devices.forEach(device => {
        const deviceCard = document.createElement('div');
        deviceCard.className = 'device-card';
        deviceCard.setAttribute('data-device-id', device.device_id || device.id);
        
        // Use proper status detection (same as dashboard)
        const status = device.status || (device.online ? 'online' : 'offline');
        const systemMode = device.system_mode || 'offline';
        const lastSeen = device.last_seen;
        
        // Calculate time difference for status display
        let statusText = 'Never';
        if (lastSeen) {
            const lastSeenDate = new Date(lastSeen);
            const now = new Date();
            const diffMs = now - lastSeenDate;
            const diffMins = Math.floor(diffMs / 60000);
            
            if (status === 'online') {
                if (diffMins < 5) {
                    statusText = 'Live - Connected now';
                } else if (diffMins < 30) {
                    statusText = `${diffMins} min ago`;
                } else {
                    statusText = `${Math.floor(diffMins/60)} hours ago`;
                }
            } else {
                if (diffMins < 60) {
                    statusText = `${diffMins} min ago`;
                } else {
                    statusText = `${Math.floor(diffMins/60)} hours ago`;
                }
            }
        }
        
        deviceCard.innerHTML = `
            <div class="device-header">
                <div class="device-icon">
                    <i class="fas fa-wind"></i>
                </div>
                <div class="device-info">
                    <h4>${device.name || device.device_name}</h4>
                    <p class="device-location"><i class="fas fa-map-marker-alt"></i> ${device.location || 'Not specified'}</p>
                    <p class="device-id">ID: ${device.device_id || device.id}</p>
                    <p class="device-mode">Mode: ${systemMode.toUpperCase()}</p>
                    <p class="last-seen">Last seen: ${lastSeen ? statusText : 'Never'}</p>
                </div>
                <div class="device-status ${status}">
                    <i class="fas fa-circle"></i>
                    ${status.toUpperCase()}
                </div>
            </div>
            <div class="device-credentials">
                <div class="credential-item">
                    <label>Username:</label>
                    <span class="credential-value">${device.username || 'N/A'}</span>
                    ${device.username ? `<button class="btn-copy" data-value="${device.username}">
                        <i class="fas fa-copy"></i>
                    </button>` : ''}
                </div>
                <div class="credential-item">
                    <label>Password:</label>
                    <span class="credential-value">${device.password ? '••••••••' : 'N/A'}</span>
                    ${device.password ? `<button class="btn-copy" data-value="${device.password}">
                        <i class="fas fa-copy"></i>
                    </button>` : ''}
                </div>
            </div>
            <div class="device-actions">
                <button class="btn btn-primary select-device" data-device-id="${device.device_id || device.id}">
                    <i class="fas fa-tachometer-alt"></i> View Dashboard
                </button>
                <button class="btn btn-secondary edit-device" data-device-id="${device.device_id || device.id}">
                    <i class="fas fa-edit"></i> Edit
                </button>
                <button class="btn btn-danger delete-device" data-device-id="${device.device_id || device.id}">
                    <i class="fas fa-trash"></i> Delete
                </button>
            </div>
        `;
        
        // Add status indicator styling
        const statusIndicator = deviceCard.querySelector('.device-status .fas.fa-circle');
        if (statusIndicator) {
            if (status === 'online') {
                statusIndicator.style.color = 'var(--success)';
            } else if (status === 'offline') {
                statusIndicator.style.color = 'var(--danger)';
            } else {
                statusIndicator.style.color = 'var(--warning)';
            }
        }
        
        // Add event listeners
        deviceCard.querySelector('.select-device').addEventListener('click', () => {
            Logger.log('Device selected', { deviceId: device.device_id || device.id });
            selectDevice(device.device_id || device.id, device.name || device.device_name);
        });
        
        deviceCard.querySelector('.edit-device').addEventListener('click', () => {
            Logger.log('Editing device', { deviceId: device.device_id || device.id });
            editDevice(device);
        });
        
        deviceCard.querySelector('.delete-device').addEventListener('click', () => {
            Logger.log('Delete device clicked', { deviceId: device.device_id || device.id });
            deleteDevice(device.device_id || device.id, device.name || device.device_name);
        });
        
        // Add copy functionality
        deviceCard.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', function() {
                const value = this.getAttribute('data-value');
                Logger.log('Copy button clicked', { value: value ? '***REDACTED***' : 'empty' });
                copyToClipboard(value);
                showCopyFeedback('Copied to clipboard!');
            });
        });
        
        devicesList.appendChild(deviceCard);
    });
}

function updateDeviceCardStatus(device) {
    const deviceCard = document.querySelector(`[data-device-id="${device.device_id || device.id}"]`);
    if (!deviceCard) return;
    
    // Get status elements
    const statusElement = deviceCard.querySelector('.device-status');
    const lastSeenElement = deviceCard.querySelector('.last-seen');
    
    if (statusElement && lastSeenElement) {
        // Use the same status logic as your dashboard
        const status = device.status || (device.online ? 'online' : 'offline');
        const systemMode = device.system_mode || 'offline';
        const lastSeen = device.last_seen;
        
        // Update status with proper styling
        statusElement.className = `device-status ${status}`;
        statusElement.innerHTML = `<i class="fas fa-circle"></i> ${status.toUpperCase()}`;
        
        // Update last seen with proper formatting
        if (lastSeen) {
            const lastSeenDate = new Date(lastSeen);
            const now = new Date();
            const diffMs = now - lastSeenDate;
            const diffMins = Math.floor(diffMs / 60000);
            
            let statusText;
            if (status === 'online') {
                if (diffMins < 5) {
                    statusText = 'Live - Connected now';
                } else if (diffMins < 30) {
                    statusText = `Online - ${diffMins} min ago`;
                } else {
                    statusText = `Online - ${Math.floor(diffMins/60)} hours ago`;
                }
            } else {
                if (diffMins < 60) {
                    statusText = `Offline - ${diffMins} min ago`;
                } else {
                    statusText = `Offline - ${Math.floor(diffMins/60)} hours ago`;
                }
            }
            
            lastSeenElement.textContent = `Last seen: ${statusText}`;
        } else {
            lastSeenElement.textContent = 'Last seen: Never';
        }
        
        // Update status indicator color
        const statusIndicator = statusElement.querySelector('.fas.fa-circle');
        if (statusIndicator) {
            if (status === 'online') {
                statusIndicator.style.color = 'var(--success)';
            } else if (status === 'offline') {
                statusIndicator.style.color = 'var(--danger)';
            } else {
                statusIndicator.style.color = 'var(--warning)';
            }
        }
    }
}

async function updateDevicesStatus() {
    Logger.log('Updating devices status from database');
    
    try {
        const devices = await apiFetch('/api/devices/my-devices');
        const devicesList = document.getElementById('devices-list');
        
        if (!devicesList) return;
        
        // Update each device card with current status
        devices.forEach(device => {
            updateDeviceCardStatus(device);
        });
        
    } catch (error) {
        Logger.error('Error updating devices status', error);
        // Fallback to localStorage
        const localDevices = JSON.parse(localStorage.getItem('userDevices')) || [];
        localDevices.forEach(device => {
            updateDeviceCardStatus(device);
        });
    }
}

async function addNewDevice(e) {
    e.preventDefault();
    
    const deviceName = document.getElementById('device-name').value;
    const deviceLocation = document.getElementById('device-location').value;
    const deviceId = document.getElementById('device-id').value;
    const deviceUsername = document.getElementById('device-username').value;
    const devicePassword = document.getElementById('device-password').value;
    
    Logger.log('Adding new device', {
        deviceName,
        deviceLocation,
        deviceId,
        deviceUsername,
        devicePassword: devicePassword ? '***REDACTED***' : 'empty'
    });
    
    // Validate required fields
    if (!deviceName || !deviceLocation || !deviceId || !deviceUsername || !devicePassword) {
        Logger.warn('Form validation failed - missing required fields');
        showFormError('Please fill in all fields');
        return;
    }
    
    try {
        await apiFetch('/api/devices/register', {
            method: 'POST',
            body: JSON.stringify({
                device_id: deviceId,
                device_name: deviceName,
                location: deviceLocation,
                username: deviceUsername,
                password: devicePassword
            })
        });

        // Clear form
        document.getElementById('add-device-form').reset();
        
        Logger.info('Device registered successfully', { deviceName, deviceId });
        
        // Reload devices list
        loadUserDevices();
        
        // Show success message
        showFormSuccess(`Device "${deviceName}" registered successfully!`);
        
    } catch (error) {
        Logger.error('Device registration failed', error);
        showFormError(error.message);
        
        // Fallback to localStorage if API fails
        Logger.log('API failed, using localStorage fallback');
        addDeviceToLocalStorage(deviceId, deviceName, deviceLocation, deviceUsername, devicePassword);
    }
}

function addDeviceToLocalStorage(deviceId, deviceName, deviceLocation, deviceUsername, devicePassword) {
    Logger.log('Adding device to localStorage', { deviceName, deviceId });
    
    const userDevices = JSON.parse(localStorage.getItem('userDevices')) || [];
    
    // Check if device ID already exists
    if (userDevices.some(device => device.device_id === deviceId)) {
        Logger.warn('Device ID already exists in localStorage', { deviceId });
        showFormError('Device ID already exists. Please choose a different one.');
        return;
    }
    
    const newDevice = {
        device_id: deviceId,
        device_name: deviceName,
        name: deviceName,
        location: deviceLocation,
        username: deviceUsername,
        password: devicePassword,
        last_seen: new Date().toISOString(),
        status: 'offline',
        created_at: new Date().toISOString()
    };
    
    userDevices.push(newDevice);
    localStorage.setItem('userDevices', JSON.stringify(userDevices));
    
    document.getElementById('add-device-form').reset();
    loadUserDevices();
    
    Logger.info('Device added to localStorage successfully', { deviceName, deviceId });
    showFormSuccess(`Device "${deviceName}" added successfully!`);
}

function editDevice(device) {
    Logger.log('Editing device', { 
        deviceId: device.device_id || device.id,
        deviceName: device.device_name || device.name 
    });
    
    // Populate form with device data
    document.getElementById('device-name').value = device.device_name || device.name;
    document.getElementById('device-location').value = device.location;
    document.getElementById('device-id').value = device.device_id || device.id;
    document.getElementById('device-username').value = device.username;
    document.getElementById('device-password').value = device.password;
    
    // Change form to edit mode
    const form = document.getElementById('add-device-form');
    const submitBtn = form.querySelector('button[type="submit"]');
    
    submitBtn.innerHTML = '<i class="fas fa-save"></i> Update Device';
    submitBtn.onclick = function(e) {
        e.preventDefault();
        updateDevice(device.device_id || device.id);
    };
    
    // Add cancel button
    if (!document.getElementById('cancel-edit')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.id = 'cancel-edit';
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
        cancelBtn.onclick = cancelEdit;
        form.appendChild(cancelBtn);
    }
    
    // Scroll to form
    form.scrollIntoView({ behavior: 'smooth' });
}

async function updateDevice(deviceId) {
    Logger.log('Updating device', { deviceId });
    
    const deviceName = document.getElementById('device-name').value;
    const deviceLocation = document.getElementById('device-location').value;
    const deviceUsername = document.getElementById('device-username').value;
    const devicePassword = document.getElementById('device-password').value;
    
    try {
        await apiFetch(`/api/devices/${deviceId}`, {
            method: 'PUT',
            body: JSON.stringify({
                device_name: deviceName,
                location: deviceLocation,
                username: deviceUsername,
                password: devicePassword
            })
        });

        Logger.info('Device updated successfully', { deviceId, deviceName });
        
        // Reset form and reload
        cancelEdit();
        loadUserDevices();
        showFormSuccess(`Device "${deviceName}" updated successfully!`);
        
    } catch (error) {
        Logger.error('Device update failed', error);
        showFormError(error.message);
        
        // Fallback to localStorage
        Logger.log('API failed, using localStorage fallback for update');
        updateDeviceInLocalStorage(deviceId, deviceName, deviceLocation, deviceUsername, devicePassword);
    }
}

function updateDeviceInLocalStorage(deviceId, deviceName, deviceLocation, deviceUsername, devicePassword) {
    Logger.log('Updating device in localStorage', { deviceId, deviceName });
    
    const userDevices = JSON.parse(localStorage.getItem('userDevices')) || [];
    const deviceIndex = userDevices.findIndex(d => d.device_id === deviceId);
    
    if (deviceIndex === -1) {
        Logger.warn('Device not found in localStorage', { deviceId });
        showFormError('Device not found');
        return;
    }
    
    userDevices[deviceIndex] = {
        ...userDevices[deviceIndex],
        device_name: deviceName,
        name: deviceName,
        location: deviceLocation,
        username: deviceUsername,
        password: devicePassword
    };
    
    localStorage.setItem('userDevices', JSON.stringify(userDevices));
    cancelEdit();
    loadUserDevices();
    
    Logger.info('Device updated in localStorage successfully', { deviceId, deviceName });
    showFormSuccess(`Device "${deviceName}" updated successfully!`);
}

async function deleteDevice(deviceId, deviceName) {
    Logger.log('Delete device confirmation requested', { deviceId, deviceName });
    
    if (!confirm(`Are you sure you want to delete "${deviceName}"? This action cannot be undone.`)) {
        Logger.log('Delete operation cancelled by user');
        return;
    }

    try {
        await apiFetch(`/api/devices/${deviceId}`, {
            method: 'DELETE'
        });

        // If deleted device was current device, clear it
        const currentDevice = localStorage.getItem('currentDevice');
        if (currentDevice === deviceId) {
            localStorage.removeItem('currentDevice');
            localStorage.removeItem('currentDeviceName');
            Logger.log('Current device cleared after deletion', { deviceId });
        }
        
        Logger.info('Device deleted successfully', { deviceId, deviceName });
        
        loadUserDevices();
        showFormSuccess(`Device "${deviceName}" deleted successfully!`);
        
    } catch (error) {
        Logger.error('Device deletion failed', error);
        showFormError(error.message);
        
        // Fallback to localStorage
        Logger.log('API failed, using localStorage fallback for deletion');
        deleteDeviceFromLocalStorage(deviceId, deviceName);
    }
}

function deleteDeviceFromLocalStorage(deviceId, deviceName) {
    Logger.log('Deleting device from localStorage', { deviceId, deviceName });
    
    const userDevices = JSON.parse(localStorage.getItem('userDevices')) || [];
    const updatedDevices = userDevices.filter(d => d.device_id !== deviceId);
    localStorage.setItem('userDevices', JSON.stringify(updatedDevices));
    
    const currentDevice = localStorage.getItem('currentDevice');
    if (currentDevice === deviceId) {
        localStorage.removeItem('currentDevice');
        localStorage.removeItem('currentDeviceName');
        Logger.log('Current device cleared after deletion from localStorage', { deviceId });
    }
    
    loadUserDevices();
    
    Logger.info('Device deleted from localStorage successfully', { deviceId, deviceName });
    showFormSuccess(`Device "${deviceName}" deleted successfully!`);
}

function cancelEdit() {
    Logger.log('Cancelling edit mode');
    
    document.getElementById('add-device-form').reset();
    const submitBtn = document.getElementById('add-device-form').querySelector('button[type="submit"]');
    submitBtn.innerHTML = '<i class="fas fa-plus"></i> Add Device';
    submitBtn.onclick = function(e) {
        e.preventDefault();
        addNewDevice(e);
    };
    
    const cancelBtn = document.getElementById('cancel-edit');
    if (cancelBtn) {
        cancelBtn.remove();
    }
}

function selectDevice(deviceId, deviceName) {
    Logger.info('Device selected for dashboard', { deviceId, deviceName });
    
    localStorage.setItem('currentDevice', deviceId);
    localStorage.setItem('currentDeviceName', deviceName);
    window.location.href = '../';
}

function logoutUser() {
    Logger.info('User logging out');
    
    localStorage.clear();
    window.location.href = '../auth/login.html';
}

function copyToClipboard(text) {
    Logger.log('Copying text to clipboard', { text: text ? '***REDACTED***' : 'empty' });
    
    navigator.clipboard.writeText(text).then(() => {
        Logger.log('Text copied to clipboard successfully');
    }).catch(err => {
        Logger.error('Failed to copy text to clipboard', err);
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    });
}

function showCopyFeedback(message) {
    Logger.log('Showing copy feedback', { message });
    
    const feedback = document.createElement('div');
    feedback.className = 'copy-feedback';
    feedback.textContent = message;
    feedback.style.cssText = `
        position: fixed;
        top: 20px;
        right: 20px;
        background: var(--success);
        color: white;
        padding: 10px 20px;
        border-radius: 5px;
        z-index: 10000;
        animation: fadeInOut 2s ease-in-out;
    `;
    
    document.body.appendChild(feedback);
    
    setTimeout(() => {
        feedback.remove();
    }, 2000);
}

function showFormError(message) {
    Logger.log('Showing form error', { message });
    
    // Remove existing error messages
    const existingError = document.getElementById('form-error');
    if (existingError) existingError.remove();
    
    const errorDiv = document.createElement('div');
    errorDiv.id = 'form-error';
    errorDiv.className = 'form-error';
    errorDiv.innerHTML = `<i class="fas fa-exclamation-circle"></i> ${message}`;
    
    const form = document.getElementById('add-device-form');
    form.insertBefore(errorDiv, form.firstChild);
    
    // Scroll to error
    errorDiv.scrollIntoView({ behavior: 'smooth' });
}

function showFormSuccess(message) {
    Logger.log('Showing form success', { message });
    
    const successDiv = document.createElement('div');
    successDiv.className = 'form-success';
    successDiv.innerHTML = `<i class="fas fa-check-circle"></i> ${message}`;
    
    const form = document.getElementById('add-device-form');
    form.insertBefore(successDiv, form.firstChild);
    
    // Remove after 3 seconds
    setTimeout(() => {
        successDiv.remove();
    }, 3000);
}

function formatTime(dateString) {
    if (!dateString) return 'Never';
    
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now - date;
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);
    
    if (diffSecs < 60) return 'Just now';
    if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
    if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;
    
    return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { 
        hour: '2-digit', 
        minute: '2-digit' 
    });
}