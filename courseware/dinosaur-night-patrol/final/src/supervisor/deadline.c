#include "supervisor/deadline.h"

#include <errno.h>
#include <limits.h>
#include <signal.h>

int deadline_poll_timeout_ms(const WorkerTable *table, int64_t now_ms, int maximum_ms) {
  int64_t nearest = maximum_ms;
  for (size_t index = 0; index < table->count; ++index) {
    const Worker *worker = &table->items[index];
    int64_t target = 0;
    if (worker->phase == WORKER_RUNNING) target = worker->deadline_ms;
    if (worker->phase == WORKER_STOPPING) target = worker->kill_deadline_ms;
    if (target <= 0) continue;
    int64_t remaining = target - now_ms;
    if (remaining < 0) remaining = 0;
    if (remaining < nearest) nearest = remaining;
  }
  if (nearest > INT_MAX) return INT_MAX;
  return (int)nearest;
}

int deadline_enforce(WorkerTable *table, Journal *journal, int64_t now_ms, int grace_ms) {
  int actions = 0;
  for (size_t index = 0; index < table->count; ++index) {
    Worker *worker = &table->items[index];
    if (worker->phase == WORKER_RUNNING && now_ms >= worker->deadline_ms) {
      if (kill(-worker->process_group, SIGTERM) != 0 && errno != ESRCH) return -1;
      worker->timed_out = 1;
      worker->phase = WORKER_STOPPING;
      worker->kill_deadline_ms = now_ms + grace_ms;
      (void)journal_append(journal, "timeout_term", worker->id, worker->name, "process group SIGTERM");
      ++actions;
    } else if (worker->phase == WORKER_STOPPING && now_ms >= worker->kill_deadline_ms) {
      if (kill(-worker->process_group, SIGKILL) != 0 && errno != ESRCH) return -1;
      worker->kill_deadline_ms = INT64_MAX;
      (void)journal_append(journal, "timeout_kill", worker->id, worker->name, "process group SIGKILL");
      ++actions;
    }
  }
  return actions;
}
