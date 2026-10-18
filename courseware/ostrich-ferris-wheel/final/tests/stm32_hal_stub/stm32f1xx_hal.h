#ifndef FERRIS_STM32F1XX_HAL_STUB_H
#define FERRIS_STM32F1XX_HAL_STUB_H

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    HAL_OK = 0,
    HAL_ERROR,
    HAL_BUSY,
    HAL_TIMEOUT
} HAL_StatusTypeDef;

typedef enum {
    GPIO_PIN_RESET = 0,
    GPIO_PIN_SET
} GPIO_PinState;

typedef struct {
    GPIO_PinState input[16];
    GPIO_PinState output[16];
} GPIO_TypeDef;

typedef struct {
    HAL_StatusTypeDef start_result;
    HAL_StatusTypeDef poll_result;
    uint32_t value;
} ADC_HandleTypeDef;

typedef struct {
    uint32_t autoreload;
    uint32_t compare;
    uint32_t irq_count;
    HAL_StatusTypeDef pwm_start_result;
    HAL_StatusTypeDef base_start_result;
    uint32_t pwm_start_count;
    uint32_t base_start_count;
} TIM_HandleTypeDef;

typedef struct {
    HAL_StatusTypeDef result;
    uint32_t error;
    uint8_t response[2];
    uint16_t last_address;
    uint16_t last_memory_address;
} I2C_HandleTypeDef;

typedef struct {
    HAL_StatusTypeDef receive_result;
    HAL_StatusTypeDef transmit_result;
    uint8_t *receive_buffer;
    uint16_t receive_size;
    uint32_t irq_count;
    uint8_t transmitted[1024];
    uint16_t transmitted_length;
} UART_HandleTypeDef;

typedef struct {
    HAL_StatusTypeDef refresh_result;
    uint32_t refresh_count;
} IWDG_HandleTypeDef;

extern GPIO_TypeDef ferris_stub_gpio_b;
extern GPIO_TypeDef ferris_stub_gpio_c;
extern uint32_t ferris_stub_tick_count;
extern uint32_t ferris_stub_systick_irq_count;
extern bool ferris_stub_irq_disabled;
extern uint32_t ferris_stub_primask;
extern uint32_t ferris_stub_disable_irq_count;
extern uint32_t ferris_stub_set_primask_count;

#define GPIOB (&ferris_stub_gpio_b)
#define GPIOC (&ferris_stub_gpio_c)
#define GPIO_PIN_12 UINT16_C(0x1000)
#define GPIO_PIN_13 UINT16_C(0x2000)
#define TIM_CHANNEL_1 UINT32_C(0)
#define I2C_MEMADD_SIZE_8BIT UINT16_C(1)
#define HAL_I2C_ERROR_AF UINT32_C(0x00000004)
#define __disable_irq() ferris_stub_disable_irq()
#define __get_PRIMASK() ferris_stub_get_primask()
#define __set_PRIMASK(value) ferris_stub_set_primask(value)
#define __NOP() ferris_stub_nop()

#define __HAL_TIM_GET_AUTORELOAD(timer) ((timer)->autoreload)
#define __HAL_TIM_SET_COMPARE(timer, channel, value) \
    do {                                                   \
        (void)(channel);                                   \
        (timer)->compare = (value);                        \
    } while (0)

GPIO_PinState HAL_GPIO_ReadPin(GPIO_TypeDef *port, uint16_t pin);
void HAL_GPIO_WritePin(GPIO_TypeDef *port, uint16_t pin, GPIO_PinState state);
HAL_StatusTypeDef HAL_ADC_Start(ADC_HandleTypeDef *adc);
HAL_StatusTypeDef HAL_ADC_PollForConversion(ADC_HandleTypeDef *adc, uint32_t timeout_ms);
uint32_t HAL_ADC_GetValue(ADC_HandleTypeDef *adc);
HAL_StatusTypeDef HAL_ADC_Stop(ADC_HandleTypeDef *adc);
HAL_StatusTypeDef HAL_I2C_Mem_Read(I2C_HandleTypeDef *i2c,
                                  uint16_t device_address,
                                  uint16_t memory_address,
                                  uint16_t memory_address_size,
                                  uint8_t *output,
                                  uint16_t size,
                                  uint32_t timeout_ms);
HAL_StatusTypeDef HAL_I2C_Mem_Write(I2C_HandleTypeDef *i2c,
                                   uint16_t device_address,
                                   uint16_t memory_address,
                                   uint16_t memory_address_size,
                                   uint8_t *data,
                                   uint16_t size,
                                   uint32_t timeout_ms);
uint32_t HAL_I2C_GetError(I2C_HandleTypeDef *i2c);
HAL_StatusTypeDef HAL_UART_Receive_IT(UART_HandleTypeDef *uart,
                                    uint8_t *buffer,
                                    uint16_t size);
HAL_StatusTypeDef HAL_UART_Transmit(UART_HandleTypeDef *uart,
                                   uint8_t *data,
                                   uint16_t size,
                                   uint32_t timeout_ms);
HAL_StatusTypeDef HAL_TIM_PWM_Start(TIM_HandleTypeDef *timer, uint32_t channel);
HAL_StatusTypeDef HAL_TIM_Base_Start_IT(TIM_HandleTypeDef *timer);
HAL_StatusTypeDef HAL_IWDG_Refresh(IWDG_HandleTypeDef *watchdog);
void HAL_TIM_IRQHandler(TIM_HandleTypeDef *timer);
void HAL_UART_IRQHandler(UART_HandleTypeDef *uart);
void HAL_IncTick(void);
void HAL_SYSTICK_IRQHandler(void);
void ferris_stub_disable_irq(void);
uint32_t ferris_stub_get_primask(void);
void ferris_stub_set_primask(uint32_t value);
void ferris_stub_nop(void);

void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *timer);
void HAL_UART_RxCpltCallback(UART_HandleTypeDef *uart);
void HAL_UART_ErrorCallback(UART_HandleTypeDef *uart);

#endif
