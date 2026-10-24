/**
 * Forged API client.
 *
 * Typed fetch wrapper for all backend endpoints.
 * C imports this to replace the mock functions in game.js.
 *
 * Usage:
 *   import { roundStart, clerkChat, submitInvoice } from "@/lib/api";
 *   const round = await roundStart(1);
 */

const API_BASE =
  process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";

// ---------------------------------------------------------------------------
// Types (mirrors server/models/schemas.py)
// ---------------------------------------------------------------------------

export interface Vendor {
  name: string;
  domain: string;
  bank: string;
  usual_amount: [number, number];
  icon: string;
  items: [string, number, number][];
}

export interface CaseFile {
  company: string;
  vendors: Vendor[];
  approvers: [string, string][];
  notes: string[];
}

export interface MemoRule {
  text: string;
  real: boolean;
}

export interface Tell {
  tell_type: string;
  strength: number;
  region: string | null;
  description: string | null;
}

export interface InvoiceRecord {
  level: number;
  scheme: string;
  vendor: string;
  amount: number;
  bank_account: string;
  sender_domain: string;
  invoice_no: string;
  po_number: string;
  date: string;
  line_items: string[];
  field_altered: string[];
  legibility: Record<string, number>;
  scan_quality: number;
  copy_generation: number;
  stamp_type: string[];
  stamp_position: [number, number][];
  domain_mismatch: boolean;
  letterhead_match: boolean;
  cover_email: string;
  heat: number;
}

export interface RoundStartResponse {
  round_id: string;
  session_id: string;
  memo: MemoRule[];
  inspector_version: number;
  case_file: CaseFile;
}

export interface ClerkResponse {
  reply: string;
  persuasion_score: number;
}

export interface ClerkVoiceResponse {
  transcript: string;
  reply: string;
  persuasion_score: number;
  reply_audio_b64: string | null;
}

export interface NpcChatResponse {
  reply: string;
  npc_name: string;
  persuasion_delta: number;
  suspicion_delta: number;
  intel: string | null;
  effect: string;
}

export interface NpcVoiceResponse extends NpcChatResponse {
  transcript: string;
  reply_audio_b64: string | null;
}

export interface SubmitResponse {
  verdict: "PAID" | "FLAGGED";
  top_tells: Tell[];
  inspector_line: string;
  payout: number;
  new_version: number;
}

export interface PatchNote {
  version: number;
  learned: string[];
  invoices_trained_on: number;
}

export interface VersionMetrics {
  version: number;
  catch_rate: number;
  false_positive_rate: number;
  held_out_catch_rate: number;
}

export interface LeaderboardEntry {
  player: string;
  money: number;
  patches_caused: number;
}

// ---------------------------------------------------------------------------
// Fetch helpers
// ---------------------------------------------------------------------------

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text);
  }
  return res.json() as Promise<T>;
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`);
  if (!res.ok) {
    const text = await res.text();
    throw new ApiError(res.status, text);
  }
  return res.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// API functions
// ---------------------------------------------------------------------------

/** Start a new round. Replaces dealMemo() in game.js. */
export function roundStart(
  level: number,
  sessionId?: string,
): Promise<RoundStartResponse> {
  return post("/round/start", { level, session_id: sessionId });
}

/** Send a message to the clerk NPC. Replaces clerk keyword matching in game.js. */
export function clerkChat(
  roundId: string,
  text: string,
): Promise<ClerkResponse> {
  return post("/clerk", { round_id: roundId, text });
}

/**
 * Send a voice message to the clerk NPC (Deepgram STT → clerk logic → Deepgram TTS).
 * The audio should be base64-encoded webm/opus from the browser MediaRecorder API.
 */
export function clerkVoiceChat(
  roundId: string,
  audioB64: string,
): Promise<ClerkVoiceResponse> {
  return post("/clerk/voice", { round_id: roundId, audio_b64: audioB64 });
}

/** Send a text message to any NPC. */
export function npcChat(
  roundId: string,
  npc: string,
  text: string,
): Promise<NpcChatResponse> {
  return post("/npc/chat", { round_id: roundId, npc, text });
}

/**
 * Send a voice message to any NPC (Deepgram STT → NPC brain → Deepgram TTS).
 * The audio should be base64-encoded webm/opus from the browser MediaRecorder API.
 */
export function npcVoiceChat(
  roundId: string,
  npc: string,
  audioB64: string,
): Promise<NpcVoiceResponse> {
  return post("/npc/voice", { round_id: roundId, npc, audio_b64: audioB64 });
}

/** Submit a forged invoice. Replaces computeTells() + submit() in game.js. */
export function submitInvoice(
  roundId: string,
  record: InvoiceRecord,
): Promise<SubmitResponse> {
  return post("/submit", { round_id: roundId, record });
}

/** Get patch notes since a given version. */
export function getPatchNotes(sinceVersion: number = 0): Promise<PatchNote[]> {
  return get(`/patch-notes?since=${sinceVersion}`);
}

/** Get per-version metrics (catch rate, FP rate, held-out rate). */
export function getMetrics(): Promise<VersionMetrics[]> {
  return get("/metrics");
}

/** Get the leaderboard. */
export function getLeaderboard(): Promise<LeaderboardEntry[]> {
  return get("/leaderboard");
}
