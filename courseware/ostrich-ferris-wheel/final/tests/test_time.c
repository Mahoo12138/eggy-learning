#include "app_time.h"
#include "test_support.h"

#include <stdint.h>

int main(void) {
    TEST_ASSERT_EQ(50, app_elapsed(150U, 100U));
    TEST_ASSERT(!app_due(149U, 100U, 50U));
    TEST_ASSERT(app_due(150U, 100U, 50U));
    TEST_ASSERT_EQ(32, app_elapsed(0x00000010U, 0xFFFFFFF0U));
    TEST_ASSERT(app_due(0x00000010U, 0xFFFFFFF0U, 32U));

    Heartbeat heartbeat;
    heartbeat_init(&heartbeat, UINT32_MAX - 10U, 20U);
    TEST_ASSERT(!heartbeat_update(&heartbeat, 5U));
    TEST_ASSERT(heartbeat_update(&heartbeat, 9U));
    TEST_ASSERT(heartbeat.output_on);
    TEST_ASSERT(heartbeat_update(&heartbeat, 49U));
    TEST_ASSERT(heartbeat.output_on);
    TEST_PASS();
}
