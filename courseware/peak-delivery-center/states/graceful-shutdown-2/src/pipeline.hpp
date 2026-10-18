#pragma once
#include "ownership.hpp"
#include "inventory.hpp"
#include "pool.hpp"
#include "transfer.hpp"

namespace phoenix {
struct DeliveryResult { std::string order_id; Score score; Receipt receipt; };
class DeliveryCenter {
    RouteWorkload baseline_;
    PackedRoutes packed_;
    Inventory inventory_;
    TaskPool pool_; // declared last: destroyed first, before tasks' referenced data
public:
    DeliveryCenter(int stock, std::size_t candidates, std::size_t hops,
                   std::size_t workers, std::size_t capacity)
        : baseline_(candidates, hops), packed_(baseline_), inventory_(stock), pool_(workers, capacity) {}
    std::future<DeliveryResult> submit(Order order) {
        return pool_.submit([this, order = std::move(order)] {
            const auto score = scoreOptimized(order, packed_);
            const auto receipt = inventory_.checkout(order);
            return DeliveryResult{order.id(), score, receipt};
        });
    }
    void shutdown(CloseMode mode = CloseMode::Drain) { pool_.shutdown(mode); }
    int stock() const { return inventory_.stock(); }
    Score oracle(const Order& order) const { return scoreBaseline(order, baseline_); }
};
} // namespace phoenix
