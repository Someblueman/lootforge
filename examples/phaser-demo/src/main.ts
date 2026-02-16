import Phaser from "phaser";

import { BootScene } from "./game/scenes/BootScene";
import { GameScene } from "./game/scenes/GameScene";
import { VictoryScene } from "./game/scenes/VictoryScene";
import { GAME_CONFIG } from "./game/constants";
import "./style.css";

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: "app",
  width: GAME_CONFIG.width,
  height: GAME_CONFIG.height,
  backgroundColor: "#0a0a12",
  scene: [BootScene, GameScene, VictoryScene],
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
});

game.canvas.setAttribute("tabindex", "0");
game.canvas.focus();
game.canvas.addEventListener("pointerdown", () => game.canvas.focus());

(window as typeof window & { __lootforgeDemo?: Phaser.Game }).__lootforgeDemo =
  game;
