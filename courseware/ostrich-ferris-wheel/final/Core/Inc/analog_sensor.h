#ifndef FERRIS_ANALOG_SENSOR_H
#define FERRIS_ANALOG_SENSOR_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum { ANALOG_FILTER_CAPACITY = 8 };

typedef enum {
    SENSOR_ERROR_NONE = 0,
    SENSOR_ERROR_TIMEOUT,
    SENSOR_ERROR_DISCONNECTED,
    SENSOR_ERROR_CALIBRATION,
    SENSOR_ERROR_EMPTY_FILTER
} SensorError;

typedef struct {
    uint16_t raw;
    uint16_t value_permille;
    bool valid;
    SensorError error;
} SensorReading;

typedef struct {
    uint16_t raw_min;
    uint16_t raw_max;
    uint16_t samples[ANALOG_FILTER_CAPACITY];
    size_t window_size;
    size_t count;
    size_t next;
    uint32_t sum;
} AnalogSensor;

typedef struct {
    uint16_t enter_threshold;
    uint16_t exit_threshold;
    bool overloaded;
} OverloadDetector;

bool analog_sensor_init(AnalogSensor *sensor,
                        uint16_t raw_min,
                        uint16_t raw_max,
                        size_t window_size);
SensorReading analog_sensor_add(AnalogSensor *sensor, uint16_t raw, SensorError acquisition_error);
void overload_init(OverloadDetector *detector,
                   uint16_t enter_threshold,
                   uint16_t exit_threshold);
bool overload_update(OverloadDetector *detector, const SensorReading *reading, bool *changed);

#endif
