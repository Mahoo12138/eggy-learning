#include "ferris_controller.h"

#include <stddef.h>

void ferris_controller_init(FerrisController *controller) {
    if (controller == NULL) {
        return;
    }
    controller->state = FERRIS_STATE_BOOT;
    controller->requested_drive_permille = 0U;
    controller->fault_latch = FERRIS_FAULT_NONE;
}

bool ferris_controller_update(FerrisController *controller,
                              const FerrisControllerInputs *inputs) {
    if (controller == NULL || inputs == NULL) {
        return false;
    }
    const FerrisState before = controller->state;

    if (inputs->fault.active != FERRIS_FAULT_NONE ||
        inputs->fault.latched != FERRIS_FAULT_NONE) {
        controller->state = FERRIS_STATE_FAULT;
        controller->fault_latch = inputs->fault.latched != FERRIS_FAULT_NONE
                                      ? inputs->fault.latched
                                      : inputs->fault.active;
    } else {
        switch (controller->state) {
            case FERRIS_STATE_BOOT:
                controller->state = FERRIS_STATE_SELF_TEST;
                break;
            case FERRIS_STATE_SELF_TEST:
                if (inputs->self_test_complete) {
                    if (inputs->self_test_ok) {
                        controller->state = FERRIS_STATE_READY;
                    } else {
                        controller->state = FERRIS_STATE_FAULT;
                        controller->fault_latch = FERRIS_FAULT_HEALTH_TIMEOUT;
                    }
                }
                break;
            case FERRIS_STATE_READY:
                if (inputs->start_requested) {
                    controller->state = FERRIS_STATE_RUNNING;
                }
                break;
            case FERRIS_STATE_RUNNING:
                if (inputs->stop_requested) {
                    controller->state = FERRIS_STATE_PARKING;
                }
                break;
            case FERRIS_STATE_PARKING:
                if (inputs->parked) {
                    controller->state = FERRIS_STATE_READY;
                }
                break;
            case FERRIS_STATE_FAULT:
                if (inputs->reset_requested) {
                    controller->state = FERRIS_STATE_RESETTING;
                    controller->fault_latch = FERRIS_FAULT_NONE;
                }
                break;
            case FERRIS_STATE_RESETTING:
                controller->state = FERRIS_STATE_BOOT;
                break;
            default:
                controller->state = FERRIS_STATE_FAULT;
                controller->fault_latch = FERRIS_FAULT_HEALTH_TIMEOUT;
                break;
        }
    }
    controller->requested_drive_permille = controller->state == FERRIS_STATE_RUNNING
                                               ? 650U
                                               : 0U;
    return before != controller->state;
}

const char *ferris_state_name(FerrisState state) {
    switch (state) {
        case FERRIS_STATE_BOOT: return "BOOT";
        case FERRIS_STATE_SELF_TEST: return "SELF_TEST";
        case FERRIS_STATE_READY: return "READY";
        case FERRIS_STATE_RUNNING: return "RUNNING";
        case FERRIS_STATE_PARKING: return "PARKING";
        case FERRIS_STATE_FAULT: return "FAULT";
        case FERRIS_STATE_RESETTING: return "RESETTING";
        default: return "UNKNOWN";
    }
}
