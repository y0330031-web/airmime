"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import { Caveat } from "next/font/google";
import { db } from "@/lib/firebase";
import {
  ref,
  push,
  onChildAdded,
  onValue,
  set,
  get,
  remove,
  off,
  onDisconnect,
} from "firebase/database";

const caveat = Caveat({ subsets: ["latin"], weight: ["700"] });

const COLORS = [
  "#F4F1EA",
  "#FF6B6B",
  "#FFA94D",
  "#FFD43B",
  "#69DB7C",
  "#38D9A9",
  "#4DABF7",
  "#9775FA",
  "#F783AC",
];

// 참가자 아바타로 쓸 이모지 팔레트
const PLAYER_EMOJIS = ["🦊", "🐰", "🐻", "🐹", "🦁", "🐨", "🐷", "🐵"];
// 아바타 원 배경색 팔레트 (그리기용 COLORS와는 별개, 살짝 톤 다운된 색)
const AVATAR_BG_COLORS = [
  "#FF6B6B",
  "#FFA94D",
  "#FFD43B",
  "#69DB7C",
  "#38D9A9",
  "#4DABF7",
  "#9775FA",
  "#F783AC",
];

function emojiForClientId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  }
  return PLAYER_EMOJIS[hash % PLAYER_EMOJIS.length];
}

function avatarColorForClientId(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = (hash * 17 + id.charCodeAt(i)) >>> 0;
  }
  return AVATAR_BG_COLORS[hash % AVATAR_BG_COLORS.length];
}

const WORD_LIST = [
  "사과",
  "고양이",
  "강아지",
  "자동차",
  "우산",
  "피자",
  "케이크",
  "비행기",
  "축구공",
  "안경",
  "시계",
  "기타",
  "나무",
  "구름",
  "무지개",
  "선물상자",
  "로봇",
  "왕관",
  "물고기",
  "집",
];

function pickRandomWord(): string {
  return WORD_LIST[Math.floor(Math.random() * WORD_LIST.length)];
}

interface Point {
  x: number;
  y: number;
}

interface StrokeSegment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: string;
  eraser: boolean;
}

interface PlayerInfo {
  id: string;
  emoji: string;
  joinedAt: number;
}

function generateRoomCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export default function Home() {
  const [view, setView] = useState<"landing" | "room">("landing");
  const [roomCode, setRoomCode] = useState<string>("");
  const [joinInput, setJoinInput] = useState("");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [createPublic, setCreatePublic] = useState(false);
  const isPublicRoomRef = useRef(false);
  const MAX_PLAYERS_OPTIONS = [2, 3, 4, 6, 8] as const;
  const [maxPlayersChoice, setMaxPlayersChoice] = useState<number>(2);

  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const practiceCanvasRef = useRef<HTMLCanvasElement>(null);

  const lastPointRef = useRef<Point | null>(null);
  const isPointerDownRef = useRef(false);

  const [color, setColor] = useState(COLORS[0]);
  const colorRef = useRef(COLORS[0]);
  const [isEraser, setIsEraser] = useState(false);
  const isEraserRef = useRef(false);
  const [showHint, setShowHint] = useState(true);

  // 사용자 신고 기능
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportText, setReportText] = useState("");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  const [reportDone, setReportDone] = useState(false);

  // 연습 모드: 방에 들어가면 기본은 연습(나만 보임), '게임 시작' 누르면 공유 캔버스로 전환
  const [practiceMode, setPracticeMode] = useState(true);
  const practiceModeRef = useRef(true);
  useEffect(() => {
    practiceModeRef.current = practiceMode;
  }, [practiceMode]);

  // 이 브라우저 세션을 구분하는 익명 ID (누가 그림꾼인지 정할 때 사용)
  const clientIdRef = useRef<string>(
    Math.random().toString(36).slice(2) + Date.now().toString(36)
  );
  const playersRef = useRef<Record<string, any>>({});
  const playerInfoRef = useRef<Record<string, { joinedAt: number; emoji: string }>>({});
  const [playerCount, setPlayerCount] = useState(0);
  const [roomMaxPlayers, setRoomMaxPlayers] = useState<number>(2);
  const maxPlayersRef = useRef<number>(2);
  const [playersList, setPlayersList] = useState<PlayerInfo[]>([]);
  const [hostId, setHostId] = useState<string | null>(null);
  const isHost = hostId === clientIdRef.current;

  // 게임 라운드 상태: 누가 그림꾼인지, 제시어가 뭔지
  interface GameData {
    drawerId: string;
    prompt: string;
  }
  const [gameData, setGameData] = useState<GameData | null>(null);
  const gameDataRef = useRef<GameData | null>(null);
  useEffect(() => {
    gameDataRef.current = gameData;
  }, [gameData]);

  const isDrawer = !!gameData && gameData.drawerId === clientIdRef.current;

  const isDrawerRef = useRef(false);
  useEffect(() => {
    isDrawerRef.current = isDrawer;
  }, [isDrawer]);

  // 게임 시작 전 제시어 설정 UI 상태
  const [showPromptSetup, setShowPromptSetup] = useState(false);
  const [customPromptInput, setCustomPromptInput] = useState("");
  const [startingGame, setStartingGame] = useState(false);

  // 라운드 타이머 / 점수 / 채팅(정답 맞히기)
  const ROUND_SECONDS = 60;
  const [roundStartedAt, setRoundStartedAt] = useState<number | null>(null);
  const [timeLeft, setTimeLeft] = useState(ROUND_SECONDS);
  const [scores, setScores] = useState<Record<string, number>>({});
  const [roundStatus, setRoundStatus] = useState<{
    winnerId: string | null;
    endedAt: number;
  } | null>(null);
  const roundStatusRef = useRef<typeof roundStatus>(null);
  useEffect(() => {
    roundStatusRef.current = roundStatus;
  }, [roundStatus]);
  const roundAdvanceTriggeredRef = useRef(false);

  interface ChatMessage {
    id: string;
    senderId: string;
    text: string;
    correct: boolean;
    ts: number;
  }
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const chatListRef = useRef<HTMLDivElement>(null);

  const roomCodeRef = useRef<string>("");
  const clearSignalSeenRef = useRef<number | null>(null);

  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    isEraserRef.current = isEraser;
  }, [isEraser]);
  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);

  const handleCreateRoom = async () => {
    setIsCreating(true);
    setRoomError(null);
    try {
      const code = generateRoomCode();
      await set(ref(db, `rooms/${code}/meta`), {
        createdAt: Date.now(),
        hostId: clientIdRef.current,
        isPublic: createPublic,
        maxPlayers: maxPlayersChoice,
      });
      await set(ref(db, `rooms/${code}/gameStarted`), false);
      if (createPublic) {
        await set(ref(db, `publicRooms/${code}`), {
          createdAt: Date.now(),
          playerCount: 1,
          maxPlayers: maxPlayersChoice,
        }).catch((err) =>
          console.error("public room index write failed:", err)
        );
      }
      setRoomCode(code);
      setView("room");
    } catch (err) {
      console.error(err);
      setRoomError("방을 만들지 못했어요. 다시 시도해주세요.");
    } finally {
      setIsCreating(false);
    }
  };

  // 랜덤 매치: 공개방 목록(publicRooms) 중 자리가 남은 방에 바로 들어가고,
  // 없으면 내가 새 공개방을 만들어서 다른 사람이 매치되길 기다림
  const handleRandomMatch = async () => {
    setIsCreating(true);
    setRoomError(null);
    try {
      const snap = await get(ref(db, "publicRooms"));
      const val = snap.val() || {};
      const candidates = Object.entries(val as Record<string, any>)
        .filter(
          ([, info]) => (info?.playerCount || 0) < (info?.maxPlayers || 2)
        )
        .map(([code]) => code);

      if (candidates.length > 0) {
        const code = candidates[Math.floor(Math.random() * candidates.length)];
        setRoomCode(code);
        setView("room");
      } else {
        const code = generateRoomCode();
        await set(ref(db, `rooms/${code}/meta`), {
          createdAt: Date.now(),
          hostId: clientIdRef.current,
          isPublic: true,
          maxPlayers: maxPlayersChoice,
        });
        await set(ref(db, `rooms/${code}/gameStarted`), false);
        await set(ref(db, `publicRooms/${code}`), {
          createdAt: Date.now(),
          playerCount: 1,
          maxPlayers: maxPlayersChoice,
        });
        setRoomCode(code);
        setView("room");
      }
    } catch (err) {
      console.error(err);
      setRoomError("랜덤 매치에 실패했어요. 다시 시도해주세요.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleJoinRoom = async () => {
    if (joinInput.length !== 4) {
      setRoomError("4자리 코드를 입력해주세요.");
      return;
    }
    setIsCreating(true);
    setRoomError(null);
    try {
      const snap = await get(ref(db, `rooms/${joinInput}/meta`));
      if (!snap.exists()) {
        setRoomError("해당 코드의 방을 찾을 수 없어요.");
        setIsCreating(false);
        return;
      }
      const metaVal = snap.val() || {};
      const roomMax = metaVal.maxPlayers || 2;
      const playersSnap = await get(ref(db, `rooms/${joinInput}/players`));
      const currentCount = playersSnap.exists()
        ? Object.keys(playersSnap.val() || {}).length
        : 0;
      if (currentCount >= roomMax) {
        setRoomError(`방이 꽉 찼어요 (최대 ${roomMax}명).`);
        setIsCreating(false);
        return;
      }
      setRoomCode(joinInput);
      setView("room");
    } catch (err) {
      console.error(err);
      setRoomError("방에 참가하지 못했어요. 다시 시도해주세요.");
    } finally {
      setIsCreating(false);
    }
  };

  const handleLeaveRoom = () => {
    // 나 혼자 대기 중이던 공개방이었다면 목록에서도 바로 지움 (best-effort)
    if (isPublicRoomRef.current && playerCount <= 1 && roomCodeRef.current) {
      remove(ref(db, `publicRooms/${roomCodeRef.current}`)).catch(() => {});
    }
    setView("landing");
    setRoomCode("");
    setJoinInput("");
    lastPointRef.current = null;
    clearSignalSeenRef.current = null;
    setPracticeMode(true);
    setGameData(null);
    setHostId(null);
    setPlayersList([]);
    setShowPromptSetup(false);
    setCustomPromptInput("");
    const canvas = drawCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    const pCanvas = practiceCanvasRef.current;
    const pCtx = pCanvas?.getContext("2d");
    if (pCanvas && pCtx) pCtx.clearRect(0, 0, pCanvas.width, pCanvas.height);
  };

  // 참가자 목록 중 무작위로 한 명을 그림꾼으로 뽑음 (아무도 없으면 나 자신)
  const pickRandomDrawer = (): string => {
    const ids = Object.keys(playersRef.current);
    if (ids.length === 0) return clientIdRef.current;
    return ids[Math.floor(Math.random() * ids.length)];
  };

  const startRound = async (prompt: string) => {
    const code = roomCodeRef.current;
    if (!code) return;
    setStartingGame(true);
    try {
      const drawerId = pickRandomDrawer();
      const startedAt = Date.now();
      await set(ref(db, `rooms/${code}/game`), { drawerId, prompt });
      await set(ref(db, `rooms/${code}/gameStarted`), true);
      await set(ref(db, `rooms/${code}/roundStartedAt`), startedAt);
      await set(ref(db, `rooms/${code}/roundStatus`), null);
      roundAdvanceTriggeredRef.current = false;
      setShowPromptSetup(false);
      setCustomPromptInput("");
      setShowHint(false);
      lastPointRef.current = null;
    } catch (err) {
      console.error("start round sync failed:", err);
    } finally {
      setStartingGame(false);
    }
  };

  const handleOpenPromptSetup = () => {
    setShowPromptSetup(true);
  };

  const handleAutoPrompt = () => {
    startRound(pickRandomWord());
  };

  const handleSubmitCustomPrompt = () => {
    const word = customPromptInput.trim();
    if (!word) return;
    startRound(word);
  };

  const handleBackToPractice = async () => {
    lastPointRef.current = null;
    const code = roomCodeRef.current;
    if (!code) return;
    try {
      await set(ref(db, `rooms/${code}/gameStarted`), false);
      await set(ref(db, `rooms/${code}/game`), null);
      await set(ref(db, `rooms/${code}/roundStatus`), null);
    } catch (err) {
      console.error("back to practice sync failed:", err);
    }
  };

  const handleClearPractice = () => {
    const canvas = practiceCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  useEffect(() => {
    if (view !== "room" || !roomCode) return;

    const strokesRef = ref(db, `rooms/${roomCode}/strokes`);
    const clearRef = ref(db, `rooms/${roomCode}/clearSignal`);
    const gameStateRef = ref(db, `rooms/${roomCode}/gameStarted`);
    const gameDataFbRef = ref(db, `rooms/${roomCode}/game`);
    const playersFbRef = ref(db, `rooms/${roomCode}/players`);
    const playerInfoFbRef = ref(db, `rooms/${roomCode}/playerInfo`);
    const metaFbRef = ref(db, `rooms/${roomCode}/meta`);
    const myPlayerRef = ref(
      db,
      `rooms/${roomCode}/players/${clientIdRef.current}`
    );
    const myPlayerInfoRef = ref(
      db,
      `rooms/${roomCode}/playerInfo/${clientIdRef.current}`
    );

    onValue(metaFbRef, (snap) => {
      const val = snap.val();
      setHostId(val?.hostId || null);
      isPublicRoomRef.current = !!val?.isPublic;
      const max = val?.maxPlayers || 2;
      maxPlayersRef.current = max;
      setRoomMaxPlayers(max);
    });

    const drawSegment = (seg: StrokeSegment) => {
      const canvas = drawCanvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx) return;

      ctx.lineCap = "round";
      ctx.lineJoin = "round";

      if (seg.eraser) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = 40;
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = seg.color;
        ctx.lineWidth = 6;
      }

      ctx.beginPath();
      ctx.moveTo(seg.x1 * canvas.width, seg.y1 * canvas.height);
      ctx.lineTo(seg.x2 * canvas.width, seg.y2 * canvas.height);
      ctx.stroke();
    };

    onChildAdded(strokesRef, (snap) => {
      const seg = snap.val() as StrokeSegment;
      if (seg) drawSegment(seg);
    });

    onValue(clearRef, (snap) => {
      const val = snap.val();
      if (val == null) return;
      if (clearSignalSeenRef.current === null) {
        clearSignalSeenRef.current = val;
        return;
      }
      if (val !== clearSignalSeenRef.current) {
        clearSignalSeenRef.current = val;
        const canvas = drawCanvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    });

    // 게임 시작/연습 상태는 두 사람 모두 같은 값을 보도록 Firebase에서 직접 반영
    onValue(gameStateRef, (snap) => {
      const started = !!snap.val();
      setPracticeMode(!started);
      lastPointRef.current = null;
    });

    // 현재 라운드의 그림꾼/제시어
    onValue(gameDataFbRef, (snap) => {
      setGameData(snap.val());
    });

    const roundStartedAtRef = ref(db, `rooms/${roomCode}/roundStartedAt`);
    const roundStatusFbRef = ref(db, `rooms/${roomCode}/roundStatus`);
    const scoresFbRef = ref(db, `rooms/${roomCode}/scores`);
    const chatFbRef = ref(db, `rooms/${roomCode}/chat`);

    onValue(roundStartedAtRef, (snap) => {
      setRoundStartedAt(snap.val() || null);
    });

    onValue(roundStatusFbRef, (snap) => {
      setRoundStatus(snap.val());
    });

    onValue(scoresFbRef, (snap) => {
      setScores(snap.val() || {});
    });

    setChatMessages([]);
    onChildAdded(chatFbRef, (snap) => {
      const val = snap.val();
      if (!val) return;
      setChatMessages((prev) => [
        ...prev,
        { id: snap.key || String(Date.now()), ...val },
      ]);
    });

    // 방 참가자 목록 (그림꾼 무작위 선정 + 참가자 패널 표시에 사용)
    // players: 기존 방식 그대로 boolean 값 (기존 보안 규칙과 호환)
    // playerInfo: 아바타 이모지 / 입장 시각 같은 부가 정보 (별도 경로라 players 규칙에 영향 없음)
    const recomputePlayersList = () => {
      const ids = Object.keys(playersRef.current);
      const list: PlayerInfo[] = ids.map((id) => {
        const info = playerInfoRef.current[id];
        return {
          id,
          emoji: info?.emoji || emojiForClientId(id),
          joinedAt: info?.joinedAt ?? 0,
        };
      });
      list.sort((a, b) => a.joinedAt - b.joinedAt);
      setPlayersList(list);
    };

    onValue(playersFbRef, (snap) => {
      const val = snap.val() || {};
      playersRef.current = val;
      const count = Object.keys(val).length;
      setPlayerCount(count);
      recomputePlayersList();

      // 공개방 목록 동기화: 자리가 차면 랜덤 매치 후보에서 빠지고,
      // 다시 비면(누가 나가면) 후보로 복귀
      if (isPublicRoomRef.current) {
        const publicRoomRef = ref(db, `publicRooms/${roomCode}`);
        if (count >= maxPlayersRef.current) {
          remove(publicRoomRef).catch(() => {});
        } else if (count >= 1) {
          set(publicRoomRef, {
            createdAt: Date.now(),
            playerCount: count,
            maxPlayers: maxPlayersRef.current,
          }).catch(() => {});
        } else {
          remove(publicRoomRef).catch(() => {});
        }
      }
    });

    onValue(playerInfoFbRef, (snap) => {
      playerInfoRef.current = snap.val() || {};
      recomputePlayersList();
    });

    // 내가 이 방에 참가 중임을 등록. 탭을 갑자기 닫아도 자동으로 제거되게 함
    set(myPlayerRef, true).catch((err) =>
      console.error("player register failed (players):", err)
    );
    set(myPlayerInfoRef, {
      joinedAt: Date.now(),
      emoji: emojiForClientId(clientIdRef.current),
    }).catch((err) =>
      console.error("player register failed (playerInfo):", err)
    );
    onDisconnect(myPlayerRef)
      .remove()
      .catch(() => {});
    onDisconnect(myPlayerInfoRef)
      .remove()
      .catch(() => {});
    // 혼자 대기 중이던 방장이 그냥 나가버렸을 때 공개방 목록에서도 사라지게
    // (다른 참가자가 남아있으면 players 리스너가 알아서 곧바로 다시 채워줌)
    onDisconnect(ref(db, `publicRooms/${roomCode}`))
      .remove()
      .catch(() => {});

    return () => {
      off(strokesRef);
      off(clearRef);
      off(gameStateRef);
      off(gameDataFbRef);
      off(playersFbRef);
      off(playerInfoFbRef);
      off(metaFbRef);
      off(roundStartedAtRef);
      off(roundStatusFbRef);
      off(scoresFbRef);
      off(chatFbRef);
      remove(myPlayerRef).catch(() => {});
      remove(myPlayerInfoRef).catch(() => {});
    };
  }, [view, roomCode]);

  const sendSegment = useCallback((seg: StrokeSegment) => {
    const code = roomCodeRef.current;
    if (!code) return;
    push(ref(db, `rooms/${code}/strokes`), seg).catch((err) =>
      console.error("stroke sync failed:", err)
    );
  }, []);

  // 라운드 타이머 계산 (매 초)
  useEffect(() => {
    if (practiceMode || !roundStartedAt) {
      setTimeLeft(ROUND_SECONDS);
      return;
    }
    const tick = () => {
      const elapsed = Math.floor((Date.now() - roundStartedAt) / 1000);
      setTimeLeft(Math.max(0, ROUND_SECONDS - elapsed));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [practiceMode, roundStartedAt]);

  // 시간 초과 시, 그림꾼 쪽에서만 다음 라운드로 자동 전환 (중복 방지)
  useEffect(() => {
    if (practiceMode) return;
    if (timeLeft > 0) return;
    if (!isDrawer) return;
    if (roundStatus) return; // 이미 누군가 맞혀서 종료된 경우
    if (roundAdvanceTriggeredRef.current) return;
    roundAdvanceTriggeredRef.current = true;

    const code = roomCodeRef.current;
    if (!code) return;
    set(ref(db, `rooms/${code}/roundStatus`), {
      winnerId: null,
      endedAt: Date.now(),
    }).catch(() => {});

    setTimeout(() => {
      startRound(pickRandomWord());
    }, 3000);
  }, [timeLeft, practiceMode, isDrawer, roundStatus]);

  // 채팅 메시지 리스트 자동 스크롤
  useEffect(() => {
    const el = chatListRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chatMessages]);

  const handleSendChat = async () => {
    const text = chatInput.trim();
    if (!text) return;
    const code = roomCodeRef.current;
    if (!code) return;

    const prompt = gameDataRef.current?.prompt;
    const isCorrectGuess =
      !practiceModeRef.current &&
      !isDrawerRef.current &&
      !!prompt &&
      text === prompt &&
      !roundStatusRef.current;

    try {
      await push(ref(db, `rooms/${code}/chat`), {
        senderId: clientIdRef.current,
        text,
        correct: isCorrectGuess,
        ts: Date.now(),
      });
      setChatInput("");

      if (isCorrectGuess) {
        const myScoreRef = ref(
          db,
          `rooms/${code}/scores/${clientIdRef.current}`
        );
        const snap = await get(myScoreRef);
        const cur = snap.val() || 0;
        await set(myScoreRef, cur + 1);

        await set(ref(db, `rooms/${code}/roundStatus`), {
          winnerId: clientIdRef.current,
          endedAt: Date.now(),
        });

        setTimeout(() => {
          startRound(pickRandomWord());
        }, 3000);
      }
    } catch (err) {
      console.error("chat send failed:", err);
    }
  };

  const handleClearAll = async () => {
    const code = roomCodeRef.current;
    if (!code) return;
    const canvas = drawCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
    try {
      await remove(ref(db, `rooms/${code}/strokes`));
      await set(ref(db, `rooms/${code}/clearSignal`), Date.now());
    } catch (err) {
      console.error("clear sync failed:", err);
    }
  };

  const handleSubmitReport = async () => {
    const code = roomCodeRef.current;
    if (!code || !reportText.trim()) return;
    setReportSubmitting(true);
    try {
      await push(ref(db, `rooms/${code}/reports`), {
        reason: reportText.trim(),
        reportedAt: Date.now(),
      });
      setReportText("");
      setShowReportForm(false);
      setReportDone(true);
      setTimeout(() => setReportDone(false), 3000);
    } catch (err) {
      console.error("report submit failed:", err);
    } finally {
      setReportSubmitting(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (view !== "room") return;
      const target = e.target as HTMLElement;
      if (target && ["INPUT", "TEXTAREA"].includes(target.tagName)) return;

      if (e.key >= "1" && e.key <= "9") {
        const idx = parseInt(e.key, 10) - 1;
        setColor(COLORS[idx]);
        setIsEraser(false);
        setShowHint(false);
      } else if (e.key === "0") {
        setIsEraser(true);
        setShowHint(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [view]);

  // 캔버스 좌표 변환: 화면에 표시된 크기(rect) 기준 위치를 캔버스 내부 해상도로 변환
  const getCanvasPoint = (
    canvas: HTMLCanvasElement,
    clientX: number,
    clientY: number
  ): Point => {
    const rect = canvas.getBoundingClientRect();
    const x = ((clientX - rect.left) / rect.width) * canvas.width;
    const y = ((clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  };

  // 손가락/마우스로 화면을 누른 상태에서 움직일 때 실제로 선을 그리는 함수
  const drawToPoint = useCallback(
    (canvas: HTMLCanvasElement, point: Point) => {
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      if (isEraserRef.current) {
        ctx.globalCompositeOperation = "destination-out";
        ctx.lineWidth = 40;
      } else {
        ctx.globalCompositeOperation = "source-over";
        ctx.strokeStyle = colorRef.current;
        ctx.lineWidth = 6;
      }

      if (lastPointRef.current) {
        ctx.beginPath();
        ctx.moveTo(lastPointRef.current.x, lastPointRef.current.y);
        ctx.lineTo(point.x, point.y);
        ctx.stroke();

        // 연습 모드일 땐 상대방에게 전송하지 않음
        if (!practiceModeRef.current) {
          sendSegment({
            x1: lastPointRef.current.x / canvas.width,
            y1: lastPointRef.current.y / canvas.height,
            x2: point.x / canvas.width,
            y2: point.y / canvas.height,
            color: colorRef.current,
            eraser: isEraserRef.current,
          });
        }
      }
      lastPointRef.current = point;
    },
    [sendSegment]
  );

  const handlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      // 게임 모드(연습 아님)일 땐 그림꾼만 그릴 수 있음
      if (!practiceModeRef.current && !isDrawerRef.current) return;
      const canvas = e.currentTarget;
      canvas.setPointerCapture(e.pointerId);
      isPointerDownRef.current = true;
      lastPointRef.current = getCanvasPoint(canvas, e.clientX, e.clientY);
      setShowHint(false);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      if (!isPointerDownRef.current) return;
      if (!practiceModeRef.current && !isDrawerRef.current) return;
      const canvas = e.currentTarget;
      const point = getCanvasPoint(canvas, e.clientX, e.clientY);
      drawToPoint(canvas, point);
    },
    [drawToPoint]
  );

  const handlePointerUp = useCallback(
    (e: React.PointerEvent<HTMLCanvasElement>) => {
      isPointerDownRef.current = false;
      lastPointRef.current = null;
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {}
    },
    []
  );

  // 캔버스 내부 해상도를 한 번 고정 (16:9). 실제 화면 크기는 CSS(width/height: 100%)가 맞춰줌
  useEffect(() => {
    if (view !== "room") return;
    const drawCanvas = drawCanvasRef.current;
    const practiceCanvas = practiceCanvasRef.current;
    if (drawCanvas) {
      drawCanvas.width = 960;
      drawCanvas.height = 540;
    }
    if (practiceCanvas) {
      practiceCanvas.width = 960;
      practiceCanvas.height = 540;
    }
  }, [view]);

  if (view === "landing") {
    return (
      <main
        style={{
          minHeight: "100vh",
          background: "#1B1A18",
          color: "#F4F1EA",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          padding: "24px",
        }}
      >
        <h1
          className={caveat.className}
          style={{ fontSize: "64px", marginBottom: "8px" }}
        >
          AirMime
        </h1>
        <p
          style={{
            fontSize: "14px",
            color: "rgba(244,241,234,0.6)",
            marginBottom: "40px",
          }}
        >
          화면에 손가락(터치)이나 마우스로 그림을 그려 친구와 맞혀보세요
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "16px",
            width: "min(90vw, 320px)",
          }}
        >
          <button
            onClick={handleRandomMatch}
            disabled={isCreating}
            style={{
              padding: "14px",
              borderRadius: "10px",
              border: "none",
              background: "#4DABF7",
              color: "#1B1A18",
              fontWeight: 700,
              fontSize: "15px",
              cursor: isCreating ? "default" : "pointer",
              opacity: isCreating ? 0.6 : 1,
            }}
          >
            {isCreating ? "매칭 중..." : "🎲 랜덤 매치"}
          </button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              margin: "-6px 0",
            }}
          >
            <div
              style={{
                flex: 1,
                height: "1px",
                background: "rgba(255,255,255,0.15)",
              }}
            />
            <span
              style={{ fontSize: "11px", color: "rgba(244,241,234,0.4)" }}
            >
              또는
            </span>
            <div
              style={{
                flex: 1,
                height: "1px",
                background: "rgba(255,255,255,0.15)",
              }}
            />
          </div>

          <button
            onClick={handleCreateRoom}
            disabled={isCreating}
            style={{
              padding: "14px",
              borderRadius: "10px",
              border: "none",
              background: "#F4F1EA",
              color: "#1B1A18",
              fontWeight: 600,
              fontSize: "15px",
              cursor: isCreating ? "default" : "pointer",
              opacity: isCreating ? 0.6 : 1,
            }}
          >
            {isCreating ? "만드는 중..." : "방 만들기"}
          </button>

          <label
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              fontSize: "12px",
              color: "rgba(244,241,234,0.6)",
              cursor: "pointer",
              marginTop: "-8px",
            }}
          >
            <input
              type="checkbox"
              checked={createPublic}
              onChange={(e) => setCreatePublic(e.target.checked)}
            />
            공개방으로 만들기 (랜덤 매치로 찾아올 수 있어요)
          </label>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "6px",
              flexWrap: "wrap",
              marginTop: "-4px",
            }}
          >
            <span
              style={{ fontSize: "12px", color: "rgba(244,241,234,0.5)" }}
            >
              최대 인원
            </span>
            {MAX_PLAYERS_OPTIONS.map((n) => (
              <button
                key={n}
                onClick={() => setMaxPlayersChoice(n)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "12px",
                  border:
                    maxPlayersChoice === n
                      ? "2px solid #F4F1EA"
                      : "1px solid rgba(255,255,255,0.2)",
                  background: "transparent",
                  color: "#F4F1EA",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                {n}명
              </button>
            ))}
          </div>

          <div style={{ display: "flex", gap: "8px" }}>
            <input
              value={joinInput}
              onChange={(e) =>
                setJoinInput(e.target.value.replace(/\D/g, "").slice(0, 4))
              }
              placeholder="4자리 코드"
              inputMode="numeric"
              style={{
                flex: 1,
                padding: "12px",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "#F4F1EA",
                fontSize: "15px",
                textAlign: "center",
                letterSpacing: "4px",
              }}
            />
            <button
              onClick={handleJoinRoom}
              disabled={isCreating}
              style={{
                padding: "12px 18px",
                borderRadius: "10px",
                border: "1px solid rgba(255,255,255,0.3)",
                background: "transparent",
                color: "#F4F1EA",
                fontSize: "15px",
                cursor: isCreating ? "default" : "pointer",
                opacity: isCreating ? 0.6 : 1,
              }}
            >
              참가
            </button>
          </div>

          {roomError && (
            <p
              style={{
                color: "#FF6B6B",
                fontSize: "13px",
                textAlign: "center",
              }}
            >
              {roomError}
            </p>
          )}
        </div>
      </main>
    );
  }

  // 캐치마인드 스타일 좌/우 참가자 컬럼을 위해 방장과 나머지를 분리
  const hostPlayer = playersList.find((p) => p.id === hostId) || null;
  const otherPlayers = playersList.filter((p) => p.id !== hostId);

  const renderPlayerSlot = (p: PlayerInfo, leader?: boolean) => {
    const isMe = p.id === clientIdRef.current;
    const isPlayerHost = p.id === hostId;
    const isCurrentDrawer =
      !!gameData && !practiceMode && gameData.drawerId === p.id;
    const opponentIndex =
      playersList
        .filter((x) => x.id !== clientIdRef.current)
        .findIndex((x) => x.id === p.id) + 1;
    const displayName = isMe
      ? "나"
      : `상대${playerCount > 2 ? opponentIndex : ""}`;
    const score = scores[p.id] || 0;

    return (
      <div
        key={p.id}
        style={{
          border: `2px solid ${
            leader
              ? "#F783AC"
              : isCurrentDrawer
              ? "#FFD43B"
              : isMe
              ? "rgba(255,255,255,0.5)"
              : "rgba(255,255,255,0.15)"
          }`,
          borderRadius: "10px",
          overflow: "hidden",
          background: leader ? "rgba(247,131,172,0.1)" : "rgba(255,255,255,0.04)",
        }}
      >
        <div
          style={{
            background: leader ? "#F783AC" : isCurrentDrawer ? "#FFD43B" : "rgba(255,255,255,0.08)",
            color: leader || isCurrentDrawer ? "#1B1A18" : "#F4F1EA",
            fontSize: "10px",
            fontWeight: 700,
            padding: "4px 6px",
            display: "flex",
            alignItems: "center",
            gap: "3px",
          }}
        >
          {leader && (
            <span style={{ fontSize: "9px", letterSpacing: "1px" }}>방장</span>
          )}
          <span
            style={{
              flex: 1,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {displayName}
          </span>
          {!leader && isPlayerHost && <span title="방장">👑</span>}
          {isCurrentDrawer && <span title="그림꾼">✏️</span>}
        </div>
        <div
          style={{
            padding: "5px",
            fontSize: "12px",
            fontWeight: 700,
            color: "#FFD43B",
            textAlign: "center",
            background: "rgba(0,0,0,0.15)",
          }}
        >
          🏆 {score}
        </div>
      </div>
    );
  };

  const renderEmptySlot = (key: string) => (
    <div
      key={key}
      style={{
        border: "2px dashed rgba(255,255,255,0.12)",
        borderRadius: "10px",
        padding: "14px 6px",
        textAlign: "center",
        fontSize: "10px",
        color: "rgba(244,241,234,0.3)",
      }}
    >
      빈 자리
    </div>
  );

  const participantColumnItems = [
    ...otherPlayers.map((p) => renderPlayerSlot(p)),
    ...Array.from({
      // 방장 자리(1명)를 빼고 남은 정원만큼만 빈 자리 표시
      length: Math.max(0, roomMaxPlayers - 1 - otherPlayers.length),
    }).map((_, i) => renderEmptySlot(`empty-${i}`)),
  ];

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "#1B1A18",
        color: "#F4F1EA",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "14px 12px 24px",
      }}
    >
      {/* 상단 바: 로고 + 방 코드 + 신고/나가기 */}
      <div
        style={{
          width: "min(94vw, 1100px)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "10px",
          flexWrap: "wrap",
          gap: "8px",
        }}
      >
        <div
          style={{
            background: "linear-gradient(135deg, #4DABF7, #364FC7)",
            borderRadius: "12px",
            padding: "4px 18px",
            boxShadow: "0 3px 0 rgba(0,0,0,0.15)",
          }}
        >
          <h1
            className={caveat.className}
            style={{ fontSize: "26px", color: "#fff", margin: 0 }}
          >
            AirMime
          </h1>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span
            style={{
              fontSize: "12px",
              fontWeight: 700,
              color: "#173A5E",
              background: "#fff",
              border: "1px solid rgba(23,58,94,0.2)",
              borderRadius: "8px",
              padding: "4px 10px",
              letterSpacing: "2px",
            }}
          >
            방 코드 {roomCode}
            {isHost && " 👑"}
          </span>
          <button
            onClick={() => setShowReportForm((prev) => !prev)}
            style={{
              fontSize: "12px",
              color: "#173A5E",
              background: "#fff",
              border: "1px solid rgba(23,58,94,0.2)",
              borderRadius: "8px",
              padding: "4px 10px",
              cursor: "pointer",
            }}
          >
            신고
          </button>
          <button
            onClick={handleLeaveRoom}
            style={{
              fontSize: "12px",
              color: "#fff",
              background: "#4C6EF5",
              border: "none",
              borderRadius: "8px",
              padding: "4px 10px",
              cursor: "pointer",
              fontWeight: 600,
            }}
          >
            나가기
          </button>
        </div>
      </div>

      {/* 상태 안내 배너 (연습중 / 제시어 설정 / 게임중) */}
      <div
        style={{
          width: "min(94vw, 1100px)",
          marginBottom: "10px",
          background: "#fff",
          borderRadius: "12px",
          padding: "8px 14px",
          boxShadow: "0 2px 0 rgba(0,0,0,0.08)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
        }}
      >
        {practiceMode && !showPromptSetup && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            <span
              style={{ fontSize: "13px", color: "#E8590C", fontWeight: 700 }}
            >
              ✏️ 연습 중 (나만 보여요, 상대방에게 공유 안 됨)
            </span>
            <button
              onClick={handleClearPractice}
              style={{
                padding: "4px 10px",
                borderRadius: "12px",
                border: "1px solid rgba(23,58,94,0.2)",
                background: "transparent",
                color: "#173A5E",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              연습 지우기
            </button>
            {isHost ? (
              <button
                onClick={handleOpenPromptSetup}
                style={{
                  padding: "5px 16px",
                  borderRadius: "14px",
                  border: "none",
                  background: "#51CF66",
                  color: "#173A5E",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: "pointer",
                }}
              >
                게임 시작 ▶
              </button>
            ) : (
              <span
                style={{
                  fontSize: "12px",
                  color: "rgba(23,58,94,0.55)",
                }}
              >
                방장이 게임을 시작하면 알려드릴게요
              </span>
            )}
          </div>
        )}

        {practiceMode && showPromptSetup && isHost && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "8px",
              padding: "6px 4px",
              width: "100%",
              maxWidth: "480px",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 700 }}>
              제시어를 어떻게 정할까요?
            </span>
            <div
              style={{
                display: "flex",
                gap: "8px",
                flexWrap: "wrap",
                justifyContent: "center",
              }}
            >
              <button
                onClick={handleAutoPrompt}
                disabled={startingGame}
                style={{
                  padding: "6px 14px",
                  borderRadius: "12px",
                  border: "none",
                  background: "#4DABF7",
                  color: "#173A5E",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: startingGame ? "default" : "pointer",
                  opacity: startingGame ? 0.6 : 1,
                }}
              >
                자동으로 받기
              </button>
              <span
                style={{
                  fontSize: "12px",
                  color: "rgba(23,58,94,0.5)",
                  alignSelf: "center",
                }}
              >
                또는
              </span>
              <input
                value={customPromptInput}
                onChange={(e) => setCustomPromptInput(e.target.value)}
                placeholder="직접 제시어 입력"
                style={{
                  padding: "6px 10px",
                  borderRadius: "10px",
                  border: "1px solid rgba(23,58,94,0.25)",
                  background: "#F4F8FD",
                  color: "#173A5E",
                  fontSize: "13px",
                  width: "140px",
                }}
              />
              <button
                onClick={handleSubmitCustomPrompt}
                disabled={startingGame || !customPromptInput.trim()}
                style={{
                  padding: "6px 14px",
                  borderRadius: "12px",
                  border: "none",
                  background: "#51CF66",
                  color: "#173A5E",
                  fontWeight: 700,
                  fontSize: "13px",
                  cursor: startingGame ? "default" : "pointer",
                  opacity: startingGame || !customPromptInput.trim() ? 0.6 : 1,
                }}
              >
                이 제시어로 시작
              </button>
            </div>
            <button
              onClick={() => setShowPromptSetup(false)}
              style={{
                fontSize: "12px",
                color: "rgba(23,58,94,0.5)",
                background: "transparent",
                border: "none",
                cursor: "pointer",
                textDecoration: "underline",
              }}
            >
              취소
            </button>
          </div>
        )}

        {!practiceMode && roundStatus && (
          <span
            style={{
              fontSize: "13px",
              fontWeight: 700,
              color:
                roundStatus.winnerId === clientIdRef.current
                  ? "#2F9E44"
                  : roundStatus.winnerId
                  ? "#E03131"
                  : "#E8590C",
            }}
          >
            {roundStatus.winnerId === null
              ? `⏰ 시간 초과! 정답은 "${gameData?.prompt ?? ""}" 였어요`
              : roundStatus.winnerId === clientIdRef.current
              ? "🎉 정답! 다음 라운드 준비 중..."
              : "😢 상대방이 먼저 맞혔어요. 다음 라운드 준비 중..."}
          </span>
        )}

        {!practiceMode && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "10px",
              flexWrap: "wrap",
            }}
          >
            {gameData && isDrawer && (
              <span
                style={{ fontSize: "13px", color: "#2F9E44", fontWeight: 700 }}
              >
                🎨 당신이 그림꾼! 제시어: {gameData.prompt}
              </span>
            )}
            {gameData && !isDrawer && (
              <span
                style={{ fontSize: "13px", color: "#E8590C", fontWeight: 700 }}
              >
                🤔 상대방이 그리는 중이에요! 채팅에 정답을 입력해보세요
              </span>
            )}
            {!gameData && (
              <span style={{ fontSize: "13px", color: "rgba(23,58,94,0.6)" }}>
                🎮 게임 중
              </span>
            )}
            {isHost && (
              <button
                onClick={handleBackToPractice}
                style={{
                  padding: "4px 10px",
                  borderRadius: "12px",
                  border: "1px solid rgba(23,58,94,0.2)",
                  background: "transparent",
                  color: "#173A5E",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                연습으로 돌아가기
              </button>
            )}
          </div>
        )}

        <span
          style={{
            fontSize: "11px",
            color: "rgba(23,58,94,0.5)",
          }}
        >
          🖊️ 화면을 손가락이나 마우스로 눌러서 그림을 그려보세요
        </span>
      </div>

      {showReportForm && (
        <div
          style={{
            width: "min(94vw, 1100px)",
            marginBottom: "10px",
            padding: "10px 12px",
            borderRadius: "10px",
            background: "#fff",
            boxShadow: "0 2px 0 rgba(0,0,0,0.08)",
            display: "flex",
            gap: "8px",
            alignItems: "center",
          }}
        >
          <input
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
            placeholder="신고 사유를 적어주세요"
            style={{
              flex: 1,
              padding: "8px 10px",
              borderRadius: "8px",
              border: "1px solid rgba(23,58,94,0.2)",
              background: "#F4F8FD",
              color: "#173A5E",
              fontSize: "13px",
            }}
          />
          <button
            onClick={handleSubmitReport}
            disabled={reportSubmitting || !reportText.trim()}
            style={{
              padding: "8px 14px",
              borderRadius: "8px",
              border: "none",
              background: "#FF6B6B",
              color: "#fff",
              fontWeight: 700,
              fontSize: "13px",
              cursor: reportSubmitting ? "default" : "pointer",
              opacity: reportSubmitting || !reportText.trim() ? 0.6 : 1,
            }}
          >
            제출
          </button>
          <button
            onClick={() => {
              setShowReportForm(false);
              setReportText("");
            }}
            style={{
              padding: "8px 12px",
              borderRadius: "8px",
              border: "1px solid rgba(23,58,94,0.2)",
              background: "transparent",
              color: "#173A5E",
              fontSize: "13px",
              cursor: "pointer",
            }}
          >
            취소
          </button>
        </div>
      )}

      {reportDone && (
        <div
          style={{
            width: "min(94vw, 1100px)",
            marginBottom: "10px",
            fontSize: "12px",
            color: "#2F9E44",
            fontWeight: 700,
            textAlign: "center",
          }}
        >
          신고가 접수됐어요.
        </div>
      )}

      {/* 메인 게임 영역: 좌측 참가자 컬럼 / 중앙 페인트보드+컨트롤+채팅 / 우측 참가자 컬럼 */}
      <div
        style={{
          display: "flex",
          gap: "14px",
          width: "min(94vw, 1100px)",
          justifyContent: "center",
          alignItems: "flex-start",
          flexWrap: "wrap",
        }}
      >
        {/* 좌측 컬럼: 참가자 (방장 + 나머지 전부 한 줄로) */}
        <div
          style={{
            width: "150px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              color:
                playerCount >= roomMaxPlayers
                  ? "#69DB7C"
                  : "rgba(244,241,234,0.5)",
              fontWeight: 700,
              textAlign: "center",
            }}
          >
            👥 {playerCount}/{roomMaxPlayers}명
          </span>
          {hostPlayer ? (
            renderPlayerSlot(hostPlayer, true)
          ) : (
            <div
              style={{
                border: "2px dashed rgba(255,255,255,0.5)",
                borderRadius: "10px",
                padding: "14px 6px",
                textAlign: "center",
                fontSize: "10px",
                color: "rgba(255,255,255,0.7)",
              }}
            >
              방장 대기중
            </div>
          )}
          {participantColumnItems}
        </div>

        {/* 중앙: 페인트보드 + 컨트롤 + 타이머/채팅 */}
        <div
          style={{
            flex: "1 1 420px",
            minWidth: "280px",
            maxWidth: "640px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "10px",
          }}
        >
          {/* 노트북 스타일 페인트보드 프레임 */}
          <div
            style={{
              background: "#FFFDF7",
              borderRadius: "14px 14px 6px 6px",
              padding: "10px 10px 12px",
              width: "100%",
              boxShadow: "0 4px 0 rgba(0,0,0,0.12)",
              border: "2px solid #2D6CB4",
            }}
          >
            <div
              style={{
                textAlign: "center",
                fontSize: "11px",
                letterSpacing: "4px",
                color: "#2D6CB4",
                fontWeight: 800,
                marginBottom: "8px",
              }}
            >
              PAINT BOARD
            </div>

            <div
              style={{
                position: "relative",
                width: "100%",
                aspectRatio: "16 / 9",
                borderRadius: "8px",
                overflow: "hidden",
                background: "#FFFFFF",
                flexShrink: 0,
              }}
            >
              {/* 그림 레이어(공유): 게임 모드일 때만 보임/조작 가능 */}
              <canvas
                ref={drawCanvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  opacity: practiceMode ? 0 : 1,
                  pointerEvents: practiceMode ? "none" : "auto",
                  touchAction: "none",
                  cursor: isEraser ? "cell" : "crosshair",
                }}
              />

              {/* 연습 캔버스: 연습 모드일 때만 보임/조작 가능, 상대방에겐 절대 전송 안 됨 */}
              <canvas
                ref={practiceCanvasRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerLeave={handlePointerUp}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  opacity: practiceMode ? 1 : 0,
                  pointerEvents: practiceMode ? "auto" : "none",
                  touchAction: "none",
                  cursor: isEraser ? "cell" : "crosshair",
                }}
              />

              {showHint && (practiceMode || isDrawer) && (
                <div
                  style={{
                    position: "absolute",
                    top: "16px",
                    left: "50%",
                    transform: "translateX(-50%)",
                    background: "rgba(0,0,0,0.6)",
                    padding: "10px 18px",
                    borderRadius: "10px",
                    fontSize: "13px",
                    textAlign: "center",
                    lineHeight: 1.6,
                    color: "#F4F1EA",
                    pointerEvents: "none",
                  }}
                >
                  화면을 손가락이나 마우스로 누른 채 움직여서 그려보세요
                  <br />
                  숫자 1~9로 색상, 0으로 지우개
                </div>
              )}

              {!practiceMode && !isDrawer && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "rgba(27,26,24,0.06)",
                    fontSize: "13px",
                    color: "rgba(27,26,24,0.6)",
                    textAlign: "center",
                    padding: "0 20px",
                    lineHeight: 1.6,
                    pointerEvents: "none",
                  }}
                >
                  ✏️ 상대방이 그리는 중이에요 — 여기서는 그릴 수 없어요
                </div>
              )}
            </div>
          </div>

          {/* 하단: 디지털 타이머 + 채팅 (캐치마인드처럼 나란히) */}
          <div
            style={{
              display: "flex",
              gap: "8px",
              width: "100%",
              alignItems: "stretch",
              flexWrap: "wrap",
            }}
          >
            {/* 디지털 타이머 */}
            <div
              style={{
                background: "#0B2340",
                border: "2px solid #1B4B7A",
                borderRadius: "10px",
                padding: "8px 14px",
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                minWidth: "88px",
              }}
            >
              <span
                style={{
                  fontSize: "9px",
                  color: "#7EC8E3",
                  letterSpacing: "2px",
                  fontWeight: 700,
                }}
              >
                TIME
              </span>
              <span
                style={{
                  fontFamily: "monospace",
                  fontSize: "24px",
                  fontWeight: 700,
                  color:
                    !practiceMode && timeLeft <= 10 ? "#FF6B6B" : "#4DABF7",
                }}
              >
                {practiceMode ? "--" : String(timeLeft).padStart(2, "0")}
              </span>
            </div>

            {/* 채팅 */}
            <div
              style={{
                flex: 1,
                minWidth: "180px",
                display: "flex",
                flexDirection: "column",
                background: "#fff",
                borderRadius: "10px",
                overflow: "hidden",
                boxShadow: "0 2px 0 rgba(0,0,0,0.08)",
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  fontWeight: 700,
                  color: "#2D6CB4",
                  letterSpacing: "2px",
                  padding: "5px 10px 0",
                }}
              >
                CHATTING
              </div>
              <div
                ref={chatListRef}
                style={{
                  height: "62px",
                  overflowY: "auto",
                  padding: "4px 10px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "2px",
                }}
              >
                {chatMessages.length === 0 && (
                  <span
                    style={{
                      fontSize: "12px",
                      color: "rgba(23,58,94,0.35)",
                    }}
                  >
                    {practiceMode
                      ? "게임이 시작되면 여기서 정답을 맞혀보세요"
                      : "여기에 정답을 입력해보세요"}
                  </span>
                )}
                {chatMessages.map((m) => (
                  <span
                    key={m.id}
                    style={{
                      fontSize: "12px",
                      color: m.correct
                        ? "#2F9E44"
                        : m.senderId === clientIdRef.current
                        ? "#173A5E"
                        : "rgba(23,58,94,0.7)",
                      fontWeight: m.correct ? 700 : 400,
                    }}
                  >
                    {m.senderId === clientIdRef.current ? "나" : "상대"}:{" "}
                    {m.correct ? "🎉 정답!" : m.text}
                  </span>
                ))}
              </div>
              <div
                style={{
                  display: "flex",
                  borderTop: "1px solid rgba(23,58,94,0.12)",
                }}
              >
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      handleSendChat();
                    }
                  }}
                  placeholder={
                    practiceMode
                      ? "채팅 보내기"
                      : isDrawer
                      ? "채팅 보내기"
                      : "정답을 입력하세요"
                  }
                  style={{
                    flex: 1,
                    padding: "6px 10px",
                    border: "none",
                    background: "transparent",
                    color: "#173A5E",
                    fontSize: "12px",
                    outline: "none",
                  }}
                />
                <button
                  onClick={handleSendChat}
                  style={{
                    padding: "6px 14px",
                    border: "none",
                    background: "#E7F1FF",
                    color: "#2D6CB4",
                    fontWeight: 700,
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  전송
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* 우측 컬럼: 그리기 도구 */}
        <div
          style={{
            width: "170px",
            display: "flex",
            flexDirection: "column",
            gap: "8px",
          }}
        >
          <span
            style={{
              fontSize: "11px",
              color: "rgba(244,241,234,0.45)",
              fontWeight: 700,
              letterSpacing: "1px",
              textAlign: "center",
            }}
          >
            그리기 도구
          </span>

          {/* 색상 팔레트 + 지우개 + 전체지우기 */}
          <div
            style={{
              display: "flex",
              gap: "6px",
              alignItems: "center",
              flexWrap: "wrap",
              justifyContent: "center",
              background: "#fff",
              borderRadius: "14px",
              padding: "8px 10px",
              boxShadow: "0 2px 0 rgba(0,0,0,0.08)",
              width: "100%",
            }}
          >
            {COLORS.map((c, i) => (
              <button
                key={c}
                onClick={() => {
                  setColor(c);
                  setIsEraser(false);
                  setShowHint(false);
                }}
                style={{
                  width: "22px",
                  height: "22px",
                  borderRadius: "50%",
                  background: c,
                  border:
                    !isEraser && color === c
                      ? "2px solid #2D6CB4"
                      : "2px solid rgba(23,58,94,0.15)",
                  cursor: "pointer",
                }}
                aria-label={`색상 ${i + 1}`}
              />
            ))}
            <button
              onClick={() => {
                setIsEraser(true);
                setShowHint(false);
              }}
              style={{
                padding: "4px 10px",
                borderRadius: "16px",
                border: isEraser
                  ? "2px solid #2D6CB4"
                  : "2px solid rgba(23,58,94,0.2)",
                background: "transparent",
                color: "#173A5E",
                cursor: "pointer",
                fontSize: "11px",
              }}
            >
              지우개 (0)
            </button>
            <button
              onClick={handleClearAll}
              style={{
                padding: "4px 10px",
                borderRadius: "16px",
                border: "2px solid rgba(23,58,94,0.2)",
                background: "transparent",
                color: "#173A5E",
                cursor: "pointer",
                fontSize: "11px",
              }}
            >
              전체 지우기
            </button>
          </div>
        </div>
      </div>

      <p
        style={{
          marginTop: "12px",
          fontSize: "12px",
          color: "rgba(244,241,234,0.6)",
        }}
      >
        화면을 누른 채 드래그해서 그리기 · 숫자 1~9: 색상 변경 · 0: 지우개
      </p>
    </main>
  );
}
