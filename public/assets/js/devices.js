// devices.js - Fixed with proper token handling
document.addEventListener('DOMContentLoaded', function () {
    Logger.log('Device selection page loaded');
    initializeDevicesPage();
});

// Initialize the devices page
async function initializeDevicesPage() {
    try {
        await checkAuthentication();
        await loadUserDevices();
        
        // Set up event listeners
        const logoutBtn = document.getElementById('logout-btn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', function(e) {
                e.preventDefault();
                logoutUser();
            });
        }
        
        const addDeviceForm = document.getElementById('add-device-form');
        if (addDeviceForm) {
            addDeviceForm.addEventListener('submit', addNewDevice);
        }
        
        // Initialize modal listeners
        initializeModalListeners();
        
    } catch (error) {
        Logger.error('Failed to initialize devices page', error);
        handleUnauthenticatedState();
    }
}

// Environment-based logger for devices page
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
            console.log(`%c[DEVICES] ${message}`, 'color: purple; font-weight: bold;', data || '');
        }
    },

    info: function (message, data = null) {
        console.info(`%c[DEVICES] ${message}`, 'color: teal; font-weight: bold;', data || '');
    },

    warn: function (message, data = null) {
        console.warn(`%c[DEVICES] ${message}`, 'color: darkorange; font-weight: bold;', data || '');
    },

    error: function (message, error = null) {
        console.error(`%c[DEVICES] ${message}`, 'color: crimson; font-weight: bold;', error || '');
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

// Enhanced fetch with error handling (updated to match reference auth pattern)
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

        // Add Authorization header if we have a token - FIXED
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

// Authentication check - FIXED to send token
// Authentication check (updated to match reference pattern)
async function checkAuthentication() {
    try {
        Logger.log('Checking authentication status...');

        const token = localStorage.getItem('authToken');
        if (!token) {
            Logger.warn('No auth token found');
            handleUnauthenticatedState();
            return;
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
            return;
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
    } catch (error) {
        Logger.error('Auth check failed:', error);
        handleUnauthenticatedState();
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
    window.location.href = `/login?redirect=${encodeURIComponent(currentPath)}`;
}

async function loadUserDevices() {
    Logger.log('Loading user devices');
    
    try {
        const response = await apiFetch('/api/devices/my-devices');
        const apiDevices = response.devices || [];
        const localDevices = JSON.parse(localStorage.getItem('userDevices')) || [];

        // Merge API data with localStorage credentials
        const mergedDevices = apiDevices.map(apiDevice => {
            const localDevice = localDevices.find(local => local.device_id === apiDevice.device_id);
            return {
                ...apiDevice,
                username: localDevice?.username || apiDevice.device_username,
                password: localDevice?.password || apiDevice.password || apiDevice.device_password // Include password from all sources
            };
        });

        Logger.log('Devices loaded from API', { count: mergedDevices.length });

        if (mergedDevices.length === 0) {
            Logger.info('No devices found, showing welcome message');
            showWelcomeMessage();
        } else {
            Logger.info('Displaying devices', { count: mergedDevices.length });
            displayDevices(mergedDevices);
        }
    } catch (error) {
        Logger.error('Error loading devices from API, falling back to localStorage', error);
        
        // Fallback to localStorage if API fails
        const localDevices = JSON.parse(localStorage.getItem('userDevices')) || [];
        Logger.log('LocalStorage devices', { count: localDevices.length });
        
        if (localDevices.length === 0) {
            Logger.info('No devices in localStorage, showing welcome message');
            showWelcomeMessage();
        } else {
            Logger.info('Displaying devices from localStorage', { count: localDevices.length });
            displayDevices(localDevices);
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
    // Add safety check
    if (!devices || !Array.isArray(devices)) {
        Logger.error('Invalid devices data received', devices);
        showWelcomeMessage();
        return;
    }

    Logger.log('Displaying devices', { count: devices.length });

    const devicesList = document.getElementById('devices-list');
    devicesList.innerHTML = '';

    devices.forEach(device => {
        // Add null checks for device properties
        const deviceCard = document.createElement('div');
        deviceCard.className = 'device-card';
        deviceCard.innerHTML = `
            <div class="device-header">
                <div class="device-icon">
                    <i class="fas fa-wind"></i>
                </div>
                <div class="device-info">
                    <h4>${device.name || device.device_name || 'Unnamed Device'}</h4>
                    <p class="device-location"><i class="fas fa-map-marker-alt"></i> ${device.location || 'Not specified'}</p>
                    <p class="device-id">ID: ${device.device_id || device.id || 'N/A'}</p>
                    <p class="last-seen">Status: ${device.status || device.system_mode || 'unknown'}</p>
                    <p class="last-seen">Last seen: ${device.last_seen ? formatTime(device.last_seen) : 'Never'}</p>
                </div>
                <div class="device-status ${device.status || device.system_mode || 'unknown'}">
                    <i class="fas fa-circle"></i>
                    ${device.status || device.system_mode || 'Unknown'}
                </div>
            </div>
<div class="device-credentials">
    <div class="credential-item">
        <label>Device ID:</label>
        <span class="credential-value">${device.device_id || 'N/A'}</span>
        ${device.device_id ? `<button class="btn-copy" data-value="${device.device_id}">
            <i class="fas fa-copy"></i>
        </button>` : ''}
    </div>
    <div class="credential-item">
        <label>Username:</label>
        <span class="credential-value">${device.device_username || device.username || 'N/A'}</span>
        ${(device.device_username || device.username) ? `<button class="btn-copy" data-value="${device.device_username || device.username}">
            <i class="fas fa-copy"></i>
        </button>` : ''}
    </div>
    <div class="credential-item">
        <label>Password:</label>
        <span class="credential-value">${device.device_password || device.password ? '••••••••' : 'N/A'}</span>
        ${(device.device_password || device.password) ? `<button class="btn-copy" data-value="${device.device_password || device.password}">
            <i class="fas fa-copy"></i>
        </button>` : ''}
    </div>
</div>

           <div class="device-actions">
    <button class="btn btn-primary select-device" data-device-id="${device.device_id}">
        <i class="fas fa-tachometer-alt"></i> View Dashboard
    </button>
    ${device.can_edit !== false ? `
    <button class="btn btn-secondary edit-device" data-device-id="${device.device_id}">
        <i class="fas fa-edit"></i> Edit
    </button>
    <button class="btn btn-info share-device" data-device-id="${device.device_id}">
        <i class="fas fa-share-alt"></i> Share
    </button>
    <button class="btn btn-danger delete-device" data-device-id="${device.device_id}">
        <i class="fas fa-trash"></i> Delete
    </button>
    ` : ''}
</div>
        `;

        // Add event listeners
        const selectBtn = deviceCard.querySelector('.select-device');
        if (selectBtn) {
            selectBtn.addEventListener('click', (e) => {
                e.preventDefault();
                const deviceId = device.device_id || device.id;
                const deviceName = device.name || device.device_name;
                Logger.log('Device selected', { deviceId, deviceName });
                selectDevice(deviceId, deviceName);
            });
        }

        const editBtn = deviceCard.querySelector('.edit-device');
        if (editBtn && device.can_edit !== false) {
            editBtn.addEventListener('click', (e) => {
                e.preventDefault();
                Logger.log('Editing device', { deviceId: device.device_id || device.id });
                editDevice(device);
            });
        }

        const deleteBtn = deviceCard.querySelector('.delete-device');
if (deleteBtn && device.can_edit !== false) {
    deleteBtn.addEventListener('click', (e) => {
        e.preventDefault();
        Logger.log('Delete device clicked', { 
            deviceId: device.device_id, 
            deviceName: device.name 
        });
        // This now calls openDeleteModal instead of the old confirm-based deleteDevice
        openDeleteModal(device.device_id, device.name || device.device_name);
    });
}
        // Add this in the event listeners section after edit and delete buttons:
const shareBtn = deviceCard.querySelector('.share-device');
if (shareBtn && device.can_edit !== false) {
    shareBtn.addEventListener('click', (e) => {
        e.preventDefault();
        Logger.log('Share device clicked', { 
            deviceId: device.device_id, 
            deviceName: device.name 
        });
        openShareModal(device.device_id, device.name);
    });
}

        // Add copy functionality
        deviceCard.querySelectorAll('.btn-copy').forEach(btn => {
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                const value = this.getAttribute('data-value');
                Logger.log('Copy button clicked', { value: value ? '***REDACTED***' : 'empty' });
                copyToClipboard(value);
                showCopyFeedback('Copied to clipboard!');
            });
        });

        devicesList.appendChild(deviceCard);
    });
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
        // Store in localStorage immediately for credentials access
        const userDevices = JSON.parse(localStorage.getItem('userDevices')) || [];
        
        // Remove existing device with same ID
        const filteredDevices = userDevices.filter(d => d.device_id !== deviceId);
        
        const newDevice = {
            device_id: deviceId,
            device_name: deviceName,
            name: deviceName,
            location: deviceLocation,
            username: deviceUsername,
            password: devicePassword, // Store the actual password
            last_seen: new Date().toISOString(),
            status: 'offline',
            created_at: new Date().toISOString()
        };

        filteredDevices.push(newDevice);
        localStorage.setItem('userDevices', JSON.stringify(filteredDevices));

        // Then make API call
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
        
        // Device is already stored in localStorage, so we can still proceed
        loadUserDevices();
    }
}

// Modal Management
let currentSharingDevice = null;

function openShareModal(deviceId, deviceName) {
    currentSharingDevice = { deviceId, deviceName };
    
    const modal = document.getElementById('share-device-modal');
    const deviceNameElement = document.getElementById('share-device-name');
    const usernameInput = document.getElementById('share-username');
    
    deviceNameElement.textContent = deviceName;
    usernameInput.value = '';
    
    modal.classList.add('open');
}

function closeShareModal() {
    const modal = document.getElementById('share-device-modal');
    modal.classList.remove('open');
    currentSharingDevice = null;
}

// Initialize Modal Event Listeners
function initializeModalListeners() {
    // Share modal events
    document.getElementById('share-modal-close').addEventListener('click', closeShareModal);
    document.getElementById('share-modal-cancel').addEventListener('click', closeShareModal);
    document.getElementById('share-device-confirm').addEventListener('click', confirmShareDevice);
    
    // Delete modal events
    document.getElementById('delete-modal-close').addEventListener('click', closeDeleteModal);
    document.getElementById('delete-modal-cancel').addEventListener('click', closeDeleteModal);
    document.getElementById('delete-device-confirm').addEventListener('click', confirmDeleteDevice);
    
    // Close modals when clicking outside
    document.getElementById('share-device-modal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeShareModal();
        }
    });
    
    document.getElementById('delete-device-modal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeDeleteModal();
        }
    });
    
    // Close modals with Escape key
    document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
            closeShareModal();
            closeDeleteModal();
        }
    });
}

// Share Device Function
async function confirmShareDevice() {
    const usernameInput = document.getElementById('share-username');
    const sharedUsername = usernameInput.value.trim();
    
    if (!sharedUsername) {
        showFormError('Please enter a username');
        return;
    }
    
    if (!currentSharingDevice) {
        showFormError('No device selected for sharing');
        return;
    }
    
    try {
        Logger.log('Sharing device', { 
            deviceId: currentSharingDevice.deviceId, 
            deviceName: currentSharingDevice.deviceName,
            sharedUsername 
        });
        
        await apiFetch('/api/devices/share', {
            method: 'POST',
            body: JSON.stringify({
                device_id: currentSharingDevice.deviceId,
                shared_username: sharedUsername
            })
        });
        
        Logger.info('Device shared successfully');
        closeShareModal();
        showFormSuccess(`Device "${currentSharingDevice.deviceName}" shared with ${sharedUsername} successfully!`);
        
    } catch (error) {
        Logger.error('Device sharing failed', error);
        showFormError(error.message);
    }
}

// Update the share button event listener in displayDevices function:
const shareBtn = deviceCard.querySelector('.share-device');
if (shareBtn && device.can_edit !== false) {
    shareBtn.addEventListener('click', (e) => {
        e.preventDefault();
        Logger.log('Share device clicked', { 
            deviceId: device.device_id, 
            deviceName: device.name 
        });
        openShareModal(device.device_id, device.name);
    });
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
        deviceId: device.device_id,
        deviceName: device.name,
        username: device.device_username 
    });
    
    // Populate form with device data
    document.getElementById('device-name').value = device.name;
    document.getElementById('device-location').value = device.location;
    document.getElementById('device-id').value = device.device_id;
    document.getElementById('device-username').value = device.device_username || '';
    
    // Note: We don't populate password for security
    document.getElementById('device-password').value = '';
    document.getElementById('device-password').placeholder = 'Leave blank to keep current password';
    
    // Change form to edit mode
    const form = document.getElementById('add-device-form');
    const submitBtn = form.querySelector('button[type="submit"]');
    
    submitBtn.innerHTML = '<i class="fas fa-save"></i> Update Device';
    
    // Create new event listener for update
    const newHandler = function(e) {
        e.preventDefault();
        updateDevice(device.device_id);
    };
    
    // Remove old event listener and add new one
    const newSubmitBtn = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
    newSubmitBtn.addEventListener('click', newHandler);
    
    // Add cancel button if it doesn't exist
    if (!document.getElementById('cancel-edit')) {
        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.id = 'cancel-edit';
        cancelBtn.className = 'btn btn-secondary';
        cancelBtn.innerHTML = '<i class="fas fa-times"></i> Cancel';
        cancelBtn.addEventListener('click', cancelEdit);
        form.querySelector('.form-actions').appendChild(cancelBtn);
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

// Delete Modal Management
let currentDeletionDevice = null;

function openDeleteModal(deviceId, deviceName) {
    currentDeletionDevice = { deviceId, deviceName };
    
    const modal = document.getElementById('delete-device-modal');
    const deviceNameElement = document.getElementById('delete-device-name');
    
    deviceNameElement.textContent = deviceName;
    modal.classList.add('open');
}

function closeDeleteModal() {
    const modal = document.getElementById('delete-device-modal');
    modal.classList.remove('open');
    currentDeletionDevice = null;
}

// Initialize Delete Modal Event Listeners
function initializeDeleteModalListeners() {
    // Close modal events
    document.getElementById('delete-modal-close').addEventListener('click', closeDeleteModal);
    document.getElementById('delete-modal-cancel').addEventListener('click', closeDeleteModal);
    
    // Confirm delete event
    document.getElementById('delete-device-confirm').addEventListener('click', confirmDeleteDevice);
    
    // Close modal when clicking outside
    document.getElementById('delete-device-modal').addEventListener('click', function(e) {
        if (e.target === this) {
            closeDeleteModal();
        }
    });
    
    // Close modal with Escape key (already handled by initializeModalListeners)
}

// Confirm Delete Device Function
async function confirmDeleteDevice() {
    if (!currentDeletionDevice) {
        showFormError('No device selected for deletion');
        return;
    }
    
    const { deviceId, deviceName } = currentDeletionDevice;
    
    try {
        Logger.log('Deleting device confirmed', { deviceId, deviceName });
        
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
        
        closeDeleteModal();
        loadUserDevices();
        showFormSuccess(`Device "${deviceName}" deleted successfully!`);

    } catch (error) {
        Logger.error('Device deletion failed', error);
        showFormError(error.message);

        // Fallback to localStorage
        Logger.log('API failed, using localStorage fallback for deletion');
        deleteDeviceFromLocalStorage(deviceId, deviceName);
        closeDeleteModal();
    }
}

// Update the deleteDevice function to use modal instead of confirm()
async function deleteDevice(deviceId, deviceName) {
    Logger.log('Delete device confirmation requested', { deviceId, deviceName });
    openDeleteModal(deviceId, deviceName);
}

function cancelEdit() {
    Logger.log('Cancelling edit mode');

    const form = document.getElementById('add-device-form');
    form.reset();

    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.innerHTML = '<i class="fas fa-plus"></i> Add Device';

    // Reset event listener
    const newSubmitBtn = submitBtn.cloneNode(true);
    submitBtn.parentNode.replaceChild(newSubmitBtn, submitBtn);
    newSubmitBtn.addEventListener('submit', addNewDevice);

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

// Logout function - FIXED to use POST method
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
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    if (diffHours < 24) return `${diffHours} hours ago`;
    if (diffDays < 7) return `${diffDays} days ago`;

    return date.toLocaleDateString();
}