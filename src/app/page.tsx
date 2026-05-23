"use client";

import { useEffect, useRef, useState } from "react";
import {
  getApiKey, setApiKey, clearApiKey,
  getModelChat, setModelChat, getModelSummary, setModelSummary,
  getMaxOutputTokens, setMaxOutputTokens,
  clearAllGameData, clearEverythingIncludingKey,
  listBackupSlots, saveBackupSlot, loadBackupSlot, deleteBackupSlot,
  BackupSlot,
} from "@/lib/storage";
import {
  getSave, getMessages, getUsage,
  startNewGame, processTurn, regenerateLastResponse, restartGame,
} from "@/lib/engine";
import { ChatMessage, SaveData, UsageRecord } from "@/lib/types";
import {
  getAllStageOptions, getAllSectOptions, getAllArtOptions, getAllWeaponOptions,
  stageNameKR, sectNameKR, artNameKR,
  makeCustomArtId, formatGameTime, sichenPhase,
} from "@/data/world-data";

const MODEL_PRESETS = [
  { id: "gpt-5", label: "gpt-5 — 최상위 (느리고 비쌈, 최고 묘사력)" },
  { id: "gpt-5-mini", label: "gpt-5-mini — 균형 (권장 기본)" },
  { id: "gpt-5-nano", label: "gpt-5-nano — 초경량·최저가" },
  { id: "gpt-4.1", label: "gpt-4.1 — 안정적 고품질" },
  { id: "gpt-4.1-mini", label: "gpt-4.1-mini — 빠르고 저렴" },
  { id: "gpt-4.1-nano", label: "gpt-4.1-nano — 초경량" },
  { id: "gpt-4o", label: "gpt-4o — 빠른 대화형" },
  { id: "gpt-4o-mini", label: "gpt-4o-mini — 가장 저렴" },
  { id: "o3", label: "o3 — 추론형 (느림, 복잡한 상황 판정)" },
  { id: "o3-mini", label: "o3-mini — 추론형 경량" },
  { id: "o4-mini", label: "o4-mini — 추론형 신형" },
  { id: "gpt-5.4-mini", label: "gpt-5.4-mini (구 기본값)" },
];

const STAGE_OPTIONS = getAllStageOptions();
const SECT_OPTIONS = getAllSectOptions();
const ART_OPTIONS = getAllArtOptions();
const WEAPON_OPTIONS = getAllWeaponOptions();

export default function Page() {
  const [ready, setReady] = useState(false);
  const [save, setSave] = useState<SaveData | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [usage, setUsage] = useState<UsageRecord[]>([]);

  // 설정
  const [apiKey, setApiKeyState] = useState("");
  const [modelChat, setModelChatState] = useState("gpt-5-mini");
  const [modelSummary, setModelSummaryState] = useState("");
  const [maxOut, setMaxOutState] = useState<number>(1500);
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 입력
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [debug, setDebug] = useState<any>(null);

  // 스트리밍
  const [streamingText, setStreamingText] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);

  // 백업 슬롯
  const [backups, setBackups] = useState<BackupSlot[]>([]);
  const [showLoadDialog, setShowLoadDialog] = useState(false);

  // 새 게임 폼
  const [newName, setNewName] = useState("");
  const [newGender, setNewGender] = useState("남");
  const [newAge, setNewAge] = useState<number>(5);
  const [newBackground, setNewBackground] = useState("산기슭 작은 마을의 평민 가정");
  const [newAppearance, setNewAppearance] = useState("");
  const [newIsMartial, setNewIsMartial] = useState(false);
  const [newStage, setNewStage] = useState("samryu_chuip");
  const [newSect, setNewSect] = useState<string>("");
  const [newRank, setNewRank] = useState<string>("제자");
  const [newSilver, setNewSilver] = useState<number>(0);
  const [newArts, setNewArts] = useState<Array<{ art_id: string; name: string; mastery_pct: number; custom?: boolean }>>([]);
  const [artPick, setArtPick] = useState<string>("");
  const [customArtName, setCustomArtName] = useState<string>("");
  const [artFilter, setArtFilter] = useState<string>("");
  const [newWeapons, setNewWeapons] = useState<string[]>([]);
  const [weaponPick, setWeaponPick] = useState<string>("");
  const [weaponFilter, setWeaponFilter] = useState<string>("");
  const [customWeaponName, setCustomWeaponName] = useState<string>("");

  const scrollRef = useRef<HTMLDivElement>(null);

  // 초기 로드 — 브라우저에서만
  useEffect(() => {
    setApiKeyState(getApiKey());
    setModelChatState(getModelChat());
    setModelSummaryState(getModelSummary());
    setMaxOutState(getMaxOutputTokens());
    refreshAll();
    setReady(true);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading, streamingText]);

  function refreshAll() {
    setSave(getSave());
    setMessages(getMessages());
    setUsage(getUsage());
    setBackups(listBackupSlots());
  }

  function doSaveSlot() {
    const cur = getSave();
    if (!cur) {
      setError("저장할 게임이 없어요.");
      return;
    }
    const defaultLabel = `${cur.character.identity.name} · ${cur.character.identity.age}세 · 턴 ${cur.turn}`;
    const label = prompt("저장 이름 (취소 시 자동 라벨):", defaultLabel);
    if (label === null) return;
    saveBackupSlot(label || defaultLabel);
    setBackups(listBackupSlots());
    setWarning("저장됐어요.");
    setTimeout(() => setWarning(null), 2000);
  }

  function doLoadSlot(slotId: string) {
    if (!confirm("현재 진행 중인 게임은 덮어써집니다. 불러올까요?")) return;
    const ok = loadBackupSlot(slotId);
    if (!ok) {
      setError("슬롯을 찾지 못했어요.");
      return;
    }
    refreshAll();
    setShowLoadDialog(false);
    setDebug(null);
  }

  function doDeleteSlot(slotId: string) {
    if (!confirm("이 백업을 영구 삭제할까요?")) return;
    deleteBackupSlot(slotId);
    setBackups(listBackupSlots());
  }

  function doRestart() {
    if (!confirm("다시하기를 하면 현재 캐릭터·대화·기억이 전부 사라지고\n새 캐릭터 생성 화면으로 돌아갑니다.\n(저장된 백업은 보존됩니다)\n계속할까요?")) return;
    restartGame();
    setSave(null);
    setMessages([]);
    setUsage([]);
    setDebug(null);
  }

  async function doRegenerate() {
    if (loading) return;
    if (!confirm("마지막 AI 응답을 새로 받을까요?\n(직전 사용량은 환불되지만, 그 턴에 기록된 기억/관계 변화는 그대로 남을 수 있어요)")) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    setStreamingText("");
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      const result = await regenerateLastResponse({
        onChunk: (d) => setStreamingText((t) => t + d),
        signal: ctrl.signal,
      });
      if (!result.ok) {
        setError(result.error || "재생성 실패");
      } else {
        if (result.budgetWarning) setWarning(result.budgetWarning);
        if (result.aborted) setWarning((w) => (w ? w + " · " : "") + "출력 중단됨");
        if (result.debug) setDebug(result.debug);
        refreshAll();
      }
    } catch (e) {
      setError("재생성 실패: " + (e as Error).message);
    } finally {
      abortRef.current = null;
      setStreamingText("");
      setLoading(false);
    }
  }

  function stopStreaming() {
    abortRef.current?.abort();
  }

  function saveApiKey() {
    setApiKey(apiKey);
    setError(null);
  }
  function deleteApiKey() {
    clearApiKey();
    setApiKeyState("");
  }
  function saveModelChat(v: string) {
    setModelChat(v);
    setModelChatState(v);
  }
  function saveModelSummary(v: string) {
    setModelSummary(v);
    setModelSummaryState(v);
  }

  function onCreate(e: React.FormEvent) {
    e.preventDefault();
    try {
      const s = startNewGame({
        name: newName || "이름없음",
        gender: newGender,
        age: newAge,
        family_background: newBackground,
        appearance: newAppearance,
        civilian_or_martial: newIsMartial ? "martial" : "civilian",
        stage_id: newIsMartial ? newStage : undefined,
        sect_id: newIsMartial && newSect ? newSect : null,
        rank: newIsMartial && newSect ? newRank : null,
        silver_taels: newSilver,
        martial_arts: newIsMartial
          ? newArts.map((a) => ({ art_id: a.art_id, mastery_pct: a.mastery_pct }))
          : [],
        weapons: newWeapons,
      });
      setSave(s);
      setMessages([]);
      setError(null);
    } catch (e) {
      setError("새 게임 실패: " + (e as Error).message);
    }
  }

  async function send() {
    if (!input.trim() || loading) return;
    setLoading(true);
    setError(null);
    setWarning(null);
    setStreamingText("");
    const userInput = input;
    setInput("");

    // 낙관적 표시
    const tempUser: ChatMessage = {
      id: "tmp_" + Date.now(),
      role: "user",
      content: userInput,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUser]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    try {
      const result = await processTurn(userInput, {
        onChunk: (d) => setStreamingText((t) => t + d),
        signal: ctrl.signal,
      });
      if (!result.ok) {
        setError(result.error || "오류");
      } else {
        if (result.budgetWarning) setWarning(result.budgetWarning);
        if (result.saveErrorWarning) setWarning((w) => (w ? w + " · " : "") + result.saveErrorWarning!);
        if (result.aborted) setWarning((w) => (w ? w + " · " : "") + "출력 중단됨");
        if (result.debug) setDebug(result.debug);
        refreshAll();
      }
    } catch (e) {
      setError("요청 실패: " + (e as Error).message);
    } finally {
      abortRef.current = null;
      setStreamingText("");
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      send();
    }
  }

  function resetGameOnly() {
    if (!confirm("게임 진행(세이브·대화·기억·비용 기록)을 모두 지울까요?\nAPI 키와 모델 설정은 유지됩니다.")) return;
    clearAllGameData();
    setSave(null);
    setMessages([]);
    setUsage([]);
    setDebug(null);
  }
  function resetEverything() {
    if (!confirm("API 키까지 포함해 전부 지울까요? 이 작업은 되돌릴 수 없어요.")) return;
    clearEverythingIncludingKey();
    setApiKeyState("");
    setSave(null);
    setMessages([]);
    setUsage([]);
    setDebug(null);
  }

  const mode = apiKey ? "OpenAI API Mode" : "Mock Mode";

  if (!ready) {
    return <main className="min-h-screen flex items-center justify-center text-ink-300">불러오는 중…</main>;
  }

  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-[1fr_340px]">
      {/* ─── 좌측 채팅 ─── */}
      <section className="flex flex-col h-screen border-r border-ink-700">
        <header className="px-4 py-3 border-b border-ink-700 flex items-center justify-between gap-2 flex-wrap">
          <h1 className="text-lg font-bold">무협 챗 게임</h1>
          <div className="text-xs text-ink-300 flex items-center gap-2 flex-wrap">
            <span>턴 {save?.turn ?? 0}</span>
            <span className={apiKey ? "px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-200" : "px-2 py-0.5 rounded bg-yellow-900/60 text-yellow-200"}>
              {mode}
            </span>
            {save && (
              <>
                <button onClick={doSaveSlot} className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-500 hover:text-ink-900">
                  💾 저장
                </button>
                <button onClick={() => { setBackups(listBackupSlots()); setShowLoadDialog(true); }} className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-500 hover:text-ink-900">
                  📂 불러오기 ({backups.length})
                </button>
                <button onClick={doRestart} className="px-2 py-1 rounded bg-ink-700 hover:bg-yellow-900 hover:text-yellow-100">
                  🔁 다시하기
                </button>
              </>
            )}
            <button onClick={() => setSettingsOpen((v) => !v)} className="px-2 py-1 rounded bg-ink-700 hover:bg-ink-500 hover:text-ink-900">
              ⚙ 설정
            </button>
          </div>
        </header>

        {/* 불러오기 다이얼로그 */}
        {showLoadDialog && (
          <div className="border-b border-ink-700 bg-ink-900/80 p-4 space-y-2 max-h-72 overflow-y-auto scroll-area">
            <div className="flex items-center justify-between">
              <h3 className="font-bold">저장된 게임</h3>
              <button onClick={() => setShowLoadDialog(false)} className="text-ink-300 hover:text-ink-100 text-sm">닫기 ✕</button>
            </div>
            {backups.length === 0 && <p className="text-ink-300 text-sm">저장된 백업이 없어요.</p>}
            {backups.map((s) => (
              <div key={s.id} className="flex items-center justify-between gap-2 bg-ink-700/30 border border-ink-500/30 rounded p-2 text-sm">
                <div className="flex-1 min-w-0">
                  <div className="font-bold truncate">{s.label}</div>
                  <div className="text-xs text-ink-300">
                    {s.characterName} · {s.characterAge}세 · 턴 {s.turn} · {new Date(s.createdAt).toLocaleString("ko-KR")}
                  </div>
                </div>
                <button onClick={() => doLoadSlot(s.id)} className="px-2 py-1 bg-ink-500 hover:bg-ink-300 text-ink-900 rounded text-xs font-bold">불러오기</button>
                <button onClick={() => doDeleteSlot(s.id)} className="px-2 py-1 bg-red-900/60 hover:bg-red-800 text-red-100 rounded text-xs">삭제</button>
              </div>
            ))}
          </div>
        )}

        {/* 설정 패널 */}
        {settingsOpen && (
          <div className="border-b border-ink-700 bg-ink-900/60 p-4 space-y-3 text-sm">
            <div>
              <label className="block text-xs text-ink-300 mb-1">OpenAI API Key</label>
              <div className="flex gap-2">
                <input
                  type="password"
                  className="flex-1 px-2 py-1.5 bg-ink-900 border border-ink-500 rounded font-mono text-xs"
                  placeholder="sk-..."
                  value={apiKey}
                  onChange={(e) => setApiKeyState(e.target.value)}
                />
                <button onClick={saveApiKey} className="px-3 py-1.5 bg-ink-500 hover:bg-ink-300 text-ink-900 rounded text-xs font-bold">
                  저장
                </button>
                <button onClick={deleteApiKey} className="px-3 py-1.5 bg-red-900/60 hover:bg-red-800 text-red-100 rounded text-xs">
                  삭제
                </button>
              </div>
              <p className="text-xs text-ink-300 mt-1">
                키는 브라우저 localStorage에만 저장됩니다. 비우면 Mock Mode로 동작.
              </p>
            </div>

            <div>
              <label className="block text-xs text-ink-300 mb-1">기본 진행 모델</label>
              <div className="flex gap-2">
                <select
                  className="px-2 py-1.5 bg-ink-900 border border-ink-500 rounded text-xs"
                  value={MODEL_PRESETS.find((m) => m.id === modelChat)?.id || ""}
                  onChange={(e) => e.target.value && saveModelChat(e.target.value)}
                >
                  <option value="">— 프리셋 선택 —</option>
                  {MODEL_PRESETS.map((m) => (
                    <option key={m.id} value={m.id}>{m.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  className="flex-1 px-2 py-1.5 bg-ink-900 border border-ink-500 rounded font-mono text-xs"
                  value={modelChat}
                  onChange={(e) => saveModelChat(e.target.value)}
                  placeholder="모델명 직접 입력"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs text-ink-300 mb-1">
                상태 추출/요약 모델 (비우면 진행 모델과 동일)
              </label>
              <input
                type="text"
                className="w-full px-2 py-1.5 bg-ink-900 border border-ink-500 rounded font-mono text-xs"
                value={modelSummary}
                onChange={(e) => saveModelSummary(e.target.value)}
                placeholder="비우면 기본 진행 모델 사용"
              />
            </div>

            <div>
              <label className="block text-xs text-ink-300 mb-1">
                출력 길이 (max output tokens) — <span className="font-mono">{maxOut}</span>
              </label>
              <div className="flex gap-2 items-center">
                <input
                  type="range"
                  min={300}
                  max={8000}
                  step={100}
                  value={maxOut}
                  onChange={(e) => {
                    const n = parseInt(e.target.value);
                    setMaxOutState(n);
                    setMaxOutputTokens(n);
                  }}
                  className="flex-1"
                />
                <input
                  type="number"
                  min={100}
                  max={16000}
                  step={100}
                  value={maxOut}
                  onChange={(e) => {
                    const n = parseInt(e.target.value) || 1500;
                    setMaxOutState(n);
                    setMaxOutputTokens(n);
                  }}
                  className="w-24 px-2 py-1.5 bg-ink-900 border border-ink-500 rounded text-center text-xs"
                />
              </div>
              <p className="text-xs text-ink-300 mt-1">
                낮으면 짧고 빠름·저렴. 높으면 긴 묘사·전투·정치 장면 가능. 기본 1500.
              </p>
            </div>

            <div className="flex gap-2 pt-2 border-t border-ink-700">
              <button onClick={resetGameOnly} className="text-xs px-3 py-1.5 bg-yellow-900/40 hover:bg-yellow-900 text-yellow-100 rounded">
                게임 진행만 초기화
              </button>
              <button onClick={resetEverything} className="text-xs px-3 py-1.5 bg-red-900/40 hover:bg-red-900 text-red-100 rounded">
                API 키 포함 전체 초기화
              </button>
            </div>
          </div>
        )}

        {/* 새 게임 폼 */}
        {!save && (
          <div className="flex-1 overflow-y-auto scroll-area flex items-start justify-center p-4">
            <form
              onSubmit={onCreate}
              className="bg-ink-700/40 border border-ink-500/40 p-6 rounded-lg w-full max-w-2xl space-y-4 my-6"
            >
              <h2 className="text-2xl font-bold">새 캐릭터 만들기</h2>
              <p className="text-sm text-ink-300">현재 모드: <span className="font-mono">{mode}</span></p>

              {/* 기본 정보 */}
              <fieldset className="space-y-3 border border-ink-500/30 rounded p-3">
                <legend className="px-2 text-xs text-ink-300">기본</legend>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                  <label className="block md:col-span-2">
                    <span className="text-sm text-ink-100">이름</span>
                    <input
                      className="w-full mt-1 px-3 py-2 bg-ink-900 border border-ink-500 rounded"
                      value={newName}
                      onChange={(e) => setNewName(e.target.value)}
                      placeholder="예: 한설"
                    />
                  </label>
                  <label className="block">
                    <span className="text-sm text-ink-100">성별</span>
                    <select
                      className="w-full mt-1 px-3 py-2 bg-ink-900 border border-ink-500 rounded"
                      value={newGender}
                      onChange={(e) => setNewGender(e.target.value)}
                    >
                      <option value="남">남</option>
                      <option value="여">여</option>
                    </select>
                  </label>
                </div>
                <label className="block">
                  <span className="text-sm text-ink-100">나이</span>
                  <div className="flex gap-2 mt-1">
                    <input
                      type="range"
                      min={5}
                      max={90}
                      value={newAge}
                      onChange={(e) => setNewAge(parseInt(e.target.value))}
                      className="flex-1"
                    />
                    <input
                      type="number"
                      min={5}
                      max={120}
                      value={newAge}
                      onChange={(e) => setNewAge(parseInt(e.target.value) || 5)}
                      className="w-20 px-2 py-2 bg-ink-900 border border-ink-500 rounded text-center"
                    />
                    <span className="self-center text-sm text-ink-300">세</span>
                  </div>
                </label>
                <label className="block">
                  <span className="text-sm text-ink-100">출신 배경</span>
                  <textarea
                    className="w-full mt-1 px-3 py-2 bg-ink-900 border border-ink-500 rounded"
                    rows={2}
                    value={newBackground}
                    onChange={(e) => setNewBackground(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-sm text-ink-100">외양 (선택)</span>
                  <input
                    className="w-full mt-1 px-3 py-2 bg-ink-900 border border-ink-500 rounded"
                    value={newAppearance}
                    onChange={(e) => setNewAppearance(e.target.value)}
                    placeholder="예: 검은 머리, 차가운 눈매"
                  />
                </label>
              </fieldset>

              {/* 무공 / 경지 */}
              <fieldset className="space-y-3 border border-ink-500/30 rounded p-3">
                <legend className="px-2 text-xs text-ink-300">무공·신분</legend>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => setNewIsMartial(false)}
                    className={`flex-1 px-3 py-2 rounded border ${
                      !newIsMartial
                        ? "bg-ink-500 text-ink-900 border-ink-500 font-bold"
                        : "bg-ink-900 border-ink-500 text-ink-100"
                    }`}
                  >
                    일반인 (무공 없음)
                  </button>
                  <button
                    type="button"
                    onClick={() => setNewIsMartial(true)}
                    className={`flex-1 px-3 py-2 rounded border ${
                      newIsMartial
                        ? "bg-ink-500 text-ink-900 border-ink-500 font-bold"
                        : "bg-ink-900 border-ink-500 text-ink-100"
                    }`}
                  >
                    무림인
                  </button>
                </div>

                {newIsMartial && (
                  <>
                    <label className="block">
                      <span className="text-sm text-ink-100">시작 경지</span>
                      <select
                        className="w-full mt-1 px-3 py-2 bg-ink-900 border border-ink-500 rounded"
                        value={newStage}
                        onChange={(e) => setNewStage(e.target.value)}
                      >
                        {STAGE_OPTIONS.map((s) => (
                          <option key={s.stage_id} value={s.stage_id}>
                            {s.stage_name} — 내공 {s.internal_energy_midpoint}/{s.internal_energy_cap}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-ink-300">
                        {STAGE_OPTIONS.find((s) => s.stage_id === newStage)?.notes}
                      </p>
                    </label>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <label className="block">
                        <span className="text-sm text-ink-100">소속 문파 (선택)</span>
                        <select
                          className="w-full mt-1 px-3 py-2 bg-ink-900 border border-ink-500 rounded"
                          value={newSect}
                          onChange={(e) => setNewSect(e.target.value)}
                        >
                          <option value="">무소속 / 낭인</option>
                          {SECT_OPTIONS.map((s) => (
                            <option key={s.id} value={s.id}>
                              {s.name} ({s.category})
                            </option>
                          ))}
                        </select>
                      </label>
                      {newSect && (
                        <label className="block">
                          <span className="text-sm text-ink-100">소속 내 직책</span>
                          <input
                            className="w-full mt-1 px-3 py-2 bg-ink-900 border border-ink-500 rounded"
                            value={newRank}
                            onChange={(e) => setNewRank(e.target.value)}
                            placeholder="예: 제자 / 장로 / 가주"
                          />
                        </label>
                      )}
                    </div>

                    {/* 보유 무공 */}
                    <div className="border border-ink-500/30 rounded p-3 space-y-2">
                      <div className="text-sm text-ink-100 font-bold">보유 무공</div>
                      <p className="text-xs text-ink-300">
                        문파 목록에서 선택하거나, 직접 이름을 적어 자작 무공을 추가할 수 있어요.
                      </p>

                      {/* 선택 추가 */}
                      <div className="flex gap-2 flex-wrap">
                        <input
                          type="text"
                          className="flex-1 min-w-[120px] px-2 py-1.5 bg-ink-900 border border-ink-500 rounded text-xs"
                          placeholder="무공 검색 (이름·문파·종류)"
                          value={artFilter}
                          onChange={(e) => setArtFilter(e.target.value)}
                        />
                        <select
                          className="flex-1 min-w-[200px] px-2 py-1.5 bg-ink-900 border border-ink-500 rounded text-xs"
                          value={artPick}
                          onChange={(e) => setArtPick(e.target.value)}
                        >
                          <option value="">— 강호의 무공 선택 —</option>
                          {ART_OPTIONS.filter((a) => {
                            const q = artFilter.trim().toLowerCase();
                            if (!q) return true;
                            return (
                              a.name.toLowerCase().includes(q) ||
                              (a.sect || "").toLowerCase().includes(q) ||
                              a.type.toLowerCase().includes(q) ||
                              a.grade.toLowerCase().includes(q)
                            );
                          })
                            .slice(0, 200)
                            .map((a) => (
                              <option key={a.id} value={a.id}>
                                {a.name} [{a.grade}/{a.type}{a.sect ? ` · ${a.sect}` : ""}]
                              </option>
                            ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            if (!artPick) return;
                            if (newArts.some((x) => x.art_id === artPick)) return;
                            const a = ART_OPTIONS.find((x) => x.id === artPick);
                            if (!a) return;
                            setNewArts((arr) => [...arr, { art_id: a.id, name: a.name, mastery_pct: 10 }]);
                            setArtPick("");
                          }}
                          className="px-3 py-1.5 bg-ink-500 hover:bg-ink-300 text-ink-900 rounded text-xs font-bold"
                        >
                          + 추가
                        </button>
                      </div>

                      {/* 자작 무공 입력 */}
                      <div className="flex gap-2">
                        <input
                          type="text"
                          className="flex-1 px-2 py-1.5 bg-ink-900 border border-ink-500 rounded text-xs"
                          placeholder="자작 무공 이름 (예: 풍월검법)"
                          value={customArtName}
                          onChange={(e) => setCustomArtName(e.target.value)}
                        />
                        <button
                          type="button"
                          onClick={() => {
                            const trimmed = customArtName.trim();
                            if (!trimmed) return;
                            const id = makeCustomArtId(trimmed);
                            if (!id || newArts.some((x) => x.art_id === id)) {
                              setCustomArtName("");
                              return;
                            }
                            setNewArts((arr) => [...arr, { art_id: id, name: trimmed, mastery_pct: 10, custom: true }]);
                            setCustomArtName("");
                          }}
                          className="px-3 py-1.5 bg-ink-500 hover:bg-ink-300 text-ink-900 rounded text-xs font-bold"
                        >
                          + 자작 추가
                        </button>
                      </div>

                      {/* 추가된 목록 */}
                      {newArts.length === 0 ? (
                        <p className="text-xs text-ink-300">아직 추가된 무공 없음 (시작은 비워둬도 됩니다).</p>
                      ) : (
                        <ul className="space-y-1">
                          {newArts.map((a, idx) => (
                            <li
                              key={a.art_id}
                              className="flex items-center gap-2 bg-ink-900/60 border border-ink-500/30 rounded px-2 py-1.5 text-xs"
                            >
                              <span className="flex-1 truncate">
                                {a.name}
                                {a.custom && <span className="ml-1 text-yellow-200">[자작]</span>}
                              </span>
                              <span className="text-ink-300">숙련도</span>
                              <input
                                type="number"
                                min={0}
                                max={100}
                                className="w-16 px-1 py-0.5 bg-ink-900 border border-ink-500 rounded text-center"
                                value={a.mastery_pct}
                                onChange={(e) => {
                                  const v = Math.max(0, Math.min(100, parseInt(e.target.value) || 0));
                                  setNewArts((arr) =>
                                    arr.map((x, i) => (i === idx ? { ...x, mastery_pct: v } : x))
                                  );
                                }}
                              />
                              <span className="text-ink-300">%</span>
                              <button
                                type="button"
                                onClick={() =>
                                  setNewArts((arr) => arr.filter((_, i) => i !== idx))
                                }
                                className="px-2 py-0.5 bg-red-900/60 hover:bg-red-800 text-red-100 rounded"
                              >
                                삭제
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </>
                )}
              </fieldset>

              {/* 무기 */}
              <fieldset className="space-y-2 border border-ink-500/30 rounded p-3">
                <legend className="px-2 text-xs text-ink-300">보유 무기 (선택)</legend>
                <p className="text-xs text-ink-300">
                  강호의 무기 목록에서 고르거나, 직접 이름을 적어 가져가도 됩니다. (무공 없이도 가능)
                </p>

                <div className="flex gap-2 flex-wrap">
                  <input
                    type="text"
                    className="flex-1 min-w-[120px] px-2 py-1.5 bg-ink-900 border border-ink-500 rounded text-xs"
                    placeholder="무기 검색 (이름·종류·등급)"
                    value={weaponFilter}
                    onChange={(e) => setWeaponFilter(e.target.value)}
                  />
                  <select
                    className="flex-1 min-w-[200px] px-2 py-1.5 bg-ink-900 border border-ink-500 rounded text-xs"
                    value={weaponPick}
                    onChange={(e) => setWeaponPick(e.target.value)}
                  >
                    <option value="">— 강호의 무기 선택 —</option>
                    {WEAPON_OPTIONS.filter((w) => {
                      const q = weaponFilter.trim().toLowerCase();
                      if (!q) return true;
                      return (
                        w.name.toLowerCase().includes(q) ||
                        w.type.toLowerCase().includes(q) ||
                        w.rarity.toLowerCase().includes(q) ||
                        w.category.toLowerCase().includes(q)
                      );
                    })
                      .slice(0, 200)
                      .map((w) => (
                        <option key={w.id} value={w.name}>
                          {w.name} [{w.rarity}/{w.type} · {w.price}]
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      if (!weaponPick) return;
                      if (newWeapons.includes(weaponPick)) return;
                      setNewWeapons((arr) => [...arr, weaponPick]);
                      setWeaponPick("");
                    }}
                    className="px-3 py-1.5 bg-ink-500 hover:bg-ink-300 text-ink-900 rounded text-xs font-bold"
                  >
                    + 추가
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    className="flex-1 px-2 py-1.5 bg-ink-900 border border-ink-500 rounded text-xs"
                    placeholder="직접 입력 (예: 낡은 목검)"
                    value={customWeaponName}
                    onChange={(e) => setCustomWeaponName(e.target.value)}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const t = customWeaponName.trim();
                      if (!t || newWeapons.includes(t)) {
                        setCustomWeaponName("");
                        return;
                      }
                      setNewWeapons((arr) => [...arr, t]);
                      setCustomWeaponName("");
                    }}
                    className="px-3 py-1.5 bg-ink-500 hover:bg-ink-300 text-ink-900 rounded text-xs font-bold"
                  >
                    + 자작 추가
                  </button>
                </div>

                {newWeapons.length === 0 ? (
                  <p className="text-xs text-ink-300">맨손/빈손으로 시작.</p>
                ) : (
                  <ul className="space-y-1">
                    {newWeapons.map((w, idx) => (
                      <li
                        key={w + idx}
                        className="flex items-center gap-2 bg-ink-900/60 border border-ink-500/30 rounded px-2 py-1.5 text-xs"
                      >
                        <span className="flex-1 truncate">{w}</span>
                        <button
                          type="button"
                          onClick={() => setNewWeapons((arr) => arr.filter((_, i) => i !== idx))}
                          className="px-2 py-0.5 bg-red-900/60 hover:bg-red-800 text-red-100 rounded"
                        >
                          삭제
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </fieldset>

              {/* 자산 */}
              <fieldset className="space-y-2 border border-ink-500/30 rounded p-3">
                <legend className="px-2 text-xs text-ink-300">자산 (선택)</legend>
                <label className="block">
                  <span className="text-sm text-ink-100">시작 은자(銀子)</span>
                  <input
                    type="number"
                    min={0}
                    className="w-full mt-1 px-3 py-2 bg-ink-900 border border-ink-500 rounded"
                    value={newSilver}
                    onChange={(e) => setNewSilver(parseInt(e.target.value) || 0)}
                    placeholder="0"
                  />
                  <p className="mt-1 text-xs text-ink-300">평민 일당 동전 몇 닢, 한 달 생활 약 1냥.</p>
                </label>
              </fieldset>

              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button
                type="submit"
                className="w-full bg-ink-500 hover:bg-ink-300 text-ink-900 font-bold py-3 rounded text-lg"
              >
                강호에 발을 들이다 ({newAge}세 {newIsMartial ? "· 무림인" : "· 일반인"})
              </button>
            </form>
          </div>
        )}

        {/* 채팅 영역 */}
        {save && (
          <>
            <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-area px-4 py-4 space-y-4">
              {messages.length === 0 && (
                <p className="text-ink-300 text-sm">
                  세계가 너를 기다린다. 첫 행동을 입력해. (예: "주변을 둘러본다.")
                </p>
              )}
              {messages.map((m, idx) => {
                const isLastAssistant =
                  m.role === "assistant" &&
                  idx === messages.length - 1;
                return (
                  <div
                    key={m.id}
                    className={
                      m.role === "user"
                        ? "bg-ink-700/40 border border-ink-500/40 rounded-lg p-3"
                        : "bg-ink-900/40 border border-ink-500/30 rounded-lg p-3"
                    }
                  >
                    <div className="text-xs text-ink-300 mb-1 flex items-center justify-between">
                      <span>{m.role === "user" ? "당신" : "강호"}</span>
                      {isLastAssistant && !loading && (
                        <button
                          onClick={doRegenerate}
                          title="이 응답을 새로 받기"
                          className="text-ink-300 hover:text-ink-100 underline"
                        >
                          🔄 다시 받기
                        </button>
                      )}
                    </div>
                    <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                  </div>
                );
              })}
              {loading && (
                <div className="bg-ink-900/40 border border-ink-500/30 rounded-lg p-3">
                  <div className="text-xs text-ink-300 mb-1">강호 (출력 중…)</div>
                  {streamingText ? (
                    <div className="whitespace-pre-wrap leading-relaxed">{streamingText}<span className="animate-pulse">▍</span></div>
                  ) : (
                    <div className="text-ink-300 text-sm">강호가 응답을 시작합니다…</div>
                  )}
                </div>
              )}
              {error && (
                <div className="bg-red-900/40 border border-red-700 text-red-200 p-3 rounded text-sm">
                  {error}
                </div>
              )}
              {warning && (
                <div className="bg-yellow-900/40 border border-yellow-700 text-yellow-100 p-3 rounded text-sm">
                  ⚠ {warning}
                </div>
              )}
            </div>

            <div className="border-t border-ink-700 p-3">
              <textarea
                className="w-full bg-ink-900 border border-ink-500 rounded p-2 resize-none"
                rows={3}
                placeholder="너의 행동을 입력해. (Ctrl/⌘+Enter 전송)"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                disabled={loading}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <div className="text-xs text-ink-300">
                  출력 길이: <span className="font-mono">{maxOut}</span> tokens
                </div>
                <div className="flex gap-2">
                  {loading && (
                    <button
                      onClick={stopStreaming}
                      className="bg-red-700 hover:bg-red-600 text-red-50 font-bold px-4 py-2 rounded"
                    >
                      ■ 중단
                    </button>
                  )}
                  <button
                    onClick={send}
                    disabled={loading || !input.trim()}
                    className="bg-ink-500 hover:bg-ink-300 text-ink-900 font-bold px-4 py-2 rounded disabled:opacity-50"
                  >
                    {loading ? "출력 중…" : "전송"}
                  </button>
                </div>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ─── 우측 패널 ─── */}
      <aside className="hidden lg:flex flex-col h-screen overflow-y-auto scroll-area p-4 gap-4 text-sm">
        {save?.gameTime && (
          <div className="bg-ink-900/60 border border-ink-500/40 rounded p-3">
            <div className="text-xs text-ink-300 mb-1">현재 시각</div>
            <div className="font-bold">{formatGameTime(save.gameTime)}</div>
            <div className="text-xs text-ink-300 mt-0.5">
              {sichenPhase(save.gameTime.sichen)}
            </div>
          </div>
        )}

        <div className="bg-ink-700/30 border border-ink-500/30 rounded p-3">
          <h2 className="font-bold mb-2">캐릭터</h2>
          {save?.character ? (
            <ul className="space-y-1">
              <li>
                <span className="text-ink-300">이름:</span> {save.character.identity.name} ({save.character.identity.gender}, {save.character.identity.age}세)
              </li>
              {Array.isArray(save.character.reputation?.titles) &&
                (save.character.reputation.titles as string[]).length > 0 && (
                  <li>
                    <span className="text-ink-300">별호:</span>{" "}
                    {(save.character.reputation.titles as string[]).join(", ")}
                  </li>
                )}
              <li>
                <span className="text-ink-300">경지:</span>{" "}
                {stageNameKR(save.character.realm?.current_stage)} · 내공{" "}
                {save.character.realm?.internal_energy}/{save.character.realm?.internal_energy_cap}
              </li>
              <li>
                <span className="text-ink-300">HP:</span> {save.character.vitals?.hp_current}/{save.character.vitals?.hp_max} · 내상 {save.character.vitals?.internal_injury} · 외상 {save.character.vitals?.external_injury}
              </li>
              <li>
                <span className="text-ink-300">위치:</span> {save.character.current_location_id || "(미정)"}
              </li>
              <li>
                <span className="text-ink-300">소속:</span>{" "}
                {sectNameKR(save.character.affiliation?.sect_id)}
                {save.character.affiliation?.rank ? ` (${save.character.affiliation.rank})` : ""}
              </li>
              <li>
                <span className="text-ink-300">돈:</span>{" "}
                {save.character.inventory?.gold_taels ? `금자 ${save.character.inventory.gold_taels}냥 · ` : ""}
                은자 {save.character.inventory?.silver_taels ?? 0}냥
              </li>
              <li>
                <span className="text-ink-300">무기:</span>{" "}
                {save.character.weapons_owned?.length
                  ? save.character.weapons_owned.join(", ")
                  : "(없음)"}
              </li>
              <li>
                <span className="text-ink-300">소지품:</span>{" "}
                {save.character.inventory?.items?.length
                  ? save.character.inventory.items.join(", ")
                  : "(없음)"}
              </li>
              <li>
                <span className="text-ink-300">보유 무공:</span>{" "}
                {save.character.martial_arts_known?.length
                  ? save.character.martial_arts_known
                      .map((a) => `${artNameKR(a.art_id)} (${a.mastery_pct}%)`)
                      .join(", ")
                  : "(없음)"}
              </li>
            </ul>
          ) : (
            <p className="text-ink-300">캐릭터 없음</p>
          )}
        </div>

        <div className="bg-ink-700/30 border border-ink-500/30 rounded p-3">
          <h2 className="font-bold mb-2">관계 ({save ? Object.keys(save.relationships || {}).length : 0})</h2>
          <ul className="space-y-1 max-h-40 overflow-y-auto scroll-area">
            {save && Object.entries(save.relationships || {}).map(([id, r]) => (
              <li key={id} className="text-xs">
                <span className="text-ink-100">{r.name}</span>
                <span className="text-ink-300"> · {r.type} · 호감 {r.affinity} 신뢰 {r.trust}</span>
              </li>
            ))}
            {save && Object.keys(save.relationships || {}).length === 0 && (
              <li className="text-ink-300 text-xs">아직 만난 사람 없음</li>
            )}
          </ul>
        </div>

      </aside>
    </main>
  );
}
