#pragma once
#include "workers.hpp"
#include <chrono>
#include <iomanip>
#include <iostream>

namespace phoenix {
inline void benchmark() {
    using Clock = std::chrono::steady_clock;
    std::vector<Order> orders;
    for (int i = 0; i < 48; ++i) orders.emplace_back("BENCH" + std::to_string(i), 1, i * 101 + 17);
    const RouteWorkload source(128, 96);
    const auto pack_start = Clock::now();
    const PackedRoutes packed(source);
    const double packing_ms = std::chrono::duration<double, std::milli>(Clock::now() - pack_start).count();
    const std::size_t workers = std::min(4U, std::max(1U, std::thread::hardware_concurrency()));
    // Warm up each implementation, then report three rounds; no fixed speedup claim.
    const auto warm_baseline = scoreBaseline(orders.front(), source);
    const auto warm_packed = scoreOptimized(orders.front(), packed);
    const auto warm_parallel = parallelScores({orders.front()}, packed, workers);
    if (!(warm_baseline == warm_packed) || !(warm_baseline == warm_parallel.front()))
        throw std::runtime_error("warmup oracle mismatch");
    for (int round = 1; round <= 3; ++round) {
        std::vector<Score> baseline, optimized;
        auto begin = Clock::now();
        for (const auto& order : orders) baseline.push_back(scoreBaseline(order, source));
        const double sequential_ms = std::chrono::duration<double, std::milli>(Clock::now() - begin).count();
        begin = Clock::now();
        for (const auto& order : orders) optimized.push_back(scoreOptimized(order, packed));
        const double optimized_ms = std::chrono::duration<double, std::milli>(Clock::now() - begin).count();
        begin = Clock::now();
        const auto parallel = parallelScores(orders, packed, workers);
        const double parallel_ms = std::chrono::duration<double, std::milli>(Clock::now() - begin).count();
        if (baseline != optimized || baseline != parallel) throw std::runtime_error("benchmark oracle mismatch");
        std::uint64_t checksum = 0;
        for (const auto& score : baseline) checksum += score.cost + score.route;
        std::cout << std::fixed << std::setprecision(3) << "benchmark round=" << round
                  << " orders=" << orders.size() << " workers=" << workers
                  << " sequential_ms=" << sequential_ms << " packed_ms=" << optimized_ms
                  << " parallel_ms=" << parallel_ms << " packing_ms=" << packing_ms
                  << " speedup=" << (parallel_ms > 0 ? sequential_ms / parallel_ms : 0)
                  << " checksum=" << checksum << " warmup_cost=" << warm_baseline.cost << " equivalent=yes\n";
    }
}
} // namespace phoenix
