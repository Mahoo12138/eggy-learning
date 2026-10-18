#include "store.hpp"
#include <iostream>
#include "frame.h"
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
int main(int argc,char** argv) {
    try {
        if(argc>=2 && std::string(argv[1])=="--local") {
            if(argc!=4 && argc!=5) { std::cerr<<"Usage: service --local DB REQUEST [SCHEMA]\n"; return 2; }
            Store store(argv[2],argc==5?argv[4]:"db/schema.sql");
            auto reply=store.handle(argv[3]); std::cout<<reply.body<<'\n';
            return reply.body.rfind("OK|",0)==0?0:1;
        }
        int port=0;
        if((argc!=3 && argc!=4) || !parse_number(argv[2],65535,&port)) {
            std::cerr<<"Usage: service DB PORT [SCHEMA]\n"; return 2;
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
    } catch(const std::exception& error) { std::cerr<<"FAIL: "<<error.what()<<'\n'; return 1; }
}
