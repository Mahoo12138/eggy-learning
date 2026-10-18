#include "supervisor/spawn.h"

#include "common/clock.h"
#include "common/io.h"

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

static int create_pipe_cloexec(int descriptors[2]) {
#ifdef __linux__
  if (pipe2(descriptors, O_CLOEXEC) == 0) return 0;
  if (errno != ENOSYS) return -1;
#endif
  if (pipe(descriptors) != 0) return -1;
  if (io_set_cloexec(descriptors[0]) != 0 || io_set_cloexec(descriptors[1]) != 0) {
    int saved = errno;
    close(descriptors[0]);
    close(descriptors[1]);
    errno = saved;
    return -1;
  }
  return 0;
}

static void terminate_and_reap_child(pid_t pid) {
  (void)kill(pid, SIGKILL);
  while (waitpid(pid, NULL, 0) < 0 && errno == EINTR) {
  }
}

int spawn_worker(Worker *worker, const char *worker_program, int timeout_ms,
                 const SpawnProfile *profile) {
  if (worker == NULL || worker_program == NULL || timeout_ms <= 0 || profile == NULL) {
    errno = EINVAL;
    return -1;
  }
  int report_pipe[2];
  if (create_pipe_cloexec(report_pipe) != 0) return -1;

  pid_t pid = fork();
  if (pid < 0) {
    int saved = errno;
    close(report_pipe[0]);
    close(report_pipe[1]);
    errno = saved;
    return -1;
  }
  if (pid == 0) {
    close(report_pipe[0]);
    if (setpgid(0, 0) != 0 || spawn_profile_apply(profile) != 0) _exit(125);
    if (dup2(report_pipe[1], 3) < 0) _exit(125);
    if (report_pipe[1] != 3) close(report_pipe[1]);
    int flags = fcntl(3, F_GETFD);
    if (flags < 0 || fcntl(3, F_SETFD, flags & ~FD_CLOEXEC) != 0) _exit(125);
    execl(worker_program, worker_program, "--name", worker->name, "--mode", worker->mode,
          "--report-fd", "3", (char *)NULL);
    _exit(errno == ENOENT ? 127 : 126);
  }

  close(report_pipe[1]);
  if (io_set_nonblocking(report_pipe[0]) != 0) {
    int saved = errno;
    close(report_pipe[0]);
    /* The worker has not been added to the table yet, so the normal reaper
       cannot own this failure path. Reap it here instead of leaving a zombie. */
    terminate_and_reap_child(pid);
    errno = saved;
    return -1;
  }
  (void)setpgid(pid, pid);
  worker->pid = pid;
  worker->process_group = pid;
  worker->report_fd = report_pipe[0];
  worker->phase = WORKER_RUNNING;
  worker->started_ms = clock_monotonic_ms();
  worker->deadline_ms = worker->started_ms + timeout_ms;
  worker->kill_deadline_ms = 0;
  return 0;
}
