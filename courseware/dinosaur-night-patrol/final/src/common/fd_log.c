#include "common/fd_log.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>

void fd_log_open_descriptors(void) {
  fprintf(stderr, "open fds:");
  for (int fd = 0; fd < 64; ++fd) {
    errno = 0;
    if (fcntl(fd, F_GETFD) >= 0 || errno != EBADF) fprintf(stderr, " %d", fd);
  }
  fputc('\n', stderr);
}
