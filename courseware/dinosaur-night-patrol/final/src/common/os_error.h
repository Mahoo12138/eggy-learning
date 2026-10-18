#ifndef PATROL_OS_ERROR_H
#define PATROL_OS_ERROR_H

#include <stddef.h>

const char *os_error_text(int error_number, char *buffer, size_t capacity);

#endif
