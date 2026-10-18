#ifndef FERRIS_BOARD_STM32F1_H
#define FERRIS_BOARD_STM32F1_H

#include "board_io.h"
#include "door_sensor.h"

#if defined(FERRIS_STM32_TARGET)
#include "stm32f1xx_hal.h"

typedef struct {
    ADC_HandleTypeDef *adc;
    TIM_HandleTypeDef *pwm_timer;
    uint32_t pwm_channel;
    I2C_HandleTypeDef *door_i2c;
} BoardStm32f1;

void board_stm32f1_init(BoardStm32f1 *board,
                        ADC_HandleTypeDef *adc,
                        TIM_HandleTypeDef *pwm_timer,
                        uint32_t pwm_channel,
                        I2C_HandleTypeDef *door_i2c);
BoardIo board_stm32f1_io(BoardStm32f1 *board);
DoorBus board_stm32f1_door_bus(BoardStm32f1 *board);
#endif

#endif
