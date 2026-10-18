#ifndef PATROL_SUPERVISOR_JOURNAL_H
#define PATROL_SUPERVISOR_JOURNAL_H

#include <stddef.h>

typedef struct {
  int fd;
  char path[4096];
} Journal;

int journal_open(Journal *journal, const char *path);
int journal_append(Journal *journal, const char *event, int worker_id,
                   const char *worker_name, const char *detail);
void journal_close(Journal *journal);

#endif
