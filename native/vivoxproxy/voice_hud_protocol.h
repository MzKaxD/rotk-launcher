#ifndef ROTK_VOICE_HUD_PROTOCOL_H
#define ROTK_VOICE_HUD_PROTOCOL_H

#include <stdint.h>

#define ROTK_VOICE_HUD_PROTOCOL_VERSION 1U
#define ROTK_VOICE_HUD_MAGIC UINT32_C(0x48535652)
#define ROTK_VOICE_HUD_HEADER_BYTES 16U
#define ROTK_VOICE_HUD_MAX_PROFILE_BYTES 96U
#define ROTK_VOICE_HUD_MAX_NAME_BYTES 256U
#define ROTK_VOICE_HUD_MAX_FRAME_BYTES \
    (ROTK_VOICE_HUD_HEADER_BYTES + ROTK_VOICE_HUD_MAX_PROFILE_BYTES + \
     ROTK_VOICE_HUD_MAX_NAME_BYTES)

#define ROTK_VOICE_HUD_OPCODE_SPEAKING 1U
#define ROTK_VOICE_HUD_OPCODE_RESET 2U
#define ROTK_VOICE_HUD_OPCODE_HEARTBEAT 3U
#define ROTK_VOICE_HUD_FLAG_ACTIVE 0x01U

/*
 * Byte-stream wire header. Every integer is little-endian. Keeping this as
 * bytes instead of casting the receive buffer avoids unaligned access and
 * makes the protocol independent from compiler packing.
 *
 *   0x00 u32 magic ("RVSH")
 *   0x04 u16 version
 *   0x06 u8  opcode
 *   0x07 u8  flags
 *   0x08 u32 sequence
 *   0x0c u16 profile byte length
 *   0x0e u16 native participant-id byte length
 *   0x10 profile UTF-8 followed by the BR1315 character id in hexadecimal
 *
 * RESET and HEARTBEAT frames have zero-length profile and participant id.
 */

#endif
