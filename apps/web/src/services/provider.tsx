"use client";
import { useSearchParams } from "next/navigation";
/**
 * The screens' data context: one API-backed store per tab. It signs in (the
 * demo as its viewer; real deployments through Supabase), loads what every
 * screen shares, and keeps it live. `storageMessage` carries the last thing
 * that went wrong, for the shell's banner.
 */
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { createApiServices, type ApiServices, type ClientState } from "@/client/store";
const Context = createContext<{
  services: ApiServices;
  state: ClientState;
  ready: boolean;
  storageMessage: string | null;
} | null>(null);
export function DemoProvider({ children }: { children: ReactNode }) {
  const [services] = useState(createApiServices);
  const state = useSyncExternalStore(
    services.subscribe,
    services.getSnapshot,
    services.getSnapshot,
  );
  const [boot, setBoot] = useState({ ready: false, message: null as string | null });
  useEffect(() => {
    let live = true;
    services
      .start()
      .then(() => live && setBoot({ ready: true, message: null }))
      .catch((error: unknown) =>
        live &&
        setBoot({
          ready: true,
          message: error instanceof Error ? error.message : "imo couldn't load. Refresh to try again.",
        }),
      );
    return () => {
      live = false;
      services.stop();
    };
  }, [services]);
  return (
    <Context.Provider
      value={{
        services,
        state,
        ready: boot.ready,
        storageMessage: services.problem() ?? boot.message,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useDemo() {
  const value = useContext(Context);
  if (!value) throw new Error("DemoProvider is required.");
  return value;
}
/** A page-state preview asked for in the URL (?state=loading | empty |
    error): part of the demo deployment's workbench, ignored elsewhere. */
export function usePreviewState() {
  const { services } = useDemo();
  const params = useSearchParams();
  return services.config()?.profile === "demo" ? params.get("state") : null;
}
/** Draw the page's skeleton: until the first data arrives, or while the
    demo previews its loading state. */
export function useLoadingView() {
  const { ready } = useDemo();
  const preview = usePreviewState();
  return !ready || preview === "loading";
}
/** Your paper season, as the server keeps it: the balance a season starts
    with, how often a new one may start, and when yours may. */
export function useSeason() {
  const { state, services } = useDemo();
  const paper = services.config()?.paper;
  return {
    startCents: state.season?.startingBalanceCents ?? paper?.startingBalanceCents ?? 0,
    resetDays: paper?.resetCooldownDays ?? 30,
    nextResetAt: state.season?.nextResetAt ?? null,
  };
}
/** Keep a market, room, post or trader live while a screen shows it. */
export function useLive(kind: "market" | "room" | "post" | "trader", id: string | undefined) {
  const { services } = useDemo();
  useEffect(() => (id ? services.watch(kind, id) : undefined), [services, kind, id]);
}
