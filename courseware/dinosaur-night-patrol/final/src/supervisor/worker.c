#include "supervisor/worker.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

void worker_table_init(WorkerTable *table) {
  memset(table, 0, sizeof(*table));
  table->next_id = 1;
  for (size_t index = 0; index < PATROL_MAX_WORKERS; ++index) table->items[index].report_fd = -1;
}

Worker *worker_table_add(WorkerTable *table, const char *name, const char *mode) {
  if (table == NULL || name == NULL || mode == NULL || table->count >= PATROL_MAX_WORKERS) {
    errno = ENOSPC;
    return NULL;
  }
  Worker *worker = &table->items[table->count++];
  memset(worker, 0, sizeof(*worker));
  worker->id = table->next_id++;
  worker->report_fd = -1;
  worker->exit_code = -1;
  worker->phase = WORKER_EMPTY;
  (void)snprintf(worker->name, sizeof(worker->name), "%s", name);
  (void)snprintf(worker->mode, sizeof(worker->mode), "%s", mode);
  protocol_reader_init(&worker->reader);
  return worker;
}

Worker *worker_find_pid(WorkerTable *table, pid_t pid) {
  for (size_t index = 0; index < table->count; ++index) {
    if (table->items[index].pid == pid) return &table->items[index];
  }
  return NULL;
}

Worker *worker_find_report_fd(WorkerTable *table, int fd) {
  for (size_t index = 0; index < table->count; ++index) {
    if (table->items[index].report_fd == fd) return &table->items[index];
  }
  return NULL;
}

size_t worker_running_count(const WorkerTable *table) {
  size_t count = 0;
  for (size_t index = 0; index < table->count; ++index) {
    if (table->items[index].phase == WORKER_RUNNING || table->items[index].phase == WORKER_STOPPING) ++count;
  }
  return count;
}

void worker_close_report(Worker *worker) {
  if (worker->report_fd >= 0) {
    close(worker->report_fd);
    worker->report_fd = -1;
  }
}

const char *worker_phase_name(WorkerPhase phase) {
  switch (phase) {
    case WORKER_EMPTY: return "empty";
    case WORKER_RUNNING: return "running";
    case WORKER_STOPPING: return "stopping";
    case WORKER_EXITED: return "exited";
  }
  return "unknown";
}
