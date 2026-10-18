#ifndef FERRIS_FAKE_DOOR_BUS_H
#define FERRIS_FAKE_DOOR_BUS_H

#include "door_sensor.h"

#include <stddef.h>
#include <stdint.h>

enum { FAKE_DOOR_RESPONSE_CAPACITY = 16 };

typedef struct {
    DoorBusResult result;
    uint8_t bytes[2];
    size_t length;
} FakeDoorResponse;

typedef struct {
    FakeDoorResponse responses[FAKE_DOOR_RESPONSE_CAPACITY];
    size_t count;
    size_t next;
    uint8_t last_address;
    uint8_t last_register;
    uint32_t last_timeout_ms;
    DoorBusResult write_result;
    uint8_t last_written[2];
    size_t last_written_length;
} FakeDoorBus;

void fake_door_bus_init(FakeDoorBus *fake);
bool fake_door_bus_add(FakeDoorBus *fake,
                       DoorBusResult result,
                       uint8_t device_id,
                       uint8_t status,
                       size_t length);
DoorBus fake_door_bus_interface(FakeDoorBus *fake);

#endif
