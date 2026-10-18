#ifndef PATROL_SUPERVISOR_REPORT_H
#define PATROL_SUPERVISOR_REPORT_H

#include "supervisor/journal.h"
#include "supervisor/worker.h"

int report_drain_worker(Worker *worker, Journal *journal);

#endif
