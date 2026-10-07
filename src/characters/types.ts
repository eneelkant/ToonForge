export interface CharacterRecord {
  character_id: string;
  display_name: string;
  canonical_description: string;
  visual_reference?: string;
  omnichar_artifact?: string | null;
  voice: {
    provider?: string;
    voice_id?: string;
    style_notes?: string;
  };
  personality: string[];
  wardrobe: string[];
  allowed_styles: string[];
  consistency: {
    lock_face: boolean;
    lock_palette: boolean;
    max_drift_score?: number;
  };
  version: string;
  created_at: string;
  updated_at: string;
}

export interface CharacterRegistry {
  create(input: Omit<CharacterRecord, "created_at" | "updated_at">): Promise<CharacterRecord>;
  get(characterId: string): Promise<CharacterRecord | null>;
  list(): Promise<CharacterRecord[]>;
  update(characterId: string, patch: Partial<CharacterRecord>): Promise<CharacterRecord>;
  validate(character: CharacterRecord): Promise<{ ok: boolean; errors: string[] }>;
  resolve_for_story(storyNeeds: {
    roles: string[];
    preferredIds?: string[];
  }): Promise<CharacterRecord[]>;
}
