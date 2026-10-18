#include "button.h"

#include "app_time.h"

#include <stddef.h>

void button_init(Button *button, bool initial_pressed, uint32_t now_ms, uint32_t debounce_ms) {
    if (button == NULL) {
        return;
    }
    button->initialized = true;
    button->stable_pressed = initial_pressed;
    button->candidate_pressed = initial_pressed;
    button->candidate_since_ms = now_ms;
    button->debounce_ms = debounce_ms;
}

ButtonEvent button_update(Button *button, bool raw_pressed, uint32_t now_ms) {
    if (button == NULL) {
        return BUTTON_EVENT_NONE;
    }
    if (!button->initialized) {
        button_init(button, raw_pressed, now_ms, button->debounce_ms);
        return BUTTON_EVENT_NONE;
    }
    if (raw_pressed != button->candidate_pressed) {
        button->candidate_pressed = raw_pressed;
        button->candidate_since_ms = now_ms;
        return BUTTON_EVENT_NONE;
    }
    if (button->stable_pressed == button->candidate_pressed ||
        !app_due(now_ms, button->candidate_since_ms, button->debounce_ms)) {
        return BUTTON_EVENT_NONE;
    }
    button->stable_pressed = button->candidate_pressed;
    return button->stable_pressed ? BUTTON_EVENT_PRESS : BUTTON_EVENT_RELEASE;
}

bool button_is_pressed(const Button *button) {
    return button != NULL && button->initialized && button->stable_pressed;
}
