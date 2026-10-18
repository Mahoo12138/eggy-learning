#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#include "domain.hpp"
#include "ownership.hpp"
#include "compute.hpp"
#include "locality.hpp"
#include "workers.hpp"
#include "queue.hpp"
#include "pool.hpp"
#include "inventory.hpp"
#include "transfer.hpp"
using namespace phoenix;
constexpr int kDemoUnits = 2;
constexpr std::size_t kRouteCount = 12;
constexpr std::size_t kCandidates = 8;
constexpr std::size_t kHops = 16;
constexpr std::size_t kWorkers = 3;
constexpr std::size_t kQueueCapacity = 2;
constexpr std::size_t kPoolWorkers = 3;
constexpr int kInitialStock = 9;
constexpr int kTransferUnits = 1;
void demo_cpp_domain_model() {
const Order order("PHX-001", kDemoUnits, 17);
std::cout << "order " << order.id() << " units=" << order.units() << '\n';
}
void demo_raii_ownership() {
DispatchSession session(kRouteCount, {Order("OWN-1", 1, 19)});
DispatchSession moved = std::move(session);
std::cout << "owned routes=" << moved.routes().size()
          << " orders=" << moved.orders().size() << '\n';
}
void demo_compute_baseline() {
const RouteWorkload routes(kCandidates, kHops);
const auto score = scoreBaseline(Order("CPU-1", 1, 17), routes);
std::cout << "sequential route=" << score.route << " cost=" << score.cost << '\n';
}
void demo_data_locality() {
const RouteWorkload source(kCandidates, kHops);
const PackedRoutes packed(source);
const Order order("PACK-1", 1, 21);
const auto result = scoreOptimized(order, packed);
if (!(result == scoreBaseline(order, source))) throw std::runtime_error("layout changed result");
std::cout << "packed equivalent=yes cost=" << result.cost << '\n';
}
void demo_worker_threads() {
const PackedRoutes routes(RouteWorkload(kCandidates, kHops));
const std::vector<Order> orders{Order("W-1", 1, 17), Order("W-2", 1, 19), Order("W-3", 1, 21)};
const auto results = parallelScores(orders, routes, kWorkers);
std::cout << "workers results=" << results.size() << " first=" << results.front().cost << '\n';
}
void demo_blocking_queue() {
BoundedQueue<int> queue(kQueueCapacity);
std::jthread producer([&] { for (int i = 1; i <= 6; ++i) queue.push(i); queue.close(); });
int total = 0;
while (auto item = queue.pop()) total += *item;
std::cout << "bounded queue drained total=" << total << '\n';
}
void demo_task_pool() {
const PackedRoutes routes(RouteWorkload(kCandidates, kHops));
TaskPool pool(kPoolWorkers, 4);
auto first = pool.submit([&] { return scoreOptimized(Order("P-1", 1, 17), routes); });
auto second = pool.submit([&] { return scoreOptimized(Order("P-2", 1, 23), routes); });
pool.shutdown();
std::cout << "pool costs=" << first.get().cost << ',' << second.get().cost << '\n';
}
void demo_inventory_race() {
Inventory inventory(kInitialStock);
const Order order("PAY-1", 2, 17);
const auto first = inventory.checkout(order);
const auto retry = inventory.checkout(order);
const auto conflict = inventory.checkout(Order("PAY-1", 3, 17));
std::cout << "inventory remaining=" << inventory.stock() << " retry=" << retry.duplicate
          << " conflict=" << (conflict.status == CheckoutStatus::Conflict)
          << " accepted=" << (first.status == CheckoutStatus::Accepted) << '\n';
}
int main(int argc, char** argv) {
    try {
        if (argc > 1) { std::cerr << "Benchmark is introduced in the final integration lesson.\n"; return 2; }
        (void)argv;
        demo_cpp_domain_model();
        demo_raii_ownership();
        demo_compute_baseline();
        demo_data_locality();
        demo_worker_threads();
        demo_blocking_queue();
        demo_task_pool();
        demo_inventory_race();
        std::cout << "DEMO OK\n";
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << "\n"; return 1;
    }
}
