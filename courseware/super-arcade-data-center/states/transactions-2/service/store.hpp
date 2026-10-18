
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
    Reply mutate(const Request& request,const std::string& body) {
        Transaction transaction(db_);
        (void)body;
        const auto before=balance(request.player);
        const bool redeem=std::string(request.op)=="REDEEM";
        std::string denied;
        if(redeem && before<request.amount) denied="ERR|INSUFFICIENT";
        if(!redeem && before>1000000-request.amount) denied="ERR|LIMIT";
        if(!denied.empty()) {
            return {denied,false};
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
        const char* failure=std::getenv("ARCADE_TEST_FAIL_AFTER_DEBIT");
        if(failure && request.event==std::string(failure)) throw std::runtime_error("injected failure after balance update");
        record(request,redeem?-request.amount:request.amount);
        const std::string response=std::string("OK|")+request.op+"|"+request.event+"|"+std::to_string(after);
        transaction.commit();
        return {response,true};
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
            return mutate(request,body);
        } catch(const SqliteError& error) {
            const int primary=error.code&0xff;
            return {primary==SQLITE_BUSY || primary==SQLITE_LOCKED?"ERR|BUSY":"ERR|DB",false};
        } catch(const std::exception&) { return {"ERR|DB",false}; }
    }
};
