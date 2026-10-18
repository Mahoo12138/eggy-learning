CC ?= cc
CXX ?= c++
CFLAGS ?= -std=c17 -O2 -Wall -Wextra -Wpedantic -pthread -D_POSIX_C_SOURCE=200809L
CXXFLAGS ?= -std=c++20 -O2 -Wall -Wextra -Wpedantic -pthread -D_POSIX_C_SOURCE=200809L
CPPFLAGS ?= -Icommon -Iservice
HEADERS := $(wildcard common/*.h service/*.hpp)
.PHONY: all test run clean
all: build/client build/unit build/gateway build/service build/sqlite_unit
build:
	mkdir -p build
build/client: client/main.c $(HEADERS) | build
	$(CC) $(CPPFLAGS) $(CFLAGS) $< -o $@
build/unit: tests/unit.c $(HEADERS) | build
	$(CC) $(CPPFLAGS) $(CFLAGS) $< -o $@
build/gateway: gateway/main.c $(HEADERS) | build
	$(CC) $(CPPFLAGS) $(CFLAGS) $< -o $@
build/service: service/main.cpp $(HEADERS) | build
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< -lsqlite3 -o $@
build/sqlite_unit: tests/sqlite_unit.cpp $(HEADERS) | build
	$(CXX) $(CPPFLAGS) $(CXXFLAGS) $< -lsqlite3 -o $@
test: all
	python3 tests/check.py
run: all
	python3 tools/demo.py
clean:
	rm -rf build
