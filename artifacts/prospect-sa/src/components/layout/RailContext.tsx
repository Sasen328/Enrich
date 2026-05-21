// §4 — Rail state: Closed (0px) → Open (232px) → IconsOnly (28px).
import { createContext, useContext, useState, useCallback, ReactNode } from "react";

export type RailState = "closed" | "open" | "icons";

interface RailCtx {
  state: RailState;
  panelId: string | null;
  open: (panelId: string) => void;
  collapse: () => void;
  close: () => void;
  toggle: () => void;
}

const Ctx = createContext<RailCtx | null>(null);

export function RailProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RailState>("closed");
  const [panelId, setPanelId] = useState<string | null>(null);

  const open = useCallback((id: string) => { setPanelId(id); setState("open"); }, []);
  const collapse = useCallback(() => setState("icons"), []);
  const close = useCallback(() => { setState("closed"); setPanelId(null); }, []);
  const toggle = useCallback(() => {
    setState((s) => (s === "open" ? "icons" : s === "icons" ? "closed" : "open"));
  }, []);

  return <Ctx.Provider value={{ state, panelId, open, collapse, close, toggle }}>{children}</Ctx.Provider>;
}

export function useRail() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useRail must be used inside RailProvider");
  return c;
}

export const RAIL_WIDTH = { closed: "0px", icons: "28px", open: "232px" } as const;
