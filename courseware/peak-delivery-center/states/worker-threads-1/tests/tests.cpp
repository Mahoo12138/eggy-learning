#include "domain.hpp"
#include "ownership.hpp"
#include "compute.hpp"
#include "locality.hpp"
#include "workers.hpp"
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
void test_raii_ownership() {
static_assert(!std::is_copy_constructible_v<DispatchSession>);
static_assert(std::is_nothrow_move_constructible_v<DispatchSession>);
DispatchSession original(3, {Order("OWN", 1, 7)});
DispatchSession moved(std::move(original));
CHECK(moved.routes().at(2) == 219);
CHECK(moved.orders().at(0).id() == "OWN");
expectThrows<std::logic_error>([&] { (void) original.routes(); });
expectThrows<std::out_of_range>([&] { (void) moved.routes().at(3); });
expectThrows<std::invalid_argument>([] { DispatchSession bad(0, {}); });
// A throw after construction unwinds both the table and order storage.
expectThrows<std::runtime_error>([] {
    DispatchSession unwound(4, {Order("GOOD", 1, 1)});
    CHECK(unwound.routes().size() == 4);
    throw std::runtime_error("abort this dispatch session");
});
}
void test_compute_baseline() {
const Order order("CPU", 1, 17);
const RouteWorkload single(1, 1);
CHECK(scoreBaseline(order, single) == (Score{0, segmentCost(17, 0, 0, 0)}));
const RouteWorkload routes(7, 13);
CHECK(scoreBaseline(order, routes) == scoreBaseline(order, routes));
CHECK(scoreBaseline(order, routes).route < 7);
CHECK(scoreBaseline(order, routes).cost <= 13 * UINT64_C(65535));
expectThrows<std::invalid_argument>([] { RouteWorkload invalid(0, 3); });
expectThrows<std::invalid_argument>([] { RouteWorkload invalid(1, 4097); });
expectThrows<std::invalid_argument>([] { RouteWorkload invalid(2, 2, {{1, 2, 3}}); });
const RouteWorkload tie(2, 2, {{1, 2, 3}, {4, 5, 6}, {1, 2, 3}, {4, 5, 6}});
CHECK(scoreBaseline(order, tie).route == 0);
}
void test_data_locality() {
const RouteWorkload tie(2, 2, {{1, 2, 3}, {4, 5, 6}, {1, 2, 3}, {4, 5, 6}});
const Order tie_order("TIE", 1, 17);
CHECK(scoreOptimized(tie_order, PackedRoutes(tie)).route == 0);
for (const auto dimensions : {std::pair{1, 1}, std::pair{3, 7}, std::pair{19, 31}}) {
    const RouteWorkload source(dimensions.first, dimensions.second);
    const PackedRoutes packed(source);
    for (std::uint64_t seed : {UINT64_C(0), UINT64_C(1), UINT64_C(17), UINT64_MAX}) {
        const Order order("MATCH", 1, seed);
        CHECK(scoreBaseline(order, source) == scoreOptimized(order, packed));
    }
    expectThrows<std::out_of_range>([&] { (void) packed.routeCost(1, packed.candidates()); });
}
}
int main() {
    try {
        test_cpp_domain_model();
        std::cout << "PASS cpp-domain-model\n";
        test_raii_ownership();
        std::cout << "PASS raii-ownership\n";
        test_compute_baseline();
        std::cout << "PASS compute-baseline\n";
        test_data_locality();
        std::cout << "PASS data-locality\n";
        std::cout << "ALL TESTS PASSED (4 groups)\n";
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << "\n"; return 1;
    }
}
