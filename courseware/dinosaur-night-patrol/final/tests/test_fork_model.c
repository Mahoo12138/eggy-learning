#include <assert.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
  int value = 7;
  pid_t pid = fork();
  assert(pid >= 0);
  if (pid == 0) {
    value = 99;
    _exit(value == 99 ? 0 : 1);
  }
  int status;
  assert(waitpid(pid, &status, 0) == pid);
  assert(WIFEXITED(status) && WEXITSTATUS(status) == 0);
  assert(value == 7);
  return 0;
}
