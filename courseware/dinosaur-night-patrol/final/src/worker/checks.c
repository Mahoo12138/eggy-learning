#include "worker/checks.h"

#include <errno.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

int checks_run(const char *mode, CheckResult *result) {
  if (mode == NULL || result == NULL) {
    errno = EINVAL;
    return -1;
  }
  memset(result, 0, sizeof(*result));
  if (strcmp(mode, "ok") == 0) {
    result->status = 0;
    (void)snprintf(result->message, sizeof(result->message),
                   "巡检通过: pid=%ld cwd 可访问", (long)getpid());
    return 0;
  }
  if (strcmp(mode, "fail") == 0) {
    result->status = 1;
    (void)snprintf(result->message, sizeof(result->message), "巡检失败: 模拟传感器离线");
    return 0;
  }
  if (strcmp(mode, "hang") == 0) {
    for (;;) pause();
  }
  if (strcmp(mode, "cpu") == 0) {
    volatile unsigned long long value = 1;
    for (;;) value = value * 6364136223846793005ULL + 1;
  }
  errno = EINVAL;
  return -1;
}
