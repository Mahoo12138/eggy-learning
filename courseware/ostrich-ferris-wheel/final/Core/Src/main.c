#include "analog_sensor.h"
#include "app_events.h"
#include "board_config.h"
#include "board_io.h"
#include "board_sim.h"
#include "button.h"
#include "diagnostics.h"
#include "door_sensor.h"
#include "drive_output.h"
#include "fault_supervisor.h"
#include "ferris_controller.h"
#include "uart_rx.h"

#include <stdbool.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

enum {
    HEALTH_BUTTON = 1U << 0,
    HEALTH_EVENTS = 1U << 1,
    HEALTH_ANALOG = 1U << 2,
    HEALTH_CONTROLLER = 1U << 3,
    HEALTH_ALL = HEALTH_BUTTON | HEALTH_EVENTS | HEALTH_ANALOG | HEALTH_CONTROLLER
};

typedef struct {
    bool locked;
} DemoDoor;

static DoorBusResult demo_door_read(void *context,
                                    uint8_t address,
                                    uint8_t register_address,
                                    uint8_t *output,
                                    size_t capacity,
                                    size_t *received,
                                    uint32_t timeout_ms) {
    const DemoDoor *door = context;
    (void)timeout_ms;
    if (door == NULL || output == NULL || received == NULL || capacity < 2U ||
        address != DOOR_SENSOR_ADDRESS || register_address != DOOR_SENSOR_STATUS_REGISTER) {
        return DOOR_BUS_IO_ERROR;
    }
    output[0] = DOOR_SENSOR_EXPECTED_ID;
    output[1] = door->locked ? DOOR_SENSOR_LOCKED_MASK : 0U;
    *received = 2U;
    return DOOR_BUS_OK;
}

static void push_uart_text(UartRx *rx, const char *text) {
    while (*text != '\0') {
        (void)uart_rx_isr_push(rx, (uint8_t)*text++);
    }
}

static DiagnosticReason transition_reason(FerrisState state, bool start, bool stop) {
    if (state == FERRIS_STATE_FAULT) {
        return DIAG_REASON_FAULT;
    }
    if (start) {
        return DIAG_REASON_USER_START;
    }
    if (stop) {
        return DIAG_REASON_USER_STOP;
    }
    if (state == FERRIS_STATE_READY) {
        return DIAG_REASON_PARKED;
    }
    return DIAG_REASON_SELF_TEST;
}

int main(void) {
    BoardSim board;
    board_sim_init(&board);
    BoardIo io = board_sim_io(&board);
    board_outputs_safe(&io);

    char banner[160];
    if (diagnostics_format_banner(banner, sizeof(banner), "power-on", "host-sim") < 0) {
        return EXIT_FAILURE;
    }
    puts(banner);

    Button button;
    button_init(&button, false, 0U, BOARD_BUTTON_DEBOUNCE_MS);
    DriveOutput drive;
    drive_output_init(&drive, 50U);
    AppEvents events;
    app_events_init(&events, NULL, NULL, NULL);
    UartRx uart;
    uart_rx_init(&uart);
    AnalogSensor analog;
    if (!analog_sensor_init(&analog, 500U, 3500U, 4U)) {
        return EXIT_FAILURE;
    }
    OverloadDetector overload;
    overload_init(&overload, BOARD_ANALOG_ENTER_OVERLOAD, BOARD_ANALOG_EXIT_OVERLOAD);
    FaultSupervisor faults;
    fault_supervisor_init(&faults, HEALTH_ALL);
    FerrisController controller;
    ferris_controller_init(&controller);
    Diagnostics diagnostics;
    diagnostics_init(&diagnostics);
    DemoDoor demo_door = {.locked = true};
    const DoorBus door_bus = {.read = demo_door_read, .write = NULL, .context = &demo_door};
    DoorReading door = door_sensor_read(&door_bus, 0U, 5U);

    bool saw_running = false;
    bool saw_parking = false;
    bool saw_fault = false;
    bool stop_requested = false;
    for (uint32_t now_ms = 0U; now_ms <= 2600U; now_ms += 10U) {
        fault_supervisor_begin_cycle(&faults);
        app_events_isr_tick(&events);
        const AppEventSnapshot event_snapshot = app_events_take(&events);
        fault_supervisor_mark_health(&faults, HEALTH_EVENTS);

        const bool first_press = now_ms >= 100U && now_ms < 180U;
        const bool second_press = now_ms >= 1500U && now_ms < 1580U;
        board_sim_set_button_pressed(&board, first_press || second_press);
        const ButtonEvent button_event = button_update(&button, board_button_pressed(&io), now_ms);
        const bool start_requested = button_event == BUTTON_EVENT_PRESS;
        fault_supervisor_mark_health(&faults, HEALTH_BUTTON);

        if (now_ms == 1000U) {
            push_uart_text(&uart, "stop\r\n");
        }
        UartCommand command;
        stop_requested = false;
        while (uart_rx_poll(&uart, &command)) {
            if (command.type == UART_COMMAND_STOP) {
                stop_requested = true;
            }
        }

        board_sim_set_adc_raw(&board, now_ms >= 2200U ? 3300U : 1700U);
        uint16_t adc_raw = 0U;
        const bool adc_ok = board_adc_read(&io, &adc_raw);
        const SensorReading load = analog_sensor_add(&analog,
                                                      adc_raw,
                                                      adc_ok ? SENSOR_ERROR_NONE
                                                             : SENSOR_ERROR_TIMEOUT);
        bool overload_changed = false;
        const bool overloaded = overload_update(&overload, &load, &overload_changed);
        (void)overload_changed;
        fault_supervisor_mark_health(&faults, HEALTH_ANALOG);

        if ((now_ms % 50U) == 0U) {
            door = door_sensor_read(&door_bus, now_ms, 5U);
        }
        const bool door_fresh = door_reading_is_fresh(&door,
                                                       now_ms,
                                                       BOARD_DOOR_READING_MAX_AGE_MS);
        fault_supervisor_mark_health(&faults, HEALTH_CONTROLLER);
        const FaultInputs fault_inputs = {
            .emergency_stop = false,
            .door_valid = door_fresh,
            .door_locked = door.locked,
            .overloaded = overloaded,
            .event_overflow = event_snapshot.dropped_events != 0U,
            .health_complete = fault_supervisor_health_complete(&faults),
        };
        const FaultSnapshot snapshot = fault_supervisor_evaluate(&faults, &fault_inputs, now_ms);
        const FerrisState before = controller.state;
        const FerrisControllerInputs controller_inputs = {
            .self_test_complete = now_ms >= 10U,
            .self_test_ok = true,
            .start_requested = start_requested,
            .stop_requested = stop_requested,
            .reset_requested = false,
            .parked = drive.current_permille == 0U,
            .fault = snapshot,
        };
        if (ferris_controller_update(&controller, &controller_inputs)) {
            const DiagnosticReason reason = transition_reason(controller.state,
                                                               start_requested,
                                                               stop_requested);
            (void)diagnostics_record_transition(&diagnostics,
                                                now_ms,
                                                (int)before,
                                                (int)controller.state,
                                                reason,
                                                (int)controller.fault_latch);
            printf("[%4lu ms] %-10s -> %-10s fault=%s\n",
                   (unsigned long)now_ms,
                   ferris_state_name(before),
                   ferris_state_name(controller.state),
                   ferris_fault_name(controller.fault_latch));
        }
        saw_running = saw_running || controller.state == FERRIS_STATE_RUNNING;
        saw_parking = saw_parking || controller.state == FERRIS_STATE_PARKING;
        saw_fault = saw_fault || controller.state == FERRIS_STATE_FAULT;

        if (controller.state == FERRIS_STATE_FAULT) {
            drive_output_stop_immediately(&drive);
        } else {
            drive_output_set_target(&drive, controller.requested_drive_permille);
            (void)drive_output_update(&drive);
        }
        board_drive_set(&io, drive.current_permille);
        board_status_led_set(&io, controller.state == FERRIS_STATE_RUNNING);
    }

    printf("final state=%s pwm=%u diagnostics=%lu overflow=%lu\n",
           ferris_state_name(controller.state),
           board.drive_permille,
           (unsigned long)diagnostics.count,
           (unsigned long)diagnostics.overflow_count);
    if (!saw_running || !saw_parking || !saw_fault || board.drive_permille != 0U) {
        fputs("DEMO FAIL\n", stderr);
        return EXIT_FAILURE;
    }
    puts("DEMO PASS");
    return EXIT_SUCCESS;
}
