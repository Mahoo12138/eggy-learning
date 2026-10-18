#include "supervisor/control.h"

#include <ctype.h>
#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int control_open(ControlChannel *channel, const char *fifo_path) {
  if (channel == NULL || fifo_path == NULL) {
    errno = EINVAL;
    return -1;
  }
  memset(channel, 0, sizeof(*channel));
  channel->fd = open(fifo_path, O_RDWR | O_NONBLOCK | O_CLOEXEC);
  return channel->fd < 0 ? -1 : 0;
}

void control_close(ControlChannel *channel) {
  if (channel != NULL && channel->fd >= 0) {
    close(channel->fd);
    channel->fd = -1;
  }
}

int control_parse_line(const char *line, ControlCommand *command) {
  if (line == NULL || command == NULL) {
    errno = EINVAL;
    return -1;
  }
  memset(command, 0, sizeof(*command));
  char trailing;
  if (sscanf(line, " status %c", &trailing) == EOF || strcmp(line, "status") == 0) {
    if (strcmp(line, "status") == 0) {
      command->kind = CONTROL_STATUS;
      return 1;
    }
  }
  if (strcmp(line, "stop") == 0) {
    command->kind = CONTROL_STOP;
    return 1;
  }
  char name[64];
  char mode[32];
  char extra[2];
  int count = sscanf(line, "run %63s %31s %1s", name, mode, extra);
  if (count == 2) {
    if (strcmp(mode, "ok") != 0 && strcmp(mode, "fail") != 0 &&
        strcmp(mode, "hang") != 0 && strcmp(mode, "cpu") != 0) {
      errno = EINVAL;
      return -1;
    }
    command->kind = CONTROL_RUN;
    (void)snprintf(command->name, sizeof(command->name), "%s", name);
    (void)snprintf(command->mode, sizeof(command->mode), "%s", mode);
    return 1;
  }
  errno = EINVAL;
  return -1;
}

int control_read_command(ControlChannel *channel, ControlCommand *command) {
  if (channel == NULL || command == NULL) {
    errno = EINVAL;
    return -1;
  }
  for (;;) {
    for (size_t index = 0; index < channel->used; ++index) {
      if (channel->pending[index] != '\n') continue;
      channel->pending[index] = '\0';
      int result = control_parse_line(channel->pending, command);
      size_t consumed = index + 1;
      memmove(channel->pending, channel->pending + consumed, channel->used - consumed);
      channel->used -= consumed;
      return result;
    }
    if (channel->used == sizeof(channel->pending)) {
      channel->used = 0;
      errno = EMSGSIZE;
      return -1;
    }
    ssize_t count = read(channel->fd, channel->pending + channel->used,
                         sizeof(channel->pending) - channel->used);
    if (count > 0) {
      channel->used += (size_t)count;
      continue;
    }
    if (count < 0 && errno == EINTR) continue;
    if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return 0;
    return count == 0 ? 0 : -1;
  }
}
