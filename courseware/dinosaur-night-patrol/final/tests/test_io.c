#include "common/io.h"

#include <assert.h>
#include <errno.h>
#include <fcntl.h>
#include <string.h>
#include <unistd.h>

int main(void) {
  int descriptors[2];
  assert(pipe(descriptors) == 0);
  const char text[] = "pipe handles bytes, not messages";
  assert(io_write_all(descriptors[1], text, sizeof(text)) == (ssize_t)sizeof(text));
  char output[sizeof(text)];
  assert(io_read_retry(descriptors[0], output, sizeof(output)) == (ssize_t)sizeof(output));
  assert(memcmp(text, output, sizeof(text)) == 0);
  assert(io_set_nonblocking(descriptors[0]) == 0);
  assert((fcntl(descriptors[0], F_GETFL) & O_NONBLOCK) != 0);
  close(descriptors[0]);
  close(descriptors[1]);
  return 0;
}
