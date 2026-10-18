#ifndef PATROL_SUPERVISOR_RUNTIME_H
#define PATROL_SUPERVISOR_RUNTIME_H

#include <limits.h>

typedef struct {
  char directory[PATH_MAX];
  char control_fifo[PATH_MAX];
  char journal_file[PATH_MAX];
  char snapshot_file[PATH_MAX];
} RuntimePaths;

int runtime_prepare(RuntimePaths *paths, const char *directory);
void runtime_cleanup(const RuntimePaths *paths);

#endif
