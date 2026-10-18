#include "supervisor/control.h"
#include "supervisor/event_loop.h"

#include <assert.h>
#include <errno.h>
#include <string.h>

int main(void) {
  ControlCommand command;
  assert(control_parse_line("status", &command) == 1 && command.kind == CONTROL_STATUS);
  assert(control_parse_line("run gate ok", &command) == 1 && command.kind == CONTROL_RUN);
  assert(strcmp(command.name, "gate") == 0 && strcmp(command.mode, "ok") == 0);
  assert(control_parse_line("run gate unknown", &command) == -1 && errno == EINVAL);
  WorkerTable workers;
  worker_table_init(&workers);
  assert(event_loop_run(NULL, &workers) == -1 && errno == EINVAL);
  return 0;
}
