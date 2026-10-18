#include "common/protocol.h"

#include <assert.h>
#include <errno.h>
#include <string.h>
#include <unistd.h>

int main(void) {
  int descriptors[2];
  assert(pipe(descriptors) == 0);
  PatrolReport input = {.status = 3};
  strcpy(input.worker, "north-gate");
  strcpy(input.message, "temperature stable");
  assert(protocol_write_report(descriptors[1], &input) == 0);
  unsigned char wire[2048];
  ssize_t length = read(descriptors[0], wire, sizeof(wire));
  assert(length > 5);
  PatrolFrameReader reader;
  protocol_reader_init(&reader);
  assert(protocol_reader_feed(&reader, wire, 3) == 0);
  PatrolReport output;
  assert(protocol_reader_next(&reader, &output) == 0);
  assert(protocol_reader_feed(&reader, wire + 3, (size_t)length - 3) == 0);
  assert(protocol_reader_next(&reader, &output) == 1);
  assert(output.status == input.status);
  assert(strcmp(output.worker, input.worker) == 0);
  assert(strcmp(output.message, input.message) == 0);
  assert(protocol_reader_next(&reader, &output) == 0);
  close(descriptors[0]);
  close(descriptors[1]);
  return 0;
}
