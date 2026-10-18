#include "supervisor/spawn.h"
#include "supervisor/worker.h"

#include <assert.h>
#include <sys/wait.h>

int main(void) {
  WorkerTable table;
  worker_table_init(&table);
  Worker *worker = worker_table_add(&table, "probe", "ok");
  assert(worker != NULL);
  SpawnProfile profile = spawn_profile_default();
  assert(spawn_worker(worker, "/bin/true", 1000, &profile) == 0);
  assert(worker->pid > 0 && worker->process_group == worker->pid && worker->report_fd >= 0);
  int status;
  assert(waitpid(worker->pid, &status, 0) == worker->pid);
  assert(WIFEXITED(status));
  worker_close_report(worker);
  return 0;
}
