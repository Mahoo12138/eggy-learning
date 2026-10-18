#include <iostream>
#include <stdexcept>
#include <string>
#include <vector>
#include "domain.hpp"
using namespace phoenix;
constexpr int kDemoUnits = 2;
int main(int argc, char** argv) {
    try {
        if (argc > 1) { std::cerr << "Benchmark is introduced in the final integration lesson.\n"; return 2; }
        (void)argv;
        std::cout << "DEMO OK\n";
    } catch (const std::exception& error) {
        std::cerr << "FAIL: " << error.what() << "\n"; return 1;
    }
}
