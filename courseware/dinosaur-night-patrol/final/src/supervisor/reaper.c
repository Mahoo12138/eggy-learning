#include "supervisor/reaper.h"

#include <errno.h>
#include <stdio.h>
#include <sys/wait.h>

int reaper_drain(WorkerTable *table, Journal *journal) {
  int reaped = 0;
  for (;;) {
    int status = 0;
    pid_t pid = waitpid(-1, &status, WNOHANG);
    if (pid == 0) return reaped;
    if (pid < 0) {
      if (errno == EINTR) continue;
      return errno == ECHILD ? reaped : -1;
    }
    ++reaped;
    Worker *worker = worker_find_pid(table, pid);
    if (worker == NULL) continue;
    worker->phase = WORKER_EXITED;
    if (WIFEXITED(status)) worker->exit_code = WEXITSTATUS(status);
    if (WIFSIGNALED(status)) worker->term_signal = WTERMSIG(status);
    char detail[128];
    (void)snprintf(detail, sizeof(detail), "exit=%d signal=%d timeout=%d",
                   worker->exit_code, worker->term_signal, worker->timed_out);
    if (journal != NULL) (void)journal_append(journal, "worker_exit", worker->id, worker->name, detail);
  }
}
