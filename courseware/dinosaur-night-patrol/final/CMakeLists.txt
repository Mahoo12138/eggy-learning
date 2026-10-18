cmake_minimum_required(VERSION 3.16)
project(dinosaur_night_patrol VERSION 1.0.0 LANGUAGES C)

set(CMAKE_C_STANDARD 17)
set(CMAKE_C_STANDARD_REQUIRED ON)
set(CMAKE_C_EXTENSIONS ON)
add_compile_options(-Wall -Wextra -Wpedantic -Werror)
add_compile_definitions(_GNU_SOURCE)

add_library(patrol_common STATIC
  src/common/clock.c
  src/common/fd_log.c
  src/common/fs.c
  src/common/io.c
  src/common/os_error.c
  src/common/protocol.c
)
target_include_directories(patrol_common PUBLIC src)

add_library(patrol_supervisor STATIC
  src/supervisor/control.c
  src/supervisor/deadline.c
  src/supervisor/event_loop.c
  src/supervisor/journal.c
  src/supervisor/reaper.c
  src/supervisor/report.c
  src/supervisor/runtime.c
  src/supervisor/signal_bridge.c
  src/supervisor/spawn.c
  src/supervisor/spawn_profile.c
  src/supervisor/state.c
  src/supervisor/worker.c
)
target_include_directories(patrol_supervisor PUBLIC src)
target_link_libraries(patrol_supervisor PUBLIC patrol_common)

add_executable(patrold src/supervisor/main.c)
target_link_libraries(patrold PRIVATE patrol_supervisor)

add_executable(patrol-worker src/worker/main.c src/worker/checks.c)
target_link_libraries(patrol-worker PRIVATE patrol_common)

add_executable(inline-probe src/worker/inline_probe.c)
add_executable(patrolctl tools/patrolctl.c)
target_link_libraries(patrolctl PRIVATE patrol_common)

include(CTest)
if(BUILD_TESTING)
  function(add_patrol_test name source)
    add_executable(${name} ${source})
    target_link_libraries(${name} PRIVATE patrol_supervisor)
    add_test(NAME ${name} COMMAND ${name})
  endfunction()

  add_patrol_test(test_os_error tests/test_os_error.c)
  add_patrol_test(test_io tests/test_io.c)
  add_patrol_test(test_fs tests/test_fs.c)
  add_patrol_test(test_fork_model tests/test_fork_model.c)
  add_patrol_test(test_spawn tests/test_spawn.c)
  add_patrol_test(test_reaper tests/test_reaper.c)
  add_patrol_test(test_protocol tests/test_protocol.c)
  add_patrol_test(test_event_loop tests/test_event_loop.c)
  add_patrol_test(test_signal_bridge tests/test_signal_bridge.c)
  add_patrol_test(test_deadline tests/test_deadline.c)
  add_patrol_test(test_isolation tests/test_isolation.c)
  add_patrol_test(test_supervisor tests/test_supervisor.c)

  add_test(
    NAME e2e_once
    COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/tests/e2e_once.sh
            $<TARGET_FILE:patrold>
            $<TARGET_FILE:patrol-worker>
  )
  add_test(
    NAME e2e_control
    COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/tests/e2e_control.sh
            $<TARGET_FILE:patrold>
            $<TARGET_FILE:patrol-worker>
            $<TARGET_FILE:patrolctl>
  )
  add_test(
    NAME e2e_rlimit
    COMMAND ${CMAKE_CURRENT_SOURCE_DIR}/tests/e2e_rlimit.sh
            $<TARGET_FILE:patrold>
            $<TARGET_FILE:patrol-worker>
  )
endif()
