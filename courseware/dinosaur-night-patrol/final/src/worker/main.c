#include "common/protocol.h"
#include "worker/checks.h"

#include <errno.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

static void usage(const char *program) {
  fprintf(stderr, "usage: %s --name NAME --mode ok|fail|hang|cpu --report-fd FD\n", program);
}

int main(int argc, char **argv) {
  const char *name = NULL;
  const char *mode = NULL;
  int report_fd = -1;
  for (int index = 1; index < argc; ++index) {
    if (strcmp(argv[index], "--name") == 0 && index + 1 < argc) {
      name = argv[++index];
    } else if (strcmp(argv[index], "--mode") == 0 && index + 1 < argc) {
      mode = argv[++index];
    } else if (strcmp(argv[index], "--report-fd") == 0 && index + 1 < argc) {
      char *end = NULL;
      long value = strtol(argv[++index], &end, 10);
      if (*argv[index] == '\0' || *end != '\0' || value < 0 || value > INT_MAX) {
        usage(argv[0]);
        return 64;
      }
      report_fd = (int)value;
    } else {
      usage(argv[0]);
      return 64;
    }
  }
  if (name == NULL || mode == NULL || report_fd < 0 || strlen(name) >= sizeof(((PatrolReport *)0)->worker)) {
    usage(argv[0]);
    return 64;
  }
  CheckResult check;
  if (checks_run(mode, &check) != 0) {
    perror("checks_run");
    return 65;
  }
  PatrolReport report;
  memset(&report, 0, sizeof(report));
  report.status = (uint8_t)check.status;
  (void)snprintf(report.worker, sizeof(report.worker), "%s", name);
  (void)snprintf(report.message, sizeof(report.message), "%s", check.message);
  if (protocol_write_report(report_fd, &report) != 0) {
    perror("protocol_write_report");
    return 74;
  }
  return check.status == 0 ? 0 : 2;
}
