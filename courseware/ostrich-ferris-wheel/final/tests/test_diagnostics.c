#include "diagnostics.h"
#include "test_support.h"

#include <string.h>

int main(void) {
    Diagnostics diagnostics;
    diagnostics_init(&diagnostics);
    TEST_ASSERT(!diagnostics_record_transition(&diagnostics, 10U, 2, 2, DIAG_REASON_SENSOR, 0));
    TEST_ASSERT(diagnostics_record_transition(&diagnostics, 20U, 2, 3, DIAG_REASON_USER_START, 0));

    DiagnosticEvent event;
    TEST_ASSERT(diagnostics_pop(&diagnostics, &event));
    TEST_ASSERT_EQ(20, event.at_ms);
    char line[128];
    TEST_ASSERT(diagnostics_format_event(&event, line, sizeof(line)) > 0);
    TEST_ASSERT(strstr(line, "user-start") != NULL);
    TEST_ASSERT(!diagnostics_pop(&diagnostics, &event));

    for (int i = 0; i < DIAGNOSTICS_CAPACITY; ++i) {
        TEST_ASSERT(diagnostics_record_transition(&diagnostics,
                                                  (uint32_t)i,
                                                  i,
                                                  i + 1,
                                                  DIAG_REASON_SENSOR,
                                                  0));
    }
    TEST_ASSERT(!diagnostics_record_transition(&diagnostics, 99U, 1, 2, DIAG_REASON_SENSOR, 0));
    TEST_ASSERT_EQ(1, diagnostics.overflow_count);
    TEST_PASS();
}
