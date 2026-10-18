
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
