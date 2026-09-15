"use client";

import { useEffect, useRef, useState, useCallback } from "react";
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
import { useBackgroundBlur } from "@/hooks/useBackgroundBlur";

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

const EMOJIS = ["🐱", "🐶", "🐼", "👽"];

type FilterMode = "none" | "blur" | "mosaic" | "emoji";

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

function generateRoomCode(): string {
  return Math.floor(1000 + Math.random() * 9000).toString();
}

export default function Home() {
  const [view, setView] = useState<"landing" | "room">("landing");
  const [roomCode, setRoomCode] = useState<string>("");
  const [joinInput, setJoinInput] = useState("");
  const [roomError, setRoomError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const drawCanvasRef = useRef<HTMLCanvasElement>(null);
  const practiceCanvasRef = useRef<HTMLCanvasElement>(null);
  const faceCanvasRef = useRef<HTMLCanvasElement>(null);
  const bgCanvasRef = useRef<HTMLCanvasElement>(null);
  const offscreenRef = useRef<HTMLCanvasElement | null>(null);

  const handsRef = useRef<any>(null);
  const faceDetectionRef = useRef<any>(null);
  const cameraRef = useRef<any>(null);
  const lastPointRef = useRef<Point | null>(null);

  const [isPenDown, setIsPenDown] = useState(false);
  const isPenDownRef = useRef(false);
  const [color, setColor] = useState(COLORS[0]);
  const colorRef = useRef(COLORS[0]);
  const [isEraser, setIsEraser] = useState(false);
  const isEraserRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [showHint, setShowHint] = useState(true);

  const [filterMode, setFilterMode] = useState<FilterMode>("none");
  const filterModeRef = useRef<FilterMode>("none");
  const [selectedEmoji, setSelectedEmoji] = useState(EMOJIS[0]);
  const selectedEmojiRef = useRef(EMOJIS[0]);

  // ---------- 새로 추가: 배경 블러 / 카메라 숨기기 ----------
  const [bgBlurOn, setBgBlurOn] = useState(false);
  const [cameraHidden, setCameraHidden] = useState(false);

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
  const playersRef = useRef<Record<string, boolean>>({});
  const [playerCount, setPlayerCount] = useState(0);
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

  // 블러 강도 (얼굴 블러 + 배경 블러 공통 적용)
  const BLUR_LEVELS = [30, 50, 70, 100] as const;
  const [blurStrength, setBlurStrength] = useState<number>(50);
  const blurStrengthRef = useRef<number>(50);
  useEffect(() => {
    blurStrengthRef.current = blurStrength;
  }, [blurStrength]);

  const roomCodeRef = useRef<string>("");
  const clearSignalSeenRef = useRef<number | null>(null);

  useEffect(() => {
    isPenDownRef.current = isPenDown;
  }, [isPenDown]);
  useEffect(() => {
    colorRef.current = color;
  }, [color]);
  useEffect(() => {
    isEraserRef.current = isEraser;
  }, [isEraser]);
  useEffect(() => {
    roomCodeRef.current = roomCode;
  }, [roomCode]);
  useEffect(() => {
    filterModeRef.current = filterMode;
  }, [filterMode]);
  useEffect(() => {
    selectedEmojiRef.current = selectedEmoji;
  }, [selectedEmoji]);

  // 배경 전체 블러 훅 연결 (인물만 선명, 배경은 흐리게)
  useBackgroundBlur({
    videoRef,
    outputCanvasRef: bgCanvasRef,
    enabled: bgBlurOn && !cameraHidden,
    blurAmount: blurStrength,
    frameSkip: 2,
  });

  const handleCreateRoom = async () => {
    setIsCreating(true);
    setRoomError(null);
    try {
      const code = generateRoomCode();
      await set(ref(db, `rooms/${code}/meta`), {
        createdAt: Date.now(),
        hostId: clientIdRef.current,
      });
      await set(ref(db, `rooms/${code}/gameStarted`), false);
      setRoomCode(code);
      setView("room");
    } catch (err) {
      console.error(err);
      setRoomError("방을 만들지 못했어요. 다시 시도해주세요.");
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
    setView("landing");
    setRoomCode("");
    setJoinInput("");
    lastPointRef.current = null;
    clearSignalSeenRef.current = null;
    setPracticeMode(true);
    setGameData(null);
    setHostId(null);
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
    const metaFbRef = ref(db, `rooms/${roomCode}/meta`);
    const myPlayerRef = ref(
      db,
      `rooms/${roomCode}/players/${clientIdRef.current}`
    );

    onValue(metaFbRef, (snap) => {
      const val = snap.val();
      setHostId(val?.hostId || null);
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

    // 방 참가자 목록 (그림꾼 무작위 선정에 사용)
    onValue(playersFbRef, (snap) => {
      const val = snap.val() || {};
      playersRef.current = val;
      setPlayerCount(Object.keys(val).length);
    });

    // 내가 이 방에 참가 중임을 등록. 탭을 갑자기 닫아도 자동으로 제거되게 함
    set(myPlayerRef, true).catch((err) =>
      console.error("player register failed:", err)
    );
    onDisconnect(myPlayerRef)
      .remove()
      .catch(() => {});

    return () => {
      off(strokesRef);
      off(clearRef);
      off(gameStateRef);
      off(gameDataFbRef);
      off(playersFbRef);
      off(metaFbRef);
      off(roundStartedAtRef);
      off(roundStatusFbRef);
      off(scoresFbRef);
      off(chatFbRef);
      remove(myPlayerRef).catch(() => {});
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

      if (e.code === "Space") {
        e.preventDefault();
        setIsPenDown((prev) => !prev);
        setShowHint(false);
        lastPointRef.current = null;
      } else if (e.key >= "1" && e.key <= "9") {
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

  const onHandsResults = useCallback(
    (results: any) => {
      // 게임 모드(연습 아님)일 땐 그림꾼만 그릴 수 있음
      if (!practiceModeRef.current && !isDrawerRef.current) {
        lastPointRef.current = null;
        return;
      }

      const targetCanvas = practiceModeRef.current
        ? practiceCanvasRef.current
        : drawCanvasRef.current;
      if (!targetCanvas) return;
      const ctx = targetCanvas.getContext("2d");
      if (!ctx) return;

      if (
        results.multiHandLandmarks &&
        results.multiHandLandmarks.length > 0
      ) {
        const landmarks = results.multiHandLandmarks[0];
        const indexTip = landmarks[8];

        const x = (1 - indexTip.x) * targetCanvas.width;
        const y = indexTip.y * targetCanvas.height;

        if (isPenDownRef.current) {
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
            ctx.lineTo(x, y);
            ctx.stroke();

            // 연습 모드일 땐 상대방에게 전송하지 않음
            if (!practiceModeRef.current) {
              sendSegment({
                x1: lastPointRef.current.x / targetCanvas.width,
                y1: lastPointRef.current.y / targetCanvas.height,
                x2: x / targetCanvas.width,
                y2: y / targetCanvas.height,
                color: colorRef.current,
                eraser: isEraserRef.current,
              });
            }
          }
          lastPointRef.current = { x, y };
        } else {
          lastPointRef.current = null;
        }
      } else {
        lastPointRef.current = null;
      }
    },
    [sendSegment]
  );

  const onFaceResults = useCallback((results: any) => {
    const canvas = faceCanvasRef.current;
    const video = videoRef.current;
    if (!canvas || !video) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    const mode = filterModeRef.current;
    if (mode === "none") return;
    if (!results.detections || results.detections.length === 0) return;

    for (const det of results.detections) {
      const box = det.boundingBox;
      const bw = box.width * canvas.width;
      const bh = box.height * canvas.height;
      const bx = box.xCenter * canvas.width - bw / 2;
      const by = box.yCenter * canvas.height - bh / 2;

      const pad = 0.25;
      const sx = Math.max(0, bx - bw * pad);
      const sy = Math.max(0, by - bh * pad * 1.4);
      const sw = Math.min(canvas.width - sx, bw * (1 + pad * 2));
      const sh = Math.min(canvas.height - sy, bh * (1 + pad * 2.4));

      if (mode === "blur") {
        ctx.save();
        ctx.filter = `blur(${blurStrengthRef.current}px)`;
        ctx.drawImage(video, sx, sy, sw, sh, sx, sy, sw, sh);
        ctx.restore();
      } else if (mode === "mosaic") {
        const off = offscreenRef.current;
        if (off) {
          const size = 14;
          off.width = size;
          off.height = size;
          const octx = off.getContext("2d");
          if (octx) {
            octx.drawImage(video, sx, sy, sw, sh, 0, 0, size, size);
            ctx.save();
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(off, 0, 0, size, size, sx, sy, sw, sh);
            ctx.restore();
          }
        }
      } else if (mode === "emoji") {
        ctx.save();
        const fontSize = Math.max(sw, sh) * 1.1;
        ctx.font = `${fontSize}px serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(selectedEmojiRef.current, sx + sw / 2, sy + sh / 2);
        ctx.restore();
      }
    }
  }, []);

  useEffect(() => {
    if (view !== "room") return;
    let cancelled = false;

    offscreenRef.current = document.createElement("canvas");

    const setup = async () => {
      const { Hands } = await import("@mediapipe/hands");
      const { FaceDetection } = await import("@mediapipe/face_detection");
      const { Camera } = await import("@mediapipe/camera_utils");

      if (cancelled) return;

      const hands = new Hands({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
      });
      hands.setOptions({
        maxNumHands: 1,
        modelComplexity: 1,
        minDetectionConfidence: 0.7,
        minTrackingConfidence: 0.6,
      });
      hands.onResults(onHandsResults);
      handsRef.current = hands;

      const faceDetection = new FaceDetection({
        locateFile: (file) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`,
      });
      faceDetection.setOptions({
        model: "short",
        minDetectionConfidence: 0.6,
      });
      faceDetection.onResults(onFaceResults);
      faceDetectionRef.current = faceDetection;

      const video = videoRef.current;
      if (!video) return;

      let frame = 0;
      const camera = new Camera(video, {
        onFrame: async () => {
          if (!video) return;
          await hands.send({ image: video });
          frame += 1;
          if (frame % 2 === 0) {
            await faceDetection.send({ image: video });
          }
        },
        width: 1280,
        height: 720,
      });

      camera.start();
      cameraRef.current = camera;
      setReady(true);
    };

    setup();

    return () => {
      cancelled = true;
      cameraRef.current?.stop?.();
      handsRef.current?.close?.();
      faceDetectionRef.current?.close?.();
      setReady(false);
    };
  }, [view, onHandsResults, onFaceResults]);

  useEffect(() => {
    const drawCanvas = drawCanvasRef.current;
    const practiceCanvas = practiceCanvasRef.current;
    const faceCanvas = faceCanvasRef.current;
    const bgCanvas = bgCanvasRef.current;
    const video = videoRef.current;
    if (!drawCanvas || !practiceCanvas || !faceCanvas || !bgCanvas || !video)
      return;

    const resize = () => {
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      drawCanvas.width = w;
      drawCanvas.height = h;
      practiceCanvas.width = w;
      practiceCanvas.height = h;
      faceCanvas.width = w;
      faceCanvas.height = h;
      bgCanvas.width = w;
      bgCanvas.height = h;
    };

    video.addEventListener("loadedmetadata", resize);
    return () => video.removeEventListener("loadedmetadata", resize);
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
          허공에 손가락으로 그림을 그려 친구와 맞혀보세요
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

  return (
    <main
      style={{
        height: "100vh",
        overflow: "hidden",
        background: "#1B1A18",
        color: "#F4F1EA",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 16px",
      }}
    >
      <div
        style={{
          width: "min(90vw, 1000px, 82vh)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <h1 className={caveat.className} style={{ fontSize: "28px" }}>
          AirMime
        </h1>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          <span
            style={{
              fontSize: "12px",
              color: "rgba(244,241,234,0.6)",
              border: "1px solid rgba(255,255,255,0.15)",
              borderRadius: "8px",
              padding: "3px 8px",
              letterSpacing: "2px",
            }}
          >
            방 코드 {roomCode}
            {isHost && " 👑"}
          </span>
          <span
            style={{
              fontSize: "12px",
              color: playerCount >= 2 ? "#69DB7C" : "rgba(244,241,234,0.6)",
              display: "flex",
              alignItems: "center",
              gap: "4px",
            }}
          >
            👥 {playerCount}명 접속 중
          </span>
          <button
            onClick={() => setShowReportForm((prev) => !prev)}
            style={{
              fontSize: "12px",
              color: "rgba(244,241,234,0.6)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            신고
          </button>
          <button
            onClick={handleLeaveRoom}
            style={{
              fontSize: "12px",
              color: "rgba(244,241,234,0.6)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              textDecoration: "underline",
            }}
          >
            나가기
          </button>
        </div>
      </div>

      <div
        style={{
          width: "min(90vw, 1000px, 82vh)",
          marginBottom: "8px",
          fontSize: "12px",
          color: "rgba(244,241,234,0.55)",
          textAlign: "center",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "6px",
        }}
      >
        🔒 상대방에게 내 카메라 화면은 보이지 않아요 — 그린 그림만 공유돼요
      </div>

      {/* 연습 모드 / 제시어 설정 / 게임 진행 안내 */}
      <div
        style={{
          width: "min(90vw, 1000px, 82vh)",
          marginBottom: "8px",
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
            }}
          >
            <span
              style={{ fontSize: "13px", color: "#FFD43B", fontWeight: 600 }}
            >
              ✏️ 연습 중 (나만 보여요, 상대방에게 공유 안 됨)
            </span>
            <button
              onClick={handleClearPractice}
              style={{
                padding: "4px 10px",
                borderRadius: "12px",
                border: "1px solid rgba(255,255,255,0.2)",
                background: "transparent",
                color: "#F4F1EA",
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
                  background: "#69DB7C",
                  color: "#1B1A18",
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
                  color: "rgba(244,241,234,0.45)",
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
              padding: "10px 14px",
              borderRadius: "10px",
              border: "1px solid rgba(255,255,255,0.15)",
              width: "100%",
              maxWidth: "480px",
            }}
          >
            <span style={{ fontSize: "13px", fontWeight: 600 }}>
              제시어를 어떻게 정할까요?
            </span>
            <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", justifyContent: "center" }}>
              <button
                onClick={handleAutoPrompt}
                disabled={startingGame}
                style={{
                  padding: "6px 14px",
                  borderRadius: "12px",
                  border: "none",
                  background: "#4DABF7",
                  color: "#1B1A18",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: startingGame ? "default" : "pointer",
                  opacity: startingGame ? 0.6 : 1,
                }}
              >
                자동으로 받기
              </button>
              <span style={{ fontSize: "12px", color: "rgba(244,241,234,0.5)", alignSelf: "center" }}>
                또는
              </span>
              <input
                value={customPromptInput}
                onChange={(e) => setCustomPromptInput(e.target.value)}
                placeholder="직접 제시어 입력"
                style={{
                  padding: "6px 10px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "transparent",
                  color: "#F4F1EA",
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
                  background: "#69DB7C",
                  color: "#1B1A18",
                  fontWeight: 600,
                  fontSize: "13px",
                  cursor: startingGame ? "default" : "pointer",
                  opacity:
                    startingGame || !customPromptInput.trim() ? 0.6 : 1,
                }}
              >
                이 제시어로 시작
              </button>
            </div>
            <button
              onClick={() => setShowPromptSetup(false)}
              style={{
                fontSize: "12px",
                color: "rgba(244,241,234,0.5)",
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

        {!practiceMode && (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
              width: "100%",
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "14px",
              }}
            >
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color: timeLeft <= 10 ? "#FF6B6B" : "#F4F1EA",
                }}
              >
                ⏱ {timeLeft}초
              </span>
              <span style={{ fontSize: "13px", color: "#F4F1EA" }}>
                🏆 나 {scores[clientIdRef.current] || 0} : {" "}
                {Object.entries(scores)
                  .filter(([id]) => id !== clientIdRef.current)
                  .reduce((sum, [, v]) => sum + v, 0)}{" "}
                상대
              </span>
            </div>

            {roundStatus && (
              <span
                style={{
                  fontSize: "13px",
                  fontWeight: 700,
                  color:
                    roundStatus.winnerId === clientIdRef.current
                      ? "#69DB7C"
                      : roundStatus.winnerId
                      ? "#FF6B6B"
                      : "#FFD43B",
                }}
              >
                {roundStatus.winnerId === null
                  ? `⏰ 시간 초과! 정답은 "${gameData?.prompt ?? ""}" 였어요`
                  : roundStatus.winnerId === clientIdRef.current
                  ? "🎉 정답! 다음 라운드 준비 중..."
                  : "😢 상대방이 먼저 맞혔어요. 다음 라운드 준비 중..."}
              </span>
            )}

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
                  style={{
                    fontSize: "13px",
                    color: "#69DB7C",
                    fontWeight: 700,
                  }}
                >
                  🎨 당신이 그림꾼! 제시어: {gameData.prompt}
                </span>
              )}
              {gameData && !isDrawer && (
                <span
                  style={{
                    fontSize: "13px",
                    color: "#FFD43B",
                    fontWeight: 600,
                  }}
                >
                  🤔 상대방이 그리는 중이에요! 채팅에 정답을 입력해보세요
                </span>
              )}
              {!gameData && (
                <span
                  style={{ fontSize: "13px", color: "rgba(244,241,234,0.6)" }}
                >
                  🎮 게임 중
                </span>
              )}
              {isHost && (
                <button
                  onClick={handleBackToPractice}
                  style={{
                    padding: "4px 10px",
                    borderRadius: "12px",
                    border: "1px solid rgba(255,255,255,0.2)",
                    background: "transparent",
                    color: "#F4F1EA",
                    fontSize: "12px",
                    cursor: "pointer",
                  }}
                >
                  연습으로 돌아가기
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {showReportForm && (
        <div
          style={{
            width: "min(90vw, 1000px, 82vh)",
            marginBottom: "8px",
            padding: "10px 12px",
            borderRadius: "10px",
            border: "1px solid rgba(255,255,255,0.15)",
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
              border: "1px solid rgba(255,255,255,0.2)",
              background: "transparent",
              color: "#F4F1EA",
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
              color: "#1B1A18",
              fontWeight: 600,
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
              border: "1px solid rgba(255,255,255,0.2)",
              background: "transparent",
              color: "#F4F1EA",
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
            width: "min(90vw, 1000px, 82vh)",
            marginBottom: "8px",
            fontSize: "12px",
            color: "#69DB7C",
            textAlign: "center",
          }}
        >
          신고가 접수됐어요.
        </div>
      )}

      <div
        style={{
          position: "relative",
          width: "min(90vw, 1000px, 82vh)",
          aspectRatio: "16 / 9",
          borderRadius: "12px",
          overflow: "hidden",
          background: "#1B1A18",
          boxShadow: "0 0 0 1px rgba(255,255,255,0.08)",
          flexShrink: 0,
        }}
      >
        {/* 원본 비디오: 배경블러 켜져있거나 카메라 숨김이면 투명 처리 (계속 재생은 되어야 손/얼굴 인식이 작동함) */}
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            objectFit: "cover",
            transform: "scaleX(-1)",
            opacity: bgBlurOn || cameraHidden ? 0 : 1,
          }}
        />

        {/* 배경 전체 블러 레이어 */}
        <canvas
          ref={bgCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            transform: "scaleX(-1)",
            opacity: bgBlurOn && !cameraHidden ? 1 : 0,
          }}
        />

        {/* 얼굴 필터 레이어 */}
        <canvas
          ref={faceCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            transform: "scaleX(-1)",
            opacity: cameraHidden ? 0 : 1,
          }}
        />

        {/* 그림 레이어(공유): 게임 모드일 때만 보임 */}
        <canvas
          ref={drawCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: practiceMode ? 0 : 1,
          }}
        />

        {/* 연습 캔버스: 연습 모드일 때만 보임, 상대방에겐 절대 전송 안 됨 */}
        <canvas
          ref={practiceCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
            opacity: practiceMode ? 1 : 0,
          }}
        />

        {!ready && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(0,0,0,0.5)",
              fontSize: "14px",
            }}
          >
            카메라 준비 중...
          </div>
        )}
        {ready && showHint && (
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
            }}
          >
            스페이스바를 눌러 펜을 켜고, 검지로 그림을 그려보세요
            <br />
            숫자 1~9로 색상, 0으로 지우개
          </div>
        )}
      </div>

      <div
        style={{
          marginTop: "10px",
          display: "flex",
          gap: "6px",
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "center",
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
              width: "24px",
              height: "24px",
              borderRadius: "50%",
              background: c,
              border:
                !isEraser && color === c
                  ? "2px solid #fff"
                  : "2px solid transparent",
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
            padding: "4px 12px",
            borderRadius: "16px",
            border: isEraser
              ? "2px solid #fff"
              : "2px solid rgba(255,255,255,0.2)",
            background: "transparent",
            color: "#F4F1EA",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          지우개 (0)
        </button>
        <button
          onClick={handleClearAll}
          style={{
            padding: "4px 12px",
            borderRadius: "16px",
            border: "2px solid rgba(255,255,255,0.2)",
            background: "transparent",
            color: "#F4F1EA",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          전체 지우기
        </button>
      </div>

      <div
        style={{
          marginTop: "8px",
          display: "flex",
          gap: "6px",
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        {(
          [
            { key: "none", label: "필터 없음" },
            { key: "blur", label: "블러" },
            { key: "mosaic", label: "모자이크" },
            { key: "emoji", label: "이모지" },
          ] as { key: FilterMode; label: string }[]
        ).map((f) => (
          <button
            key={f.key}
            onClick={() => setFilterMode(f.key)}
            disabled={cameraHidden}
            style={{
              padding: "6px 14px",
              borderRadius: "16px",
              border:
                filterMode === f.key
                  ? "2px solid #fff"
                  : "2px solid rgba(255,255,255,0.2)",
              background: "transparent",
              color: "#F4F1EA",
              cursor: cameraHidden ? "default" : "pointer",
              fontSize: "13px",
              opacity: cameraHidden ? 0.4 : 1,
            }}
          >
            {f.label}
          </button>
        ))}

        {(filterMode === "blur" || bgBlurOn) && !cameraHidden && (
          <div style={{ display: "flex", gap: "6px", marginLeft: "4px" }}>
            {BLUR_LEVELS.map((level) => (
              <button
                key={level}
                onClick={() => setBlurStrength(level)}
                style={{
                  padding: "4px 10px",
                  borderRadius: "12px",
                  border:
                    blurStrength === level
                      ? "2px solid #fff"
                      : "2px solid rgba(255,255,255,0.15)",
                  background: "transparent",
                  color: "#F4F1EA",
                  fontSize: "12px",
                  cursor: "pointer",
                }}
              >
                {level}
              </button>
            ))}
          </div>
        )}

        {filterMode === "emoji" && !cameraHidden && (
          <div style={{ display: "flex", gap: "6px", marginLeft: "4px" }}>
            {EMOJIS.map((e) => (
              <button
                key={e}
                onClick={() => setSelectedEmoji(e)}
                style={{
                  width: "30px",
                  height: "30px",
                  borderRadius: "8px",
                  border:
                    selectedEmoji === e
                      ? "2px solid #fff"
                      : "2px solid rgba(255,255,255,0.15)",
                  background: "transparent",
                  fontSize: "16px",
                  cursor: "pointer",
                }}
              >
                {e}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 배경 블러 / 카메라 숨기기 토글 */}
      <div
        style={{
          marginTop: "8px",
          display: "flex",
          gap: "6px",
          alignItems: "center",
          flexWrap: "wrap",
          justifyContent: "center",
        }}
      >
        <button
          onClick={() => setBgBlurOn((prev) => !prev)}
          disabled={cameraHidden}
          style={{
            padding: "6px 14px",
            borderRadius: "16px",
            border:
              bgBlurOn && !cameraHidden
                ? "2px solid #fff"
                : "2px solid rgba(255,255,255,0.2)",
            background: "transparent",
            color: "#F4F1EA",
            cursor: cameraHidden ? "default" : "pointer",
            fontSize: "13px",
            opacity: cameraHidden ? 0.4 : 1,
          }}
        >
          {bgBlurOn ? "배경 블러 끄기" : "배경 블러 켜기"}
        </button>

        <button
          onClick={() => setCameraHidden((prev) => !prev)}
          style={{
            padding: "6px 14px",
            borderRadius: "16px",
            border: cameraHidden
              ? "2px solid #fff"
              : "2px solid rgba(255,255,255,0.2)",
            background: "transparent",
            color: "#F4F1EA",
            cursor: "pointer",
            fontSize: "13px",
          }}
        >
          {cameraHidden ? "카메라 보이기" : "카메라 숨기고 그림만 보기"}
        </button>
      </div>

      {!practiceMode && (
        <div
          style={{
            width: "min(90vw, 1000px, 82vh)",
            marginTop: "8px",
            display: "flex",
            flexDirection: "column",
            border: "1px solid rgba(255,255,255,0.15)",
            borderRadius: "10px",
            overflow: "hidden",
          }}
        >
          <div
            ref={chatListRef}
            style={{
              height: "70px",
              overflowY: "auto",
              padding: "6px 10px",
              display: "flex",
              flexDirection: "column",
              gap: "3px",
            }}
          >
            {chatMessages.length === 0 && (
              <span
                style={{
                  fontSize: "12px",
                  color: "rgba(244,241,234,0.4)",
                }}
              >
                여기에 정답을 입력해보세요
              </span>
            )}
            {chatMessages.map((m) => (
              <span
                key={m.id}
                style={{
                  fontSize: "12px",
                  color: m.correct
                    ? "#69DB7C"
                    : m.senderId === clientIdRef.current
                    ? "#F4F1EA"
                    : "rgba(244,241,234,0.7)",
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
              borderTop: "1px solid rgba(255,255,255,0.1)",
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
              placeholder={isDrawer ? "채팅 보내기" : "정답을 입력하세요"}
              style={{
                flex: 1,
                padding: "6px 10px",
                border: "none",
                background: "transparent",
                color: "#F4F1EA",
                fontSize: "12px",
                outline: "none",
              }}
            />
            <button
              onClick={handleSendChat}
              style={{
                padding: "6px 14px",
                border: "none",
                background: "rgba(255,255,255,0.08)",
                color: "#F4F1EA",
                fontSize: "12px",
                cursor: "pointer",
              }}
            >
              전송
            </button>
          </div>
        </div>
      )}

      <p
        style={{
          marginTop: "8px",
          fontSize: "12px",
          color: "rgba(244,241,234,0.6)",
        }}
      >
        스페이스바: 펜 {isPenDown ? "떼기" : "들기"} · 숫자 1~9: 색상 변경 ·
        0: 지우개
      </p>
    </main>
  );
}
