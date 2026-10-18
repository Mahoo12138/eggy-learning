#pragma once
#include "locality.hpp"
#include <algorithm>
#include <atomic>
#include <exception>
#include <mutex>
#include <thread>

namespace phoenix {
template<class Function>
void parallelFor(std::size_t count, std::size_t worker_count, Function function) {
    if (!worker_count) throw std::invalid_argument("worker count must be positive");
    if (!count) return;
    worker_count = std::min(worker_count, count);
    std::atomic<std::size_t> next{0};
    std::atomic<bool> failed{false};
    std::exception_ptr first_error;
    std::mutex error_mutex;
    { // Joining happens before output is read or an exception is rethrown.
        std::vector<std::jthread> workers;
        workers.reserve(worker_count);
        for (std::size_t worker = 0; worker < worker_count; ++worker)
            workers.emplace_back([&] {
                while (!failed.load(std::memory_order_relaxed)) {
                    const auto index = next.fetch_add(1, std::memory_order_relaxed);
                    if (index >= count) break;
                    try { function(index); }
                    catch (...) {
                        std::lock_guard lock(error_mutex);
                        if (!first_error) first_error = std::current_exception();
                        failed.store(true, std::memory_order_relaxed);
                    }
                }
            });
    }
    if (first_error) std::rethrow_exception(first_error);
}
inline std::vector<Score> parallelScores(const std::vector<Order>& orders,
                                          const PackedRoutes& routes, std::size_t workers) {
    std::vector<Score> result(orders.size()); // no resize/push_back while workers run
    parallelFor(orders.size(), workers, [&](std::size_t i) {
        result[i] = scoreOptimized(orders[i], routes); // each index has exactly one writer
    });
    return result;
}
} // namespace phoenix
