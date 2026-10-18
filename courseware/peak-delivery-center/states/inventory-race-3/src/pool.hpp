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
