import Phaser from "phaser";

import { DEPTH, GAME_CONFIG } from "../constants";
import type { DungeonState } from "../types";

export class GameOverOverlay {
  private readonly container: Phaser.GameObjects.Container;

  constructor(scene: Phaser.Scene, state: DungeonState) {
    const cx = GAME_CONFIG.width / 2;
    const cy = GAME_CONFIG.height / 2;

    // Dark backdrop
    const bg = scene.add
      .rectangle(0, 0, GAME_CONFIG.width, GAME_CONFIG.height, 0x000000, 0.7)
      .setOrigin(0);

    // "YOU DIED" title
    const title = scene.add
      .text(cx, cy - 60, "YOU DIED", {
        fontFamily: "Trebuchet MS, Segoe UI, sans-serif",
        fontSize: "48px",
        color: "#cc3322",
        stroke: "#1a0808",
        strokeThickness: 6,
        align: "center",
      })
      .setOrigin(0.5);

    // Stats
    const statsLines = [
      `Rooms Cleared: ${state.roomsCleared.size}`,
      `Kills: ${state.kills}`,
      `Gold: ${state.inventory.gold}`,
      `Score: ${state.score}`,
    ];
    const stats = scene.add
      .text(cx, cy + 10, statsLines.join("\n"), {
        fontFamily: "Trebuchet MS, Segoe UI, sans-serif",
        fontSize: "18px",
        color: "#ccbbaa",
        stroke: "#111111",
        strokeThickness: 3,
        align: "center",
        lineSpacing: 6,
      })
      .setOrigin(0.5);

    // Restart prompt
    const prompt = scene.add
      .text(cx, cy + 100, "Press R to restart", {
        fontFamily: "Trebuchet MS, Segoe UI, sans-serif",
        fontSize: "16px",
        color: "#aa9977",
        stroke: "#111111",
        strokeThickness: 3,
        align: "center",
      })
      .setOrigin(0.5);

    // Pulse the prompt
    scene.tweens.add({
      targets: prompt,
      alpha: { from: 0.5, to: 1 },
      duration: 800,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });

    this.container = scene.add
      .container(0, 0, [bg, title, stats, prompt])
      .setDepth(DEPTH.overlay)
      .setScrollFactor(0)
      .setAlpha(0);

    // Fade in
    scene.tweens.add({
      targets: this.container,
      alpha: 1,
      duration: 500,
      ease: "Cubic.easeOut",
    });
  }

  destroy(): void {
    this.container.destroy();
  }
}
