#ifndef FERRIS_BUTTON_H
#define FERRIS_BUTTON_H

#include <stdbool.h>
#include <stdint.h>

typedef enum {
    BUTTON_EVENT_NONE = 0,
    BUTTON_EVENT_PRESS,
    BUTTON_EVENT_RELEASE
} ButtonEvent;

typedef struct {
    bool initialized;
    bool stable_pressed;
    bool candidate_pressed;
    uint32_t candidate_since_ms;
    uint32_t debounce_ms;
} Button;

void button_init(Button *button, bool initial_pressed, uint32_t now_ms, uint32_t debounce_ms);
ButtonEvent button_update(Button *button, bool raw_pressed, uint32_t now_ms);
bool button_is_pressed(const Button *button);

#endif
