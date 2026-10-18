#ifndef PATROL_SUPERVISOR_DEADLINE_H
#define PATROL_SUPERVISOR_DEADLINE_H

#include "supervisor/journal.h"
#include "supervisor/worker.h"

#include <stdint.h>

int deadline_poll_timeout_ms(const WorkerTable *table, int64_t now_ms, int maximum_ms);
int deadline_enforce(WorkerTable *table, Journal *journal, int64_t now_ms, int grace_ms);

#endif
