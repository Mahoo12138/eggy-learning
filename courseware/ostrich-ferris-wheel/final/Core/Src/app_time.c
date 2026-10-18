#include "app_time.h"

#include <stddef.h>

uint32_t app_elapsed(uint32_t now_ms, uint32_t since_ms) {
    return now_ms - since_ms;
}

bool app_due(uint32_t now_ms, uint32_t since_ms, uint32_t interval_ms) {
    return app_elapsed(now_ms, since_ms) >= interval_ms;
}

void heartbeat_init(Heartbeat *heartbeat, uint32_t now_ms, uint32_t period_ms) {
    if (heartbeat == NULL) {
        return;
    }
    heartbeat->changed_at_ms = now_ms;
    heartbeat->period_ms = period_ms;
    heartbeat->output_on = false;
}

bool heartbeat_update(Heartbeat *heartbeat, uint32_t now_ms) {
    if (heartbeat == NULL || heartbeat->period_ms == 0U ||
        !app_due(now_ms, heartbeat->changed_at_ms, heartbeat->period_ms)) {
        return false;
    }
    const uint32_t periods = app_elapsed(now_ms, heartbeat->changed_at_ms) /
                             heartbeat->period_ms;
    heartbeat->changed_at_ms += periods * heartbeat->period_ms;
    if ((periods & 1U) != 0U) {
        heartbeat->output_on = !heartbeat->output_on;
    }
    return true;
}
