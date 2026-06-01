import { useEffect, useRef, useState } from "react";
import type { BoardState, WSMessage } from "@kanban/shared";

const WS_URL = `ws://${window.location.host}`;

export function useBoardSocket() {
  const [board, setBoard] = useState<BoardState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let alive = true;
    let reconnectTimer: ReturnType<typeof setTimeout>;

    function connect() {
      const ws = new WebSocket(WS_URL);
      wsRef.current = ws;

      ws.onmessage = (evt) => {
        const msg = JSON.parse(evt.data as string) as WSMessage;
        if (msg.type === "board:update") setBoard(msg.state);
        if (msg.type === "error") setError(msg.message);
      };

      ws.onclose = () => {
        if (alive) reconnectTimer = setTimeout(connect, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();
    return () => {
      alive = false;
      clearTimeout(reconnectTimer);
      wsRef.current?.close();
    };
  }, []);

  return { board, error, setBoard };
}
