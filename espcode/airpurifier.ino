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

// Backend configuration - Easy to switch between dev and production
// DEVELOPMENT: Use IP with HTTPS
const char* backendBaseURL = "https://172.20.10.2:3000";
// PRODUCTION: Just change to your domain:
// const char* backendBaseURL = "https://yourdomain.com";

const char* backendUsername = "esp32";
const char* backendPassword = "97e1f1d29342f21ddd1b2ec8";

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
unsigned long lastDataSendTime = 0;
const unsigned long dataSendInterval = 300000; // 5 minutes
unsigned long lastConnectionAttempt = 0;
const unsigned long connectionRetryInterval = 60000; // 1 minute

// Display
Adafruit_SSD1306* display = nullptr;
bool displayAvailable = false;

// Web server (HTTP only for local access)
AsyncWebServer server(80);

// Initialize display
bool initializeDisplay() {
  Wire.begin(OLED_SDA, OLED_SCL);
  delay(100);
  display = new Adafruit_SSD1306(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
  
  if (display && display->begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    displayAvailable = true;
    Serial.println("OLED display initialized successfully");
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

// HTTPS authentication without certificate verification
bool authenticateBackend() {
  if (!wifiConnected) {
    Serial.println("WiFi not connected");
    return false;
  }

  WiFiClientSecure client;
  
  // IMPORTANT: Skip certificate verification for development
  client.setInsecure(); // This allows connection without certificate validation
  
  HTTPClient http;
  String serverPath = String(backendBaseURL) + "/api/auth/login";
  Serial.println("Attempting HTTPS connection to: " + serverPath);
  
  // Begin HTTPS connection (insecure for development)
  http.begin(client, serverPath);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("User-Agent", "ESP32-AirPurifier/1.0");
  http.setTimeout(10000);
  
  String loginData = "{\"username\":\"" + String(backendUsername) + "\",\"password\":\"" + String(backendPassword) + "\"}";
  Serial.println("Sending HTTPS login request...");
  
  int httpResponseCode = http.POST(loginData);
  Serial.println("HTTPS Response code: " + String(httpResponseCode));
  
  if (httpResponseCode > 0) {
    if (httpResponseCode == 200) {
      String payload = http.getString();
      Serial.println("HTTPS Authentication successful");
      
      DynamicJsonDocument doc(1024);
      DeserializationError error = deserializeJson(doc, payload);
      
      if (!error && doc.containsKey("token")) {
        jwtToken = doc["token"].as<String>();
        isAuthenticated = true;
        Serial.println("JWT token received via HTTPS");
        http.end();
        return true;
      } else {
        Serial.println("JSON parsing failed");
      }
    } else {
      String payload = http.getString();
      Serial.println("Server response: " + payload);
    }
  } else {
    Serial.println("HTTPS connection failed: " + String(httpResponseCode));
    Serial.println("Error: " + http.errorToString(httpResponseCode));
  }
  
  http.end();
  return false;
}

// Send data to backend via HTTPS (insecure for development)
bool sendDataToBackend() {
  if (!isAuthenticated && !authenticateBackend()) {
    Serial.println("Failed to authenticate, cannot send data");
    return false;
  }

  WiFiClientSecure client;
  client.setInsecure(); // Skip certificate verification
  
  HTTPClient http;
  String serverPath = String(backendBaseURL) + "/api/readings";
  
  http.begin(client, serverPath);
  http.addHeader("Content-Type", "application/json");
  http.addHeader("Authorization", "Bearer " + jwtToken);
  http.addHeader("User-Agent", "ESP32-AirPurifier/1.0");
  http.setTimeout(10000);
  
  String postData = "{\"device_id\":\"esp32_air_purifier_01\",";
  postData += "\"input_air_quality\":" + String(input_air_quality) + ",";
  postData += "\"output_air_quality\":" + String(output_air_quality) + ",";
  postData += "\"efficiency\":" + String(efficiency) + ",";
  postData += "\"fan_state\":" + String(fanState ? "true" : "false") + ",";
  postData += "\"auto_mode\":" + String(autoMode == "ON" ? "true" : "false") + "}";
  
  Serial.println("Sending data via HTTPS (insecure mode)...");
  int httpResponseCode = http.POST(postData);
  
  if (httpResponseCode == 201) {
    Serial.println("✓ Data sent to backend successfully via HTTPS");
    http.end();
    return true;
  } else {
    Serial.println("✗ HTTPS data send failed. Code: " + String(httpResponseCode));
    if (httpResponseCode == 401) {
      jwtToken = "";
      isAuthenticated = false;
      Serial.println("Token invalid, need reauthentication");
    }
    http.end();
    return false;
  }
}

// Check basic internet connectivity
bool checkInternetConnection() {
  if (WiFi.status() != WL_CONNECTED) {
    wifiConnected = false;
    return false;
  }
  
  HTTPClient http;
  http.setTimeout(5000);
  
  // Simple HTTP test (no SSL needed for basic check)
  if (http.begin("http://www.google.com")) {
    int responseCode = http.GET();
    http.end();
    wifiConnected = (responseCode > 0);
    return wifiConnected;
  }
  
  http.end();
  return false;
}

// HTML processor for local web server
String processor(const String& var) {
  if (var == "SYSTEM_MODE") {
    return currentMode == ONLINE_MODE ? "online" : "offline";
  }
  else if (var == "INPUT_AIR_QUALITY") {
    return String(input_air_quality);
  }
  else if (var == "OUTPUT_AIR_QUALITY") {
    return String(output_air_quality);
  }
  else if (var == "EFFICIENCY") {
    return String(efficiency);
  }
  else if (var == "FAN_STATE") {
    return fanState ? "true" : "false";
  }
  else if (var == "AUTO_MODE") {
    return autoMode;
  }
  else if (var == "THRESHOLD_VALUE") {
    return String(autoThreshold);
  }
  return String();
}

void setup() {
  Serial.begin(115200);
  delay(2000);
  Serial.println("\n=== Air Purifier System Starting ===");
  Serial.println("HTTPS Mode: Insecure (Development)");
  Serial.println("Backend URL: " + String(backendBaseURL));

  // Initialize hardware
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW);
  Serial.println("Relay pin initialized");

  // Initialize display
  initializeDisplay();

  // Initialize SPIFFS
  SPIFFS.begin(true);

  // Read initial sensor values
  input_air_quality = readAirQuality(MQ135_INPUT_PIN);
  output_air_quality = readAirQuality(MQ135_OUTPUT_PIN);
  efficiency = calculateEfficiency(input_air_quality, output_air_quality);
  
  Serial.println("Initial Sensor Readings:");
  Serial.println("Input: " + String(input_air_quality) + " PPM");
  Serial.println("Output: " + String(output_air_quality) + " PPM");
  Serial.println("Efficiency: " + String(efficiency) + "%");

  // Connect to WiFi
  Serial.println("Connecting to WiFi: " + String(ssid));
  WiFi.begin(ssid, password);
  
  unsigned long wifiStartTime = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - wifiStartTime < 30000) {
    delay(1000);
    Serial.print(".");
  }

  if (WiFi.status() == WL_CONNECTED) {
    wifiConnected = true;
    Serial.println("\n✓ WiFi Connected! IP: " + WiFi.localIP().toString());
    
    // Check internet and authenticate with backend via HTTPS
    if (checkInternetConnection()) {
      Serial.println("✓ Internet connection OK");
      Serial.println("Attempting HTTPS authentication with backend...");
      
      if (authenticateBackend()) {
        currentMode = ONLINE_MODE;
        Serial.println("✓ Backend authentication successful - ONLINE MODE");
        Serial.println("✓ Using HTTPS (insecure mode for development)");
      } else {
        currentMode = OFFLINE_MODE;
        Serial.println("✗ Backend authentication failed - OFFLINE MODE");
      }
    } else {
      currentMode = OFFLINE_MODE;
      Serial.println("✗ No internet connection - OFFLINE MODE");
    }
  } else {
    currentMode = OFFLINE_MODE;
    Serial.println("✗ WiFi connection failed - OFFLINE MODE");
  }

  // Setup local web server (HTTP only - for local network access)
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
    if (SPIFFS.exists("/index.html")) {
      request->send(SPIFFS, "/index.html", "text/html", false, processor);
    } else {
      String html = "<html><body><h1>Air Purifier Control Panel</h1>";
      html += "<p><strong>Mode:</strong> " + String(currentMode == ONLINE_MODE ? "ONLINE (HTTPS)" : "OFFLINE") + "</p>";
      html += "<p><strong>Backend:</strong> " + String(backendBaseURL) + "</p>";
      html += "<p><strong>Local IP:</strong> " + WiFi.localIP().toString() + "</p>";
      html += "<p><strong>Input Air Quality:</strong> " + String(input_air_quality) + " PPM</p>";
      html += "<p><strong>Output Air Quality:</strong> " + String(output_air_quality) + " PPM</p>";
      html += "</body></html>";
      request->send(200, "text/html", html);
    }
  });

  server.on("/style.css", HTTP_GET, [](AsyncWebServerRequest *request){
    request->send(SPIFFS, "/style.css", "text/css");
  });

  server.on("/script.js", HTTP_GET, [](AsyncWebServerRequest *request){
    request->send(SPIFFS, "/script.js", "text/javascript");
  });

  // API endpoint for local data access
  server.on("/data", HTTP_GET, [](AsyncWebServerRequest *request){
    String json = "{";
    json += "\"system_mode\":\"" + String(currentMode == ONLINE_MODE ? "online" : "offline") + "\",";
    json += "\"input_air_quality\":" + String(input_air_quality) + ",";
    json += "\"output_air_quality\":" + String(output_air_quality) + ",";
    json += "\"efficiency\":" + String(efficiency) + ",";
    json += "\"fan\":" + String(fanState) + ",";
    json += "\"auto_mode\":\"" + autoMode + "\",";
    json += "\"backend_url\":\"" + String(backendBaseURL) + "\"";
    json += "}";
    request->send(200, "application/json", json);
  });

  // Control endpoints
  server.on("/control", HTTP_GET, [](AsyncWebServerRequest *request){
    if (request->hasParam("fan")) {
      String newState = request->getParam("fan")->value();
      fanState = (newState == "on");
      digitalWrite(RELAY_PIN, fanState ? HIGH : LOW);
      autoMode = "OFF";
      Serial.println("Fan " + String(fanState ? "ON" : "OFF") + " (manual control)");
    }
    if (request->hasParam("auto")) {
      autoMode = request->getParam("auto")->value();
      Serial.println("Auto mode: " + autoMode);
    }
    if (request->hasParam("threshold")) {
      autoThreshold = request->getParam("threshold")->value().toInt();
      Serial.println("Threshold: " + String(autoThreshold));
    }
    request->send(200, "text/plain", "OK");
  });

  server.begin();
  Serial.println("✓ Local web server started (HTTP on port 80)");
  Serial.println("✓ Access via: http://" + WiFi.localIP().toString());
  Serial.println("=== System Ready ===");

  // Display initial status
  if (displayAvailable) {
    display->clearDisplay();
    display->setTextSize(1);
    display->setCursor(0, 0);
    display->println("Air Purifier Ready");
    display->print("Mode: ");
    display->println(currentMode == ONLINE_MODE ? "ONLINE" : "OFFLINE");
    display->print("Backend: ");
    display->println(backendBaseURL);
    display->display();
  }
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
    } else if (input_air_quality < (autoThreshold - 100)) {
      digitalWrite(RELAY_PIN, LOW);
      fanState = false;
    }
  }

  // Try to reconnect to backend periodically
  if (millis() - lastConnectionAttempt > connectionRetryInterval) {
    if (WiFi.status() == WL_CONNECTED && checkInternetConnection()) {
      if (authenticateBackend()) {
        currentMode = ONLINE_MODE;
        Serial.println("✓ Reconnected to backend via HTTPS");
      } else {
        currentMode = OFFLINE_MODE;
        Serial.println("✗ Backend unavailable");
      }
    } else {
      currentMode = OFFLINE_MODE;
      wifiConnected = false;
    }
    lastConnectionAttempt = millis();
  }

  // Send data to backend via HTTPS if online
  if (currentMode == ONLINE_MODE && millis() - lastDataSendTime > dataSendInterval) {
    if (sendDataToBackend()) {
      lastDataSendTime = millis();
      Serial.println("✓ Data sent to cloud database via HTTPS");
    } else {
      currentMode = OFFLINE_MODE;
      Serial.println("✗ HTTPS data send failed");
    }
  }

  delay(2000);
}