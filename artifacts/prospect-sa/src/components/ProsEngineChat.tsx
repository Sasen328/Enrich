import { useState, useRef, useEffect, Fragment } from "react";
import {
  MessageCircle, Send, X, Loader2, Bot, User, ChevronDown, Zap, Search, Globe,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

// ── Inline markdown renderer — no external deps ─────────────────────────────
function MarkdownMessage({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // H3 ###
    if (line.startsWith("### ")) {
      elements.push(<p key={i} className="font-bold text-foreground mt-2 mb-0.5 text-[13px]">{inlineRender(line.slice(4))}</p>);
    // H2 ##
    } else if (line.startsWith("## ")) {
      elements.push(<p key={i} className="font-bold text-primary mt-2.5 mb-1 text-[13px] uppercase tracking-wide">{inlineRender(line.slice(3))}</p>);
    // H1 #
    } else if (line.startsWith("# ")) {
      elements.push(<p key={i} className="font-bold text-foreground mt-2 mb-1 text-sm">{inlineRender(line.slice(2))}</p>);
    // Bullet - or *
    } else if (/^[-*] /.test(line)) {
      elements.push(
        <div key={i} className="flex gap-1.5 items-start py-0.5">
          <span className="text-primary shrink-0 mt-0.5">•</span>
          <span>{inlineRender(line.slice(2))}</span>
        </div>
      );
    // Numbered list 1. 2. etc
    } else if (/^\d+\. /.test(line)) {
      const num = line.match(/^(\d+)\. /)?.[1] || "";
      elements.push(
        <div key={i} className="flex gap-1.5 items-start py-0.5">
          <span className="text-muted-foreground shrink-0 text-[11px] mt-0.5 min-w-[14px]">{num}.</span>
          <span>{inlineRender(line.slice(num.length + 2))}</span>
        </div>
      );
    // Horizontal rule
    } else if (line.trim() === "---" || line.trim() === "***") {
      elements.push(<hr key={i} className="border-border/40 my-1.5" />);
    // Empty line
    } else if (line.trim() === "") {
      elements.push(<div key={i} className="h-1.5" />);
    // Code block
    } else if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      elements.push(
        <pre key={`code-${i}`} className="bg-muted/40 rounded p-2 text-[10px] overflow-x-auto my-1 text-foreground/70 font-mono">{codeLines.join("\n")}</pre>
      );
    } else {
      elements.push(<p key={i} className="leading-relaxed">{inlineRender(line)}</p>);
    }
    i++;
  }
  return <div className="space-y-0.5 text-sm text-foreground/85">{elements}</div>;
}

function inlineRender(text: string): React.ReactNode {
  // Split by **bold**, *italic*, `code`
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={idx} className="text-foreground font-semibold">{part.slice(2, -2)}</strong>;
    if (part.startsWith("*") && part.endsWith("*"))
      return <em key={idx} className="text-foreground/70 italic">{part.slice(1, -1)}</em>;
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={idx} className="bg-white/10 px-1 rounded text-[11px] font-mono text-emerald-300">{part.slice(1, -1)}</code>;
    return <Fragment key={idx}>{part}</Fragment>;
  });
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type ModelId = "claude-sonnet" | "claude-haiku" | "gpt-4o";

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

interface AgentStep {
  agent: string;
  status: "running" | "done" | "failed";
  preview?: string;
}

interface Props {
  // New signature (used by tool pages after results)
  contextCompany?: string;
  reportType?: "company" | "person";
  // Legacy signature
  mode?: "person" | "website" | "seeder";
  context?: string;
  initialSuggestions?: string[];
  autoOpen?: boolean;
}

const MODELS: { id: ModelId; label: string; badge: string }[] = [
  { id: "claude-sonnet", label: "Claude Sonnet", badge: "Sonnet" },
  { id: "claude-haiku",  label: "Claude Haiku",  badge: "Haiku"  },
  { id: "gpt-4o",        label: "GPT-4o",        badge: "GPT-4o" },
];

const AGENT_ICONS: Record<string, React.ReactNode> = {
  "Perplexity search": <Search className="w-3 h-3" />,
  "URL crawl": <Globe className="w-3 h-3" />,
  "Deep research": <Zap className="w-3 h-3" />,
  "synthesising": <Zap className="w-3 h-3" />,
};

export default function ProsEngineChat({ mode: modeProp, context: contextProp, contextCompany, reportType, initialSuggestions, autoOpen }: Props) {
  // Normalize props — support both call signatures
  const mode = modeProp ?? (reportType === "person" ? "person" : "website");
  const context = contextProp ?? contextCompany ?? "";
  const [open, setOpen] = useState(!!autoOpen);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedModel, setSelectedModel] = useState<ModelId>("claude-sonnet");
  const [isPending, setIsPending] = useState(false);
  const [isError, setIsError] = useState(false);
  const [liveSteps, setLiveSteps] = useState<AgentStep[]>([]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Auto-open when context becomes available (data generated)
  useEffect(() => {
    if (autoOpen && context) setOpen(true);
  }, [autoOpen, context]);

  const suggestions = initialSuggestions ?? (
    mode === "person"
      ? ["What's the best way to approach this person?", "What are their likely pain points?", "Suggest 3 more people like this", "What should I know before the first meeting?"]
      : mode === "website"
        ? ["Summarise the top 5 companies found", "Which companies are the best prospects?", "What industries were most common?", "Export a ranked shortlist"]
        : ["Which records look most promising?", "Identify the decision-makers", "What's the typical revenue range here?", "Suggest an outreach sequence for this sector"]
  );

  const send = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || isPending) return;
    setInput("");
    setIsError(false);
    setLiveSteps([]);

    const userMessage: ChatMessage = { role: "user", content: msg };
    const newMessages: ChatMessage[] = [...messages, userMessage];
    setMessages(newMessages);
    setIsPending(true);

    abortRef.current = new AbortController();

    try {
      const resp = await fetch(`${BASE}/api/prosengine/chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: newMessages, context, mode, model: selectedModel }),
        signal: abortRef.current.signal,
      });

      if (!resp.ok || !resp.body) {
        throw new Error("Stream failed");
      }

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Parse SSE lines
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.startsWith("data: ")) continue;
          try {
            const payload = JSON.parse(line.slice(6)) as { event: string; data: Record<string, unknown> };
            const { event, data } = payload;

            if (event === "agent_start") {
              setLiveSteps(prev => [...prev, { agent: data.agent as string, status: "running" }]);
            } else if (event === "agent_done") {
              setLiveSteps(prev => prev.map(s =>
                s.agent === data.agent
                  ? { ...s, status: data.found ? "done" : "failed", preview: data.preview as string | undefined }
                  : s
              ));
            } else if (event === "synthesising") {
              setLiveSteps(prev => {
                const exists = prev.find(s => s.agent === "Synthesising");
                if (exists) return prev;
                return [...prev, { agent: "Synthesising", status: "running" }];
              });
            } else if (event === "reply") {
              setLiveSteps(prev => prev.map(s =>
                s.agent === "Synthesising" ? { ...s, status: "done" } : s
              ));
              const reply = (data.reply as string) || "No response received.";
              setMessages(prev => [...prev, { role: "assistant", content: reply }]);
            } else if (event === "done") {
              setLiveSteps([]);
            }
          } catch { /* ignore malformed SSE line */ }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        setIsError(true);
        // Fallback to non-streaming endpoint
        try {
          const r = await fetch(`${BASE}/api/prosengine/chat`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages: newMessages, context, mode, model: selectedModel }),
          });
          if (r.ok) {
            const data = await r.json() as { reply: string };
            setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
            setIsError(false);
          }
        } catch { /* fallback also failed */ }
      }
    } finally {
      setIsPending(false);
      setLiveSteps([]);
    }
  };

  useEffect(() => {
    if (open) setTimeout(() => bottomRef.current?.scrollIntoView({ behavior: "smooth" }), 100);
  }, [messages, open]);

  const modeLabel = mode === "person" ? "Person Intelligence" : mode === "website" ? "Website Intel" : "Data Seeder";
  const modeColor = mode === "person" ? "bg-violet-600 hover:bg-violet-700" : mode === "website" ? "bg-teal-600 hover:bg-teal-700" : "bg-amber-600 hover:bg-amber-700";
  const modeBorderColor = mode === "person" ? "border-violet-500/30" : mode === "website" ? "border-teal-500/30" : "border-amber-500/30";
  const modeAccent = mode === "person" ? "text-violet-400" : mode === "website" ? "text-teal-400" : "text-amber-400";

  return (
    <div className="fixed bottom-6 right-6 z-50 flex flex-col items-end gap-3">
      {/* Chat Panel */}
      {open && (
        <div className={`w-[400px] max-w-[calc(100vw-2rem)] rounded-2xl border ${modeBorderColor} bg-[#111318] shadow-2xl shadow-black/50 flex flex-col overflow-hidden`}
          style={{ height: "540px" }}>
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-white/8 bg-white/3 shrink-0">
            <div className="w-7 h-7 rounded-lg bg-primary/20 flex items-center justify-center">
              <Bot className={`w-4 h-4 ${modeAccent}`} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-foreground">AI Research Assistant</p>
              <p className="text-xs text-muted-foreground">{modeLabel} · Ask anything</p>
            </div>
            {/* Model selector */}
            <div className="flex gap-1 bg-muted/40 rounded-lg p-0.5 border border-white/8">
              {MODELS.map(m => (
                <button
                  key={m.id}
                  onClick={() => setSelectedModel(m.id)}
                  className={`text-[10px] font-medium px-2 py-1 rounded-md transition-all ${
                    selectedModel === m.id
                      ? "bg-primary/25 text-foreground border border-primary/30"
                      : "text-foreground/40 hover:text-foreground/70"
                  }`}
                  title={m.label}
                >
                  {m.badge}
                </button>
              ))}
            </div>
            <Button variant="ghost" size="icon" className="w-7 h-7 text-muted-foreground hover:text-foreground shrink-0"
              onClick={() => setOpen(false)}>
              <ChevronDown className="w-4 h-4" />
            </Button>
          </div>

          {/* Messages */}
          <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0">
            {messages.length === 0 && (
              <div className="space-y-3">
                <div className="flex items-start gap-2">
                  <div className="w-6 h-6 rounded-full bg-primary/20 flex items-center justify-center shrink-0 mt-0.5">
                    <Bot className={`w-3.5 h-3.5 ${modeAccent}`} />
                  </div>
                  <div className="flex-1 bg-muted/40 rounded-xl rounded-tl-sm px-3 py-2.5 text-sm text-foreground/85">
                    I have full context of the generated {modeLabel.toLowerCase()} data. Ask me anything — follow-up research, corrections, deeper analysis, or outreach strategy.
                  </div>
                </div>
                <div className="space-y-1.5 pl-8">
                  {suggestions.map((s, i) => (
                    <button key={i} onClick={() => send(s)}
                      className="w-full text-left text-xs px-3 py-2 rounded-lg border border-white/8 bg-white/3 text-foreground/70 hover:bg-white/8 hover:text-foreground transition-all">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {messages.map((msg, i) => (
              <div key={i} className={`flex items-start gap-2 ${msg.role === "user" ? "flex-row-reverse" : ""}`}>
                <div className={`w-6 h-6 rounded-full flex items-center justify-center shrink-0 mt-0.5 ${msg.role === "user" ? "bg-primary/20" : "bg-white/8"}`}>
                  {msg.role === "user"
                    ? <User className="w-3.5 h-3.5 text-primary" />
                    : <Bot className={`w-3.5 h-3.5 ${modeAccent}`} />}
                </div>
                <div className={`flex-1 rounded-xl px-3 py-2.5 max-w-[85%] ${
                  msg.role === "user"
                    ? "bg-primary/15 text-foreground rounded-tr-sm text-sm leading-relaxed whitespace-pre-wrap"
                    : "bg-muted/40 rounded-tl-sm"}`}>
                  {msg.role === "user"
                    ? msg.content
                    : <MarkdownMessage text={msg.content} />}
                </div>
              </div>
            ))}
            {isPending && liveSteps.length > 0 && (
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full bg-white/8 flex items-center justify-center shrink-0 mt-0.5">
                  <Bot className={`w-3.5 h-3.5 ${modeAccent}`} />
                </div>
                <div className="bg-muted/40 rounded-xl rounded-tl-sm px-3 py-2.5 flex-1 space-y-1.5">
                  {liveSteps.map((step, i) => (
                    <div key={i} className="flex items-center gap-2 text-[11px]">
                      <span className={`flex items-center justify-center w-4 h-4 rounded-full shrink-0 ${
                        step.status === "running" ? "text-amber-400" : step.status === "done" ? "text-emerald-400" : "text-red-400"
                      }`}>
                        {step.status === "running"
                          ? <Loader2 className="w-3 h-3 animate-spin" />
                          : AGENT_ICONS[step.agent] ?? <Zap className="w-3 h-3" />}
                      </span>
                      <span className={`${step.status === "running" ? "text-foreground/70" : step.status === "done" ? "text-foreground/50" : "text-red-400/70"}`}>
                        {step.agent}
                        {step.status === "done" ? " ✓" : step.status === "failed" ? " ✗" : "…"}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {isPending && liveSteps.length === 0 && (
              <div className="flex items-start gap-2">
                <div className="w-6 h-6 rounded-full bg-white/8 flex items-center justify-center shrink-0">
                  <Bot className={`w-3.5 h-3.5 ${modeAccent}`} />
                </div>
                <div className="bg-muted/40 rounded-xl rounded-tl-sm px-3 py-2.5">
                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
            {isError && (
              <p className="text-xs text-red-400 text-center">Request failed. Please try again.</p>
            )}
            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div className="px-4 py-3 border-t border-white/8 bg-white/2 shrink-0">
            <div className="flex gap-2 items-end">
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
                placeholder="Ask a follow-up, request corrections, or fetch more data…"
                className="flex-1 min-h-[38px] max-h-[100px] resize-none bg-muted/40 border-border/40 text-foreground placeholder:text-muted-foreground text-sm py-2 px-3"
                rows={1}
              />
              <Button size="icon" onClick={() => send()}
                disabled={!input.trim() || isPending}
                className={`h-9 w-9 shrink-0 ${modeColor}`}>
                {isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </Button>
            </div>
            <p className="text-[10px] text-muted-foreground/50 text-center mt-1.5">
              {MODELS.find(m => m.id === selectedModel)?.label} · AI-powered · verify before acting
            </p>
          </div>
        </div>
      )}

      {/* Toggle Button */}
      <Button onClick={() => setOpen(!open)}
        className={`${modeColor} shadow-xl shadow-black/40 gap-2 px-4 py-2.5 h-auto font-medium`}>
        {open ? <X className="w-4 h-4" /> : <MessageCircle className="w-4 h-4" />}
        {open ? "Close" : "AI Assistant"}
        {!open && messages.length > 0 && (
          <span className="bg-white/20 text-foreground text-xs px-1.5 py-0.5 rounded-full">{messages.filter(m => m.role === "user").length}</span>
        )}
      </Button>
    </div>
  );
}
