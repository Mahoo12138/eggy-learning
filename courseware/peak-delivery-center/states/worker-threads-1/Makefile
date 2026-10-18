CXX ?= c++
CXXFLAGS ?= -std=c++20 -O2 -Wall -Wextra -Wpedantic -pthread
CPPFLAGS ?= -Isrc
HEADERS := $(wildcard src/*.hpp)
.PHONY: all run test benchmark clean
all: build/phoenix build/tests
build:
	mkdir -p build
build/phoenix: src/main.cpp $(HEADERS) | build
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) src/main.cpp -o $@
build/tests: tests/tests.cpp $(HEADERS) | build
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) tests/tests.cpp -o $@
run: build/phoenix
	./build/phoenix
test: build/tests
	./build/tests
benchmark: build/phoenix
	./build/phoenix --benchmark
clean:
	rm -rf build
