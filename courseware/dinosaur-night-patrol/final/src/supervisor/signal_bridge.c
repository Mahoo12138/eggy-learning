#include "supervisor/signal_bridge.h"

#include "common/io.h"

#include <errno.h>
#include <fcntl.h>
#include <signal.h>
#include <stddef.h>
#include <stdint.h>
#include <string.h>
#include <unistd.h>

static volatile sig_atomic_t bridge_write_fd = -1;

static void signal_handler(int signal_number) {
  int saved = errno;
  uint8_t value = (uint8_t)signal_number;
  if (bridge_write_fd >= 0) (void)write((int)bridge_write_fd, &value, sizeof(value));
  errno = saved;
}

static int install_handler(int signal_number) {
  struct sigaction action;
  memset(&action, 0, sizeof(action));
  action.sa_handler = signal_handler;
  sigemptyset(&action.sa_mask);
  action.sa_flags = SA_RESTART;
  return sigaction(signal_number, &action, NULL);
}

int signal_bridge_open(SignalBridge *bridge) {
  if (bridge == NULL || bridge_write_fd >= 0) {
    errno = EBUSY;
    return -1;
  }
  int descriptors[2];
#ifdef __linux__
  if (pipe2(descriptors, O_NONBLOCK | O_CLOEXEC) != 0) return -1;
#else
  if (pipe(descriptors) != 0) return -1;
  if (io_set_nonblocking(descriptors[0]) != 0 || io_set_nonblocking(descriptors[1]) != 0 ||
      io_set_cloexec(descriptors[0]) != 0 || io_set_cloexec(descriptors[1]) != 0) {
    int saved = errno;
    close(descriptors[0]);
    close(descriptors[1]);
    errno = saved;
    return -1;
  }
#endif
  bridge->read_fd = descriptors[0];
  bridge->write_fd = descriptors[1];
  bridge_write_fd = descriptors[1];
  if (install_handler(SIGCHLD) != 0 || install_handler(SIGINT) != 0 ||
      install_handler(SIGTERM) != 0) {
    int saved = errno;
    signal_bridge_close(bridge);
    errno = saved;
    return -1;
  }
  return 0;
}

void signal_bridge_close(SignalBridge *bridge) {
  bridge_write_fd = -1;
  if (bridge == NULL) return;
  if (bridge->read_fd >= 0) close(bridge->read_fd);
  if (bridge->write_fd >= 0) close(bridge->write_fd);
  bridge->read_fd = -1;
  bridge->write_fd = -1;
}

int signal_bridge_drain(SignalBridge *bridge, int *saw_child, int *saw_stop) {
  if (bridge == NULL || saw_child == NULL || saw_stop == NULL) {
    errno = EINVAL;
    return -1;
  }
  *saw_child = 0;
  *saw_stop = 0;
  uint8_t values[64];
  for (;;) {
    ssize_t count = read(bridge->read_fd, values, sizeof(values));
    if (count > 0) {
      for (ssize_t index = 0; index < count; ++index) {
        if (values[index] == SIGCHLD) *saw_child = 1;
        if (values[index] == SIGINT || values[index] == SIGTERM) *saw_stop = 1;
      }
      continue;
    }
    if (count < 0 && errno == EINTR) continue;
    if (count < 0 && (errno == EAGAIN || errno == EWOULDBLOCK)) return 0;
    return count == 0 ? 0 : -1;
  }
}
