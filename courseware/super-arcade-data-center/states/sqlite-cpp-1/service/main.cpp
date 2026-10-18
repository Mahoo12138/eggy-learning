#include "store.hpp"
#include <iostream>
int main(int argc,char** argv) {
    try {
        if(argc>=2 && std::string(argv[1])=="--local") {
            if(argc!=4 && argc!=5) { std::cerr<<"Usage: service --local DB REQUEST [SCHEMA]\n"; return 2; }
            Store store(argv[2],argc==5?argv[4]:"db/schema.sql");
            auto reply=store.handle(argv[3]); std::cout<<reply.body<<'\n';
            return reply.body.rfind("OK|",0)==0?0:1;
        }
        std::cerr<<"Usage: service --local DB REQUEST [SCHEMA]\n"; return 2;
    } catch(const std::exception& error) { std::cerr<<"FAIL: "<<error.what()<<'\n'; return 1; }
}
