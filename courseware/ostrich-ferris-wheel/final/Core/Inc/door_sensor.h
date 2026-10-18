#ifndef FERRIS_DOOR_SENSOR_H
#define FERRIS_DOOR_SENSOR_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum {
    DOOR_SENSOR_ADDRESS = 0x32,
    DOOR_SENSOR_STATUS_REGISTER = 0x01,
    DOOR_SENSOR_EXPECTED_ID = 0xA7,
    DOOR_SENSOR_LOCKED_MASK = 0x01,
    DOOR_SENSOR_KNOWN_STATUS_MASK = 0x01
};

typedef enum {
    DOOR_BUS_OK = 0,
    DOOR_BUS_NACK,
    DOOR_BUS_TIMEOUT,
    DOOR_BUS_IO_ERROR
} DoorBusResult;

typedef DoorBusResult (*DoorBusReadFn)(void *context,
                                       uint8_t address,
                                       uint8_t register_address,
                                       uint8_t *output,
                                       size_t capacity,
                                       size_t *received,
                                       uint32_t timeout_ms);

typedef DoorBusResult (*DoorBusWriteFn)(void *context,
                                        uint8_t address,
                                        uint8_t register_address,
                                        const uint8_t *data,
                                        size_t length,
                                        uint32_t timeout_ms);

typedef struct {
    DoorBusReadFn read;
    DoorBusWriteFn write;
    void *context;
} DoorBus;

typedef enum {
    DOOR_ERROR_NONE = 0,
    DOOR_ERROR_INVALID_BUS,
    DOOR_ERROR_NACK,
    DOOR_ERROR_TIMEOUT,
    DOOR_ERROR_IO,
    DOOR_ERROR_SHORT_DATA,
    DOOR_ERROR_WRONG_DEVICE,
    DOOR_ERROR_INVALID_STATUS,
    DOOR_ERROR_STALE
} DoorError;

typedef struct {
    bool valid;
    bool locked;
    DoorError error;
    uint32_t sampled_at_ms;
} DoorReading;

DoorReading door_sensor_read(const DoorBus *bus, uint32_t now_ms, uint32_t timeout_ms);
bool door_reading_is_fresh(const DoorReading *reading, uint32_t now_ms, uint32_t max_age_ms);
const char *door_error_name(DoorError error);

#endif
