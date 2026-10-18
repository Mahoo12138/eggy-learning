#ifndef PATROL_PROTOCOL_H
#define PATROL_PROTOCOL_H

#include <stddef.h>
#include <stdint.h>

#define PATROL_FRAME_MAX_PAYLOAD 1024U
#define PATROL_FRAME_BUFFER_CAPACITY 4096U

typedef struct {
  uint8_t status;
  char worker[64];
  char message[512];
} PatrolReport;

typedef struct {
  uint8_t bytes[PATROL_FRAME_BUFFER_CAPACITY];
  size_t used;
} PatrolFrameReader;

void protocol_reader_init(PatrolFrameReader *reader);
int protocol_write_report(int fd, const PatrolReport *report);
int protocol_reader_feed(PatrolFrameReader *reader, const void *data, size_t length);
int protocol_reader_next(PatrolFrameReader *reader, PatrolReport *report);

#endif
