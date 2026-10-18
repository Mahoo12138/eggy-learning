#include "net.h"
#include "protocol.h"
int main(int argc,char** argv) {
    int port=0;
    if((argc!=3) || !parse_number(argv[1],65535,&port) || !port) {
        fprintf(stderr,"Usage: client PORT 'REQUEST' [RETRIES 0..2]\n"); return 2;
    }
    struct Request request;
    if(!parse_request(argv[2],&request)) { fprintf(stderr,"ERR|BAD_REQUEST\n"); return 2; }
    int retry_count=0;
    if(retry_count && strcmp(request.op,"PING") && strcmp(request.op,"BALANCE") && strcmp(request.op,"TOP") && strcmp(request.op,"HISTORY")) {
        fprintf(stderr,"write retries require durable event idempotency\n"); return 2;
    }
    install_signals();
    for(int attempt=0;attempt<=retry_count;attempt++) {
        const int64_t deadline=now_ms()+IO_TIMEOUT_MS;
        int fd=connect_local(port,deadline);
        if(fd<0) continue;
        char response[MAX_BODY+1];
        int okay=io_exact(fd,argv[2],strlen(argv[2]),1,deadline);
        shutdown(fd,SHUT_WR);
        okay=okay && raw_read(fd,response,sizeof(response));
        close(fd);
        if(okay) { puts(response); return strncmp(response,"OK|",3)?1:0; }
    }
    fprintf(stderr,"ERR|TRANSPORT\n"); return 3;
}
