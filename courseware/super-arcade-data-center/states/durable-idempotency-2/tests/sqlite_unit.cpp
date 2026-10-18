
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
