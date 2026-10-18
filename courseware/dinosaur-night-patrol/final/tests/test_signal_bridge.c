#include "supervisor/signal_bridge.h"

#include <assert.h>
#include <poll.h>
#include <signal.h>

int main(void) {
  SignalBridge bridge = {.read_fd = -1, .write_fd = -1};
  assert(signal_bridge_open(&bridge) == 0);
  assert(raise(SIGTERM) == 0);
  struct pollfd descriptor = {.fd = bridge.read_fd, .events = POLLIN};
  assert(poll(&descriptor, 1, 1000) == 1);
  int child;
  int stop;
  assert(signal_bridge_drain(&bridge, &child, &stop) == 0);
  assert(child == 0 && stop == 1);
  signal_bridge_close(&bridge);
  return 0;
}
