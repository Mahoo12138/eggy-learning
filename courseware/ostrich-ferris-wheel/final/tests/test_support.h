#ifndef FERRIS_TEST_SUPPORT_H
#define FERRIS_TEST_SUPPORT_H

#include <stdio.h>
#include <stdlib.h>

#define TEST_ASSERT(condition)                                                        \
    do {                                                                              \
        if (!(condition)) {                                                           \
            fprintf(stderr, "%s:%d assertion failed: %s\n", __FILE__, __LINE__, #condition); \
            exit(EXIT_FAILURE);                                                       \
        }                                                                             \
    } while (0)

#define TEST_ASSERT_EQ(expected, actual)                                               \
    do {                                                                              \
        const long long test_expected = (long long)(expected);                        \
        const long long test_actual = (long long)(actual);                            \
        if (test_expected != test_actual) {                                            \
            fprintf(stderr,                                                           \
                    "%s:%d expected %lld, got %lld\n",                               \
                    __FILE__,                                                         \
                    __LINE__,                                                         \
                    test_expected,                                                    \
                    test_actual);                                                      \
            exit(EXIT_FAILURE);                                                       \
        }                                                                             \
    } while (0)

#define TEST_PASS()                                                                    \
    do {                                                                              \
        printf("PASS %s\n", __FILE__);                                               \
        return EXIT_SUCCESS;                                                          \
    } while (0)

#endif
