#include "analog_sensor.h"

#include <stddef.h>

bool analog_sensor_init(AnalogSensor *sensor,
                        uint16_t raw_min,
                        uint16_t raw_max,
                        size_t window_size) {
    if (sensor == NULL || raw_min >= raw_max || window_size == 0U ||
        window_size > ANALOG_FILTER_CAPACITY) {
        return false;
    }
    sensor->raw_min = raw_min;
    sensor->raw_max = raw_max;
    sensor->window_size = window_size;
    sensor->count = 0U;
    sensor->next = 0U;
    sensor->sum = 0U;
    for (size_t i = 0U; i < ANALOG_FILTER_CAPACITY; ++i) {
        sensor->samples[i] = 0U;
    }
    return true;
}

static uint16_t map_to_permille(uint32_t raw, uint16_t raw_min, uint16_t raw_max) {
    if (raw <= raw_min) {
        return 0U;
    }
    if (raw >= raw_max) {
        return 1000U;
    }
    const uint64_t numerator = ((uint64_t)raw - raw_min) * UINT64_C(1000);
    const uint32_t denominator = (uint32_t)raw_max - raw_min;
    return (uint16_t)((numerator + denominator / 2U) / denominator);
}

SensorReading analog_sensor_add(AnalogSensor *sensor, uint16_t raw, SensorError acquisition_error) {
    SensorReading reading = {.raw = raw, .value_permille = 0U, .valid = false, .error = acquisition_error};
    if (sensor == NULL || sensor->raw_min >= sensor->raw_max || sensor->window_size == 0U ||
        sensor->window_size > ANALOG_FILTER_CAPACITY) {
        reading.error = SENSOR_ERROR_CALIBRATION;
        return reading;
    }
    if (acquisition_error != SENSOR_ERROR_NONE) {
        return reading;
    }
    if (sensor->count < sensor->window_size) {
        sensor->samples[sensor->next] = raw;
        sensor->sum += raw;
        sensor->count++;
    } else {
        sensor->sum -= sensor->samples[sensor->next];
        sensor->samples[sensor->next] = raw;
        sensor->sum += raw;
    }
    sensor->next = (sensor->next + 1U) % sensor->window_size;
    if (sensor->count == 0U) {
        reading.error = SENSOR_ERROR_EMPTY_FILTER;
        return reading;
    }
    const uint32_t average = (sensor->sum + (uint32_t)sensor->count / 2U) /
                             (uint32_t)sensor->count;
    reading.value_permille = map_to_permille(average, sensor->raw_min, sensor->raw_max);
    reading.valid = true;
    reading.error = SENSOR_ERROR_NONE;
    return reading;
}

void overload_init(OverloadDetector *detector,
                   uint16_t enter_threshold,
                   uint16_t exit_threshold) {
    if (detector == NULL) {
        return;
    }
    detector->enter_threshold = enter_threshold;
    detector->exit_threshold = exit_threshold;
    detector->overloaded = false;
}

bool overload_update(OverloadDetector *detector, const SensorReading *reading, bool *changed) {
    if (changed != NULL) {
        *changed = false;
    }
    if (detector == NULL || reading == NULL || !reading->valid ||
        detector->exit_threshold >= detector->enter_threshold) {
        return detector != NULL && detector->overloaded;
    }
    const bool before = detector->overloaded;
    if (!before && reading->value_permille >= detector->enter_threshold) {
        detector->overloaded = true;
    } else if (before && reading->value_permille <= detector->exit_threshold) {
        detector->overloaded = false;
    }
    if (changed != NULL) {
        *changed = before != detector->overloaded;
    }
    return detector->overloaded;
}
