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
