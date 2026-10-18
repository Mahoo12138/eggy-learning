#ifndef PATROL_SUPERVISOR_WORKER_H
#define PATROL_SUPERVISOR_WORKER_H

#include "common/protocol.h"

#include <stddef.h>
#include <stdint.h>
#include <sys/types.h>

#define PATROL_MAX_WORKERS 32

typedef enum {
  WORKER_EMPTY = 0,
  WORKER_RUNNING,
  WORKER_STOPPING,
  WORKER_EXITED
} WorkerPhase;

typedef struct {
  int id;
  char name[64];
  char mode[32];
  pid_t pid;
  pid_t process_group;
  int report_fd;
  WorkerPhase phase;
  int exit_code;
  int term_signal;
  int timed_out;
  int report_received;
  int report_status;
  char report_message[512];
  int64_t started_ms;
  int64_t deadline_ms;
  int64_t kill_deadline_ms;
  PatrolFrameReader reader;
} Worker;

typedef struct {
  Worker items[PATROL_MAX_WORKERS];
  size_t count;
  int next_id;
} WorkerTable;

void worker_table_init(WorkerTable *table);
Worker *worker_table_add(WorkerTable *table, const char *name, const char *mode);
Worker *worker_find_pid(WorkerTable *table, pid_t pid);
Worker *worker_find_report_fd(WorkerTable *table, int fd);
size_t worker_running_count(const WorkerTable *table);
void worker_close_report(Worker *worker);
const char *worker_phase_name(WorkerPhase phase);

#endif
