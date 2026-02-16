import { DEMO_ASSET_IDS, GAME_CONFIG } from "../constants";
import type { RoomConfig } from "../types";

const W = GAME_CONFIG.width;
const H = GAME_CONFIG.height;

export const ROOM_CONFIGS: Record<string, RoomConfig> = {
  crypt_entrance: {
    id: "crypt_entrance",
    backgroundAssetId: DEMO_ASSET_IDS.roomCryptEntrance,
    enemies: [
      { kind: "skeleton", x: 200, y: 180 },
      { kind: "skeleton", x: W - 200, y: 180 },
      { kind: "skeleton", x: W / 2, y: 140 },
    ],
    pickups: [{ kind: "key", x: W / 2, y: 100 }],
    doors: [
      {
        x: W / 2 - 30,
        y: 0,
        width: 60,
        height: 20,
        targetRoom: "treasure_hall",
        requiresKey: true,
        startsLocked: true,
      },
    ],
    playerSpawn: { x: W / 2, y: H - 60 },
    isBossRoom: false,
  },

  treasure_hall: {
    id: "treasure_hall",
    backgroundAssetId: DEMO_ASSET_IDS.roomTreasureHall,
    enemies: [
      { kind: "slime", x: 180, y: 200 },
      { kind: "slime", x: W - 180, y: 200 },
      { kind: "slime", x: 300, y: 300 },
      { kind: "slime", x: W - 300, y: 300 },
    ],
    pickups: [
      { kind: "health_potion", x: W / 2, y: H / 2 },
      { kind: "gold", x: 120, y: H / 2 },
      { kind: "gold", x: W - 120, y: H / 2 },
    ],
    doors: [
      {
        x: W / 2 - 30,
        y: 0,
        width: 60,
        height: 20,
        targetRoom: "throne_room",
        requiresKey: false,
        startsLocked: false,
      },
    ],
    playerSpawn: { x: W / 2, y: H - 60 },
    isBossRoom: false,
  },

  throne_room: {
    id: "throne_room",
    backgroundAssetId: DEMO_ASSET_IDS.roomThroneRoom,
    enemies: [{ kind: "boss", x: W / 2, y: 160 }],
    pickups: [
      { kind: "gold", x: W / 2 - 60, y: H / 2 },
      { kind: "gold", x: W / 2 + 60, y: H / 2 },
    ],
    doors: [],
    playerSpawn: { x: W / 2, y: H - 60 },
    isBossRoom: true,
  },
};
