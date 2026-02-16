# Plan B: Sprite Sheet Animations

## Context

Single-frame sprites have a ceiling on how good they can look, no matter how much procedural animation you add. Real character animation (walk cycles, attack sequences, idle sways) requires multiple frames. This plan extends the LootForge asset pipeline to generate multi-frame sprite sheets.

---

## Option B1: Full Sprite Sheet Pipeline

### Current Pipeline

The manifest (`manifest.dungeon.json`) uses `gpt-image-1` (OpenAI) to generate single PNGs per target. Each target has a prompt, style constraints, and output path. Pipeline: `plan -> generate -> process -> atlas`.

### Extension: Add "spritesheet" Target Kind

**Manifest change (per character target):**
```json
{
  "id": "player.knight",
  "kind": "spritesheet",
  "out": "player_knight_sheet.png",
  "frames": {
    "idle": { "count": 4, "prompt": "top-down knight idle stance, slight breathing variation" },
    "walk": { "count": 6, "prompt": "top-down knight walking cycle, legs moving" },
    "attack": { "count": 4, "prompt": "top-down knight sword swing arc, anticipation to follow-through" },
    "hit": { "count": 2, "prompt": "top-down knight recoiling from hit, flash of pain" },
    "death": { "count": 4, "prompt": "top-down knight collapsing to ground, final rest" }
  },
  "atlasGroup": "characters",
  "prompt": {
    "style": "consistent with other frames, same character, same proportions",
    "constraints": "transparent background, consistent silhouette across frames, centered on same pivot point"
  }
}
```

### Pipeline Changes

1. **Generation** (`generate` command): For `kind: "spritesheet"`, generate N separate images per frame set, each with a prompt including frame context ("frame 3 of 6 of walk cycle") and a reference to maintain visual consistency.

2. **Process** (`process` command): Assemble individual frame PNGs into a horizontal strip or grid PNG. Add JSON frame data. Post-process to align pivot points across frames.

3. **Atlas** (`atlas` command): Pack sprite sheet frames into the atlas as named frames (`player.knight.idle.0`, `player.knight.idle.1`, etc.).

4. **Game code**: Use Phaser's animation system:
```ts
this.anims.create({
  key: 'knight-walk',
  frames: this.anims.generateFrameNames('character-atlas', {
    prefix: 'player.knight.walk.',
    start: 0, end: 5
  }),
  frameRate: 10,
  repeat: -1
});

// In update:
if (isMoving) {
  this.playerSprite.play('knight-walk', true);
} else {
  this.playerSprite.play('knight-idle', true);
}
```

### Challenges

1. **Frame consistency**: AI image generation doesn't guarantee consistent character proportions across frames. Frame 1 of a walk cycle may look very different from frame 3. Mitigation: strong prompts, img2img with reference images, post-processing alignment.

2. **Generation cost**: 5 animations x 4 avg frames = 20 images per character. 4 characters = 80 generations. ~$4-8 per full character set at current gpt-image-1 pricing.

3. **Pivot consistency**: Each frame needs the character centered at the same pivot point, or the sprite will "jitter" during animation. Requires post-processing to detect and align character bounds.

4. **Pipeline complexity**: Significant new code in the CLI tool -- schema changes, multi-image generation orchestration, frame assembly, alignment detection.

### Files Modified

| File | Changes |
|------|---------|
| `src/manifest/schema.ts` | Add `spritesheet` kind with frames schema |
| `src/commands/generate.ts` | Handle multi-frame generation with frame-context prompts |
| `src/commands/process.ts` | Frame assembly, pivot alignment, strip generation |
| `manifest.dungeon.json` | Convert character targets to spritesheet kind |
| `GameScene.ts` | Use Phaser animation system instead of static sprites |
| `BootScene.ts` | Register animations after atlas load |

### Estimated Effort

- Schema + CLI changes: 2-4 hours
- Frame consistency tuning: 1-2 hours (iterating on prompts)
- Pivot alignment post-processing: 1-2 hours
- Game code animation system: 1 hour
- Testing + iteration: 2 hours

---

## Option B2: Hybrid Approach (Recommended)

Instead of full sprite sheets, generate just 2-3 key poses per character:
- **Idle pose** (already have this)
- **Attack pose** (sword raised/swinging)
- **Hit/stagger pose**

Use snap-switch between textures with squash-stretch transitions (from Plan A). Gets 80% of the visual improvement with 3x the art instead of 20x.

### Manifest Changes

```json
{
  "id": "player.knight.attack",
  "kind": "sprite",
  "out": "player_knight_attack.png",
  "atlasGroup": "characters",
  "prompt": {
    "primary": "Same knight character as player.knight but mid-sword-swing, blade extended forward, body rotated into attack, same proportions and art style, same viewing angle",
    "constraints": "transparent background, same character design, same viewing angle, same proportions"
  }
},
{
  "id": "player.knight.hit",
  "kind": "sprite",
  "out": "player_knight_hit.png",
  "atlasGroup": "characters",
  "prompt": {
    "primary": "Same knight character as player.knight but recoiling from a hit, leaning back, shield raised defensively, pain reaction, same proportions and art style",
    "constraints": "transparent background, same character design, same viewing angle, same proportions"
  }
}
```

Same pattern for skeleton, slime, and boss.

### Game Code

```ts
// In stepFrame, after melee attack:
if (pcResult.meleeAttack) {
  const attackVisual = this.assetRegistry.requireVisual(DEMO_ASSET_IDS.playerAttack);
  this.playerSprite.setTexture(attackVisual.textureKey, attackVisual.frame);
  this.time.delayedCall(300, () => {
    const idleVisual = this.assetRegistry.requireVisual(DEMO_ASSET_IDS.player);
    this.playerSprite.setTexture(idleVisual.textureKey, idleVisual.frame);
  });
}

// On taking damage:
if (combatResult.playerDamaged) {
  const hitVisual = this.assetRegistry.requireVisual(DEMO_ASSET_IDS.playerHit);
  this.playerSprite.setTexture(hitVisual.textureKey, hitVisual.frame);
  this.time.delayedCall(200, () => {
    const idleVisual = this.assetRegistry.requireVisual(DEMO_ASSET_IDS.player);
    this.playerSprite.setTexture(idleVisual.textureKey, idleVisual.frame);
  });
}
```

### Advantages Over Full Sprite Sheets

- No pipeline changes needed -- just new manifest targets using existing `sprite` kind
- 6-8 new images total (2 per character x 3-4 characters) vs 80
- Much easier to maintain visual consistency (same prompt template, small variations)
- Can be combined with Plan A's procedural animation (squash-stretch, tilt, flip)

### Files Modified

| File | Changes |
|------|---------|
| `manifest.dungeon.json` | Add attack + hit pose targets for each character |
| `constants.ts` | Add new DEMO_ASSET_IDS (playerAttack, playerHit, etc.) |
| `GameScene.ts` | Switch textures based on state (attacking, hit, idle) |
| `BootScene.ts` | Assets auto-loaded via existing pipeline |

### Estimated Effort

- Manifest additions: 15 min
- Asset generation: 10 min (run pipeline)
- Game code texture switching: 30 min
- Consistency verification: 30 min (may need to regenerate if poses don't match)

---

## Recommendation

**Start with B2 (Hybrid)** combined with Plan A's procedural animation. The combo of:
- 2-3 key poses per character (texture swap on attack/hit)
- Melee slash overlay sprite
- Squash-stretch on attacks
- Movement tilt + sprite flip

...would look dramatically better than the current state with minimal effort and no pipeline changes.

Only invest in B1 (Full Sprite Sheets) if the demo needs to showcase the asset generation pipeline itself -- i.e., if "generating animated sprite sheets from prompts" is a feature you want to demonstrate.
