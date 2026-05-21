import { useEffect, useRef, useState } from "react";
import { Send, Loader2, Sparkles, User, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import ChatLayout from "@/components/composer/ChatLayout";
import { CustomizeDrawer } from "@/components/composer/CustomizeDrawer";
import { ReportView } from "@/components/composer/ReportView";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Tool-use breadcrumbs surfaced by the SSE stream (e.g. "🔍 Perplexity search"). */
  steps?: Array<{ agent: string; description?: string; found?: boolean }>;
  blocks?: Array<Record<string, unknown>>;
}

const SUGGESTIONS = [
  "Find me 5 SaaS CTOs in Riyadh actively hiring engineers",
  "Research https://www.stc.com.sa and summarize the board",
  "Who at Aramco handles digital transformation procurement?",
  "Find Saudi manufacturers exporting to UAE who raised funding in 2024",
];

export default function AIChatPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [showComposer, setShowComposer] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  async function send(text?: string) {
    const content = (text ?? input).trim();
    if (!content || streaming) return;

    const userMsg: Message = { id: `u-${Date.now()}`, role: "user", content };
    const assistantMsg: Message = { id: `a-${Date.now()}`, role: "assistant", content: "", steps: [] };
    setMessages((m) => [...m, userMsg, assistantMsg]);
    setInput("");
    setStreaming(true);

    try {
      const history = messages.map((m) => ({ role: m.role, content: m.content }));
      const res = await fetch(`${BASE}/api/ai-chat/stream`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: content, history }),
      });

      if (!res.body) throw new Error("No response body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() || "";

        for (const line of lines) {
          if (!line.startsWith("data:")) continue;
          const payload = line.slice(5).trim();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload);
            const ev = parsed.event;
            const data = parsed.data;
            setMessages((prev) => {
              const next = [...prev];
              const last = next[next.length - 1];
              if (!last || last.role !== "assistant") return next;
              if (ev === "token" || ev === "text" || ev === "chunk") {
                last.content += typeof data === "string" ? data : data?.text ?? "";
              } else if (ev === "agent_start") {
                last.steps = [...(last.steps || []), { agent: data?.agent || "Agent", description: data?.description }];
              } else if (ev === "agent_done") {
                const arr = last.steps || [];
                const idx = arr.findIndex((s) => s.agent === data?.agent && s.found === undefined);
                if (idx >= 0) arr[idx] = { ...arr[idx], found: !!data?.found };
                last.steps = [...arr];
              } else if (ev === "final" || ev === "reply") {
                if (typeof data === "string") last.content = data;
                else if (data?.reply) last.content = data.reply;
              }
              return next;
            });
          } catch { /* skip malformed line */ }
        }
      }
    } catch (err) {
      setMessages((prev) => {
        const next = [...prev];
        const last = next[next.length - 1];
        if (last && last.role === "assistant") {
          last.content = `⚠ ${err instanceof Error ? err.message : String(err)}`;
        }
        return next;
      });
    } finally {
      setStreaming(false);
    }
  }

  return (
    <div className="flex flex-col h-screen max-h-screen">
      {/* Header */}
      <div className="border-b border-border/40 px-4 py-3 bg-card/65 backdrop-blur">
        <h1 className="text-lg font-bold flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-primary" />
          AI Chat Agent
          <span className="text-[10px] font-normal text-muted-foreground ml-1">· Composer + multi-agent</span>
          <Button
            variant="ghost"
            size="sm"
            className="ml-auto gap-1.5"
            onClick={() => setShowComposer((v) => !v)}
            title="Toggle composer"
          >
            <Settings2 className="w-3.5 h-3.5" />
            {showComposer ? "Plain chat" : "Composer"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5"
            onClick={() => setDrawerOpen(true)}
            title="Customize skills / templates / sources"
          >
            <Settings2 className="w-3.5 h-3.5" />
            Customize
          </Button>
        </h1>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-6">
        <div className="max-w-3xl mx-auto space-y-6">
          {showComposer && messages.length === 0 && (
            // Full 6-stage composer experience (per v8 prototype):
            // Compose → Enhance → Clarify → Run → Report → Enrich +
            // BehaviorAgent + MegaMindBanner + HistoryBar + ReportView.
            <ChatLayout />
          )}

          {!showComposer && messages.length === 0 && (
            <div className="text-center py-12">
              <div className="inline-flex w-14 h-14 rounded-2xl items-center justify-center mb-4 brand-gradient">
                <Sparkles className="w-7 h-7 text-foreground" />
              </div>
              <h2 className="text-xl font-bold mb-2">What do you want to research?</h2>
              <p className="text-sm text-muted-foreground mb-6">
                Ask in plain English. The agent will route to Perplexity, deep research, URL crawl, or knowledge as needed.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-w-2xl mx-auto">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    onClick={() => send(s)}
                    className="text-left text-xs p-3 rounded-lg border border-border/40 bg-card/65 hover:bg-card/70 hover:border-primary/30 transition-colors"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map((m) => (
            <div key={m.id} className={cn("flex gap-3", m.role === "user" && "justify-end")}>
              {m.role === "assistant" && (
                <div className="w-8 h-8 rounded-lg flex-shrink-0 brand-gradient flex items-center justify-center text-foreground">
                  <Sparkles className="w-4 h-4" />
                </div>
              )}
              <div className={cn(
                "rounded-2xl px-4 py-3 max-w-[85%] text-sm whitespace-pre-wrap",
                m.role === "user"
                  ? "bg-primary text-primary-foreground"
                  : "bg-card/70 border border-border/40",
              )}>
                {m.steps && m.steps.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {m.steps.map((s, i) => (
                      <div key={i} className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                        <span className="w-1 h-1 rounded-full bg-primary inline-block" />
                        <span className="font-medium">{s.agent}</span>
                        {s.description && <span>· {s.description}</span>}
                        {s.found === true && <span className="text-emerald-500">✓</span>}
                        {s.found === false && <span className="text-amber-500">∅</span>}
                      </div>
                    ))}
                  </div>
                )}
                {m.blocks ? (
                  <ReportView
                    blocks={m.blocks as Parameters<typeof ReportView>[0]["blocks"]}
                    rawText={m.content}
                    title="Research Report"
                  />
                ) : (
                  m.content || (m.role === "assistant" && streaming && <Loader2 className="w-3 h-3 animate-spin inline" />)
                )}
                {m.role === "assistant" && m.content && !m.blocks && !streaming && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="mt-2 text-[10px] h-6 gap-1"
                    onClick={async () => {
                      const r = await fetch(`${BASE}/api/composer/render-blocks`, {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ rawText: m.content, shape: "detail" }),
                      });
                      const data = await r.json();
                      setMessages((prev) => prev.map((x) => x.id === m.id ? { ...x, blocks: data.blocks } : x));
                    }}
                  >
                    📊 Render structured + export
                  </Button>
                )}
              </div>
              {m.role === "user" && (
                <div className="w-8 h-8 rounded-lg flex-shrink-0 bg-muted flex items-center justify-center">
                  <User className="w-4 h-4" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="border-t border-border/40 bg-card/65 backdrop-blur px-4 py-3">
        <form
          onSubmit={(e) => { e.preventDefault(); send(); }}
          className="max-w-3xl mx-auto flex gap-2"
        >
          <Input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask anything... (e.g. 'Find CTOs at Saudi fintechs that raised in 2024')"
            disabled={streaming}
            className="flex-1"
          />
          <Button type="submit" disabled={streaming || !input.trim()} className="gap-1.5">
            {streaming ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </Button>
        </form>
        <p className="text-[10px] text-muted-foreground text-center mt-2 max-w-3xl mx-auto">
          The agent calls Perplexity, Tavily, and deep-research tools as needed. Token cost is on the configured LLM provider.
        </p>
      </div>
      <CustomizeDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
    </div>
  );
}
