#include "ferris_app.h"

#if defined(FERRIS_STM32_TARGET)

#include "app_time.h"
#include "board_config.h"
#include "ferris_interrupts.h"

#include <stddef.h>
#include <stdio.h>
#include <string.h>

enum {
    APP_HEALTH_BUTTON = 1U << 0,
    APP_HEALTH_EVENTS = 1U << 1,
    APP_HEALTH_ANALOG = 1U << 2,
    APP_HEALTH_CONTROLLER = 1U << 3,
    APP_HEALTH_ALL = APP_HEALTH_BUTTON | APP_HEALTH_EVENTS |
                     APP_HEALTH_ANALOG | APP_HEALTH_CONTROLLER,
    APP_DOOR_SAMPLE_MS = 50U,
    APP_IO_TIMEOUT_MS = 5U
};

static void enter_event_critical(void *context) {
    FerrisApp *app = context;
    if (app == NULL) {
        return;
    }
    app->event_critical_primask = __get_PRIMASK();
    __disable_irq();
}

static void exit_event_critical(void *context) {
    FerrisApp *app = context;
    if (app != NULL) {
        __set_PRIMASK(app->event_critical_primask);
    }
}

static bool uart_write(FerrisApp *app, const char *text) {
    if (app == NULL || app->diagnostic_uart == NULL || text == NULL) {
        return false;
    }
    const size_t length = strlen(text);
    if (length > UINT16_MAX ||
        HAL_UART_Transmit(app->diagnostic_uart,
                          (uint8_t *)(uintptr_t)text,
                          (uint16_t)length,
                          APP_IO_TIMEOUT_MS) != HAL_OK) {
        return false;
    }
    static uint8_t newline[] = {'\r', '\n'};
    return HAL_UART_Transmit(app->diagnostic_uart,
                             newline,
                             (uint16_t)sizeof(newline),
                             APP_IO_TIMEOUT_MS) == HAL_OK;
}

static DiagnosticReason transition_reason(FerrisState state,
                                           bool start_requested,
                                           bool stop_requested,
                                           bool reset_requested) {
    if (state == FERRIS_STATE_FAULT) {
        return DIAG_REASON_FAULT;
    }
    if (reset_requested) {
        return DIAG_REASON_RESET;
    }
    if (start_requested) {
        return DIAG_REASON_USER_START;
    }
    if (stop_requested) {
        return DIAG_REASON_USER_STOP;
    }
    if (state == FERRIS_STATE_READY) {
        return DIAG_REASON_PARKED;
    }
    return DIAG_REASON_SELF_TEST;
}

static void flush_diagnostics(FerrisApp *app) {
    DiagnosticEvent event;
    char line[128];
    while (diagnostics_pop(&app->diagnostics, &event)) {
        if (diagnostics_format_event(&event, line, sizeof(line)) > 0) {
            (void)uart_write(app, line);
        }
    }
}

static void collect_commands(FerrisApp *app,
                             bool *start_requested,
                             bool *stop_requested,
                             bool *reset_requested) {
    UartCommand command;
    while (uart_rx_poll(&app->uart_rx, &command)) {
        switch (command.type) {
            case UART_COMMAND_STATUS: {
                char line[96];
                (void)snprintf(line,
                               sizeof(line),
                               "status state=%s fault=%s pwm=%u",
                               ferris_state_name(app->controller.state),
                               ferris_fault_name(app->controller.fault_latch),
                               app->drive.current_permille);
                (void)uart_write(app, line);
                break;
            }
            case UART_COMMAND_STOP:
                *stop_requested = true;
                break;
            case UART_COMMAND_RESET:
                *reset_requested = true;
                break;
            case UART_COMMAND_RX_OVERFLOW:
            case UART_COMMAND_LINE_TOO_LONG:
            case UART_COMMAND_UNKNOWN:
                (void)uart_write(app, "error invalid-command");
                break;
            case UART_COMMAND_NONE:
            default:
                break;
        }
    }
    if (*start_requested && *stop_requested) {
        *start_requested = false;
    }
}

bool ferris_app_init(FerrisApp *app,
                     ADC_HandleTypeDef *adc,
                     TIM_HandleTypeDef *pwm_timer,
                     uint32_t pwm_channel,
                     TIM_HandleTypeDef *scheduler_timer,
                     I2C_HandleTypeDef *door_i2c,
                     UART_HandleTypeDef *diagnostic_uart,
                     IWDG_HandleTypeDef *watchdog,
                     uint32_t now_ms,
                     const char *reset_reason) {
    if (app == NULL || adc == NULL || pwm_timer == NULL || scheduler_timer == NULL ||
        door_i2c == NULL || diagnostic_uart == NULL || watchdog == NULL ||
        reset_reason == NULL || !board_reference_profile_valid()) {
        return false;
    }
    memset(app, 0, sizeof(*app));
    board_stm32f1_init(&app->board, adc, pwm_timer, pwm_channel, door_i2c);
    app->io = board_stm32f1_io(&app->board);
    app->door_bus = board_stm32f1_door_bus(&app->board);
    app->scheduler_timer = scheduler_timer;
    app->diagnostic_uart = diagnostic_uart;
    app->watchdog = watchdog;
    if (!board_io_valid(&app->io)) {
        return false;
    }
    board_outputs_safe(&app->io);

    button_init(&app->button,
                board_button_pressed(&app->io),
                now_ms,
                BOARD_BUTTON_DEBOUNCE_MS);
    drive_output_init(&app->drive, 50U);
    app_events_init(&app->events,
                    enter_event_critical,
                    exit_event_critical,
                    app);
    uart_rx_init(&app->uart_rx);
    if (!analog_sensor_init(&app->analog, 500U, 3500U, 4U)) {
        return false;
    }
    overload_init(&app->overload,
                  BOARD_ANALOG_ENTER_OVERLOAD,
                  BOARD_ANALOG_EXIT_OVERLOAD);
    fault_supervisor_init(&app->faults, APP_HEALTH_ALL);
    ferris_controller_init(&app->controller);
    diagnostics_init(&app->diagnostics);
    app->door = (DoorReading){
        .valid = false,
        .locked = false,
        .error = DOOR_ERROR_STALE,
        .sampled_at_ms = now_ms,
    };
    app->load = (SensorReading){
        .raw = 0U,
        .value_permille = 0U,
        .valid = false,
        .error = SENSOR_ERROR_EMPTY_FILTER,
    };
    app->last_door_sample_ms = now_ms - APP_DOOR_SAMPLE_MS;

    ferris_interrupts_bind(&app->events,
                           scheduler_timer,
                           diagnostic_uart,
                           &app->uart_rx);
    if (HAL_TIM_PWM_Start(pwm_timer, pwm_channel) != HAL_OK ||
        HAL_TIM_Base_Start_IT(scheduler_timer) != HAL_OK ||
        !ferris_uart_receive_start()) {
        board_outputs_safe(&app->io);
        return false;
    }

    char banner[160];
    if (diagnostics_format_banner(banner,
                                  sizeof(banner),
                                  reset_reason,
                                  BOARD_MCU_PART_NUMBER) < 0 ||
        !uart_write(app, banner)) {
        board_outputs_safe(&app->io);
        return false;
    }
    app->initialized = true;
    return true;
}

void ferris_app_poll(FerrisApp *app, uint32_t now_ms) {
    if (app == NULL || !app->initialized) {
        return;
    }
    const AppEventSnapshot events = app_events_take(&app->events);
    if (events.tick_count == 0U) {
        return;
    }
    fault_supervisor_begin_cycle(&app->faults);
    fault_supervisor_mark_health(&app->faults, APP_HEALTH_EVENTS);

    bool start_requested = false;
    bool stop_requested = false;
    bool reset_requested = false;
    collect_commands(app, &start_requested, &stop_requested, &reset_requested);
    const ButtonEvent button_event = button_update(&app->button,
                                                   board_button_pressed(&app->io),
                                                   now_ms);
    if (button_event == BUTTON_EVENT_PRESS) {
        if (app->controller.state == FERRIS_STATE_READY) {
            start_requested = true;
        } else if (app->controller.state == FERRIS_STATE_RUNNING) {
            stop_requested = true;
        } else if (app->controller.state == FERRIS_STATE_FAULT) {
            reset_requested = true;
        }
    }
    fault_supervisor_mark_health(&app->faults, APP_HEALTH_BUTTON);

    uint16_t raw = 0U;
    const bool adc_ok = board_adc_read(&app->io, &raw);
    app->load = analog_sensor_add(&app->analog,
                                  raw,
                                  adc_ok ? SENSOR_ERROR_NONE : SENSOR_ERROR_TIMEOUT);
    bool overload_changed = false;
    const bool overloaded = overload_update(&app->overload,
                                             &app->load,
                                             &overload_changed);
    (void)overload_changed;
    if (app->load.valid) {
        fault_supervisor_mark_health(&app->faults, APP_HEALTH_ANALOG);
    }

    if (app_due(now_ms, app->last_door_sample_ms, APP_DOOR_SAMPLE_MS)) {
        app->door = door_sensor_read(&app->door_bus, now_ms, APP_IO_TIMEOUT_MS);
        app->last_door_sample_ms = now_ms;
    }
    const bool door_fresh = door_reading_is_fresh(&app->door,
                                                  now_ms,
                                                  BOARD_DOOR_READING_MAX_AGE_MS);
    fault_supervisor_mark_health(&app->faults, APP_HEALTH_CONTROLLER);
    const bool health_complete = fault_supervisor_health_complete(&app->faults);
    const FaultInputs fault_inputs = {
        .emergency_stop = false,
        .door_valid = door_fresh,
        .door_locked = app->door.locked,
        .overloaded = overloaded,
        .event_overflow = events.dropped_events != 0U || events.fault_bits != 0U,
        .health_complete = health_complete,
    };
    FaultSnapshot fault = fault_supervisor_evaluate(&app->faults,
                                                    &fault_inputs,
                                                    now_ms);
    if (reset_requested && fault.active == FERRIS_FAULT_NONE &&
        fault_supervisor_clear_latch(&app->faults, &fault_inputs)) {
        fault.latched = FERRIS_FAULT_NONE;
        fault.first_seen_ms = 0U;
    }

    const FerrisState before = app->controller.state;
    const FerrisControllerInputs inputs = {
        .self_test_complete = before == FERRIS_STATE_SELF_TEST,
        .self_test_ok = app->load.valid && door_fresh && app->door.locked,
        .start_requested = start_requested,
        .stop_requested = stop_requested,
        .reset_requested = reset_requested,
        .parked = app->drive.current_permille == 0U,
        .fault = fault,
    };
    if (ferris_controller_update(&app->controller, &inputs)) {
        (void)diagnostics_record_transition(&app->diagnostics,
                                            now_ms,
                                            (int)before,
                                            (int)app->controller.state,
                                            transition_reason(app->controller.state,
                                                              start_requested,
                                                              stop_requested,
                                                              reset_requested),
                                            (int)app->controller.fault_latch);
    }
    if (app->controller.state == FERRIS_STATE_FAULT) {
        drive_output_stop_immediately(&app->drive);
    } else {
        drive_output_set_target(&app->drive,
                                app->controller.requested_drive_permille);
        (void)drive_output_update(&app->drive);
    }
    board_drive_set(&app->io, app->drive.current_permille);
    board_status_led_set(&app->io,
                         app->controller.state == FERRIS_STATE_RUNNING);
    flush_diagnostics(app);
    if (health_complete) {
        (void)HAL_IWDG_Refresh(app->watchdog);
    }
}

#endif

#if !defined(FERRIS_STM32_TARGET)
typedef int ferris_app_host_translation_unit;
#endif
