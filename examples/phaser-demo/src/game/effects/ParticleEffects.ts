import Phaser from "phaser";

import { TEX_KEYS } from "./ProceduralTextures";

/** Burst of ~8 sparks at a hit position. Auto-completes. */
export function hitSparks(
  scene: Phaser.Scene,
  x: number,
  y: number,
  tint: number = 0xffcc44,
): Phaser.GameObjects.Particles.ParticleEmitter {
  const emitter = scene.add.particles(x, y, TEX_KEYS.circle, {
    speed: { min: 60, max: 180 },
    scale: { start: 0.6, end: 0 },
    alpha: { start: 1, end: 0 },
    lifespan: 300,
    blendMode: Phaser.BlendModes.ADD,
    tint,
    emitting: false,
  });
  emitter.explode(8);
  scene.time.delayedCall(400, () => emitter.destroy());
  return emitter;
}

/** Larger burst of ~16 particles at a death position. Auto-completes. */
export function deathBurst(
  scene: Phaser.Scene,
  x: number,
  y: number,
  tint: number = 0xff6644,
): Phaser.GameObjects.Particles.ParticleEmitter {
  const emitter = scene.add.particles(x, y, TEX_KEYS.circle, {
    speed: { min: 40, max: 220 },
    scale: { start: 0.8, end: 0 },
    alpha: { start: 1, end: 0 },
    lifespan: 500,
    blendMode: Phaser.BlendModes.ADD,
    tint,
    emitting: false,
  });
  emitter.explode(12);

  const ringEmitter = scene.add.particles(x, y, TEX_KEYS.ring, {
    speed: { min: 20, max: 100 },
    scale: { start: 0.5, end: 0 },
    alpha: { start: 0.8, end: 0 },
    lifespan: 600,
    blendMode: Phaser.BlendModes.ADD,
    tint,
    emitting: false,
  });
  ringEmitter.explode(4);

  scene.time.delayedCall(700, () => {
    emitter.destroy();
    ringEmitter.destroy();
  });
  return emitter;
}

/** Continuous trail emitter that follows a target. Caller must destroy. */
export function projectileTrail(
  scene: Phaser.Scene,
  follow: Phaser.GameObjects.GameObject & { x: number; y: number },
  tint: number = 0x88ccff,
): Phaser.GameObjects.Particles.ParticleEmitter {
  return scene.add.particles(0, 0, TEX_KEYS.dot, {
    follow,
    speed: { min: 5, max: 20 },
    scale: { start: 0.5, end: 0 },
    alpha: { start: 0.4, end: 0 },
    lifespan: 200,
    frequency: 30,
    blendMode: Phaser.BlendModes.ADD,
    tint,
  });
}

/** Ambient torch embers floating upward. Caller must destroy. */
export function torchEmbers(
  scene: Phaser.Scene,
  x: number,
  y: number,
): Phaser.GameObjects.Particles.ParticleEmitter {
  return scene.add.particles(x, y, TEX_KEYS.dot, {
    speedY: { min: -40, max: -15 },
    speedX: { min: -10, max: 10 },
    scale: { start: 0.4, end: 0 },
    alpha: { start: 0.6, end: 0 },
    lifespan: { min: 800, max: 1500 },
    frequency: 200,
    tint: [0xff8833, 0xffaa44, 0xff6622],
    blendMode: Phaser.BlendModes.ADD,
  });
}

/** Slow ambient dust across the entire room. Caller must destroy. */
export function ambientDust(
  scene: Phaser.Scene,
  width: number,
  height: number,
): Phaser.GameObjects.Particles.ParticleEmitter {
  return scene.add.particles(0, 0, TEX_KEYS.dot, {
    emitZone: {
      type: "random",
      source: new Phaser.Geom.Rectangle(0, 0, width, height),
    } as Phaser.Types.GameObjects.Particles.ParticleEmitterRandomZoneConfig,
    speedX: { min: -8, max: 8 },
    speedY: { min: -5, max: 5 },
    scale: { start: 0.2, end: 0.1 },
    alpha: { start: 0.12, end: 0 },
    lifespan: { min: 3000, max: 6000 },
    frequency: 400,
    tint: 0xaaaaaa,
    blendMode: Phaser.BlendModes.ADD,
  });
}
