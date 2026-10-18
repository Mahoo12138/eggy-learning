#pragma once
#include "domain.hpp"
#include <limits>
#include <vector>

namespace phoenix {
struct RouteSample { std::uint32_t x, y, toll; };
class RouteWorkload {
    std::size_t candidates_, hops_;
    std::vector<RouteSample> samples_;
    static std::size_t sampleCount(std::size_t candidates, std::size_t hops) {
        if (!candidates || !hops || candidates > 4096 || hops > 4096)
            throw std::invalid_argument("route dimensions must be in [1,4096]");
        return candidates * hops;
    }
public:
    RouteWorkload(std::size_t candidates, std::size_t hops)
        : candidates_(candidates), hops_(hops) {
        samples_.reserve(sampleCount(candidates, hops));
        for (std::size_t route = 0; route < candidates; ++route)
            for (std::size_t hop = 0; hop < hops; ++hop)
                samples_.push_back({static_cast<std::uint32_t>((route * 31 + hop * 7) % 1000),
                                    static_cast<std::uint32_t>((route * 13 + hop * 29) % 1000),
                                    static_cast<std::uint32_t>((route + hop * 3) % 97)});
    }
    RouteWorkload(std::size_t candidates, std::size_t hops, std::vector<RouteSample> samples)
        : candidates_(candidates), hops_(hops), samples_(std::move(samples)) {
        if (samples_.size() != sampleCount(candidates, hops))
            throw std::invalid_argument("route sample count does not match dimensions");
    }
    std::size_t candidates() const noexcept { return candidates_; }
    std::size_t hops() const noexcept { return hops_; }
    const std::vector<RouteSample>& samples() const noexcept { return samples_; }
};
// Reproducible CPU work: 24 rounds of unsigned mixing per route segment.
// uint64_t wraparound is defined. Cost per segment is bounded by 65535.
inline std::uint64_t segmentCost(std::uint64_t seed, std::uint32_t x,
                                 std::uint32_t y, std::uint32_t toll) noexcept {
    std::uint64_t value = seed ^ (static_cast<std::uint64_t>(x) << 32) ^ y ^ toll;
    for (unsigned round = 0; round < 24; ++round) {
        value ^= value >> 27;
        value *= UINT64_C(0x3c79ac492ba7b653);
        value ^= value >> 33;
        value += UINT64_C(0x1c69b3f74ac4ae35) + round;
    }
    return value & UINT64_C(0xffff);
}
inline Score scoreBaseline(const Order& order, const RouteWorkload& routes) {
    Score best{0, std::numeric_limits<std::uint64_t>::max()};
    for (std::size_t candidate = 0; candidate < routes.candidates(); ++candidate) {
        std::uint64_t total = 0;
        for (std::size_t hop = 0; hop < routes.hops(); ++hop) {
            const auto& point = routes.samples()[candidate * routes.hops() + hop];
            total += segmentCost(order.routeSeed(), point.x, point.y, point.toll);
        }
        if (total < best.cost) best = {candidate, total}; // equal cost keeps first route
    }
    return best;
}
} // namespace phoenix
