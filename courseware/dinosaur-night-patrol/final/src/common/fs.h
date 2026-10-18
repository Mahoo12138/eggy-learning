#ifndef PATROL_FS_H
#define PATROL_FS_H

#include <stddef.h>
#include <sys/types.h>

int fs_mkdir_p(const char *path, mode_t mode);
int fs_atomic_write(const char *path, const void *data, size_t length, mode_t mode);
int fs_read_text(const char *path, char *buffer, size_t capacity);

#endif
