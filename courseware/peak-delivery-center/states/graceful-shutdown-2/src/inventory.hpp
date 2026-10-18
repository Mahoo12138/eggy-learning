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
