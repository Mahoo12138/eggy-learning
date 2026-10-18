#ifndef PATROL_SUPERVISOR_SPAWN_PROFILE_H
#define PATROL_SUPERVISOR_SPAWN_PROFILE_H

#include <sys/resource.h>

typedef struct {
  rlim_t cpu_seconds;
  rlim_t address_space_bytes;
  rlim_t open_files;
} SpawnProfile;

SpawnProfile spawn_profile_default(void);
int spawn_profile_apply(const SpawnProfile *profile);

#endif
