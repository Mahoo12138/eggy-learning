#pragma once
#include "domain.hpp"
#include <memory>
#include <vector>

namespace phoenix {
class RouteTable {
    std::vector<std::uint64_t> seeds_;
public:
    explicit RouteTable(std::size_t count) {
        if (count == 0) throw std::invalid_argument("route table must not be empty");
        seeds_.reserve(count);
        for (std::size_t i = 0; i < count; ++i) seeds_.push_back(17 + i * 101);
    }
    std::size_t size() const noexcept { return seeds_.size(); }
    std::uint64_t at(std::size_t index) const { return seeds_.at(index); }
};
// vector releases its storage; unique_ptr deletes the owned table on every exit path.
// No manual new/delete, and the session has exactly one table owner.
class DispatchSession {
    std::unique_ptr<RouteTable> routes_;
    std::vector<Order> orders_;
public:
    DispatchSession(std::size_t route_count, std::vector<Order> orders)
        : routes_(std::make_unique<RouteTable>(route_count)), orders_(std::move(orders)) {}
    DispatchSession(const DispatchSession&) = delete;
    DispatchSession& operator=(const DispatchSession&) = delete;
    DispatchSession(DispatchSession&&) noexcept = default;
    DispatchSession& operator=(DispatchSession&&) noexcept = default;
    const RouteTable& routes() const {
        if (!routes_) throw std::logic_error("session was moved from");
        return *routes_;
    }
    const std::vector<Order>& orders() const noexcept { return orders_; }
};
} // namespace phoenix
