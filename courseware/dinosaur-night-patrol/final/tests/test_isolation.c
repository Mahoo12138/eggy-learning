#include "supervisor/spawn_profile.h"

#include <assert.h>
#include <sys/resource.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
  pid_t pid = fork();
  assert(pid >= 0);
  if (pid == 0) {
    SpawnProfile profile = {.cpu_seconds = 1, .address_space_bytes = 64U * 1024U * 1024U, .open_files = 24};
    if (spawn_profile_apply(&profile) != 0) _exit(1);
    struct rlimit limit;
    if (getrlimit(RLIMIT_NOFILE, &limit) != 0 || limit.rlim_cur != 24) _exit(2);
    _exit(0);
  }
  int status;
  assert(waitpid(pid, &status, 0) == pid);
  assert(WIFEXITED(status) && WEXITSTATUS(status) == 0);
  return 0;
}
