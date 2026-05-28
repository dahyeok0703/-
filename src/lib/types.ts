// 핵심 타입 정의

export type Role = "user" | "assistant" | "system";

export interface ChatMessage {
  id: string;
  role: Role;
  content: string;
  createdAt: string;
}

export type MemoryType =
  | "player_state"
  | "npc_memory"
  | "faction_memory"
  | "location_memory"
  | "event_log"
  | "unresolved_threads"
  | "inventory_memory"
  | "combat_memory"
  | "summary_memory";

export interface LongTermMemory {
  id: string;
  type: MemoryType;
  title: string;
  content: string;
  relatedCharacters: string[];
  relatedFactions: string[];
  relatedLocations: string[];
  importance: number; // 1-10
  createdAt: string;
  updatedAt: string;
  lastAccessedAt: string;
}

export interface CharacterState {
  identity: {
    name: string;
    gender: string;
    age: number;
    birthplace?: string;
    family_background?: string;
    appearance?: string;
  };
  civilian_or_martial: "civilian" | "martial";
  realm: {
    current_realm: string;
    current_stage: string;
    tier: number;
    internal_energy: number;
    internal_energy_cap: number;
    experience_in_stage: number;
    stage_progress_pct: number;
    awaiting_enlightenment?: boolean;
  };
  stats: Record<string, number>;
  vitals: {
    hp_current: number;
    hp_max: number;
    internal_injury: number;
    external_injury: number;
    mental_state: string;
    status_effects: string[];
  };
  martial_arts_known: Array<{ art_id: string; mastery_pct: number }>;
  weapons_owned: string[];
  inventory: { silver_taels: number; gold_taels: number; items: string[] };
  affiliation: {
    sect_id: string | null;
    rank: string | null;
    joined_at_age: number | null;
    standing: number;
  };
  reputation: Record<string, number | string[]>;
  family_status: {
    father_alive: boolean;
    mother_alive: boolean;
    siblings: string[];
    spouse: string | null;
    concubines: string[];
    children: string[];
  };
  current_location_id: string | null;
  alive: boolean;
  biography_summary: string;
}

export interface GameTime {
  year: number;     // 강호력 N년
  month: number;    // 1-12
  day: number;      // 1-30
  sichen: string;   // 자/축/인/묘/진/사/오/미/신/유/술/해
}

export interface CustomWeaponEntry {
  id: string;
  name: string;
  type: string;
  rarity: string;
  effect: string;
  origin?: string; // 어떻게 얻었/만들었는지
}

export interface CustomArtEntry {
  id: string;
  name: string;
  grade: string;
  type: string;
  weapon: string;
  description: string;
  side_effects?: string;
  origin?: string;
}

export interface CustomCatalog {
  weapons: CustomWeaponEntry[];
  arts: CustomArtEntry[];
}

export interface UpcomingEvent {
  id: string;
  title: string;
  description: string;
  date: { year: number; month: number; day: number };
  location?: string;
  importance: number; // 1-10
  status: "scheduled" | "ongoing" | "done" | "cancelled";
}

// 런타임 세계 델타 — AI 가 만들어낸 새 인물·단체·관계·사건·소문 등을 영구 보존.
export interface RuntimeNpc {
  id: string;
  name: string;
  aliases?: string[];
  age?: number | string;
  faction?: string;
  sect?: string;
  region?: string;
  role?: string;
  realm?: string;
  personality?: string;
  specialty?: string;
  secret?: string;
  location?: string;
  importance?: number;
  origin_turn?: number;
  notes?: string;
}

export interface RuntimeRelation {
  id: string;
  from: string;
  to: string;
  relationType: string;
  affinity?: number;
  trust?: number;
  fear?: number;
  respect?: number;
  publicReason?: string;
  hiddenReason?: string;
  knownToPlayer?: boolean;
  lastChangedTurn?: number;
}

export interface RuntimeEvent {
  id: string;
  title: string;
  description?: string;
  date?: { year: number; month: number; day: number };
  participants?: string[];
  location?: string;
  importance?: number;
  origin_turn?: number;
}

export interface RuntimeRumor {
  id: string;
  content: string;
  about?: string[];
  region?: string;
  reliability?: number;
  origin_turn?: number;
}

export interface SupremeRankState {
  group: "yukcheon" | "ohwang" | "palwang" | "chilseong";
  slotId: string;
  currentHolderId: string;
  previousHolderIds: string[];
  title?: string;
  legitimacy?: number;
  contested?: boolean;
  changedAtTurn?: number;
  reason?: string;
}

export interface RuntimeWorldDelta {
  generatedNpcs: RuntimeNpc[];
  generatedFactions: Array<{ id: string; name: string; alignment?: string; summary?: string; origin_turn?: number }>;
  generatedSects: Array<{ id: string; name: string; faction?: string; location?: string; specialty?: string; origin_turn?: number }>;
  generatedRegions: Array<{ id: string; name: string; scope?: string; atmosphere?: string; origin_turn?: number }>;
  generatedItems: Array<{ id: string; name: string; rarity?: string; effect?: string; origin_turn?: number }>;
  generatedMartialArts: Array<{ id: string; name: string; grade?: string; type?: string; description?: string; origin_turn?: number }>;
  generatedRelations: RuntimeRelation[];
  generatedEvents: RuntimeEvent[];
  generatedConflicts: Array<{ id: string; title: string; type?: string; tension?: number; stage?: string; participants?: string[]; summary?: string; origin_turn?: number }>;
  rumors: RuntimeRumor[];
  titleChanges: Array<{ entityId: string; newTitle?: string; removedTitle?: string; turn: number; reason?: string }>;
  rankState: SupremeRankState[];
  playerHistory: Array<{ turn: number; entry: string }>;
  updatedAt: string;
}

export interface SaveData {
  slot: string;
  createdAt: string;
  updatedAt: string;
  turn: number;
  character: CharacterState;
  relationships: Record<string, RelationshipEntry>;
  gameTime: GameTime;
  customCatalog?: CustomCatalog;
  upcomingEvents?: UpcomingEvent[];
  runtimeDelta?: RuntimeWorldDelta;
  worldStateOverrides: {
    npc_overrides: Record<string, unknown>;
    sect_overrides: Record<string, unknown>;
    global_events_caused_by_player: string[];
    current_in_world_year: number;
  };
}

export interface RelationshipEntry {
  name: string;
  type: string;
  affinity: number;
  trust: number;
  last_met_age: number | null;
  key_events: string[];
  status: "alive" | "dead" | "missing";
}

export interface UsageRecord {
  id: string;
  createdAt: string;
  requestType: "chat" | "summary" | "important";
  model: string;
  input_tokens: number;
  output_tokens: number;
  total_tokens: number;
  estimated_cost_usd: number;
}

export interface ExtractedUpdates {
  playerUpdates?: Array<{ field: string; value: unknown; reason?: string }>;
  npcUpdates?: Array<{
    npc_id: string;
    name?: string;
    affinity_delta?: number;
    trust_delta?: number;
    status?: "alive" | "dead" | "missing";
    note?: string;
  }>;
  factionUpdates?: Array<{ faction_id: string; note: string }>;
  locationUpdates?: Array<{ location_id: string; note: string }>;
  inventoryUpdates?: Array<{ action: "add" | "remove" | "change"; item: string; qty?: number }>;
  weaponUpdates?: Array<{ action: "add" | "remove"; weapon: string }>;
  createdWeapons?: Array<{ name: string; type?: string; rarity?: string; effect?: string; origin?: string }>;
  createdArts?: Array<{ name: string; grade?: string; type?: string; weapon?: string; description?: string; side_effects?: string; origin?: string }>;
  martialArtUpdates?: Array<{
    action: "add" | "remove" | "change";
    name?: string;
    art_id?: string;
    mastery_pct?: number;
    mastery_delta?: number;
  }>;
  reputationUpdates?: Array<{ field: string; delta?: number; value?: number }>;
  statUpdates?: Array<{ stat: string; delta?: number; value?: number; reason?: string }>;
  titleAdds?: string[];
  titleRemoves?: string[];
  familyUpdates?: Array<{
    field: string;
    action?: "set" | "add" | "remove";
    value?: unknown;
  }>;
  eventLogs?: Array<{ title: string; content: string; importance: number; tags?: string[] }>;
  unresolvedThreads?: Array<{ title: string; content: string; importance: number }>;
  timeAdvance?: Record<string, unknown>;
  // WORLD_PATCH: AI 가 응답 중 만들어낸 새 세계 데이터.
  worldPatch?: {
    newNpcs?: RuntimeNpc[];
    newFactions?: Array<{ id?: string; name: string; alignment?: string; summary?: string }>;
    newSects?: Array<{ id?: string; name: string; faction?: string; location?: string; specialty?: string }>;
    newRegions?: Array<{ id?: string; name: string; scope?: string; atmosphere?: string }>;
    newItems?: Array<{ id?: string; name: string; rarity?: string; effect?: string }>;
    newMartialArts?: Array<{ id?: string; name: string; grade?: string; type?: string; description?: string }>;
    newRelations?: RuntimeRelation[];
    newEvents?: RuntimeEvent[];
    newConflicts?: Array<{ id?: string; title: string; type?: string; tension?: number; stage?: string; participants?: string[]; summary?: string }>;
    rumors?: Array<{ id?: string; content: string; about?: string[]; region?: string; reliability?: number }>;
    updatedRelations?: RuntimeRelation[];
    updatedFactionStates?: Array<{ id: string; field: string; delta?: number; value?: number | string; reason?: string }>;
    rankChanges?: Array<{
      group: "yukcheon" | "ohwang" | "palwang" | "chilseong";
      slotId?: string;
      newHolderId: string;
      previousHolderId?: string;
      title?: string;
      contested?: boolean;
      reason?: string;
    }>;
    playerStateChanges?: Array<{ field: string; value?: unknown; delta?: number; reason?: string }>;
  };
  upcomingEventUpdates?: Array<{
    action: "add" | "update" | "remove";
    id?: string;
    title?: string;
    description?: string;
    year?: number;
    month?: number;
    day?: number;
    location?: string;
    importance?: number;
    status?: "scheduled" | "ongoing" | "done" | "cancelled";
  }>;
  summary?: string;
}
