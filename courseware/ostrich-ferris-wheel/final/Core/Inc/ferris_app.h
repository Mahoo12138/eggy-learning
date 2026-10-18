#ifndef FERRIS_APP_H
#define FERRIS_APP_H

#if defined(FERRIS_STM32_TARGET)

#include "analog_sensor.h"
#include "app_events.h"
#include "board_io.h"
#include "board_stm32f1.h"
#include "button.h"
#include "diagnostics.h"
#include "door_sensor.h"
#include "drive_output.h"
#include "fault_supervisor.h"
#include "ferris_controller.h"
#include "uart_rx.h"

#include "stm32f1xx_hal.h"

#include <stdbool.h>
#include <stdint.h>

typedef struct {
    BoardStm32f1 board;
    BoardIo io;
    DoorBus door_bus;
    Button button;
    DriveOutput drive;
    AppEvents events;
    UartRx uart_rx;
    AnalogSensor analog;
    OverloadDetector overload;
    FaultSupervisor faults;
    FerrisController controller;
    Diagnostics diagnostics;
    DoorReading door;
    SensorReading load;
    TIM_HandleTypeDef *scheduler_timer;
    UART_HandleTypeDef *diagnostic_uart;
    IWDG_HandleTypeDef *watchdog;
    uint32_t last_door_sample_ms;
    uint32_t event_critical_primask;
    bool initialized;
} FerrisApp;

bool ferris_app_init(FerrisApp *app,
                     ADC_HandleTypeDef *adc,
                     TIM_HandleTypeDef *pwm_timer,
                     uint32_t pwm_channel,
                     TIM_HandleTypeDef *scheduler_timer,
                     I2C_HandleTypeDef *door_i2c,
                     UART_HandleTypeDef *diagnostic_uart,
                     IWDG_HandleTypeDef *watchdog,
                     uint32_t now_ms,
                     const char *reset_reason);
void ferris_app_poll(FerrisApp *app, uint32_t now_ms);

#endif

#endif
