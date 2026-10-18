#pragma once
#include <cstdint>
#include <cstddef>
#include <stdexcept>
#include <string>
#include <utility>

namespace phoenix {
// An Order cannot exist with an empty id or non-positive quantity.
class Order {
    std::string id_;
    int units_;
    std::uint64_t route_seed_;
public:
    Order(std::string id, int units, std::uint64_t route_seed)
        : id_(std::move(id)), units_(units), route_seed_(route_seed) {
        if (id_.empty() || units_ <= 0)
            throw std::invalid_argument("order requires an id and positive units");
    }
    // Explicit copy operations suppress implicit move: even std::move(order) copies.
    // The source keeps its valid id; sessions still move their whole vector efficiently.
    Order(const Order&) = default;
    Order& operator=(const Order&) = default;
    const std::string& id() const noexcept { return id_; }
    int units() const noexcept { return units_; }
    std::uint64_t routeSeed() const noexcept { return route_seed_; }
};
struct Score {
    std::size_t route = 0;
    std::uint64_t cost = 0;
    bool operator==(const Score&) const = default;
};
} // namespace phoenix
