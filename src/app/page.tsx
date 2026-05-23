"use client";

import { useEffect, useRef, useState } from "react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

interface UsageRecord {
  id: string;
  createdAt: string;
  requestType: "chat" | "summary" | "important";
  model: string;
  total_tokens: number;
  estimated_cost_usd: number;
}

interface SaveData {
  turn: number;
  character: any;
  relationships: Record<string, any>;
}

interface SaveResponse {
  exists: boolean;
  mock: boolean;
  model: string;
  save?: SaveData;
  messages?: Message[];
  usage?: UsageRecord[];
}

export default function Page() {
  const [save, setSave] = useState<SaveData | null>(null);
  const [model, setModel] = useState<string>("");
  const [mockMode, setMockMode] = useState<boolean>(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [usage, setUsage] = useState<UsageRecord[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [debug, setDebug] = useState<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 새 게임 폼 상태
  const [showNewGame, setShowNewGame] = useState(false);
  const [newName, setNewName] = useState("");
  const [newGender, setNewGender] = useState("남");
  const [newBackground, setNewBackground] = useState("산기슭 작은 마을의 평민 가정");

  useEffect(() => {
    fetchState();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, loading]);

  async function fetchState() {
    try {
      const r = await fetch("/api/save");
      const j: SaveResponse = await r.json();
      setModel(j.model || "");
      setMockMode(j.mock);
      if (j.exists && j.save) {
        setSave(j.save);
        setMessages(j.messages || []);
        setUsage(j.usage || []);
        setShowNewGame(false);
      } else {
        setShowNewGame(true);
      }
    } catch (e) {
      setError("상태 로드 실패: " + (e as Error).message);
    }
  }

  async function createNewGame(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const r = await fetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "new",
          character: {
            identity: {
              name: newName || "이름없음",
              gender: newGender,
              age: 5,
              family_background: newBackground,
            },
          },
        }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      await fetchState();
    } catch (e) {
      setError("새 게임 시작 실패: " + (e as Error).message);
    }
  }

  async function resetAll() {
    if (!confirm("정말 모든 세이브를 지울까요? 이 작업은 되돌릴 수 없어요.")) return;
    try {
      await fetch("/api/save", { method: "DELETE" });
      setSave(null);
      setMessages([]);
      setUsage([]);
      setShowNewGame(true);
    } catch (e) {
      setError("초기화 실패: " + (e as Error).message);
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
    const tempUserMsg: Message = {
      id: "tmp_" + Date.now(),
      role: "user",
      content: userInput,
      createdAt: new Date().toISOString(),
    };
    setMessages((prev) => [...prev, tempUserMsg]);
    try {
      const r = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userInput }),
      });
      const j = await r.json();
      if (!j.ok) {
        setError(j.error || "오류");
      } else {
        if (j.budgetWarning) setWarning(j.budgetWarning);
        if (j.saveErrorWarning) setWarning((w) => (w ? w + " · " : "") + j.saveErrorWarning);
        if (j.debug) setDebug(j.debug);
        // 서버에서 다시 가져와 동기화
        await fetchState();
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

  // 비용 계산
  const today = new Date().toDateString();
  const dailyCost = usage
    .filter((u) => new Date(u.createdAt).toDateString() === today)
    .reduce((s, u) => s + u.estimated_cost_usd, 0);
  const now = new Date();
  const monthlyCost = usage
    .filter((u) => {
      const d = new Date(u.createdAt);
      return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
    })
    .reduce((s, u) => s + u.estimated_cost_usd, 0);
  const totalTokens = usage.reduce((s, u) => s + u.total_tokens, 0);

  if (showNewGame) {
    return (
      <main className="min-h-screen flex items-center justify-center p-4">
        <form
          onSubmit={createNewGame}
          className="bg-ink-700/40 border border-ink-500/40 p-6 rounded-lg w-full max-w-md space-y-4"
        >
          <h1 className="text-2xl font-bold">새 무림인의 시작</h1>
          <p className="text-sm text-ink-300">
            모델: <span className="font-mono">{model}</span>
            {mockMode && (
              <span className="ml-2 px-2 py-0.5 text-xs bg-yellow-900/60 text-yellow-200 rounded">
                MOCK 모드 (API 키 없음)
              </span>
            )}
          </p>
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
          <button
            type="submit"
            className="w-full bg-ink-500 hover:bg-ink-300 text-ink-900 font-bold py-2 rounded"
          >
            5세부터 시작하기
          </button>
        </form>
      </main>
    );
  }

  const c = save?.character;

  return (
    <main className="min-h-screen grid grid-cols-1 lg:grid-cols-[1fr_320px]">
      {/* 좌측 채팅 영역 */}
      <section className="flex flex-col h-screen border-r border-ink-700">
        <header className="px-4 py-3 border-b border-ink-700 flex items-center justify-between">
          <h1 className="text-lg font-bold">무협 챗 게임</h1>
          <div className="text-xs text-ink-300 flex gap-3">
            <span>턴 {save?.turn ?? 0}</span>
            <span>모델: <span className="font-mono">{model}</span></span>
            {mockMode && (
              <span className="px-2 py-0.5 bg-yellow-900/60 text-yellow-200 rounded">MOCK</span>
            )}
            <button
              onClick={resetAll}
              className="text-red-300 hover:text-red-100 underline"
            >
              초기화
            </button>
          </div>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto scroll-area px-4 py-4 space-y-4">
          {messages.length === 0 && (
            <p className="text-ink-300 text-sm">
              아직 시작 전이에요. 첫 입력을 보내보세요. 예: "눈을 떠 천천히 주변을 살핀다."
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
          {loading && (
            <div className="text-ink-300 text-sm">강호가 천천히 응답하는 중…</div>
          )}
          {error && (
            <div className="bg-red-900/40 border border-red-700 text-red-200 p-3 rounded">
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
            placeholder="너의 행동을 입력해. (Ctrl/⌘+Enter로 전송)"
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
      </section>

      {/* 우측 상태/비용 패널 */}
      <aside className="hidden lg:flex flex-col h-screen overflow-y-auto scroll-area p-4 gap-4 text-sm">
        <div className="bg-ink-700/30 border border-ink-500/30 rounded p-3">
          <h2 className="font-bold mb-2">캐릭터</h2>
          {c ? (
            <ul className="space-y-1">
              <li>
                <span className="text-ink-300">이름:</span> {c.identity.name} ({c.identity.gender}, {c.identity.age}세)
              </li>
              <li>
                <span className="text-ink-300">구분:</span>{" "}
                {c.civilian_or_martial === "martial" ? "무림인" : "일반인"}
              </li>
              <li>
                <span className="text-ink-300">경지:</span> {c.realm?.current_stage} · 내공{" "}
                {c.realm?.internal_energy}/{c.realm?.internal_energy_cap}
              </li>
              <li>
                <span className="text-ink-300">HP:</span> {c.vitals?.hp_current}/{c.vitals?.hp_max}
                {" · "}내상 {c.vitals?.internal_injury} · 외상 {c.vitals?.external_injury}
              </li>
              <li>
                <span className="text-ink-300">위치:</span> {c.current_location_id || "(미정)"}
              </li>
              <li>
                <span className="text-ink-300">소속:</span> {c.affiliation?.sect_id || "무소속"}
              </li>
              <li>
                <span className="text-ink-300">은자:</span> {c.inventory?.silver_taels}냥
              </li>
            </ul>
          ) : (
            <p className="text-ink-300">캐릭터 없음</p>
          )}
        </div>

        <div className="bg-ink-700/30 border border-ink-500/30 rounded p-3">
          <h2 className="font-bold mb-2">관계 ({save ? Object.keys(save.relationships || {}).length : 0})</h2>
          <ul className="space-y-1 max-h-40 overflow-y-auto scroll-area">
            {save &&
              Object.entries(save.relationships || {}).map(([id, r]: [string, any]) => (
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
            <li>모델: <span className="font-mono">{model}</span></li>
          </ul>
        </div>

        {debug && (
          <div className="bg-ink-700/30 border border-ink-500/30 rounded p-3 text-xs">
            <h2 className="font-bold mb-2">디버그</h2>
            <ul className="space-y-1">
              <li>최근 메시지: {debug.recentMessageCount}</li>
              <li>주입 기억: {debug.memoryCount}</li>
              <li>추정 입력 토큰: {debug.estimatedInputTokens}</li>
            </ul>
          </div>
        )}
      </aside>
    </main>
  );
}
