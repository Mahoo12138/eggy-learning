#ifndef PATROL_SUPERVISOR_EVENT_LOOP_H
#define PATROL_SUPERVISOR_EVENT_LOOP_H

#include "supervisor/runtime.h"
#include "supervisor/spawn_profile.h"
#include "supervisor/worker.h"

typedef struct {
  const RuntimePaths *paths;
  const char *worker_program;
  int worker_timeout_ms;
  int termination_grace_ms;
  int stop_when_idle;
  SpawnProfile profile;
} EventLoopConfig;

int event_loop_run(const EventLoopConfig *config, WorkerTable *workers);

#endif
