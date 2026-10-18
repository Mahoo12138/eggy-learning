#include "common/io.h"

#include <errno.h>
#include <fcntl.h>
#include <stdint.h>
#include <unistd.h>

int io_set_nonblocking(int fd) {
  int flags = fcntl(fd, F_GETFL);
  if (flags < 0) return -1;
  return fcntl(fd, F_SETFL, flags | O_NONBLOCK);
}

int io_set_cloexec(int fd) {
  int flags = fcntl(fd, F_GETFD);
  if (flags < 0) return -1;
  return fcntl(fd, F_SETFD, flags | FD_CLOEXEC);
}

ssize_t io_write_all(int fd, const void *buffer, size_t length) {
  const uint8_t *cursor = buffer;
  size_t written = 0;
  while (written < length) {
    ssize_t count = write(fd, cursor + written, length - written);
    if (count > 0) {
      written += (size_t)count;
      continue;
    }
    if (count < 0 && errno == EINTR) continue;
    return -1;
  }
  return (ssize_t)written;
}

ssize_t io_read_retry(int fd, void *buffer, size_t length) {
  for (;;) {
    ssize_t count = read(fd, buffer, length);
    if (count < 0 && errno == EINTR) continue;
    return count;
  }
}
