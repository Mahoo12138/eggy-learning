#include "frame.h"
static void handle_connection(int fd,int64_t deadline,void* context) {
    for(int frame=0;frame<16;frame++) {
    char body[MAX_BODY+1],response[MAX_BODY+1];
    if(!frame_read(fd,body,deadline)) return;
    (void)context;
    ping_reply(body,response,sizeof(response));
    if(!frame_write(fd,response,deadline)) return;
    }
}
int main(int argc,char** argv) {
    int port=0,upstream=0;
    if(argc!=2 || !parse_number(argv[1],65535,&port)) { fprintf(stderr,"Usage: gateway PORT\n"); return 2; }
    install_signals();
    int actual=0; int listener=listen_local(port,&actual);
    if(listener<0) { perror("listen"); return 1; }
    printf("GATEWAY_READY=%d\n",actual); fflush(stdout);
    while(!net_stopping) {
        struct pollfd ready={listener,POLLIN,0};
        int available=poll(&ready,1,100);
        if(available<0 && errno!=EINTR) break;
        if(available<=0) continue;
        int fd=accept(listener,NULL,NULL);
        if(fd<0) { if(errno==EINTR || errno==EAGAIN || errno==EWOULDBLOCK) continue; break; }
        if(make_nonblocking(fd)==0) handle_connection(fd,now_ms()+IO_TIMEOUT_MS,&upstream);
        close(fd);
    }
    close(listener); return 0;
}
