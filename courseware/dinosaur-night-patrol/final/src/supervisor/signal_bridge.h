#ifndef PATROL_SUPERVISOR_SIGNAL_BRIDGE_H
#define PATROL_SUPERVISOR_SIGNAL_BRIDGE_H

typedef struct {
  int read_fd;
  int write_fd;
} SignalBridge;

int signal_bridge_open(SignalBridge *bridge);
void signal_bridge_close(SignalBridge *bridge);
int signal_bridge_drain(SignalBridge *bridge, int *saw_child, int *saw_stop);

#endif
