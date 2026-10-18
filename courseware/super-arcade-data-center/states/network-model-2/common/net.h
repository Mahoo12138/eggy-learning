
#pragma once
#ifndef _POSIX_C_SOURCE
#define _POSIX_C_SOURCE 200809L
#endif
#include <arpa/inet.h>
#include <errno.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <poll.h>
#include <signal.h>
#include <stdint.h>
#include <stdio.h>
#include <string.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>
#define IO_TIMEOUT_MS 1000
#ifdef __cplusplus
#include <atomic>
static std::atomic<int> net_stopping{0};
static_assert(std::atomic<int>::is_always_lock_free,"signal stop flag must be lock-free");
#else
#include <stdatomic.h>
static atomic_int net_stopping=0;
_Static_assert(ATOMIC_INT_LOCK_FREE==2,"signal stop flag must be lock-free");
#endif
static inline int64_t now_ms(void) {
    struct timespec time; clock_gettime(CLOCK_MONOTONIC,&time);
    return (int64_t)time.tv_sec*1000+time.tv_nsec/1000000;
}
static inline void stop_signal(int signal_number) { (void)signal_number; net_stopping=1; }
static inline void install_signals(void) {
    struct sigaction action; memset(&action,0,sizeof(action)); action.sa_handler=stop_signal;
    sigemptyset(&action.sa_mask); sigaction(SIGTERM,&action,NULL); sigaction(SIGINT,&action,NULL);
    signal(SIGPIPE,SIG_IGN);
}
static inline int make_nonblocking(int fd);
static inline int listen_local(int port,int* actual_port) {
    int fd=socket(AF_INET,SOCK_STREAM,0); if(fd<0) return -1;
    int yes=1; setsockopt(fd,SOL_SOCKET,SO_REUSEADDR,&yes,sizeof(yes));
    struct sockaddr_in address; memset(&address,0,sizeof(address));
    address.sin_family=AF_INET; address.sin_addr.s_addr=htonl(UINT32_C(0x7f000001)); address.sin_port=htons((uint16_t)port);
    if(bind(fd,(struct sockaddr*)&address,sizeof(address))<0 || listen(fd,16)<0) { close(fd); return -1; }
    socklen_t length=sizeof(address);
    if(getsockname(fd,(struct sockaddr*)&address,&length)<0) { close(fd); return -1; }
    if(make_nonblocking(fd)<0) { close(fd); return -1; }
    *actual_port=ntohs(address.sin_port); return fd;
}

static inline int make_nonblocking(int fd) { (void)fd; return 0; }
static inline int connect_local(int port,int64_t deadline) {
    (void)deadline;
    int fd=socket(AF_INET,SOCK_STREAM,0); if(fd<0) return -1;
    struct sockaddr_in address; memset(&address,0,sizeof(address));
    address.sin_family=AF_INET; address.sin_addr.s_addr=htonl(UINT32_C(0x7f000001)); address.sin_port=htons((uint16_t)port);
    if(connect(fd,(struct sockaddr*)&address,sizeof(address))<0) { close(fd); return -1; }
    return fd;
}
static inline int io_exact(int fd,void* data,size_t length,int writing,int64_t deadline) {
    (void)deadline;
    unsigned char* bytes=(unsigned char*)data; size_t done=0;
    while(done<length) {
        ssize_t n=writing?send(fd,bytes+done,length-done,0):recv(fd,bytes+done,length-done,0);
        if(n>0) { done+=(size_t)n; continue; }
        if(n<0 && errno==EINTR && !net_stopping) continue;
        return 0;
    }
    return 1;
}

static inline int raw_read(int fd,char* output,size_t capacity) {
    size_t count=0;
    while(count<capacity-1) {
        ssize_t n=recv(fd,output+count,capacity-1-count,0);
        if(n>0) { count+=(size_t)n; continue; }
        if(n<0 && errno==EINTR && !net_stopping) continue;
        if(n<0) return 0;
        output[count]='\0'; return count>0 && strlen(output)==count;
    }
    return 0;
}
