#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>
#include <MQ135.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>

// Define pins
#define RELAY_PIN 13
#define MQ135_PIN 36
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_SDA 21
#define OLED_SCL 22

// WiFi credentials
const char* ssid = "Duke1";
const char* password = "estaunbuendia";

// Backend configuration
const char* backendBaseURL = "https://www.airpurifier.electronicsideas.com";
const char* backendUsername = "esp32";
const char* backendPassword = "$2a$12$UlCtTwv1HhSzxDNVvuwR8.up.yAcODczYmsq0WnTkAhGbWqtomLou"; // Change this to match your backend

// Sensor & System variables
MQ135 mq135_sensor(MQ135_PIN);
float air_quality;
bool fanState = false;
String autoMode = "ON"; // Default to automatic control
bool wifiConnected = false;
int connectionAttempts = 0;
const int maxConnectionAttempts = 10;
int autoThreshold = 300; // Default threshold

// JWT Authentication variables
String jwtToken = "";
unsigned long tokenExpiry = 0;
bool isAuthenticated = false;
unsigned long lastDataSendTime = 0;
const unsigned long dataSendInterval = 300000; // 5 minutes

// OLED Display object
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);

// Create AsyncWebServer object on port 80
AsyncWebServer server(80);

// Function to display text on OLED with automatic text wrapping
void displayText(String text, int textSize = 1, int cursorX = 0, int cursorY = 0, bool clear = true) {
  if (clear) {
    display.clearDisplay();
  }
  display.setTextSize(textSize);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(cursorX, cursorY);
  display.println(text);
  display.display();
}

// Function to display a progress bar
void displayProgressBar(int progress, int total, String label = "") {
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  
  if (label != "") {
    display.setCursor(0, 0);
    display.println(label);
  }
  
  // Draw progress bar
  int barWidth = SCREEN_WIDTH - 4;
  int barHeight = 8;
  int barX = 2;
  int barY = SCREEN_HEIGHT - barHeight - 2;
  
  // Border
  display.drawRect(barX, barY, barWidth, barHeight, SSD1306_WHITE);
  
  // Fill
  int fillWidth = (progress * barWidth) / total;
  display.fillRect(barX, barY, fillWidth, barHeight, SSD1306_WHITE);
  
  // Percentage text
  int percent = (progress * 100) / total;
  display.setCursor(SCREEN_WIDTH/2 - 10, barY - 10);
  display.print(percent);
  display.print("%");
  
  display.display();
}

// Function to authenticate with the backend
bool authenticateBackend() {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("Cannot authenticate: WiFi not connected");
    return false;
  }

  // Check if we have a valid token
  if (jwtToken != "" && tokenExpiry > millis()) {
    Serial.println("Using existing valid token");
    return true;
  }

  // If token is expired or doesn't exist, try to login
  WiFiClient client;
  HTTPClient http;

  String serverPath = String(backendBaseURL) + "/api/auth/login";
  
  http.begin(client, serverPath);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "ESP32-AirPurifier/1.0");
  
  // Create login credentials
  String loginData = "{\"username\":\"" + String(backendUsername) + "\",\"password\":\"" + String(backendPassword) + "\"}";
  
  Serial.println("Attempting authentication with backend...");
  int httpResponseCode = http.POST(loginData);
  
  if (httpResponseCode == 200) {
    String payload = http.getString();
    Serial.println("Authentication successful");
    
    // Parse JSON response
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, payload);
    
    if (error) {
      Serial.print("JSON parsing failed: ");
      Serial.println(error.c_str());
      http.end();
      return false;
    }
    
    jwtToken = doc["token"].as<String>();
    String expiresIn = doc["expiresIn"].as<String>();
    
    // Calculate expiry time (assuming 24h)
    tokenExpiry = millis() + 86400000; // 24 hours in milliseconds
    
    isAuthenticated = true;
    Serial.println("JWT token received and stored");
    http.end();
    return true;
  } else {
    Serial.print("Authentication failed, error code: ");
    Serial.println(httpResponseCode);
    if (httpResponseCode > 0) {
      String payload = http.getString();
      Serial.print("Response: ");
      Serial.println(payload);
    }
    http.end();
    return false;
  }
}

// Function to send data to backend with authentication
void sendDataToBackend(float airQuality, bool fanState, bool autoMode) {
  if (!authenticateBackend()) {
    Serial.println("Failed to authenticate with backend, skipping data send");
    return;
  }

  WiFiClient client;
  HTTPClient http;

  String serverPath = String(backendBaseURL) + "/api/readings";
  
  http.begin(client, serverPath);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + jwtToken);
  http.addHeader("User-Agent", "ESP32-AirPurifier/1.0");
  
  // Create JSON data
  String postData = "{\"device_id\":\"esp32_air_purifier_01\",";
  postData += "\"air_quality\":" + String(airQuality) + ",";
  postData += "\"fan_state\":" + String(fanState ? "true" : "false") + ",";
  postData += "\"auto_mode\":" + String(autoMode ? "true" : "false") + "}";
  
  Serial.println("Sending data to backend: " + postData);
  int httpResponseCode = http.POST(postData);
  
  if (httpResponseCode == 201) {
    Serial.println("Data sent to backend successfully");
  } else {
    Serial.print("Error sending data. Code: ");
    Serial.println(httpResponseCode);
    if (httpResponseCode > 0) {
      String payload = http.getString();
      Serial.print("Response: ");
      Serial.println(payload);
    }
    // If unauthorized, reset token to force reauthentication
    if (httpResponseCode == 401) {
      jwtToken = "";
      isAuthenticated = false;
      Serial.println("Token invalid, reset for reauthentication");
    }
  }
  
  http.end();
}

// Function to get settings from backend
void getSettingsFromBackend() {
  if (!authenticateBackend()) {
    Serial.println("Failed to authenticate, cannot get settings");
    return;
  }

  WiFiClient client;
  HTTPClient http;

  String serverPath = String(backendBaseURL) + "/api/settings?device_id=esp32_air_purifier_01";
  
  http.begin(client, serverPath);
  http.addHeader("Authorization", "Bearer " + jwtToken);
  http.addHeader("User-Agent", "ESP32-AirPurifier/1.0");
  
  int httpResponseCode = http.GET();
  
  if (httpResponseCode == 200) {
    String payload = http.getString();
    Serial.println("Settings received: " + payload);
    
    // Parse JSON response
    DynamicJsonDocument doc(256);
    DeserializationError error = deserializeJson(doc, payload);
    
    if (!error && doc.containsKey("threshold")) {
      autoThreshold = doc["threshold"];
      Serial.println("Updated threshold to: " + String(autoThreshold));
    }
  } else {
    Serial.print("Error getting settings. Code: ");
    Serial.println(httpResponseCode);
  }
  
  http.end();
}

void setup() {
  Serial.begin(115200);

  // Initialize OLED
  Wire.begin(OLED_SDA, OLED_SCL);
  displayText("Booting System...", 1, 0, 0);
  delay(1000);
  
  if(!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    displayText("OLED Init Failed!", 1, 0, 0);
    for(;;); // Don't proceed, loop forever
  }
  
  // Initialize Relay Pin
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Start with fan OFF

  // Connect to WiFi with visual feedback
  displayText("Connecting to WiFi...", 1, 0, 0);
  
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED) {
    connectionAttempts++;
    displayProgressBar(connectionAttempts, maxConnectionAttempts, "Connecting to WiFi");
    
    if (connectionAttempts >= maxConnectionAttempts) {
      displayText("WiFi Failed!\nRunning locally.", 1, 0, 0);
      delay(2000);
      break;
    }
    delay(1000);
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    displayText("WiFi Connected!\nIP: " + WiFi.localIP().toString(), 1, 0, 0);
    Serial.println("WiFi Connected. IP: " + WiFi.localIP().toString());
    delay(2000);
    
    // Try to authenticate with backend
    displayText("Auth with\nbackend...", 1, 0, 0);
    if (authenticateBackend()) {
      displayText("Backend auth\nsuccessful!", 1, 0, 0);
      // Get initial settings from backend
      getSettingsFromBackend();
    } else {
      displayText("Backend auth\nfailed!", 1, 0, 0);
    }
    delay(2000);
  }

  // Initialize Web Server Routes
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
    String html = R"=====(
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Air Purifier Control</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --primary: #2c3e50;
            --secondary: #34495e;
            --accent: #2980b9;
            --success: #27ae60;
            --danger: #c0392b;
            --warning: #f39c12;
            --light: #f5f7fa;
            --dark: #2c3e50;
            --bg-primary: #f8f9fa;
            --bg-secondary: #e9ecef;
            --text-primary: #212529;
            --text-secondary: #495057;
            --card-bg: #ffffff;
            --border: #dee2e6;
            --button-text:#ffffff;
        }

        @media (prefers-color-scheme: dark) {
            :root {

                --primary: #ecf0f1;
                --secondary: #bdc3c7;
                --accent: #3498db;
                --success: #2ecc71;
                --danger: #e74c3c;
                --warning: #f1c40f;
                --light: #34495e;
                --dark: #ecf0f1;
                --bg-primary: #121212;
                --bg-secondary: #1e1e1e;
                --text-primary: #f8f9fa;
                --text-secondary: #adb5bd;
                --card-bg: #2d2d2d;
                --border: #444444;
                --button-text:#ffffff;
            }
        }

        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
        }

        body {
            background: var(--bg-primary);
            min-height: 100vh;
            display: flex;
            flex-direction: column;
            align-items: center;
            padding: 20px;
            color: var(--primary);
        }

        .container {
            width: 100%;
            max-width: 800px;
            background: var(--bg-primary);
            backdrop-filter: blur(10px);
            border-radius: 20px;
            padding: 20px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
            margin-top: 20px;
        }

        header {
            text-align: center;
            margin-bottom: 20px;

        }

        h1 {
            font-size: 2.5rem;
            margin-bottom: 10px;
            text-shadow: 2px 2px 4px rgba(0, 0, 0, 0.3);
            color: var(--accent);
        }

        .status-bar {
            display: flex;
            justify-content: space-between;
            margin-bottom: 20px;
            padding: 10px;
            background: var(--card-bg);
            border-radius: 10px;
        }

        .status-item {
            display: flex;
            flex-direction: column;
            align-items: center;
        }

        .status-value {
            font-size: 1.5rem;
            font-weight: bold;
        }

        .status-label {
            font-size: 0.9rem;
            opacity: 0.8;
        }

        .gauge {
            width: 200px;
            height: 200px;
            position: relative;
            margin: 20px auto;
        }

        .gauge-circle {
            width: 100%;
            height: 100%;
            border-radius: 50%;
            background: conic-gradient(var(--success) 0% 33%,
                    var(--warning) 33% 66%,
                    var(--danger) 66% 100%);
            mask: radial-gradient(white 55%, transparent 60%);
            -webkit-mask: radial-gradient(white 55%, transparent 60%);
            
        }

        .gauge-needle {
            position: absolute;
            top: 10%;
            left: 50%;
            width: 4px;
            height: 40%;
            background: var(--dark);
            transform-origin: bottom center;
            transform: translateX(-50%) rotate(0deg);
            transition: transform 0.5s ease;
            border-radius: 4px;
        }

        .gauge-center {
            position: absolute;
            top: 50%;
            left: 50%;
            width: 20px;
            height: 20px;
            background: var(--dark);
            border-radius: 50%;
            transform: translate(-50%, -50%);
        }

        .gauge-value {
            position: absolute;
            top: 70%;
            left: 50%;
            transform: translateX(-50%);
            font-size: 1.5rem;
            font-weight: bold;
        }

        .controls {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-top: 20px;
        }

        .control-card {
            background: var(--card-bg);
            padding: 15px;
            border-radius: 15px;
            text-align: center;
            transition: all 0.3s ease;
        }

        .control-card:hover {
            background: var(--bg-secondary);
            transform: translateY(-5px);
            color:var(--primary);
        }

        .control-title {
            font-size: 1.2rem;
            margin-bottom: 10px;
        }

        .toggle-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 10px;
        }

        .toggle-btn {
            padding: 12px 20px;
            border: none;
            border-radius: 50px;
            font-size: 1rem;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            gap: 8px;
            width: 100%;
        }

        .toggle-btn-fan {
            background: var(--danger);
            color: var(--button-text);
        }

        .toggle-btn-fan.active {
            background: var(--success);
        }

        .toggle-btn-mode {
            background: var(--light);
            color: var(--primary);
        }

        .toggle-btn-mode.active {
            background: var(--accent);
        }

        .toggle-btn:hover {
            opacity: 0.9;
            transform: scale(1.05);
        }

        .status-indicator {
            margin-top: 10px;
            font-size: 0.9rem;
            padding: 5px 10px;
            border-radius: 15px;
            background: var(--accent);
            color:var(--button-text);
        }

        .slider-container {
            margin: 15px 0;
        }

        .slider {
            -webkit-appearance: none;
            width: 100%;
            height: 10px;
            border-radius: 5px;
            background: rgba(255, 255, 255, 0.3);
            outline: none;
        }

        .slider::-webkit-slider-thumb {
            -webkit-appearance: none;
            appearance: none;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: var(--secondary);
            cursor: pointer;
        }

        .history-chart {
            margin-top: 30px;
            background: var(--card-bg);
            padding: 15px;
            border-radius: 15px;
        }

        .chart-container {
            height: 200px;
            width: 100%;
            position: relative;
        }

        .chart-bar {
            position: absolute;
            bottom: 0;
            width: 10px;
            background: var(--secondary);
            border-radius: 5px 5px 0 0;
            transition: height 0.5s ease;
        }

        footer {
            margin-top: 30px;
            text-align: center;
            font-size: 0.9rem;
            opacity: 0.7;
        }

        @media (max-width: 767px) {
            .controls {
                grid-template-columns: 1fr;
            }

            h1 {
                font-size: 2rem;
            }
        }


        /*Admin Styles*/
         .login-container {
            max-width: 400px;
            margin: 50px auto;
            padding: 20px;
            background: var(--card-bg);
            border-radius: 15px;
            box-shadow: 0 8px 32px rgba(0, 0, 0, 0.2);
        }
        
        .login-form {
            display: flex;
            flex-direction: column;
            gap: 15px;
        }
        
        .form-group {
            display: flex;
            flex-direction: column;
            gap: 5px;
        }
        
        .form-group label {
            font-weight: bold;
        }
        
        .form-group input {
            padding: 10px;
            border: 1px solid var(--border);
            border-radius: 5px;
            background: var(--bg-secondary);
            color: var(--text-primary);
        }
        
        .btn {
            padding: 12px 20px;
            border: none;
            border-radius: 50px;
            font-size: 1rem;
            font-weight: bold;
            cursor: pointer;
            transition: all 0.3s ease;
            text-align: center;
        }
        
        .btn-primary {
            background: var(--accent);
            color: var(--button-text);
        }
        
        .btn-danger {
            background: var(--danger);
            color: var(--button-text);
        }
        
        .user-menu {
            position: absolute;
            top: 20px;
            right: 20px;
        }
        
        .admin-panel {
            margin-top: 30px;
            background: var(--card-bg);
            padding: 15px;
            border-radius: 15px;
        }
        
        .user-table {
            width: 100%;
            border-collapse: collapse;
            margin-top: 15px;
        }
        
        .user-table th, .user-table td {
            padding: 10px;
            text-align: left;
            border-bottom: 1px solid var(--border);
        }
        
        .hidden {
            display: none;
        }
    </style>
</head>

<body>
  <div id="login-page" class="login-container">
        <h1><i class="fas fa-wind"></i> Air Purifier Login</h1>
        <form id="login-form" class="login-form">
            <div class="form-group">
                <label for="username">Username</label>
                <input type="text" id="username" required>
            </div>
            <div class="form-group">
                <label for="password">Password</label>
                <input type="password" id="password" required>
            </div>
            <button type="submit" class="btn btn-primary">Login</button>
        </form>
        <div id="login-message" style="margin-top: 15px; color: var(--danger);"></div>
    </div>

    <div id="app-content" class="hidden">
        <div class="user-menu">
            <span id="user-greeting">Welcome, </span>
            <button id="logout-btn" class="btn btn-danger">Logout</button>
        </div>
    <header>
        <h1><i class="fas fa-wind"></i> Air Purifier Control</h1>
        <p>Monitor and control your air purification system</p>
    </header>

    <div class="container">
        <div class="status-bar">
            <div class="status-item">
                <div class="status-value" id="wifi-status">)=====";

                    html += wifiConnected ? "<i class='fas fa-wifi'></i> Connected" : "<i
                        class='fas fa-exclamation-triangle'></i> Offline";
                    html += R"=====(</div>
                <div class="status-label">Network</div>
            </div>
            <div class="status-item">
                <div class="status-value" id="fan-status">)=====";
                    html += fanState ? "<i class='fas fa-fan'></i> ON" : "<i class='fas fa-fan'></i> OFF";
                    html += R"=====(</div>
                <div class="status-label">Fan</div>
            </div>
            <div class="status-item">
                <div class="status-value" id="auto-status">)=====";
                    html += autoMode == "ON" ? "<i class='fas fa-robot'></i> AUTO" : "<i
                        class='fas fa-hand-pointer'></i> MANUAL";
                    html += R"=====(</div>
                <div class="status-label">Mode</div>
            </div>
        </div>

        <div class="gauge">
            <div class="gauge-circle"></div>
            <div class="gauge-needle" id="gauge-needle"></div>
            <div class="gauge-center"></div>
            <div class="gauge-value" id="air-quality-value">0 PPM</div>
        </div>

        <div class="controls">
            <div class="control-card">
                <div class="control-title">Fan Control</div>
                <div class="toggle-container">
                    <button class="toggle-btn toggle-btn-fan" id="toggle-fan">
                        <i class="fas fa-fan"></i> <span id="fan-btn-text">Turn ON</span>
                    </button>
                    <div class="status-indicator" id="fan-status-indicator">Fan is OFF</div>
                </div>
            </div>

            <div class="control-card">
                <div class="control-title">Operation Mode</div>
                <div class="toggle-container">
                    <button class="toggle-btn toggle-btn-mode" id="toggle-mode">
                        <i class="fas fa-cog"></i> <span id="mode-btn-text">Switch to Manual</span>
                    </button>
                    <div class="status-indicator" id="mode-status-indicator">Auto Mode Active</div>
                </div>
            </div>

            <div class="control-card">
                <div class="control-title">Settings</div>
                <div class="slider-container">
                    <label for="threshold">Auto Threshold: <span id="threshold-value">)=====";
                    html += String(autoThreshold);
                    html += R"=====(</span> PPM</label>
                    <input type="range" min="100" max="1000" value=")=====";
                    html += String(autoThreshold);
                    html += R"=====(" class="slider" id="threshold"
                        onchange="updateThreshold(this.value)">
                </div>
            </div>
        </div>

        <div class="history-chart">
            <h3><i class="fas fa-chart-line"></i> Air Quality History</h3>
            <div class="chart-container" id="chart-container"></div>
        </div>
    </div>

     <!-- Admin Panel (only visible to admins) -->
            <div id="admin-panel" class="admin-panel hidden">
                <h3><i class="fas fa-users-cog"></i> User Management</h3>
                <button id="add-user-btn" class="btn btn-primary">Add User</button>
                
                <table class="user-table">
                    <thead>
                        <tr>
                            <th>Username</th>
                            <th>Admin</th>
                            <th>Created</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody id="users-table-body">
                        <!-- Users will be populated here -->
                    </tbody>
                </table>
            </div>
        </div>
    </div>
    
    <footer>
        <p>Air Purifier System | © 2025</p>
    </footer>

    <script>
        let authToken = localStorage.getItem('authToken');
        let currentUser = null;
        
        // Check authentication on page load
        document.addEventListener('DOMContentLoaded', function() {
            if (authToken) {
                verifyToken();
            } else {
                showLoginPage();
            }
            
            // Login form handler
            document.getElementById('login-form').addEventListener('submit', function(e) {
                e.preventDefault();
                login();
            });
            
            // Logout button handler
            document.getElementById('logout-btn').addEventListener('click', logout);
        });
        
        function showLoginPage() {
            document.getElementById('login-page').classList.remove('hidden');
            document.getElementById('app-content').classList.add('hidden');
        }
        
        function showAppContent() {
            document.getElementById('login-page').classList.add('hidden');
            document.getElementById('app-content').classList.remove('hidden');
        }
        
        function login() {
            const username = document.getElementById('username').value;
            const password = document.getElementById('password').value;
            
            fetch('https://www.airpurifier.electronicsideas.com/api/auth/login', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ username, password })
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Login failed');
                }
                return response.json();
            })
            .then(data => {
                authToken = data.token;
                localStorage.setItem('authToken', authToken);
                verifyToken();
            })
            .catch(error => {
                document.getElementById('login-message').textContent = 'Login failed. Please check your credentials.';
                console.error('Login error:', error);
            });
        }
        
        function verifyToken() {
            fetch('https://www.airpurifier.electronicsideas.com/api/auth/verify', {
                headers: {
                    'Authorization': 'Bearer ' + authToken
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Token verification failed');
                }
                return response.json();
            })
            .then(data => {
                currentUser = data.user;
                document.getElementById('user-greeting').textContent = 'Welcome, ' + currentUser.username;
                showAppContent();
                
                // Load user data if admin
                if (currentUser.is_admin) {
                    document.getElementById('admin-panel').classList.remove('hidden');
                    loadUsers();
                }
                
                // Load the main app data
                updateData();
            })
            .catch(error => {
                localStorage.removeItem('authToken');
                authToken = null;
                showLoginPage();
                console.error('Token verification error:', error);
            });
        }
        
        function logout() {
            localStorage.removeItem('authToken');
            authToken = null;
            currentUser = null;
            showLoginPage();
        }
        
        function loadUsers() {
            fetch('https://www.airpurifier.electronicsideas.com/api/users', {
                headers: {
                    'Authorization': 'Bearer ' + authToken
                }
            })
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to load users');
                }
                return response.json();
            })
            .then(data => {
                const usersTable = document.getElementById('users-table-body');
                usersTable.innerHTML = '';
                
                data.users.forEach(user => {
                    const row = document.createElement('tr');
                    row.innerHTML = `
                        <td>${user.username}</td>
                        <td>${user.is_admin ? 'Yes' : 'No'}</td>
                        <td>${new Date(user.created_at).toLocaleDateString()}</td>
                        <td>
                            <button onclick="editUser(${user.id})">Edit</button>
                            <button onclick="deleteUser(${user.id})" ${user.id === currentUser.id ? 'disabled' : ''}>Delete</button>
                        </td>
                    `;
                    usersTable.appendChild(row);
                });
            })
            .catch(error => {
                console.error('Error loading users:', error);
            });
        }
        // Current data
        let airQuality = 0;
        let fanState = )===== ";
        html += fanState ? "true" : "false";
        html += R"=====(;
        let autoMode = ")=====";
        html += autoMode;
        html += R"=====(";
        let historyData = [];

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
                fanStatusIndicator.style.color = '#27ae60';
            } else {
                fanBtn.classList.remove('active');
                fanBtnText.textContent = 'Turn ON';
                fanStatusIndicator.textContent = 'Fan is OFF';
                fanStatusIndicator.style.color = '#c0392b';
            }

            // Update mode button
            if (autoMode === 'ON') {
                modeBtn.classList.add('active');
                modeBtnText.textContent = 'Switch to Manual';
                modeStatusIndicator.textContent = 'Auto Mode Active';
                modeStatusIndicator.style.color = '#2980b9';
            } else {
                modeBtn.classList.remove('active');
                modeBtnText.textContent = 'Switch to Auto';
                modeStatusIndicator.textContent = 'Manual Mode Active';
                modeStatusIndicator.style.color = '#34495e';
            }

            document.getElementById('fan-status').innerHTML = fanState ?
                "<i class='fas fa-fan'></i> ON" : "<i class='fas fa-fan'></i> OFF";

            document.getElementById('auto-status').innerHTML = autoMode === 'ON' ?
                "<i class='fas fa-robot'></i> AUTO" : "<i class='fas fa-hand-pointer'></i> MANUAL";
        }

        // Update gauge
        function updateGauge(value) {
            const needle = document.getElementById('gauge-needle');
            const valueElement = document.getElementById('air-quality-value');

            // Map value to rotation (0-1000 PPM to 0-180 degrees)
            const rotation = Math.min(Math.max(value / 1000 * 180, 0), 180);
            needle.style.transform = `translateX(-50%) rotate(${rotation}deg)`;

            valueElement.textContent = Math.round(value) + ' PPM';

            // Update color based on value
            if (value < 300) {
                valueElement.style.color = '#2ecc71'; // Good
            } else if (value < 600) {
                valueElement.style.color = '#f39c12'; // Moderate
            } else {
                valueElement.style.color = '#e74c3c'; // Poor
            }
        }

        // Update chart
        function updateChart(value) {
            historyData.push(value);
            if (historyData.length > 20) {
                historyData.shift();
            }

            const chartContainer = document.getElementById('chart-container');
            chartContainer.innerHTML = '';

            const maxValue = Math.max(...historyData, 500);
            const barWidth = (chartContainer.offsetWidth - 20) / historyData.length;

            historyData.forEach((val, index) => {
                const bar = document.createElement('div');
                bar.className = 'chart-bar';
                bar.style.height = (val / maxValue * 180) + 'px';
                bar.style.left = (index * barWidth + 5) + 'px';
                bar.style.width = (barWidth - 2) + 'px';

                if (val < 300) {
                    bar.style.background = '#2ecc71'; // Good
                } else if (val < 600) {
                    bar.style.background = '#f39c12'; // Moderate
                } else {
                    bar.style.background = '#e74c3c'; // Poor
                }

                chartContainer.appendChild(bar);
            });
        }

        // Toggle fan
        function toggleFan() {
            const newState = !fanState;
            fetch('/control?fan=' + (newState ? 'on' : 'off'))
                .then(response => {
                    updateData();
                });
        }

        // Toggle mode
        function toggleMode() {
            const newMode = autoMode === 'ON' ? 'off' : 'on';
            fetch('/control?auto=' + newMode)
                .then(response => {
                    updateData();
                });
        }

        // Update threshold
        function updateThreshold(value) {
            document.getElementById('threshold-value').textContent = value;
            fetch('/settings?threshold=' + value);
        }

        // Update all data
        function updateData() {
            fetch('/data')
                .then(response => response.json())
                .then(data => {
                    airQuality = data.air_quality;
                    fanState = data.fan;
                    autoMode = data.auto_mode;

                    updateGauge(airQuality);
                    updateChart(airQuality);
                    updateButtonStates();
                });
        }

        // Set up event listeners
        document.addEventListener('DOMContentLoaded', function() {
            document.getElementById('toggle-fan').addEventListener('click', toggleFan);
            document.getElementById('toggle-mode').addEventListener('click', toggleMode);
            
            // Initial update
            updateData();
            updateButtonStates();
        });

        // Update data every 3 seconds
        setInterval(updateData, 3000);
    </script>
</body>

</html>
)=====";
    request->send(200, "text/html", html);
  });

  server.on("/control", HTTP_GET, [](AsyncWebServerRequest *request){
    // Handle control commands from the web interface
    if (request->hasParam("fan")) {
      String newState = request->getParam("fan")->value();
      if (newState == "on") {
        digitalWrite(RELAY_PIN, HIGH);
        fanState = true;
        autoMode = "OFF"; // Manual override disables auto mode
      } else if (newState == "off") {
        digitalWrite(RELAY_PIN, LOW);
        fanState = false;
        autoMode = "OFF";
      }
    }
    if (request->hasParam("auto")) {
      autoMode = request->getParam("auto")->value();
      autoMode.toUpperCase();
    }
    request->send(200, "text/plain", "OK");
  });

  server.on("/data", HTTP_GET, [](AsyncWebServerRequest *request){
    // API endpoint to get just the data (useful for AJAX or cloud logging)
    String json = "{\"air_quality\":" + String(air_quality) + ",\"fan\":" + String(fanState) + ",\"auto_mode\":\"" + autoMode + "\"}";
    request->send(200, "application/json", json);
  });

  server.on("/settings", HTTP_GET, [](AsyncWebServerRequest *request){
    // Handle settings changes
    if (request->hasParam("threshold")) {
      String threshold = request->getParam("threshold")->value();
      autoThreshold = threshold.toInt();
      Serial.println("Threshold updated to: " + String(autoThreshold));
    }
    request->send(200, "text/plain", "OK");
  });

  // Start the server
  server.begin();
  
  // Display initial system status
  display.clearDisplay();
  display.setTextSize(1);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(0, 0);
  display.println("System Ready!");
  display.print("Mode: ");
  display.println(autoMode);
  display.print("Fan: ");
  display.println(fanState ? "ON" : "OFF");
  if (wifiConnected) {
    display.print("IP: ");
    display.println(WiFi.localIP());
  } else {
    display.println("Network: Offline");
  }
  display.display();
}

void loop() {
  // 1. Read Sensor
  int sensorValue = analogRead(MQ135_PIN);
  // Convert analog read to PPM. NOTE: This requires calibration!
  // This is a simple approximation. For better accuracy, use the MQ135 library functions.
  air_quality = map(sensorValue, 0, 4095, 0, 1000); // Example mapping for ESP32's 12-bit ADC

  // 2. Automatic Control Logic
  if (autoMode == "ON") {
    if (air_quality > autoThreshold) { // Use the configurable threshold
      digitalWrite(RELAY_PIN, HIGH);
      fanState = true;
    } else if (air_quality < (autoThreshold - 100)) { // Hysteresis: 100 PPM below threshold
      digitalWrite(RELAY_PIN, LOW);
      fanState = false;
    }
  }

  // 3. Send data to backend periodically
  if (wifiConnected && millis() - lastDataSendTime > dataSendInterval) {
    sendDataToBackend(air_quality, fanState, autoMode == "ON");
    lastDataSendTime = millis();
    
    // Also update settings from backend occasionally
    if (random(0, 10) < 3) { // 30% chance to update settings each cycle
      getSettingsFromBackend();
    }
  }

  // 4. Update OLED Display with status bar
  display.clearDisplay();
  
  // Draw status bar at the top
  display.drawLine(0, 9, SCREEN_WIDTH, 9, SSD1306_WHITE);
  
  // Display WiFi status
  display.setCursor(0, 0);
  if (wifiConnected) {
    display.print("WiFi");
  } else {
    display.print("Off");
  }
  
  // Display fan status on the right
  display.setCursor(SCREEN_WIDTH - 20, 0);
  if (fanState) {
    display.print("F_ON");
  } else {
    display.print("F_OFF");
  }
  
  // Display mode in the center
  display.setCursor(SCREEN_WIDTH/2 - 12, 0);
  if (autoMode == "ON") {
    display.print("AUTO");
  } else {
    display.print("MAN");
  }
  
  // Display backend connection status
  display.setCursor(SCREEN_WIDTH - 40, 0);
  if (isAuthenticated) {
    display.print("B_OK");
  } else if (wifiConnected) {
    display.print("B_ERR");
  }
  
  // Display main data
  display.setTextSize(1);
  display.setCursor(0, 12);
  display.print("Air Quality: ");
  display.print(air_quality);
  display.println(" PPM");
  
  display.setCursor(0, 24);
  display.print("Fan: ");
  display.println(fanState ? "ON" : "OFF");
  
  display.setCursor(0, 36);
  display.print("Mode: ");
  display.println(autoMode);
  
  display.setCursor(0, 48);
  display.print("Threshold: ");
  display.print(autoThreshold);
  display.println(" PPM");
  
  if (wifiConnected) {
    display.setCursor(0, 56);
    display.print("IP: ");
    display.println(WiFi.localIP());
  }
  
  display.display();

  // 5. Add a delay between loops
  delay(2000); // Update every 2 seconds
}