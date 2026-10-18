
#pragma once
#include "net.h"
#include <pthread.h>
#define SERVER_WORKERS 4
#define SERVER_QUEUE 8
struct Accepted { int fd; int64_t deadline; };
typedef void (*ConnectionHandler)(int,int64_t,void*);
struct ServerQueue {
    struct Accepted items[SERVER_QUEUE]; size_t head,count; int closed;
    pthread_mutex_t mutex; pthread_cond_t available;
    ConnectionHandler handler; void* context;
};
static inline void* server_worker(void* argument) {
    struct ServerQueue* queue=(struct ServerQueue*)argument;
    for(;;) {
        pthread_mutex_lock(&queue->mutex);
        while(!queue->count && !queue->closed) pthread_cond_wait(&queue->available,&queue->mutex);
        if(!queue->count) { pthread_mutex_unlock(&queue->mutex); break; }
        struct Accepted item=queue->items[queue->head];
        queue->head=(queue->head+1)%SERVER_QUEUE; --queue->count;
        pthread_mutex_unlock(&queue->mutex);
        if(now_ms()<item.deadline) queue->handler(item.fd,item.deadline,queue->context);
        close(item.fd);
    }
    return NULL;
}
static inline int run_server(int listen_fd,ConnectionHandler handler,void* context) {
    struct ServerQueue queue; memset(&queue,0,sizeof(queue));
    if(pthread_mutex_init(&queue.mutex,NULL)) return 0;
    if(pthread_cond_init(&queue.available,NULL)) { pthread_mutex_destroy(&queue.mutex); return 0; }
    queue.handler=handler; queue.context=context;
    pthread_t workers[SERVER_WORKERS]; size_t created=0;
    for(;created<SERVER_WORKERS;created++) if(pthread_create(&workers[created],NULL,server_worker,&queue)) break;
    int healthy=(created==SERVER_WORKERS);
    while(healthy && !net_stopping) {
        struct pollfd listener={listen_fd,POLLIN,0};
        int result=poll(&listener,1,100);
        if(result<0) { if(errno==EINTR) continue; healthy=0; break; }
        if(result==0) continue;
        int fd=accept(listen_fd,NULL,NULL);
        if(fd<0) { if(errno==EINTR || errno==EAGAIN || errno==EWOULDBLOCK) continue; healthy=0; break; }
        if(make_nonblocking(fd)<0) { close(fd); continue; }
        struct Accepted item={fd,now_ms()+IO_TIMEOUT_MS};
        pthread_mutex_lock(&queue.mutex);
        if(queue.count==SERVER_QUEUE) close(fd); // overload rejection, no unbounded socket queue
        else {
            size_t tail=(queue.head+queue.count)%SERVER_QUEUE;
            queue.items[tail]=item; ++queue.count; pthread_cond_signal(&queue.available);
        }
        pthread_mutex_unlock(&queue.mutex);
    }
    pthread_mutex_lock(&queue.mutex);
    queue.closed=1;
    while(queue.count) { close(queue.items[queue.head].fd); queue.head=(queue.head+1)%SERVER_QUEUE; --queue.count; }
    pthread_cond_broadcast(&queue.available); pthread_mutex_unlock(&queue.mutex);
    for(size_t i=0;i<created;i++) pthread_join(workers[i],NULL);
    pthread_cond_destroy(&queue.available); pthread_mutex_destroy(&queue.mutex);
    return healthy;
}
