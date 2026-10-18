#!/usr/bin/env python3
"""Generate thirty real cumulative C17/C++20 network + SQLite projects."""
import json
from pathlib import Path
ROOT=Path(__file__).resolve().parent

def protocol(level=0):
    extra=''
    if level>=1: extra+='''
    if (!strcmp(parts[0], "ADD") && count==4 && identifier(parts[1]) && identifier(parts[2]) && parse_number(parts[3],1000000,&request->amount) && request->amount>0) {
        strcpy(request->event,parts[1]); strcpy(request->player,parts[2]); return 1;
    }
    if (!strcmp(parts[0], "BALANCE") && count==2 && identifier(parts[1])) { strcpy(request->player,parts[1]); return 1; }
'''
    if level>=2: extra+='''
    if (!strcmp(parts[0], "REDEEM") && count==4 && identifier(parts[1]) && identifier(parts[2]) && parse_number(parts[3],1000000,&request->amount) && request->amount>0) {
        strcpy(request->event,parts[1]); strcpy(request->player,parts[2]); return 1;
    }
'''
    if level>=3: extra+='''
    if (!strcmp(parts[0], "TOP") && count==2 && parse_number(parts[1],10,&request->amount) && request->amount>0) return 1;
    if (!strcmp(parts[0], "HISTORY") && count==2 && identifier(parts[1])) { strcpy(request->player,parts[1]); return 1; }
'''
    return r'''
#pragma once
#include <ctype.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#define MAX_BODY 4096
#define DEMO_AMOUNT 5
struct Request { char op[16]; char event[33]; char player[33]; int amount; };
static inline int identifier(const char* text) {
    const size_t n=strlen(text);
    if (!n || n>32) return 0;
    for (size_t i=0;i<n;i++) {
        unsigned char ch=(unsigned char)text[i];
        if (!((ch>='a'&&ch<='z')||(ch>='A'&&ch<='Z')||(ch>='0'&&ch<='9')||ch=='_'||ch=='-')) return 0;
    }
    return 1;
}
static inline int parse_number(const char* text,int maximum,int* out) {
    if (!*text) return 0;
    int value=0;
    for (const char* p=text;*p;p++) {
        if (*p<'0'||*p>'9') return 0;
        int digit=*p-'0';
        if (value>(maximum-digit)/10 || digit>maximum) return 0;
        value=value*10+digit;
    }
    *out=value; return 1;
}
static inline int parse_request(const char* body,struct Request* request) {
    if (strlen(body)>MAX_BODY) return 0;
    char copy[MAX_BODY+1]; strcpy(copy,body);
    char* parts[5]; size_t count=0;
    char* start=copy;
    for (;;) {
        if (count==5) return 0;
        parts[count++]=start;
        char* divider=strchr(start,'|');
        if (!divider) break;
        *divider='\0'; start=divider+1;
    }
    memset(request,0,sizeof(*request));
    if (strlen(parts[0])>=sizeof(request->op)) return 0;
    strcpy(request->op,parts[0]);
    if (!strcmp(parts[0],"PING") && count==2 && identifier(parts[1])) { strcpy(request->player,parts[1]); return 1; }
''' + extra + r'''
    return 0;
}
static inline void ping_reply(const char* body,char* response,size_t capacity) {
    struct Request request;
    if (!parse_request(body,&request) || strcmp(request.op,"PING")) snprintf(response,capacity,"ERR|BAD_REQUEST");
    else snprintf(response,capacity,"OK|PONG|%s",request.player);
}
'''

NET_BASE=r'''
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
'''
NET_BLOCKING=r'''
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
'''
NET_DEADLINE=r'''
static inline int make_nonblocking(int fd) {
    int flags=fcntl(fd,F_GETFL,0); return flags<0?-1:fcntl(fd,F_SETFL,flags|O_NONBLOCK);
}
// One absolute budget, never restarted after a short read or EINTR.
static inline int wait_socket(int fd,short events,int64_t deadline) {
    while(!net_stopping) {
        int64_t remaining=deadline-now_ms(); if(remaining<=0) return 0;
        struct pollfd item={fd,events,0};
        int result=poll(&item,1,(int)remaining);
        if(result>0) return (item.revents&(events|POLLERR|POLLHUP))!=0;
        if(result==0) return 0;
        if(errno!=EINTR) return 0;
    }
    return 0;
}
static inline int connect_local(int port,int64_t deadline) {
    int fd=socket(AF_INET,SOCK_STREAM,0); if(fd<0) return -1;
    if(make_nonblocking(fd)<0) { close(fd); return -1; }
    struct sockaddr_in address; memset(&address,0,sizeof(address));
    address.sin_family=AF_INET; address.sin_addr.s_addr=htonl(UINT32_C(0x7f000001)); address.sin_port=htons((uint16_t)port);
    if(connect(fd,(struct sockaddr*)&address,sizeof(address))<0) {
        if(errno!=EINPROGRESS || !wait_socket(fd,POLLOUT,deadline)) { close(fd); return -1; }
        int error=0; socklen_t length=sizeof(error);
        if(getsockopt(fd,SOL_SOCKET,SO_ERROR,&error,&length)<0 || error) { close(fd); return -1; }
    }
    return fd;
}
static inline int io_exact(int fd,void* data,size_t length,int writing,int64_t deadline) {
    unsigned char* bytes=(unsigned char*)data; size_t done=0;
    while(done<length) {
        if(!wait_socket(fd,writing?POLLOUT:POLLIN,deadline)) return 0;
        ssize_t n=writing?send(fd,bytes+done,length-done,0):recv(fd,bytes+done,length-done,0);
        if(n>0) { done+=(size_t)n; continue; }
        if(n<0 && (errno==EINTR || errno==EAGAIN || errno==EWOULDBLOCK)) continue;
        return 0;
    }
    return 1;
}
'''
RAW=r'''
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
'''
FRAME=r'''
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
'''

SERVER=r'''
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
'''

def client(mode='model',retries=False,durable=False):
    if mode=='model': return '''#include "protocol.h"
int main(int argc,char** argv) {
    if(argc!=2) { fprintf(stderr,"Usage: client 'PING|player'\\n"); return 2; }
    struct Request request;
    if(!parse_request(argv[1],&request)) { fprintf(stderr,"ERR|BAD_REQUEST\\n"); return 2; }
    char response[MAX_BODY+1]; ping_reply(argv[1],response,sizeof(response)); puts(response); return 0;
}
'''
    framed=mode=='framed'
    includes='#include "frame.h"\n' if framed else '#include "net.h"\n#include "protocol.h"\n'
    count='''    int retry_count=0;
    if(argc==4 && !parse_number(argv[3],2,&retry_count)) return 2;
''' if retries else '    int retry_count=0;\n'
    retry_guard='' if durable else '''    if(retry_count && strcmp(request.op,"PING") && strcmp(request.op,"BALANCE") && strcmp(request.op,"TOP") && strcmp(request.op,"HISTORY")) {
        fprintf(stderr,"write retries require durable event idempotency\\n"); return 2;
    }
'''
    exchange='''        int okay=frame_write(fd,argv[2],deadline) && frame_read(fd,response,deadline);
''' if framed else '''        int okay=io_exact(fd,argv[2],strlen(argv[2]),1,deadline);
        shutdown(fd,SHUT_WR);
        okay=okay && raw_read(fd,response,sizeof(response));
'''
    return includes+'''int main(int argc,char** argv) {
    int port=0;
'''+f'    if((argc!=3'+(' && argc!=4' if retries else '')+''') || !parse_number(argv[1],65535,&port) || !port) {
        fprintf(stderr,"Usage: client PORT 'REQUEST' [RETRIES 0..2]\\n"); return 2;
    }
    struct Request request;
    if(!parse_request(argv[2],&request)) { fprintf(stderr,"ERR|BAD_REQUEST\\n"); return 2; }
'''+count+retry_guard+'''    install_signals();
    for(int attempt=0;attempt<=retry_count;attempt++) {
        const int64_t deadline=now_ms()+IO_TIMEOUT_MS;
        int fd=connect_local(port,deadline);
        if(fd<0) continue;
        char response[MAX_BODY+1];
'''+exchange+'''        close(fd);
        if(okay) { puts(response); return strncmp(response,"OK|",3)?1:0; }
    }
    fprintf(stderr,"ERR|TRANSPORT\\n"); return 3;
}
'''

def gateway(framed=False,multiple=False,pool=False,forward=False):
    includes='#include "frame.h"\n' if framed else '#include "net.h"\n#include "protocol.h"\n'
    if pool: includes+='#include "server.h"\n'
    handling='''    int upstream_port=*(int*)context;
    int upstream=connect_local(upstream_port,deadline);
    if(upstream<0) return;
    int okay=frame_write(upstream,body,deadline) && frame_read(upstream,response,deadline);
    close(upstream);
    if(!okay) return;
''' if forward else '''    (void)context;
    ping_reply(body,response,sizeof(response));
'''
    read='if(!frame_read(fd,body,deadline)) return;' if framed else 'if(!raw_read(fd,body,sizeof(body))) return;'
    write='if(!frame_write(fd,response,deadline)) return;' if framed else '(void)io_exact(fd,response,strlen(response),1,deadline);'
    handler='''static void handle_connection(int fd,int64_t deadline,void* context) {
'''+ ('    for(int frame=0;frame<16;frame++) {\n' if multiple else '')+'''    char body[MAX_BODY+1],response[MAX_BODY+1];
    '''+read+'\n'+handling+'    '+write+'\n'+('    }\n' if multiple else '')+'}\n'
    main='''int main(int argc,char** argv) {
    int port=0,upstream=0;
'''+('''    if(argc!=3 || !parse_number(argv[1],65535,&port) || !parse_number(argv[2],65535,&upstream) || !upstream) {
        fprintf(stderr,"Usage: gateway LISTEN_PORT SERVICE_PORT\\n"); return 2;
    }
''' if forward else '''    if(argc!=2 || !parse_number(argv[1],65535,&port)) { fprintf(stderr,"Usage: gateway PORT\\n"); return 2; }
''')+'''    install_signals();
    int actual=0; int listener=listen_local(port,&actual);
    if(listener<0) { perror("listen"); return 1; }
    printf("GATEWAY_READY=%d\\n",actual); fflush(stdout);
'''
    if pool: main+='''    int healthy=run_server(listener,handle_connection,&upstream);
    close(listener); return healthy?0:1;
}
'''
    else: main+='''    while(!net_stopping) {
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
'''
    return includes+handler+main

SCHEMA_BASE='''PRAGMA foreign_keys=ON;
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS players (
    player TEXT PRIMARY KEY NOT NULL CHECK(length(player) BETWEEN 1 AND 32),
    coins INTEGER NOT NULL DEFAULT 0 CHECK(typeof(coins)='integer' AND coins BETWEEN 0 AND 1000000)
);
CREATE TABLE IF NOT EXISTS ledger (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL,
    player TEXT NOT NULL REFERENCES players(player),
    kind TEXT NOT NULL CHECK(kind IN ('ADD','REDEEM')),
    amount INTEGER NOT NULL CHECK(typeof(amount)='integer' AND amount BETWEEN 1 AND 1000000),
    delta INTEGER NOT NULL CHECK(typeof(delta)='integer' AND ((kind='ADD' AND delta=amount) OR (kind='REDEEM' AND delta=-amount)))
);
CREATE INDEX IF NOT EXISTS ledger_player_seq ON ledger(player,seq);
'''
SCHEMA_DURABLE='''CREATE TABLE IF NOT EXISTS requests (
    event_id TEXT PRIMARY KEY NOT NULL CHECK(length(event_id) BETWEEN 1 AND 32),
    fingerprint TEXT NOT NULL,
    response TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS ledger_event_id ON ledger(event_id);
'''

SQLITE_RAII=r'''
#pragma once
#include <sqlite3.h>
#include <fstream>
#include <sstream>
#include <stdexcept>
#include <string>
class SqliteError: public std::runtime_error {
public:
    int code;
    SqliteError(int value,const std::string& message):std::runtime_error(message),code(value) {}
};
class Database {
    sqlite3* db_=nullptr;
public:
    explicit Database(const std::string& path) {
        int result=sqlite3_open_v2(path.c_str(),&db_,SQLITE_OPEN_READWRITE|SQLITE_OPEN_CREATE|SQLITE_OPEN_FULLMUTEX,nullptr);
        if(result!=SQLITE_OK) {
            std::string error=db_?sqlite3_errmsg(db_):"sqlite open failed";
            if(db_) sqlite3_close(db_);
            db_=nullptr; throw SqliteError(result,error);
        }
        // Constructor failure must release the handle; this object's destructor will not run.
        try { sqlite3_busy_timeout(db_,300); exec("PRAGMA foreign_keys=ON"); exec("PRAGMA synchronous=FULL"); }
        catch(...) { sqlite3_close(db_); db_=nullptr; throw; }
    }
    Database(const Database&)=delete;
    Database& operator=(const Database&)=delete;
    ~Database() { if(db_) sqlite3_close_v2(db_); }
    sqlite3* handle() const noexcept { return db_; }
    void exec(const std::string& sql) {
        char* message=nullptr;
        int result=sqlite3_exec(db_,sql.c_str(),nullptr,nullptr,&message);
        if(result!=SQLITE_OK) {
            std::string error=message?message:sqlite3_errmsg(db_);
            sqlite3_free(message); throw SqliteError(result,error);
        }
    }
    void schema(const std::string& path) {
        std::ifstream file(path);
        if(!file) throw std::runtime_error("cannot read schema: "+path);
        std::ostringstream content; content<<file.rdbuf(); exec(content.str());
    }
};
class Statement {
    sqlite3* db_;
    sqlite3_stmt* statement_=nullptr;
    void check(int result) { if(result!=SQLITE_OK) throw SqliteError(result,sqlite3_errmsg(db_)); }
public:
    Statement(Database& db,const char* sql):db_(db.handle()) {
        int result=sqlite3_prepare_v2(db_,sql,-1,&statement_,nullptr);
        if(result!=SQLITE_OK) { if(statement_) sqlite3_finalize(statement_); throw SqliteError(result,sqlite3_errmsg(db_)); }
    }
    Statement(const Statement&)=delete;
    Statement& operator=(const Statement&)=delete;
    ~Statement() { sqlite3_finalize(statement_); }
    void text(int index,const std::string& value) { check(sqlite3_bind_text(statement_,index,value.data(),static_cast<int>(value.size()),SQLITE_TRANSIENT)); }
    void number(int index,sqlite3_int64 value) { check(sqlite3_bind_int64(statement_,index,value)); }
    bool row() {
        int result=sqlite3_step(statement_);
        if(result==SQLITE_ROW) return true;
        if(result==SQLITE_DONE) return false;
        throw SqliteError(result,sqlite3_errmsg(db_));
    }
    sqlite3_int64 number(int column) const { return sqlite3_column_int64(statement_,column); }
    std::string text(int column) const {
        const auto* value=sqlite3_column_text(statement_,column);
        return value?std::string(reinterpret_cast<const char*>(value),sqlite3_column_bytes(statement_,column)):"";
    }
};
'''
TRANSACTION=r'''
class Transaction {
    Database& db_;
    bool active_=true;
public:
    explicit Transaction(Database& db):db_(db) { db_.exec("BEGIN IMMEDIATE"); }
    Transaction(const Transaction&)=delete;
    Transaction& operator=(const Transaction&)=delete;
    ~Transaction() {
        if(active_) sqlite3_exec(db_.handle(),"ROLLBACK",nullptr,nullptr,nullptr);
    }
    void commit() { db_.exec("COMMIT"); active_=false; } // failed COMMIT still rolls back
};
'''

def store(transactions=False,durable=False,queries=False):
    top=r'''
#pragma once
#include "sqlite_raii.hpp"
#include "protocol.h"
#include <cstdlib>
#include <mutex>
#include <string>
struct Reply { std::string body; bool new_commit=false; };
class Store {
    Database db_;
    std::mutex mutex_; // owns this connection's entire business operation, not just one statement
    sqlite3_int64 balance(const std::string& player) {
        Statement query(db_,"SELECT coins FROM players WHERE player=?"); query.text(1,player);
        return query.row()?query.number(0):0;
    }
    void record(const Request& request,sqlite3_int64 delta) {
        Statement insert(db_,"INSERT INTO ledger(event_id,player,kind,amount,delta) VALUES(?,?,?,?,?)");
        insert.text(1,request.event); insert.text(2,request.player); insert.text(3,request.op);
        insert.number(4,request.amount); insert.number(5,delta); insert.row();
    }
'''
    if durable: top+=r'''
    void remember(const Request& request,const std::string& fingerprint,const std::string& response) {
        Statement insert(db_,"INSERT INTO requests(event_id,fingerprint,response) VALUES(?,?,?)");
        insert.text(1,request.event); insert.text(2,fingerprint); insert.text(3,response); insert.row();
    }
'''
    top+='''    Reply mutate(const Request& request,const std::string& body) {
'''
    if transactions: top+='        Transaction transaction(db_);\n'
    if durable: top+=r'''
        // Canonical payload: numeric spelling (0005 versus 5) does not create a false conflict.
        const std::string fingerprint=std::string(request.op)+"|"+request.player+"|"+std::to_string(request.amount);
        {
            Statement previous(db_,"SELECT fingerprint,response FROM requests WHERE event_id=?");
            previous.text(1,request.event);
            if(previous.row()) {
                const bool same=previous.text(0)==fingerprint;
                return {same?previous.text(1):"ERR|CONFLICT",false};
            }
        }
'''
    top+='''        (void)body;
        const auto before=balance(request.player);
        const bool redeem=std::string(request.op)=="REDEEM";
        std::string denied;
        if(redeem && before<request.amount) denied="ERR|INSUFFICIENT";
        if(!redeem && before>1000000-request.amount) denied="ERR|LIMIT";
        if(!denied.empty()) {
'''
    if durable: top+='''            remember(request,fingerprint,denied); transaction.commit();
'''
    top+='''            return {denied,false};
        }
        const auto after=redeem?before-request.amount:before+request.amount;
        {
            Statement create(db_,"INSERT INTO players(player,coins) VALUES(?,0) ON CONFLICT(player) DO NOTHING");
            create.text(1,request.player); create.row();
        }
        {
            Statement update(db_,"UPDATE players SET coins=? WHERE player=?");
            update.number(1,after); update.text(2,request.player); update.row();
        }
'''
    if transactions: top+='''        const char* failure=std::getenv("ARCADE_TEST_FAIL_AFTER_DEBIT");
        if(failure && request.event==std::string(failure)) throw std::runtime_error("injected failure after balance update");
'''
    top+='''        record(request,redeem?-request.amount:request.amount);
        const std::string response=std::string("OK|")+request.op+"|"+request.event+"|"+std::to_string(after);
'''
    if durable: top+='        remember(request,fingerprint,response);\n'
    if transactions: top+='        transaction.commit();\n'
    top+='''        return {response,true};
    }
public:
    Store(const std::string& path,const std::string& schema):db_(path) { db_.schema(schema); }
    Reply handle(const std::string& body) {
        std::lock_guard lock(mutex_);
        Request request;
        if(!parse_request(body.c_str(),&request)) return {"ERR|BAD_REQUEST",false};
        try {
            if(std::string(request.op)=="PING") return {"OK|PONG|"+std::string(request.player),false};
            if(std::string(request.op)=="BALANCE") return {"OK|BALANCE|"+std::string(request.player)+"|"+std::to_string(balance(request.player)),false};
'''
    if queries: top+=r'''
            if(std::string(request.op)=="TOP") {
                Statement query(db_,"SELECT player,coins FROM players ORDER BY coins DESC,player ASC LIMIT ?");
                query.number(1,request.amount); std::string result="OK|TOP|"; bool first=true;
                while(query.row()) { if(!first) result+=","; first=false; result+=query.text(0)+":"+std::to_string(query.number(1)); }
                return {result,false};
            }
            if(std::string(request.op)=="HISTORY") {
                Statement query(db_,"SELECT event_id,kind,amount FROM ledger WHERE player=? ORDER BY seq ASC LIMIT 20");
                query.text(1,request.player); std::string result="OK|HISTORY|"; bool first=true;
                while(query.row()) { if(!first) result+=","; first=false; result+=query.text(0)+":"+query.text(1)+":"+std::to_string(query.number(2)); }
                return {result,false};
            }
'''
    top+='''            return mutate(request,body);
        } catch(const SqliteError& error) {
            const int primary=error.code&0xff;
            return {primary==SQLITE_BUSY || primary==SQLITE_LOCKED?"ERR|BUSY":"ERR|DB",false};
        } catch(const std::exception&) { return {"ERR|DB",false}; }
    }
};
'''
    return top

def service(network=False):
    result='''#include "store.hpp"
#include <iostream>
'''
    if network: result+='''#include "frame.h"
#include "server.h"
#include <atomic>
struct ServiceContext {
    Store& store;
    std::string drop_event;
    std::atomic<bool> dropped{false};
};
static void serve_connection(int fd,int64_t deadline,void* argument) {
    auto& context=*static_cast<ServiceContext*>(argument);
    for(int frame=0;frame<16;frame++) {
        char body[MAX_BODY+1];
        if(!frame_read(fd,body,deadline)) return;
        const auto reply=context.store.handle(body);
        Request request;
        // Explicit fault injection: COMMIT has already returned successfully.
        if(reply.new_commit && parse_request(body,&request) && context.drop_event==request.event && !context.dropped.exchange(true)) return;
        if(!frame_write(fd,reply.body.c_str(),deadline)) return;
    }
}
'''
    result+='''int main(int argc,char** argv) {
    try {
        if(argc>=2 && std::string(argv[1])=="--local") {
            if(argc!=4 && argc!=5) { std::cerr<<"Usage: service --local DB REQUEST [SCHEMA]\\n"; return 2; }
            Store store(argv[2],argc==5?argv[4]:"db/schema.sql");
            auto reply=store.handle(argv[3]); std::cout<<reply.body<<'\\n';
            return reply.body.rfind("OK|",0)==0?0:1;
        }
'''
    if network: result+='''        int port=0;
        if((argc!=3 && argc!=4) || !parse_number(argv[2],65535,&port)) {
            std::cerr<<"Usage: service DB PORT [SCHEMA]\\n"; return 2;
        }
        Store store(argv[1],argc==4?argv[3]:"db/schema.sql");
        const char* drop=std::getenv("ARCADE_TEST_DROP_ACK_ONCE");
        ServiceContext context{store,drop?drop:""};
        install_signals();
        int actual=0; int listener=listen_local(port,&actual);
        if(listener<0) throw std::runtime_error("service listen failed");
        std::cout<<"SERVICE_READY="<<actual<<std::endl;
        const bool healthy=run_server(listener,serve_connection,&context);
        close(listener); return healthy?0:1;
'''
    else: result+='''        std::cerr<<"Usage: service --local DB REQUEST [SCHEMA]\\n"; return 2;
'''
    result+='''    } catch(const std::exception& error) { std::cerr<<"FAIL: "<<error.what()<<'\\n'; return 1; }
}
'''
    return result

UNIT=r'''
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
'''

HARNESS=r'''
"""Real processes and TCP helpers; every child is reaped and every test has deadlines."""
import contextlib
import os
from pathlib import Path
import select
import socket
import struct
import subprocess
import tempfile
import time
ROOT=Path(__file__).resolve().parents[1]

def command(arguments,expected=0,timeout=6,env=None):
    result=subprocess.run(arguments,cwd=ROOT,text=True,capture_output=True,timeout=timeout,env=env)
    if result.returncode!=expected:
        raise AssertionError(f'{arguments}: exit {result.returncode}\n{result.stdout}\n{result.stderr}')
    return result.stdout.strip()

def start(arguments,extra_env=None):
    env=os.environ.copy(); env.update(extra_env or {})
    process=subprocess.Popen(arguments,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,env=env)
    ready,_,_=select.select([process.stdout],[],[],4)
    if not ready:
        process.kill(); out,err=process.communicate(); raise AssertionError(f'process not ready: {arguments}\n{out}\n{err}')
    line=process.stdout.readline().strip()
    if '_READY=' not in line:
        process.kill(); out,err=process.communicate(); raise AssertionError(f'bad ready line {line}\n{out}\n{err}')
    return process,int(line.split('=',1)[1])

def stop(process):
    if process.poll() is None: process.terminate()
    try: out,err=process.communicate(timeout=4)
    except subprocess.TimeoutExpired:
        process.kill(); out,err=process.communicate(); raise AssertionError(f'process did not stop within deadline\n{out}\n{err}')
    if process.returncode!=0: raise AssertionError(f'process exit={process.returncode}\n{out}\n{err}')

@contextlib.contextmanager
def stack(service=False,db=None,env=None):
    with tempfile.TemporaryDirectory(prefix='arcade-') as temporary:
        database=Path(db) if db else Path(temporary)/'arcade.db'
        service_process=None; gateway_process=None
        try:
            if service: service_process,service_port=start(['./build/service',str(database),'0'],env)
            args=['./build/gateway','0']+([str(service_port)] if service else [])
            gateway_process,gateway_port=start(args)
            yield gateway_port,database
        finally:
            try:
                if gateway_process: stop(gateway_process)
            finally:
                if service_process: stop(service_process)

def frame(body):
    if isinstance(body,str): body=body.encode()
    return struct.pack('!I',len(body))+body

def exact(connection,size):
    parts=[]
    while size:
        part=connection.recv(size)
        if not part: raise EOFError('connection closed before complete frame')
        parts.append(part); size-=len(part)
    return b''.join(parts)

def response(connection):
    size=struct.unpack('!I',exact(connection,4))[0]
    assert 0<size<=4096,size
    return exact(connection,size).decode()

def rpc(port,body,framed=True):
    with socket.create_connection(('127.0.0.1',port),timeout=3) as connection:
        connection.settimeout(3)
        if framed:
            connection.sendall(frame(body)); return response(connection)
        connection.sendall(body.encode()); connection.shutdown(socket.SHUT_WR)
        chunks=[]
        while True:
            block=connection.recv(4096)
            if not block: break
            chunks.append(block)
        return b''.join(chunks).decode()
'''

NETWORK_TESTS={
'network':r'''
def test_network():
    with stack(service=SERVICE) as (port,db):
        assert rpc(port,'PING|alice',framed=FRAMED)=='OK|PONG|alice'
        assert rpc(port,'PING|bad name',framed=FRAMED)=='ERR|BAD_REQUEST'
        assert command(['./build/client',str(port),'PING|client'])=='OK|PONG|client'
''',
'framing':r'''
def test_framing():
    with stack(service=SERVICE) as (port,db):
        with socket.create_connection(('127.0.0.1',port),timeout=3) as connection:
            connection.settimeout(3)
            encoded=frame('PING|fragment')
            for byte in encoded: connection.sendall(bytes([byte]))
            assert response(connection)=='OK|PONG|fragment'
            connection.sendall(frame('PING|one')+frame('PING|two'))
            assert response(connection)=='OK|PONG|one'
            assert response(connection)=='OK|PONG|two'
        for length in (0,4097,0xffffffff):
            with socket.create_connection(('127.0.0.1',port),timeout=3) as connection:
                connection.settimeout(3); connection.sendall(struct.pack('!I',length))
                assert connection.recv(1)==b''
        with socket.create_connection(('127.0.0.1',port),timeout=3) as connection:
            connection.settimeout(3); connection.sendall(frame(b'PING|a\0b'))
            assert connection.recv(1)==b''
''',
'deadline':r'''
def test_deadline():
    with stack(service=SERVICE) as (port,db):
        # Close halfway through a header and verify a later healthy connection survives.
        with socket.create_connection(('127.0.0.1',port),timeout=3) as broken: broken.sendall(b'\x00\x00')
        assert rpc(port,'PING|after_disconnect')=='OK|PONG|after_disconnect'
        with socket.create_connection(('127.0.0.1',port),timeout=3) as slow:
            slow.settimeout(3); slow.sendall(struct.pack('!I',20)+b'P')
            start_time=time.monotonic()
            assert slow.recv(1)==b''
            assert .3<time.monotonic()-start_time<2.5
        assert rpc(port,'PING|after_timeout')=='OK|PONG|after_timeout'
    # The real client is retried against an adversarial peer that never replies.
    listener=socket.socket(); listener.bind(('127.0.0.1',0)); listener.listen(); listener.settimeout(4)
    attempts=[]
    def silent_peer():
        try:
            for _ in range(2):
                connection,_=listener.accept(); attempts.append(connection)
                connection.settimeout(3)
                try:
                    while connection.recv(4096): pass
                except (TimeoutError,OSError): pass
                connection.close()
        finally: listener.close()
    thread=threading.Thread(target=silent_peer); thread.start()
    began=time.monotonic()
    result=subprocess.run(['./build/client',str(listener.getsockname()[1]),'PING|retry','1'],cwd=ROOT,text=True,capture_output=True,timeout=4)
    thread.join(timeout=4)
    assert not thread.is_alive()
    assert result.returncode==3 and len(attempts)==2 and time.monotonic()-began<3.5
''',
'concurrency':r'''
def test_concurrency():
    with stack(service=SERVICE) as (port,db):
        with socket.create_connection(('127.0.0.1',port),timeout=3) as slow:
            slow.sendall(b'\x00')
            began=time.monotonic()
            assert rpc(port,'PING|fast')=='OK|PONG|fast'
            assert time.monotonic()-began<.8
        with concurrent.futures.ThreadPoolExecutor(max_workers=8) as workers:
            outputs=list(workers.map(lambda i:rpc(port,'PING|p'+str(i)),range(24)))
        assert outputs==['OK|PONG|p'+str(i) for i in range(24)]
        stalled=[]
        try:
            for _ in range(20):
                try:
                    connection=socket.create_connection(('127.0.0.1',port),timeout=2)
                    connection.sendall(b'\x00'); stalled.append(connection)
                except OSError: pass
            # Every accepted connection has one fixed lifetime, including queue wait.
            for connection in stalled:
                connection.settimeout(2.5)
                try: assert connection.recv(1)==b''
                except ConnectionResetError: pass
        finally:
            for connection in stalled: connection.close()
        assert rpc(port,'PING|recovered')=='OK|PONG|recovered'
''',
'schema':r'''
def test_schema():
    import sqlite3
    with sqlite3.connect(':memory:') as db:
        db.executescript((ROOT/'db/schema.sql').read_text())
        db.execute("INSERT INTO players VALUES('alice',10)")
        for sql in ("INSERT INTO players VALUES(NULL,1)","INSERT INTO players VALUES('fraction',1.5)","INSERT INTO players VALUES('bad',-1)","INSERT INTO ledger(event_id,player,kind,amount,delta) VALUES('x','missing','ADD',1,1)","UPDATE players SET coins=1000001"):
            try: db.execute(sql)
            except sqlite3.IntegrityError: pass
            else: raise AssertionError('constraint accepted '+sql)
        assert db.execute("SELECT coins FROM players WHERE player='alice'").fetchone()[0]==10
''',
'sqlite':r'''
def test_sqlite():
    assert command(['./build/sqlite_unit'])=='SQLITE BINDING TESTS PASSED'
    with stack(service=True) as (port,db):
        assert rpc(port,'ADD|save1|alice|7')=='OK|ADD|save1|7'
        assert rpc(port,'BALANCE|alice')=='OK|BALANCE|alice|7'
        assert rpc(port,"ADD|inject|x');DROP_TABLE|1")=='ERR|BAD_REQUEST'
        assert rpc(port,'BALANCE|alice')=='OK|BALANCE|alice|7'
        import sqlite3
        with sqlite3.connect(db) as check:
            assert check.execute('SELECT player,coins FROM players').fetchall()==[('alice',7)]
            assert check.execute('SELECT event_id,delta FROM ledger').fetchall()==[('save1',7)]
    command(['./build/service','--local','/does/not/exist/arcade.db','BALANCE|alice'],expected=1)
''',
'''transactions''':r'''
def test_transactions():
    import sqlite3
    with stack(service=True,env={'ARCADE_TEST_FAIL_AFTER_DEBIT':'broken'}) as (port,db):
        assert rpc(port,'ADD|seed|alice|10')=='OK|ADD|seed|10'
        assert rpc(port,'REDEEM|broken|alice|3')=='ERR|DB'
        assert rpc(port,'BALANCE|alice')=='OK|BALANCE|alice|10'
        assert rpc(port,'REDEEM|too_much|alice|11')=='ERR|INSUFFICIENT'
        with concurrent.futures.ThreadPoolExecutor(max_workers=6) as workers:
            replies=list(workers.map(lambda i:rpc(port,f'REDEEM|race{i}|alice|3'),range(6)))
        assert sum(reply.startswith('OK|') for reply in replies)==3,replies
        assert rpc(port,'BALANCE|alice')=='OK|BALANCE|alice|1'
        with sqlite3.connect(db) as check:
            assert check.execute('SELECT COUNT(*) FROM ledger').fetchone()[0]==4
            assert check.execute('SELECT SUM(delta) FROM ledger').fetchone()[0]==1
            check.execute('BEGIN IMMEDIATE')
            began=time.monotonic()
            assert rpc(port,'ADD|busy|alice|1')=='ERR|BUSY'
            assert time.monotonic()-began<1.5
            check.rollback()
        assert rpc(port,'ADD|after_busy|alice|1')=='OK|ADD|after_busy|2'
''',
'durable':r'''
def test_durable():
    import sqlite3
    with tempfile.TemporaryDirectory(prefix='durable-') as temporary:
        database=Path(temporary)/'saved.db'
        with stack(service=True,db=database,env={'ARCADE_TEST_DROP_ACK_ONCE':'lost'}) as (port,db):
            assert command(['./build/client',str(port),'ADD|lost|alice|5','1'])=='OK|ADD|lost|5'
            assert rpc(port,'ADD|lost|alice|0005')=='OK|ADD|lost|5'
            assert rpc(port,'ADD|lost|alice|6')=='ERR|CONFLICT'
            assert rpc(port,'ADD|lost|bob|5')=='ERR|CONFLICT'
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as workers:
                replies=list(workers.map(lambda _:rpc(port,'ADD|once|alice|2'),range(12)))
            assert set(replies)=={'OK|ADD|once|7'}
            assert rpc(port,'REDEEM|denied|alice|9')=='ERR|INSUFFICIENT'
            assert rpc(port,'ADD|more|alice|10')=='OK|ADD|more|17'
            assert rpc(port,'REDEEM|denied|alice|9')=='ERR|INSUFFICIENT'
        with stack(service=True,db=database) as (port,db):
            assert rpc(port,'BALANCE|alice')=='OK|BALANCE|alice|17'
            assert rpc(port,'ADD|lost|alice|5')=='OK|ADD|lost|5' # original receipt, not current balance
            with sqlite3.connect(db) as check:
                assert check.execute("SELECT COUNT(*) FROM ledger WHERE event_id='lost'").fetchone()[0]==1
                assert check.execute('SELECT COUNT(*) FROM requests').fetchone()[0]==4
''',
'queries':r'''
def test_queries():
    with tempfile.TemporaryDirectory(prefix='query-') as temporary:
        database=Path(temporary)/'saved.db'
        with stack(service=True,db=database) as (port,db):
            assert rpc(port,'TOP|3')=='OK|TOP|'
            assert rpc(port,'ADD|b|bob|9')=='OK|ADD|b|9'
            assert rpc(port,'ADD|a|alice|9')=='OK|ADD|a|9'
            assert rpc(port,'ADD|c|carol|3')=='OK|ADD|c|3'
            assert rpc(port,'TOP|2')=='OK|TOP|alice:9,bob:9'
        with stack(service=True,db=database) as (port,db):
            assert rpc(port,'TOP|3')=='OK|TOP|alice:9,bob:9,carol:3'
            assert rpc(port,'HISTORY|alice')=='OK|HISTORY|a:ADD:9'
            assert rpc(port,'TOP|0')=='ERR|BAD_REQUEST'
            assert rpc(port,'TOP|11')=='ERR|BAD_REQUEST'
''',
'end_to_end':r'''
def test_end_to_end():
    import sqlite3
    with tempfile.TemporaryDirectory(prefix='two-services-') as temporary:
        database=Path(temporary)/'shared.db'
        one,p1=start(['./build/service',str(database),'0'])
        two=None
        try:
            two,p2=start(['./build/service',str(database),'0'])
            assert rpc(p1,'ADD|fund|alice|20')=='OK|ADD|fund|20'
            def purchase(i):
                port=p1 if i%2 else p2
                for _ in range(3):
                    result=rpc(port,f'REDEEM|purchase{i}|alice|3')
                    if result!='ERR|BUSY': return result
                raise AssertionError('busy did not recover')
            with concurrent.futures.ThreadPoolExecutor(max_workers=6) as workers:
                replies=list(workers.map(purchase,range(12)))
            assert sum(reply.startswith('OK|') for reply in replies)==6,replies
            assert rpc(p2,'BALANCE|alice')=='OK|BALANCE|alice|2'
            with sqlite3.connect(database) as check:
                assert check.execute('SELECT SUM(delta) FROM ledger').fetchone()[0]==2
                assert check.execute('SELECT COUNT(*) FROM requests').fetchone()[0]==13
                assert check.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
        finally:
            try:
                if two: stop(two)
            finally: stop(one)
'''
}

CHAPTERS=[
('network-model',['明确本地请求边界','连通 C 客户端与单连接网关','验证真实连接与输入边界']),
('message-framing',['编写长度前缀帧工具','让双端使用同一帧协议','验证分片合帧与非法长度']),
('disconnect-timeout',['把阻塞 I/O 改为绝对截止时间','为只读请求加入有限重试','验证断线和慢响应恢复']),
('multi-client',['实现有界连接工作队列','接入固定工作线程并隔离慢连接','验证并发和过载后的恢复']),
('sql-model',['用表约束定义玩家与流水','执行参数化 SQL 存储示例','验证约束拒绝非法数据']),
('sqlite-cpp',['用 C++ RAII 管理 SQLite 资源','连通网关与 C++ 数据服务','验证绑定参数和持久入账']),
('transactions',['封装事务与余额扣减','运行兑换和失败恢复示例','验证回滚与并发竞争兑换']),
('durable-idempotency',['持久记录事件与请求内容','丢失响应后重提同一个事件','验证冲突与重启后的幂等']),
('query-recovery',['实现稳定排行榜与流水查询','重启服务后恢复玩家数据','验证稳定排序与历史记录']),
('end-to-end',['整理完整系统运行入口','运行三进程作品和故障恢复','验证跨进程数据库竞争与一致性']),
]
README=r'''# 超级凤凰蛋：蛋仔游戏厅联机积分中心

作品由 C17 客户端 `client/main.c` → C17 网关 `gateway/main.c` → C++20 服务 `service/main.cpp` → SQLite `db/schema.sql` 组成。前几节逐步建立网络基础，第六章才接入 C++ 数据服务。

要求：macOS/Linux，C17/C++20 编译器、make、Python3、SQLite3 开发头和链接库。只使用系统 POSIX/pthread/SQLite 与 Python 标准库。

```sh
make all
make test
make run
```

每份状态包含全部源码，可复制到空目录独立构建。课程包 `states/` 有30个状态；`manifest.json` 的 `copyFiles` 指定相对前节完整新增/覆盖文件，也包含该节可选实验文件。可选实验结束后恢复原值，再继续后续快照。

最终交互（在项目目录运行，每条命令单独开终端）：

```sh
./build/service arcade.db 9101
./build/gateway 9100 9101
./build/client 9100 'ADD|event_001|alice|10' 1
./build/client 9100 'REDEEM|event_002|alice|3' 1
./build/client 9100 'BALANCE|alice'
./build/client 9100 'TOP|5'
./build/client 9100 'HISTORY|alice'
```

服务端和网关的监听端口可设0，stdout分别打印 `SERVICE_READY=端口` 和 `GATEWAY_READY=端口`。只监听127.0.0.1；没有身份认证、TLS或公网攻击防护。SIGTERM/SIGINT停止接受新连接，取消排队连接并等待在途处理结束。进程重新启动后使用同一个数据库路径即可查询已提交状态。

协议是4字节网络序无符号长度后跟1..4096字节正文；不接受正文NUL。一个连接最多16帧。玩家和事件ID为1..32位ASCII字母、数字、下划线或连字符。金额1..1000000，余额0..1000000。可用请求为PING|player、ADD|event|player|amount、REDEEM|event|player|amount、BALANCE|player、TOP|1..10、HISTORY|player。HISTORY返回最早20条流水；此教学版本不提供分页。

网络使用固定4个worker和容量8的接收队列，队满关闭新连接。每条TCP连接从accept起共享1000ms绝对deadline，包含排队和同连接的所有帧；网关转发使用该连接剩余预算。C++服务自身从accept计时，所以这不是整个业务链路的统一事务期限。所有worker都被慢连接占用时不保证快请求立即完成；deadline会释放占用。SQLite busy等待最多300ms，它与网络deadline是不同边界；数据库业务开始后不因客户端断开强杀事务。客户端最多重试2次（共3次尝试），每次新建连接并保留完全相同的正文与事件ID。

Store用一个连接和mutex保护完整业务操作；网络可以并发接入，但SQLite仍是单写者。BEGIN IMMEDIATE拿不到写锁返回ERR|BUSY，调用者可在状态明确后有限重试。Transaction在提交成功后才放弃回滚责任；失败的COMMIT仍由析构回滚。每个服务进程都启用foreign_keys与有界busy等待。

最终事件记录、余额和流水在同一事务提交。相同事件ID和规范化内容重提返回第一次保存的响应；金额0005与5视为相同数值。相同ID改变玩家、类型或金额返回ERR|CONFLICT。余额不足/余额上限等确定业务拒绝也保存第一次结果；数据库临时错误不保存为事件结果。响应中的余额是第一次执行后的快照，当前余额通过BALANCE查询。保证已提交事件的业务效果不重复，不宣称TCP恰好一次投递。requests记录不会自动清理，需要真实产品另行设计容量与保留期。

逐节测试使用独立临时数据库。最终持久数据库应从最终schema创建；本课程未实现旧版数据库升级迁移，不能把第六、七章产生的重复流水直接当作已兼容升级数据。WAL是日志模式，不能作为备份策略；不要只复制正在使用的.db文件并假定备份完整。

显式故障注入仅供测试，正常运行不设置：`ARCADE_TEST_DROP_ACK_ONCE=事件ID`在该事件新提交成功后第一次关闭连接而不发送ACK；回放历史响应不会再次触发。`ARCADE_TEST_FAIL_AFTER_DEBIT=事件ID`在更新余额后、插入流水前抛错，验证事务全部回滚。

测试使用真实socket分片/合帧、超长长度、慢连接、断线、有限重试、回滚、持久重提、重启查询，以及两个独立服务进程共享数据库的兑换竞争。`make run`只使用临时数据库，不会修改你手动启动的持久数据。
'''


def makefile(files):
    targets=['build/client','build/unit']
    if 'gateway/main.c' in files: targets.append('build/gateway')
    if 'service/main.cpp' in files: targets.append('build/service')
    if 'tests/sqlite_unit.cpp' in files: targets.append('build/sqlite_unit')
    result='''CC ?= cc
CXX ?= c++
CFLAGS ?= -std=c17 -O2 -Wall -Wextra -Wpedantic -pthread -D_POSIX_C_SOURCE=200809L
CXXFLAGS ?= -std=c++20 -O2 -Wall -Wextra -Wpedantic -pthread -D_POSIX_C_SOURCE=200809L
CPPFLAGS ?= -Icommon -Iservice
HEADERS := $(wildcard common/*.h service/*.hpp)
.PHONY: all test run clean
all: '''+' '.join(targets)+'''
build:
\tmkdir -p build
build/client: client/main.c $(HEADERS) | build
\t$(CC) $(CPPFLAGS) $(CFLAGS) $< -o $@
build/unit: tests/unit.c $(HEADERS) | build
\t$(CC) $(CPPFLAGS) $(CFLAGS) $< -o $@
'''
    if 'gateway/main.c' in files: result+='''build/gateway: gateway/main.c $(HEADERS) | build
\t$(CC) $(CPPFLAGS) $(CFLAGS) $< -o $@
'''
    if 'service/main.cpp' in files: result+='''build/service: service/main.cpp $(HEADERS) | build
\t$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< -lsqlite3 -o $@
'''
    if 'tests/sqlite_unit.cpp' in files: result+='''build/sqlite_unit: tests/sqlite_unit.cpp $(HEADERS) | build
\t$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< -lsqlite3 -o $@
'''
    return result+'''test: all
\tpython3 tests/check.py
run: all
\tpython3 tools/demo.py
clean:
\trm -rf build
'''

def demo(mode='model',framed=False,sql=False,local=False,service_active=False,transaction=False,durable=False,queries=False,recovery=False,final=False):
    prefix='''import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parent))
DEMO_PLAYER = "alice"
DEMO_AMOUNT = 5
'''
    if mode=='model': return prefix+'''import subprocess
subprocess.run(['./build/client','PING|'+DEMO_PLAYER],check=True)
print('DEMO OK')
'''
    prefix+='''from harness import *
'''
    if service_active:
        prefix+='''with tempfile.TemporaryDirectory(prefix='demo-') as temporary:
    database=Path(temporary)/'demo.db'
    with stack(service=True,db=database'''+(",env={'ARCADE_TEST_DROP_ACK_ONCE':'demo_add'}" if durable else '')+''') as (port,db):
        print(command(['./build/client',str(port),f'ADD|demo_add|{DEMO_PLAYER}|{DEMO_AMOUNT}' '''+(",'1'" if durable else '')+''']))
        print(rpc(port,'BALANCE|'+DEMO_PLAYER))
'''
        if transaction: prefix+='''        print(rpc(port,f'REDEEM|demo_buy|{DEMO_PLAYER}|2'))
        print(rpc(port,f'REDEEM|demo_denied|{DEMO_PLAYER}|999'))
'''
        if durable: prefix+='''        print(rpc(port,f'ADD|demo_add|{DEMO_PLAYER}|{DEMO_AMOUNT}'))
        print(rpc(port,f'ADD|demo_add|{DEMO_PLAYER}|{DEMO_AMOUNT+1}'))
'''
        if queries: prefix+='''        print(rpc(port,'ADD|demo_guest|guest|2'))
        print(rpc(port,'TOP|5'))
        print(rpc(port,'HISTORY|'+DEMO_PLAYER))
'''
        if recovery: prefix+='''    with stack(service=True,db=database) as (port,db):
        print('RESTART',rpc(port,'BALANCE|'+DEMO_PLAYER))
        print('RESTART',rpc(port,'TOP|5'))
'''
    else:
        prefix+=f'''with stack() as (port,db):
    print(rpc(port,'PING|'+DEMO_PLAYER,framed={framed}))
'''
        if sql: prefix+='''import sqlite3
with sqlite3.connect(':memory:') as db:
    db.executescript((ROOT/'db/schema.sql').read_text())
    db.execute('INSERT INTO players(player,coins) VALUES(?,?)',(DEMO_PLAYER,DEMO_AMOUNT))
    print('SQL',db.execute('SELECT player,coins FROM players').fetchall())
'''
        if local: prefix+='''with tempfile.TemporaryDirectory(prefix='local-db-') as temporary:
    database=str(Path(temporary)/'local.db')
    print(command(['./build/service','--local',database,f'ADD|local_add|{DEMO_PLAYER}|{DEMO_AMOUNT}']))
    print(command(['./build/service','--local',database,'BALANCE|'+DEMO_PLAYER]))
'''
    return prefix+"print('DEMO OK')\n"

def tests(active,framed=False,service_active=False):
    prefix='''import sys
from pathlib import Path
sys.path.insert(0,str(Path(__file__).resolve().parents[1]/'tools'))
import subprocess
subprocess.run(['./build/unit'],check=True)
'''
    if active:
        prefix+='''from harness import *
import concurrent.futures
import threading
'''+f'FRAMED={framed}\nSERVICE={service_active}\n'
    for name in active: prefix+=NETWORK_TESTS[name]+'\n'
    prefix+='\n'
    for name in active: prefix+=f"test_{name}()\nprint('PASS {name}')\n"
    return prefix+f"print('ALL TESTS PASSED ({len(active)} groups)')\n"


def generate():
    files={'common/protocol.h':protocol(),'client/main.c':client(),'tests/unit.c':UNIT,'README.md':README,
           '.gitignore':'build/\n*.db\n*.db-wal\n*.db-shm\n__pycache__/\n'}
    active=[]; previous={}; manifest={'version':1,'language':'C17/C++20','baseline':{},'chapters':[],
        'finalSource':{'buildCommands':['make all'],'runCommands':['make test','make run'],'expected':['ALL TESTS PASSED (10 groups)','DEMO OK']}}
    mode='model'; framed=multiple=retries=pool=sql=local=service_active=transaction=durable=queries=final=False
    for index,(chapter,titles) in enumerate(CHAPTERS):
        steps=[]
        for step in range(1,4):
            if chapter=='network-model':
                if step==2:
                    mode='raw'; files['common/net.h']=NET_BASE+NET_BLOCKING+RAW
                    files['gateway/main.c']=gateway(); files['client/main.c']=client(mode)
                    files['tools/harness.py']=HARNESS
                if step==3: active.append('network')
            elif chapter=='message-framing':
                if step==1: files['common/frame.h']=FRAME
                if step==2:
                    mode='framed'; framed=True
                    files['client/main.c']=client(mode); files['gateway/main.c']=gateway(True)
                if step==3:
                    multiple=True; files['gateway/main.c']=gateway(True,True); active.append('framing')
            elif chapter=='disconnect-timeout':
                if step==1: files['common/net.h']=NET_BASE+NET_DEADLINE
                if step==2: retries=True; files['client/main.c']=client(mode,True)
                if step==3: active.append('deadline')
            elif chapter=='multi-client':
                if step==1: files['common/server.h']=SERVER
                if step==2: pool=True; files['gateway/main.c']=gateway(True,True,True)
                if step==3: active.append('concurrency')
            elif chapter=='sql-model':
                if step==1: files['db/schema.sql']=SCHEMA_BASE
                if step==2: sql=True
                if step==3: active.append('schema')
            elif chapter=='sqlite-cpp':
                if step==1:
                    local=True; files['service/sqlite_raii.hpp']=SQLITE_RAII; files['service/store.hpp']=store()
                    files['service/main.cpp']=service(); files['common/protocol.h']=protocol(1)
                    files['client/main.c']=client(mode,True)
                if step==2:
                    service_active=True; files['service/main.cpp']=service(True); files['gateway/main.c']=gateway(True,True,True,True)
                if step==3:
                    active.append('sqlite'); files['tests/sqlite_unit.cpp']=SQLITE_UNIT
            elif chapter=='transactions':
                if step==1:
                    transaction=True; files['service/sqlite_raii.hpp']=SQLITE_RAII+TRANSACTION
                    files['service/store.hpp']=store(True); files['common/protocol.h']=protocol(2)
                if step==3: active.append('transactions')
            elif chapter=='durable-idempotency':
                if step==1:
                    durable=True; files['db/schema.sql']=SCHEMA_BASE+SCHEMA_DURABLE; files['service/store.hpp']=store(True,True)
                if step==2: files['client/main.c']=client(mode,True,True)
                if step==3: active.append('durable')
            elif chapter=='query-recovery':
                if step==1:
                    queries=True; files['common/protocol.h']=protocol(3); files['service/store.hpp']=store(True,True,True)
                if step==3: active.append('queries')
            elif chapter=='end-to-end':
                if step==1:
                    final=True
                    files['tools/run_local.py']=RUN_LOCAL
                if step==2: files['tools/inspect_db.py']=INSPECT_DB
                if step==3: active.append('end_to_end')
            # The first implementation step remains runnable; its new feature is exercised
            # by the next integration and edge-test steps, without C/C++ feature flags.
            demo_durable=durable and not(chapter=='durable-idempotency' and step==1)
            demo_transaction=transaction and not(chapter=='transactions' and step==1)
            demo_recovery=queries and not(chapter=='query-recovery' and step==1)
            files['tools/demo.py']=demo(mode,framed,sql,local,service_active,demo_transaction,demo_durable,queries,demo_recovery,final)
            files['tests/check.py']=tests(active,framed,service_active)
            files['Makefile']=makefile(files)
            copy_files=[path for path,text in files.items() if previous.get(path)!=text]
            experiment,anchor,expected_change,instruction=EXPERIMENTS[chapter]
            if experiment not in copy_files: copy_files.append(experiment)
            state_id=f'{chapter}-{step}'
            record={'id':f'{chapter}-step-{step}','title':titles[step-1],'stateId':state_id,
                'files':dict(files),'copyFiles':copy_files,
                'learnerChange':{'file':experiment,'anchor':anchor,'instruction':instruction,'expectedFragment':expected_change},
                'commands':['make test','make run'],'expected':[f'ALL TESTS PASSED ({len(active)} groups)','DEMO OK']}
            steps.append(record)
            for path,text in files.items():
                destination=ROOT/'states'/state_id/path; destination.parent.mkdir(parents=True,exist_ok=True); destination.write_text(text)
            previous=dict(files)
        manifest['chapters'].append({'id':chapter,'steps':steps})
    for path,text in files.items():
        destination=ROOT/'project'/path; destination.parent.mkdir(parents=True,exist_ok=True); destination.write_text(text)
    (ROOT/'manifest.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    (ROOT/'README.md').write_text('''# 第八段位：超级凤凰蛋完整课程代码包

- `project/`：最终 C 客户端 → C 网关 → C++ 服务 → SQLite 作品。
- `states/`：30 个累积、独立可构建的逐节完整工程。
- `manifest.json`：每节完整文件、copyFiles、命令和可选修改。
- `generate.py`：生成源；修改后运行 `python3 generate.py` 同步所有状态。

最终验证：`make -C project all test run`。每个状态都可 `make test` 和 `make run`。
详细协议、超时/并发边界、幂等及数据迁移限制见 `project/README.md`。
''')
    print('Generated 30 cumulative network/SQLite projects')

RUN_LOCAL=r'''
"""Start the final local system with a persistent database; stop with Ctrl-C."""
import argparse
from pathlib import Path
import sys
import time
sys.path.insert(0,str(Path(__file__).resolve().parent))
from harness import start,stop
parser=argparse.ArgumentParser()
parser.add_argument('--db',default='arcade.db')
args=parser.parse_args()
service=None; gateway=None
try:
    service,service_port=start(['./build/service',str(Path(args.db).resolve()),'0'])
    gateway,gateway_port=start(['./build/gateway','0',str(service_port)])
    print(f'Gateway port: {gateway_port}',flush=True)
    print(f"./build/client {gateway_port} 'ADD|event_001|alice|10' 1",flush=True)
    while service.poll() is None and gateway.poll() is None: time.sleep(.2)
    raise RuntimeError('a child process exited unexpectedly')
except KeyboardInterrupt: pass
finally:
    try:
        if gateway: stop(gateway)
    finally:
        if service: stop(service)
'''
INSPECT_DB=r'''
"""Read-only audit: open the exact database path without creating a missing file."""
import argparse
from pathlib import Path
import sqlite3
parser=argparse.ArgumentParser()
parser.add_argument('database')
args=parser.parse_args()
path=Path(args.database).resolve()
with sqlite3.connect(path.as_uri()+'?mode=ro',uri=True) as db:
    print('integrity:',db.execute('PRAGMA integrity_check').fetchone()[0])
    print('players:',db.execute('SELECT player,coins FROM players ORDER BY player').fetchall())
    print('ledger_count:',db.execute('SELECT COUNT(*) FROM ledger').fetchone()[0])
    print('request_count:',db.execute('SELECT COUNT(*) FROM requests').fetchone()[0])
    mismatch=db.execute('SELECT p.player,p.coins,COALESCE(SUM(l.delta),0) FROM players p LEFT JOIN ledger l ON p.player=l.player GROUP BY p.player HAVING p.coins<>COALESCE(SUM(l.delta),0)').fetchall()
    if mismatch: raise SystemExit('balance/ledger mismatch: '+repr(mismatch))
    print('AUDIT OK')
'''

EXPERIMENTS={
    'network-model':('tools/demo.py','DEMO_PLAYER = "alice"','DEMO_PLAYER = "bob"','可选实验：把 DEMO_PLAYER 的 alice 改为 bob，运行 make test 和 make run，观察当前本地验证或已接入 TCP 的请求与回显；继续前恢复 alice。'),
    'message-framing':('common/protocol.h','#define MAX_BODY 4096','#define MAX_BODY 2048','可选实验：把 MAX_BODY 从4096改为2048，运行 make test 和 make run。说明发送端与接收端为何必须共享上限，以及超过上限的帧应如何处理；继续前恢复4096。'),
    'disconnect-timeout':('common/net.h','#define IO_TIMEOUT_MS 1000','#define IO_TIMEOUT_MS 1200','可选实验：把 IO_TIMEOUT_MS 从1000改为1200，运行 make test 和 make run，比较慢连接和有限重试总耗时；此常量是网络连接预算，不是数据库事务硬期限。继续前恢复1000。'),
    'multi-client':('common/server.h','#define SERVER_WORKERS 4','#define SERVER_WORKERS 5','可选实验：把 SERVER_WORKERS 从4改为5，运行 make test 和 make run，解释可同时处理连接数与容量8的等待队列之间的区别；实现接入后观察慢连接隔离。继续前恢复4。'),
    'sql-model':('tools/demo.py','DEMO_AMOUNT = 5','DEMO_AMOUNT = 7','可选实验：把 DEMO_AMOUNT 从5改为7，运行 make test 和 make run，在 SQL 示例接入后观察参数值和查询余额；schema约束仍然不变。继续前恢复5。'),
    'sqlite-cpp':('tools/demo.py','DEMO_AMOUNT = 5','DEMO_AMOUNT = 7','可选实验：把 DEMO_AMOUNT 从5改为7，运行 make test 和 make run，观察该数值如何经请求和绑定参数进入 SQLite，核对查询结果。继续前恢复5。'),
    'transactions':('tools/demo.py','DEMO_AMOUNT = 5','DEMO_AMOUNT = 7','可选实验：把 DEMO_AMOUNT 从5改为7，运行 make test 和 make run；接入兑换示例后预测扣除2后余额及失败兑换后的余额。继续前恢复5。'),
    'durable-idempotency':('tools/demo.py','demo_add','demo_credit','可选实验：把本文件所有 demo_add 一起改为 demo_credit，包括已有的故障注入事件ID、首次请求、重提和冲突请求。运行 make test 和 make run，核对同一ID只记一次效果；不要在每次重试时换ID。继续前全部恢复 demo_add。'),
    'query-recovery':('tools/demo.py',"'TOP|5'","'TOP|1'",'可选实验：把本文件所有 TOP|5 改为 TOP|1，运行 make test 和 make run，比较两名玩家的排行榜截断与重启前后顺序。继续前恢复 TOP|5。'),
    'end-to-end':('tools/demo.py','DEMO_PLAYER = "alice"','DEMO_PLAYER = "bob"','可选实验：把 DEMO_PLAYER 从 alice 改为 bob，运行 make test 和 make run，核对入账、兑换、冲突、榜单和重启查询都指向同一玩家。演示数据库是临时隔离的；继续前恢复 alice。'),
}

SQLITE_UNIT=r'''
#include "sqlite_raii.hpp"
#include <iostream>
#define CHECK(x) do { if(!(x)) throw std::runtime_error(#x); } while(0)
int main() {
    try {
        Database db(":memory:");
        db.exec("CREATE TABLE samples(value TEXT NOT NULL UNIQUE)");
        std::string payload="玩家 '小蛋'";
        payload.push_back('\0'); payload+="bytes";
        {
            Statement insert(db,"INSERT INTO samples(value) VALUES(?)");
            insert.text(1,payload); CHECK(!insert.row());
        }
        {
            Statement query(db,"SELECT value FROM samples");
            CHECK(query.row()); CHECK(query.text(0)==payload); CHECK(!query.row());
        }
        bool constraint=false;
        try { Statement duplicate(db,"INSERT INTO samples(value) VALUES(?)"); duplicate.text(1,payload); duplicate.row(); }
        catch(const SqliteError&) { constraint=true; }
        CHECK(constraint);
        Statement count(db,"SELECT COUNT(*) FROM samples"); CHECK(count.row() && count.number(0)==1);
        std::cout<<"SQLITE BINDING TESTS PASSED\n";
    } catch(const std::exception& error) { std::cerr<<error.what()<<'\n'; return 1; }
}
'''

if __name__=='__main__': generate()
