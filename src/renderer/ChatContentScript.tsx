// Cmd+P is wired via a content script injected into the chat view only.
// This means Cmd+P only opens the palette when focus is inside a chat iframe —
// if the user is on an orchestrator/sidebar/other view, nothing happens.
// TODO: migrate to the global shortcut API once it exists.

import { createRoot } from "react-dom/client";
import confetti from "canvas-confetti";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  useWsConnection,
  RpcProvider,
  EventsProvider,
  KyjuClientProvider,
  useRpc,
} from "@testbu/init/src/renderer/lib/ws-connection";
import {
  KyjuProvider,
  useDb,
} from "@testbu/init/src/renderer/lib/kyju-react";
import type { WsConnectionState } from "@testbu/init/src/renderer/lib/ws-connection";

type Agent = {
  id: string;
  name: string;
  title?: { kind: string; value?: string };
};

type Session = { id: string; agentId: string; lastViewedAt: number | null };

type WindowState = {
  id: string;
  sessions?: Session[];
  panes?: { id: string; tabIds?: string[]; activeTabId?: string }[];
};

function sessionLabel(
  session: Session | undefined,
  agent: Agent | undefined,
): string {
  if (!session) return "(unknown session)";
  const t = agent?.title as any;
  if (t?.kind === "set" && typeof t.value === "string" && t.value) return t.value;
  if (t?.kind === "generating") return "(generating title…)";
  return agent?.name || "New Chat";
}

function CommandPalette({ onClose }: { onClose: () => void }) {
  const rpc = useRpc();
  const recentIds = (useDb(
    (root: any) => root.plugin?.["recent-agents"]?.recentSessionIds,
  ) ?? []) as string[];
  const agents = (useDb((root: any) => root.plugin?.kernel?.agents) ??
    []) as Agent[];
  const windowStates = (useDb(
    (root: any) => root.plugin?.kernel?.windowStates,
  ) ?? []) as WindowState[];

  const sessionById = useMemo(() => {
    const m = new Map<string, Session>();
    for (const ws of windowStates) {
      for (const s of ws.sessions ?? []) m.set(s.id, s);
    }
    return m;
  }, [windowStates]);

  const agentById = useMemo(() => {
    const m = new Map<string, Agent>();
    for (const a of agents) m.set(a.id, a);
    return m;
  }, [agents]);

  const orderedIds = useMemo(() => {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const id of recentIds) {
      if (seen.has(id)) continue;
      if (!sessionById.has(id)) continue;
      seen.add(id);
      result.push(id);
    }
    // Swap index 0 and 1 so that Enter toggles to the previously active session
    // (canonical VSCode/Obsidian Cmd+P behavior).
    if (result.length >= 2) {
      [result[0], result[1]] = [result[1], result[0]];
    }
    return result;
  }, [recentIds, sessionById]);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return orderedIds;
    return orderedIds.filter((id) => {
      const s = sessionById.get(id);
      const a = s ? agentById.get(s.agentId) : undefined;
      const label = sessionLabel(s, a).toLowerCase();
      return label.includes(q) || id.toLowerCase().includes(q);
    });
  }, [orderedIds, query, sessionById, agentById]);

  useEffect(() => {
    if (selected >= filtered.length) setSelected(0);
  }, [filtered, selected]);

  const choose = useCallback(
    async (sessionId: string) => {
      if (!sessionId) return;
      onClose();
      try {
        const r = await (rpc as any)["recent-agents"].switchToSession(
          sessionId,
        );
        console.log("[recent-agents] switchToSession result:", r);
      } catch (err) {
        console.error("[recent-agents] switchToSession failed:", err);
      }
    },
    [rpc, onClose],
  );

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    const plainCtrl =
      e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey;
    if (
      e.key === "ArrowDown" ||
      (plainCtrl && (e.key === "n" || e.key === "N"))
    ) {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, filtered.length - 1));
      return;
    }
    if (
      e.key === "ArrowUp" ||
      (plainCtrl && (e.key === "p" || e.key === "P"))
    ) {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      const id = filtered[selected];
      if (id) choose(id);
    }
  };

  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100000,
        background: "transparent",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
        pointerEvents: "auto",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: "90vw",
          borderRadius: 6,
          background: "#FFFFFF",
          border: "1px solid #BDBDBD",
          boxShadow: "0 12px 40px rgba(0,0,0,0.18)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            borderBottom: "1px solid #E5E5E5",
          }}
        >
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Switch chat..."
            spellCheck={false}
            style={{
              flex: 1,
              padding: "10px 12px",
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#1f2937",
              fontSize: 13,
              fontFamily: "inherit",
            }}
          />
          <button
            type="button"
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
              confetti({
                particleCount: 120,
                spread: 80,
                origin: { y: 0.3 },
              });
            }}
            title="Celebrate"
            style={{
              marginRight: 6,
              padding: "4px 8px",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontSize: 16,
              lineHeight: 1,
            }}
          >
            🎉
          </button>
        </div>
        <div
          style={{
            maxHeight: 320,
            overflowY: "auto",
            padding: "3px 0",
          }}
        >
          {filtered.length === 0 && (
            <div
              style={{
                padding: "10px 12px",
                color: "#9CA3AF",
                fontSize: 12,
              }}
            >
              No recent chats yet — switch tabs to build up the list.
            </div>
          )}
          {filtered.map((id, i) => {
            const s = sessionById.get(id);
            const a = s ? agentById.get(s.agentId) : undefined;
            const isSelected = i === selected;
            return (
              <div
                key={id}
                onMouseDown={(e) => {
                  e.preventDefault();
                  choose(id);
                }}
                onMouseMove={() => setSelected(i)}
                style={{
                  padding: "6px 12px",
                  cursor: "pointer",
                  background: isSelected ? "#F3F4F6" : "transparent",
                  color: isSelected ? "#111827" : "#374151",
                  fontSize: 13,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {sessionLabel(s, a)}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function PaletteRoot() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    console.log("[recent-agents] PaletteRoot mounted, attaching keydown");
    const handler = (e: KeyboardEvent) => {
      const isCmdP =
        e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey && e.key === "p";
      if (isCmdP) {
        console.log("[recent-agents] cmd+p detected, toggling palette");
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        setOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", handler, true);
    document.addEventListener("keydown", handler, true);
    return () => {
      window.removeEventListener("keydown", handler, true);
      document.removeEventListener("keydown", handler, true);
    };
  }, []);

  if (!open) return null;
  return <CommandPalette onClose={() => setOpen(false)} />;
}

function ConnectedRoot({
  connection,
}: {
  connection: Extract<WsConnectionState, { status: "connected" }>;
}) {
  return (
    <RpcProvider value={connection.rpc}>
      <EventsProvider value={connection.events}>
        <KyjuClientProvider value={connection.kyjuClient}>
          <KyjuProvider
            client={connection.kyjuClient}
            replica={connection.replica}
          >
            <PaletteRoot />
          </KyjuProvider>
        </KyjuClientProvider>
      </EventsProvider>
    </RpcProvider>
  );
}

function AppRoot() {
  const connection = useWsConnection();
  if (connection.status !== "connected") return null;
  return <ConnectedRoot connection={connection} />;
}

console.log("[recent-agents] content script loaded");

function mount() {
  const el = document.createElement("div");
  el.id = "zenbu-recent-agents-palette";
  document.body.appendChild(el);
  createRoot(el).render(<AppRoot />);
}

if (document.body) {
  mount();
} else {
  window.addEventListener("DOMContentLoaded", mount);
}
