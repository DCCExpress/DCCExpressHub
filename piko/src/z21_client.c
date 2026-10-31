#include "z21_client.h"
#include <string.h>
#include <errno.h>
#include "esp_log.h"
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "lwip/sockets.h"
#include "lwip/inet.h"

static const char *TAG = "z21";
static int sock = -1;
static struct sockaddr_in peer;
static TaskHandle_t rx_task;
static z21_loco_state_t current;
static portMUX_TYPE state_lock = portMUX_INITIALIZER_UNLOCKED;

static void xor_finish(uint8_t *data, size_t length)
{
    uint8_t checksum = 0;
    for (size_t i = 4; i + 1 < length; ++i) checksum ^= data[i];
    data[length - 1] = checksum;
}

static esp_err_t send_frame(const uint8_t *buffer, size_t length)
{
    if (sock < 0) return ESP_ERR_INVALID_STATE;
    int result = sendto(sock, buffer, length, 0,
                        (const struct sockaddr *)&peer, sizeof(peer));
    return result == (int)length ? ESP_OK : ESP_FAIL;
}

static void handle_frame(const uint8_t *data, size_t size)
{
    if (size < 4 || ((unsigned)data[0] | ((unsigned)data[1] << 8)) != size) return;
    uint16_t header = (uint16_t)data[2] | ((uint16_t)data[3] << 8);
    if (header == 0x0010 && size == 8) {
        ESP_LOGI(TAG, "Server serial: %02X%02X%02X%02X", data[4], data[5], data[6], data[7]);
    } else if (header == 0x0040 && size >= 14 && data[4] == 0xEF) {
        uint8_t checksum = 0;
        for (size_t i = 4; i < size; ++i) checksum ^= data[i];
        if (checksum != 0) return;
        z21_loco_state_t next = {
            .address = (uint16_t)(((data[5] & 0x3F) << 8) | data[6]),
            .speed = (uint8_t)((data[8] & 0x7F) > 1 ? (data[8] & 0x7F) - 1 : 0),
            .forward = (data[8] & 0x80) != 0,
            .functions = (uint32_t)((data[9] & 0x10) >> 4) |
                         ((uint32_t)(data[9] & 0x0F) << 1) |
                         ((uint32_t)data[10] << 5) |
                         ((uint32_t)data[11] << 13) |
                         ((uint32_t)data[12] << 21),
            .valid = true
        };
        taskENTER_CRITICAL(&state_lock);
        current = next;
        taskEXIT_CRITICAL(&state_lock);
        ESP_LOGI(TAG, "Loco %u: speed %u, %s", next.address, next.speed,
                 next.forward ? "forward" : "reverse");
    }
}

static void receiver(void *arg)
{
    uint8_t data[512];
    while (sock >= 0) {
        struct sockaddr_in from;
        socklen_t from_len = sizeof(from);
        int n = recvfrom(sock, data, sizeof(data), 0,
                         (struct sockaddr *)&from, &from_len);
        if (n > 0 && from.sin_addr.s_addr == peer.sin_addr.s_addr &&
            from.sin_port == peer.sin_port) handle_frame(data, n);
        else if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK)
            ESP_LOGW(TAG, "UDP receive error: %d", errno);
    }
    rx_task = NULL;
    vTaskDelete(NULL);
}

esp_err_t z21_start(const char *host, uint16_t port)
{
    if (!host || port == 0 || sock >= 0) return ESP_ERR_INVALID_ARG;
    memset(&peer, 0, sizeof(peer));
    peer.sin_family = AF_INET;
    peer.sin_port = htons(port);
    if (inet_pton(AF_INET, host, &peer.sin_addr) != 1) return ESP_ERR_INVALID_ARG;
    int fd = socket(AF_INET, SOCK_DGRAM, IPPROTO_IP);
    if (fd < 0) return ESP_FAIL;
    struct timeval timeout = { .tv_sec = 1, .tv_usec = 0 };
    setsockopt(fd, SOL_SOCKET, SO_RCVTIMEO, &timeout, sizeof(timeout));
    sock = fd;
    if (xTaskCreate(receiver, "z21_rx", 4096, NULL, 5, &rx_task) != pdPASS) {
        close(sock);
        sock = -1;
        return ESP_ERR_NO_MEM;
    }
    ESP_LOGI(TAG, "Configured Z21 peer %s:%u", host, port);
    return ESP_OK;
}

void z21_stop(void)
{
    if (sock >= 0) {
        int fd = sock;
        sock = -1;
        shutdown(fd, SHUT_RDWR);
        close(fd);
    }
}
bool z21_is_connected(void) { return sock >= 0; }
bool z21_get_loco_state(z21_loco_state_t *out)
{
    if (!out) return false;
    taskENTER_CRITICAL(&state_lock);
    *out = current;
    taskEXIT_CRITICAL(&state_lock);
    return out->valid;
}
esp_err_t z21_request_serial(void)
{
    const uint8_t packet[] = { 4, 0, 0x10, 0 };
    return send_frame(packet, sizeof(packet));
}
esp_err_t z21_request_loco(uint16_t address)
{
    if (!address || address > 10239) return ESP_ERR_INVALID_ARG;
    uint8_t packet[] = { 9, 0, 0x40, 0, 0xE3, 0xF0,
        (uint8_t)((address >> 8) | (address >= 128 ? 0xC0 : 0)),
        (uint8_t)address, 0 };
    xor_finish(packet, sizeof(packet));
    return send_frame(packet, sizeof(packet));
}
esp_err_t z21_set_drive(uint16_t address, uint8_t speed, bool forward)
{
    if (!address || address > 10239 || speed > 126) return ESP_ERR_INVALID_ARG;
    uint8_t packet[] = { 10, 0, 0x40, 0, 0xE4, 0x13,
        (uint8_t)((address >> 8) | (address >= 128 ? 0xC0 : 0)),
        (uint8_t)address,
        (uint8_t)((forward ? 0x80 : 0) | (speed == 0 ? 0 : speed + 1)), 0 };
    xor_finish(packet, sizeof(packet));
    return send_frame(packet, sizeof(packet));
}
esp_err_t z21_set_function(uint16_t address, uint8_t function, bool enabled)
{
    if (!address || address > 10239 || function > 28) return ESP_ERR_INVALID_ARG;
    uint8_t packet[] = { 10, 0, 0x40, 0, 0xE4, 0xF8,
        (uint8_t)((address >> 8) | (address >= 128 ? 0xC0 : 0)),
        (uint8_t)address, (uint8_t)((enabled ? 0x40 : 0) | function), 0 };
    xor_finish(packet, sizeof(packet));
    return send_frame(packet, sizeof(packet));
}
