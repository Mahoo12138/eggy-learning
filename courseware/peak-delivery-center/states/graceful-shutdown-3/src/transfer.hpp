#pragma once
#include "locality.hpp"
#include <cstdint>
#include <limits>
#include <mutex>
#include <optional>
#include <stop_token>

namespace phoenix {
class Warehouse {
    std::int64_t units_;
    mutable std::mutex mutex_;
    friend bool transfer(Warehouse&, Warehouse&, std::int64_t);
public:
    explicit Warehouse(std::int64_t units) : units_(units) {
        if (units < 0) throw std::invalid_argument("negative warehouse units");
    }
    std::int64_t units() const { std::lock_guard lock(mutex_); return units_; }
};
inline bool transfer(Warehouse& from, Warehouse& to, std::int64_t units) {
    if (units <= 0) throw std::invalid_argument("transfer must be positive");
    if (&from == &to) { // never lock the same non-recursive mutex twice
        std::lock_guard lock(from.mutex_);
        return from.units_ >= units;
    }
    std::scoped_lock lock(from.mutex_, to.mutex_);
    if (from.units_ < units) return false;
    if (to.units_ > std::numeric_limits<std::int64_t>::max() - units)
        throw std::overflow_error("destination stock overflow");
    from.units_ -= units; to.units_ += units;
    return true;
}
// Cancellation is cooperative and checked at each candidate boundary.
// nullopt means cancelled; callers must never interpret a partial score as final.
inline std::optional<Score> scoreCancellable(const Order& order, const PackedRoutes& routes,
                                              std::stop_token token) {
    Score best{0, std::numeric_limits<std::uint64_t>::max()};
    for (std::size_t candidate = 0; candidate < routes.candidates(); ++candidate) {
        if (token.stop_requested()) return std::nullopt;
        const auto total = routes.routeCost(order.routeSeed(), candidate);
        if (total < best.cost) best = {candidate, total};
    }
    if (token.stop_requested()) return std::nullopt;
    return best;
}
} // namespace phoenix
