import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ToonForgeError } from "../core/errors.js";
import type { CharacterRecord, CharacterRegistry } from "./types.js";

export class FileCharacterRegistry implements CharacterRegistry {
  constructor(private readonly rootDir: string) {
    mkdirSync(this.rootDir, { recursive: true });
  }

  private dirFor(id: string): string {
    return join(this.rootDir, id);
  }

  private pathFor(id: string): string {
    return join(this.dirFor(id), "character.json");
  }

  async create(input: Omit<CharacterRecord, "created_at" | "updated_at">): Promise<CharacterRecord> {
    const now = new Date().toISOString();
    const record: CharacterRecord = { ...input, created_at: now, updated_at: now };
    const validation = await this.validate(record);
    if (!validation.ok) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: "Character validation failed",
        component: "characters.registry",
        context: { errors: validation.errors },
      });
    }
    if (existsSync(this.pathFor(record.character_id))) {
      throw new ToonForgeError({
        code: "DUPLICATE",
        message: `Character already exists: ${record.character_id}`,
        component: "characters.registry",
      });
    }
    mkdirSync(this.dirFor(record.character_id), { recursive: true });
    writeFileSync(this.pathFor(record.character_id), JSON.stringify(record, null, 2));
    return record;
  }

  async get(characterId: string): Promise<CharacterRecord | null> {
    const path = this.pathFor(characterId);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as CharacterRecord;
  }

  async list(): Promise<CharacterRecord[]> {
    if (!existsSync(this.rootDir)) return [];
    const out: CharacterRecord[] = [];
    for (const name of readdirSync(this.rootDir, { withFileTypes: true })) {
      if (!name.isDirectory()) continue;
      const record = await this.get(name.name);
      if (record) out.push(record);
    }
    return out.sort((a, b) => a.character_id.localeCompare(b.character_id));
  }

  async update(characterId: string, patch: Partial<CharacterRecord>): Promise<CharacterRecord> {
    const existing = await this.get(characterId);
    if (!existing) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: `Character not found: ${characterId}`,
        component: "characters.registry",
      });
    }
    const next: CharacterRecord = {
      ...existing,
      ...patch,
      character_id: existing.character_id,
      updated_at: new Date().toISOString(),
    };
    const validation = await this.validate(next);
    if (!validation.ok) {
      throw new ToonForgeError({
        code: "VALIDATION_FAILED",
        message: "Character validation failed",
        component: "characters.registry",
        context: { errors: validation.errors },
      });
    }
    writeFileSync(this.pathFor(characterId), JSON.stringify(next, null, 2));
    return next;
  }

  async validate(character: CharacterRecord): Promise<{ ok: boolean; errors: string[] }> {
    const errors: string[] = [];
    if (!character.character_id?.trim()) errors.push("character_id required");
    if (!character.display_name?.trim()) errors.push("display_name required");
    if (!character.canonical_description?.trim()) errors.push("canonical_description required");
    if (!character.version?.trim()) errors.push("version required");
    return { ok: errors.length === 0, errors };
  }

  async resolve_for_story(storyNeeds: {
    roles: string[];
    preferredIds?: string[];
  }): Promise<CharacterRecord[]> {
    const all = await this.list();
    if (storyNeeds.preferredIds?.length) {
      const byId = new Map(all.map((c) => [c.character_id, c]));
      const preferred = storyNeeds.preferredIds
        .map((id) => byId.get(id))
        .filter((c): c is NonNullable<typeof c> => Boolean(c));
      if (preferred.length > 0) return preferred;
    }
    // Never invent random replacements when canonical characters exist.
    return all.slice(0, Math.max(1, storyNeeds.roles.length || 1));
  }
}

export function defaultCharacterRegistry(cwd = process.cwd()): FileCharacterRegistry {
  if (process.env.TOONFORGE_CHARACTERS_DIR) {
    return new FileCharacterRegistry(resolve(process.env.TOONFORGE_CHARACTERS_DIR));
  }
  const local = resolve(cwd, "characters");
  if (existsSync(local)) return new FileCharacterRegistry(local);
  const bundled = resolve(dirname(fileURLToPath(import.meta.url)), "../../characters");
  return new FileCharacterRegistry(existsSync(bundled) ? bundled : local);
}
