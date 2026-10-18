#ifndef PATROL_SUPERVISOR_SPAWN_H
#define PATROL_SUPERVISOR_SPAWN_H

#include "supervisor/spawn_profile.h"
#include "supervisor/worker.h"

int spawn_worker(Worker *worker, const char *worker_program, int timeout_ms,
                 const SpawnProfile *profile);

#endif
