
#include "protocol.h"
#define CHECK(x) do { if(!(x)) { fprintf(stderr,"check failed: %s\n",#x); return 1; } } while(0)
int main(void) {
    struct Request request;
    CHECK(parse_request("PING|alice",&request));
    CHECK(!parse_request("PING|",&request));
    CHECK(!parse_request("PING|a|b",&request));
    CHECK(!parse_request("PING|bad name",&request));
    CHECK(!parse_request("PING|x'",&request));
    CHECK(!parse_request("PING|abcdefghijklmnopqrstuvwxyz1234567",&request));
    int number=0;
    CHECK(parse_number("65535",65535,&number)&&number==65535);
    CHECK(!parse_number("65536",65535,&number));
    CHECK(!parse_number("999999999999999999999999",65535,&number));
    CHECK(!parse_number("-1",65535,&number));
    CHECK(!parse_number("1x",65535,&number));
    puts("PROTOCOL TESTS PASSED"); return 0;
}
