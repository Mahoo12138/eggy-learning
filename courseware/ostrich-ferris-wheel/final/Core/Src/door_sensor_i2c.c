#include "door_sensor.h"

#include "app_time.h"

#include <stddef.h>

DoorReading door_sensor_read(const DoorBus *bus, uint32_t now_ms, uint32_t timeout_ms) {
    DoorReading reading = {
        .valid = false,
        .locked = false,
        .error = DOOR_ERROR_INVALID_BUS,
        .sampled_at_ms = now_ms,
    };
    if (bus == NULL || bus->read == NULL) {
        return reading;
    }
    uint8_t bytes[2] = {0U, 0U};
    size_t received = 0U;
    const DoorBusResult result = bus->read(bus->context,
                                           DOOR_SENSOR_ADDRESS,
                                           DOOR_SENSOR_STATUS_REGISTER,
                                           bytes,
                                           sizeof(bytes),
                                           &received,
                                           timeout_ms);
    if (result != DOOR_BUS_OK) {
        reading.error = result == DOOR_BUS_NACK
                            ? DOOR_ERROR_NACK
                            : (result == DOOR_BUS_TIMEOUT ? DOOR_ERROR_TIMEOUT : DOOR_ERROR_IO);
        return reading;
    }
    if (received != sizeof(bytes)) {
        reading.error = DOOR_ERROR_SHORT_DATA;
        return reading;
    }
    if (bytes[0] != DOOR_SENSOR_EXPECTED_ID) {
        reading.error = DOOR_ERROR_WRONG_DEVICE;
        return reading;
    }
    if ((bytes[1] & (uint8_t)~DOOR_SENSOR_KNOWN_STATUS_MASK) != 0U) {
        reading.error = DOOR_ERROR_INVALID_STATUS;
        return reading;
    }
    reading.valid = true;
    reading.locked = (bytes[1] & DOOR_SENSOR_LOCKED_MASK) != 0U;
    reading.error = DOOR_ERROR_NONE;
    return reading;
}

bool door_reading_is_fresh(const DoorReading *reading, uint32_t now_ms, uint32_t max_age_ms) {
    return reading != NULL && reading->valid &&
           app_elapsed(now_ms, reading->sampled_at_ms) <= max_age_ms;
}

const char *door_error_name(DoorError error) {
    switch (error) {
        case DOOR_ERROR_NONE: return "none";
        case DOOR_ERROR_INVALID_BUS: return "invalid-bus";
        case DOOR_ERROR_NACK: return "nack";
        case DOOR_ERROR_TIMEOUT: return "timeout";
        case DOOR_ERROR_IO: return "io-error";
        case DOOR_ERROR_SHORT_DATA: return "short-data";
        case DOOR_ERROR_WRONG_DEVICE: return "wrong-device";
        case DOOR_ERROR_INVALID_STATUS: return "invalid-status";
        case DOOR_ERROR_STALE: return "stale";
        default: return "unknown";
    }
}
