#include <WiFi.h>
#include <AsyncTCP.h>
#include <ESPAsyncWebServer.h>
#include <Adafruit_SSD1306.h>
#include <Adafruit_GFX.h>
#include <MQ135.h>
#include <ArduinoJson.h>
#include <HTTPClient.h>
#include <SPIFFS.h>

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
const char* backendBaseURL = "http://172.20.10.2:3000";
const char* backendUsername = "esp32";
const char* backendPassword = "f3c9a7d6c2aa6e1f92419049";

// MQ135 calibration parameters
#define RZERO 76.63  // Calibration resistance at atmospheric CO2 level
#define RLOAD 10.0   // Load resistance on the board in kOhms

// Sensor & System variables
MQ135 mq135_sensor(MQ135_PIN);
float air_quality = 0.0;
bool fanState = false;
String autoMode = "ON"; // Default to automatic control
bool wifiConnected = false;
int connectionAttempts = 0;
const int maxConnectionAttempts = 10;
int autoThreshold = 300; // Default threshold

// Environmental parameters for correction
float temperature = 21.0;
float humidity = 45.0;

// JWT Authentication variables
String jwtToken = "";
unsigned long tokenExpiry = 0;
bool isAuthenticated = false;
unsigned long lastDataSendTime = 0;
const unsigned long dataSendInterval = 300000; // 5 minutes

// OLED Display object - Initialize as null pointer first
Adafruit_SSD1306* display = nullptr;
bool displayAvailable = false;

// Create AsyncWebServer object on port 80
AsyncWebServer server(80);

// Function to safely initialize display
bool initializeDisplay() {
  // Initialize I2C first
  Wire.begin(OLED_SDA, OLED_SCL);
  delay(100);
  
  // Create display object
  display = new Adafruit_SSD1306(SCREEN_WIDTH, SCREEN_HEIGHT, &Wire, -1);
  
  // Try to initialize
  if (display && display->begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    display->clearDisplay();
    display->setTextSize(1);
    display->setTextColor(SSD1306_WHITE);
    display->setCursor(0, 0);
    display->println("Display OK");
    display->display();
    displayAvailable = true;
    Serial.println("OLED display initialized successfully");
    return true;
  } else {
    Serial.println("OLED display initialization failed");
    if (display) {
      delete display;
      display = nullptr;
    }
    displayAvailable = false;
    return false;
  }
}

// Function to display text on OLED with safety checks
void displayText(String text, int textSize = 1, int cursorX = 0, int cursorY = 0, bool clear = true) {
  if (!displayAvailable || !display) {
    Serial.println("Display: " + text);
    return;
  }
  
  if (clear) {
    display->clearDisplay();
  }
  display->setTextSize(textSize);
  display->setTextColor(SSD1306_WHITE);
  display->setCursor(cursorX, cursorY);
  display->println(text);
  display->display();
}

// Function to display a progress bar with safety checks
void displayProgressBar(int progress, int total, String label = "") {
  if (!displayAvailable || !display) {
    int percent = (progress * 100) / total;
    Serial.println(label + ": " + String(percent) + "%");
    return;
  }
  
  display->clearDisplay();
  display->setTextSize(1);
  display->setTextColor(SSD1306_WHITE);
  
  if (label != "") {
    display->setCursor(0, 0);
    display->println(label);
  }
  
  // Draw progress bar
  int barWidth = SCREEN_WIDTH - 4;
  int barHeight = 8;
  int barX = 2;
  int barY = SCREEN_HEIGHT - barHeight - 2;
  
  // Border
  display->drawRect(barX, barY, barWidth, barHeight, SSD1306_WHITE);
  
  // Fill
  int fillWidth = (progress * barWidth) / total;
  display->fillRect(barX, barY, fillWidth, barHeight, SSD1306_WHITE);
  
  // Percentage text
  int percent = (progress * 100) / total;
  display->setCursor(SCREEN_WIDTH/2 - 10, barY - 10);
  display->print(percent);
  display->print("%");
  
  display->display();
}

// Function to read corrected air quality from MQ135
float readCorrectedPPM() {
  // Read the analog value
  int analogValue = analogRead(MQ135_PIN);
  
  // Calculate the voltage
  float voltage = analogValue * (3.3 / 4095.0);
  
  // Prevent division by zero
  if (voltage >= 3.3) {
    voltage = 3.29; // Slightly less than 3.3 to avoid division issues
  }
  
  // Calculate the sensor resistance
  float rs = (3.3 - voltage) / voltage * RLOAD;
  
  // Calculate the corrected resistance based on temperature and humidity
  float correctedR0 = RZERO * exp(-0.005 * (temperature - 20.0)) * (1.0 - 0.0005 * (humidity - 30.0));
  
  // Prevent division by zero
  if (correctedR0 <= 0) {
    correctedR0 = RZERO;
  }
  
  // Calculate the PPM value (using the formula from the MQ135 datasheet for CO2)
  float ratio = rs / correctedR0;
  float ppm = 116.6020682 * pow(ratio, -2.769034857);
  
  // Clamp the value to a reasonable range and check for NaN
  if (isnan(ppm) || isinf(ppm)) {
    ppm = 400; // Default reasonable air quality value
  }
  ppm = constrain(ppm, 0, 2000);
  
  return ppm;
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

// Processor for HTML templates
String processor(const String& var) {
  if (var == "WIFI_STATUS") {
    return wifiConnected ? "<i class='fas fa-wifi'></i> Connected" : "<i class='fas fa-exclamation-triangle'></i> Offline";
  }
  else if (var == "FAN_STATUS") {
    return fanState ? "<i class='fas fa-fan'></i> ON" : "<i class='fas fa-fan'></i> OFF";
  }
  else if (var == "AUTO_STATUS") {
    return autoMode == "ON" ? "<i class='fas fa-robot'></i> AUTO" : "<i class='fas fa-hand-pointer'></i> MANUAL";
  }
  else if (var == "THRESHOLD_VALUE") {
    return String(autoThreshold);
  }
  else if (var == "FAN_STATE") {
    return fanState ? "true" : "false";
  }
  else if (var == "AUTO_MODE") {
    return autoMode;
  }
  return String();
}

void setup() {
  Serial.begin(115200);
  
  // Wait for serial to be ready
  delay(2000);
  Serial.println("\n=== Air Purifier System Starting ===");

  // Initialize Relay Pin first (most important)
  pinMode(RELAY_PIN, OUTPUT);
  digitalWrite(RELAY_PIN, LOW); // Start with fan OFF
  Serial.println("Relay pin initialized");

  // Try to initialize OLED display (non-blocking)
  Serial.println("Attempting to initialize OLED display...");
  if (!initializeDisplay()) {
    Serial.println("Warning: OLED display not available, continuing without display");
  }

  // Initialize SPIFFS (optional, continue if it fails)
  if (!SPIFFS.begin(true)) {
    Serial.println("Warning: SPIFFS initialization failed, web files may not work");
  } else {
    Serial.println("SPIFFS initialized successfully");
  }

  // Calibrate MQ135 sensor
  displayText("Calibrating MQ135...", 1, 0, 0);
  Serial.println("Calibrating MQ135 sensor...");
  delay(2000);
  
  // Read multiple samples for initial calibration
  float sum = 0;
  int validSamples = 0;
  for (int i = 0; i < 10; i++) {
    float sample = readCorrectedPPM();
    if (!isnan(sample) && sample > 0 && sample < 2000) {
      sum += sample;
      validSamples++;
    }
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  
  if (validSamples > 0) {
    air_quality = sum / validSamples;
  } else {
    air_quality = 400; // Default value
  }
  Serial.println("Initial calibration: " + String(air_quality) + " PPM");

  // Connect to WiFi with visual feedback
  displayText("Connecting to WiFi...", 1, 0, 0);
  Serial.println("Connecting to WiFi...");
  
  WiFi.begin(ssid, password);
  
  while (WiFi.status() != WL_CONNECTED && connectionAttempts < maxConnectionAttempts) {
    connectionAttempts++;
    displayProgressBar(connectionAttempts, maxConnectionAttempts, "Connecting to WiFi");
    Serial.print(".");
    delay(1000);
  }
  Serial.println();
  
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
  } else {
    displayText("WiFi Failed!\nRunning locally.", 1, 0, 0);
    Serial.println("WiFi connection failed, running in local mode");
    delay(2000);
  }

  // Initialize Web Server Routes
  server.on("/", HTTP_GET, [](AsyncWebServerRequest *request){
    if (SPIFFS.exists("/index.html")) {
      request->send(SPIFFS, "/index.html", "text/html", false, processor);
    } else {
      request->send(200, "text/html", "<html><body><h1>Air Purifier</h1><p>Air Quality: " + String(air_quality) + " PPM</p><p>Fan: " + String(fanState ? "ON" : "OFF") + "</p></body></html>");
    }
  });

  server.on("/style.css", HTTP_GET, [](AsyncWebServerRequest *request){
    if (SPIFFS.exists("/style.css")) {
      request->send(SPIFFS, "/style.css", "text/css");
    } else {
      request->send(404, "text/plain", "File not found");
    }
  });

  server.on("/script.js", HTTP_GET, [](AsyncWebServerRequest *request){
    if (SPIFFS.exists("/script.js")) {
      request->send(SPIFFS, "/script.js", "text/javascript");
    } else {
      request->send(404, "text/plain", "File not found");
    }
  });

  server.on("/control", HTTP_GET, [](AsyncWebServerRequest *request){
    // Handle control commands from the web interface
    if (request->hasParam("fan")) {
      String newState = request->getParam("fan")->value();
      if (newState == "on") {
        digitalWrite(RELAY_PIN, HIGH);
        fanState = true;
        autoMode = "OFF"; // Manual override disables auto mode
        Serial.println("Fan turned ON manually");
      } else if (newState == "off") {
        digitalWrite(RELAY_PIN, LOW);
        fanState = false;
        autoMode = "OFF";
        Serial.println("Fan turned OFF manually");
      }
    }
    if (request->hasParam("auto")) {
      autoMode = request->getParam("auto")->value();
      autoMode.toUpperCase();
      Serial.println("Auto mode set to: " + autoMode);
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
  Serial.println("Web server started");
  
  // Display initial system status
  if (displayAvailable && display) {
    display->clearDisplay();
    display->setTextSize(1);
    display->setTextColor(SSD1306_WHITE);
    display->setCursor(0, 0);
    display->println("System Ready!");
    display->print("Mode: ");
    display->println(autoMode);
    display->print("Fan: ");
    display->println(fanState ? "ON" : "OFF");
    if (wifiConnected) {
      display->print("IP: ");
      display->println(WiFi.localIP());
    } else {
      display->println("Network: Offline");
    }
    display->display();
  }
  
  Serial.println("=== System initialization complete ===");
}

void loop() {
  // 1. Read Sensor with proper error handling
  float newReading = readCorrectedPPM();
  
  // Apply simple smoothing filter to reduce noise
  static float filtered_quality = air_quality;
  if (!isnan(newReading) && newReading > 0) {
    filtered_quality = 0.7 * filtered_quality + 0.3 * newReading;
    air_quality = filtered_quality;
  }

  // 2. Automatic Control Logic
  if (autoMode == "ON") {
    if (air_quality > autoThreshold) {
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

  // 4. Update OLED Display with status bar (with safety checks)
  if (displayAvailable && display) {
    display->clearDisplay();
    
    // Draw status bar at the top
    display->drawLine(0, 9, SCREEN_WIDTH, 9, SSD1306_WHITE);
    
    // Display WiFi status
    display->setCursor(0, 0);
    if (wifiConnected) {
      display->print("WiFi");
    } else {
      display->print("Off");
    }
    
    // Display fan status on the right
    display->setCursor(SCREEN_WIDTH - 20, 0);
    if (fanState) {
      display->print("F_ON");
    } else {
      display->print("F_OFF");
    }
    
    // Display mode in the center
    display->setCursor(SCREEN_WIDTH/2 - 12, 0);
    if (autoMode == "ON") {
      display->print("AUTO");
    } else {
      display->print("MAN");
    }
    
    // Display backend connection status
    display->setCursor(SCREEN_WIDTH - 40, 0);
    if (isAuthenticated) {
      display->print("B_OK");
    } else if (wifiConnected) {
      display->print("B_ERR");
    }
    
    // Display main data
    display->setTextSize(1);
    display->setCursor(0, 12);
    display->print("Air Quality: ");
    display->print(air_quality);
    display->println(" PPM");
    
    display->setCursor(0, 24);
    display->print("Fan: ");
    display->println(fanState ? "ON" : "OFF");
    
    display->setCursor(0, 36);
    display->print("Mode: ");
    display->println(autoMode);
    
    display->setCursor(0, 48);
    display->print("Threshold: ");
    display->print(autoThreshold);
    display->println(" PPM");
    
    if (wifiConnected) {
      display->setCursor(0, 56);
      display->print("IP: ");
      display->println(WiFi.localIP());
    }
    
    display->display();
  } else {
    // Fallback: print status to serial if display is not available
    static unsigned long lastSerialOutput = 0;
    if (millis() - lastSerialOutput > 10000) { // Every 10 seconds
      Serial.println("=== Status ===");
      Serial.println("Air Quality: " + String(air_quality) + " PPM");
      Serial.println("Fan: " + String(fanState ? "ON" : "OFF"));
      Serial.println("Mode: " + autoMode);
      Serial.println("WiFi: " + String(wifiConnected ? "Connected" : "Disconnected"));
      Serial.println("==============");
      lastSerialOutput = millis();
    }
  }

  // 5. Add a delay between loops
  delay(2000); // Update every 2 seconds
}