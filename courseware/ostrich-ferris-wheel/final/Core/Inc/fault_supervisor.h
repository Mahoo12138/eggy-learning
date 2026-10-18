#ifndef FERRIS_FAULT_SUPERVISOR_H
#define FERRIS_FAULT_SUPERVISOR_H

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    FERRIS_FAULT_NONE = 0,
    FERRIS_FAULT_EMERGENCY_STOP,
    FERRIS_FAULT_DOOR_UNLOCKED,
    FERRIS_FAULT_OVERLOAD,
    FERRIS_FAULT_DOOR_STALE,
    FERRIS_FAULT_EVENT_OVERFLOW,
    FERRIS_FAULT_HEALTH_TIMEOUT
} FerrisFault;

typedef struct {
    bool emergency_stop;
    bool door_valid;
    bool door_locked;
    bool overloaded;
    bool event_overflow;
    bool health_complete;
} FaultInputs;

typedef struct {
    FerrisFault active;
    FerrisFault latched;
    uint32_t first_seen_ms;
} FaultSnapshot;

typedef struct {
    FerrisFault latched;
    uint32_t first_seen_ms;
    uint32_t expected_health_mask;
    uint32_t observed_health_mask;
} FaultSupervisor;

void fault_supervisor_init(FaultSupervisor *supervisor, uint32_t expected_health_mask);
void fault_supervisor_begin_cycle(FaultSupervisor *supervisor);
void fault_supervisor_mark_health(FaultSupervisor *supervisor, uint32_t component_mask);
bool fault_supervisor_health_complete(const FaultSupervisor *supervisor);
FaultSnapshot fault_supervisor_evaluate(FaultSupervisor *supervisor,
                                        const FaultInputs *inputs,
                                        uint32_t now_ms);
bool fault_supervisor_clear_latch(FaultSupervisor *supervisor, const FaultInputs *inputs);
const char *ferris_fault_name(FerrisFault fault);

#endif
