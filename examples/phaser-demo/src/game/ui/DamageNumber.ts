import Phaser from "phaser";

import { DEPTH } from "../constants";

/**
 * Floating damage number that rises and fades.
 * @param isPlayerDamage - true = red (enemy hit player), false = white (player hit enemy)
 */
export function showDamageNumber(
  scene: Phaser.Scene,
  x: number,
  y: number,
  amount: number,
  isPlayerDamage: boolean = false,
): void {
  const color = isPlayerDamage ? "#ff4444" : "#ffffff";
  const text = scene.add
    .text(x, y, String(Math.ceil(amount)), {
      fontFamily: "Trebuchet MS, Segoe UI, sans-serif",
      fontSize: "18px",
      color,
      stroke: "#111111",
      strokeThickness: 3,
      align: "center",
    })
    .setOrigin(0.5)
    .setDepth(DEPTH.overlay);

  scene.tweens.add({
    targets: text,
    y: y - 30,
    alpha: 0,
    duration: 800,
    ease: "Cubic.easeOut",
    onComplete: () => text.destroy(),
  });
}
