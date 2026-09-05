#pragma once

// Copy this file to config.h and edit it before the first build.
#define WIFI_SSID "YOUR_WIFI_SSID"
#define WIFI_PASSWORD "YOUR_WIFI_PASSWORD"

// Fallback DCC-EX CommandStation / CSB1 endpoint.
// DCC-EX defaults to WIFI_HOSTNAME "dccex" and advertises it over mDNS.
// The web UI can change and persist these values at runtime.
#define DEFAULT_CSB1_HOST "dccex.local"
#define DEFAULT_CSB1_PORT 2560

#define DEVICE_HOSTNAME "dcc-express-hub"
#define DEFAULT_HUB_HTTP_PORT 80
