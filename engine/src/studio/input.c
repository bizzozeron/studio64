// Studio 64: the controls of the game in the browser (the page's Input panel, web/js/input_ui.js).
// sm64ex keeps every N64 button's bindings in configKey* (configfile.c): up to MAX_BINDS virtual keys
// each, a keyboard scancode (0x0000-0x0FFF) or an SDL game controller button (0x1000 + button,
// 0x101A / 0x101B the triggers). The page reads and changes them here; the backends (keyboard and SDL2
// controller) take them over at once (controller_reconfigure). The page keeps the player's choice and
// sets it again after every start, so the engine's own config file does not matter.
// Not part of exported ROMs: a real N64 has its own controller.
#include <ultra64.h>

#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include "pc/configfile.h"
#include "pc/controller/controller_api.h"

// in the order of the page's list (input_ui.js ACTIONS)
static unsigned int *binds_of(s32 action) {
    switch (action) {
        case 0: return configKeyA;
        case 1: return configKeyB;
        case 2: return configKeyZ;
        case 3: return configKeyStart;
        case 4: return configKeyL;
        case 5: return configKeyR;
        case 6: return configKeyCUp;
        case 7: return configKeyCDown;
        case 8: return configKeyCLeft;
        case 9: return configKeyCRight;
        case 10: return configKeyStickUp;
        case 11: return configKeyStickDown;
        case 12: return configKeyStickLeft;
        case 13: return configKeyStickRight;
    }
    return NULL;
}

EMSCRIPTEN_KEEPALIVE s32 studio_input_get(s32 action, s32 slot) {
    unsigned int *b = binds_of(action);
    if (b == NULL || slot < 0 || slot >= MAX_BINDS) return -1;
    return (s32) b[slot];
}

// vk: the virtual key, or VK_INVALID (0xFFFF) for none. apply: take the bindings over now (the page
// sets a whole list with apply = 0, then once 1)
EMSCRIPTEN_KEEPALIVE s32 studio_input_set(s32 action, s32 slot, s32 vk, s32 apply) {
    unsigned int *b = binds_of(action);
    if (b == NULL || slot < 0 || slot >= MAX_BINDS) return 0;
    b[slot] = (unsigned int) (vk & 0xFFFF);
    if (apply) controller_reconfigure();
    return 1;
}

EMSCRIPTEN_KEEPALIVE void studio_input_apply(void) {
    controller_reconfigure();
}
