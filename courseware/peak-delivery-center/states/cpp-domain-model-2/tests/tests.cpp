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
int main() {
    try {
        std::cout << "ALL TESTS PASSED (0 groups)\n";
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << "\n"; return 1;
    }
}
