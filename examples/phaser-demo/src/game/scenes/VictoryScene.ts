import Phaser from "phaser";

import { GAME_CONFIG, DEPTH } from "../constants";

interface VictoryData {
  score: number;
  kills: number;
  gold: number;
  roomsCleared: number;
}

export class VictoryScene extends Phaser.Scene {
  constructor() {
    super("VictoryScene");
  }

  create(data: Partial<VictoryData>): void {
    const score = data.score ?? 0;
    const kills = data.kills ?? 0;
    const gold = data.gold ?? 0;
    const roomsCleared = data.roomsCleared ?? 0;

    const cx = GAME_CONFIG.width / 2;
    const cy = GAME_CONFIG.height / 2;

    this.cameras.main.setBackgroundColor("#0a0a12");

    // Title
    const title = this.add
      .text(cx, cy - 100, "VICTORY", {
        fontFamily: "serif",
        fontSize: "64px",
        color: "#f5a623",
        stroke: "#3d1a00",
        strokeThickness: 6,
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay)
      .setAlpha(0);

    this.tweens.add({
      targets: title,
      alpha: 1,
      y: cy - 120,
      duration: 800,
      ease: "Back.easeOut",
    });

    // Subtitle
    const subtitle = this.add
      .text(cx, cy - 60, "The Ember King has fallen!", {
        fontFamily: "Trebuchet MS, Segoe UI, sans-serif",
        fontSize: "20px",
        color: "#ddc888",
        stroke: "#111111",
        strokeThickness: 4,
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay)
      .setAlpha(0);

    this.tweens.add({
      targets: subtitle,
      alpha: 1,
      duration: 500,
      delay: 400,
    });

    // Stats
    const statsLines = [
      `Score: ${score}`,
      `Kills: ${kills}`,
      `Gold: ${gold}`,
      `Rooms Cleared: ${roomsCleared}`,
    ];

    const statsText = this.add
      .text(cx, cy + 10, statsLines.join("\n"), {
        fontFamily: "monospace",
        fontSize: "24px",
        color: "#e0d0b0",
        align: "center",
        lineSpacing: 12,
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay)
      .setAlpha(0);

    this.tweens.add({
      targets: statsText,
      alpha: 1,
      duration: 600,
      delay: 600,
      ease: "Sine.easeIn",
    });

    // Restart prompt
    const prompt = this.add
      .text(cx, cy + 130, "Press R to play again", {
        fontFamily: "monospace",
        fontSize: "18px",
        color: "#8a7a60",
        align: "center",
      })
      .setOrigin(0.5)
      .setDepth(DEPTH.overlay)
      .setAlpha(0);

    this.tweens.add({
      targets: prompt,
      alpha: { from: 0, to: 1 },
      duration: 500,
      delay: 1200,
      ease: "Sine.easeIn",
    });

    this.time.delayedCall(1700, () => {
      this.tweens.add({
        targets: prompt,
        alpha: { from: 1, to: 0.4 },
        duration: 800,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    });

    // Restart on R key
    this.input.keyboard?.on("keydown-R", () => {
      this.scene.start("GameScene");
    });
  }
}
