#include "common/fs.h"
#include "common/io.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

static void usage(const char *program) {
  fprintf(stderr, "usage: %s --runtime DIR status|stop|run NAME MODE\n", program);
}

int main(int argc, char **argv) {
  if (argc < 4 || strcmp(argv[1], "--runtime") != 0) {
    usage(argv[0]);
    return 64;
  }
  const char *runtime = argv[2];
  const char *verb = argv[3];
  char command[256];
  if (strcmp(verb, "status") == 0 || strcmp(verb, "stop") == 0) {
    if (argc != 4) {
      usage(argv[0]);
      return 64;
    }
    (void)snprintf(command, sizeof(command), "%s\n", verb);
  } else if (strcmp(verb, "run") == 0 && argc == 6) {
    int length = snprintf(command, sizeof(command), "run %s %s\n", argv[4], argv[5]);
    if (length < 0 || (size_t)length >= sizeof(command)) return 64;
  } else {
    usage(argv[0]);
    return 64;
  }
  char fifo[PATH_MAX];
  char snapshot[PATH_MAX];
  if (snprintf(fifo, sizeof(fifo), "%s/control.fifo", runtime) >= (int)sizeof(fifo) ||
      snprintf(snapshot, sizeof(snapshot), "%s/state.json", runtime) >= (int)sizeof(snapshot)) return 64;
  int fd = open(fifo, O_WRONLY | O_NONBLOCK | O_CLOEXEC);
  if (fd < 0) {
    perror("open control fifo");
    return 69;
  }
  int result = io_write_all(fd, command, strlen(command)) < 0 ? -1 : 0;
  int saved = errno;
  close(fd);
  if (result != 0) {
    errno = saved;
    perror("write command");
    return 74;
  }
  if (strcmp(verb, "status") == 0) {
    struct timespec delay = {.tv_sec = 0, .tv_nsec = 100000000};
    nanosleep(&delay, NULL);
    char text[32768];
    if (fs_read_text(snapshot, text, sizeof(text)) < 0) {
      perror("read state");
      return 74;
    }
    fputs(text, stdout);
  }
  return 0;
}
