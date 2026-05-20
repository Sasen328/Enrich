/**
 * CustomizeDrawer — slide-out panel for managing user Skills, Templates,
 * Sources. CRUD via /api/composer/{skills,templates,user-sources}.
 */

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Plus, Sparkles, Save, Trash2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface UserSkill { id: number; name: string; description: string | null; systemPrompt: string; toolWhitelist: string[]; reportSchema: string; modelTier: string | null; visibility: string; enabled: boolean }
interface UserTemplate { id: number; name: string; defaultQuestion: string; defaultModes: string[]; defaultTarget: string; defaultIndustry: string | null; defaultCountries: string[]; requiredSchema: string }
interface UserSource { id: number; label: string; url: string; category: string | null; language: string | null }

interface Props { open: boolean; onClose: () => void }

const TABS = ["skills", "templates", "sources"] as const;
type Tab = typeof TABS[number];

export function CustomizeDrawer({ open, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("skills");
  return (
    <div className={`fixed inset-y-0 right-0 w-[420px] max-w-[92vw] bg-card border-l border-border shadow-2xl transition-transform z-40 overflow-y-auto ${open ? "translate-x-0" : "translate-x-full"}`}>
      <div className="flex items-center gap-2 p-4 border-b border-border sticky top-0 bg-card z-10">
        <Sparkles className="w-4 h-4 text-primary" />
        <h2 className="font-bold">Customize</h2>
        <Button variant="ghost" size="sm" onClick={onClose} className="ml-auto"><X className="w-4 h-4" /></Button>
      </div>
      <div className="flex gap-1 p-2 border-b border-border">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize transition-colors ${
              tab === t ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-muted"
            }`}>{t}</button>
        ))}
      </div>
      <div className="p-4">
        {tab === "skills" && <SkillsTab />}
        {tab === "templates" && <TemplatesTab />}
        {tab === "sources" && <SourcesTab />}
      </div>
    </div>
  );
}

// ── SKILLS ────────────────────────────────────────────────────────────────────
function SkillsTab() {
  const qc = useQueryClient();
  const list = useQuery<{ skills: Array<UserSkill & { id: string | number; label?: string; isUser?: boolean; dbId?: number }> }>({
    queryKey: ["/api/composer/skills"],
    queryFn: () => fetch(`${BASE}/api/composer/skills`).then((r) => r.json()),
  });
  const create = useMutation({
    mutationFn: (body: Partial<UserSkill>) => fetch(`${BASE}/api/composer/skills`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/composer/skills"] }),
  });
  const userSkills = (list.data?.skills || []).filter((s) => s.isUser);
  return (
    <div>
      <NewItem label="+ Create skill" onCreate={() => create.mutate({ name: "New skill", systemPrompt: "You are a research specialist...", toolWhitelist: ["web_search"], reportSchema: "Custom" })} />
      {userSkills.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-6">No custom skills yet. Click + above to create one.</div>
      ) : (
        userSkills.map((s) => <SkillCard key={s.id} skill={s as unknown as UserSkill} dbId={s.dbId as number} />)
      )}
    </div>
  );
}

function SkillCard({ skill, dbId }: { skill: UserSkill; dbId: number }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<UserSkill>(skill);
  const save = useMutation({
    mutationFn: (body: Partial<UserSkill>) => fetch(`${BASE}/api/composer/skills/${dbId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/composer/skills"] }),
  });
  const remove = useMutation({
    mutationFn: () => fetch(`${BASE}/api/composer/skills/${dbId}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/composer/skills"] }),
  });
  return (
    <div className="border border-border rounded-lg p-3 mb-2 bg-card">
      <div className="flex items-center gap-2 cursor-pointer" onClick={() => setOpen((v) => !v)}>
        <div className="flex-1">
          <div className="text-sm font-bold">{form.name}</div>
          <div className="text-[10px] text-muted-foreground">{form.toolWhitelist.length} tools · {form.reportSchema}</div>
        </div>
        {open ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
      </div>
      {open && (
        <div className="pt-3 mt-3 border-t border-dashed border-border space-y-2">
          <FormRow label="Name"><input className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></FormRow>
          <FormRow label="System prompt">
            <textarea className="input font-mono" rows={5} value={form.systemPrompt} onChange={(e) => setForm({ ...form, systemPrompt: e.target.value })} />
          </FormRow>
          <FormRow label="Tool whitelist (comma-sep)">
            <input className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs" value={form.toolWhitelist.join(",")} onChange={(e) => setForm({ ...form, toolWhitelist: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })} />
          </FormRow>
          <FormRow label="Report schema">
            <select className="w-full bg-background border border-border rounded-md px-2 py-1.5 text-xs" value={form.reportSchema} onChange={(e) => setForm({ ...form, reportSchema: e.target.value })}>
              <option>LeadList</option><option>CompanyDossier</option><option>CompareMatrix</option><option>SignalDigest</option><option>Custom</option>
            </select>
          </FormRow>
          <div className="flex gap-2 justify-end pt-2">
            <Button variant="ghost" size="sm" onClick={() => remove.mutate()} className="text-rose-500 gap-1"><Trash2 className="w-3 h-3" />Delete</Button>
            <Button size="sm" onClick={() => save.mutate(form)} className="gap-1"><Save className="w-3 h-3" />Save</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── TEMPLATES ─────────────────────────────────────────────────────────────────
function TemplatesTab() {
  const qc = useQueryClient();
  const list = useQuery<{ templates: Array<{ id: string | number; label?: string; name?: string; isUser?: boolean; dbId?: number; defaultQuestion?: string; defaultModes?: string[]; defaultTarget?: string; defaultCountries?: string[] }> }>({
    queryKey: ["/api/composer/templates"],
    queryFn: () => fetch(`${BASE}/api/composer/templates`).then((r) => r.json()),
  });
  const create = useMutation({
    mutationFn: (body: Partial<UserTemplate>) => fetch(`${BASE}/api/composer/templates`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/composer/templates"] }),
  });
  const user = (list.data?.templates || []).filter((t) => t.isUser);
  return (
    <div>
      <NewItem label="+ Create template" onCreate={() => create.mutate({ name: "My new template", defaultQuestion: "Describe your research question here.", defaultModes: ["leadgen"], defaultCountries: ["sa"] })} />
      {user.length === 0 ? (
        <div className="text-xs text-muted-foreground text-center py-6">No saved templates yet. Create one or save from a successful run.</div>
      ) : user.map((t) => (
        <div key={t.id} className="border border-border rounded-lg p-3 mb-2 bg-card">
          <div className="text-sm font-bold">{t.name || t.label}</div>
          <div className="text-[10px] text-muted-foreground mt-1">{(t.defaultModes || []).join(" + ")} · {(t.defaultCountries || []).join(",")}</div>
          <div className="text-xs mt-2 text-muted-foreground">{t.defaultQuestion?.slice(0, 120)}</div>
        </div>
      ))}
    </div>
  );
}

// ── SOURCES ───────────────────────────────────────────────────────────────────
function SourcesTab() {
  const qc = useQueryClient();
  const list = useQuery<{ sources: UserSource[] }>({
    queryKey: ["/api/composer/user-sources"],
    queryFn: () => fetch(`${BASE}/api/composer/user-sources`).then((r) => r.json()),
  });
  const create = useMutation({
    mutationFn: (body: Partial<UserSource>) => fetch(`${BASE}/api/composer/user-sources`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/composer/user-sources"] }),
  });
  const remove = useMutation({
    mutationFn: (id: number) => fetch(`${BASE}/api/composer/user-sources/${id}`, { method: "DELETE" }).then((r) => r.json()),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["/api/composer/user-sources"] }),
  });
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  return (
    <div className="space-y-3">
      <div className="border border-dashed border-border rounded-lg p-3">
        <div className="text-xs font-semibold mb-2">Add custom source</div>
        <input className="input mb-2" placeholder="Label (e.g. Saudi Gazette)" value={label} onChange={(e) => setLabel(e.target.value)} />
        <input className="input mb-2" placeholder="URL or RSS feed" value={url} onChange={(e) => setUrl(e.target.value)} />
        <Button size="sm" disabled={!label || !url} onClick={() => { create.mutate({ label, url, language: "both" }); setLabel(""); setUrl(""); }} className="w-full gap-1">
          <Plus className="w-3 h-3" /> Add
        </Button>
      </div>
      {(list.data?.sources || []).map((s) => (
        <div key={s.id} className="border border-border rounded-lg p-3 flex items-center gap-2 bg-card">
          <div className="flex-1">
            <div className="text-sm font-semibold">{s.label}</div>
            <div className="text-[10px] text-muted-foreground truncate">{s.url}</div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => remove.mutate(s.id)} className="text-rose-500"><Trash2 className="w-3 h-3" /></Button>
        </div>
      ))}
      {(list.data?.sources || []).length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">No custom sources yet.</div>
      )}
    </div>
  );
}

// ── tiny helpers ──────────────────────────────────────────────────────────────
function NewItem({ label, onCreate }: { label: string; onCreate: () => void }) {
  return (
    <Button variant="outline" size="sm" onClick={onCreate} className="w-full gap-1 mb-3">
      <Plus className="w-3.5 h-3.5" /> {label}
    </Button>
  );
}
function FormRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground mb-1">{label}</div>
      {children}
    </div>
  );
}
