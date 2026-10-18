#ifndef FERRIS_APP_TIME_H
#define FERRIS_APP_TIME_H

#include <stdbool.h>
#include <stdint.h>

uint32_t app_elapsed(uint32_t now_ms, uint32_t since_ms);
bool app_due(uint32_t now_ms, uint32_t since_ms, uint32_t interval_ms);

typedef struct {
    uint32_t changed_at_ms;
    uint32_t period_ms;
    bool output_on;
} Heartbeat;

void heartbeat_init(Heartbeat *heartbeat, uint32_t now_ms, uint32_t period_ms);
bool heartbeat_update(Heartbeat *heartbeat, uint32_t now_ms);

#endif
