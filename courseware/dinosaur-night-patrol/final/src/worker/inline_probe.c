#include <stdio.h>
#include <stdlib.h>
#include <sys/wait.h>
#include <unistd.h>

int main(void) {
  int value = 7;
  pid_t pid = fork();
  if (pid < 0) {
    perror("fork");
    return 1;
  }
  if (pid == 0) {
    value = 42;
    printf("child pid=%ld value=%d\n", (long)getpid(), value);
    fflush(stdout);
    _exit(0);
  }
  int status;
  if (waitpid(pid, &status, 0) < 0) {
    perror("waitpid");
    return 1;
  }
  printf("parent pid=%ld child=%ld value=%d exit=%d\n", (long)getpid(), (long)pid,
         value, WIFEXITED(status) ? WEXITSTATUS(status) : -1);
  return 0;
}
