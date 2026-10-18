#ifndef PATROL_IO_H
#define PATROL_IO_H

#include <stddef.h>
#include <sys/types.h>

int io_set_nonblocking(int fd);
int io_set_cloexec(int fd);
ssize_t io_write_all(int fd, const void *buffer, size_t length);
ssize_t io_read_retry(int fd, void *buffer, size_t length);

#endif
