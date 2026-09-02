#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>

#include "../shotgun_sprint_state.h"

#define CHECK(condition)                                                       \
    do {                                                                       \
        if (!(condition)) {                                                    \
            fprintf(                                                          \
                stderr,                                                       \
                "check failed at %s:%d: %s\n",                              \
                __FILE__,                                                     \
                __LINE__,                                                     \
                #condition);                                                  \
            exit(1);                                                          \
        }                                                                      \
    } while (0)

static shotgun_sprint_step_result step(
    uint8_t state,
    int shift_down,
    int timer_positive) {
    return shotgun_sprint_step(state, shift_down, timer_positive);
}

static void check_result(
    shotgun_sprint_step_result result,
    uint8_t state,
    uint8_t sprint,
    uint8_t rearm) {
    CHECK(result.next_state == state);
    CHECK(result.sprint_requested == sprint);
    CHECK(result.rearm_controller == rearm);
}

static void test_held_shift_generates_one_true_edge(void) {
    shotgun_sprint_step_result result = step(0U, 1, 0);
    check_result(result, SHOTGUN_SPRINT_SHIFT_SEEN, 1U, 0U);

    result = step(result.next_state, 1, 1);
    check_result(
        result,
        SHOTGUN_SPRINT_SHIFT_SEEN |
            SHOTGUN_SPRINT_TIMER_SEEN |
            SHOTGUN_SPRINT_EDGE_PENDING,
        0U,
        0U);

    result = step(result.next_state, 1, 1);
    check_result(
        result,
        SHOTGUN_SPRINT_SHIFT_SEEN | SHOTGUN_SPRINT_TIMER_SEEN,
        1U,
        1U);

    result = step(result.next_state, 1, 1);
    check_result(
        result,
        SHOTGUN_SPRINT_SHIFT_SEEN | SHOTGUN_SPRINT_TIMER_SEEN,
        1U,
        0U);

    result = step(result.next_state, 1, 0);
    check_result(result, SHOTGUN_SPRINT_SHIFT_SEEN, 1U, 0U);

    result = step(result.next_state, 1, 1);
    CHECK(result.sprint_requested == 0U);
    result = step(result.next_state, 1, 1);
    check_result(
        result,
        SHOTGUN_SPRINT_SHIFT_SEEN | SHOTGUN_SPRINT_TIMER_SEEN,
        1U,
        1U);
}

static void test_release_resets_every_state(void) {
    uint8_t state;
    for (state = 0U; state < 8U; ++state) {
        check_result(step(state, 0, 0), 0U, 0U, 0U);
        check_result(step(state, 0, 1), 0U, 0U, 0U);
    }
}

static void test_attach_during_active_timer_does_not_interrupt(void) {
    check_result(
        step(0U, 1, 1),
        SHOTGUN_SPRINT_SHIFT_SEEN | SHOTGUN_SPRINT_TIMER_SEEN,
        1U,
        0U);
}

static void test_pending_edge_completes_if_timer_expires(void) {
    check_result(
        step(
            SHOTGUN_SPRINT_SHIFT_SEEN |
                SHOTGUN_SPRINT_TIMER_SEEN |
                SHOTGUN_SPRINT_EDGE_PENDING,
            1,
            0),
        SHOTGUN_SPRINT_SHIFT_SEEN,
        1U,
        1U);
}

int main(void) {
    test_held_shift_generates_one_true_edge();
    test_release_resets_every_state();
    test_attach_during_active_timer_does_not_interrupt();
    test_pending_edge_completes_if_timer_expires();
    puts("shotgun sprint state tests passed");
    return 0;
}
