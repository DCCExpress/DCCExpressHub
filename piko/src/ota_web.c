#include "ota_web.h"
#include "hardware_probe.h"
#include "web_pages.h"
#include "keymap_page.h"
#include <stdbool.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include "esp_http_server.h"
#include "esp_log.h"
#include "esp_ota_ops.h"
#include "esp_partition.h"
#include "esp_system.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"

static const char *TAG = "piko_ota";
static httpd_handle_t server;
static bool updating;

static const char page[] =
"<!doctype html><html lang='en'><meta charset='utf-8'>"
"<meta name='viewport' content='width=device-width,initial-scale=1'>"
"<title>PIKO Firmware Update</title>"
"<style>body{margin:0;background:#101722;color:#e6edf7;font:16px system-ui}"
"main{max-width:560px;margin:8vh auto;padding:26px;background:#1b2636;border-radius:16px}"
"h1{margin-top:0}small{color:#9eb0c9}input,button{box-sizing:border-box;width:100%;margin:10px 0;padding:13px;"
"border:1px solid #52657d;border-radius:8px;background:#101722;color:inherit}"
"button{background:#278bce;border:0;font-weight:bold;cursor:pointer}"
"button:disabled{opacity:.5;cursor:wait}progress{width:100%;height:16px}pre{white-space:pre-wrap}"
"</style><main><h1>PIKO Firmware Update</h1>"
"<p>Upload a firmware.bin built for this handheld. Do not upload a complete flash dump.</p>"
"<label>Update password<input id='key' type='password' autocomplete='off'></label>"
"<label>Firmware file<input id='file' type='file' accept='.bin'></label>"
"<button id='go'>Upload firmware</button><progress id='progress' max='100' value='0'></progress>"
"<pre id='status'>Ready</pre><small>Keep the device powered during the update. "
"The unit restarts when the new firmware is installed.</small></main>"
"<script>const go=document.querySelector('#go'),status=document.querySelector('#status'),"
"progress=document.querySelector('#progress');"
"go.onclick=()=>{const f=document.querySelector('#file').files[0],"
"key=document.querySelector('#key').value;if(!f||!key){status.textContent='Choose a file and enter the update password.';return;}"
"if(!confirm('Install '+f.name+' ('+f.size+' bytes)?'))return;"
"go.disabled=true;const x=new XMLHttpRequest();x.open('POST','/api/update');"
"x.setRequestHeader('X-OTA-Key',key);x.upload.onprogress=e=>{if(e.lengthComputable)"
"progress.value=Math.round(e.loaded/e.total*100);};"
"x.onload=()=>{status.textContent=x.responseText||('HTTP '+x.status);go.disabled=false;};"
"x.onerror=()=>{status.textContent='Connection lost. Check the serial log; the device may be restarting.';go.disabled=false;};"
"x.send(f);status.textContent='Uploading...';};</script></html>";

static esp_err_t keymap_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, piko_keymap_html, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t home_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, piko_home_html, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t diag_handler(httpd_req_t *req)
{
    char json[256];
    hardware_probe_json(json, sizeof(json));
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_sendstr(req, json);
}

static esp_err_t events_handler(httpd_req_t *req)
{
    char json[6000];
    hardware_probe_events_json(json, sizeof(json));
    httpd_resp_set_type(req, "application/json");
    httpd_resp_set_hdr(req, "Cache-Control", "no-store");
    return httpd_resp_sendstr(req, json);
}

static esp_err_t capture_begin_handler(httpd_req_t *req)
{
    hardware_probe_capture_begin();
    return httpd_resp_sendstr(req, "OK");
}
static esp_err_t capture_end_handler(httpd_req_t *req)
{
    hardware_probe_capture_end();
    char json[512];
    hardware_probe_capture_json(json, sizeof(json));
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, json);
}
static esp_err_t capture_status_handler(httpd_req_t *req)
{
    char json[512];
    hardware_probe_capture_json(json, sizeof(json));
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_sendstr(req, json);
}

static esp_err_t index_handler(httpd_req_t *req)
{
    httpd_resp_set_type(req, "text/html; charset=utf-8");
    return httpd_resp_send(req, page, HTTPD_RESP_USE_STRLEN);
}

static esp_err_t update_handler(httpd_req_t *req)
{
    const char *expected = CONFIG_PIKO_OTA_PASSWORD;
    char supplied[128] = {0};
    if (!expected[0] || strlen(expected) >= sizeof(supplied) ||
        httpd_req_get_hdr_value_str(req, "X-OTA-Key", supplied, sizeof(supplied)) != ESP_OK ||
        strcmp(expected, supplied) != 0) {
        httpd_resp_set_status(req, "403 Forbidden");
        return httpd_resp_sendstr(req, "Invalid update password.");
    }
    if (updating) {
        httpd_resp_set_status(req, "409 Conflict");
        return httpd_resp_sendstr(req, "An update is already running.");
    }
    const esp_partition_t *target = esp_ota_get_next_update_partition(NULL);
    if (!target || req->content_len <= 24 ||
        req->content_len > (int)target->size) {
        httpd_resp_set_status(req, "400 Bad Request");
        return httpd_resp_sendstr(req, "Firmware size invalid or OTA partition unavailable.");
    }
    updating = true;
    esp_ota_handle_t handle = 0;
    esp_err_t err = ESP_FAIL;
    bool begun = false;
    int remaining = req->content_len;
    uint8_t buffer[2048];
    ESP_LOGI(TAG, "OTA upload: %d bytes to %s", remaining, target->label);
    while (remaining > 0) {
        int chunk = remaining < (int)sizeof(buffer) ? remaining : (int)sizeof(buffer);
        int got = httpd_req_recv(req, (char *)buffer, chunk);
        if (got == HTTPD_SOCK_ERR_TIMEOUT) continue;
        if (got <= 0) { ESP_LOGE(TAG, "Upload interrupted"); goto failure; }
        if (!begun) {
            if (buffer[0] != 0xE9) {
                ESP_LOGE(TAG, "Invalid ESP32 application image");
                goto failure;
            }
            err = esp_ota_begin(target, OTA_SIZE_UNKNOWN, &handle);
            if (err != ESP_OK) goto failure;
            begun = true;
        }
        err = esp_ota_write(handle, buffer, got);
        if (err != ESP_OK) goto failure;
        remaining -= got;
    }
    err = esp_ota_end(handle);
    begun = false;
    if (err != ESP_OK) goto failure;
    err = esp_ota_set_boot_partition(target);
    if (err != ESP_OK) goto failure;
    ESP_LOGI(TAG, "OTA successful; rebooting");
    httpd_resp_sendstr(req, "Firmware installed successfully. Restarting PIKO...");
    vTaskDelay(pdMS_TO_TICKS(1200));
    esp_restart();
    return ESP_OK;
failure:
    if (begun) esp_ota_abort(handle);
    ESP_LOGE(TAG, "OTA failed: %s", esp_err_to_name(err));
    updating = false;
    httpd_resp_set_status(req, "400 Bad Request");
    return httpd_resp_sendstr(req, "Firmware update failed. Original application remains active.");
}

esp_err_t piko_ota_web_start(void)
{
    if (server) return ESP_OK;
    httpd_config_t config = HTTPD_DEFAULT_CONFIG();
    config.server_port = CONFIG_PIKO_OTA_PORT;
    config.stack_size = 8192;
    config.recv_wait_timeout = 20;
    config.max_uri_handlers = 12;
    httpd_uri_t cap_begin_uri = {.uri = "/api/capture/start", .method = HTTP_POST, .handler = capture_begin_handler};
    httpd_uri_t cap_end_uri = {.uri = "/api/capture/stop", .method = HTTP_POST, .handler = capture_end_handler};
    httpd_uri_t cap_status_uri = {.uri = "/api/capture", .method = HTTP_GET, .handler = capture_status_handler};
    httpd_uri_t keymap_uri = {.uri = "/keymap", .method = HTTP_GET, .handler = keymap_handler};
    httpd_uri_t index_uri = {.uri = "/", .method = HTTP_GET, .handler = home_handler};
    httpd_uri_t ota_uri = {.uri = "/ota", .method = HTTP_GET, .handler = index_handler};
    httpd_uri_t diag_uri = {.uri = "/api/diag", .method = HTTP_GET, .handler = diag_handler};
    httpd_uri_t events_uri = {.uri = "/api/events", .method = HTTP_GET, .handler = events_handler};
    httpd_uri_t update_uri = {.uri = "/api/update", .method = HTTP_POST, .handler = update_handler};
    esp_err_t err = httpd_start(&server, &config);
    if (err != ESP_OK) return err;
    if ((err = httpd_register_uri_handler(server, &keymap_uri)) != ESP_OK ||
        (err = httpd_register_uri_handler(server, &index_uri)) != ESP_OK ||
        (err = httpd_register_uri_handler(server, &ota_uri)) != ESP_OK ||
        (err = httpd_register_uri_handler(server, &diag_uri)) != ESP_OK ||
        (err = httpd_register_uri_handler(server, &events_uri)) != ESP_OK ||
        (err = httpd_register_uri_handler(server, &cap_begin_uri)) != ESP_OK ||
        (err = httpd_register_uri_handler(server, &cap_end_uri)) != ESP_OK ||
        (err = httpd_register_uri_handler(server, &cap_status_uri)) != ESP_OK ||
        (err = httpd_register_uri_handler(server, &update_uri)) != ESP_OK) {
        httpd_stop(server);
        server = NULL;
        return err;
    }
    ESP_LOGI(TAG, "Firmware updater listening on HTTP port %d", CONFIG_PIKO_OTA_PORT);
    return ESP_OK;
}
