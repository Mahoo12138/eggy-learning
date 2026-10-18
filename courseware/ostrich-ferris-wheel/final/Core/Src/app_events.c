#include "app_events.h"

#include <limits.h>
#include <stddef.h>

static uint32_t saturating_increment_u32(uint32_t value) {
    return value == UINT32_MAX ? UINT32_MAX : value + 1U;
}

void app_events_init(AppEvents *events,
                     AppEventCriticalFn enter_critical,
                     AppEventCriticalFn exit_critical,
                     void *critical_context) {
    if (events == NULL) {
        return;
    }
    events->tick_count = 0U;
    events->fault_bits = 0U;
    events->dropped_events = 0U;
    events->enter_critical = enter_critical;
    events->exit_critical = exit_critical;
    events->critical_context = critical_context;
}

void app_events_isr_tick(AppEvents *events) {
    if (events == NULL) {
        return;
    }
    if (events->tick_count == UINT16_MAX) {
        events->dropped_events = saturating_increment_u32(events->dropped_events);
    } else {
        events->tick_count++;
    }
}

void app_events_isr_fault(AppEvents *events, uint32_t fault_bits) {
    if (events != NULL) {
        events->fault_bits |= fault_bits;
    }
}

AppEventSnapshot app_events_take(AppEvents *events) {
    AppEventSnapshot snapshot = {0U, 0U, 0U};
    if (events == NULL) {
        return snapshot;
    }
    if (events->enter_critical != NULL) {
        events->enter_critical(events->critical_context);
    }
    snapshot.tick_count = events->tick_count;
    snapshot.fault_bits = events->fault_bits;
    snapshot.dropped_events = events->dropped_events;
    events->tick_count = 0U;
    events->fault_bits = 0U;
    events->dropped_events = 0U;
    if (events->exit_critical != NULL) {
        events->exit_critical(events->critical_context);
    }
    return snapshot;
}
