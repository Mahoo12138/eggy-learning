#ifndef PATROL_SUPERVISOR_CONTROL_H
#define PATROL_SUPERVISOR_CONTROL_H

#include <stddef.h>

typedef enum {
  CONTROL_NONE = 0,
  CONTROL_STATUS,
  CONTROL_STOP,
  CONTROL_RUN
} ControlKind;

typedef struct {
  ControlKind kind;
  char name[64];
  char mode[32];
} ControlCommand;

typedef struct {
  int fd;
  char pending[1024];
  size_t used;
} ControlChannel;

int control_open(ControlChannel *channel, const char *fifo_path);
void control_close(ControlChannel *channel);
int control_read_command(ControlChannel *channel, ControlCommand *command);
int control_parse_line(const char *line, ControlCommand *command);

#endif
