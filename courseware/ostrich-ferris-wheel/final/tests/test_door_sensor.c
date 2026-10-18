#include "app_time.h"
#include "door_sensor.h"
#include "fake_door_bus.h"
#include "test_support.h"

int main(void) {
    FakeDoorBus fake;
    fake_door_bus_init(&fake);
    TEST_ASSERT(fake_door_bus_add(&fake, DOOR_BUS_OK, DOOR_SENSOR_EXPECTED_ID, 1U, 2U));
    TEST_ASSERT(fake_door_bus_add(&fake, DOOR_BUS_NACK, 0U, 0U, 0U));
    TEST_ASSERT(fake_door_bus_add(&fake, DOOR_BUS_TIMEOUT, 0U, 0U, 0U));
    TEST_ASSERT(fake_door_bus_add(&fake, DOOR_BUS_OK, 0U, 0U, 1U));
    TEST_ASSERT(fake_door_bus_add(&fake, DOOR_BUS_OK, 0x55U, 0U, 2U));
    TEST_ASSERT(fake_door_bus_add(&fake, DOOR_BUS_OK, DOOR_SENSOR_EXPECTED_ID, 0x80U, 2U));
    const DoorBus bus = fake_door_bus_interface(&fake);

    const uint8_t configuration = 0x5AU;
    TEST_ASSERT_EQ(DOOR_BUS_OK,
                   bus.write(bus.context,
                             DOOR_SENSOR_ADDRESS,
                             0x02U,
                             &configuration,
                             1U,
                             7U));
    TEST_ASSERT_EQ(0x02, fake.last_register);
    TEST_ASSERT_EQ(0x5A, fake.last_written[0]);
    TEST_ASSERT_EQ(1, fake.last_written_length);

    DoorReading reading = door_sensor_read(&bus, UINT32_MAX - 10U, 20U);
    TEST_ASSERT(reading.valid && reading.locked);
    TEST_ASSERT_EQ(DOOR_SENSOR_ADDRESS, fake.last_address);
    TEST_ASSERT_EQ(DOOR_SENSOR_STATUS_REGISTER, fake.last_register);
    TEST_ASSERT(door_reading_is_fresh(&reading, 9U, 20U));
    TEST_ASSERT(!door_reading_is_fresh(&reading, 10U, 20U));

    reading = door_sensor_read(&bus, 1U, 20U);
    TEST_ASSERT_EQ(DOOR_ERROR_NACK, reading.error);
    reading = door_sensor_read(&bus, 2U, 20U);
    TEST_ASSERT_EQ(DOOR_ERROR_TIMEOUT, reading.error);
    reading = door_sensor_read(&bus, 3U, 20U);
    TEST_ASSERT_EQ(DOOR_ERROR_SHORT_DATA, reading.error);
    reading = door_sensor_read(&bus, 4U, 20U);
    TEST_ASSERT_EQ(DOOR_ERROR_WRONG_DEVICE, reading.error);
    reading = door_sensor_read(&bus, 5U, 20U);
    TEST_ASSERT_EQ(DOOR_ERROR_INVALID_STATUS, reading.error);
    TEST_PASS();
}
