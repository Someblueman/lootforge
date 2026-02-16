import Phaser from "phaser";

/** Gentle breathing scale oscillation on idle sprites. Returns the tween for cleanup. */
export function idleBreathing(
  sprite: Phaser.GameObjects.Sprite,
): Phaser.Tweens.Tween {
  return sprite.scene.tweens.add({
    targets: sprite,
    scaleX: 1.03,
    scaleY: 1.03,
    duration: 750,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut",
  });
}

/** Squash/stretch bob for enemies (avoids y-position conflicts with sync). Returns the tween for cleanup. */
export function enemyBob(
  sprite: Phaser.GameObjects.Sprite,
): Phaser.Tweens.Tween {
  return sprite.scene.tweens.add({
    targets: sprite,
    scaleY: { from: 0.95, to: 1.05 },
    duration: 400,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut",
  });
}

/** Flash sprite white for 100ms on hit. */
export function hitFlash(sprite: Phaser.GameObjects.Sprite): void {
  const originalTint = sprite.tintTopLeft;
  sprite.setTint(0xffffff);
  sprite.scene.time.delayedCall(100, () => {
    if (!sprite.active) return;
    sprite.setTint(originalTint || 0xffffff);
    sprite.clearTint();
  });
}

/** Scale down + fade out, then destroy. Returns the tween. */
export function deathAnimation(
  sprite: Phaser.GameObjects.Sprite,
): Phaser.Tweens.Tween {
  return sprite.scene.tweens.add({
    targets: sprite,
    scaleX: 0,
    scaleY: 0,
    alpha: 0,
    duration: 300,
    ease: "Back.easeIn",
    onComplete: () => sprite.destroy(),
  });
}

/** Gentle float + glow pulse for pickups. Returns the tween for cleanup. */
export function pickupBob(
  sprite: Phaser.GameObjects.Sprite,
): Phaser.Tweens.Tween {
  return sprite.scene.tweens.add({
    targets: sprite,
    y: sprite.y - 4,
    alpha: { from: 0.85, to: 1 },
    duration: 600,
    yoyo: true,
    repeat: -1,
    ease: "Sine.easeInOut",
  });
}
