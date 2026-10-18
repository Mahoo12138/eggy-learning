#ifndef PATROL_SUPERVISOR_STATE_H
#define PATROL_SUPERVISOR_STATE_H

#include "supervisor/worker.h"

#include <stddef.h>

int state_render_json(const WorkerTable *table, char *buffer, size_t capacity);
int state_write_snapshot(const char *path, const WorkerTable *table);

#endif
