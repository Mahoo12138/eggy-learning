#pragma once
#include "compute.hpp"

namespace phoenix {
// Structure of arrays: each field is contiguous. Conversion cost must be measured too.
class PackedRoutes {
    std::size_t candidates_, hops_;
    std::vector<std::uint32_t> x_, y_, toll_;
public:
    explicit PackedRoutes(const RouteWorkload& source)
        : candidates_(source.candidates()), hops_(source.hops()) {
        x_.reserve(source.samples().size());
        y_.reserve(source.samples().size());
        toll_.reserve(source.samples().size());
        for (const auto& point : source.samples()) {
            x_.push_back(point.x); y_.push_back(point.y); toll_.push_back(point.toll);
        }
    }
    std::size_t candidates() const noexcept { return candidates_; }
    std::size_t hops() const noexcept { return hops_; }
    std::uint64_t routeCost(std::uint64_t seed, std::size_t candidate) const {
        if (candidate >= candidates_) throw std::out_of_range("candidate index");
        std::uint64_t total = 0;
        const std::size_t end = (candidate + 1) * hops_;
        for (std::size_t i = candidate * hops_; i < end; ++i)
            total += segmentCost(seed, x_[i], y_[i], toll_[i]);
        return total;
    }
};
inline Score scoreOptimized(const Order& order, const PackedRoutes& routes) {
    Score best{0, std::numeric_limits<std::uint64_t>::max()};
    for (std::size_t candidate = 0; candidate < routes.candidates(); ++candidate) {
        const auto total = routes.routeCost(order.routeSeed(), candidate);
        if (total < best.cost) best = {candidate, total};
    }
    return best;
}
} // namespace phoenix
