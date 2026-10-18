#include "supervisor/report.h"

#include "common/protocol.h"

#include <errno.h>
#include <stdio.h>
#include <string.h>
#include <unistd.h>

int report_drain_worker(Worker *worker, Journal *journal) {
  uint8_t bytes[512];
  int reports = 0;
  for (;;) {
    ssize_t count = read(worker->report_fd, bytes, sizeof(bytes));
    if (count > 0) {
      if (protocol_reader_feed(&worker->reader, bytes, (size_t)count) != 0) return -1;
      for (;;) {
        PatrolReport report;
        int result = protocol_reader_next(&worker->reader, &report);
        if (result < 0) return -1;
        if (result == 0) break;
        worker->report_received = 1;
        worker->report_status = report.status;
        (void)snprintf(worker->report_message, sizeof(worker->report_message), "%s", report.message);
        if (journal_append(journal, "report", worker->id, worker->name, report.message) != 0) return -1;
        ++reports;
      }
      continue;
    }
    if (count == 0) {
      worker_close_report(worker);
      return reports;
    }
    if (errno == EINTR) continue;
    if (errno == EAGAIN || errno == EWOULDBLOCK) return reports;
    return -1;
  }
}
