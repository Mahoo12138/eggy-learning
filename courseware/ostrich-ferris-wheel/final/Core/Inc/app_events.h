#ifndef FERRIS_APP_EVENTS_H
#define FERRIS_APP_EVENTS_H

#include <stdbool.h>
#include <stdint.h>

typedef void (*AppEventCriticalFn)(void *context);

typedef struct {
    uint16_t tick_count;
    uint32_t fault_bits;
    uint32_t dropped_events;
} AppEventSnapshot;

typedef struct {
    volatile uint16_t tick_count;
    volatile uint32_t fault_bits;
    volatile uint32_t dropped_events;
    AppEventCriticalFn enter_critical;
    AppEventCriticalFn exit_critical;
    void *critical_context;
} AppEvents;

void app_events_init(AppEvents *events,
                     AppEventCriticalFn enter_critical,
                     AppEventCriticalFn exit_critical,
                     void *critical_context);
void app_events_isr_tick(AppEvents *events);
void app_events_isr_fault(AppEvents *events, uint32_t fault_bits);
AppEventSnapshot app_events_take(AppEvents *events);

#endif
