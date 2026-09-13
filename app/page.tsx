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
      await set(ref(db, `rooms/${code}/meta`), { createdAt: Date.now() });
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
    const canvas = drawCanvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  useEffect(() => {
    if (view !== "room" || !roomCode) return;

    const strokesRef = ref(db, `rooms/${roomCode}/strokes`);
    const clearRef = ref(db, `rooms/${roomCode}/clearSignal`);

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

    return () => {
      off(strokesRef);
      off(clearRef);
    };
  }, [view, roomCode]);

  const sendSegment = useCallback((seg: StrokeSegment) => {
    const code = roomCodeRef.current;
    if (!code) return;
    push(ref(db, `rooms/${code}/strokes`), seg).catch((err) =>
      console.error("stroke sync failed:", err)
    );
  }, []);

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
      const canvas = drawCanvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      if (
        results.multiHandLandmarks &&
        results.multiHandLandmarks.length > 0
      ) {
        const landmarks = results.multiHandLandmarks[0];
        const indexTip = landmarks[8];

        const x = (1 - indexTip.x) * canvas.width;
        const y = indexTip.y * canvas.height;

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

            sendSegment({
              x1: lastPointRef.current.x / canvas.width,
              y1: lastPointRef.current.y / canvas.height,
              x2: x / canvas.width,
              y2: y / canvas.height,
              color: colorRef.current,
              eraser: isEraserRef.current,
            });
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
    const faceCanvas = faceCanvasRef.current;
    const bgCanvas = bgCanvasRef.current;
    const video = videoRef.current;
    if (!drawCanvas || !faceCanvas || !bgCanvas || !video) return;

    const resize = () => {
      const w = video.videoWidth || 1280;
      const h = video.videoHeight || 720;
      drawCanvas.width = w;
      drawCanvas.height = h;
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

        {/* 그림 레이어: 항상 보임 */}
        <canvas
          ref={drawCanvasRef}
          style={{
            position: "absolute",
            inset: 0,
            width: "100%",
            height: "100%",
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
