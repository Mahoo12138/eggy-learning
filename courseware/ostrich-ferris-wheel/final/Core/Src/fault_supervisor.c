#include "fault_supervisor.h"

#include <stddef.h>

static FerrisFault select_fault(const FaultInputs *inputs) {
    if (inputs == NULL) {
        return FERRIS_FAULT_HEALTH_TIMEOUT;
    }
    if (inputs->emergency_stop) {
        return FERRIS_FAULT_EMERGENCY_STOP;
    }
    if (inputs->door_valid && !inputs->door_locked) {
        return FERRIS_FAULT_DOOR_UNLOCKED;
    }
    if (inputs->overloaded) {
        return FERRIS_FAULT_OVERLOAD;
    }
    if (!inputs->door_valid) {
        return FERRIS_FAULT_DOOR_STALE;
    }
    if (inputs->event_overflow) {
        return FERRIS_FAULT_EVENT_OVERFLOW;
    }
    if (!inputs->health_complete) {
        return FERRIS_FAULT_HEALTH_TIMEOUT;
    }
    return FERRIS_FAULT_NONE;
}

void fault_supervisor_init(FaultSupervisor *supervisor, uint32_t expected_health_mask) {
    if (supervisor == NULL) {
        return;
    }
    supervisor->latched = FERRIS_FAULT_NONE;
    supervisor->first_seen_ms = 0U;
    supervisor->expected_health_mask = expected_health_mask;
    supervisor->observed_health_mask = 0U;
}

void fault_supervisor_begin_cycle(FaultSupervisor *supervisor) {
    if (supervisor != NULL) {
        supervisor->observed_health_mask = 0U;
    }
}

void fault_supervisor_mark_health(FaultSupervisor *supervisor, uint32_t component_mask) {
    if (supervisor != NULL) {
        supervisor->observed_health_mask |= component_mask;
    }
}

bool fault_supervisor_health_complete(const FaultSupervisor *supervisor) {
    return supervisor != NULL &&
           (supervisor->observed_health_mask & supervisor->expected_health_mask) ==
               supervisor->expected_health_mask;
}

FaultSnapshot fault_supervisor_evaluate(FaultSupervisor *supervisor,
                                        const FaultInputs *inputs,
                                        uint32_t now_ms) {
    FaultSnapshot snapshot = {
        .active = select_fault(inputs),
        .latched = FERRIS_FAULT_NONE,
        .first_seen_ms = 0U,
    };
    if (supervisor == NULL) {
        snapshot.active = FERRIS_FAULT_HEALTH_TIMEOUT;
        snapshot.latched = snapshot.active;
        snapshot.first_seen_ms = now_ms;
        return snapshot;
    }
    if (snapshot.active != FERRIS_FAULT_NONE && supervisor->latched == FERRIS_FAULT_NONE) {
        supervisor->latched = snapshot.active;
        supervisor->first_seen_ms = now_ms;
    }
    snapshot.latched = supervisor->latched;
    snapshot.first_seen_ms = supervisor->first_seen_ms;
    return snapshot;
}

bool fault_supervisor_clear_latch(FaultSupervisor *supervisor, const FaultInputs *inputs) {
    if (supervisor == NULL || select_fault(inputs) != FERRIS_FAULT_NONE) {
        return false;
    }
    supervisor->latched = FERRIS_FAULT_NONE;
    supervisor->first_seen_ms = 0U;
    return true;
}

const char *ferris_fault_name(FerrisFault fault) {
    switch (fault) {
        case FERRIS_FAULT_NONE: return "none";
        case FERRIS_FAULT_EMERGENCY_STOP: return "emergency-stop";
        case FERRIS_FAULT_DOOR_UNLOCKED: return "door-unlocked";
        case FERRIS_FAULT_OVERLOAD: return "overload";
        case FERRIS_FAULT_DOOR_STALE: return "door-stale";
        case FERRIS_FAULT_EVENT_OVERFLOW: return "event-overflow";
        case FERRIS_FAULT_HEALTH_TIMEOUT: return "health-timeout";
        default: return "unknown";
    }
}
