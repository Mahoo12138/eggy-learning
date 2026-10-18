#include "common/protocol.h"

#include "common/io.h"

#include <arpa/inet.h>
#include <errno.h>
#include <string.h>

enum { HEADER_SIZE = 4, FIXED_PAYLOAD_SIZE = 5 };

static size_t bounded_length(const char *text, size_t limit) {
  size_t length = 0;
  while (length < limit && text[length] != '\0') ++length;
  return length;
}

void protocol_reader_init(PatrolFrameReader *reader) {
  if (reader != NULL) reader->used = 0;
}

int protocol_write_report(int fd, const PatrolReport *report) {
  if (report == NULL) {
    errno = EINVAL;
    return -1;
  }
  size_t worker_length = bounded_length(report->worker, sizeof(report->worker) - 1);
  size_t message_length = bounded_length(report->message, sizeof(report->message) - 1);
  size_t payload_length = FIXED_PAYLOAD_SIZE + worker_length + message_length;
  if (payload_length > PATROL_FRAME_MAX_PAYLOAD) {
    errno = EMSGSIZE;
    return -1;
  }

  uint8_t frame[HEADER_SIZE + PATROL_FRAME_MAX_PAYLOAD];
  uint32_t net_length = htonl((uint32_t)payload_length);
  memcpy(frame, &net_length, HEADER_SIZE);
  frame[4] = report->status;
  uint16_t net_worker = htons((uint16_t)worker_length);
  uint16_t net_message = htons((uint16_t)message_length);
  memcpy(frame + 5, &net_worker, 2);
  memcpy(frame + 7, &net_message, 2);
  memcpy(frame + 9, report->worker, worker_length);
  memcpy(frame + 9 + worker_length, report->message, message_length);
  return io_write_all(fd, frame, HEADER_SIZE + payload_length) < 0 ? -1 : 0;
}

int protocol_reader_feed(PatrolFrameReader *reader, const void *data, size_t length) {
  if (reader == NULL || data == NULL || length > sizeof(reader->bytes) - reader->used) {
    errno = ENOBUFS;
    return -1;
  }
  memcpy(reader->bytes + reader->used, data, length);
  reader->used += length;
  return 0;
}

int protocol_reader_next(PatrolFrameReader *reader, PatrolReport *report) {
  if (reader == NULL || report == NULL) {
    errno = EINVAL;
    return -1;
  }
  if (reader->used < HEADER_SIZE) return 0;

  uint32_t net_length;
  memcpy(&net_length, reader->bytes, HEADER_SIZE);
  size_t payload_length = ntohl(net_length);
  if (payload_length < FIXED_PAYLOAD_SIZE || payload_length > PATROL_FRAME_MAX_PAYLOAD) {
    errno = EPROTO;
    return -1;
  }
  size_t frame_length = HEADER_SIZE + payload_length;
  if (reader->used < frame_length) return 0;

  uint16_t net_worker;
  uint16_t net_message;
  memcpy(&net_worker, reader->bytes + 5, 2);
  memcpy(&net_message, reader->bytes + 7, 2);
  size_t worker_length = ntohs(net_worker);
  size_t message_length = ntohs(net_message);
  if (FIXED_PAYLOAD_SIZE + worker_length + message_length != payload_length ||
      worker_length >= sizeof(report->worker) || message_length >= sizeof(report->message)) {
    errno = EPROTO;
    return -1;
  }

  memset(report, 0, sizeof(*report));
  report->status = reader->bytes[4];
  memcpy(report->worker, reader->bytes + 9, worker_length);
  memcpy(report->message, reader->bytes + 9 + worker_length, message_length);
  memmove(reader->bytes, reader->bytes + frame_length, reader->used - frame_length);
  reader->used -= frame_length;
  return 1;
}
