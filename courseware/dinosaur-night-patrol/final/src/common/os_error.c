#include "common/os_error.h"

#include <stdio.h>
#include <string.h>

const char *os_error_text(int error_number, char *buffer, size_t capacity) {
  if (buffer == NULL || capacity == 0) {
    return "invalid error buffer";
  }
  const char *message = strerror(error_number);
  if (message == NULL) {
    (void)snprintf(buffer, capacity, "errno %d", error_number);
  } else {
    (void)snprintf(buffer, capacity, "%s", message);
  }
  return buffer;
}
