#include "board_stm32f1.h"

#if defined(FERRIS_STM32_TARGET)

#include "board_config.h"

#include <stddef.h>

static bool stm32_read_button(void *context) {
    (void)context;
    return HAL_GPIO_ReadPin(BOARD_BUTTON_PORT, BOARD_BUTTON_PIN) == GPIO_PIN_SET;
}

static bool stm32_read_adc(void *context, uint16_t *raw) {
    BoardStm32f1 *board = context;
    if (board == NULL || board->adc == NULL || raw == NULL ||
        HAL_ADC_Start(board->adc) != HAL_OK) {
        return false;
    }
    if (HAL_ADC_PollForConversion(board->adc, 5U) != HAL_OK) {
        (void)HAL_ADC_Stop(board->adc);
        return false;
    }
    *raw = (uint16_t)HAL_ADC_GetValue(board->adc);
    (void)HAL_ADC_Stop(board->adc);
    return true;
}

static void stm32_write_led(void *context, bool high) {
    (void)context;
    HAL_GPIO_WritePin(BOARD_LED_PORT,
                      BOARD_LED_PIN,
                      high ? GPIO_PIN_SET : GPIO_PIN_RESET);
}

static void stm32_write_drive(void *context, uint16_t permille) {
    BoardStm32f1 *board = context;
    if (board == NULL || board->pwm_timer == NULL) {
        return;
    }
    const uint32_t period = __HAL_TIM_GET_AUTORELOAD(board->pwm_timer) + 1U;
    const uint32_t compare = (period * permille) / 1000U;
    __HAL_TIM_SET_COMPARE(board->pwm_timer, board->pwm_channel, compare);
    HAL_GPIO_WritePin(BOARD_SAFETY_ENABLE_PORT,
                      BOARD_SAFETY_ENABLE_PIN,
                      permille == 0U ? GPIO_PIN_RESET : GPIO_PIN_SET);
}

static DoorBusResult stm32_door_read(void *context,
                                     uint8_t address,
                                     uint8_t register_address,
                                     uint8_t *output,
                                     size_t capacity,
                                     size_t *received,
                                     uint32_t timeout_ms) {
    BoardStm32f1 *board = context;
    if (received != NULL) {
        *received = 0U;
    }
    if (board == NULL || board->door_i2c == NULL || output == NULL || received == NULL ||
        capacity < 2U) {
        return DOOR_BUS_IO_ERROR;
    }
    const HAL_StatusTypeDef result = HAL_I2C_Mem_Read(board->door_i2c,
                                                       (uint16_t)((uint16_t)address << 1U),
                                                       register_address,
                                                       I2C_MEMADD_SIZE_8BIT,
                                                       output,
                                                       2U,
                                                       timeout_ms);
    if (result == HAL_OK) {
        *received = 2U;
        return DOOR_BUS_OK;
    }
    if (result == HAL_TIMEOUT) {
        return DOOR_BUS_TIMEOUT;
    }
    if (result == HAL_ERROR &&
        (HAL_I2C_GetError(board->door_i2c) & HAL_I2C_ERROR_AF) != 0U) {
        return DOOR_BUS_NACK;
    }
    return DOOR_BUS_IO_ERROR;
}

static DoorBusResult stm32_door_write(void *context,
                                      uint8_t address,
                                      uint8_t register_address,
                                      const uint8_t *data,
                                      size_t length,
                                      uint32_t timeout_ms) {
    BoardStm32f1 *board = context;
    if (board == NULL || board->door_i2c == NULL || data == NULL ||
        length == 0U || length > UINT16_MAX) {
        return DOOR_BUS_IO_ERROR;
    }
    const HAL_StatusTypeDef result = HAL_I2C_Mem_Write(board->door_i2c,
                                                        (uint16_t)((uint16_t)address << 1U),
                                                        register_address,
                                                        I2C_MEMADD_SIZE_8BIT,
                                                        (uint8_t *)(uintptr_t)data,
                                                        (uint16_t)length,
                                                        timeout_ms);
    if (result == HAL_OK) {
        return DOOR_BUS_OK;
    }
    if (result == HAL_TIMEOUT) {
        return DOOR_BUS_TIMEOUT;
    }
    if (result == HAL_ERROR &&
        (HAL_I2C_GetError(board->door_i2c) & HAL_I2C_ERROR_AF) != 0U) {
        return DOOR_BUS_NACK;
    }
    return DOOR_BUS_IO_ERROR;
}

void board_stm32f1_init(BoardStm32f1 *board,
                        ADC_HandleTypeDef *adc,
                        TIM_HandleTypeDef *pwm_timer,
                        uint32_t pwm_channel,
                        I2C_HandleTypeDef *door_i2c) {
    if (board == NULL) {
        return;
    }
    board->adc = adc;
    board->pwm_timer = pwm_timer;
    board->pwm_channel = pwm_channel;
    board->door_i2c = door_i2c;
}

BoardIo board_stm32f1_io(BoardStm32f1 *board) {
    const BoardIo io = {
        .read_button_level = stm32_read_button,
        .read_adc_raw = stm32_read_adc,
        .write_led_level = stm32_write_led,
        .write_drive_permille = stm32_write_drive,
        .context = board,
    };
    return io;
}

DoorBus board_stm32f1_door_bus(BoardStm32f1 *board) {
    const DoorBus bus = {.read = stm32_door_read, .write = stm32_door_write, .context = board};
    return bus;
}

#endif
