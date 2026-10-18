#include "supervisor/state.h"

#include "common/fs.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>

static int append_json_string(char *buffer, size_t capacity, size_t *used, const char *text) {
  if (*used + 1 >= capacity) return -1;
  buffer[(*used)++] = '"';
  for (size_t index = 0; text[index] != '\0'; ++index) {
    unsigned char value = (unsigned char)text[index];
    if (value == '"' || value == '\\') {
      if (*used + 2 >= capacity) return -1;
      buffer[(*used)++] = '\\';
      buffer[(*used)++] = (char)value;
    } else if (value < 0x20) {
      if (*used + 6 >= capacity) return -1;
      int count = snprintf(buffer + *used, capacity - *used, "\\u%04x", value);
      if (count != 6) return -1;
      *used += 6;
    } else {
      if (*used + 1 >= capacity) return -1;
      buffer[(*used)++] = (char)value;
    }
  }
  if (*used + 1 >= capacity) return -1;
  buffer[(*used)++] = '"';
  buffer[*used] = '\0';
  return 0;
}

int state_render_json(const WorkerTable *table, char *buffer, size_t capacity) {
  if (table == NULL || buffer == NULL || capacity == 0) {
    errno = EINVAL;
    return -1;
  }
  size_t used = 0;
  int count = snprintf(buffer, capacity, "{\"workerCount\":%zu,\"runningCount\":%zu,\"workers\":[",
                       table->count, worker_running_count(table));
  if (count < 0 || (size_t)count >= capacity) goto overflow;
  used = (size_t)count;
  for (size_t index = 0; index < table->count; ++index) {
    const Worker *worker = &table->items[index];
    count = snprintf(buffer + used, capacity - used,
                     "%s{\"id\":%d,\"name\":", index == 0 ? "" : ",", worker->id);
    if (count < 0 || (size_t)count >= capacity - used) goto overflow;
    used += (size_t)count;
    if (append_json_string(buffer, capacity, &used, worker->name) != 0) goto overflow;
    count = snprintf(buffer + used, capacity - used,
                     ",\"pid\":%ld,\"phase\":\"%s\",\"exitCode\":%d,"
                     "\"termSignal\":%d,\"timedOut\":%s,\"reportReceived\":%s,"
                     "\"reportStatus\":%d,\"message\":",
                     (long)worker->pid, worker_phase_name(worker->phase), worker->exit_code,
                     worker->term_signal, worker->timed_out ? "true" : "false",
                     worker->report_received ? "true" : "false", worker->report_status);
    if (count < 0 || (size_t)count >= capacity - used) goto overflow;
    used += (size_t)count;
    if (append_json_string(buffer, capacity, &used, worker->report_message) != 0) goto overflow;
    if (used + 2 >= capacity) goto overflow;
    buffer[used++] = '}';
    buffer[used] = '\0';
  }
  if (used + 3 >= capacity) goto overflow;
  memcpy(buffer + used, "]}\n", 4);
  used += 3;
  return (int)used;

overflow:
  errno = ENOBUFS;
  return -1;
}

int state_write_snapshot(const char *path, const WorkerTable *table) {
  char json[32768];
  int length = state_render_json(table, json, sizeof(json));
  if (length < 0) return -1;
  return fs_atomic_write(path, json, (size_t)length, 0644);
}
