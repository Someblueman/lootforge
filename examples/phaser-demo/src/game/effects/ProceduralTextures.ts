import Phaser from "phaser";

export const TEX_KEYS = {
  circle: "particle_circle",
  dot: "particle_dot",
  ring: "particle_ring",
} as const;

/** Generate all procedural particle textures. Call once during scene create. */
export function generateParticleTextures(scene: Phaser.Scene): void {
  const g = scene.add.graphics();

  // 8px white filled circle
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(8, 8, 8);
  g.generateTexture(TEX_KEYS.circle, 16, 16);

  // 4px white dot
  g.clear();
  g.fillStyle(0xffffff, 1);
  g.fillCircle(4, 4, 4);
  g.generateTexture(TEX_KEYS.dot, 8, 8);

  // 12px white ring (hollow circle)
  g.clear();
  g.lineStyle(2, 0xffffff, 1);
  g.strokeCircle(12, 12, 10);
  g.generateTexture(TEX_KEYS.ring, 24, 24);

  g.destroy();
}
