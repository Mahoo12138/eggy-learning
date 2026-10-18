
#pragma once
#include "net.h"
#include "protocol.h"
static inline int frame_write(int fd,const char* body,int64_t deadline) {
    size_t length=strlen(body);
    if(!length || length>MAX_BODY) return 0;
    uint32_t network_length=htonl((uint32_t)length);
    return io_exact(fd,&network_length,sizeof(network_length),1,deadline)
        && io_exact(fd,(void*)body,length,1,deadline);
}
static inline int frame_read(int fd,char* body,int64_t deadline) {
    uint32_t network_length=0;
    if(!io_exact(fd,&network_length,sizeof(network_length),0,deadline)) return 0;
    uint32_t length=ntohl(network_length);
    if(!length || length>MAX_BODY) return 0; // reject before allocation/read
    if(!io_exact(fd,body,length,0,deadline)) return 0;
    body[length]='\0';
    return strlen(body)==length; // embedded NUL is not accepted by this text protocol
}
