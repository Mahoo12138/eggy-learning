#include "button.h"
#include "test_support.h"

int main(void) {
    Button button;
    button_init(&button, false, 0U, 25U);

    TEST_ASSERT_EQ(BUTTON_EVENT_NONE, button_update(&button, true, 10U));
    TEST_ASSERT_EQ(BUTTON_EVENT_NONE, button_update(&button, false, 15U));
    TEST_ASSERT_EQ(BUTTON_EVENT_NONE, button_update(&button, true, 20U));
    TEST_ASSERT_EQ(BUTTON_EVENT_NONE, button_update(&button, true, 44U));
    TEST_ASSERT_EQ(BUTTON_EVENT_PRESS, button_update(&button, true, 45U));
    TEST_ASSERT_EQ(BUTTON_EVENT_NONE, button_update(&button, true, 2045U));
    TEST_ASSERT_EQ(BUTTON_EVENT_NONE, button_update(&button, false, 2050U));
    TEST_ASSERT_EQ(BUTTON_EVENT_RELEASE, button_update(&button, false, 2075U));

    int press_count = 1;
    uint32_t now = 2100U;
    for (int i = 0; i < 3; ++i) {
        TEST_ASSERT_EQ(BUTTON_EVENT_NONE, button_update(&button, true, now));
        TEST_ASSERT_EQ(BUTTON_EVENT_PRESS, button_update(&button, true, now + 25U));
        press_count++;
        TEST_ASSERT_EQ(BUTTON_EVENT_NONE, button_update(&button, false, now + 40U));
        TEST_ASSERT_EQ(BUTTON_EVENT_RELEASE, button_update(&button, false, now + 65U));
        now += 100U;
    }
    TEST_ASSERT_EQ(4, press_count);
    TEST_PASS();
}
