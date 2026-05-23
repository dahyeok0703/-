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
    stage_progress_pct: number;
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

export interface SaveData {
  slot: string;
  createdAt: string;
  updatedAt: string;
  turn: number;
  character: CharacterState;
  relationships: Record<string, RelationshipEntry>;
  gameTime: GameTime;
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
  eventLogs?: Array<{ title: string; content: string; importance: number; tags?: string[] }>;
  unresolvedThreads?: Array<{ title: string; content: string; importance: number }>;
  summary?: string;
}
