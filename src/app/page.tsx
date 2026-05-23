"use client";

import { useEffect, useRef, useState } from "react";
import {
  getApiKey, setApiKey, clearApiKey,
  getModelChat, setModelChat, getModelSummary, setModelSummary,
  clearAllGameData, clearEverythingIncludingKey,
} from "@/lib/storage";
import {
  hasSave, getSave, getMessages, getUsage,
  startNewGame, processTurn,
} from "@/lib/engine";
import { ChatMessage, SaveData, UsageRecord } from "@/lib/types";

const MODEL_PRESETS = [
  { id: "gpt-5.4-mini", label: "gpt-5.4-mini (기본 진행)" },
  { id: "gpt-5-mini", label: "gpt-5-mini (비용 절약)" },
];

export default function Page() {
  const [ready, setReady] = useState(false);
  const [save, setSave] = useState<SaveData | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [usage, setUsage] = useState<UsageRecord[]>([]);

  // 설정
  const [apiKey, setApiKeyState] = useState("");
  const [modelChat, setModelChatState] = useState("gpt-5.4-mini");
  const [modelSummary, setModelSummaryState] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);

  // 입력
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [debug, setDebug] = useState<any>(null);

  // 새 게임 폼
  const [newName, setNewName] = useState("");
  const [newGender, setNewGender] = useState("남");
  const [newBackground, setNewBackground] = useState("산기슭 작은 마을의 평민 가정");

  const scrollRef = useRef<HTMLDivElement>(null);

  // 초기 로드 — 브라우저에서만
  useEffect(() => {
    setApiKeyState(getApiKey());
    setModelChatState(getModelChat());
    setModelSummaryState(getModelSummary());
    refreshAll();
    setReady(true);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  function refreshAll() {
    setSave(getSave());
    setMessages(getMessages());
    setUsage(getUsage());
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
        family_background: newBackground,
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

    try {
      const result = await processTurn(userInput);
      if (!result.ok) {
        setError(result.error || "오류");
      } else {
        if (result.budgetWarning) setWarning(result.budgetWarning);
        if (result.saveErrorWarning) setWarning((w) => (w ? w + " · " : "") + result.saveErrorWarning!);
        if (result.debug) setDebug(result.debug);
        refreshAll();
      }
    } catch (e) {
      setError("요청 실패: " + (e as Error).message);
    } finally {
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

  // 비용 계산
  const today = new Date().toDateString();
  const dailyCost = usage.filter((u) => new Date(u.createdAt).toDateString() === today)
    .reduce((s, u) => s + u.estimated_cost_usd, 0);
  const now = new Date();
  const monthlyCost = usage.filter((u) => {
    const d = new Date(u.createdAt);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).reduce((s, u) => s + u.estimated_cost_usd, 0);
  const totalTokens = usage.reduce((s, u) => s + u.total_tokens, 0);

  const mode = apiKey ? "OpenAI API Mode" : "Mock Mode";

  if (!ready) {
    return <main className="min-h-screen flex items-center justify-center text-ink-300">불러오는 중…</main>;
  }

  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-[1fr_340px]">
      {/* ─── 좌측 채팅 ─── */}
      <section className="flex flex-col h-screen border-r border-ink-700">
        <header className="px-4 py-3 border-b border-ink-700 flex items-center justify-between gap-2">
          <h1 className="text-lg font-bold">무협 챗 게임</h1>
          <div className="text-xs text-ink-300 flex items-center gap-3">
            <span>턴 {save?.turn ?? 0}</span>
            <span className={apiKey ? "px-2 py-0.5 rounded bg-emerald-900/60 text-emerald-200" : "px-2 py-0.5 rounded bg-yellow-900/60 text-yellow-200"}>
              {mode}
            </span>
            <button
              onClick={() => setSettingsOpen((v) => !v)}
              className="underline hover:text-ink-100"
            >
              ⚙ 설정
            </button>
          </div>
        </header>

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
          <div className="flex-1 overflow-y-auto scroll-area flex items-center justify-center p-4">
            <form
              onSubmit={onCreate}
              className="bg-ink-700/40 border border-ink-500/40 p-6 rounded-lg w-full max-w-md space-y-4"
            >
              <h2 className="text-2xl font-bold">새 무림인의 시작</h2>
              <p className="text-sm text-ink-300">현재 모드: <span className="font-mono">{mode}</span></p>
              <label className="block">
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
              <label className="block">
                <span className="text-sm text-ink-100">출신 배경</span>
                <textarea
                  className="w-full mt-1 px-3 py-2 bg-ink-900 border border-ink-500 rounded"
                  rows={3}
                  value={newBackground}
                  onChange={(e) => setNewBackground(e.target.value)}
                />
              </label>
              {error && <p className="text-red-400 text-sm">{error}</p>}
              <button type="submit" className="w-full bg-ink-500 hover:bg-ink-300 text-ink-900 font-bold py-2 rounded">
                5세부터 시작
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
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={
                    m.role === "user"
                      ? "bg-ink-700/40 border border-ink-500/40 rounded-lg p-3"
                      : "bg-ink-900/40 border border-ink-500/30 rounded-lg p-3"
                  }
                >
                  <div className="text-xs text-ink-300 mb-1">
                    {m.role === "user" ? "당신" : "강호"}
                  </div>
                  <div className="whitespace-pre-wrap leading-relaxed">{m.content}</div>
                </div>
              ))}
              {loading && <div className="text-ink-300 text-sm">강호가 천천히 응답하는 중…</div>}
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
              <div className="mt-2 flex justify-end">
                <button
                  onClick={send}
                  disabled={loading || !input.trim()}
                  className="bg-ink-500 hover:bg-ink-300 text-ink-900 font-bold px-4 py-2 rounded disabled:opacity-50"
                >
                  {loading ? "기다리는 중…" : "전송"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {/* ─── 우측 패널 ─── */}
      <aside className="hidden lg:flex flex-col h-screen overflow-y-auto scroll-area p-4 gap-4 text-sm">
        <div className="bg-ink-700/30 border border-ink-500/30 rounded p-3">
          <h2 className="font-bold mb-2">캐릭터</h2>
          {save?.character ? (
            <ul className="space-y-1">
              <li><span className="text-ink-300">이름:</span> {save.character.identity.name} ({save.character.identity.gender}, {save.character.identity.age}세)</li>
              <li><span className="text-ink-300">구분:</span> {save.character.civilian_or_martial === "martial" ? "무림인" : "일반인"}</li>
              <li><span className="text-ink-300">경지:</span> {save.character.realm?.current_stage} · 내공 {save.character.realm?.internal_energy}/{save.character.realm?.internal_energy_cap}</li>
              <li><span className="text-ink-300">HP:</span> {save.character.vitals?.hp_current}/{save.character.vitals?.hp_max} · 내상 {save.character.vitals?.internal_injury} · 외상 {save.character.vitals?.external_injury}</li>
              <li><span className="text-ink-300">위치:</span> {save.character.current_location_id || "(미정)"}</li>
              <li><span className="text-ink-300">소속:</span> {save.character.affiliation?.sect_id || "무소속"}</li>
              <li><span className="text-ink-300">은자:</span> {save.character.inventory?.silver_taels}냥</li>
            </ul>
          ) : <p className="text-ink-300">캐릭터 없음</p>}
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

        <div className="bg-ink-700/30 border border-ink-500/30 rounded p-3">
          <h2 className="font-bold mb-2">비용 (개발자 패널)</h2>
          <ul className="space-y-1 text-xs">
            <li>이번 턴 추정: ${debug?.costEstimateUSD?.toFixed(6) ?? "0.000000"}</li>
            <li>오늘 누적: ${dailyCost.toFixed(4)}</li>
            <li>이번 달: ${monthlyCost.toFixed(4)}</li>
            <li>총 토큰: {totalTokens.toLocaleString()}</li>
            <li>현재 모델: <span className="font-mono">{modelChat}</span></li>
          </ul>
        </div>

        {debug && (
          <div className="bg-ink-700/30 border border-ink-500/30 rounded p-3 text-xs">
            <h2 className="font-bold mb-2">디버그</h2>
            <ul className="space-y-1">
              <li>모드: {debug.mock ? "MOCK" : "API"}</li>
              <li>최근 메시지 포함: {debug.recentMessageCount}</li>
              <li>주입 기억: {debug.memoryCount}</li>
              <li>세계관 매칭: {debug.worldHitsCount}</li>
              <li>추정 입력 토큰: {debug.estimatedInputTokens}</li>
              {debug.actualInputTokens !== undefined && (
                <li>실제 입력: {debug.actualInputTokens} · 출력: {debug.actualOutputTokens}</li>
              )}
            </ul>
          </div>
        )}
      </aside>
    </main>
  );
}
