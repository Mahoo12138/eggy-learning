#include "supervisor/event_loop.h"
#include "supervisor/runtime.h"
#include "supervisor/spawn.h"
#include "supervisor/worker.h"

#include <ctype.h>
#include <errno.h>
#include <limits.h>
#include <signal.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

typedef struct {
  char name[64];
  char mode[32];
} SpawnRequest;

static void usage(const char *program) {
  fprintf(stderr,
          "usage: %s [--runtime DIR] [--worker PATH] [--timeout-ms N] [--once] "
          "[--spawn NAME:ok|fail|hang|cpu]...\n",
          program);
}

static int sibling_worker_path(const char *program, char *output, size_t capacity) {
  const char *slash = strrchr(program, '/');
  if (slash == NULL) return snprintf(output, capacity, "patrol-worker") < (int)capacity ? 0 : -1;
  size_t directory_length = (size_t)(slash - program);
  if (directory_length + sizeof("/patrol-worker") > capacity) return -1;
  memcpy(output, program, directory_length);
  memcpy(output + directory_length, "/patrol-worker", sizeof("/patrol-worker"));
  return 0;
}

static int parse_spawn(const char *text, SpawnRequest *request) {
  const char *colon = strrchr(text, ':');
  if (colon == NULL || colon == text || colon[1] == '\0') return -1;
  size_t name_length = (size_t)(colon - text);
  if (name_length >= sizeof(request->name) || strlen(colon + 1) >= sizeof(request->mode)) return -1;
  for (size_t index = 0; index < name_length; ++index) {
    unsigned char value = (unsigned char)text[index];
    if (!isalnum(value) && value != '_' && value != '-') return -1;
  }
  memcpy(request->name, text, name_length);
  request->name[name_length] = '\0';
  (void)snprintf(request->mode, sizeof(request->mode), "%s", colon + 1);
  return strcmp(request->mode, "ok") == 0 || strcmp(request->mode, "fail") == 0 ||
                 strcmp(request->mode, "hang") == 0 || strcmp(request->mode, "cpu") == 0
             ? 0
             : -1;
}

static int parse_positive_int(const char *text, int *output) {
  char *end = NULL;
  errno = 0;
  long value = strtol(text, &end, 10);
  if (errno != 0 || *text == '\0' || *end != '\0' || value <= 0 || value > INT_MAX) return -1;
  *output = (int)value;
  return 0;
}

int main(int argc, char **argv) {
  const char *runtime_directory = "./run";
  char default_worker[PATH_MAX];
  if (sibling_worker_path(argv[0], default_worker, sizeof(default_worker)) != 0) {
    fprintf(stderr, "worker path is too long\n");
    return 64;
  }
  const char *worker_program = default_worker;
  int timeout_ms = 1000;
  int once = 0;
  SpawnRequest requests[PATROL_MAX_WORKERS];
  size_t request_count = 0;

  for (int index = 1; index < argc; ++index) {
    if (strcmp(argv[index], "--runtime") == 0 && index + 1 < argc) {
      runtime_directory = argv[++index];
    } else if (strcmp(argv[index], "--worker") == 0 && index + 1 < argc) {
      worker_program = argv[++index];
    } else if (strcmp(argv[index], "--timeout-ms") == 0 && index + 1 < argc) {
      if (parse_positive_int(argv[++index], &timeout_ms) != 0) {
        usage(argv[0]);
        return 64;
      }
    } else if (strcmp(argv[index], "--once") == 0) {
      once = 1;
    } else if (strcmp(argv[index], "--spawn") == 0 && index + 1 < argc &&
               request_count < PATROL_MAX_WORKERS) {
      if (parse_spawn(argv[++index], &requests[request_count]) != 0) {
        usage(argv[0]);
        return 64;
      }
      ++request_count;
    } else {
      usage(argv[0]);
      return 64;
    }
  }
  if (once && request_count == 0) {
    fprintf(stderr, "--once requires at least one --spawn\n");
    return 64;
  }

  RuntimePaths paths;
  if (runtime_prepare(&paths, runtime_directory) != 0) {
    perror("runtime_prepare");
    return 73;
  }
  WorkerTable workers;
  worker_table_init(&workers);
  SpawnProfile profile = spawn_profile_default();
  for (size_t index = 0; index < request_count; ++index) {
    Worker *worker = worker_table_add(&workers, requests[index].name, requests[index].mode);
    if (worker == NULL || spawn_worker(worker, worker_program, timeout_ms, &profile) != 0) {
      perror("spawn_worker");
      for (size_t child = 0; child < workers.count; ++child) {
        if (workers.items[child].phase == WORKER_RUNNING) kill(-workers.items[child].process_group, SIGKILL);
      }
      runtime_cleanup(&paths);
      return 71;
    }
  }

  EventLoopConfig config = {
      .paths = &paths,
      .worker_program = worker_program,
      .worker_timeout_ms = timeout_ms,
      .termination_grace_ms = 200,
      .stop_when_idle = once,
      .profile = profile,
  };
  int result = event_loop_run(&config, &workers);
  if (result != 0) perror("event_loop_run");
  for (size_t index = 0; index < workers.count; ++index) worker_close_report(&workers.items[index]);
  runtime_cleanup(&paths);
  return result == 0 ? 0 : 70;
}
