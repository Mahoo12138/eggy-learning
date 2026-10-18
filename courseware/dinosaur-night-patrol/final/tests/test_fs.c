#include "common/fs.h"

#include <assert.h>
#include <limits.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(void) {
  char directory[] = "/tmp/patrol-fs-XXXXXX";
  assert(mkdtemp(directory) != NULL);
  char nested[PATH_MAX];
  char file[PATH_MAX];
  assert(snprintf(nested, sizeof(nested), "%s/a/b", directory) < (int)sizeof(nested));
  assert(snprintf(file, sizeof(file), "%s/state.txt", nested) < (int)sizeof(file));
  assert(fs_mkdir_p(nested, 0755) == 0);
  const char first[] = "first";
  const char second[] = "second version";
  assert(fs_atomic_write(file, first, strlen(first), 0644) == 0);
  assert(fs_atomic_write(file, second, strlen(second), 0644) == 0);
  char output[64];
  assert(fs_read_text(file, output, sizeof(output)) == (int)strlen(second));
  assert(strcmp(output, second) == 0);
  unlink(file);
  rmdir(nested);
  char parent[PATH_MAX];
  assert(snprintf(parent, sizeof(parent), "%s/a", directory) < (int)sizeof(parent));
  rmdir(parent);
  rmdir(directory);
  return 0;
}
