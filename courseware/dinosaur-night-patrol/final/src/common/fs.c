#include "common/fs.h"

#include "common/io.h"

#include <errno.h>
#include <fcntl.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

int fs_mkdir_p(const char *path, mode_t mode) {
  if (path == NULL || path[0] == '\0') {
    errno = EINVAL;
    return -1;
  }
  char copy[PATH_MAX];
  if (snprintf(copy, sizeof(copy), "%s", path) >= (int)sizeof(copy)) {
    errno = ENAMETOOLONG;
    return -1;
  }
  for (char *cursor = copy + 1; *cursor != '\0'; ++cursor) {
    if (*cursor != '/') continue;
    *cursor = '\0';
    if (mkdir(copy, mode) != 0 && errno != EEXIST) return -1;
    *cursor = '/';
  }
  if (mkdir(copy, mode) != 0 && errno != EEXIST) return -1;
  return 0;
}

int fs_atomic_write(const char *path, const void *data, size_t length, mode_t mode) {
  char temporary[PATH_MAX];
  if (snprintf(temporary, sizeof(temporary), "%s.tmp.XXXXXX", path) >= (int)sizeof(temporary)) {
    errno = ENAMETOOLONG;
    return -1;
  }
  int fd = mkstemp(temporary);
  if (fd < 0) return -1;
  int result = 0;
  if (fchmod(fd, mode) != 0 || io_write_all(fd, data, length) < 0 || fsync(fd) != 0) result = -1;
  int saved = errno;
  if (close(fd) != 0 && result == 0) {
    result = -1;
    saved = errno;
  }
  if (result == 0 && rename(temporary, path) != 0) {
    result = -1;
    saved = errno;
  }
  if (result != 0) unlink(temporary);
  errno = saved;
  return result;
}

int fs_read_text(const char *path, char *buffer, size_t capacity) {
  if (capacity == 0) {
    errno = EINVAL;
    return -1;
  }
  int fd = open(path, O_RDONLY);
  if (fd < 0) return -1;
  size_t used = 0;
  while (used + 1 < capacity) {
    ssize_t count = io_read_retry(fd, buffer + used, capacity - 1 - used);
    if (count < 0) {
      int saved = errno;
      close(fd);
      errno = saved;
      return -1;
    }
    if (count == 0) break;
    used += (size_t)count;
  }
  buffer[used] = '\0';
  close(fd);
  return (int)used;
}
