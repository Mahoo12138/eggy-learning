#include "fault_supervisor.h"
#include "ferris_controller.h"
#include "test_support.h"

static FaultInputs healthy_inputs(void) {
    return (FaultInputs){
        .emergency_stop = false,
        .door_valid = true,
        .door_locked = true,
        .overloaded = false,
        .event_overflow = false,
        .health_complete = true,
    };
}

int main(void) {
    FaultSupervisor supervisor;
    fault_supervisor_init(&supervisor, 0x0FU);
    fault_supervisor_begin_cycle(&supervisor);
    fault_supervisor_mark_health(&supervisor, 0x01U);
    fault_supervisor_mark_health(&supervisor, 0x02U);
    TEST_ASSERT(!fault_supervisor_health_complete(&supervisor));
    fault_supervisor_mark_health(&supervisor, 0x0CU);
    TEST_ASSERT(fault_supervisor_health_complete(&supervisor));

    FaultInputs faults = healthy_inputs();
    faults.door_locked = false;
    faults.overloaded = true;
    FaultSnapshot snapshot = fault_supervisor_evaluate(&supervisor, &faults, 100U);
    TEST_ASSERT_EQ(FERRIS_FAULT_DOOR_UNLOCKED, snapshot.active);
    TEST_ASSERT_EQ(FERRIS_FAULT_DOOR_UNLOCKED, snapshot.latched);
    faults.door_locked = true;
    snapshot = fault_supervisor_evaluate(&supervisor, &faults, 110U);
    TEST_ASSERT_EQ(FERRIS_FAULT_OVERLOAD, snapshot.active);
    TEST_ASSERT_EQ(FERRIS_FAULT_DOOR_UNLOCKED, snapshot.latched);
    faults = healthy_inputs();
    TEST_ASSERT(fault_supervisor_clear_latch(&supervisor, &faults));

    FerrisController controller;
    ferris_controller_init(&controller);
    FerrisControllerInputs inputs = {
        .self_test_complete = false,
        .self_test_ok = false,
        .start_requested = false,
        .stop_requested = false,
        .reset_requested = false,
        .parked = false,
        .fault = {.active = FERRIS_FAULT_NONE, .latched = FERRIS_FAULT_NONE, .first_seen_ms = 0U},
    };
    TEST_ASSERT(ferris_controller_update(&controller, &inputs));
    TEST_ASSERT_EQ(FERRIS_STATE_SELF_TEST, controller.state);
    inputs.self_test_complete = true;
    inputs.self_test_ok = true;
    TEST_ASSERT(ferris_controller_update(&controller, &inputs));
    TEST_ASSERT_EQ(FERRIS_STATE_READY, controller.state);
    inputs.start_requested = true;
    TEST_ASSERT(ferris_controller_update(&controller, &inputs));
    TEST_ASSERT_EQ(FERRIS_STATE_RUNNING, controller.state);
    TEST_ASSERT_EQ(650, controller.requested_drive_permille);

    inputs.fault.active = FERRIS_FAULT_EMERGENCY_STOP;
    inputs.fault.latched = FERRIS_FAULT_EMERGENCY_STOP;
    TEST_ASSERT(ferris_controller_update(&controller, &inputs));
    TEST_ASSERT_EQ(FERRIS_STATE_FAULT, controller.state);
    TEST_ASSERT_EQ(0, controller.requested_drive_permille);

    for (int state = FERRIS_STATE_BOOT; state <= FERRIS_STATE_RESETTING; ++state) {
        ferris_controller_init(&controller);
        controller.state = (FerrisState)state;
        inputs = (FerrisControllerInputs){
            .fault = {.active = FERRIS_FAULT_EMERGENCY_STOP,
                      .latched = FERRIS_FAULT_EMERGENCY_STOP,
                      .first_seen_ms = 1U},
        };
        (void)ferris_controller_update(&controller, &inputs);
        TEST_ASSERT_EQ(FERRIS_STATE_FAULT, controller.state);
        TEST_ASSERT_EQ(0, controller.requested_drive_permille);
    }
    TEST_PASS();
}
