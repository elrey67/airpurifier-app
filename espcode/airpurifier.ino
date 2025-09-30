#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>
#include <MQ135.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <WiFiClientSecure.h>
#include <SPIFFS.h>

// Define pins
#define RELAY_PIN 13
#define MQ135_INPUT_PIN 36
#define MQ135_OUTPUT_PIN 39
#define SCREEN_WIDTH 128
#define SCREEN_HEIGHT 64
#define OLED_SDA 21
#define OLED_SCL 22

// WiFi credentials
const char* ssid = "Duke1";
const char* password = "estaunbuendia";

// Backend configuration
const char* backendBaseURL = "https://172.20.10.2:3000";
const char* backendUsername = "esp32";
const char* backendPassword = "663c36dd509c03bd04fad8be";

// System states
enum SystemMode { ONLINE_MODE, OFFLINE_MODE };
SystemMode currentMode = OFFLINE_MODE;

// Sensor variables
float input_air_quality = 0.0;
float output_air_quality = 0.0;
float efficiency = 0.0;
bool fanState = false;
String autoMode = "ON";
int autoThreshold = 300;

// Network variables
bool wifiConnected = false;
String jwtToken = "";
bool isAuthenticated = false;

// Enhanced timing variables
unsigned long lastDataSendTime = 0;
const unsigned long dataSendInterval = 5000; // Increased to 5 seconds
unsigned long lastDataFetchTime = 0;
const unsigned long dataFetchInterval = 5000; // Increased to 5 seconds
unsigned long lastConnectionAttempt = 0;
const unsigned long connectionRetryInterval = 30000; // 30 seconds
unsigned long lastWiFiCheck = 0;
const unsigned long wifiCheckInterval = 10000; // Check WiFi every 10 seconds
unsigned long lastMemoryCheck = 0;
const unsigned long memoryCheckInterval = 60000; // Check memory every minute

// Connection stability
int failedBackendAttempts = 0;
const int maxFailedAttempts = 3;
unsigned long lastSuccessfulCommunication = 0;

// Display
Adafruit_SSD1306 display(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
bool displayAvailable = false;

// Web server
AsyncWebServer server(80);

// Initialize display - FIXED: Use static allocation
bool initializeDisplay() {
  Wire.begin(OLED_SDA, OLED_SCL);
  delay(100);
  
  if (display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    displayAvailable = true;
    Serial.println("OLED display initialized successfully");
    
    // Show startup message
    display.clearDisplay();
    display.setTextSize(1);
    display.setTextColor(SSD1306_WHITE);
    display.setCursor(0, 0);
    display.println("Air Purifier");
    display.println("Starting...");
    display.display();
    
    return true;
  } else {
    Serial.println("OLED display initialization failed");
    displayAvailable = false;
    return false;
  }
}

// Simple sensor reading
float readAirQuality(int sensorPin) {
  int analogValue = analogRead(sensorPin);
  float voltage = analogValue * (3.3 / 4095.0);
  float ppm = (voltage / 3.3) * 2000;
  return constrain(ppm, 0, 2000);
}

float calculateEfficiency(float inputPPM, float outputPPM) {
  if (inputPPM <= 0 || outputPPM >= inputPPM) return 0.0;
  return ((inputPPM - outputPPM) / inputPPM) * 100.0;
}

// Enhanced WiFi connection with retry logic
bool ensureWiFiConnection() {
  if (WiFi.status() == WL_CONNECTED) {
    return true;
  }
  
  Serial.println("WiFi disconnected. Attempting to reconnect...");
  WiFi.disconnect();
  delay(1000);
  
  WiFi.begin(ssid, password);
  unsigned long startTime = millis();
  
  while (WiFi.status() != WL_CONNECTED && millis() - startTime < 15000) {
    delay(500);
    Serial.print(".");
  }
  
  if (WiFi.status() == WL_CONNECTED) {
    Serial.println("\n✓ WiFi reconnected! IP: " + WiFi.localIP().toString());
    wifiConnected = true;
    return true;
  } else {
    Serial.println("\n✗ WiFi reconnection failed");
    wifiConnected = false;
    currentMode = OFFLINE_MODE;
    return false;
  }
}

// Enhanced backend connection check
bool checkBackendConnection() {
  if (!ensureWiFiConnection()) {
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(5000);
  
  HTTPClient http;
  http.setReuse(true); // Reuse connection
  
  String serverPath = String(backendBaseURL) + "/api/health"; // Add a health endpoint
  
  http.begin(client, serverPath);
  http.setTimeout(5000);
  
  int httpResponseCode = http.GET();
  http.end();
  
  bool connectionOK = (httpResponseCode == 200 || httpResponseCode == 401);
  
  if (connectionOK) {
    failedBackendAttempts = 0;
    lastSuccessfulCommunication = millis();
  } else {
    failedBackendAttempts++;
    Serial.println("Backend connection failed. Attempt: " + String(failedBackendAttempts));
  }
  
  return connectionOK;
}

// Enhanced authentication with cleanup
bool authenticateBackend() {
  if (!ensureWiFiConnection()) {
    return false;
  }

  // Clear previous authentication if too many failures
  if (failedBackendAttempts > maxFailedAttempts) {
    jwtToken = "";
    isAuthenticated = false;
  }

  Serial.println("🔐 Attempting authentication...");

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(5000);
  
  HTTPClient http;
  http.setReuse(true);
  
  String serverPath = String(backendBaseURL) + "/api/auth/login";
  
  http.begin(client, serverPath);
  http.addHeader("Content-Type", "application/json");
  http.setTimeout(5000);
  
  String loginData = "{\"username\":\"" + String(backendUsername) + "\",\"password\":\"" + String(backendPassword) + "\"}";
  
  Serial.println("📤 Sending login request...");
  int httpResponseCode = http.POST(loginData);
  String response = http.getString();
  http.end();
  
  Serial.println("📨 Auth Response Code: " + String(httpResponseCode));
  Serial.println("📨 Auth Response Body: " + response);
  
  if (httpResponseCode == 200) {
    DynamicJsonDocument doc(2048);
    DeserializationError error = deserializeJson(doc, response);
    
    if (error) {
      Serial.println("❌ JSON Parse Error: " + String(error.c_str()));
      failedBackendAttempts++;
      return false;
    }
    
    // Try both "token" and "accessToken" keys
    if (doc.containsKey("token")) {
      jwtToken = doc["token"].as<String>();
    } else if (doc.containsKey("accessToken")) {
      jwtToken = doc["accessToken"].as<String>();
    } else {
      Serial.println("❌ No token found in response");
      Serial.println("Available keys:");
      JsonObject obj = doc.as<JsonObject>();
      for (JsonPair kv : obj) {
        Serial.println("  - " + String(kv.key().c_str()));
      }
      failedBackendAttempts++;
      return false;
    }
    
    isAuthenticated = true;
    failedBackendAttempts = 0;
    lastSuccessfulCommunication = millis();
    Serial.println("✅ Authentication successful!");
    Serial.println("🔑 Token: " + jwtToken.substring(0, 20) + "...");
    return true;
  }
  
  Serial.println("❌ Authentication failed with code: " + String(httpResponseCode));
  failedBackendAttempts++;
  return false;
}
// Enhanced data sending with memory management
bool sendDataToBackend() {
  if (!isAuthenticated && !authenticateBackend()) {
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure();
  client.setTimeout(5000);
  
  HTTPClient http;
  http.setReuse(true);
  
  String serverPath = String(backendBaseURL) + "/api/readings";
  
  http.begin(client, serverPath);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + jwtToken);
  http.setTimeout(5000);
  
  // Use StaticJsonDocument for better memory management
  StaticJsonDocument<512> doc;
  doc["device_id"] = "esp32_air_purifier_01";
  doc["system_mode"] = currentMode == ONLINE_MODE ? "online" : "offline";
  doc["input_air_quality"] = input_air_quality;
  doc["output_air_quality"] = output_air_quality;
  doc["efficiency"] = efficiency;
  doc["fan_state"] = fanState;
  doc["auto_mode"] = autoMode == "ON";
  
  String postData;
  serializeJson(doc, postData);
  
  int httpResponseCode = http.POST(postData);
  http.end();
  
  if (httpResponseCode == 201) {
    failedBackendAttempts = 0;
    lastSuccessfulCommunication = millis();
    return true;
  } else {
    if (httpResponseCode == 401) {
      jwtToken = "";
      isAuthenticated = false;
    }
    failedBackendAttempts++;
    return false;
  }
}

// Memory monitoring function
void checkMemory() {
  Serial.printf("Free heap: %d bytes\n", ESP.getFreeHeap());
  Serial.printf("Min free heap: %d bytes\n", ESP.getMinFreeHeap());
  Serial.printf("Max alloc heap: %d bytes\n", ESP.getMaxAllocHeap());
}

// Initialize SPIFFS
bool initializeSPIFFS() {
  if(!SPIFFS.begin(true)){
    Serial.println("SPIFFS mount failed");
    return false;
  }
  Serial.println("✓ SPIFFS initialized successfully");
  return true;
}

// Debug function to list SPIFFS files
void listSPIFFSFiles() {
  Serial.println("=== SPIFFS File List ===");
  File root = SPIFFS.open("/");
  File file = root.openNextFile();
  
  while(file) {
    Serial.print("FILE: ");
    Serial.print(file.name());
    Serial.print(" SIZE: ");
    Serial.println(file.size());
    file = root.openNextFile();
  }
  Serial.println("=== End of SPIFFS List ===");
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== Air Purifier System Starting ===");
  Serial.println("⚡ ENHANCED STABILITY VERSION");

  // Initialize hardware
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);

  // Initialize display
  initializeDisplay();

  // Initialize SPIFFS
  if (!initializeSPIFFS()) {
    Serial.println("Failed to initialize SPIFFS");
  } else {
    listSPIFFSFiles(); // Debug: List all files in SPIFFS
  }

  // Read initial sensor values
  input_air_quality = readAirQuality(MQ135_INPUT_PIN);
  output_air_quality = readAirQuality(MQ135_OUTPUT_PIN);
  efficiency = calculateEfficiency(input_air_quality, output_air_quality);

  // Connect to WiFi with enhanced logic
  Serial.println("Connecting to WiFi: " + String(ssid));
  WiFi.setAutoReconnect(true);
  WiFi.persistent(true);
  
  WiFi.begin(ssid, password);
  
  unsigned long wifiStartTime = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStartTime < 20000) {
    delay(1000);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println("\n✓ WiFi Connected! IP: " + WiFi.localIP().toString());
    
    // Try backend connection but don't block startup
    if (checkBackendConnection() && authenticateBackend()) {
      currentMode = ONLINE_MODE;
      Serial.println("✓ Backend connection established - ONLINE MODE");
    } else {
      currentMode = OFFLINE_MODE;
      Serial.println("✗ Backend connection failed - OFFLINE MODE");
    }
  } else {
    currentMode = OFFLINE_MODE;
    Serial.println("✗ WiFi connection failed - OFFLINE MODE");
  }

  // Enhanced Web server setup with CSS and JS support
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
    if (SPIFFS.exists("/index.html")) {
      request->send(SPIFFS, "/index.html", "text/html");
    } else {
      String html = "<!DOCTYPE html><html><head><title>Air Purifier</title>";
      html += "<meta name='viewport' content='width=device-width, initial-scale=1'>";
      html += "<style>body{font-family:Arial,sans-serif;margin:20px;background:#f0f0f0;}";
      html += ".container{max-width:800px;margin:0 auto;background:white;padding:20px;border-radius:8px;}";
      html += ".status{display:flex;justify-content:space-between;margin:10px 0;}";
      html += ".value{font-weight:bold;}</style></head>";
      html += "<body><div class='container'><h1>Air Purifier System</h1>";
      html += "<div class='status'>System Status: <span id='status'>Loading...</span></div>";
      html += "<div class='status'>Input Air Quality: <span id='input'>--</span> PPM</div>";
      html += "<div class='status'>Output Air Quality: <span id='output'>--</span> PPM</div>";
      html += "<div class='status'>Efficiency: <span id='efficiency'>--</span>%</div>";
      html += "<div class='status'>Fan Status: <span id='fan'>--</span></div>";
      html += "</div><script>function updateData(){fetch('/data').then(r=>r.json()).then(d=>{";
      html += "document.getElementById('status').textContent=d.system_mode;";
      html += "document.getElementById('input').textContent=d.input_air_quality.toFixed(1);";
      html += "document.getElementById('output').textContent=d.output_air_quality.toFixed(1);";
      html += "document.getElementById('efficiency').textContent=d.efficiency.toFixed(1);";
      html += "document.getElementById('fan').textContent=d.fan?'ON':'OFF';";
      html += "}).catch(e=>console.error('Error:',e));}setInterval(updateData,5000);updateData();</script></body></html>";
      request->send(200, "text/html", html);
    }
  });

  // Add route for CSS file
  server.on("/style.css", HTTP_GET, [](AsyncWebServerRequest *request){
    if (SPIFFS.exists("/style.css")) {
      request->send(SPIFFS, "/style.css", "text/css");
    } else {
      // Fallback CSS if file doesn't exist
      String css = "body { font-family: Arial, sans-serif; margin: 20px; background: #f0f0f0; }";
      css += "h1 { color: #333; }";
      css += ".container { max-width: 800px; margin: 0 auto; background: white; padding: 20px; border-radius: 8px; }";
      css += ".status { display: flex; justify-content: space-between; margin: 10px 0; }";
      css += ".value { font-weight: bold; }";
      request->send(200, "text/css", css);
    }
  });

  // Add route for JavaScript file
  server.on("/script.js", HTTP_GET, [](AsyncWebServerRequest *request){
    if (SPIFFS.exists("/script.js")) {
      request->send(SPIFFS, "/script.js", "application/javascript");
    } else {
      // Fallback JavaScript if file doesn't exist
      String js = "function updateData() {";
      js += "  fetch('/data')";
      js += "    .then(response => response.json())";
      js += "    .then(data => {";
      js += "      console.log('Data received:', data);";
      js += "      document.getElementById('status').textContent = data.system_mode;";
      js += "      document.getElementById('input').textContent = data.input_air_quality.toFixed(1);";
      js += "      document.getElementById('output').textContent = data.output_air_quality.toFixed(1);";
      js += "      document.getElementById('efficiency').textContent = data.efficiency.toFixed(1);";
      js += "      document.getElementById('fan').textContent = data.fan ? 'ON' : 'OFF';";
      js += "    })";
      js += "    .catch(error => console.error('Error:', error));";
      js += "}";
      js += "setInterval(updateData, 5000);"; // Update every 5 seconds
      js += "updateData();"; // Initial call
      request->send(200, "application/javascript", js);
    }
  });

  // Generic static file handler for other assets
  server.onNotFound([](AsyncWebServerRequest *request){
    String path = request->url();
    
    // Check if it's a static file request
    if (path.endsWith(".css") || path.endsWith(".js") || path.endsWith(".ico") || 
        path.endsWith(".png") || path.endsWith(".jpg") || path.endsWith(".gif")) {
      
      if (SPIFFS.exists(path)) {
        String contentType = "text/plain";
        
        if (path.endsWith(".css")) contentType = "text/css";
        else if (path.endsWith(".js")) contentType = "application/javascript";
        else if (path.endsWith(".ico")) contentType = "image/x-icon";
        else if (path.endsWith(".png")) contentType = "image/png";
        else if (path.endsWith(".jpg") || path.endsWith(".jpeg")) contentType = "image/jpeg";
        else if (path.endsWith(".gif")) contentType = "image/gif";
        
        request->send(SPIFFS, path, contentType);
      } else {
        request->send(404, "text/plain", "File not found: " + path);
      }
    } else {
      request->send(404, "text/plain", "Page not found: " + path);
    }
  });

  server.on("/data", HTTP_GET, [](AsyncWebServerRequest *request){
    String json = "{";
    json += "\"system_mode\":\"" + String(currentMode == ONLINE_MODE ? "online" : "offline") + "\",";
    json += "\"input_air_quality\":" + String(input_air_quality) + ",";
    json += "\"output_air_quality\":" + String(output_air_quality) + ",";
    json += "\"efficiency\":" + String(efficiency) + ",";
    json += "\"fan\":" + String(fanState) + ",";
    json += "\"auto_mode\":\"" + autoMode + "\",";
    json += "\"threshold\":" + String(autoThreshold) + ",";
    json += "\"wifi_status\":" + String(WiFi.status() == WL_CONNECTED ? "true" : "false") + ",";
    json += "\"backend_status\":" + String(currentMode == ONLINE_MODE ? "true" : "false");
    json += "}";
    request->send(200, "application/json", json);
  });

  // Add control endpoints
  server.on("/control/fan", HTTP_POST, [](AsyncWebServerRequest *request){
    if (request->hasParam("state", true)) {
      String state = request->getParam("state", true)->value();
      fanState = (state == "on" || state == "1" || state == "true");
      digitalWrite(RELAY_PIN, fanState ? HIGH : LOW);
      request->send(200, "application/json", "{\"status\":\"success\",\"fan_state\":" + String(fanState) + "}");
    } else {
      request->send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing state parameter\"}");
    }
  });

  server.on("/control/auto", HTTP_POST, [](AsyncWebServerRequest *request){
    if (request->hasParam("mode", true)) {
      autoMode = request->getParam("mode", true)->value();
      autoMode.toUpperCase();
      if (autoMode != "ON" && autoMode != "OFF") autoMode = "ON";
      request->send(200, "application/json", "{\"status\":\"success\",\"auto_mode\":\"" + autoMode + "\"}");
    } else {
      request->send(400, "application/json", "{\"status\":\"error\",\"message\":\"Missing mode parameter\"}");
    }
  });

  // Add CORS headers for better compatibility
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Origin", "*");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE");
  DefaultHeaders::Instance().addHeader("Access-Control-Allow-Headers", "Content-Type");

  server.begin();
  Serial.println("✓ Web server started with static file support");
  checkMemory(); // Initial memory check
}

void loop() {
  // Read sensors
  input_air_quality = readAirQuality(MQ135_INPUT_PIN);
  output_air_quality = readAirQuality(MQ135_OUTPUT_PIN);
  efficiency = calculateEfficiency(input_air_quality, output_air_quality);

  // Auto control logic
  if (autoMode == "ON") {
    if (input_air_quality > autoThreshold) {
      digitalWrite(RELAY_PIN, HIGH);
      fanState = true;
    } else if (input_air_quality < (autoThreshold - 50)) {
      digitalWrite(RELAY_PIN, LOW);
      fanState = false;
    }
  }

  // Enhanced connection management
  unsigned long currentTime = millis();

  // Check WiFi status regularly
  if (currentTime - lastWiFiCheck > wifiCheckInterval) {
    if (WiFi.status() != WL_CONNECTED) {
      Serial.println("WiFi connection lost - attempting reconnect");
      ensureWiFiConnection();
    }
    lastWiFiCheck = currentTime;
  }

  // Check memory usage
  if (currentTime - lastMemoryCheck > memoryCheckInterval) {
    checkMemory();
    lastMemoryCheck = currentTime;
  }

  // Backend communication logic
  if (currentMode == ONLINE_MODE) {
    // If too many failures, switch to offline mode
    if (failedBackendAttempts > maxFailedAttempts) {
      currentMode = OFFLINE_MODE;
      Serial.println("Too many backend failures - Switching to OFFLINE MODE");
    }
    // If no successful communication for a long time, try reauthentication
    else if (currentTime - lastSuccessfulCommunication > 120000) { // 2 minutes
      Serial.println("No successful communication for 2 minutes - reauthenticating");
      isAuthenticated = false;
    }

    // Send data to backend
    if (currentTime - lastDataSendTime > dataSendInterval) {
      if (sendDataToBackend()) {
        lastDataSendTime = currentTime;
        Serial.println("✓ Data sent to backend");
      } else {
        Serial.println("✗ Failed to send data to backend");
      }
    }
  } else { // OFFLINE MODE - try to reconnect periodically
    if (currentTime - lastConnectionAttempt > connectionRetryInterval) {
      Serial.println("Attempting to reconnect to backend...");
      if (ensureWiFiConnection() && checkBackendConnection() && authenticateBackend()) {
        currentMode = ONLINE_MODE;
        failedBackendAttempts = 0;
        Serial.println("✓ Reconnected to backend - ONLINE MODE");
      }
      lastConnectionAttempt = currentTime;
    }
  }

  // Update display
  if (displayAvailable) {
    display.clearDisplay();
    display.setCursor(0, 0);
    display.println("AIR PURIFIER");
    display.print("Mode: ");
    display.println(currentMode == ONLINE_MODE ? "ONLINE" : "OFFLINE");
    display.print("In: ");
    display.print(input_air_quality, 0);
    display.println(" PPM");
    display.print("Out: ");
    display.print(output_air_quality, 0);
    display.println(" PPM");
    display.print("Eff: ");
    display.print(efficiency, 0);
    display.println("%");
    display.print("Fan: ");
    display.println(fanState ? "ON" : "OFF");
    display.print("WiFi: ");
    display.println(WiFi.status() == WL_CONNECTED ? "OK" : "OFF");
    display.display();
  }

  delay(1000); // 1 second delay for stability
}