#include "fake_door_bus.h"

#include <string.h>

static DoorBusResult fake_read(void *context,
                               uint8_t address,
                               uint8_t register_address,
                               uint8_t *output,
                               size_t capacity,
                               size_t *received,
                               uint32_t timeout_ms) {
    FakeDoorBus *fake = context;
    if (received != NULL) {
        *received = 0U;
    }
    if (fake == NULL || output == NULL || received == NULL || fake->next >= fake->count) {
        return DOOR_BUS_IO_ERROR;
    }
    fake->last_address = address;
    fake->last_register = register_address;
    fake->last_timeout_ms = timeout_ms;
    const FakeDoorResponse response = fake->responses[fake->next++];
    if (response.result != DOOR_BUS_OK) {
        return response.result;
    }
    const size_t copied = response.length < capacity ? response.length : capacity;
    memcpy(output, response.bytes, copied);
    *received = copied;
    return DOOR_BUS_OK;
}

static DoorBusResult fake_write(void *context,
                                uint8_t address,
                                uint8_t register_address,
                                const uint8_t *data,
                                size_t length,
                                uint32_t timeout_ms) {
    FakeDoorBus *fake = context;
    if (fake == NULL || data == NULL || length > sizeof(fake->last_written)) {
        return DOOR_BUS_IO_ERROR;
    }
    fake->last_address = address;
    fake->last_register = register_address;
    fake->last_timeout_ms = timeout_ms;
    memcpy(fake->last_written, data, length);
    fake->last_written_length = length;
    return fake->write_result;
}

void fake_door_bus_init(FakeDoorBus *fake) {
    if (fake != NULL) {
        memset(fake, 0, sizeof(*fake));
        fake->write_result = DOOR_BUS_OK;
    }
}

bool fake_door_bus_add(FakeDoorBus *fake,
                       DoorBusResult result,
                       uint8_t device_id,
                       uint8_t status,
                       size_t length) {
    if (fake == NULL || fake->count >= FAKE_DOOR_RESPONSE_CAPACITY || length > 2U) {
        return false;
    }
    fake->responses[fake->count++] = (FakeDoorResponse){
        .result = result,
        .bytes = {device_id, status},
        .length = length,
    };
    return true;
}

DoorBus fake_door_bus_interface(FakeDoorBus *fake) {
    const DoorBus bus = {.read = fake_read, .write = fake_write, .context = fake};
    return bus;
}
