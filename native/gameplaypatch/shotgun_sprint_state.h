#ifndef ROTK_SHOTGUN_SPRINT_STATE_H
#define ROTK_SHOTGUN_SPRINT_STATE_H

#include <stdint.h>

/*
 * Platform-independent state machine used by the runtime hook.
 *
 * H1Z1 consumes sprint as an edge. Keeping Shift physically held across a
 * shot leaves the controller at a continuous 1, so the game never observes a
 * fresh press. On the first positive weapon-action timer frame we emit one 0;
 * on the following frame we emit 1 and restore the controller sprint latch.
 */
#define SHOTGUN_SPRINT_SHIFT_SEEN 0x01U
#define SHOTGUN_SPRINT_TIMER_SEEN 0x02U
#define SHOTGUN_SPRINT_EDGE_PENDING 0x04U

typedef struct shotgun_sprint_step_result {
    uint8_t next_state;
    uint8_t sprint_requested;
    uint8_t rearm_controller;
} shotgun_sprint_step_result;

static shotgun_sprint_step_result shotgun_sprint_step(
    uint8_t state,
    int shift_down,
    int timer_positive) {
    shotgun_sprint_step_result result;

    result.next_state = 0U;
    result.sprint_requested = 0U;
    result.rearm_controller = 0U;
    if (!shift_down) {
        return result;
    }

    if ((state & SHOTGUN_SPRINT_EDGE_PENDING) != 0U) {
        result.next_state = SHOTGUN_SPRINT_SHIFT_SEEN;
        if (timer_positive) {
            result.next_state |= SHOTGUN_SPRINT_TIMER_SEEN;
        }
        result.sprint_requested = 1U;
        result.rearm_controller = 1U;
        return result;
    }

    if (!timer_positive) {
        result.next_state = SHOTGUN_SPRINT_SHIFT_SEEN;
        result.sprint_requested = 1U;
        return result;
    }

    if ((state & SHOTGUN_SPRINT_TIMER_SEEN) != 0U ||
        (state & SHOTGUN_SPRINT_SHIFT_SEEN) == 0U) {
        /*
         * Attaching while the timer is already active must not invent a late
         * interruption. A timer already consumed stays at 1 as well.
         */
        result.next_state =
            SHOTGUN_SPRINT_SHIFT_SEEN | SHOTGUN_SPRINT_TIMER_SEEN;
        result.sprint_requested = 1U;
        return result;
    }

    result.next_state =
        SHOTGUN_SPRINT_SHIFT_SEEN |
        SHOTGUN_SPRINT_TIMER_SEEN |
        SHOTGUN_SPRINT_EDGE_PENDING;
    result.sprint_requested = 0U;
    return result;
}

#endif
