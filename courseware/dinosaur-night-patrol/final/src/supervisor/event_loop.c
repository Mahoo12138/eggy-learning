#include "supervisor/event_loop.h"

#include "common/clock.h"
#include "supervisor/control.h"
#include "supervisor/deadline.h"
#include "supervisor/journal.h"
#include "supervisor/reaper.h"
#include "supervisor/report.h"
#include "supervisor/signal_bridge.h"
#include "supervisor/spawn.h"
#include "supervisor/state.h"

#include <errno.h>
#include <poll.h>
#include <signal.h>
#include <stdio.h>
#include <string.h>

typedef enum { POLL_SIGNAL, POLL_CONTROL, POLL_REPORT } PollKind;
typedef struct {
  PollKind kind;
  Worker *worker;
} PollSource;

static void request_stop(WorkerTable *workers, Journal *journal, int64_t now_ms, int grace_ms) {
  for (size_t index = 0; index < workers->count; ++index) {
    Worker *worker = &workers->items[index];
    if (worker->phase != WORKER_RUNNING) continue;
    if (kill(-worker->process_group, SIGTERM) != 0 && errno != ESRCH) continue;
    worker->phase = WORKER_STOPPING;
    worker->kill_deadline_ms = now_ms + grace_ms;
    (void)journal_append(journal, "shutdown_term", worker->id, worker->name, "process group SIGTERM");
  }
}

static int handle_control(const EventLoopConfig *config, ControlChannel *control,
                          WorkerTable *workers, Journal *journal, int *stop_requested) {
  for (;;) {
    ControlCommand command;
    int result = control_read_command(control, &command);
    if (result == 0) return 0;
    if (result < 0) {
      (void)journal_append(journal, "control_error", 0, "-", "invalid command");
      if (errno == EINVAL || errno == EMSGSIZE) continue;
      return -1;
    }
    if (command.kind == CONTROL_STATUS) {
      if (state_write_snapshot(config->paths->snapshot_file, workers) != 0) return -1;
      (void)journal_append(journal, "control_status", 0, "-", "snapshot refreshed");
    } else if (command.kind == CONTROL_STOP) {
      *stop_requested = 1;
      (void)journal_append(journal, "control_stop", 0, "-", "shutdown requested");
    } else if (command.kind == CONTROL_RUN) {
      Worker *worker = worker_table_add(workers, command.name, command.mode);
      if (worker == NULL || spawn_worker(worker, config->worker_program,
                                         config->worker_timeout_ms, &config->profile) != 0) {
        (void)journal_append(journal, "spawn_error", 0, command.name, strerror(errno));
        return -1;
      }
      (void)journal_append(journal, "worker_spawn", worker->id, worker->name, worker->mode);
    }
  }
}

int event_loop_run(const EventLoopConfig *config, WorkerTable *workers) {
  if (config == NULL || workers == NULL || config->paths == NULL ||
      config->worker_program == NULL || config->worker_timeout_ms <= 0 ||
      config->termination_grace_ms <= 0) {
    errno = EINVAL;
    return -1;
  }
  Journal journal = {.fd = -1};
  ControlChannel control = {.fd = -1};
  SignalBridge signals = {.read_fd = -1, .write_fd = -1};
  if (journal_open(&journal, config->paths->journal_file) != 0 ||
      control_open(&control, config->paths->control_fifo) != 0 ||
      signal_bridge_open(&signals) != 0) {
    int saved = errno;
    signal_bridge_close(&signals);
    control_close(&control);
    journal_close(&journal);
    errno = saved;
    return -1;
  }
  for (size_t index = 0; index < workers->count; ++index) {
    Worker *worker = &workers->items[index];
    if (worker->phase == WORKER_RUNNING)
      (void)journal_append(&journal, "worker_spawn", worker->id, worker->name, worker->mode);
  }
  int result = 0;
  int stop_requested = 0;
  if (state_write_snapshot(config->paths->snapshot_file, workers) != 0) result = -1;

  while (result == 0) {
    (void)reaper_drain(workers, &journal);
    size_t running = worker_running_count(workers);
    size_t open_reports = 0;
    for (size_t index = 0; index < workers->count; ++index) {
      if (workers->items[index].report_fd >= 0) ++open_reports;
    }
    if ((config->stop_when_idle || stop_requested) && running == 0 && open_reports == 0) break;
    if (stop_requested) request_stop(workers, &journal, clock_monotonic_ms(),
                                     config->termination_grace_ms);

    struct pollfd descriptors[2 + PATROL_MAX_WORKERS];
    PollSource sources[2 + PATROL_MAX_WORKERS];
    nfds_t count = 0;
    descriptors[count] = (struct pollfd){.fd = signals.read_fd, .events = POLLIN};
    sources[count++] = (PollSource){.kind = POLL_SIGNAL, .worker = NULL};
    descriptors[count] = (struct pollfd){.fd = control.fd, .events = POLLIN};
    sources[count++] = (PollSource){.kind = POLL_CONTROL, .worker = NULL};
    for (size_t index = 0; index < workers->count; ++index) {
      Worker *worker = &workers->items[index];
      if (worker->report_fd < 0) continue;
      descriptors[count] = (struct pollfd){.fd = worker->report_fd, .events = POLLIN | POLLHUP};
      sources[count++] = (PollSource){.kind = POLL_REPORT, .worker = worker};
    }

    int64_t now_ms = clock_monotonic_ms();
    int timeout = deadline_poll_timeout_ms(workers, now_ms, 1000);
    int ready = poll(descriptors, count, timeout);
    if (ready < 0 && errno != EINTR) {
      result = -1;
      break;
    }
    if (ready > 0) {
      for (nfds_t index = 0; index < count; ++index) {
        if (descriptors[index].revents == 0) continue;
        if (sources[index].kind == POLL_SIGNAL) {
          int saw_child;
          int saw_stop;
          if (signal_bridge_drain(&signals, &saw_child, &saw_stop) != 0) {
            result = -1;
            break;
          }
          if (saw_child) (void)reaper_drain(workers, &journal);
          if (saw_stop) stop_requested = 1;
        } else if (sources[index].kind == POLL_CONTROL) {
          if (handle_control(config, &control, workers, &journal, &stop_requested) != 0) {
            result = -1;
            break;
          }
        } else if (sources[index].worker->report_fd >= 0) {
          if (report_drain_worker(sources[index].worker, &journal) < 0) {
            (void)journal_append(&journal, "report_error", sources[index].worker->id,
                                 sources[index].worker->name, strerror(errno));
            result = -1;
            break;
          }
        }
      }
    }
    if (deadline_enforce(workers, &journal, clock_monotonic_ms(),
                         config->termination_grace_ms) < 0) result = -1;
    (void)reaper_drain(workers, &journal);
    if (state_write_snapshot(config->paths->snapshot_file, workers) != 0) result = -1;
  }

  if (result != 0 || stop_requested) {
    request_stop(workers, &journal, clock_monotonic_ms(), config->termination_grace_ms);
  }
  (void)state_write_snapshot(config->paths->snapshot_file, workers);
  signal_bridge_close(&signals);
  control_close(&control);
  journal_close(&journal);
  return result;
}
