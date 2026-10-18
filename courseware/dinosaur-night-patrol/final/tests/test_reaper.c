#include "supervisor/reaper.h"

#include <assert.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
  WorkerTable table;
  worker_table_init(&table);
  Worker *worker = worker_table_add(&table, "short", "ok");
  assert(worker != NULL);
  pid_t pid = fork();
  assert(pid >= 0);
  if (pid == 0) _exit(7);
  worker->pid = pid;
  worker->phase = WORKER_RUNNING;
  for (int attempt = 0; attempt < 100 && worker->phase != WORKER_EXITED; ++attempt) {
    (void)reaper_drain(&table, NULL);
    usleep(1000);
  }
  assert(worker->phase == WORKER_EXITED);
  assert(worker->exit_code == 7);
  assert(worker_running_count(&table) == 0);
  return 0;
}
