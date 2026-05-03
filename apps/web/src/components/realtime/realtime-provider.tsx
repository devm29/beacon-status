"use client";

import { RealtimeEventSchema, type RealtimeEvent } from "@beacon/shared";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import { getRealtimeToken } from "@/app/(dashboard)/actions";

type Listener = (event: RealtimeEvent) => void;

interface RealtimeContextValue {
  connected: boolean;
  subscribe: (listener: Listener) => () => void;
}

const RealtimeContext = createContext<RealtimeContextValue | null>(null);

export function useRealtime(): RealtimeContextValue {
  const value = useContext(RealtimeContext);
  if (!value) throw new Error("useRealtime must be used inside <RealtimeProvider>");
  return value;
}

export function useRealtimeEvent(listener: Listener): void {
  const { subscribe } = useRealtime();
  const latest = useRef(listener);
  useEffect(() => {
    latest.current = listener;
  });
  useEffect(() => subscribe((event) => latest.current(event)), [subscribe]);
}

/**
 * One Socket.IO connection per dashboard tab. The token is minted by a server action on every
 * (re)connect, so the browser never holds the organization's API key.
 */
export function RealtimeProvider({ apiUrl, children }: { apiUrl: string; children: ReactNode }) {
  const listeners = useRef(new Set<Listener>());
  const [connected, setConnected] = useState(false);
  const [value] = useState<Omit<RealtimeContextValue, "connected">>(() => ({
    subscribe: (listener) => {
      listeners.current.add(listener);
      return () => listeners.current.delete(listener);
    },
  }));

  useEffect(() => {
    const socket = io(apiUrl, {
      path: "/realtime",
      transports: ["websocket"],
      auth: (cb) => {
        void getRealtimeToken().then((token) => cb({ token }));
      },
    });
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    socket.on("event", (raw: unknown) => {
      const parsed = RealtimeEventSchema.safeParse(raw);
      if (!parsed.success) return;
      for (const listener of listeners.current) listener(parsed.data);
    });
    return () => {
      socket.disconnect();
    };
  }, [apiUrl]);

  return (
    <RealtimeContext.Provider value={{ connected, subscribe: value.subscribe }}>
      {children}
    </RealtimeContext.Provider>
  );
}
