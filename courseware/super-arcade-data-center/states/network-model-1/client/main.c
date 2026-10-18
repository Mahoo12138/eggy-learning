#include "protocol.h"
int main(int argc,char** argv) {
    if(argc!=2) { fprintf(stderr,"Usage: client 'PING|player'\n"); return 2; }
    struct Request request;
    if(!parse_request(argv[1],&request)) { fprintf(stderr,"ERR|BAD_REQUEST\n"); return 2; }
    char response[MAX_BODY+1]; ping_reply(argv[1],response,sizeof(response)); puts(response); return 0;
}
