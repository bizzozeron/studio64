// Camera wall collision: always on (studio_camcollide_set can still switch it from the page if ever needed).
//
// The game's camera (Lakitu) goes where its mode puts it and happily ends up inside walls. This
// post-pass, run on the final view each frame (camera.c, update_graph_node_camera), has two states:
//
//   free      the game's own camera, untouched. It swings around things freely: something standing
//             between it and Mario (a tombstone, a tree) changes nothing.
//   zoomed    entered when the camera itself strikes geometry (its path goes into a wall, or the wall
//             is right at it: Mario walks deep into a room and the camera behind him meets the back
//             wall). It moves in front of what it struck at once. Zoomed, it behaves the same way:
//             a new thing between it and Mario is ignored until the camera runs into that too, and
//             then it zooms in deeper. With nothing at or behind it, it eases back out (stopping in
//             front of the next thing it meets) and is free again.
//
// Only the camera's distance along the Mario -> camera line changes, never its direction, so the
// game's camera modes, C-buttons and turning all work as before. Surfaces count when they face the
// ray (one-sided shells can be seen out of), and not the invisible camera-only ones (no-cam-collision
// flags and types, intangible, camera boundaries). Off in cutscenes, first person (C-up) and the
// editor camera; side-scroller / top-down area cameras (flow.c) and vehicles bypass it.
#include <ultra64.h>
#include <math.h>

#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include "sm64.h"
#include "types.h"
#include "macros.h"
#include "surface_terrains.h"
#include "game/camera.h"
#include "game/level_update.h"
#include "game/object_list_processor.h"
#include "engine/math_util.h"
#include "engine/surface_collision.h"
#include "engine/surface_load.h"


static s32 sOn = TRUE;
static f32 sMargin = 45.0f;   // stays this far in front of what it hit
static f32 sMinDist = 70.0f;  // never closer to Mario's head than this
static f32 sEase = 0.12f;     // share of the way back out per frame (0.12: about a second at 30 fps)
static f32 sHead = 120.0f;    // the ray starts this far above Mario's feet
static f32 sTouch = 90.0f;    // something this close to the camera on the ray counts as the camera touching it

static s32 sState;            // 0 free, 1 collided
static f32 sDist = -1.0f;     // current distance from the head (-1: take the game's)
static f32 sLastPivot[3];
static f32 sPrevCam[3];       // where the camera was last frame
static s32 sHavePrev;

EMSCRIPTEN_KEEPALIVE
void studio_camcollide_set(s32 on, f32 margin, f32 ease) {
    sOn = on != 0;
    if (margin >= 0.0f) {
        sMargin = margin;
    }
    if (ease > 0.0f) {
        sEase = ease > 1.0f ? 1.0f : ease;
    }
    sDist = -1.0f;
    sState = 0;
}

// 0 free, 1 collided (for the page's debug info)
EMSCRIPTEN_KEEPALIVE
s32 studio_camcollide_state(void) {
    return sOn ? sState : -1;
}

static s32 blocks_camera(struct Surface *s) {
    if (s->flags & SURFACE_FLAG_NO_CAM_COLLISION) {
        return FALSE;
    }
    switch (s->type) {
        case SURFACE_INTANGIBLE:
        case SURFACE_CAMERA_BOUNDARY:
        case SURFACE_NO_CAM_COLLISION:
        case SURFACE_NO_CAM_COLLISION_77:
        case SURFACE_NO_CAM_COL_VERY_SLIPPERY:
        case SURFACE_NO_CAM_COL_SLIPPERY:
            return FALSE;
    }
    return TRUE;
}

// One triangle against the ray o + d*t: front-facing hits with 0.5 < t < *best lower *best.
static void test_surface(struct Surface *s, f32 *o, f32 *d, f32 *box, f32 *best) {
    f32 e1x, e1y, e1z, e2x, e2y, e2z, px, py, pz, det, inv, tx, ty, tz, u, v, qx, qy, qz, t;
    s16 *a = s->vertex1, *b = s->vertex2, *c = s->vertex3;
    // quick reject: the triangle's box against the segment's box
    if ((a[0] < box[0] && b[0] < box[0] && c[0] < box[0]) || (a[0] > box[1] && b[0] > box[1] && c[0] > box[1])
        || (a[2] < box[4] && b[2] < box[4] && c[2] < box[4]) || (a[2] > box[5] && b[2] > box[5] && c[2] > box[5])
        || (a[1] < box[2] && b[1] < box[2] && c[1] < box[2]) || (a[1] > box[3] && b[1] > box[3] && c[1] > box[3])) {
        return;
    }
    // facing the ray only (seen from the camera's side)
    if (s->normal.x * d[0] + s->normal.y * d[1] + s->normal.z * d[2] >= 0.0f || !blocks_camera(s)) {
        return;
    }
    e1x = b[0] - a[0]; e1y = b[1] - a[1]; e1z = b[2] - a[2];
    e2x = c[0] - a[0]; e2y = c[1] - a[1]; e2z = c[2] - a[2];
    px = d[1] * e2z - d[2] * e2y; py = d[2] * e2x - d[0] * e2z; pz = d[0] * e2y - d[1] * e2x;
    det = e1x * px + e1y * py + e1z * pz;
    if (det > -1e-6f && det < 1e-6f) return;
    inv = 1.0f / det;
    tx = o[0] - a[0]; ty = o[1] - a[1]; tz = o[2] - a[2];
    u = (tx * px + ty * py + tz * pz) * inv;
    if (u < 0.0f || u > 1.0f) return;
    qx = ty * e1z - tz * e1y; qy = tz * e1x - tx * e1z; qz = tx * e1y - ty * e1x;
    v = (d[0] * qx + d[1] * qy + d[2] * qz) * inv;
    if (v < 0.0f || u + v > 1.0f) return;
    t = (e2x * qx + e2y * qy + e2z * qz) * inv;
    if (t > 0.5f && t < *best) {
        *best = t;
    }
}

static s32 cell_of(f32 coord) {
    s32 i = (s32) ((coord + LEVEL_BOUNDARY_MAX) / CELL_SIZE);
    return i < 0 ? 0 : i > NUM_CELLS_INDEX ? NUM_CELLS_INDEX : i;
}

// Nearest front-facing hit of the ray o + d*t (d unit length) for 0 < t < maxT, or maxT. Only the
// collision grid's cells under the ray are looked at (the level's and the moving objects' surfaces):
// a few hundred triangles instead of all of them, which matters on the N64.
static f32 cast(f32 *o, f32 *d, f32 maxT) {
    f32 best = maxT, box[6];
    f32 ex = o[0] + d[0] * maxT, ey = o[1] + d[1] * maxT, ez = o[2] + d[2] * maxT;
    s32 cx, cz, cx0, cx1, cz0, cz1, list;

    box[0] = (o[0] < ex ? o[0] : ex) - 2; box[1] = (o[0] > ex ? o[0] : ex) + 2;
    box[2] = (o[1] < ey ? o[1] : ey) - 2; box[3] = (o[1] > ey ? o[1] : ey) + 2;
    box[4] = (o[2] < ez ? o[2] : ez) - 2; box[5] = (o[2] > ez ? o[2] : ez) + 2;
    cx0 = cell_of(box[0] - 64); cx1 = cell_of(box[1] + 64);
    cz0 = cell_of(box[4] - 64); cz1 = cell_of(box[5] + 64);
    for (cz = cz0; cz <= cz1; cz++) {
        for (cx = cx0; cx <= cx1; cx++) {
            for (list = 0; list < 3; list++) {
                struct SurfaceNode *n;
                for (n = gStaticSurfacePartition[cz][cx][list].next; n != NULL; n = n->next) {
                    test_surface(n->surface, o, d, box, &best);
                }
                for (n = gDynamicSurfacePartition[cz][cx][list].next; n != NULL; n = n->next) {
                    test_surface(n->surface, o, d, box, &best);
                }
            }
        }
    }
    return best;
}

// The first hit beyond distance t0 along the ray (absolute distance), or maxT.
static f32 cast_from(f32 *o, f32 *d, f32 t0, f32 maxT) {
    f32 p[3];
    if (t0 <= 0.0f) {
        return cast(o, d, maxT);
    }
    if (t0 >= maxT) {
        return maxT;
    }
    p[0] = o[0] + d[0] * t0;
    p[1] = o[1] + d[1] * t0;
    p[2] = o[2] + d[2] * t0;
    return t0 + cast(p, d, maxT - t0);
}

// Did the camera's own path since last frame go into a surface?
static s32 path_struck(f32 *from, f32 *to) {
    f32 mv[3], len;
    mv[0] = to[0] - from[0];
    mv[1] = to[1] - from[1];
    mv[2] = to[2] - from[2];
    len = sqrtf(mv[0] * mv[0] + mv[1] * mv[1] + mv[2] * mv[2]);
    if (len < 0.5f || len > 600.0f) {
        return FALSE;
    }
    mv[0] /= len;
    mv[1] /= len;
    mv[2] /= len;
    return cast(from, mv, len + sMargin) < len + sMargin;
}

// camera.c: the final camera position (pos) for this frame, focus as the game set it.
//
// One rule for both states: the camera sits at distance sDist from Mario's head along the game's
// camera line (sDist = full: free). Only what is AT the camera or beyond it counts: the ray is cast
// from just in front of the camera (sDist - sTouch) outward. Something between Mario and the camera
// (a tombstone, a post) is ignored, free or zoomed, until the camera itself runs into it; then the
// camera moves in front of it at once (a deeper zoom). With nothing at or behind it, it eases back
// out, and stops in front of the next thing it meets on the way.
void studio_camera_collide(f32 *pos, UNUSED f32 *focus) {
    struct MarioState *m = gMarioState;
    f32 pivot[3], dir[3], cam[3], full, from, hit, target, jump;
    s32 fresh;

    if (!sOn || m == NULL || gMarioObject == NULL || gCamera == NULL || gCamera->cutscene != 0
        || (gCameraMovementFlags & CAM_MOVE_C_UP_MODE) || gCamera->mode == CAMERA_MODE_C_UP) {
        sDist = -1.0f;
        sState = 0;
        sHavePrev = FALSE;
        return;
    }
    pivot[0] = m->pos[0];
    pivot[1] = m->pos[1] + sHead;
    pivot[2] = m->pos[2];
    dir[0] = pos[0] - pivot[0];
    dir[1] = pos[1] - pivot[1];
    dir[2] = pos[2] - pivot[2];
    full = sqrtf(dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]);
    if (full < 1.0f) {
        return;
    }
    dir[0] /= full;
    dir[1] /= full;
    dir[2] /= full;

    // a teleport, warp or respawn: start over from what the game wants
    jump = fabsf(pivot[0] - sLastPivot[0]) + fabsf(pivot[1] - sLastPivot[1]) + fabsf(pivot[2] - sLastPivot[2]);
    vec3f_copy(sLastPivot, pivot);
    fresh = !sHavePrev || jump > 600.0f;
    if (fresh || sDist < 0.0f || sDist > full) {
        sDist = full; // (the game's camera came closer by itself: follow it)
    }

    // where the camera would be this frame at its current distance
    cam[0] = pivot[0] + dir[0] * sDist;
    cam[1] = pivot[1] + dir[1] * sDist;
    cam[2] = pivot[2] + dir[2] * sDist;

    // what is at the camera or beyond it (a margin past the game's spot, to stop in front of a wall);
    // just appeared (teleport): it may be inside a wall, so the far part of the ray counts
    from = fresh ? full * 0.6f : sDist - sTouch;
    if (!fresh && sHavePrev && path_struck(sPrevCam, cam)) {
        // its own movement went through something (now just in front of it): look a bit nearer Mario
        from = sDist - 4.0f * sTouch;
    }
    hit = cast_from(pivot, dir, from, full + sMargin);

    if (hit < full + sMargin) {
        target = hit - sMargin;
        if (target < sMinDist) {
            target = sMinDist < hit ? sMinDist : hit * 0.5f;
        }
    } else {
        target = full;
    }
    if (target <= sDist) {
        sDist = target; // in at once: never look through what it struck
    } else {
        sDist += (target - sDist) * sEase; // out smoothly, stopping at the next thing it meets
        if (target - sDist < 4.0f) {
            sDist = target;
        }
    }
    sHavePrev = TRUE;
    if (sDist >= full - 4.0f) {
        sDist = full;
        sState = 0;
        vec3f_copy(sPrevCam, pos);
        return; // free: the game's camera exactly
    }
    sState = 1;
    pos[0] = pivot[0] + dir[0] * sDist;
    pos[1] = pivot[1] + dir[1] * sDist;
    pos[2] = pivot[2] + dir[2] * sDist;
    vec3f_copy(sPrevCam, pos);
}
