#include "drive_output.h"
#include "test_support.h"

int main(void) {
    DriveOutput drive;
    drive_output_init(&drive, 100U);
    drive_output_set_target(&drive, -5);
    TEST_ASSERT_EQ(0, drive.target_permille);
    drive_output_set_target(&drive, 1200);
    TEST_ASSERT_EQ(1000, drive.target_permille);
    TEST_ASSERT_EQ(100, drive_output_update(&drive));
    for (int i = 0; i < 9; ++i) {
        (void)drive_output_update(&drive);
    }
    TEST_ASSERT_EQ(1000, drive.current_permille);
    drive_output_set_target(&drive, 650);
    TEST_ASSERT_EQ(900, drive_output_update(&drive));
    TEST_ASSERT_EQ(800, drive_output_update(&drive));
    TEST_ASSERT_EQ(700, drive_output_update(&drive));
    TEST_ASSERT_EQ(650, drive_output_update(&drive));
    drive_output_stop_immediately(&drive);
    TEST_ASSERT_EQ(0, drive.current_permille);
    TEST_ASSERT_EQ(0, drive.target_permille);
    TEST_PASS();
}
