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
  
  int httpResponseCode = http.POST(loginData);
  String response = http.getString();
  http.end();
  
  if (httpResponseCode == 200) {
    DynamicJsonDocument doc(1024);
    DeserializationError error = deserializeJson(doc, response);
    
    if (!error && doc.containsKey("token")) {
      jwtToken = doc["token"].as<String>();
      isAuthenticated = true;
      failedBackendAttempts = 0;
      lastSuccessfulCommunication = millis();
      Serial.println("✓ Authentication successful");
      return true;
    }
  }
  
  Serial.println("✗ Authentication failed: " + String(httpResponseCode));
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
  return true;
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

  // Web server setup (same as before)
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
    if (SPIFFS.exists("/index.html")) {
      request->send(SPIFFS, "/index.html", "text/html");
    } else {
      String html = "<html><body><h1>Air Purifier</h1><p>System running</p></body></html>";
      request->send(200, "text/html", html);
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

  server.begin();
  Serial.println("✓ Web server started");
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