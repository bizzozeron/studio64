// Studio 64: put the game's camera somewhere (the play-test panel's Restore location, testing.js):
// Lakitu at `pos` looking at `focus`, at once (no swoop over from where he was). The camera's mode
// carries on from there: the outward / free-roam modes keep that direction until the stick turns it.
// Not part of exported ROMs.
#include <ultra64.h>

#ifdef TARGET_WEB
#include <emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

#include "sm64.h"
#include "types.h"
#include "game/camera.h"
#include "engine/math_util.h"

EMSCRIPTEN_KEEPALIVE s32 studio_camera_place(f32 px, f32 py, f32 pz, f32 fx, f32 fy, f32 fz) {
    Vec3f pos, focus;
    s16 yaw;
    if (gCamera == NULL) {
        return 0;
    }
    vec3f_set(pos, px, py, pz);
    vec3f_set(focus, fx, fy, fz);
    yaw = calculate_yaw(focus, pos);
    vec3f_copy(gCamera->pos, pos);
    vec3f_copy(gCamera->focus, focus);
    gCamera->yaw = yaw;
    gCamera->nextYaw = yaw;
    vec3f_copy(gLakituState.curPos, pos);
    vec3f_copy(gLakituState.goalPos, pos);
    vec3f_copy(gLakituState.pos, pos);
    vec3f_copy(gLakituState.curFocus, focus);
    vec3f_copy(gLakituState.goalFocus, focus);
    vec3f_copy(gLakituState.focus, focus);
    gLakituState.yaw = yaw;
    gLakituState.nextYaw = yaw;
    gLakituState.oldYaw = yaw;
    return 1;
}

// ---------------------------------------------------------------------------------------------
// Snapshot of Mario and the camera (Store / Restore location): what Mario is doing (his action and
// its timers, speed, facing, animation frame, health, coins, cap) and the whole camera, kept while
// the level is loaded again around him (testing.js restoreLocation), then put back. The level itself
// is the fresh one: coins, enemies and the assets as they are now. What Mario held, rode or hung on
// belongs to the old level: then he's put back standing, falling or swimming instead.

#include <string.h>
#include "game/level_update.h"
#include "game/object_list_processor.h"
#include "engine/graph_node.h"

// the camera's own state besides gCamera and gLakituState: camera.c's globals, which its modes work
// from every frame (the radial mode's angle offset, the 8-direction yaw, Mario / Lakitu cam, zoom,
// C-up pitch, transitions). Without them the mode puts the camera back where it thinks it is.
#define CAM_GLOBALS(X) \
    X(Vec3f, sOldPosition) X(Vec3f, sOldFocus) X(struct TransitionInfo, sModeTransition) \
    X(struct ModeTransitionInfo, sModeInfo) X(s16, sAvoidYawVel) X(s16, sSelectionFlags) \
    X(s16, gCameraMovementFlags) X(s16, sStatusFlags) X(s16, s2ndRotateFlags) X(u16, sCButtonsPressed) \
    X(s16, sAreaYaw) X(s16, sAreaYawChange) X(s16, sLakituDist) X(s16, sLakituPitch) X(f32, sZoomAmount) \
    X(s16, sCSideButtonYaw) X(f32, sZeroZoomDist) X(s16, sCUpCameraPitch) X(s16, sModeOffsetYaw) \
    X(s16, sSpiralStairsYawOffset) X(s16, s8DirModeBaseYaw) X(s16, s8DirModeYawOffset) X(f32, sPanDistance) \
    X(s16, sYawSpeed) X(Vec3f, sFixedModeBasePosition)
#define CAM_EXTERN(T, n) extern T n;
#define CAM_FIELD(T, n) T n;
#define CAM_SAVE(T, n) memcpy(&sSnap.g.n, &n, sizeof(n));
#define CAM_LOAD(T, n) memcpy(&n, &sSnap.g.n, sizeof(n));
CAM_GLOBALS(CAM_EXTERN)

static struct {
    s32 valid;
    struct { CAM_GLOBALS(CAM_FIELD) } g;
    struct MarioState m;
    struct MarioBodyState body;
    struct GraphNodeObject_sub anim;
    Vec3s gfxAngle;
    struct Camera cam;
    struct LakituState lakitu;
} sSnap;

EMSCRIPTEN_KEEPALIVE s32 studio_snap_store(void) {
    struct MarioState *m = gMarioState;
    if (m == NULL || gMarioObject == NULL || gCamera == NULL) {
        sSnap.valid = FALSE;
        return 0;
    }
    sSnap.m = *m;
    if (m->marioBodyState != NULL) sSnap.body = *m->marioBodyState;
    sSnap.anim = gMarioObject->header.gfx.unk38;
    vec3s_copy(sSnap.gfxAngle, gMarioObject->header.gfx.angle);
    sSnap.cam = *gCamera;
    sSnap.lakitu = gLakituState;
    CAM_GLOBALS(CAM_SAVE)
    sSnap.valid = TRUE;
    return 1;
}

// what is safe to carry over into a reloaded level
static u32 safe_action(const struct MarioState *s) {
    u32 a = s->action;
    u32 group = a & ACT_GROUP_MASK;
    s32 ok = (group == ACT_GROUP_STATIONARY || group == ACT_GROUP_MOVING || group == ACT_GROUP_AIRBORNE || group == ACT_GROUP_SUBMERGED)
          && !(a & ACT_FLAG_RIDING_SHELL) && s->heldObj == NULL && s->usedObj == NULL && s->riddenObj == NULL;
    if (ok) return a;
    if (a & ACT_FLAG_SWIMMING) return ACT_WATER_IDLE;
    if (a & ACT_FLAG_AIR) return ACT_FREEFALL;
    return ACT_IDLE;
}

// with_camera: put the camera back too
EMSCRIPTEN_KEEPALIVE s32 studio_snap_restore(s32 with_camera) {
    struct MarioState *m = gMarioState;
    const struct MarioState *s = &sSnap.m;
    u32 action;
    if (!sSnap.valid || m == NULL || gMarioObject == NULL) {
        return 0;
    }
    action = safe_action(s);
    {
        extern struct Object *gMarioPlatform;
        gMarioPlatform = NULL;
        gMarioObject->platform = NULL;
    }
    m->interactObj = m->heldObj = m->usedObj = m->riddenObj = NULL;
    m->flags = s->flags;
    m->action = action;
    m->prevAction = s->prevAction;
    m->actionState = action == s->action ? s->actionState : 0;
    m->actionTimer = action == s->action ? s->actionTimer : 0;
    m->actionArg = action == s->action ? s->actionArg : 0;
    m->invincTimer = s->invincTimer;
    m->framesSinceA = s->framesSinceA;
    m->framesSinceB = s->framesSinceB;
    m->wallKickTimer = s->wallKickTimer;
    m->doubleJumpTimer = s->doubleJumpTimer;
    vec3s_copy(m->faceAngle, s->faceAngle);
    vec3s_copy(m->angleVel, s->angleVel);
    m->slideYaw = s->slideYaw;
    m->twirlYaw = s->twirlYaw;
    vec3f_copy(m->pos, s->pos);
    vec3f_copy(m->vel, s->vel);
    m->forwardVel = s->forwardVel;
    m->slideVelX = s->slideVelX;
    m->slideVelZ = s->slideVelZ;
    m->numCoins = s->numCoins;
    m->health = s->health;
    m->hurtCounter = s->hurtCounter;
    m->healCounter = s->healCounter;
    m->squishTimer = s->squishTimer;
    m->capTimer = s->capTimer;
    m->peakHeight = s->peakHeight;
    m->quicksandDepth = s->quicksandDepth;
    gHudDisplay.coins = m->numCoins;
    if (m->marioBodyState != NULL) {
        *m->marioBodyState = sSnap.body;
        m->marioBodyState->action = action;
    }
    // the object: where he is, which way he faces, the frame of his animation
    gMarioObject->oPosX = m->pos[0];
    gMarioObject->oPosY = m->pos[1];
    gMarioObject->oPosZ = m->pos[2];
    vec3f_copy(gMarioObject->header.gfx.pos, m->pos);
    vec3s_copy(gMarioObject->header.gfx.angle, sSnap.gfxAngle);
    if (action == s->action) {
        gMarioObject->header.gfx.unk38 = sSnap.anim;
    }
    if (with_camera && gCamera != NULL) {
        *gCamera = sSnap.cam;
        gLakituState = sSnap.lakitu;
        CAM_GLOBALS(CAM_LOAD)
    }
    return action == s->action ? 1 : 2; // 2: put back in a plainer action
}
