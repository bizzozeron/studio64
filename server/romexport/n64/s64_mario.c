// Studio 64: Mario's colours (Assets -> Mario) in the ROM. The same as the web build's
// engine/src/studio/assets.c (studio_mario_color): the light groups of his model, found through his
// display lists, with the cap and the gloves split off into lights of their own (the cap's red is
// the shirt's in the game, the gloves' white is also the wings' and metal Mario's). The colours come
// from the info block: set 0 for every stage, or the stage's own set (gS64Info.marioStageSet by
// level number). They're set whenever an area loads (after segments 3 and 4, common1 and group0:
// Mario and his cap, are in memory), parts a set doesn't change go back to the game's colours, so
// entering a stage always gives Mario that stage's colours. Re-running is harmless, and puts them back
// if the game ever loaded those segments again.
#include <ultra64.h>

#include "sm64.h"
#include "macros.h"
#include "game/memory.h"
#include "game/area.h"
#include "s64_hack.h"

#define PART_OVERALLS 0
#define PART_SHIRT 1
#define PART_GLOVES 2
#define PART_SHOES 3
#define PART_SKIN 4
#define PART_HAIR 5
#define PART_CAP 6
#define PARTS 7

extern const Gfx mario_butt[], mario_left_arm[], mario_left_foot[], mario_face_cap_on_dl[],
    mario_cap_on_eyes_front[], mario_low_poly_face_cap_on_dl[], mario_cap_unused_dl[], mario_right_hand_cap[],
    mario_left_hand_closed[], mario_right_hand_closed[], mario_medium_poly_left_hand_closed[],
    mario_medium_poly_right_hand_closed[], mario_low_poly_left_hand_closed[], mario_low_poly_right_hand_closed[],
    mario_left_hand_open[], mario_right_hand_open[], mario_right_hand_cap_dl[], mario_right_hand_peace[],
    mario_cap_seg3_dl_03022F48[];
extern const Gfx mario_cap_on_eyes_half_closed[], mario_cap_on_eyes_closed[], mario_cap_on_eyes_right[],
    mario_cap_on_eyes_left[], mario_cap_on_eyes_up[], mario_cap_on_eyes_down[], mario_cap_on_eyes_dead[],
    mario_low_poly_cap_on_eyes_front[], mario_low_poly_cap_on_eyes_half_closed[], mario_low_poly_cap_on_eyes_closed[],
    mario_low_poly_cap_on_eyes_right[], mario_low_poly_cap_on_eyes_left[], mario_low_poly_cap_on_eyes_up[],
    mario_low_poly_cap_on_eyes_down[], mario_low_poly_cap_on_eyes_dead[], mario_m_logo_dl[],
    mario_low_poly_mario_m_logo_dl[], mario_right_hand_cap_m_logo_dl[], mario_cap_unused_m_logo_dl[];

static u8 sGloveLights[24] __attribute__((aligned(16)));
// the game's colours (the diffuse of actors/mario and mario_cap's light groups): overalls, shirt,
// gloves, shoes, skin, hair, cap
static const u8 sDefault[PARTS][3] = {
    { 0x00, 0x00, 0xFF }, { 0xFF, 0x00, 0x00 }, { 0xFF, 0xFF, 0xFF }, { 0x72, 0x1C, 0x0E },
    { 0xFE, 0xC1, 0x79 }, { 0x73, 0x06, 0x00 }, { 0xFF, 0x00, 0x00 },
};
static Gfx sLogoDLs[4][4] __attribute__((aligned(16)));

#define OP(g) (((g)->words.w0 >> 24) & 0xFF)
#define ADDR(p) ((u32) (uintptr_t) (p))

// What the RSP is given (a segmented address, or a physical one for segment 0) -> where the CPU reads it
static void *cpu(u32 a) {
    u32 seg = a >> 24;
    if (seg == 0 || seg >= 0x80) {
        return (void *) (uintptr_t) ((a & 0x1FFFFFFF) | 0x80000000);
    }
    return segmented_to_virtual((const void *) (uintptr_t) a);
}
// Our own RAM, as the RSP gets it (segment 0)
#define RSP(p) ((u32) VIRTUAL_TO_PHYSICAL(p))

// The first light group a display list sets (as the RSP sees it: the .a part's address)
static u32 first_light(const Gfx *seg) {
    const Gfx *dl = cpu(ADDR(seg));
    s32 n;
    for (n = 0; n < 400; n++, dl++) {
        if (OP(dl) == G_MOVEMEM) {
            u32 a = dl->words.w1, b = dl[1].words.w1;
            if (OP(&dl[1]) == G_MOVEMEM && b < a) {
                return b; // .l then .a: .a is the start of the group
            }
            return a - 8;
        }
        if (OP(dl) == G_ENDDL) {
            break;
        }
    }
    return 0;
}

// Every use of the lights `from` in dl and the lists it calls -> `to`
static void repoint_lights(u32 dlAddr, u32 from, u32 to, s32 depth) {
    Gfx *g;
    s32 n;
    if (dlAddr == 0 || from == 0 || from == to || depth > 6) {
        return;
    }
    g = cpu(dlAddr);
    for (n = 0; n < 2000; n++, g++) {
        u32 op = OP(g);
        if (op == G_MOVEMEM) {
            if (g->words.w1 == from) {
                g->words.w1 = to;
            } else if (g->words.w1 == from + 8) {
                g->words.w1 = to + 8;
            }
        } else if (op == G_DL) {
            repoint_lights(g->words.w1, from, to, depth + 1);
            if (((g->words.w0 >> 16) & 0xFF) == G_DL_NOPUSH) {
                break;
            }
        } else if (op == G_ENDDL) {
            break;
        }
    }
}

// The M on the cap is drawn before the cap sets its red, so it took the light of what came before it
// (the shirt): each call of it in `parent` goes through a list that sets the cap's light first.
static void logo_lights(const Gfx *parent, const Gfx *logo, s32 k, u32 cap) {
    Gfx *g = cpu(ADDR(parent));
    Gfx *w = sLogoDLs[k];
    s32 n;
    {
        Gfx *p = w;
        gSPLight(p++, cap + 8, 1);
        gSPLight(p++, cap, 2);
        gSPDisplayList(p++, logo);
        gSPEndDisplayList(p++);
    }
    for (n = 0; n < 400 && OP(g) != G_ENDDL; n++, g++) {
        if (OP(g) == G_DL && g->words.w1 == ADDR(logo)) {
            g->words.w1 = RSP(w);
        }
    }
}

static s32 mario_used(void) {
    s32 i;
    if (!s64_info_valid()) {
        return FALSE;
    }
    if (gS64Info.marioSets[0].parts & ((1 << PARTS) - 1)) {
        return TRUE;
    }
    for (i = 0; i < 40; i++) {
        if (gS64Info.marioStageSet[i] != 0) {
            return TRUE;
        }
    }
    return FALSE;
}

static void set_color(u32 lights, const u8 *c) {
    u8 *l = cpu(lights);
    s32 k;
    for (k = 0; k < 3; k++) {
        u8 amb = (u8) ((c[k] * 128) >> 8); // the shadow side: half, as in the game
        l[k] = amb;
        l[4 + k] = amb;
        l[8 + k] = c[k];
        l[12 + k] = c[k];
    }
}

void s64_mario_colors(void) {
    static const Gfx *hands[] = { mario_left_hand_closed, mario_right_hand_closed, mario_medium_poly_left_hand_closed,
                                  mario_medium_poly_right_hand_closed, mario_low_poly_left_hand_closed,
                                  mario_low_poly_right_hand_closed, mario_left_hand_open, mario_right_hand_open,
                                  mario_right_hand_cap_dl, mario_right_hand_peace };
    static const Gfx *eyes[] = { mario_cap_on_eyes_front, mario_cap_on_eyes_half_closed, mario_cap_on_eyes_closed,
                                 mario_cap_on_eyes_right, mario_cap_on_eyes_left, mario_cap_on_eyes_up,
                                 mario_cap_on_eyes_down, mario_cap_on_eyes_dead };
    static const Gfx *low_eyes[] = { mario_low_poly_cap_on_eyes_front, mario_low_poly_cap_on_eyes_half_closed,
                                     mario_low_poly_cap_on_eyes_closed, mario_low_poly_cap_on_eyes_right,
                                     mario_low_poly_cap_on_eyes_left, mario_low_poly_cap_on_eyes_up,
                                     mario_low_poly_cap_on_eyes_down, mario_low_poly_cap_on_eyes_dead };
    static const Gfx *caps[] = { mario_face_cap_on_dl, mario_low_poly_face_cap_on_dl, mario_cap_unused_dl,
                                 mario_right_hand_cap };
    u32 lights[PARTS];
    u32 red, white, cap;
    const struct S64MarioSet *set;
    s32 i, n;

    if (!mario_used()) {
        return; // the game's own Mario
    }
    // only once Mario's model is in memory: the menus load areas too, before segments 3 and 4 hold
    // him (their table entries are 0 then, or someone else's after a game over)
    if ((VIRTUAL_TO_PHYSICAL(get_segment_base_addr(3)) == 0) || (VIRTUAL_TO_PHYSICAL(get_segment_base_addr(4)) == 0)) {
        return;
    }
    {
        const Gfx *butt = cpu(ADDR(mario_butt));
        if (OP(&butt[0]) != G_RDPPIPESYNC || OP(&butt[2]) != G_MOVEMEM || (butt[2].words.w1 >> 24) != 0x04) {
            return;
        }
    }
    n = (gCurrLevelNum >= 0 && gCurrLevelNum < 40) ? gS64Info.marioStageSet[gCurrLevelNum] : 0;
    set = &gS64Info.marioSets[n < 16 ? n : 0];
    for (i = 0; i < PARTS; i++) {
        lights[i] = 0;
    }
    lights[PART_OVERALLS] = first_light(mario_butt);
    lights[PART_SHIRT] = red = first_light(mario_left_arm);
    lights[PART_SHOES] = first_light(mario_left_foot);
    lights[PART_SKIN] = first_light(mario_cap_on_eyes_front);
    lights[PART_CAP] = cap = first_light(mario_cap_seg3_dl_03022F48);
    if ((cap >> 24) != 0x03) {
        cap = lights[PART_CAP] = 0;
    }
    white = first_light(mario_left_hand_closed); // (our glove copy, when this already ran)

    // the cap on his head and in his hand: the cap object's red instead of the shirt's
    if (cap != 0) {
        for (i = 0; i < (s32) ARRAY_COUNT(caps); i++) {
            repoint_lights(ADDR(caps[i]), red, cap, 0);
        }
        for (i = 0; i < 8; i++) {
            logo_lights(eyes[i], mario_m_logo_dl, 0, cap);
            logo_lights(low_eyes[i], mario_low_poly_mario_m_logo_dl, 1, cap);
        }
        logo_lights(mario_right_hand_cap, mario_right_hand_cap_m_logo_dl, 2, cap);
        logo_lights(mario_cap_unused_dl, mario_cap_unused_m_logo_dl, 3, cap);
    }
    // the hair: the cap-on face's group that is neither the shirt's red nor the cap's
    {
        const Gfx *dl = cpu(ADDR(mario_face_cap_on_dl));
        s32 n;
        for (n = 0; n < 400 && OP(dl) != G_ENDDL; n++, dl++) {
            if (OP(dl) == G_MOVEMEM) {
                u32 p = dl->words.w1;
                if (p != red && p != red + 8 && p != cap && p != cap + 8 && lights[PART_HAIR] == 0) {
                    lights[PART_HAIR] = p - 8; // .l comes first in these lists
                }
            }
        }
    }
    // the gloves: a copy of the white
    if (white != 0 && ((white >> 24) == 0x04 || white == RSP(sGloveLights))) {
        if (white != RSP(sGloveLights)) {
            bcopy(cpu(white), sGloveLights, sizeof(sGloveLights));
            for (i = 0; i < (s32) ARRAY_COUNT(hands); i++) {
                repoint_lights(ADDR(hands[i]), white, RSP(sGloveLights), 0);
            }
        }
        lights[PART_GLOVES] = RSP(sGloveLights);
    }

    for (i = 0; i < PARTS; i++) {
        if (i != PART_GLOVES && i != PART_CAP && (lights[i] >> 24) != 0x04) {
            lights[i] = 0; // (not one of Mario's own light groups: leave it alone)
        }
    }
    for (i = 0; i < PARTS; i++) {
        if (lights[i] != 0) {
            set_color(lights[i], (set->parts & (1 << i)) ? set->colors[i] : sDefault[i]);
        }
    }
    osWritebackDCacheAll();
}
