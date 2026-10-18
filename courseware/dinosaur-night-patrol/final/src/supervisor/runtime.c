#include "supervisor/runtime.h"

#include "common/fs.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <sys/stat.h>
#include <unistd.h>

static int make_path(char *output, size_t capacity, const char *directory, const char *name) {
  int count = snprintf(output, capacity, "%s/%s", directory, name);
  if (count < 0 || (size_t)count >= capacity) {
    errno = ENAMETOOLONG;
    return -1;
  }
  return 0;
}

int runtime_prepare(RuntimePaths *paths, const char *directory) {
  if (paths == NULL || directory == NULL || directory[0] == '\0') {
    errno = EINVAL;
    return -1;
  }
  memset(paths, 0, sizeof(*paths));
  if (snprintf(paths->directory, sizeof(paths->directory), "%s", directory) >=
      (int)sizeof(paths->directory)) {
    errno = ENAMETOOLONG;
    return -1;
  }
  if (fs_mkdir_p(directory, 0755) != 0 ||
      make_path(paths->control_fifo, sizeof(paths->control_fifo), directory, "control.fifo") != 0 ||
      make_path(paths->journal_file, sizeof(paths->journal_file), directory, "events.log") != 0 ||
      make_path(paths->snapshot_file, sizeof(paths->snapshot_file), directory, "state.json") != 0) {
    return -1;
  }
  if (mkfifo(paths->control_fifo, 0600) != 0 && errno != EEXIST) return -1;
  struct stat status;
  if (lstat(paths->control_fifo, &status) != 0 || !S_ISFIFO(status.st_mode)) {
    errno = EINVAL;
    return -1;
  }
  return 0;
}

void runtime_cleanup(const RuntimePaths *paths) {
  if (paths != NULL && paths->control_fifo[0] != '\0') unlink(paths->control_fifo);
}
