#include "common/fs.h"
#include "supervisor/state.h"

#include <assert.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>

int main(void) {
  WorkerTable table;
  worker_table_init(&table);
  Worker *worker = worker_table_add(&table, "gate-\"A", "ok");
  assert(worker != NULL);
  worker->pid = 123;
  worker->phase = WORKER_EXITED;
  worker->exit_code = 0;
  worker->report_received = 1;
  strcpy(worker->report_message, "line one\nline two");
  char json[4096];
  assert(state_render_json(&table, json, sizeof(json)) > 0);
  assert(strstr(json, "gate-\\\"A") != NULL);
  assert(strstr(json, "line one\\u000aline two") != NULL);
  char directory[] = "/tmp/patrol-state-XXXXXX";
  assert(mkdtemp(directory) != NULL);
  char path[4096];
  assert(snprintf(path, sizeof(path), "%s/state.json", directory) < (int)sizeof(path));
  assert(state_write_snapshot(path, &table) == 0);
  char loaded[4096];
  assert(fs_read_text(path, loaded, sizeof(loaded)) > 0);
  assert(strcmp(json, loaded) == 0);
  unlink(path);
  rmdir(directory);
  return 0;
}
