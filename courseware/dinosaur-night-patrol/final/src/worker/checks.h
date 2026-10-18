#ifndef PATROL_WORKER_CHECKS_H
#define PATROL_WORKER_CHECKS_H

#include <stddef.h>

typedef struct {
  int status;
  char message[256];
} CheckResult;

int checks_run(const char *mode, CheckResult *result);

#endif
