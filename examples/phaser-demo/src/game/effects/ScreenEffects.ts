import Phaser from "phaser";

import { DEPTH } from "../constants";

/** Camera shake wrapper. */
export function cameraShake(
  camera: Phaser.Cameras.Scene2D.Camera,
  intensity: number = 0.01,
  duration: number = 150,
): void {
  camera.shake(duration, intensity);
}

/** Brief red flash on damage. */
export function damageFlash(camera: Phaser.Cameras.Scene2D.Camera): void {
  camera.flash(120, 180, 30, 20, false);
}

/** Static dark vignette overlay at screen edges. Returns the graphics for cleanup. */
export function vignette(scene: Phaser.Scene): Phaser.GameObjects.Graphics {
  const { width, height } = scene.cameras.main;
  const g = scene.add
    .graphics()
    .setDepth(DEPTH.hud - 1)
    .setScrollFactor(0);

  // Dark edges via gradient rectangles
  const edgeAlpha = 0.35;
  const edgeSize = 80;

  // Top
  for (let i = 0; i < edgeSize; i++) {
    const a = edgeAlpha * (1 - i / edgeSize);
    g.fillStyle(0x000000, a);
    g.fillRect(0, i, width, 1);
  }
  // Bottom
  for (let i = 0; i < edgeSize; i++) {
    const a = edgeAlpha * (1 - i / edgeSize);
    g.fillStyle(0x000000, a);
    g.fillRect(0, height - 1 - i, width, 1);
  }
  // Left
  for (let i = 0; i < edgeSize; i++) {
    const a = edgeAlpha * (1 - i / edgeSize);
    g.fillStyle(0x000000, a);
    g.fillRect(i, 0, 1, height);
  }
  // Right
  for (let i = 0; i < edgeSize; i++) {
    const a = edgeAlpha * (1 - i / edgeSize);
    g.fillStyle(0x000000, a);
    g.fillRect(width - 1 - i, 0, 1, height);
  }

  return g;
}

/** Fade out then fade in for room transitions. Returns a promise. */
export function roomTransitionFade(
  camera: Phaser.Cameras.Scene2D.Camera,
  fadeOutMs: number = 200,
  fadeInMs: number = 200,
): Promise<void> {
  return new Promise((resolve) => {
    camera.fadeOut(fadeOutMs, 0, 0, 0);
    camera.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
      camera.fadeIn(fadeInMs, 0, 0, 0);
      camera.once(Phaser.Cameras.Scene2D.Events.FADE_IN_COMPLETE, () => {
        resolve();
      });
    });
  });
}

/** Pulsing red border overlay when low HP. Returns object with update/destroy. */
export function lowHpOverlay(scene: Phaser.Scene): {
  update(active: boolean): void;
  destroy(): void;
} {
  const { width, height } = scene.cameras.main;
  const g = scene.add
    .graphics()
    .setDepth(DEPTH.hud - 1)
    .setScrollFactor(0)
    .setAlpha(0);
  const borderWidth = 12;

  g.fillStyle(0xcc2222, 0.4);
  g.fillRect(0, 0, width, borderWidth);
  g.fillRect(0, height - borderWidth, width, borderWidth);
  g.fillRect(0, 0, borderWidth, height);
  g.fillRect(width - borderWidth, 0, borderWidth, height);

  let tween: Phaser.Tweens.Tween | null = null;
  let isActive = false;

  return {
    update(active: boolean) {
      if (active === isActive) return;
      isActive = active;
      if (tween) {
        tween.destroy();
        tween = null;
      }
      if (active) {
        tween = scene.tweens.add({
          targets: g,
          alpha: { from: 0.3, to: 0.7 },
          duration: 500,
          yoyo: true,
          repeat: -1,
          ease: "Sine.easeInOut",
        });
      } else {
        g.setAlpha(0);
      }
    },
    destroy() {
      if (tween) tween.destroy();
      g.destroy();
    },
  };
}

/** Brief red edge flash on taking damage. Auto-cleans up. */
export function damageOverlay(scene: Phaser.Scene): void {
  const { width, height } = scene.cameras.main;
  const g = scene.add
    .graphics()
    .setDepth(DEPTH.hud - 1)
    .setScrollFactor(0);
  const edgeWidth = 20;

  g.fillStyle(0xdd2200, 0.35);
  g.fillRect(0, 0, width, edgeWidth);
  g.fillRect(0, height - edgeWidth, width, edgeWidth);
  g.fillRect(0, 0, edgeWidth, height);
  g.fillRect(width - edgeWidth, 0, edgeWidth, height);

  scene.tweens.add({
    targets: g,
    alpha: 0,
    duration: 250,
    ease: "Cubic.easeOut",
    onComplete: () => g.destroy(),
  });
}
