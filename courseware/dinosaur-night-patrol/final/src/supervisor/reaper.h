#ifndef PATROL_SUPERVISOR_REAPER_H
#define PATROL_SUPERVISOR_REAPER_H

#include "supervisor/journal.h"
#include "supervisor/worker.h"

int reaper_drain(WorkerTable *table, Journal *journal);

#endif
