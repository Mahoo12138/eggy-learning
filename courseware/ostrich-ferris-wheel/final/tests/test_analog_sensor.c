#include "analog_sensor.h"
#include "test_support.h"

int main(void) {
    AnalogSensor sensor;
    TEST_ASSERT(!analog_sensor_init(&sensor, 1000U, 1000U, 4U));
    TEST_ASSERT(!analog_sensor_init(&sensor, 0U, 4095U, 0U));
    TEST_ASSERT(analog_sensor_init(&sensor, 500U, 3500U, 4U));

    SensorReading reading = analog_sensor_add(&sensor, 500U, SENSOR_ERROR_NONE);
    TEST_ASSERT(reading.valid);
    TEST_ASSERT_EQ(0, reading.value_permille);
    reading = analog_sensor_add(&sensor, 3500U, SENSOR_ERROR_NONE);
    TEST_ASSERT_EQ(500, reading.value_permille);
    reading = analog_sensor_add(&sensor, 3500U, SENSOR_ERROR_NONE);
    reading = analog_sensor_add(&sensor, 3500U, SENSOR_ERROR_NONE);
    TEST_ASSERT_EQ(750, reading.value_permille);
    reading = analog_sensor_add(&sensor, 4095U, SENSOR_ERROR_TIMEOUT);
    TEST_ASSERT(!reading.valid);
    TEST_ASSERT_EQ(SENSOR_ERROR_TIMEOUT, reading.error);

    TEST_ASSERT(analog_sensor_init(&sensor, 500U, 3500U, 1U));
    OverloadDetector detector;
    overload_init(&detector, 820U, 760U);
    bool changed = false;
    const uint16_t sequence[] = {2900U, 2970U, 2930U, 2980U, 2800U, 2750U};
    const bool expected[] = {false, true, true, true, true, false};
    int transitions = 0;
    for (size_t i = 0U; i < sizeof(sequence) / sizeof(sequence[0]); ++i) {
        reading = analog_sensor_add(&sensor, sequence[i], SENSOR_ERROR_NONE);
        TEST_ASSERT_EQ(expected[i], overload_update(&detector, &reading, &changed));
        if (changed) {
            transitions++;
        }
    }
    TEST_ASSERT_EQ(2, transitions);
    TEST_PASS();
}
