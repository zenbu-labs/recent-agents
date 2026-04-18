import path from "node:path";
import { fileURLToPath } from "node:url";
import { Effect } from "effect";
import { Service, runtime } from "@testbu/init/src/main/runtime";
import { DbService } from "@testbu/init/src/main/services/db";
import { registerContentScript } from "@testbu/init/src/main/services/advice-config";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rendererDir = path.resolve(__dirname, "..", "renderer");

const MAX_RECENT = 100;

type Session = { id: string; agentId: string; lastViewedAt: number | null };
type Pane = { id: string; tabIds?: string[]; activeTabId?: string };
type WindowState = {
  id: string;
  sessions?: Session[];
  panes?: Pane[];
};

export class RecentAgentsService extends Service {
  static key = "recent-agents";
  static deps = { db: DbService, baseWindow: "base-window" };
  declare ctx: { db: DbService; baseWindow: any };

  async switchToSession(sessionId: string): Promise<{ ok: boolean }> {
    const client = this.ctx.db.client;
    const kernel = (client.readRoot() as any).plugin.kernel;
    const windowStates: WindowState[] = kernel.windowStates ?? [];

    console.log(
      "[recent-agents] switchToSession called with sessionId=",
      sessionId,
    );

    let targetWindowId: string | null = null;
    let targetPaneId: string | null = null;

    for (const ws of windowStates) {
      const hasSession = (ws.sessions ?? []).some((s) => s.id === sessionId);
      if (!hasSession) continue;
      const pane = (ws.panes ?? []).find((p) =>
        (p.tabIds ?? []).includes(sessionId),
      );
      if (!pane) continue;
      targetWindowId = ws.id;
      targetPaneId = pane.id;
      break;
    }

    console.log("[recent-agents] resolved target:", {
      targetWindowId,
      targetPaneId,
    });

    if (!targetWindowId || !targetPaneId) {
      console.warn("[recent-agents] no pane for session; not switching");
      return { ok: false };
    }

    const now = Date.now();
    const states = (kernel.windowStates ?? []) as WindowState[];
    const nextStates = states.map((ws) => {
      if (ws.id !== targetWindowId) return ws;
      const oldActive = (ws.panes ?? []).find(
        (p) => p.id === targetPaneId,
      )?.activeTabId;
      return {
        ...ws,
        focusedPaneId: targetPaneId,
        panes: (ws.panes ?? []).map((p) =>
          p.id === targetPaneId ? { ...p, activeTabId: sessionId } : p,
        ),
        sessions: (ws.sessions ?? []).map((s) => {
          if (s.id === oldActive) return { ...s, lastViewedAt: now };
          if (s.id === sessionId) return { ...s, lastViewedAt: null };
          return s;
        }),
      };
    });
    await Effect.runPromise(
      (client as any).plugin.kernel.windowStates.set(nextStates),
    );

    const win = this.ctx.baseWindow.windows.get(targetWindowId);
    if (win && !win.isDestroyed()) win.focus();

    console.log("[recent-agents] switchToSession done");
    return { ok: true };
  }

  evaluate() {
    this.effect("register-chat-script", () => {
      const scriptPath = path.resolve(rendererDir, "ChatContentScript.tsx");
      console.log("[recent-agents] registering content script:", scriptPath);
      return registerContentScript("chat", scriptPath);
    });

    this.effect("track-recent", () => {
      const client = this.ctx.db.client;

      let prevActive = new Map<string, string | undefined>();
      let initialized = false;

      const onWindowStatesChanged = () => {
        const root = client.readRoot() as any;
        const kernel = root.plugin.kernel;
        const windowStates: WindowState[] = kernel.windowStates ?? [];

        const currentActive = new Map<string, string | undefined>();
        const liveSessionIds = new Set<string>();
        for (const ws of windowStates) {
          for (const s of ws.sessions ?? []) {
            liveSessionIds.add(s.id);
          }
          for (const p of ws.panes ?? []) {
            currentActive.set(p.id, p.activeTabId);
          }
        }

        if (!initialized) {
          prevActive = currentActive;
          initialized = true;
          const existing: string[] =
            root.plugin["recent-agents"]?.recentSessionIds ?? [];
          const cleaned = existing.filter((id) => liveSessionIds.has(id));
          if (cleaned.length !== existing.length) {
            console.log(
              "[recent-agents] cleanup: removed",
              existing.length - cleaned.length,
              "stale entries",
            );
            Effect.runPromise(
              client.update((r: any) => {
                r.plugin["recent-agents"].recentSessionIds = cleaned;
              }),
            ).catch((err: unknown) => {
              console.error("[recent-agents] cleanup failed:", err);
            });
          }
          return;
        }

        const newlyActivated: string[] = [];
        for (const [paneId, newActive] of currentActive) {
          const oldActive = prevActive.get(paneId);
          if (oldActive === newActive) continue;
          if (!newActive) continue;
          if (!liveSessionIds.has(newActive)) continue;
          newlyActivated.push(newActive);
        }
        prevActive = currentActive;

        if (newlyActivated.length === 0) return;

        console.log("[recent-agents] activations:", newlyActivated);

        const existing: string[] =
          root.plugin["recent-agents"]?.recentSessionIds ?? [];
        const seen = new Set<string>();
        const next: string[] = [];
        for (const id of newlyActivated) {
          if (seen.has(id)) continue;
          seen.add(id);
          next.push(id);
        }
        for (const id of existing) {
          if (seen.has(id)) continue;
          if (!liveSessionIds.has(id)) continue;
          seen.add(id);
          next.push(id);
          if (next.length >= MAX_RECENT) break;
        }

        if (
          next.length === existing.length &&
          next.every((v, i) => v === existing[i])
        ) {
          return;
        }

        Effect.runPromise(
          client.update((r: any) => {
            r.plugin["recent-agents"].recentSessionIds = next;
          }),
        ).catch((err: unknown) => {
          console.error("[recent-agents] update failed:", err);
        });
      };

      const unsub = (client as any).plugin.kernel.windowStates.subscribe(
        onWindowStatesChanged,
      );
      onWindowStatesChanged();

      return () => unsub();
    });
  }
}

runtime.register(RecentAgentsService, (import.meta as any).hot);
