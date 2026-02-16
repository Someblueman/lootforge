# Plan A: Procedural Animation (Static Sprites Made Alive)

## Context

The game currently renders every entity as a single static PNG that slides across the screen. There are no walk cycles, attack poses, or animation frames. The art assets are good (consistent painterly top-down style) but the rendering makes it look like a flash game because nothing moves organically.

This plan makes the existing static sprites feel alive through procedural transforms -- rotation, scale manipulation, overlay effects, and sprite flipping. No new art required.

## Prerequisites: Revert Breaking Changes

Before any of this, we must undo the damage from the last round:

**Remove from `SpriteAnimator.ts`:**
- `idleBreathing()` uses absolute `scaleX: 1.03` which overwrites `setDisplaySize`. Either rewrite to use Phaser's relative syntax (`scaleX: '+=0.03'`) or remove entirely.
- `enemyBob()` uses absolute `scaleY: { from: 0.95, to: 1.05 }` -- same problem.

**Remove from `GameScene.ts create()`:**
- Camera `setZoom(1.15)` -- at this viewport size, 15% zoom loses too much context
- Dark overlay rectangle (alpha 0.35 covers everything)
- Point lights (player light, torch lights)
- `idleBreathing()` and `enemyBob()` calls

**Keep from last round:**
- Bug fixes: cooldown ownership, boss double-fire removal, canvas focus, slime splitting, door rendering
- Shadows (ellipses under sprites) -- but verify they render at correct position after revert
- Y-sort depth ordering
- Sprite origins at feet (0.5, 0.85)
- hitFlash on enemy damage
- HUD icon sprites

**Verification checkpoint:** Open browser, take screenshot. Player should be ~96px, enemies visible, room background fills screen, WASD moves player visibly.

---

## Changes (in order, one at a time with screenshot verification)

### A1. Melee Slash Sprite

**File:** `GameScene.ts`

When `pcResult.meleeAttack` is true, spawn the `effect.hit_slash` asset as a temporary sprite:
- Position: offset from player in facing direction (~40px out)
- Rotation: `state.player.facingAngle`
- Size: `setDisplaySize(80, 80)`
- Duration: 200ms, then `destroy()`
- Depth: `DEPTH.effects`

The `effect_hit_slash.png` already exists and looks great -- orange crescent sword arc.

```ts
const visual = this.assetRegistry.requireVisual(DEMO_ASSET_IDS.effectHitSlash);
const slashSprite = this.add.sprite(
  this.state.player.x + Math.cos(this.state.player.facingAngle) * 40,
  this.state.player.y + Math.sin(this.state.player.facingAngle) * 40,
  visual.textureKey, visual.frame
)
  .setDisplaySize(80, 80)
  .setRotation(this.state.player.facingAngle)
  .setDepth(DEPTH.effects);
this.time.delayedCall(200, () => slashSprite.destroy());
```

**Impact:** Transforms invisible melee into a visible sword swing. Biggest single improvement.

### A2. Sprite Horizontal Flip

**File:** `GameScene.ts` (syncSprites)

After updating player position, flip based on facing:
```ts
this.playerSprite.setFlipX(Math.abs(this.state.player.facingAngle) > Math.PI / 2);
```

For enemies, flip based on their movement direction relative to player:
```ts
sprite.setFlipX(enemy.x > this.state.player.x);
```

`setFlipX` does not interfere with `setDisplaySize` (confirmed in Phaser docs).

**Impact:** Characters face the direction they're moving/looking instead of always facing right.

### A3. Movement Tilt

**File:** `GameScene.ts` (syncSprites, replace current rotation logic)

Currently the player sprite rotates fully toward the mouse pointer (`setRotation(angle + Math.PI / 2)`). This makes the knight spin like a top.

Replace with a subtle lean based on velocity:
```ts
const tiltAmount = 0.08; // radians, ~4.5 degrees
const tiltX = this.state.player.vx / this.state.player.speed; // -1 to 1
this.playerSprite.setRotation(tiltX * tiltAmount);
```

For enemies, tilt based on their movement direction.

**Impact:** Characters lean into movement instead of spinning. Feels organic.

### A4. Squash-Stretch on Attack

**File:** `SpriteAnimator.ts` (new function) + `GameScene.ts`

On melee attack, play a quick anticipation-release tween using **relative values**:
```ts
export function attackSquash(sprite: Phaser.GameObjects.Sprite): void {
  const baseScaleX = sprite.scaleX;
  const baseScaleY = sprite.scaleY;
  sprite.scene.tweens.chain({
    targets: sprite,
    tweens: [
      { scaleX: baseScaleX * 0.85, scaleY: baseScaleY * 1.15, duration: 50, ease: 'Quad.easeIn' },
      { scaleX: baseScaleX * 1.1, scaleY: baseScaleY * 0.9, duration: 80, ease: 'Quad.easeOut' },
      { scaleX: baseScaleX, scaleY: baseScaleY, duration: 120, ease: 'Sine.easeInOut' },
    ]
  });
}
```

Key: captures `sprite.scaleX/Y` at call time and works relative to it. Never uses absolute values that would destroy `setDisplaySize`.

**Impact:** Attacks feel punchy. Anticipation frame reads as "winding up."

### A5. Idle Breathing (Fixed)

**File:** `SpriteAnimator.ts`

Rewrite to use Phaser's relative value syntax:
```ts
export function idleBreathing(sprite: Phaser.GameObjects.Sprite): Phaser.Tweens.Tween {
  return sprite.scene.tweens.add({
    targets: sprite,
    scaleX: '+=0.02',
    scaleY: '+=0.02',
    duration: 800,
    yoyo: true,
    repeat: -1,
    ease: 'Sine.easeInOut',
  });
}
```

The `'+=0.02'` syntax tells Phaser to add 0.02 to whatever the current scaleX is, not replace it.

**Impact:** Subtle life to idle sprites without breaking display size.

### A6. Fix Shadows and Y-Sort (if broken by revert)

Verify shadows render correctly. Re-add if needed.

---

## Files Modified

| File | Changes |
|------|---------|
| `effects/SpriteAnimator.ts` | Rewrite idleBreathing with relative values, add attackSquash, fix enemyBob |
| `scenes/GameScene.ts` | Melee slash sprite, sprite flip, movement tilt, attack squash call, revert camera/lighting |

## Verification

After EACH step:
1. `npm run demo:build` succeeds
2. Open browser or take Playwright screenshot
3. Visually confirm the change works as intended
4. Commit only after visual confirmation

## Estimated Effort

- Revert + verify: 30 min
- A1 (melee slash): 15 min
- A2 (sprite flip): 10 min
- A3 (movement tilt): 15 min
- A4 (squash-stretch): 20 min
- A5 (idle breathing fix): 10 min
- A6 (shadow verification): 10 min
