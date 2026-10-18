#include "domain.hpp"
#include <algorithm>
#include <chrono>
#include <future>
#include <iostream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#define CHECK(condition) do { if (!(condition)) throw std::runtime_error(std::string("CHECK failed: ") + #condition + " at line " + std::to_string(__LINE__)); } while(false)
template<class Exception, class Function> void expectThrows(Function function) {
    bool caught = false;
    try { function(); } catch (const Exception&) { caught = true; }
    CHECK(caught);
}
template<class Future> bool ready(Future& future) {
    return future.wait_for(std::chrono::seconds(5)) == std::future_status::ready;
}
using namespace phoenix;
void test_cpp_domain_model() {
const Order valid("PHX", 2, 17);
CHECK(valid.id() == "PHX" && valid.units() == 2 && valid.routeSeed() == 17);
expectThrows<std::invalid_argument>([] { Order bad("", 1, 1); });
expectThrows<std::invalid_argument>([] { Order bad("X", 0, 1); });
expectThrows<std::invalid_argument>([] { Order bad("X", -1, 1); });
Order copy = valid;
copy = Order("OTHER", 3, 18);
CHECK(valid.id() == "PHX" && copy.id() == "OTHER");
Order source("MOVE-SOURCE", 4, 31);
Order destination(std::move(source));
CHECK(source.id() == "MOVE-SOURCE" && destination.id() == "MOVE-SOURCE");
copy = std::move(source);
CHECK(source.id() == "MOVE-SOURCE" && copy.id() == "MOVE-SOURCE" && copy.units() == 4);
}
int main() {
    try {
        test_cpp_domain_model();
        std::cout << "PASS cpp-domain-model\n";
        std::cout << "ALL TESTS PASSED (1 groups)\n";
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << "\n"; return 1;
    }
}
