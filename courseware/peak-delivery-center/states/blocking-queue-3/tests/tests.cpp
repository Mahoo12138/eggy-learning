#include "domain.hpp"
#include "ownership.hpp"
#include "compute.hpp"
#include "locality.hpp"
#include "workers.hpp"
#include "queue.hpp"
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
void test_worker_threads() {
const RouteWorkload source(7, 9);
const PackedRoutes routes(source);
std::vector<Order> orders;
for (int i = 0; i < 23; ++i) orders.emplace_back("W" + std::to_string(i), 1, i);
for (std::size_t workers : {1U, 2U, 4U, 64U}) {
    const auto actual = parallelScores(orders, routes, workers);
    for (std::size_t i = 0; i < orders.size(); ++i)
        CHECK(actual[i] == scoreBaseline(orders[i], source));
}
CHECK(parallelScores({}, routes, 3).empty());
expectThrows<std::invalid_argument>([&] { (void) parallelScores(orders, routes, 0); });
expectThrows<std::runtime_error>([] {
    parallelFor(30, 4, [](std::size_t i) { if (i == 3) throw std::runtime_error("worker failure"); });
});
std::vector<int> writes(37, 0);
parallelFor(writes.size(), 5, [&](std::size_t i) { ++writes[i]; });
CHECK(std::all_of(writes.begin(), writes.end(), [](int value) { return value == 1; }));
}
void test_blocking_queue() {
expectThrows<std::invalid_argument>([] { BoundedQueue<int> invalid(0); });
BoundedQueue<int> drained(2);
CHECK(drained.push(1) && drained.push(2));
drained.close(); drained.close();
CHECK(!drained.push(3));
CHECK(drained.pop() == 1 && drained.pop() == 2 && !drained.pop());
BoundedQueue<int> cancelled(2);
CHECK(cancelled.push(1)); cancelled.close(CloseMode::Cancel); cancelled.close();
CHECK(cancelled.size() == 0 && !cancelled.pop() && !cancelled.push(2));
BoundedQueue<int> full(1);
CHECK(full.push(1));
std::promise<void> producer_started;
auto started = producer_started.get_future();
auto blocked_producer = std::async(std::launch::async, [&] {
    producer_started.set_value(); return full.push(2);
});
started.wait(); full.close();
CHECK(ready(blocked_producer) && !blocked_producer.get());
BoundedQueue<int> empty(1);
auto blocked_consumer = std::async(std::launch::async, [&] { return empty.pop(); });
empty.close(CloseMode::Cancel);
CHECK(ready(blocked_consumer) && !blocked_consumer.get());
BoundedQueue<int> traffic(3);
std::vector<std::atomic<int>> seen(400);
std::atomic<bool> valid_traffic{true};
std::vector<std::jthread> consumers;
for (int c = 0; c < 3; ++c) consumers.emplace_back([&] {
    while (auto value = traffic.pop()) {
        if (*value < 0 || *value >= 400) valid_traffic = false;
        else ++seen[*value];
    }
});
std::vector<std::jthread> producers;
for (int p = 0; p < 4; ++p) producers.emplace_back([&, p] {
    for (int n = 0; n < 100; ++n) if (!traffic.push(p * 100 + n)) valid_traffic = false;
});
producers.clear(); traffic.close(); consumers.clear();
CHECK(valid_traffic);
for (const auto& count : seen) CHECK(count.load() == 1);
// A discarded payload may inspect the queue in its destructor: never destroy under lock.
BoundedQueue<std::shared_ptr<int>> owned(1);
bool destroyed_outside_lock = false;
std::shared_ptr<int> payload(new int(7), [&](int* value) {
    destroyed_outside_lock = owned.size() == 0;
    delete value;
});
CHECK(owned.push(std::move(payload)));
owned.close(CloseMode::Cancel);
CHECK(destroyed_outside_lock);
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
        test_worker_threads();
        std::cout << "PASS worker-threads\n";
        test_blocking_queue();
        std::cout << "PASS blocking-queue\n";
        std::cout << "ALL TESTS PASSED (6 groups)\n";
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << "\n"; return 1;
    }
}
