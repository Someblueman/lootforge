import Phaser from "phaser";

import { AssetRegistry } from "../AssetRegistry";
import { DEMO_ASSET_IDS, DEPTH, GAME_CONFIG, TUNING } from "../constants";
import { createInitialDungeonState } from "../state";
import type { DungeonState, EnemyState, RoomId } from "../types";
import { PlayerController, PlayerInput } from "../systems/PlayerController";
import { CombatSystem } from "../systems/CombatSystem";
import { EnemyAI } from "../systems/EnemyAI";
import { PickupSystem } from "../systems/PickupSystem";
import { RoomManager } from "../rooms/RoomManager";
import { Hud } from "../ui/Hud";
import { BossHealthBar } from "../ui/BossHealthBar";
import { GameOverOverlay } from "../ui/GameOverOverlay";
import { showRoomTitle } from "../ui/RoomTitle";
import { showDamageNumber } from "../ui/DamageNumber";
import { generateParticleTextures } from "../effects/ProceduralTextures";
import {
  hitSparks,
  deathBurst,
  projectileTrail,
  torchEmbers,
  ambientDust,
} from "../effects/ParticleEffects";
import {
  deathAnimation,
  pickupBob,
  idleBreathing,
  enemyBob,
  hitFlash,
} from "../effects/SpriteAnimator";
import {
  cameraShake,
  damageFlash,
  vignette,
  roomTransitionFade,
  lowHpOverlay,
  damageOverlay,
} from "../effects/ScreenEffects";

interface Controls {
  up: Phaser.Input.Keyboard.Key;
  down: Phaser.Input.Keyboard.Key;
  left: Phaser.Input.Keyboard.Key;
  right: Phaser.Input.Keyboard.Key;
  upAlt: Phaser.Input.Keyboard.Key;
  downAlt: Phaser.Input.Keyboard.Key;
  leftAlt: Phaser.Input.Keyboard.Key;
  rightAlt: Phaser.Input.Keyboard.Key;
  interact: Phaser.Input.Keyboard.Key;
  restart: Phaser.Input.Keyboard.Key;
  fullscreen: Phaser.Input.Keyboard.Key;
}

export class GameScene extends Phaser.Scene {
  private assetRegistry!: AssetRegistry;
  private state!: DungeonState;
  private controls!: Controls;

  // Systems
  private playerController!: PlayerController;
  private combatSystem!: CombatSystem;
  private enemyAI!: EnemyAI;
  private pickupSystem!: PickupSystem;
  private roomManager!: RoomManager;

  // UI
  private hud!: Hud;
  private bossHealthBar!: BossHealthBar;
  private gameOverOverlay: GameOverOverlay | null = null;
  private lowHpFx!: ReturnType<typeof lowHpOverlay>;

  // Sprites
  private backgroundSprite!: Phaser.GameObjects.Sprite;
  private playerSprite!: Phaser.GameObjects.Sprite;
  private readonly enemySprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly projectileSprites = new Map<
    string,
    Phaser.GameObjects.Sprite
  >();
  private readonly projectileTrails = new Map<
    string,
    Phaser.GameObjects.Particles.ParticleEmitter
  >();
  private readonly pickupSprites = new Map<string, Phaser.GameObjects.Sprite>();
  private readonly doorSprites = new Map<
    string,
    { rect: Phaser.GameObjects.Rectangle; label: Phaser.GameObjects.Text }
  >();

  // Shadows & lighting
  private playerShadow!: Phaser.GameObjects.Ellipse;
  private readonly enemyShadows = new Map<string, Phaser.GameObjects.Ellipse>();
  private playerLight: Phaser.GameObjects.PointLight | null = null;

  // Ambient effects
  private torchEmitters: Phaser.GameObjects.Particles.ParticleEmitter[] = [];
  private dustEmitter: Phaser.GameObjects.Particles.ParticleEmitter | null =
    null;

  private interactJustPressed = false;
  private transitioning = false;

  constructor() {
    super("GameScene");
  }

  create(): void {
    const registry = this.registry.get("assetRegistry");
    if (!(registry instanceof AssetRegistry)) {
      throw new Error("GameScene requires AssetRegistry from BootScene.");
    }

    this.assetRegistry = registry;
    this.state = createInitialDungeonState();

    // Systems
    this.playerController = new PlayerController();
    this.combatSystem = new CombatSystem();
    this.enemyAI = new EnemyAI();
    this.pickupSystem = new PickupSystem();
    this.roomManager = new RoomManager();

    // Procedural textures for particles
    generateParticleTextures(this);

    // Background
    this.backgroundSprite = this.add
      .sprite(GAME_CONFIG.width / 2, GAME_CONFIG.height / 2, "__DEFAULT")
      .setDepth(DEPTH.background);

    // Player
    const playerVisual = this.assetRegistry.requireVisual(
      DEMO_ASSET_IDS.player,
    );
    this.playerSprite = this.add
      .sprite(
        this.state.player.x,
        this.state.player.y,
        playerVisual.textureKey,
        playerVisual.frame,
      )
      .setDisplaySize(96, 96)
      .setOrigin(0.5, 0.85)
      .setDepth(DEPTH.player)
      .setTint(0xffddaa);
    idleBreathing(this.playerSprite);

    // Player shadow
    this.playerShadow = this.add
      .ellipse(this.state.player.x, this.state.player.y, 50, 14, 0x000000, 0.25)
      .setDepth(DEPTH.shadows);

    // Camera
    this.cameras.main.startFollow(this.playerSprite, true, 0.08, 0.08);
    this.cameras.main.setDeadzone(60, 40);
    this.cameras.main.setRoundPixels(true);
    this.cameras.main.setBounds(0, 0, GAME_CONFIG.width, GAME_CONFIG.height);
    this.cameras.main.setZoom(1.15);

    // Dark overlay
    this.add
      .rectangle(
        GAME_CONFIG.width / 2,
        GAME_CONFIG.height / 2,
        GAME_CONFIG.width,
        GAME_CONFIG.height,
        0x000000,
        0.35,
      )
      .setDepth(DEPTH.effects - 1)
      .setScrollFactor(0);

    // Point lights (WebGL only)
    if (this.game.renderer.type === Phaser.WEBGL) {
      this.add.pointlight(80, GAME_CONFIG.height - 20, 0xffaa44, 200, 0.6);
      this.add.pointlight(
        GAME_CONFIG.width - 80,
        GAME_CONFIG.height - 20,
        0xffaa44,
        200,
        0.6,
      );
      this.playerLight = this.add.pointlight(
        this.state.player.x,
        this.state.player.y,
        0xffeedd,
        160,
        0.4,
      );
    }

    // UI
    this.hud = new Hud(this, this.assetRegistry);
    this.bossHealthBar = new BossHealthBar(this);

    // Screen effects
    vignette(this);
    this.lowHpFx = lowHpOverlay(this);

    // Controls
    this.controls = this.bindControls();

    this.input.keyboard!.on("keydown-ESC", () => {
      if (this.scale.isFullscreen) this.scale.stopFullscreen();
    });
    this.controls.fullscreen.on("down", () => this.scale.toggleFullscreen());

    // Track interact key press (single-fire)
    this.controls.interact.on("down", () => {
      this.interactJustPressed = true;
    });

    // Load first room
    this.roomManager.loadRoom(this.state, "crypt_entrance");
    this.applyRoomVisuals("crypt_entrance");
    showRoomTitle(this, "crypt_entrance");

    this.hud.update(this.state);
    this.installAutomationHooks();
  }

  update(_time: number, delta: number): void {
    if (this.transitioning) return;

    // Restart on R when dead
    if (this.controls.restart.isDown && this.state.mode === "gameover") {
      this.restartGame();
      return;
    }

    this.stepFrame(delta);
  }

  private stepFrame(deltaMs: number): void {
    const pointer = this.input.activePointer;

    // Gather input
    const input: PlayerInput = {
      left: this.controls.left.isDown || this.controls.leftAlt.isDown,
      right: this.controls.right.isDown || this.controls.rightAlt.isDown,
      up: this.controls.up.isDown || this.controls.upAlt.isDown,
      down: this.controls.down.isDown || this.controls.downAlt.isDown,
      mouseX: pointer.worldX,
      mouseY: pointer.worldY,
      mouseDown: pointer.isDown,
      interactPressed: this.interactJustPressed,
    };
    this.interactJustPressed = false;

    // 1. Player controller
    const pcResult = this.playerController.update(this.state, deltaMs, input);

    // 2. Handle melee attack
    if (pcResult.meleeAttack) {
      const meleeResult = this.combatSystem.meleeAttack(this.state);
      this.processHitEffects(meleeResult.hitEffects);
    }

    // 3. Handle bolt fire
    if (pcResult.boltFired) {
      this.combatSystem.fireBolt(this.state, pointer.worldX, pointer.worldY);
    }

    // 4. Enemy AI
    const aiResult = this.enemyAI.update(this.state, deltaMs);
    for (const enemy of aiResult.spawnEnemies) {
      this.state.enemies.push(enemy);
    }
    for (const proj of aiResult.spawnProjectiles) {
      this.state.projectiles.push(proj);
    }

    // 5. Combat system (projectile movement, collision)
    const combatResult = this.combatSystem.update(this.state, deltaMs);
    this.processHitEffects(combatResult.hitEffects);
    this.processDeaths(combatResult.killedEnemyIds, combatResult.killedEnemies);

    if (combatResult.playerDamaged) {
      cameraShake(this.cameras.main);
      damageFlash(this.cameras.main);
      damageOverlay(this);
    }

    // 6. Pickup system
    const pickupResult = this.pickupSystem.update(this.state);
    for (const collected of pickupResult.collected) {
      const sprite = this.pickupSprites.get(
        [...this.pickupSprites.entries()].find(
          ([, s]) =>
            Math.abs(s.x - collected.x) < 2 && Math.abs(s.y - collected.y) < 2,
        )?.[0] ?? "",
      );
      if (sprite) {
        sprite.destroy();
      }
    }

    // 7. Door transition
    if (pcResult.interactedDoor) {
      this.handleDoorTransition(pcResult.interactedDoor.targetRoom);
      return;
    }

    // 8. Check boss defeated / victory
    if (this.roomManager.checkBossDefeated(this.state)) {
      this.state.bossDefeated = true;
      this.state.mode = "victory";
      this.bossHealthBar.hide();
      this.time.delayedCall(1500, () => {
        this.scene.start("VictoryScene", {
          score: this.state.score,
          kills: this.state.kills,
          gold: this.state.inventory.gold,
          roomsCleared: this.state.roomsCleared.size + 1,
        });
      });
      return;
    }

    // 9. Game over overlay
    if (this.state.mode === "gameover" && !this.gameOverOverlay) {
      this.gameOverOverlay = new GameOverOverlay(this, this.state);
    }

    // 10. Update elapsed
    this.state.elapsedMs += deltaMs;

    // Sync all sprites
    this.syncSprites();

    // Update player rotation
    const angle = Math.atan2(
      pointer.worldY - this.state.player.y,
      pointer.worldX - this.state.player.x,
    );
    this.playerSprite.setRotation(angle + Math.PI / 2);

    // Update UI
    this.hud.update(this.state);
    this.lowHpFx.update(this.state.player.hp / this.state.player.maxHp < 0.3);

    // Boss health bar
    const boss = this.state.enemies.find((e) => e.kind === "boss");
    if (boss) {
      this.bossHealthBar.show();
      this.bossHealthBar.update(boss.hp, boss.maxHp);
    } else {
      this.bossHealthBar.hide();
    }
  }

  private syncSprites(): void {
    // Player
    this.playerSprite.setPosition(this.state.player.x, this.state.player.y);
    this.playerSprite.setDepth(100 + this.state.player.y);
    this.playerShadow.setPosition(this.state.player.x, this.state.player.y);
    if (this.playerLight) {
      this.playerLight.setPosition(this.state.player.x, this.state.player.y);
    }

    // Enemies
    const aliveEnemyIds = new Set(this.state.enemies.map((e) => e.id));
    for (const [id, sprite] of this.enemySprites.entries()) {
      if (!aliveEnemyIds.has(id)) {
        sprite.destroy();
        this.enemySprites.delete(id);
        const shadow = this.enemyShadows.get(id);
        if (shadow) {
          shadow.destroy();
          this.enemyShadows.delete(id);
        }
      }
    }
    for (const enemy of this.state.enemies) {
      let sprite = this.enemySprites.get(enemy.id);
      if (!sprite) {
        const visual = this.assetRegistry.requireVisual(enemy.visualId);
        const size =
          enemy.kind === "boss" ? 160 : enemy.kind === "skeleton" ? 96 : 80;
        sprite = this.add
          .sprite(enemy.x, enemy.y, visual.textureKey, visual.frame)
          .setDisplaySize(size, size)
          .setOrigin(0.5, 0.85)
          .setDepth(DEPTH.enemies)
          .setTint(0xffddaa);
        enemyBob(sprite);
        this.enemySprites.set(enemy.id, sprite);
        // Enemy shadow
        const enemyShadow = this.add
          .ellipse(enemy.x, enemy.y, 40, 12, 0x000000, 0.2)
          .setDepth(DEPTH.shadows);
        this.enemyShadows.set(enemy.id, enemyShadow);
      }
      sprite.setPosition(enemy.x, enemy.y);
      sprite.setDepth(100 + enemy.y);
      const shadow = this.enemyShadows.get(enemy.id);
      if (shadow) shadow.setPosition(enemy.x, enemy.y);
    }

    // Projectiles
    const liveProjectileIds = new Set(this.state.projectiles.map((p) => p.id));
    for (const [id, sprite] of this.projectileSprites.entries()) {
      if (!liveProjectileIds.has(id)) {
        sprite.destroy();
        this.projectileSprites.delete(id);
        const trail = this.projectileTrails.get(id);
        if (trail) {
          trail.destroy();
          this.projectileTrails.delete(id);
        }
      }
    }
    for (const proj of this.state.projectiles) {
      let sprite = this.projectileSprites.get(proj.id);
      if (!sprite) {
        const visual = this.assetRegistry.requireVisual(proj.visualId);
        const size = proj.fromEnemy ? 48 : 32;
        sprite = this.add
          .sprite(proj.x, proj.y, visual.textureKey, visual.frame)
          .setDisplaySize(size, size)
          .setDepth(DEPTH.projectiles);
        this.projectileSprites.set(proj.id, sprite);
        // Trail
        const tint = proj.fromEnemy ? 0xff6622 : 0x88ccff;
        const trail = projectileTrail(this, sprite, tint);
        this.projectileTrails.set(proj.id, trail);
      }
      sprite.setPosition(proj.x, proj.y);
    }

    // Pickups
    const livePickupIds = new Set(this.state.pickups.map((p) => p.id));
    for (const [id, sprite] of this.pickupSprites.entries()) {
      if (!livePickupIds.has(id)) {
        sprite.destroy();
        this.pickupSprites.delete(id);
      }
    }
    for (const pickup of this.state.pickups) {
      if (!this.pickupSprites.has(pickup.id)) {
        const visual = this.assetRegistry.requireVisual(pickup.visualId);
        const sprite = this.add
          .sprite(pickup.x, pickup.y, visual.textureKey, visual.frame)
          .setDisplaySize(40, 40)
          .setDepth(DEPTH.pickups);
        pickupBob(sprite);
        this.pickupSprites.set(pickup.id, sprite);
      }
    }

    // Doors
    for (const door of this.state.doors) {
      let entry = this.doorSprites.get(door.id);
      if (!entry) {
        const rect = this.add
          .rectangle(
            door.x + door.width / 2,
            door.y + door.height / 2,
            door.width,
            door.height,
          )
          .setDepth(DEPTH.pickups);
        const label = this.add
          .text(door.x + door.width / 2, door.y + door.height / 2, "", {
            fontSize: "12px",
            color: "#ffffff",
            align: "center",
          })
          .setOrigin(0.5)
          .setDepth(DEPTH.pickups + 1);
        entry = { rect, label };
        this.doorSprites.set(door.id, entry);
      }
      const color =
        door.state === "locked"
          ? 0x882222
          : door.state === "unlocked"
            ? 0x228822
            : 0x226688;
      entry.rect.setFillStyle(color, 0.8);
      entry.label.setText(
        door.state === "locked"
          ? "Locked"
          : door.state === "unlocked"
            ? "Press E"
            : "Open",
      );
    }
  }

  private processHitEffects(
    effects: Array<{ x: number; y: number; type: string }>,
  ): void {
    for (const fx of effects) {
      const tint =
        fx.type === "slash"
          ? 0xffffff
          : fx.type === "fireball"
            ? 0xff4422
            : 0x88ccff;
      hitSparks(this, fx.x, fx.y, tint);
      showDamageNumber(
        this,
        fx.x,
        fx.y - 20,
        fx.type === "slash"
          ? TUNING.player.meleeDamage
          : TUNING.player.boltDamage,
        fx.type === "fireball",
      );

      // Flash nearest enemy sprite
      let closestDist = Infinity;
      let closestSprite: Phaser.GameObjects.Sprite | null = null;
      for (const sprite of this.enemySprites.values()) {
        const dx = sprite.x - fx.x;
        const dy = sprite.y - fx.y;
        const dist = dx * dx + dy * dy;
        if (dist < closestDist) {
          closestDist = dist;
          closestSprite = sprite;
        }
      }
      if (closestSprite && closestDist < 80 * 80) {
        hitFlash(closestSprite);
      }
    }
  }

  private processDeaths(
    killedIds: string[],
    killedEnemies: EnemyState[],
  ): void {
    for (const id of killedIds) {
      const sprite = this.enemySprites.get(id);
      if (sprite) {
        deathBurst(this, sprite.x, sprite.y);
        deathAnimation(sprite);
        this.enemySprites.delete(id);
        const shadow = this.enemyShadows.get(id);
        if (shadow) {
          shadow.destroy();
          this.enemyShadows.delete(id);
        }
      }
    }

    // Spawn split slimes for killed slimes
    for (const dead of killedEnemies) {
      const splits = this.enemyAI.spawnSplitSlimes(dead);
      for (const s of splits) {
        this.state.enemies.push(s);
      }
    }
  }

  private async handleDoorTransition(targetRoom: RoomId): Promise<void> {
    this.transitioning = true;
    this.state.mode = "room_transition";

    await roomTransitionFade(this.cameras.main);

    // Clear current room sprites
    this.clearRoomSprites();
    this.state.roomsCleared.add(this.state.currentRoom);
    this.roomManager.loadRoom(this.state, targetRoom);
    this.applyRoomVisuals(targetRoom);
    this.state.mode = "playing";
    this.transitioning = false;

    showRoomTitle(this, targetRoom);
  }

  private applyRoomVisuals(roomId: RoomId): void {
    const config = this.roomManager.getRoomConfig(roomId);
    if (!config) return;

    const visual = this.assetRegistry.requireVisual(config.backgroundAssetId);
    this.backgroundSprite.setTexture(visual.textureKey, visual.frame);

    // Scale background to cover
    const frame = this.textures.getFrame(visual.textureKey, visual.frame);
    if (frame && frame.width > 0 && frame.height > 0) {
      const scale = Math.max(
        GAME_CONFIG.width / frame.width,
        GAME_CONFIG.height / frame.height,
      );
      this.backgroundSprite.setScale(scale);
    } else {
      this.backgroundSprite.setDisplaySize(
        GAME_CONFIG.width,
        GAME_CONFIG.height,
      );
    }

    // Clear and recreate ambient effects
    this.clearAmbientEffects();
    this.torchEmitters.push(
      torchEmbers(this, 80, GAME_CONFIG.height - 20),
      torchEmbers(this, GAME_CONFIG.width - 80, GAME_CONFIG.height - 20),
    );
    this.dustEmitter = ambientDust(this, GAME_CONFIG.width, GAME_CONFIG.height);
  }

  private clearRoomSprites(): void {
    for (const sprite of this.enemySprites.values()) sprite.destroy();
    this.enemySprites.clear();
    for (const shadow of this.enemyShadows.values()) shadow.destroy();
    this.enemyShadows.clear();
    for (const sprite of this.projectileSprites.values()) sprite.destroy();
    this.projectileSprites.clear();
    for (const trail of this.projectileTrails.values()) trail.destroy();
    this.projectileTrails.clear();
    for (const sprite of this.pickupSprites.values()) sprite.destroy();
    this.pickupSprites.clear();
    for (const entry of this.doorSprites.values()) {
      entry.rect.destroy();
      entry.label.destroy();
    }
    this.doorSprites.clear();
  }

  private clearAmbientEffects(): void {
    for (const e of this.torchEmitters) e.destroy();
    this.torchEmitters = [];
    if (this.dustEmitter) {
      this.dustEmitter.destroy();
      this.dustEmitter = null;
    }
  }

  private restartGame(): void {
    this.clearRoomSprites();
    this.clearAmbientEffects();
    if (this.gameOverOverlay) {
      this.gameOverOverlay.destroy();
      this.gameOverOverlay = null;
    }
    this.bossHealthBar.hide();

    this.state = createInitialDungeonState();
    this.roomManager.loadRoom(this.state, "crypt_entrance");
    this.applyRoomVisuals("crypt_entrance");
    this.playerSprite.setPosition(this.state.player.x, this.state.player.y);
    this.hud.update(this.state);
    showRoomTitle(this, "crypt_entrance");
  }

  private bindControls(): Controls {
    const kb = this.input.keyboard;
    if (!kb) throw new Error("Keyboard input unavailable in GameScene.");

    return {
      up: kb.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: kb.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: kb.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: kb.addKey(Phaser.Input.Keyboard.KeyCodes.D),
      upAlt: kb.addKey(Phaser.Input.Keyboard.KeyCodes.UP),
      downAlt: kb.addKey(Phaser.Input.Keyboard.KeyCodes.DOWN),
      leftAlt: kb.addKey(Phaser.Input.Keyboard.KeyCodes.LEFT),
      rightAlt: kb.addKey(Phaser.Input.Keyboard.KeyCodes.RIGHT),
      interact: kb.addKey(Phaser.Input.Keyboard.KeyCodes.E),
      restart: kb.addKey(Phaser.Input.Keyboard.KeyCodes.R),
      fullscreen: kb.addKey(Phaser.Input.Keyboard.KeyCodes.F),
    };
  }

  // ── Automation hooks ──

  advanceTime(ms: number): void {
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    const stepMs = ms / steps;
    for (let i = 0; i < steps; i++) this.stepFrame(stepMs);
  }

  renderGameToText(): string {
    return JSON.stringify({
      mode: this.state.mode,
      currentRoom: this.state.currentRoom,
      player: {
        x: r2(this.state.player.x),
        y: r2(this.state.player.y),
        hp: r2(this.state.player.hp),
        maxHp: this.state.player.maxHp,
      },
      enemies: this.state.enemies.map((e) => ({
        id: e.id,
        kind: e.kind,
        x: r2(e.x),
        y: r2(e.y),
        hp: r2(e.hp),
      })),
      projectiles: this.state.projectiles.length,
      pickups: this.state.pickups.length,
      inventory: this.state.inventory,
      score: this.state.score,
      kills: this.state.kills,
      bossDefeated: this.state.bossDefeated,
    });
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

function r2(v: number): number {
  return Math.round(v * 100) / 100;
}
