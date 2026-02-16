import Phaser from "phaser";

import { DEPTH, GAME_CONFIG } from "../constants";

const BAR_WIDTH = GAME_CONFIG.width - 120;
const BAR_HEIGHT = 16;
const BAR_X = 60;
const BAR_Y = 24;

export class BossHealthBar {
  private readonly container: Phaser.GameObjects.Container;
  private readonly barBg: Phaser.GameObjects.Graphics;
  private readonly barFill: Phaser.GameObjects.Graphics;
  private readonly nameText: Phaser.GameObjects.Text;
  private displayRatio = 1;
  private targetRatio = 1;
  private visible = false;

  constructor(private readonly scene: Phaser.Scene) {
    this.barBg = scene.add.graphics();
    this.barBg.fillStyle(0x111111, 0.8);
    this.barBg.fillRoundedRect(BAR_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT, 4);
    this.barBg.lineStyle(1, 0x994422, 0.6);
    this.barBg.strokeRoundedRect(BAR_X, BAR_Y, BAR_WIDTH, BAR_HEIGHT, 4);

    this.barFill = scene.add.graphics();

    this.nameText = scene.add
      .text(GAME_CONFIG.width / 2, BAR_Y - 4, "EMBER KING", {
        fontFamily: "Trebuchet MS, Segoe UI, sans-serif",
        fontSize: "14px",
        color: "#ff8844",
        stroke: "#1a0a08",
        strokeThickness: 3,
      })
      .setOrigin(0.5, 1);

    this.container = scene.add
      .container(0, -50, [this.barBg, this.barFill, this.nameText])
      .setDepth(DEPTH.hud)
      .setScrollFactor(0);
  }

  show(): void {
    if (this.visible) return;
    this.visible = true;
    this.displayRatio = 1;
    this.targetRatio = 1;
    this.scene.tweens.add({
      targets: this.container,
      y: 0,
      duration: 400,
      ease: "Back.easeOut",
    });
  }

  hide(): void {
    if (!this.visible) return;
    this.visible = false;
    this.scene.tweens.add({
      targets: this.container,
      y: -50,
      duration: 300,
      ease: "Cubic.easeIn",
    });
  }

  update(hp: number, maxHp: number): void {
    this.targetRatio = Math.max(0, hp / maxHp);

    // Smooth drain
    const speed = 0.03;
    if (this.displayRatio > this.targetRatio) {
      this.displayRatio = Math.max(this.targetRatio, this.displayRatio - speed);
    } else {
      this.displayRatio = this.targetRatio;
    }

    const fillWidth = BAR_WIDTH * this.displayRatio;
    this.barFill.clear();
    this.barFill.fillStyle(0xcc2222, 1);
    this.barFill.fillRoundedRect(BAR_X, BAR_Y, fillWidth, BAR_HEIGHT, 4);
  }

  destroy(): void {
    this.container.destroy();
  }
}
