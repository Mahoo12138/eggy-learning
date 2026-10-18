#include "common/clock.h"
#include "supervisor/deadline.h"

#include <assert.h>

int main(void) {
  WorkerTable table;
  worker_table_init(&table);
  Worker *first = worker_table_add(&table, "first", "ok");
  Worker *second = worker_table_add(&table, "second", "ok");
  assert(first != NULL && second != NULL);
  int64_t now = clock_monotonic_ms();
  first->phase = WORKER_RUNNING;
  first->deadline_ms = now + 80;
  second->phase = WORKER_RUNNING;
  second->deadline_ms = now + 250;
  assert(deadline_poll_timeout_ms(&table, now, 1000) == 80);
  assert(deadline_poll_timeout_ms(&table, now + 100, 1000) == 0);
  return 0;
}
