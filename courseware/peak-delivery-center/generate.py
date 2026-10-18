#!/usr/bin/env python3
"""Materialize the 30 cumulative, self-contained C++20 lesson projects."""
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
HEADERS = {}
DEMOS = {}
TESTS = {}

def add(chapter, filename, header, demo, tests):
    HEADERS[chapter] = (filename, header.strip() + '\n')
    DEMOS[chapter] = demo.strip()
    TESTS[chapter] = tests.strip()

add('cpp-domain-model', 'domain.hpp', r'''
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
''', r'''
const Order order("PHX-001", kDemoUnits, 17);
std::cout << "order " << order.id() << " units=" << order.units() << '\n';
''', r'''
const Order valid("PHX", 2, 17);
CHECK(valid.id() == "PHX" && valid.units() == 2 && valid.routeSeed() == 17);
expectThrows<std::invalid_argument>([] { Order bad("", 1, 1); });
expectThrows<std::invalid_argument>([] { Order bad("X", 0, 1); });
expectThrows<std::invalid_argument>([] { Order bad("X", -1, 1); });
Order copy = valid;
copy = Order("OTHER", 3, 18);
CHECK(valid.id() == "PHX" && copy.id() == "OTHER");
Order source("MOVE-SOURCE", 4, 31);
Order destination(std::move(source));
CHECK(source.id() == "MOVE-SOURCE" && destination.id() == "MOVE-SOURCE");
copy = std::move(source);
CHECK(source.id() == "MOVE-SOURCE" && copy.id() == "MOVE-SOURCE" && copy.units() == 4);
''')

add('raii-ownership', 'ownership.hpp', r'''
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
''', r'''
DispatchSession session(kRouteCount, {Order("OWN-1", 1, 19)});
DispatchSession moved = std::move(session);
std::cout << "owned routes=" << moved.routes().size()
          << " orders=" << moved.orders().size() << '\n';
''', r'''
static_assert(!std::is_copy_constructible_v<DispatchSession>);
static_assert(std::is_nothrow_move_constructible_v<DispatchSession>);
DispatchSession original(3, {Order("OWN", 1, 7)});
DispatchSession moved(std::move(original));
CHECK(moved.routes().at(2) == 219);
CHECK(moved.orders().at(0).id() == "OWN");
expectThrows<std::logic_error>([&] { (void) original.routes(); });
expectThrows<std::out_of_range>([&] { (void) moved.routes().at(3); });
expectThrows<std::invalid_argument>([] { DispatchSession bad(0, {}); });
// A throw after construction unwinds both the table and order storage.
expectThrows<std::runtime_error>([] {
    DispatchSession unwound(4, {Order("GOOD", 1, 1)});
    CHECK(unwound.routes().size() == 4);
    throw std::runtime_error("abort this dispatch session");
});
''')

add('compute-baseline', 'compute.hpp', r'''
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
''', r'''
const RouteWorkload routes(kCandidates, kHops);
const auto score = scoreBaseline(Order("CPU-1", 1, 17), routes);
std::cout << "sequential route=" << score.route << " cost=" << score.cost << '\n';
''', r'''
const Order order("CPU", 1, 17);
const RouteWorkload single(1, 1);
CHECK(scoreBaseline(order, single) == (Score{0, segmentCost(17, 0, 0, 0)}));
const RouteWorkload routes(7, 13);
CHECK(scoreBaseline(order, routes) == scoreBaseline(order, routes));
CHECK(scoreBaseline(order, routes).route < 7);
CHECK(scoreBaseline(order, routes).cost <= 13 * UINT64_C(65535));
expectThrows<std::invalid_argument>([] { RouteWorkload invalid(0, 3); });
expectThrows<std::invalid_argument>([] { RouteWorkload invalid(1, 4097); });
expectThrows<std::invalid_argument>([] { RouteWorkload invalid(2, 2, {{1, 2, 3}}); });
const RouteWorkload tie(2, 2, {{1, 2, 3}, {4, 5, 6}, {1, 2, 3}, {4, 5, 6}});
CHECK(scoreBaseline(order, tie).route == 0);
''')

add('data-locality', 'locality.hpp', r'''
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
''', r'''
const RouteWorkload source(kCandidates, kHops);
const PackedRoutes packed(source);
const Order order("PACK-1", 1, 21);
const auto result = scoreOptimized(order, packed);
if (!(result == scoreBaseline(order, source))) throw std::runtime_error("layout changed result");
std::cout << "packed equivalent=yes cost=" << result.cost << '\n';
''', r'''
const RouteWorkload tie(2, 2, {{1, 2, 3}, {4, 5, 6}, {1, 2, 3}, {4, 5, 6}});
const Order tie_order("TIE", 1, 17);
CHECK(scoreOptimized(tie_order, PackedRoutes(tie)).route == 0);
for (const auto dimensions : {std::pair{1, 1}, std::pair{3, 7}, std::pair{19, 31}}) {
    const RouteWorkload source(dimensions.first, dimensions.second);
    const PackedRoutes packed(source);
    for (std::uint64_t seed : {UINT64_C(0), UINT64_C(1), UINT64_C(17), UINT64_MAX}) {
        const Order order("MATCH", 1, seed);
        CHECK(scoreBaseline(order, source) == scoreOptimized(order, packed));
    }
    expectThrows<std::out_of_range>([&] { (void) packed.routeCost(1, packed.candidates()); });
}
''')

add('worker-threads', 'workers.hpp', r'''
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
''', r'''
const PackedRoutes routes(RouteWorkload(kCandidates, kHops));
const std::vector<Order> orders{Order("W-1", 1, 17), Order("W-2", 1, 19), Order("W-3", 1, 21)};
const auto results = parallelScores(orders, routes, kWorkers);
std::cout << "workers results=" << results.size() << " first=" << results.front().cost << '\n';
''', r'''
const RouteWorkload source(7, 9);
const PackedRoutes routes(source);
std::vector<Order> orders;
for (int i = 0; i < 23; ++i) orders.emplace_back("W" + std::to_string(i), 1, i);
for (std::size_t workers : {1U, 2U, 4U, 64U}) {
    const auto actual = parallelScores(orders, routes, workers);
    for (std::size_t i = 0; i < orders.size(); ++i)
        CHECK(actual[i] == scoreBaseline(orders[i], source));
}
CHECK(parallelScores({}, routes, 3).empty());
expectThrows<std::invalid_argument>([&] { (void) parallelScores(orders, routes, 0); });
expectThrows<std::runtime_error>([] {
    parallelFor(30, 4, [](std::size_t i) { if (i == 3) throw std::runtime_error("worker failure"); });
});
std::vector<int> writes(37, 0);
parallelFor(writes.size(), 5, [&](std::size_t i) { ++writes[i]; });
CHECK(std::all_of(writes.begin(), writes.end(), [](int value) { return value == 1; }));
''')

add('blocking-queue', 'queue.hpp', r'''
#pragma once
#include <condition_variable>
#include <cstddef>
#include <deque>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <type_traits>
#include <utility>

namespace phoenix {
enum class CloseMode { Drain, Cancel };
template<class T>
class BoundedQueue {
    static_assert(std::is_nothrow_move_constructible_v<T>, "queue values must move without throwing");
    enum class State { Open, Draining, Cancelled };
    const std::size_t capacity_;
    std::deque<T> items_;
    State state_ = State::Open;
    mutable std::mutex mutex_;
    std::condition_variable readable_, writable_;
public:
    explicit BoundedQueue(std::size_t capacity) : capacity_(capacity) {
        if (!capacity) throw std::invalid_argument("queue capacity must be positive");
    }
    BoundedQueue(const BoundedQueue&) = delete;
    BoundedQueue& operator=(const BoundedQueue&) = delete;
    bool push(T item) {
        std::unique_lock lock(mutex_);
        writable_.wait(lock, [&] { return state_ != State::Open || items_.size() < capacity_; });
        if (state_ != State::Open) return false;
        items_.push_back(std::move(item));
        lock.unlock();
        readable_.notify_one();
        return true;
    }
    std::optional<T> pop() {
        std::unique_lock lock(mutex_);
        readable_.wait(lock, [&] { return state_ != State::Open || !items_.empty(); });
        if (items_.empty()) return std::nullopt;
        T item = std::move(items_.front());
        items_.pop_front();
        lock.unlock();
        writable_.notify_one();
        return item;
    }
    void close(CloseMode mode = CloseMode::Drain) {
        std::deque<T> discarded;
        {
            std::lock_guard lock(mutex_);
            if (mode == CloseMode::Cancel) {
                state_ = State::Cancelled;
                discarded.swap(items_);
            } else if (state_ == State::Open) state_ = State::Draining;
        }
        readable_.notify_all();
        writable_.notify_all();
        // Discarded payload destructors run here, after releasing the queue mutex.
    }
    std::size_t size() const { std::lock_guard lock(mutex_); return items_.size(); }
};
} // namespace phoenix
''', r'''
BoundedQueue<int> queue(kQueueCapacity);
std::jthread producer([&] { for (int i = 1; i <= 6; ++i) queue.push(i); queue.close(); });
int total = 0;
while (auto item = queue.pop()) total += *item;
std::cout << "bounded queue drained total=" << total << '\n';
''', r'''
expectThrows<std::invalid_argument>([] { BoundedQueue<int> invalid(0); });
BoundedQueue<int> drained(2);
CHECK(drained.push(1) && drained.push(2));
drained.close(); drained.close();
CHECK(!drained.push(3));
CHECK(drained.pop() == 1 && drained.pop() == 2 && !drained.pop());
BoundedQueue<int> cancelled(2);
CHECK(cancelled.push(1)); cancelled.close(CloseMode::Cancel); cancelled.close();
CHECK(cancelled.size() == 0 && !cancelled.pop() && !cancelled.push(2));
BoundedQueue<int> full(1);
CHECK(full.push(1));
std::promise<void> producer_started;
auto started = producer_started.get_future();
auto blocked_producer = std::async(std::launch::async, [&] {
    producer_started.set_value(); return full.push(2);
});
started.wait(); full.close();
CHECK(ready(blocked_producer) && !blocked_producer.get());
BoundedQueue<int> empty(1);
auto blocked_consumer = std::async(std::launch::async, [&] { return empty.pop(); });
empty.close(CloseMode::Cancel);
CHECK(ready(blocked_consumer) && !blocked_consumer.get());
BoundedQueue<int> traffic(3);
std::vector<std::atomic<int>> seen(400);
std::atomic<bool> valid_traffic{true};
std::vector<std::jthread> consumers;
for (int c = 0; c < 3; ++c) consumers.emplace_back([&] {
    while (auto value = traffic.pop()) {
        if (*value < 0 || *value >= 400) valid_traffic = false;
        else ++seen[*value];
    }
});
std::vector<std::jthread> producers;
for (int p = 0; p < 4; ++p) producers.emplace_back([&, p] {
    for (int n = 0; n < 100; ++n) if (!traffic.push(p * 100 + n)) valid_traffic = false;
});
producers.clear(); traffic.close(); consumers.clear();
CHECK(valid_traffic);
for (const auto& count : seen) CHECK(count.load() == 1);
// A discarded payload may inspect the queue in its destructor: never destroy under lock.
BoundedQueue<std::shared_ptr<int>> owned(1);
bool destroyed_outside_lock = false;
std::shared_ptr<int> payload(new int(7), [&](int* value) {
    destroyed_outside_lock = owned.size() == 0;
    delete value;
});
CHECK(owned.push(std::move(payload)));
owned.close(CloseMode::Cancel);
CHECK(destroyed_outside_lock);
''')

add('task-pool', 'pool.hpp', r'''
#pragma once
#include "queue.hpp"
#include <functional>
#include <future>
#include <memory>
#include <thread>
#include <type_traits>
#include <vector>

namespace phoenix {
class TaskPool {
    BoundedQueue<std::function<void()>> queue_;
    std::mutex lifecycle_;
    std::vector<std::jthread> workers_;
    inline static thread_local TaskPool* current_ = nullptr;
public:
    TaskPool(std::size_t workers, std::size_t capacity) : queue_(capacity) {
        if (!workers) throw std::invalid_argument("pool needs workers");
        try {
            workers_.reserve(workers);
            for (std::size_t i = 0; i < workers; ++i) workers_.emplace_back([this] {
                current_ = this;
                while (auto task = queue_.pop()) (*task)();
                current_ = nullptr;
            });
        } catch (...) { // already-created workers must wake before their destructors join
            queue_.close(CloseMode::Cancel);
            workers_.clear();
            throw;
        }
    }
    TaskPool(const TaskPool&) = delete;
    TaskPool& operator=(const TaskPool&) = delete;
    ~TaskPool() { shutdown(); }
    template<class Function>
    auto submit(Function&& function) -> std::future<std::invoke_result_t<std::decay_t<Function>&>> {
        if (current_ == this) throw std::logic_error("nested submission to this pool is unsupported");
        using Result = std::invoke_result_t<std::decay_t<Function>&>;
        auto task = std::make_shared<std::packaged_task<Result()>>(std::forward<Function>(function));
        auto future = task->get_future();
        if (!queue_.push([task] { (*task)(); })) throw std::runtime_error("pool is closed");
        return future;
    }
    void shutdown(CloseMode mode = CloseMode::Drain) {
        if (current_ == this) throw std::logic_error("a pool worker cannot join its own pool");
        std::lock_guard lock(lifecycle_);
        queue_.close(mode);
        workers_.clear(); // joins running tasks; queue lives until all workers have returned
    }
};
} // namespace phoenix
''', r'''
const PackedRoutes routes(RouteWorkload(kCandidates, kHops));
TaskPool pool(kPoolWorkers, 4);
auto first = pool.submit([&] { return scoreOptimized(Order("P-1", 1, 17), routes); });
auto second = pool.submit([&] { return scoreOptimized(Order("P-2", 1, 23), routes); });
pool.shutdown();
std::cout << "pool costs=" << first.get().cost << ',' << second.get().cost << '\n';
''', r'''
expectThrows<std::invalid_argument>([] { TaskPool invalid(0, 2); });
expectThrows<std::invalid_argument>([] { TaskPool invalid(2, 0); });
TaskPool pool(3, 2);
std::vector<std::future<int>> results;
for (int n = 0; n < 40; ++n) results.push_back(pool.submit([n] { return n * n; }));
auto failure = pool.submit([]() -> int { throw std::runtime_error("task error"); });
auto move_only = pool.submit([value = std::make_unique<int>(91)] { return *value; });
auto nested = pool.submit([&] { return pool.submit([] { return 1; }).get(); });
auto self_join = pool.submit([&] { pool.shutdown(); });
pool.shutdown(); pool.shutdown();
for (int n = 0; n < 40; ++n) CHECK(results[n].get() == n * n);
expectThrows<std::runtime_error>([&] { (void) failure.get(); });
CHECK(move_only.get() == 91);
expectThrows<std::logic_error>([&] { (void) nested.get(); });
expectThrows<std::logic_error>([&] { self_join.get(); });
expectThrows<std::runtime_error>([&] { (void) pool.submit([] { return 1; }); });
// Deterministic cancel: occupy the only worker behind a gate, then enqueue work.
TaskPool cancelled(1, 2);
std::promise<void> entered, release;
auto gate = release.get_future().share();
auto entered_future = entered.get_future();
auto running = cancelled.submit([&] { entered.set_value(); gate.wait(); return 7; });
entered_future.wait();
auto pending = cancelled.submit([] { return 99; });
auto closer = std::async(std::launch::async, [&] { cancelled.shutdown(CloseMode::Cancel); });
const bool pending_became_ready = ready(pending); // discarded packaged_task -> broken_promise
release.set_value(); // release even if assertion below fails
CHECK(ready(closer)); closer.get();
CHECK(pending_became_ready && running.get() == 7);
try { (void) pending.get(); CHECK(false); }
catch (const std::future_error& error) { CHECK(error.code() == std::make_error_code(std::future_errc::broken_promise)); }
std::future<int> destructor_drained;
{ TaskPool local(1, 1); destructor_drained = local.submit([] { return 42; }); }
CHECK(destructor_drained.get() == 42);
// A full queue blocks an external submitter; shutdown must wake it and reject it.
TaskPool full(1, 1);
std::promise<void> full_entered, full_release, submit_entered;
auto full_gate = full_release.get_future().share();
auto full_entered_future = full_entered.get_future();
auto submit_entered_future = submit_entered.get_future();
auto active = full.submit([&] { full_entered.set_value(); full_gate.wait(); return 1; });
full_entered_future.wait();
auto queued = full.submit([] { return 2; });
auto submitting = std::async(std::launch::async, [&] {
    submit_entered.set_value();
    try { (void) full.submit([] { return 3; }); return false; }
    catch (const std::runtime_error&) { return true; }
});
submit_entered_future.wait();
auto closing = std::async(std::launch::async, [&] { full.shutdown(CloseMode::Cancel); });
const bool submit_woke = ready(submitting);
const bool queue_discarded = ready(queued);
full_release.set_value();
CHECK(ready(closing)); closing.get();
CHECK(submit_woke && submitting.get() && queue_discarded && active.get() == 1);
try { (void) queued.get(); CHECK(false); }
catch (const std::future_error& error) { CHECK(error.code() == std::make_error_code(std::future_errc::broken_promise)); }
TaskPool shared_close(2, 4);
auto last = shared_close.submit([] { return 13; });
auto close_one = std::async(std::launch::async, [&] { shared_close.shutdown(); });
auto close_two = std::async(std::launch::async, [&] { shared_close.shutdown(); });
CHECK(ready(close_one) && ready(close_two)); close_one.get(); close_two.get();
CHECK(last.get() == 13);
''')

add('inventory-race', 'inventory.hpp', r'''
#pragma once
#include "domain.hpp"
#include <map>
#include <mutex>

namespace phoenix {
enum class CheckoutStatus { Accepted, Insufficient, Conflict };
struct Receipt {
    CheckoutStatus status;
    int remaining;
    bool duplicate = false;
};
class Inventory {
    struct Record { int units; std::uint64_t seed; Receipt receipt; };
    int stock_;
    mutable std::mutex mutex_;
    std::map<std::string, Record> history_;
public:
    explicit Inventory(int stock) : stock_(stock) {
        if (stock < 0) throw std::invalid_argument("negative initial stock");
    }
    Receipt checkout(const Order& order) {
        std::lock_guard lock(mutex_); // lookup + check + debit + receipt is ONE transaction
        const auto found = history_.find(order.id());
        if (found != history_.end()) {
            const auto& record = found->second;
            if (record.units != order.units() || record.seed != order.routeSeed())
                return {CheckoutStatus::Conflict, stock_, false};
            auto receipt = record.receipt;
            receipt.duplicate = true;
            return receipt;
        }
        const bool accepted = stock_ >= order.units();
        const int after = accepted ? stock_ - order.units() : stock_;
        Receipt receipt{accepted ? CheckoutStatus::Accepted : CheckoutStatus::Insufficient, after};
        // Allocate history before mutating stock: allocation failure cannot lose inventory.
        history_.emplace(order.id(), Record{order.units(), order.routeSeed(), receipt});
        stock_ = after;
        return receipt;
    }
    int stock() const { std::lock_guard lock(mutex_); return stock_; }
};
} // namespace phoenix
''', r'''
Inventory inventory(kInitialStock);
const Order order("PAY-1", 2, 17);
const auto first = inventory.checkout(order);
const auto retry = inventory.checkout(order);
const auto conflict = inventory.checkout(Order("PAY-1", 3, 17));
std::cout << "inventory remaining=" << inventory.stock() << " retry=" << retry.duplicate
          << " conflict=" << (conflict.status == CheckoutStatus::Conflict)
          << " accepted=" << (first.status == CheckoutStatus::Accepted) << '\n';
''', r'''
expectThrows<std::invalid_argument>([] { Inventory invalid(-1); });
Inventory same(10);
std::vector<Receipt> receipts(40, {CheckoutStatus::Conflict, -1});
parallelFor(receipts.size(), 8, [&](std::size_t i) { receipts[i] = same.checkout(Order("ONCE", 3, 17)); });
CHECK(same.stock() == 7);
CHECK(std::count_if(receipts.begin(), receipts.end(), [](const auto& r) { return !r.duplicate; }) == 1);
for (const auto& receipt : receipts) CHECK(receipt.status == CheckoutStatus::Accepted && receipt.remaining == 7);
CHECK(same.checkout(Order("ONCE", 4, 17)).status == CheckoutStatus::Conflict);
CHECK(same.checkout(Order("ONCE", 3, 18)).status == CheckoutStatus::Conflict);
CHECK(same.stock() == 7);
Inventory limited(17);
std::atomic<int> accepted{0};
parallelFor(80, 8, [&](std::size_t i) {
    if (limited.checkout(Order("PAY" + std::to_string(i), 2, i)).status == CheckoutStatus::Accepted) ++accepted;
});
CHECK(accepted == 8 && limited.stock() == 1);
const auto denied = limited.checkout(Order("DENIED", 2, 9));
const auto denied_retry = limited.checkout(Order("DENIED", 2, 9));
CHECK(denied.status == CheckoutStatus::Insufficient && denied_retry.duplicate && denied_retry.remaining == 1);
CHECK(limited.checkout(Order("DENIED", 1, 9)).status == CheckoutStatus::Conflict);
Inventory competing(10);
std::vector<Receipt> conflicts(32, {CheckoutStatus::Conflict, -1});
parallelFor(conflicts.size(), 8, [&](std::size_t i) {
    conflicts[i] = competing.checkout(Order("SAME-ID", i % 2 ? 3 : 2, 17));
});
const int winner_units = 10 - competing.stock();
CHECK(winner_units == 2 || winner_units == 3);
int first_accepts = 0;
for (std::size_t i = 0; i < conflicts.size(); ++i) {
    const int requested = i % 2 ? 3 : 2;
    if (requested == winner_units) {
        CHECK(conflicts[i].status == CheckoutStatus::Accepted);
        if (!conflicts[i].duplicate) ++first_accepts;
    } else CHECK(conflicts[i].status == CheckoutStatus::Conflict);
}
CHECK(first_accepts == 1);
''')

add('deadlock-cancel', 'transfer.hpp', r'''
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
''', r'''
Warehouse east(10), west(10);
transfer(east, west, kTransferUnits);
std::stop_source stop;
stop.request_stop();
const PackedRoutes routes(RouteWorkload(kCandidates, kHops));
const auto result = scoreCancellable(Order("CANCEL", 1, 17), routes, stop.get_token());
std::cout << "warehouse total=" << east.units() + west.units()
          << " cancelled=" << !result.has_value() << '\n';
''', r'''
Warehouse east(10000), west(10000);
std::atomic<int> completed{0};
parallelFor(8, 8, [&](std::size_t i) {
    for (int n = 0; n < 1000; ++n)
        if (i % 2 ? transfer(east, west, 1) : transfer(west, east, 1)) ++completed;
});
CHECK(completed == 8000 && east.units() == 10000 && west.units() == 10000);
CHECK(transfer(east, east, 1) && east.units() == 10000);
CHECK(!transfer(east, west, 10001));
CHECK(east.units() + west.units() == 20000);
expectThrows<std::invalid_argument>([&] { transfer(east, west, 0); });
Warehouse maximum(INT64_MAX), one(1);
expectThrows<std::overflow_error>([&] { transfer(one, maximum, 1); });
CHECK(one.units() == 1 && maximum.units() == INT64_MAX);
const PackedRoutes routes(RouteWorkload(17, 23));
const Order order("STOP", 1, 17);
std::stop_source stopped;
stopped.request_stop();
CHECK(!scoreCancellable(order, routes, stopped.get_token()));
std::stop_source live;
CHECK(scoreCancellable(order, routes, live.get_token()) == scoreOptimized(order, routes));
// Gate coordinates cancellation before the worker enters its expensive loop.
std::promise<void> ready_to_score, continue_score;
auto ready_future = ready_to_score.get_future();
auto gate = continue_score.get_future();
std::optional<Score> cancelled_result;
std::jthread worker([&](std::stop_token token) {
    ready_to_score.set_value(); gate.wait();
    cancelled_result = scoreCancellable(order, routes, token);
});
ready_future.wait(); worker.request_stop(); continue_score.set_value(); worker.join();
CHECK(!cancelled_result);
''')

add('graceful-shutdown', 'pipeline.hpp', r'''
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
''', r'''
DispatchSession session(kCandidates, {Order("FINAL-1", 2, 17), Order("FINAL-2", 2, 19),
    Order("FINAL-1", 2, 17), Order("FINAL-1", 3, 17)});
DeliveryCenter center(5, session.routes().size(), kHops, kPoolWorkers, kPipelineCapacity);
std::vector<std::future<DeliveryResult>> results;
// Complete the canonical payload first so this teaching demo has stable receipts.
// Production concurrency is first-committed-payload wins, not first-submitted wins.
results.push_back(center.submit(session.orders().front()));
results.front().wait();
for (std::size_t i = 1; i < session.orders().size(); ++i) results.push_back(center.submit(session.orders()[i]));
center.shutdown();
for (std::size_t i = 0; i < results.size(); ++i) {
    const auto result = results[i].get();
    if (!(result.score == center.oracle(session.orders()[i]))) throw std::runtime_error("pipeline oracle mismatch");
    std::cout << "delivery " << result.order_id << " cost=" << result.score.cost
              << " status=" << static_cast<int>(result.receipt.status)
              << " duplicate=" << result.receipt.duplicate << '\n';
}
std::cout << "delivery center closed stock=" << center.stock() << '\n';
''', r'''
DeliveryCenter center(21, 7, 11, 4, 3);
std::vector<Order> orders;
std::vector<std::future<DeliveryResult>> futures;
for (int i = 0; i < 30; ++i) {
    orders.emplace_back("FINAL" + std::to_string(i % 10), 2, i % 10);
    futures.push_back(center.submit(orders.back()));
}
center.shutdown();
int original_receipts = 0;
for (std::size_t i = 0; i < futures.size(); ++i) {
    const auto result = futures[i].get();
    CHECK(result.score == center.oracle(orders[i]));
    CHECK(result.receipt.status == CheckoutStatus::Accepted);
    if (!result.receipt.duplicate) ++original_receipts;
}
CHECK(original_receipts == 10 && center.stock() == 1);
expectThrows<std::runtime_error>([&] { (void) center.submit(Order("LATE", 1, 0)); });
// Destruction drains and joins while the owned inventory and route buffers still exist.
std::future<DeliveryResult> finished;
{ DeliveryCenter local(2, 5, 9, 2, 1); finished = local.submit(Order("LIFETIME", 2, 1)); }
CHECK(finished.get().receipt.status == CheckoutStatus::Accepted);
DeliveryCenter empty(0, 1, 1, 1, 1);
empty.shutdown(CloseMode::Cancel); empty.shutdown();
''')

BENCHMARK = r'''
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
'''.strip() + '\n'

TITLES = {
'cpp-domain-model': ('订单模型与封装不变量', '把订单接入配送中心', '拒绝非法订单并验证值语义'),
'raii-ownership': ('用 RAII 管理路线表所有权', '移动配送会话并读取只读数据', '验证移动后状态与异常退出'),
'compute-baseline': ('建立真实路线评分计算', '运行顺序基线并打印结果', '验证边界与可重复计算'),
'data-locality': ('把路线数据整理为连续数组', '对照顺序基线验证等价', '覆盖不同尺寸与极端种子'),
'worker-threads': ('用工作线程处理独立结果槽', '并行计算一批配送订单', '验证分片与工作线程异常'),
'blocking-queue': ('实现有界阻塞队列', '连接生产者与消费者', '验证关闭唤醒与多方吞吐'),
'task-pool': ('组合固定线程池与 future', '提交配送任务并回收结果', '验证异常传播与取消边界'),
'inventory-race': ('封装原子扣减和幂等记录', '处理重复订单与编号冲突', '并发验证不超卖和只扣一次'),
'deadlock-cancel': ('实现无死锁调拨与协作取消', '运行仓库调拨和取消示例', '验证反向调拨与取消检查点'),
'graceful-shutdown': ('组装完整配送中心', '运行完整作品并测量计算耗时', '验证退出顺序与作品一致性'),
}
CONSTANTS = {
'cpp-domain-model': ('kDemoUnits', 'int', 2, 3),
'raii-ownership': ('kRouteCount', 'std::size_t', 12, 6),
'compute-baseline': ('kCandidates', 'std::size_t', 8, 12),
'data-locality': ('kHops', 'std::size_t', 16, 24),
'worker-threads': ('kWorkers', 'std::size_t', 3, 1),
'blocking-queue': ('kQueueCapacity', 'std::size_t', 2, 1),
'task-pool': ('kPoolWorkers', 'std::size_t', 3, 1),
'inventory-race': ('kInitialStock', 'int', 9, 1),
'deadlock-cancel': ('kTransferUnits', 'int', 1, 3),
'graceful-shutdown': ('kPipelineCapacity', 'std::size_t', 4, 1),
}
# Constants are introduced before use; hops is needed by the CPU baseline first.
BASE_CONSTANTS = ['constexpr int kDemoUnits = 2;']

MAKEFILE = '''CXX ?= c++
CXXFLAGS ?= -std=c++20 -O2 -Wall -Wextra -Wpedantic -pthread
CPPFLAGS ?= -Isrc
HEADERS := $(wildcard src/*.hpp)
.PHONY: all run test benchmark clean
all: build/phoenix build/tests
build:
\tmkdir -p build
build/phoenix: src/main.cpp $(HEADERS) | build
\t$(CXX) $(CPPFLAGS) $(CXXFLAGS) src/main.cpp -o $@
build/tests: tests/tests.cpp $(HEADERS) | build
\t$(CXX) $(CPPFLAGS) $(CXXFLAGS) tests/tests.cpp -o $@
run: build/phoenix
\t./build/phoenix
test: build/tests
\t./build/tests
benchmark: build/phoenix
\t./build/phoenix --benchmark
clean:
\trm -rf build
'''

TEST_PREAMBLE = r'''
#include <algorithm>
#include <chrono>
#include <future>
#include <iostream>
#include <stdexcept>
#include <string>
#include <type_traits>
#include <utility>
#define CHECK(condition) do { if (!(condition)) throw std::runtime_error(std::string("CHECK failed: ") + #condition + " at line " + std::to_string(__LINE__)); } while(false)
template<class Exception, class Function> void expectThrows(Function function) {
    bool caught = false;
    try { function(); } catch (const Exception&) { caught = true; }
    CHECK(caught);
}
template<class Future> bool ready(Future& future) {
    return future.wait_for(std::chrono::seconds(5)) == std::future_status::ready;
}
using namespace phoenix;
'''.strip()

README = '''# 巅峰凤凰蛋：蛋仔商城道具配送中心

C++20 累积课程代码。需求：支持 C++20 的 c++/clang++/g++、make、pthread。

```sh
make test
make run
make benchmark
```

`make benchmark` 从最后一章第二步起提供实测结果，30 个累积状态分别存放在仓库的 `courseware/peak-delivery-center/states/` 目录；每份复制出来后独立构建，不引用外部代码。每一步的 `copyFiles` 是相对前一步需要新增或覆盖的完整文件；不要把不同状态的半段函数混合粘贴。每节的可选实验完成后恢复原值，再继续下一节。

Order 显式声明复制构造和复制赋值，因此不生成隐式移动；std::move(order) 在这里仍然复制，原订单保持有效。DispatchSession 则禁止复制、允许移动，移动整个 vector 不需要逐项移动 Order。

模型使用内存状态：订单编号幂等记录仅在当前 Inventory 实例生命周期有效，不提供跨进程、重启、数据库事务或持久化保证。并发出现同编号不同内容时，以先取得锁并提交记录的内容为准，不保证先提交任务者先处理。历史记录不自动淘汰，长期服务须设计容量和持久化方案。Receipt.remaining 表示首次处理该编号时的库存快照；读取当前库存使用 stock()。

队列元素要求 noexcept 移动，避免取出时移动异常破坏队列元素。队列关闭不会重开；Drain 拒绝新任务并处理已排队任务；Cancel 丢弃尚未开始的任务，相关 future 报 broken_promise，已经开始的任务正常完成。取消计算是另一种协作式 stop_token 协议，结果为 nullopt，检查点位于候选路线之间。不能声称 Cancel 会强杀运行中的任务。

线程池仅支持外部提交者：不允许工作线程向同一线程池嵌套 submit 或 shutdown。对象所有者必须保证调用者结束后再销毁对象，不能从自己的工作线程销毁线程池。关闭方法可并发调用并串行完成；关闭与 submit 交错时，已经入队的任务遵循关闭策略，未入队者抛出 pool is closed。

路线评分是用于理解 CPU 密集型工作、数据布局和调度的可重复整数模型，不是真实地图导航算法。AoS→SoA 未必更快；基准报告转换开销、三轮时间、校验和及实测加速比，不承诺任何固定提速。
'''

def render_main(includes, demos, constants, benchmark_enabled=False):
    lines = ['#include <iostream>', '#include <stdexcept>', '#include <string>', '#include <vector>']
    lines += ['#include "' + name + '"' for name in includes]
    lines += ['using namespace phoenix;', *constants]
    for chapter, body in demos.items():
        lines += ['void demo_' + chapter.replace('-', '_') + '() {', body, '}']
    lines += ['int main(int argc, char** argv) {', '    try {']
    if benchmark_enabled:
        lines += ['        if (argc == 2 && std::string(argv[1]) == "--benchmark") { benchmark(); return 0; }', '        if (argc != 1) { std::cerr << "Usage: phoenix [--benchmark]\\n"; return 2; }']
    else:
        lines += ['        if (argc > 1) { std::cerr << "Benchmark is introduced in the final integration lesson.\\n"; return 2; }', '        (void)argv;']
    for chapter in demos:
        lines += ['        demo_' + chapter.replace('-', '_') + '();']
    lines += ['        std::cout << "DEMO OK\\n";', '    } catch (const std::exception& error) {', '        std::cerr << "FAIL: " << error.what() << "\\n"; return 1;', '    }', '}']
    return '\n'.join(lines) + '\n'

def render_tests(includes, tests):
    lines = ['#include "' + name + '"' for name in includes if name != 'benchmark.hpp']
    lines += [TEST_PREAMBLE]
    for chapter, body in tests.items():
        lines += ['void test_' + chapter.replace('-', '_') + '() {', body, '}']
    lines += ['int main() {', '    try {']
    for chapter in tests:
        lines += ['        test_' + chapter.replace('-', '_') + '();', '        std::cout << "PASS ' + chapter + '\\n";']
    lines += ['        std::cout << "ALL TESTS PASSED (' + str(len(tests)) + ' groups)\\n";', '    } catch (const std::exception& error) {', '        std::cerr << "FAIL: " << error.what() << "\\n"; return 1;', '    }', '}']
    return '\n'.join(lines) + '\n'

def generate():
    files = {'Makefile': MAKEFILE, 'README.md': README, '.gitignore': 'build/\n'}
    manifest = {'version': 1, 'language': 'C++20', 'baseline': {}, 'chapters': []}
    includes, demos, tests, constants = [], {}, {}, list(BASE_CONSTANTS)
    previous = {}
    for chapter, (filename, header) in HEADERS.items():
        item = {'id': chapter, 'steps': []}
        for step in range(1, 4):
            if step == 1:
                files['src/' + filename] = header
                includes.append(filename)
                name, type_name, value, changed = CONSTANTS[chapter]
                declaration = f'constexpr {type_name} {name} = {value};'
                if declaration not in constants: constants.append(declaration)
                if chapter == 'compute-baseline': constants.append('constexpr std::size_t kHops = 16;')
            elif step == 2:
                demos[chapter] = DEMOS[chapter]
                if chapter == 'graceful-shutdown':
                    files['src/benchmark.hpp'] = BENCHMARK
                    includes.append('benchmark.hpp')
            else:
                tests[chapter] = TESTS[chapter]
            files['src/main.cpp'] = render_main(includes, demos, constants, 'benchmark.hpp' in includes)
            files['tests/tests.cpp'] = render_tests(includes, tests)
            state_id = f'{chapter}-{step}'
            changed_files = [path for path, content in files.items() if previous.get(path) != content]
            # Deliver the optional experiment's file even when its canonical contents are unchanged.
            if 'src/main.cpp' not in changed_files: changed_files.append('src/main.cpp')
            name, type_name, value, changed = CONSTANTS[chapter]
            declaration = f'constexpr {type_name} {name} = {value};'
            commands = ['make test', 'make run']
            if chapter == 'graceful-shutdown' and step >= 2: commands.append('make benchmark')
            record = {
                'id': f'{chapter}-step-{step}', 'title': TITLES[chapter][step-1], 'stateId': state_id,
                'files': dict(files), 'copyFiles': changed_files,
                'learnerChange': {'file': 'src/main.cpp', 'anchor': declaration,
                    'instruction': f'可选实验：把 {name} 从 {value} 改为 {changed}，运行 make test 和 make run，记录结果及其原因；继续下一步前恢复为 {value}。完整代码无需补空即可运行。' + ('此步先引入实现，新增示例在下一步接入；本步先验证编译，已接入的前节示例仍然会运行。' if step == 1 else ''),
                    'expectedFragment': f'constexpr {type_name} {name} = {changed};'},
                'commands': commands,
                'expected': [f'ALL TESTS PASSED ({len(tests)} groups)', 'DEMO OK'],
            }
            item['steps'].append(record)
            directory = ROOT / 'states' / state_id
            for path, content in files.items():
                destination = directory / path
                destination.parent.mkdir(parents=True, exist_ok=True)
                destination.write_text(content)
            previous = dict(files)
        manifest['chapters'].append(item)
    for path, content in files.items():
        destination = ROOT / 'project' / path
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_text(content)
    (ROOT / 'manifest.json').write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
    (ROOT / 'README.md').write_text('''# 第七章 C++ 配送中心课程包

- `project/`：最终完整作品，`make test && make run && make benchmark`。
- `states/`：30 个逐节累积的独立可运行项目，每个状态均包含全部所需文件。
- `manifest.json`：每一步完整文件、相对上一步的 `copyFiles`、运行命令与可选实验。
- `generate.py`：课程代码唯一生成源，修改后运行 `python3 generate.py` 同步所有快照。

页面每小节只需要按 `copyFiles` 新增或覆盖文件；最后得到的文件应与 `project/` 完全一致。
''')
    print('Generated 30 runnable states and final project')

if __name__ == '__main__': generate()
