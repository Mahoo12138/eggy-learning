#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#include "domain.hpp"
#include "ownership.hpp"
#include "compute.hpp"
#include "locality.hpp"
using namespace phoenix;
constexpr int kDemoUnits = 2;
constexpr std::size_t kRouteCount = 12;
constexpr std::size_t kCandidates = 8;
constexpr std::size_t kHops = 16;
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
int main(int argc, char** argv) {
    try {
        if (argc > 1) { std::cerr << "Benchmark is introduced in the final integration lesson.\n"; return 2; }
        (void)argv;
        demo_cpp_domain_model();
        demo_raii_ownership();
        demo_compute_baseline();
        std::cout << "DEMO OK\n";
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << "\n"; return 1;
    }
}
