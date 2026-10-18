#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#include "domain.hpp"
#include "ownership.hpp"
using namespace phoenix;
constexpr int kDemoUnits = 2;
constexpr std::size_t kRouteCount = 12;
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
int main(int argc, char** argv) {
    try {
        if (argc > 1) { std::cerr << "Benchmark is introduced in the final integration lesson.\n"; return 2; }
        (void)argv;
        demo_cpp_domain_model();
        demo_raii_ownership();
        std::cout << "DEMO OK\n";
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << "\n"; return 1;
    }
}
