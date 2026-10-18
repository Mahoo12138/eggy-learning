#include "frame.h"
#include "server.h"
static void handle_connection(int fd,int64_t deadline,void* context) {
    for(int frame=0;frame<16;frame++) {
    char body[MAX_BODY+1],response[MAX_BODY+1];
    if(!frame_read(fd,body,deadline)) return;
    int upstream_port=*(int*)context;
    int upstream=connect_local(upstream_port,deadline);
    if(upstream<0) return;
    int okay=frame_write(upstream,body,deadline) && frame_read(upstream,response,deadline);
    close(upstream);
    if(!okay) return;
    if(!frame_write(fd,response,deadline)) return;
    }
}
int main(int argc,char** argv) {
    int port=0,upstream=0;
    if(argc!=3 || !parse_number(argv[1],65535,&port) || !parse_number(argv[2],65535,&upstream) || !upstream) {
        fprintf(stderr,"Usage: gateway LISTEN_PORT SERVICE_PORT\n"); return 2;
    }
    install_signals();
    int actual=0; int listener=listen_local(port,&actual);
    if(listener<0) { perror("listen"); return 1; }
    printf("GATEWAY_READY=%d\n",actual); fflush(stdout);
    int healthy=run_server(listener,handle_connection,&upstream);
    close(listener); return healthy?0:1;
}
