/**
 * AIAssistant.tsx
 * Google Gemini 2.5 Pro powered AI Operations Advisor for Port ICCC.
 * Renders structured response cards with impact analysis, recommendations, and severity.
 * Maintains rolling 8-message conversation window.
 */

'use client';

import { useState, useRef, useEffect } from 'react';
import { useSimulationStore, AIMessage } from '@/store/useSimulationStore';
import { Bot, Send, Loader as Loader2, TriangleAlert as AlertTriangle, SquareCheck as CheckSquare, Square, ChartBar as BarChart3, Zap, ChevronDown, MessageSquare, FlaskConical, X, CloudRain, Wrench, Truck, Container, Ship, Waves } from 'lucide-react';
// @ts-ignore — JS module; types inferred at runtime
import { buildScenarioUserMessage } from '@/lib/promptBuilder';

const SCENARIO_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  heavy_rain:           { label: 'Heavy Rain',       icon: <CloudRain className="w-3 h-3" />,    color: 'bg-sky-900/60 border-sky-600/60 text-sky-300' },
  crane_breakdown:      { label: 'Crane Breakdown',  icon: <Wrench className="w-3 h-3" />,        color: 'bg-violet-900/60 border-violet-600/60 text-violet-300' },
  truck_inbound_surge:  { label: 'Truck Surge',      icon: <Truck className="w-3 h-3" />,         color: 'bg-orange-900/60 border-orange-600/60 text-orange-300' },
  yard_near_saturation: { label: 'Yard Saturation',  icon: <Container className="w-3 h-3" />,     color: 'bg-amber-900/60 border-amber-600/60 text-amber-300' },
  CLOSE_GATE:           { label: 'Gate Closure',     icon: <X className="w-3 h-3" />,             color: 'bg-red-900/60 border-red-600/60 text-red-300' },
  BUNCH_SHIPS:          { label: 'Ship Bunching',    icon: <Waves className="w-3 h-3" />,         color: 'bg-rose-900/60 border-rose-600/60 text-rose-300' },
  ADD_VESSELS:          { label: 'Extra Vessels',    icon: <Ship className="w-3 h-3" />,          color: 'bg-amber-900/60 border-amber-600/60 text-amber-300' },
  INCREASE_TRUCKS:      { label: 'Truck Volume',     icon: <Truck className="w-3 h-3" />,         color: 'bg-orange-900/60 border-orange-600/60 text-orange-300' },
};

const SEVERITY_COLORS: Record<string, string> = {
  CRITICAL: 'text-red-400 bg-red-950/40 border-red-700/50',
  HIGH: 'text-red-300 bg-red-900/30 border-red-700/40',
  MEDIUM: 'text-amber-300 bg-amber-900/30 border-amber-700/40',
  LOW: 'text-blue-300 bg-blue-900/30 border-blue-700/40',
};

const SUGGESTED_QUERIES = [
  'What happens if Gate 3 stays closed for 6 hours?',
  'Analyze current vessel bunching risk',
  'How can I reduce carbon emissions index?',
  'What is the impact on DPD if truck volume increases 30%?',
  'Recommend actions for pre-berthing detention above threshold',
];

function AIResponseCard({
  msg,
  onActionChecked,
}: {
  msg: AIMessage;
  onActionChecked?: (rec: string, checked: boolean) => void;
}) {
  const p = msg.parsed;
  const [checkedRecs, setCheckedRecs] = useState<Set<number>>(new Set());

  if (!p) {
    return (
      <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-3 mb-3">
        <p className="text-xs text-slate-300 leading-relaxed">{msg.content}</p>
      </div>
    );
  }

  const severityStyle = SEVERITY_COLORS[p.severity] || SEVERITY_COLORS.LOW;

  function toggleRec(i: number) {
    setCheckedRecs(s => {
      const n = new Set(s);
      const isNowChecked = !n.has(i);
      isNowChecked ? n.add(i) : n.delete(i);
      onActionChecked?.(p!.recommendations[i], isNowChecked);
      return n;
    });
  }

  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl overflow-hidden mb-3">
      {/* Header bar */}
      <div className={`flex items-center justify-between px-3 py-2 border-b border-slate-700/50 ${
        p.severity === 'HIGH' || p.severity === 'CRITICAL' ? 'bg-red-950/30' : 'bg-slate-800/80'
      }`}>
        <div className="flex items-center gap-2">
          <Bot className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-xs text-slate-400 font-medium">AI Advisor Response</span>
        </div>
        <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${severityStyle}`}>
          {p.severity}
        </span>
      </div>

      {/* Summary */}
      <div className="px-3 py-2.5 border-b border-slate-700/40">
        <p className="text-xs text-slate-200 leading-relaxed">{p.summary}</p>
      </div>

      {/* Impact grid */}
      <div className="px-3 py-2.5 border-b border-slate-700/40">
        <div className="flex items-center gap-1.5 mb-2">
          <BarChart3 className="w-3 h-3 text-cyan-400" />
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Operational Impact</span>
        </div>
        <div className="grid grid-cols-2 gap-1.5">
          {[
            { label: 'TAT Delta', value: p.impact.tat_delta },
            { label: 'Congestion', value: p.impact.congestion_change },
            { label: 'Carbon Delta', value: p.impact.carbon_delta },
            { label: 'Affected Vessels', value: String(p.impact.affected_vessels) },
          ].map(({ label, value }) => (
            <div key={label} className="bg-slate-900/60 rounded-lg px-2 py-1.5">
              <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
              <p className="text-xs text-slate-300 font-medium leading-snug">{value}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Recommendations */}
      <div className="px-3 py-2.5">
        <div className="flex items-center gap-1.5 mb-2">
          <Zap className="w-3 h-3 text-amber-400" />
          <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Recommended Actions</span>
          {checkedRecs.size > 0 && (
            <span className="text-[10px] text-emerald-500 ml-auto">
              {checkedRecs.size} actioned
            </span>
          )}
        </div>
        <div className="space-y-1.5">
          {p.recommendations.map((rec, i) => (
            <button
              key={i}
              onClick={() => toggleRec(i)}
              className="flex items-start gap-2 w-full text-left group"
            >
              {checkedRecs.has(i)
                ? <CheckSquare className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                : <Square className="w-3.5 h-3.5 text-slate-600 shrink-0 mt-0.5 group-hover:text-slate-400" />
              }
              <span className={`text-xs leading-snug transition-colors ${
                checkedRecs.has(i) ? 'text-emerald-400 line-through opacity-60' : 'text-slate-300 group-hover:text-slate-200'
              }`}>
                {rec}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function UserMessage({ msg }: { msg: AIMessage }) {
  return (
    <div className="flex justify-end mb-3">
      <div className="max-w-[85%] bg-cyan-950/50 border border-cyan-800/40 rounded-xl px-3 py-2">
        <p className="text-xs text-cyan-200">{msg.content}</p>
      </div>
    </div>
  );
}

export function AIAssistant() {
  const {
    chatMessages, addChatMessage, userRole,
    vessels, gates, trucks, kpis, alerts,
    yard, activeScenarioIds, simTime, timingProfile, weatherScenario,
    pendingScenarioAdvice, clearPendingScenarioAdvice,
  } = useSimulationStore();
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);
  /** Tracks recommendations the operator has already marked as actioned. */
  const takenActionsRef = useRef<Set<string>>(new Set());

  function handleActionChecked(rec: string, checked: boolean) {
    if (checked) {
      takenActionsRef.current.add(rec);
    } else {
      takenActionsRef.current.delete(rec);
    }
  }

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [chatMessages]);

  function buildPortContext() {
    return {
      vessels, gates, trucks, kpis, alerts, yard,
      activeScenarioIds, simTime, weatherScenario,
      lastTimingProfile: timingProfile,
    };
  }

  async function analyzeScenario() {
    if (!pendingScenarioAdvice || loading) return;
    const advice = pendingScenarioAdvice;
    clearPendingScenarioAdvice();
    const msg = buildScenarioUserMessage(advice.scenarioId, buildPortContext());
    await sendMessage(msg);
  }

  async function sendMessage(text?: string) {
    const rawContent = text || input.trim();
    if (!rawContent) return;

    // Prepend actioned recommendations so Gemini doesn't repeat them
    const taken = Array.from(takenActionsRef.current);
    const content = taken.length > 0
      ? `${rawContent}\n\nACTIONS ALREADY TAKEN BY OPERATOR — do NOT repeat these in recommendations:\n${taken.map(a => `- ${a}`).join('\n')}`
      : rawContent;

    setInput('');
    setShowSuggestions(false);
    setLoading(true);

    const userMsg: AIMessage = {
      role: 'user',
      content: rawContent, // store the clean version for display
      timestamp: new Date().toISOString(),
    };
    addChatMessage(userMsg);

    // Build conversation history (last 8 exchanges).
    // The final user message uses `content` (which may include taken-actions context)
    // rather than `userMsg.content` (the display-only clean version).
    const historyMessages = chatMessages.slice(-14).map(m => ({ role: m.role, content: m.content }));
    const historyToSend = [...historyMessages, { role: 'user' as const, content }];

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: historyToSend,
          context: buildPortContext(),
          userRole,
        }),
      });

      const data = await res.json();

      const assistantMsg: AIMessage = {
        role: 'assistant',
        content: JSON.stringify(data),
        timestamp: new Date().toISOString(),
        parsed: data,
      };
      addChatMessage(assistantMsg);
    } catch {
      addChatMessage({
        role: 'assistant',
        content: 'Failed to reach AI service. Check network connection.',
        timestamp: new Date().toISOString(),
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex flex-col px-4 py-3 border-b border-slate-700/60 shrink-0 gap-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Bot className="w-4 h-4 text-cyan-400" />
            <span className="text-sm font-semibold text-slate-200">AI Advisor</span>
            <span className="text-[10px] bg-cyan-950 text-cyan-400 px-1.5 py-0.5 rounded font-medium border border-cyan-800/50">
              Gemini 2.5 Pro
            </span>
          </div>
          <span className="text-[10px] text-slate-500">{userRole}</span>
        </div>
        {/* Active scenario badges */}
        {activeScenarioIds.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {activeScenarioIds.length > 1 && (
              <span className="text-[10px] px-1.5 py-0.5 rounded border font-semibold bg-red-950/60 border-red-600/60 text-red-300 animate-pulse">
                ⚠ COMPOUND CRISIS
              </span>
            )}
            {activeScenarioIds.map(id => {
              const meta = SCENARIO_META[id];
              if (!meta) return null;
              return (
                <span
                  key={id}
                  className={`flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${meta.color}`}
                >
                  {meta.icon}
                  {meta.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Pending scenario advice banner */}
      {pendingScenarioAdvice && (
        <div className={`mx-3 mt-2 mb-1 rounded-xl border backdrop-blur-sm overflow-hidden shrink-0 ${
          activeScenarioIds.length > 1
            ? 'border-red-700/60 bg-red-950/30'
            : 'border-cyan-700/60 bg-cyan-950/40'
        }`}>
          <div className={`flex items-center gap-2 px-3 py-2 border-b ${
            activeScenarioIds.length > 1
              ? 'border-red-800/40 bg-red-900/20'
              : 'border-cyan-800/40 bg-cyan-900/20'
          }`}>
            <FlaskConical className={`w-3.5 h-3.5 shrink-0 ${activeScenarioIds.length > 1 ? 'text-red-400' : 'text-cyan-400'}`} />
            <span className={`text-[11px] font-semibold flex-1 truncate ${activeScenarioIds.length > 1 ? 'text-red-300' : 'text-cyan-300'}`}>
              {activeScenarioIds.length > 1
                ? `Compound Crisis: ${activeScenarioIds.length} simultaneous scenarios`
                : `What-If Active: ${pendingScenarioAdvice.scenarioLabel}`}
            </span>
            <button
              onClick={clearPendingScenarioAdvice}
              className="text-slate-500 hover:text-slate-300 shrink-0"
              title="Dismiss"
            >
              <X className="w-3 h-3" />
            </button>
          </div>
          <div className="px-3 py-2 flex items-center justify-between gap-3">
            <p className="text-[10px] text-slate-400 leading-relaxed">
              {activeScenarioIds.length > 1
                ? 'Multiple scenarios active simultaneously. AI will analyze cascading cross-scenario effects and provide compound crisis recommendations.'
                : 'Port state snapshot captured. Click to get AI analysis with specific gate, vessel, and yard recommendations.'}
            </p>
            <button
              onClick={analyzeScenario}
              disabled={loading}
              className={`shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed text-white text-[11px] font-semibold transition-colors ${
                activeScenarioIds.length > 1
                  ? 'bg-red-700 hover:bg-red-600'
                  : 'bg-cyan-600 hover:bg-cyan-500'
              }`}
            >
              {loading ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Zap className="w-3 h-3" />
              )}
              {activeScenarioIds.length > 1 ? 'Analyze Compound Crisis' : 'Analyze & Get Advice'}
            </button>
          </div>
        </div>
      )}

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
        {chatMessages.length === 0 && showSuggestions && (
          <div className="mb-4">
            <div className="flex items-center gap-2 mb-3">
              <MessageSquare className="w-3.5 h-3.5 text-slate-500" />
              <span className="text-[11px] text-slate-500">Suggested queries for {userRole}</span>
            </div>
            <div className="space-y-1.5">
              {SUGGESTED_QUERIES.map(q => (
                <button
                  key={q}
                  onClick={() => sendMessage(q)}
                  className="w-full text-left text-xs text-slate-400 bg-slate-800/50 border border-slate-700/50 rounded-lg px-3 py-2 hover:bg-slate-700/60 hover:border-slate-600/60 hover:text-slate-300 transition-all"
                >
                  {q}
                </button>
              ))}
            </div>
          </div>
        )}

        {chatMessages.map((msg, i) => (
          msg.role === 'user'
            ? <UserMessage key={i} msg={msg} />
            : <AIResponseCard key={i} msg={msg} onActionChecked={handleActionChecked} />
        ))}

        {loading && (
          <div className="flex items-center gap-2 text-xs text-slate-500 mb-3">
            <Loader2 className="w-3 h-3 animate-spin text-cyan-400" />
            <span>AI analyzing port state...</span>
          </div>
        )}
      </div>

      {/* Input */}
      <div className="px-3 pb-3 shrink-0">
        <div className="flex gap-2">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && !e.shiftKey && sendMessage()}
            placeholder="Ask about port operations, congestion, or vessel schedules..."
            className="flex-1 bg-slate-800/80 border border-slate-700/60 rounded-lg px-3 py-2 text-xs text-slate-200 placeholder:text-slate-600 focus:outline-none focus:border-cyan-500/50 focus:bg-slate-800"
            disabled={loading}
          />
          <button
            onClick={() => sendMessage()}
            disabled={loading || !input.trim()}
            className="px-3 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {loading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-white" />
            ) : (
              <Send className="w-3.5 h-3.5 text-white" />
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
