#include "app_events.h"
#include "test_support.h"

#include <limits.h>

typedef struct {
    int entered;
    int exited;
} CriticalProbe;

static void enter_critical(void *context) {
    ((CriticalProbe *)context)->entered++;
}

static void exit_critical(void *context) {
    ((CriticalProbe *)context)->exited++;
}

int main(void) {
    CriticalProbe probe = {0, 0};
    AppEvents events;
    app_events_init(&events, enter_critical, exit_critical, &probe);
    app_events_isr_tick(&events);
    app_events_isr_tick(&events);
    app_events_isr_fault(&events, 0x01U);
    app_events_isr_fault(&events, 0x04U);
    AppEventSnapshot snapshot = app_events_take(&events);
    TEST_ASSERT_EQ(2, snapshot.tick_count);
    TEST_ASSERT_EQ(5, snapshot.fault_bits);
    TEST_ASSERT_EQ(0, snapshot.dropped_events);
    TEST_ASSERT_EQ(1, probe.entered);
    TEST_ASSERT_EQ(1, probe.exited);
    TEST_ASSERT_EQ(0, events.tick_count);

    events.tick_count = UINT16_MAX;
    app_events_isr_tick(&events);
    app_events_isr_tick(&events);
    snapshot = app_events_take(&events);
    TEST_ASSERT_EQ(UINT16_MAX, snapshot.tick_count);
    TEST_ASSERT_EQ(2, snapshot.dropped_events);
    TEST_PASS();
}
