/*
  Saathi Help Remote — ESP32
  ---------------------------------------------------------------
  Four big physical buttons for seniors with low vision or hand tremor:
    SPEAK (blue)  -> starts the microphone in the app
    YES   (green) -> answers "yes" / completes the press-and-hold payment step
    NO    (red)   -> answers "no" / cancels
    SOS   (orange)-> calls a volunteer (same as the HELP button on screen)

  Each press is sent over Wi-Fi to the Saathi server:
    POST http://<server>:5000/api/device/button   {"device_id":"remote-01","button":"yes"}
  The senior app polls the server and reacts within ~1.5 s.

  Feedback: the vibration motor buzzes on every press (felt even without
  looking), the LED blinks green on success, fast red blink on error.

  Board: "ESP32 Dev Module" in Arduino IDE (ESP32 core 2.x or 3.x).
  Libraries: WiFi.h and HTTPClient.h (both included with the ESP32 core).
*/
#include <WiFi.h>
#include <HTTPClient.h>

// ---------- change these ----------
const char* WIFI_SSID     = "YOUR_WIFI_NAME";
const char* WIFI_PASSWORD = "YOUR_WIFI_PASSWORD";
const char* SERVER_URL    = "http://192.168.1.10:5000/api/device/button";  // laptop running app.py
const char* DEVICE_ID     = "remote-01";
const char* DEVICE_TOKEN  = "";      // same value as the server's DEVICE_TOKEN (leave "" if not used)
// ----------------------------------

// Buttons connect the GPIO to GND when pressed (internal pull-ups, so no resistors needed)
const int PIN_SPEAK = 32;
const int PIN_YES   = 33;
const int PIN_NO    = 25;
const int PIN_SOS   = 26;
const int PIN_LED_OK  = 2;    // on-board LED / green LED via 220 Ω
const int PIN_LED_ERR = 4;    // red LED via 220 Ω
const int PIN_VIBRO   = 27;   // to NPN transistor base via 1 kΩ (motor needs more current than a GPIO gives)

struct Btn { int pin; const char* name; bool last; unsigned long changedAt; unsigned long downAt; };
Btn buttons[] = {
  {PIN_SPEAK, "speak", HIGH, 0, 0},
  {PIN_YES,   "yes",   HIGH, 0, 0},
  {PIN_NO,    "no",    HIGH, 0, 0},
  {PIN_SOS,   "sos",   HIGH, 0, 0},
};
const unsigned long DEBOUNCE_MS = 40;
// Tremor protection: a press must be held this long to count, and repeated
// presses of the same button within REPEAT_GUARD_MS are ignored.
const unsigned long MIN_PRESS_MS = 120;
const unsigned long REPEAT_GUARD_MS = 800;
unsigned long lastSentAt[4] = {0, 0, 0, 0};

void buzz(int ms) { digitalWrite(PIN_VIBRO, HIGH); delay(ms); digitalWrite(PIN_VIBRO, LOW); }

void blink(int pin, int times, int ms) {
  for (int i = 0; i < times; i++) { digitalWrite(pin, HIGH); delay(ms); digitalWrite(pin, LOW); delay(ms); }
}

void connectWifi() {
  if (WiFi.status() == WL_CONNECTED) return;
  WiFi.mode(WIFI_STA);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to Wi-Fi");
  unsigned long start = millis();
  while (WiFi.status() != WL_CONNECTED && millis() - start < 15000) { delay(300); Serial.print("."); digitalWrite(PIN_LED_ERR, !digitalRead(PIN_LED_ERR)); }
  digitalWrite(PIN_LED_ERR, LOW);
  if (WiFi.status() == WL_CONNECTED) { Serial.println("\nConnected: " + WiFi.localIP().toString()); blink(PIN_LED_OK, 3, 120); }
  else { Serial.println("\nWi-Fi failed"); blink(PIN_LED_ERR, 5, 80); }
}

bool sendPress(const char* name) {
  connectWifi();
  if (WiFi.status() != WL_CONNECTED) return false;
  HTTPClient http;
  http.begin(SERVER_URL);
  http.addHeader("Content-Type", "application/json");
  if (strlen(DEVICE_TOKEN) > 0) http.addHeader("X-Device-Token", DEVICE_TOKEN);   // security: only our remote is accepted
  String body = String("{\"device_id\":\"") + DEVICE_ID + "\",\"button\":\"" + name + "\"}";
  int code = http.POST(body);
  http.end();
  Serial.printf("Sent %s -> HTTP %d\n", name, code);
  return code == 200;
}

void setup() {
  Serial.begin(115200);
  for (auto& b : buttons) pinMode(b.pin, INPUT_PULLUP);
  pinMode(PIN_LED_OK, OUTPUT); pinMode(PIN_LED_ERR, OUTPUT); pinMode(PIN_VIBRO, OUTPUT);
  buzz(150);
  connectWifi();
}

void loop() {
  unsigned long now = millis();
  for (int i = 0; i < 4; i++) {
    Btn& b = buttons[i];
    bool reading = digitalRead(b.pin);
    if (reading != b.last && now - b.changedAt > DEBOUNCE_MS) {
      b.changedAt = now;
      b.last = reading;
      if (reading == LOW) {                  // pressed
        b.downAt = now;
      } else {                               // released → decide if it was a real press
        unsigned long held = now - b.downAt;
        if (held >= MIN_PRESS_MS && now - lastSentAt[i] > REPEAT_GUARD_MS) {
          lastSentAt[i] = now;
          buzz(i == 3 ? 400 : 120);          // SOS gets a long buzz
          if (sendPress(b.name)) blink(PIN_LED_OK, 1, 150);
          else blink(PIN_LED_ERR, 3, 80);
        }
      }
    }
  }
  delay(5);
}
