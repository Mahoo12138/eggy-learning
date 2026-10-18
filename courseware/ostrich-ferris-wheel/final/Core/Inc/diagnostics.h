#ifndef FERRIS_DIAGNOSTICS_H
#define FERRIS_DIAGNOSTICS_H

#include <stdbool.h>
#include <stddef.h>
#include <stdint.h>

enum { DIAGNOSTICS_CAPACITY = 32 };

typedef enum {
    DIAG_REASON_BOOT = 0,
    DIAG_REASON_SELF_TEST,
    DIAG_REASON_USER_START,
    DIAG_REASON_USER_STOP,
    DIAG_REASON_PARKED,
    DIAG_REASON_FAULT,
    DIAG_REASON_RESET,
    DIAG_REASON_SENSOR,
    DIAG_REASON_COMMAND
} DiagnosticReason;

typedef struct {
    uint32_t at_ms;
    int old_state;
    int new_state;
    DiagnosticReason reason;
    int error_code;
} DiagnosticEvent;

typedef struct {
    DiagnosticEvent entries[DIAGNOSTICS_CAPACITY];
    size_t head;
    size_t count;
    uint32_t overflow_count;
} Diagnostics;

void diagnostics_init(Diagnostics *diagnostics);
bool diagnostics_record_transition(Diagnostics *diagnostics,
                                   uint32_t at_ms,
                                   int old_state,
                                   int new_state,
                                   DiagnosticReason reason,
                                   int error_code);
bool diagnostics_pop(Diagnostics *diagnostics, DiagnosticEvent *out);
int diagnostics_format_event(const DiagnosticEvent *event, char *buffer, size_t capacity);
int diagnostics_format_banner(char *buffer,
                              size_t capacity,
                              const char *reset_reason,
                              const char *board_summary);
const char *diagnostics_reason_name(DiagnosticReason reason);

#endif
