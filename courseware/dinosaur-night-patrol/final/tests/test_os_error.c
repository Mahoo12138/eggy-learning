#include "common/os_error.h"

#include <assert.h>
#include <errno.h>
#include <string.h>

int main(void) {
  char buffer[128];
  assert(os_error_text(ENOENT, buffer, sizeof(buffer)) == buffer);
  assert(buffer[0] != '\0');
  assert(strcmp(os_error_text(EINVAL, NULL, 0), "invalid error buffer") == 0);
  return 0;
}
