#include "supervisor/journal.h"

#include "common/clock.h"
#include "common/io.h"

#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

static void sanitize(char *output, size_t capacity, const char *input) {
  size_t used = 0;
  if (capacity == 0) return;
  for (size_t index = 0; input != NULL && input[index] != '\0' && used + 1 < capacity; ++index) {
    char value = input[index];
    output[used++] = (value == '\t' || value == '\n' || value == '\r') ? ' ' : value;
  }
  output[used] = '\0';
}

int journal_open(Journal *journal, const char *path) {
  if (journal == NULL || path == NULL) {
    errno = EINVAL;
    return -1;
  }
  memset(journal, 0, sizeof(*journal));
  journal->fd = open(path, O_WRONLY | O_CREAT | O_APPEND | O_CLOEXEC, 0644);
  if (journal->fd < 0) return -1;
  (void)snprintf(journal->path, sizeof(journal->path), "%s", path);
  return 0;
}

int journal_append(Journal *journal, const char *event, int worker_id,
                   const char *worker_name, const char *detail) {
  if (journal == NULL || journal->fd < 0 || event == NULL) {
    errno = EINVAL;
    return -1;
  }
  char safe_name[128];
  char safe_detail[640];
  sanitize(safe_name, sizeof(safe_name), worker_name == NULL ? "-" : worker_name);
  sanitize(safe_detail, sizeof(safe_detail), detail == NULL ? "-" : detail);
  char line[1024];
  int length = snprintf(line, sizeof(line), "%lld\t%s\t%d\t%s\t%s\n",
                        (long long)clock_monotonic_ms(), event, worker_id, safe_name, safe_detail);
  if (length < 0 || (size_t)length >= sizeof(line)) {
    errno = EOVERFLOW;
    return -1;
  }
  if (io_write_all(journal->fd, line, (size_t)length) < 0) return -1;
  return fdatasync(journal->fd);
}

void journal_close(Journal *journal) {
  if (journal != NULL && journal->fd >= 0) {
    close(journal->fd);
    journal->fd = -1;
  }
}
