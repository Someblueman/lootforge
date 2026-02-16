import Phaser from "phaser";

import { ArenaState } from "../state";

export class Hud {
  private readonly hpText: Phaser.GameObjects.Text;
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly waveText: Phaser.GameObjects.Text;
  private readonly gameOverText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene) {
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "Trebuchet MS, Segoe UI, sans-serif",
      fontSize: "20px",
      color: "#f4f7fb",
      stroke: "#071422",
      strokeThickness: 4,
    };

    this.hpText = scene.add.text(48, 18, "HP", style).setDepth(20);
    this.scoreText = scene.add.text(48, 48, "Score", style).setDepth(20);
    this.waveText = scene.add.text(48, 78, "Wave", style).setDepth(20);

    this.gameOverText = scene
      .add
      .text(0, 0, "", {
        ...style,
        align: "center",
        fontSize: "40px",
      })
      .setOrigin(0.5)
      .setDepth(25)
      .setVisible(false);
  }

  update(state: ArenaState): void {
    this.hpText.setText(`HP: ${Math.ceil(state.player.hp)} / ${state.player.maxHp}`);
    this.scoreText.setText(`Score: ${state.score}`);
    this.waveText.setText(`Wave: ${Math.max(state.wave, 1)}  Kills: ${state.kills}`);

    if (state.mode === "gameover") {
      this.gameOverText
        .setPosition(state.world.width / 2, state.world.height / 2)
        .setText(`Game Over\nScore ${state.score}\nPress R, Enter, or Space to restart`)
        .setVisible(true);
    } else {
      this.gameOverText.setVisible(false);
    }
  }
}
