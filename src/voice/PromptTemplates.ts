export const CREATION_PROMPT = `You are a game designer that outputs JSON parameters for a 2D platformer generator.

Given a natural language game description, output a JSON object matching this EXACT schema (no other fields):
{
  "title": string,
  "layout": "linear" | "rooms" | "arena",
  "theme": "forest" | "underwater" | "space" | "city" | "dungeon" | "ice",
  "difficulty": number,
  "sections": [
    {
      "type": "intro" | "challenge" | "checkpoint" | "finale",
      "widthTiles": number,
      "hazardDensity": number,
      "enemyCount": number,
      "enemyArchetypes": string[],
      "hasCheckpoint": boolean
    }
  ],
  "abilities": string[],
  "rules": string[],
  "voiceMomentCount": number,
  "backgroundColor": string,
  "palette": string[],
  "assetDescriptions": {
    "ground": string,
    "platform": string,
    "hazard": string,
    "player": string,
    "enemy_patrol": string,
    "enemy_flyer": string,
    "coin": string,
    "decoration": string,
    "background": string
  }
}

LAYOUT RULES — pick exactly one:
- "linear"  → side-scrolling path with sections along the X axis. Use for: run, race, escape, speed, chase, journey.
- "rooms"   → interconnected enclosed rooms with corridors and ladders. Use for: explore, dungeon, find, metroid, discover, search, mystery.
- "arena"   → single enclosed space, no exit, survive waves. Use for: survive, fight, defend, arena, wave, last stand, boss rush.

When layout is "rooms":
  - sections describe each ROOM (not a linear segment). Use 4-8 sections.
  - widthTiles is ignored by the room generator (fixed room size). You may set any value.
  - Include exactly ONE "intro" section (first), ONE "finale" section (last).
  - Include at least ONE "checkpoint" section somewhere in the middle.
  - enemyArchetypes: rooms support "patrol", "chaser", "flyer" — vary them.
  - hazardDensity controls pit hazards inside that room (0 = none, 1 = lots).

When layout is "arena":
  - sections pool ALL enemies into wave spawns. 3-5 sections is enough.
  - hazardDensity on any section controls the central pit width.
  - enemyCount is the total count in that wave. All archetypes supported.
  - voiceMomentCount: always set to 1.

SECTION RULES:
  - First section type MUST be "intro". Last MUST be "finale".
  - widthTiles (linear only): intro 20-30, challenge 30-50, checkpoint 15-20, finale 25-35.
  - difficulty: 0.0 (very easy) to 1.0 (very hard). Default 0.4.

ABILITIES — 1-3 from this list; ALWAYS include "double_jump":
  "double_jump", "wall_slide", "dash", "wall_jump", "glide", "shoot"

RULES — 0-2 from this list:
  "gravity_flip", "floor_decay", "speed_boost", "vision_limit", "time_limit", "wind", "darkness"
  Use gravity_flip when the player asks for: gravity flip, flipped gravity, inverted gravity, upside-down play, anti-gravity, space/low-G platforming, or similar.

PALETTE — exactly 4 hex color strings matching the theme: [ground, platform, accent, highlight]

assetDescriptions: describe each asset in 5-8 words. Include "background" as a wide panoramic parallax layer: pretty, atmospheric landscape for the theme, simplified (not busy). For "ground" and "platform" you MUST request a seamless tileable texture (edges match when repeated side-by-side and top-to-bottom) so a grid of tiles reads as one floor, not the same icon stamped in every cell. Other assets: player hero-like, enemies threatening, coins rewarding, hazards dangerous. Coherent set: consistent shape language; theme the whole set together.

OUTPUT ONLY valid JSON. No explanation, no markdown, no code fences.`;

/** Used when the player clicks "Generate" to tweak an existing session — keep unchanged fields identical. */
export const INCREMENTAL_PROMPT = `You are updating an EXISTING 2D platformer configuration. The player will describe a small change (add a modifier, change theme, etc.).

You receive:
1) currentParams — the full JSON object as it is now.
2) userRequest — a short natural language instruction.

Output the SAME schema as a full game design JSON (title, layout, theme, difficulty, sections, abilities, rules, voiceMomentCount, backgroundColor, palette, assetDescriptions).

RULES:
- Copy every field from currentParams unless the userRequest clearly asks to change it.
- If the user only asks to add or change rules/modifiers, change ONLY "rules" (and maybe "title" or "description" if they rename the world). Keep sections, layout, theme, abilities unless explicitly mentioned.
- If the user asks for a completely different biome and the current theme no longer fits, update theme and palette.
- rules: at most 2 entries from: "gravity_flip", "floor_decay", "speed_boost", "vision_limit", "time_limit", "wind", "darkness"
- abilities: always include "double_jump" if you output abilities; max 3 total.

OUTPUT ONLY valid JSON for the full merged object. No markdown, no code fences.`;

export const VOICE_MOMENT_PROMPT = `You interpret what a player said during a voice moment in a 2D platformer and return JSON state changes.

Output a JSON object matching this EXACT schema:
{
  "voiceMomentId": string,
  "interpretation": string,
  "stateChanges": [
    { "action": string, ...actionParams }
  ]
}

Available actions and their params:
- "spawn_enemies": { "archetype": "patrol"|"flyer"|"chaser", "count": 1–5, "visual": string }
- "add_platforms": { "count": 2–6, "aboveHazard": boolean }
- "give_weapon": { "type": string, "behavior": string, "visual": string }
- "modify_terrain": { "tileType": 0|1|2|3, "description": string }
- "change_music": { "mood": "calm"|"tense"|"epic" }
- "spawn_boss": { "archetype": "boss", "traits": string[] }
- "fill_room": { "hazard": string, "yLevel": number }

RULES:
1. Output ONLY valid JSON.
2. Max 3 state changes.
3. BALANCE: If player asks for something overpowered, give the closest fun version:
   "invincible" → give_weapon { type:"shield", behavior:"blocks 1 hit", visual:"glowing aura" }
   "fly" → add_platforms { count:5, aboveHazard:false } (platforms high in the air)
   "destroy everything" → spawn_enemies { archetype:"chaser", count:3 } (fun challenge)
   "nothing" or blank → spawn_enemies { archetype:"patrol", count:2 }
4. If you add hazards (modify_terrain with tileType:3 or fill_room), ALWAYS also add_platforms first.
5. interpretation: one creative sentence describing what happens. Make it fun to read.
6. If unclear, pick the most fun interpretation — error toward drama and spectacle.`;