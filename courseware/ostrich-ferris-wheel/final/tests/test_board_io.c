#include "board_config.h"
#include "board_io.h"
#include "board_sim.h"
#include "test_support.h"

int main(void) {
    TEST_ASSERT(board_reference_profile_valid());
    TEST_ASSERT_EQ(8000000, board_reference_profile()->system_clock_hz);
    BoardSim sim;
    board_sim_init(&sim);
    const BoardIo io = board_sim_io(&sim);
    TEST_ASSERT(board_io_valid(&io));
    TEST_ASSERT(!board_button_pressed(&io));
    board_sim_set_button_pressed(&sim, true);
    TEST_ASSERT(board_button_pressed(&io));
    board_sim_set_adc_raw(&sim, 2048U);
    uint16_t raw = 0U;
    TEST_ASSERT(board_adc_read(&io, &raw));
    TEST_ASSERT_EQ(2048, raw);

    board_status_led_set(&io, true);
    TEST_ASSERT(board_sim_status_led_on(&sim));
    board_drive_set(&io, 1200U);
    TEST_ASSERT_EQ(BOARD_PWM_MAX_PERMILLE, sim.drive_permille);
    board_outputs_safe(&io);
    TEST_ASSERT_EQ(0, sim.drive_permille);
    TEST_ASSERT(!board_sim_status_led_on(&sim));
    TEST_ASSERT(!board_adc_read(NULL, &raw));
    TEST_ASSERT(!board_adc_read(&io, NULL));
    TEST_ASSERT(!board_button_pressed(NULL));

    BoardIo output_only = {
        .read_button_level = NULL,
        .read_adc_raw = NULL,
        .write_led_level = io.write_led_level,
        .write_drive_permille = io.write_drive_permille,
        .context = &sim,
    };
    sim.drive_permille = 800U;
    board_status_led_set(&output_only, true);
    board_outputs_safe(&output_only);
    TEST_ASSERT_EQ(0, sim.drive_permille);
    TEST_ASSERT(!board_sim_status_led_on(&sim));
    TEST_PASS();
}
