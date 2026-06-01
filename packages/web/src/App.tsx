import { useBoardSocket } from "./hooks/useBoardSocket.js";
import { Board } from "./components/Board.js";
import styles from "./App.module.css";

export default function App() {
  const { board, error, setBoard } = useBoardSocket();

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.logo}>Kanban</span>
        {board && (
          <span className={styles.projectName}>— {board.projectName}</span>
        )}
      </header>
      {error && <div className={styles.error}>{error}</div>}
      {board ? (
        <Board board={board} onBoardChange={setBoard} />
      ) : (
        <div className={styles.loading}>Connecting…</div>
      )}
    </div>
  );
}
