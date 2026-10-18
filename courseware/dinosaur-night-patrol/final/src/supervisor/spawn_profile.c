#include "supervisor/spawn_profile.h"

#include <errno.h>
#include <stddef.h>

static int set_limit(int resource, rlim_t value) {
  struct rlimit limit = {.rlim_cur = value, .rlim_max = value};
  return setrlimit(resource, &limit);
}

SpawnProfile spawn_profile_default(void) {
  SpawnProfile profile = {
      .cpu_seconds = 2,
      .address_space_bytes = 128U * 1024U * 1024U,
      .open_files = 32,
  };
  return profile;
}

int spawn_profile_apply(const SpawnProfile *profile) {
  if (profile == NULL) {
    errno = EINVAL;
    return -1;
  }
  if (set_limit(RLIMIT_CPU, profile->cpu_seconds) != 0) return -1;
#ifdef RLIMIT_AS
  if (set_limit(RLIMIT_AS, profile->address_space_bytes) != 0) return -1;
#endif
  if (set_limit(RLIMIT_NOFILE, profile->open_files) != 0) return -1;
  return 0;
}
