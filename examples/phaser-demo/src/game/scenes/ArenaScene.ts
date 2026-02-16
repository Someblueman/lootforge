import Phaser from "phaser";

import { AssetRegistry } from "../AssetRegistry";
import { DEMO_ASSET_IDS } from "../constants";
import { createInitialArenaState, ArenaState } from "../state";
import { CombatSystem } from "../systems/CombatSystem";
import { WaveSystem } from "../systems/WaveSystem";
import { Hud } from "../ui/Hud";

interface Controls {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  upAlt: Phaser.Input.Keyboard.Key;
  downAlt: Phaser.Input.Keyboard.Key;
  leftAlt: Phaser.Input.Keyboard.Key;
  rightAlt: Phaser.Input.Keyboard.Key;
  restart: Phaser.Input.Keyboard.Key;
  restartAlt: Phaser.Input.Keyboard.Key;
  restartAlt2: Phaser.Input.Keyboard.Key;
  fullscreen: Phaser.Input.Keyboard.Key;
}

export class ArenaScene extends Phaser.Scene {
  private assetRegistry!: AssetRegistry;
  private state!: ArenaState;
  private controls!: Controls;
  private hud!: Hud;
  private combatSystem!: CombatSystem;
  private waveSystem!: WaveSystem;

  private playerSprite!: Phaser.GameObjects.Sprite;
  private readonly enemySprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly projectileSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly effectSprites = new Set<Phaser.GameObjects.Sprite>();

  private pointerAim = { x: 0, y: 0 };

  constructor() {
    super("ArenaScene");
  }

  create(): void {
    const registry = this.registry.get("assetRegistry");
    if (!(registry instanceof AssetRegistry)) {
      throw new Error("ArenaScene requires AssetRegistry from BootScene.");
    }

    this.assetRegistry = registry;
    this.state = createInitialArenaState({
      width: this.scale.width,
      height: this.scale.height,
    });
    this.combatSystem = new CombatSystem();
    this.waveSystem = new WaveSystem();

    this.createBackground();
    this.createPlayer();
    this.createHudIcons();
    this.hud = new Hud(this);
    this.controls = this.bindControls();

    this.input.keyboard!.on("keydown-ESC", () => {
      if (this.scale.isFullscreen) {
        this.scale.stopFullscreen();
      }
    });

    this.controls.fullscreen.on("down", () => {
      this.scale.toggleFullscreen();
    });

    this.input.on("pointermove", (pointer: Phaser.Input.Pointer) => {
      this.pointerAim = { x: pointer.worldX, y: pointer.worldY };
    });

    this.pointerAim = { x: this.state.world.width * 0.5, y: 0 };
    this.installAutomationHooks();
    this.hud.update(this.state);
  }

  update(_time: number, delta: number): void {
    if (
      (this.controls.restart.isDown ||
        this.controls.restartAlt.isDown ||
        this.controls.restartAlt2.isDown) &&
      this.state.mode === "gameover"
    ) {
      this.resetArena();
    }

    this.stepFrame(delta, true);
  }

  advanceTime(ms: number): void {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    const stepMs = ms / steps;
    for (let stepIndex = 0; stepIndex < steps; stepIndex += 1) {
      this.stepFrame(stepMs, true);
    }
  }

  renderGameToText(): string {
    const payload = {
      mode: this.state.mode,
      coordinateSystem: this.state.coordinateSystem,
      player: {
        x: round2(this.state.player.x),
        y: round2(this.state.player.y),
        vx: round2(this.state.player.vx),
        vy: round2(this.state.player.vy),
        hp: round2(this.state.player.hp),
        maxHp: this.state.player.maxHp,
      },
      aim: {
        x: round2(this.pointerAim.x),
        y: round2(this.pointerAim.y),
      },
      enemies: this.state.enemies.map((enemy) => ({
        id: enemy.id,
        kind: enemy.kind,
        x: round2(enemy.x),
        y: round2(enemy.y),
        hp: round2(enemy.hp),
      })),
      projectiles: this.state.projectiles.map((projectile) => ({
        id: projectile.id,
        x: round2(projectile.x),
        y: round2(projectile.y),
        vx: round2(projectile.vx),
        vy: round2(projectile.vy),
        ttlMs: round2(projectile.ttlMs),
      })),
      score: this.state.score,
      kills: this.state.kills,
      wave: this.state.wave,
      waveCountdownMs: round2(this.state.waveCountdownMs),
      fireCooldownMs: round2(this.state.fireCooldownMs),
    };

    return JSON.stringify(payload);
  }

  private stepFrame(deltaMs: number, allowInput: boolean): void {
    const deltaSec = deltaMs / 1000;

    if (allowInput) {
      this.applyPlayerMovement(deltaSec);

      const pointer = this.input.activePointer;
      this.pointerAim = { x: pointer.worldX, y: pointer.worldY };
      if (pointer.isDown && this.state.mode === "playing") {
        this.combatSystem.tryFire(this.state, pointer.worldX, pointer.worldY);
      }
    }

    this.waveSystem.update(this.state, deltaMs);
    const combatResult = this.combatSystem.update(this.state, deltaMs);
    this.state.elapsedMs += deltaMs;

    this.syncSprites();
    this.spawnHitEffects(combatResult.hitEffects);

    const angle = Phaser.Math.Angle.Between(
      this.state.player.x,
      this.state.player.y,
      this.pointerAim.x,
      this.pointerAim.y,
    );
    this.playerSprite.setRotation(angle + Math.PI / 2);

    this.hud.update(this.state);
  }

  private applyPlayerMovement(deltaSec: number): void {
    if (this.state.mode !== "playing") {
      this.state.player.vx = 0;
      this.state.player.vy = 0;
      return;
    }

    const movingRight = this.controls.right.isDown || this.controls.rightAlt.isDown;
    const movingLeft = this.controls.left.isDown || this.controls.leftAlt.isDown;
    const movingDown = this.controls.down.isDown || this.controls.downAlt.isDown;
    const movingUp = this.controls.up.isDown || this.controls.upAlt.isDown;

    const axisX = Number(movingRight) - Number(movingLeft);
    const axisY = Number(movingDown) - Number(movingUp);
    const length = Math.hypot(axisX, axisY);

    const directionX = length > 0 ? axisX / length : 0;
    const directionY = length > 0 ? axisY / length : 0;

    const vx = directionX * this.state.player.speed;
    const vy = directionY * this.state.player.speed;

    this.state.player.vx = vx;
    this.state.player.vy = vy;

    this.state.player.x = Phaser.Math.Clamp(
      this.state.player.x + vx * deltaSec,
      this.state.player.radius,
      this.state.world.width - this.state.player.radius,
    );
    this.state.player.y = Phaser.Math.Clamp(
      this.state.player.y + vy * deltaSec,
      this.state.player.radius,
      this.state.world.height - this.state.player.radius,
    );
  }

  private bindControls(): Controls {
    const keyboard = this.input.keyboard;
    if (!keyboard) {
      throw new Error("Keyboard input is unavailable in ArenaScene.");
    }

    return {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      upAlt: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      downAlt: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      leftAlt: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      rightAlt: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      restart: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      restartAlt: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ENTER),
      restartAlt2: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
      fullscreen: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.F),
    };
  }

  private createBackground(): void {
    const visual = this.assetRegistry.requireVisual(DEMO_ASSET_IDS.arenaBackground);
    const sprite = this.add
      .sprite(this.scale.width * 0.5, this.scale.height * 0.5, visual.textureKey, visual.frame)
      .setDepth(0);

    const frame = this.textures.getFrame(visual.textureKey, visual.frame);
    if (!frame || frame.width <= 0 || frame.height <= 0) {
      sprite.setDisplaySize(this.scale.width, this.scale.height);
      return;
    }

    // Preserve source aspect ratio and cover the full play area without stretching.
    const scale = Math.max(this.scale.width / frame.width, this.scale.height / frame.height);
    sprite.setScale(scale);
  }

  private createPlayer(): void {
    const visual = this.assetRegistry.requireVisual(DEMO_ASSET_IDS.player);
    this.playerSprite = this.add
      .sprite(this.state.player.x, this.state.player.y, visual.textureKey, visual.frame)
      .setDisplaySize(132, 132)
      .setDepth(10);
  }

  private createHudIcons(): void {
    const iconScale = 28;

    const hpVisual = this.assetRegistry.requireVisual(DEMO_ASSET_IDS.uiHealth);
    this.add
      .sprite(22, 30, hpVisual.textureKey, hpVisual.frame)
      .setDisplaySize(iconScale, iconScale)
      .setDepth(21)
      .setOrigin(0.5);

    const scoreVisual = this.assetRegistry.requireVisual(DEMO_ASSET_IDS.uiScore);
    this.add
      .sprite(22, 60, scoreVisual.textureKey, scoreVisual.frame)
      .setDisplaySize(iconScale, iconScale)
      .setDepth(21)
      .setOrigin(0.5);

    const waveVisual = this.assetRegistry.requireVisual(DEMO_ASSET_IDS.uiWave);
    this.add
      .sprite(22, 90, waveVisual.textureKey, waveVisual.frame)
      .setDisplaySize(iconScale, iconScale)
      .setDepth(21)
      .setOrigin(0.5);
  }

  private syncSprites(): void {
    this.playerSprite.setPosition(this.state.player.x, this.state.player.y);

    const aliveEnemyIds = new Set(this.state.enemies.map((enemy) => enemy.id));
    for (const [enemyId, sprite] of this.enemySprites.entries()) {
      if (!aliveEnemyIds.has(enemyId)) {
        sprite.destroy();
        this.enemySprites.delete(enemyId);
      }
    }

    for (const enemy of this.state.enemies) {
      let sprite = this.enemySprites.get(enemy.id);
      if (!sprite) {
        const visual = this.assetRegistry.requireVisual(enemy.visualId);
        const enemySize =
          enemy.visualId === DEMO_ASSET_IDS.enemyScrapRat ? 108 : 124;
        sprite = this.add
          .sprite(enemy.x, enemy.y, visual.textureKey, visual.frame)
          .setDisplaySize(enemySize, enemySize)
          .setDepth(8);
        this.enemySprites.set(enemy.id, sprite);
      }
      sprite.setPosition(enemy.x, enemy.y);
    }

    const liveProjectileIds = new Set(this.state.projectiles.map((projectile) => projectile.id));
    for (const [projectileId, sprite] of this.projectileSprites.entries()) {
      if (!liveProjectileIds.has(projectileId)) {
        sprite.destroy();
        this.projectileSprites.delete(projectileId);
      }
    }

    for (const projectile of this.state.projectiles) {
      let sprite = this.projectileSprites.get(projectile.id);
      if (!sprite) {
        const visual = this.assetRegistry.requireVisual(projectile.visualId);
        sprite = this.add
          .sprite(projectile.x, projectile.y, visual.textureKey, visual.frame)
          .setDisplaySize(36, 36)
          .setDepth(12);
        this.projectileSprites.set(projectile.id, sprite);
      }
      sprite.setPosition(projectile.x, projectile.y);
    }
  }

  private spawnHitEffects(hits: Array<{ x: number; y: number }>): void {
    if (hits.length === 0) {
      return;
    }

    const visual = this.assetRegistry.requireVisual(DEMO_ASSET_IDS.hitEffect);
    for (const hit of hits) {
      const sprite = this.add
        .sprite(hit.x, hit.y, visual.textureKey, visual.frame)
        .setDisplaySize(72, 72)
        .setDepth(14)
        .setAlpha(0.9);

      this.effectSprites.add(sprite);
      this.tweens.add({
        targets: sprite,
        alpha: 0,
        scaleX: 1.6,
        scaleY: 1.6,
        duration: 150,
        onComplete: () => {
          this.effectSprites.delete(sprite);
          sprite.destroy();
        },
      });
    }
  }

  private resetArena(): void {
    this.state = createInitialArenaState({
      width: this.scale.width,
      height: this.scale.height,
    });

    for (const sprite of this.enemySprites.values()) {
      sprite.destroy();
    }
    this.enemySprites.clear();

    for (const sprite of this.projectileSprites.values()) {
      sprite.destroy();
    }
    this.projectileSprites.clear();

    for (const sprite of this.effectSprites.values()) {
      sprite.destroy();
    }
    this.effectSprites.clear();

    this.playerSprite.setPosition(this.state.player.x, this.state.player.y);
    this.hud.update(this.state);
  }

  private installAutomationHooks(): void {
    const bridge = window as typeof window & {
      render_game_to_text?: () => string;
      advanceTime?: (ms: number) => void;
    };

    bridge.render_game_to_text = () => this.renderGameToText();
    bridge.advanceTime = (ms: number) => this.advanceTime(ms);
  }
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
