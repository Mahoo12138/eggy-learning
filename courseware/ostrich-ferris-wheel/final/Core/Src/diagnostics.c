#include "diagnostics.h"

#include "board_config.h"

#include <stdio.h>

void diagnostics_init(Diagnostics *diagnostics) {
    if (diagnostics == NULL) {
        return;
    }
    diagnostics->head = 0U;
    diagnostics->count = 0U;
    diagnostics->overflow_count = 0U;
}

bool diagnostics_record_transition(Diagnostics *diagnostics,
                                   uint32_t at_ms,
                                   int old_state,
                                   int new_state,
                                   DiagnosticReason reason,
                                   int error_code) {
    if (diagnostics == NULL || old_state == new_state) {
        return false;
    }
    if (diagnostics->count == DIAGNOSTICS_CAPACITY) {
        diagnostics->overflow_count++;
        return false;
    }
    const size_t index = (diagnostics->head + diagnostics->count) % DIAGNOSTICS_CAPACITY;
    diagnostics->entries[index] = (DiagnosticEvent){
        .at_ms = at_ms,
        .old_state = old_state,
        .new_state = new_state,
        .reason = reason,
        .error_code = error_code,
    };
    diagnostics->count++;
    return true;
}

bool diagnostics_pop(Diagnostics *diagnostics, DiagnosticEvent *out) {
    if (diagnostics == NULL || out == NULL || diagnostics->count == 0U) {
        return false;
    }
    *out = diagnostics->entries[diagnostics->head];
    diagnostics->head = (diagnostics->head + 1U) % DIAGNOSTICS_CAPACITY;
    diagnostics->count--;
    return true;
}

const char *diagnostics_reason_name(DiagnosticReason reason) {
    switch (reason) {
        case DIAG_REASON_BOOT: return "boot";
        case DIAG_REASON_SELF_TEST: return "self-test";
        case DIAG_REASON_USER_START: return "user-start";
        case DIAG_REASON_USER_STOP: return "user-stop";
        case DIAG_REASON_PARKED: return "parked";
        case DIAG_REASON_FAULT: return "fault";
        case DIAG_REASON_RESET: return "reset";
        case DIAG_REASON_SENSOR: return "sensor";
        case DIAG_REASON_COMMAND: return "command";
        default: return "unknown";
    }
}

int diagnostics_format_event(const DiagnosticEvent *event, char *buffer, size_t capacity) {
    if (event == NULL || buffer == NULL || capacity == 0U) {
        return -1;
    }
    return snprintf(buffer,
                    capacity,
                    "[%lu ms] state %d -> %d reason=%s error=%d",
                    (unsigned long)event->at_ms,
                    event->old_state,
                    event->new_state,
                    diagnostics_reason_name(event->reason),
                    event->error_code);
}

int diagnostics_format_banner(char *buffer,
                              size_t capacity,
                              const char *reset_reason,
                              const char *board_summary) {
    if (buffer == NULL || capacity == 0U || reset_reason == NULL || board_summary == NULL) {
        return -1;
    }
    return snprintf(buffer,
                    capacity,
                    "FerrisControl %s | reset=%s | board=%s",
                    FERRIS_FIRMWARE_VERSION,
                    reset_reason,
                    board_summary);
}
