'use client';

import React, { useEffect, useRef, useState } from 'react';
import { Hands, Results } from '@mediapipe/hands';
import { FaceDetection, Results as FaceResults } from '@mediapipe/face_detection';
import { Camera } from '@mediapipe/camera_utils';

interface AirCanvasInnerProps {
  onClearRef?: (clearFn: () => void) => void;
}

// 숫자키 1~9 = 색상, 0 = 지우개
const COLOR_MAP: Record<string, { name: string; hex: string }> = {
  '1': { name: '빨강', hex: '#FF3B30' },
  '2': { name: '주황', hex: '#FF9500' },
  '3': { name: '노랑', hex: '#FFD60A' },
  '4': { name: '초록', hex: '#34C759' },
  '5': { name: '파랑', hex: '#007AFF' },
  '6': { name: '남색', hex: '#1E3A8A' },
  '7': { name: '보라', hex: '#AF52DE' },
  '8': { name: '흰색', hex: '#FFFFFF' },
  '9': { name: '검정', hex: '#111111' },
};

const ERASER_KEY = '0';
const DEFAULT_COLOR_KEY = '1';

// 얼굴 가리기 모드 (저작권 있는 캐릭터 대신 범용 이모지로 대체)
type FaceMode = 'off' | 'blur' | 'mosaic' | 'cat' | 'dog' | 'alien' | 'panda';

const FACE_MODES: { key: FaceMode; label: string }[] = [
  { key: 'off', label: '끔' },
  { key: 'blur', label: '블러' },
  { key: 'mosaic', label: '모자이크' },
  { key: 'cat', label: '🐱' },
  { key: 'dog', label: '🐶' },
  { key: 'panda', label: '🐼' },
  { key: 'alien', label: '👽' },
];

const EMOJI_MAP: Partial<Record<FaceMode, string>> = {
  cat: '🐱',
  dog: '🐶',
  panda: '🐼',
  alien: '👽',
};

export default function AirCanvasInner({ onClearRef }: AirCanvasInnerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null); // 그림(펜) 레이어 — 매 프레임 지우지 않음
  const faceCanvasRef = useRef<HTMLCanvasElement>(null); // 얼굴 마스크 레이어 — 매 프레임 새로 그림
  const mosaicBufferRef = useRef<HTMLCanvasElement | null>(null); // 모자이크용 임시 캔버스

  const [handDetected, setHandDetected] = useState(false);
  const [isPenDown, setIsPenDown] = useState(false);
  const isPenDownRef = useRef(false);
  const lastCoords = useRef<{ x: number; y: number } | null>(null);

  const [activeKey, setActiveKey] = useState<string>(DEFAULT_COLOR_KEY);
  const activeKeyRef = useRef<string>(DEFAULT_COLOR_KEY);

  const [faceMode, setFaceMode] = useState<FaceMode>('off');
  const faceModeRef = useRef<FaceMode>('off');

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  const togglePen = () => {
    setIsPenDown((prev) => {
      const next = !prev;
      isPenDownRef.current = next;
      if (next) lastCoords.current = null;
      return next;
    });
  };

  const selectTool = (key: string) => {
    if (key === ERASER_KEY || COLOR_MAP[key]) {
      activeKeyRef.current = key;
      setActiveKey(key);
    }
  };

  const cycleFaceMode = () => {
    setFaceMode((prev) => {
      const idx = FACE_MODES.findIndex((m) => m.key === prev);
      const next = FACE_MODES[(idx + 1) % FACE_MODES.length].key;
      faceModeRef.current = next;
      if (next === 'off') {
        const faceCanvasEl = faceCanvasRef.current;
        const ctx = faceCanvasEl?.getContext('2d');
        if (faceCanvasEl && ctx) ctx.clearRect(0, 0, faceCanvasEl.width, faceCanvasEl.height);
      }
      return next;
    });
  };

  const selectFaceMode = (mode: FaceMode) => {
    faceModeRef.current = mode;
    setFaceMode(mode);
    if (mode === 'off') {
      const faceCanvasEl = faceCanvasRef.current;
      const ctx = faceCanvasEl?.getContext('2d');
      if (faceCanvasEl && ctx) ctx.clearRect(0, 0, faceCanvasEl.width, faceCanvasEl.height);
    }
  };

  useEffect(() => {
    if (onClearRef) onClearRef(clearCanvas);

    const videoEl = videoRef.current;
    const canvasEl = canvasRef.current;
    const faceCanvasEl = faceCanvasRef.current;
    if (!videoEl || !canvasEl || !faceCanvasEl) return;

    let isClosed = false;

    const handleLoadedMetadata = () => {
      const w = videoEl.videoWidth || 640;
      const h = videoEl.videoHeight || 480;
      canvasEl.width = w;
      canvasEl.height = h;
      faceCanvasEl.width = w;
      faceCanvasEl.height = h;
    };
    videoEl.addEventListener('loadedmetadata', handleLoadedMetadata);

    // ---------------- 손 추적 (그리기) ----------------
    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.5,
      minTrackingConfidence: 0.5,
    });

    hands.onResults((results: Results) => {
      if (isClosed) return;

      const ctx = canvasEl.getContext('2d');
      if (!ctx) return;

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        setHandDetected(true);

        const landmarks = results.multiHandLandmarks[0];
        const indexTip = landmarks[8];

        const x = (1 - indexTip.x) * canvasEl.width;
        const y = indexTip.y * canvasEl.height;

        if (isPenDownRef.current) {
          const currentKey = activeKeyRef.current;
          const isEraser = currentKey === ERASER_KEY;

          ctx.globalCompositeOperation = isEraser ? 'destination-out' : 'source-over';
          ctx.strokeStyle = isEraser ? 'rgba(0,0,0,1)' : COLOR_MAP[currentKey]?.hex ?? COLOR_MAP[DEFAULT_COLOR_KEY].hex;
          ctx.lineWidth = isEraser ? 36 : 8;
          ctx.lineCap = 'round';
          ctx.lineJoin = 'round';

          if (lastCoords.current) {
            ctx.beginPath();
            ctx.moveTo(lastCoords.current.x, lastCoords.current.y);
            ctx.lineTo(x, y);
            ctx.stroke();
          }
          lastCoords.current = { x, y };
        } else {
          lastCoords.current = null;
        }
      } else {
        setHandDetected(false);
        lastCoords.current = null;
      }
    });

    // ---------------- 얼굴 인식 (가리기) ----------------
    const faceDetection = new FaceDetection({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_detection/${file}`,
    });

    faceDetection.setOptions({
      model: 'short',
      minDetectionConfidence: 0.5,
    });

    faceDetection.onResults((results: FaceResults) => {
      if (isClosed) return;

      const ctx = faceCanvasEl.getContext('2d');
      if (!ctx) return;

      ctx.clearRect(0, 0, faceCanvasEl.width, faceCanvasEl.height);

      const mode = faceModeRef.current;
      if (mode === 'off') return;
      if (!results.detections || results.detections.length === 0) return;

      results.detections.forEach((detection) => {
        const box = detection.boundingBox;
        if (!box) return;

        const boxWidth = box.width * faceCanvasEl.width;
        const boxHeight = box.height * faceCanvasEl.height;

        const pad = 1.35;
        const w = boxWidth * pad;
        const h = boxHeight * pad * 1.15;

        // 원본(미러링 안 된) 좌표계 기준 중심점
        const rawCenterX = box.xCenter * faceCanvasEl.width;
        const rawCenterY = box.yCenter * faceCanvasEl.height;
        const destX = rawCenterX - w / 2;
        const destY = rawCenterY - h / 2 - boxHeight * 0.1;

        // 캔버스 전체를 좌우 반전시켜서, video의 CSS 미러링과 위치·내용이 정확히 맞도록 함
        ctx.save();
        ctx.translate(faceCanvasEl.width, 0);
        ctx.scale(-1, 1);

        if (mode === 'blur') {
          ctx.filter = 'blur(18px)';
          ctx.drawImage(videoEl, destX, destY, w, h, destX, destY, w, h);
          ctx.filter = 'none';
        } else if (mode === 'mosaic') {
          const blockSize = 14; // 값이 클수록 픽셀이 굵어짐
          const smallW = Math.max(1, Math.floor(w / blockSize));
          const smallH = Math.max(1, Math.floor(h / blockSize));

          if (!mosaicBufferRef.current) {
            mosaicBufferRef.current = document.createElement('canvas');
          }
          const buffer = mosaicBufferRef.current;
          buffer.width = smallW;
          buffer.height = smallH;
          const bufferCtx = buffer.getContext('2d');
          if (bufferCtx) {
            // 작게 축소해서 그린 뒤
            bufferCtx.drawImage(videoEl, destX, destY, w, h, 0, 0, smallW, smallH);
            // 다시 원래 크기로 확대 (스무딩 끔 -> 픽셀 블록이 뚜렷하게 보임)
            ctx.imageSmoothingEnabled = false;
            ctx.drawImage(buffer, 0, 0, smallW, smallH, destX, destY, w, h);
            ctx.imageSmoothingEnabled = true;
          }
        } else {
          // 이모지 마스크 (범용 이모지, 특정 캐릭터 아님) — 배경 없이 이모지만 크게 표시
          const emoji = EMOJI_MAP[mode] ?? '🙈';

          ctx.font = `${Math.floor(h * 0.95)}px sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          // 텍스트 자체는 미러링 좌표계 안에서 다시 뒤집어 그려서 이모지가 좌우 반전 안 되게 함
          ctx.save();
          ctx.translate(destX + w / 2, destY + h / 2 - boxHeight * 0.05);
          ctx.scale(-1, 1);
          ctx.fillText(emoji, 0, 0);
          ctx.restore();
        }

        ctx.restore();
      });
    });

    // ---------------- 카메라 프레임 배급 ----------------
    const camera = new Camera(videoEl, {
      onFrame: async () => {
        if (isClosed || !videoEl) return;
        if (videoEl.readyState < 2) return;

        try {
          await hands.send({ image: videoEl });
          if (faceModeRef.current !== 'off') {
            await faceDetection.send({ image: videoEl });
          }
        } catch (error) {
          console.warn('MediaPipe send bypassed:', error);
        }
      },
      width: 640,
      height: 480,
    });

    camera.start().catch((err) => console.error('카메라 시작 실패:', err));

    const handleKeydown = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        togglePen();
        return;
      }
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        selectTool(e.key);
        return;
      }
      if (e.key.toLowerCase() === 'f') {
        e.preventDefault();
        cycleFaceMode();
      }
    };
    window.addEventListener('keydown', handleKeydown);

    return () => {
      isClosed = true;
      videoEl.removeEventListener('loadedmetadata', handleLoadedMetadata);
      window.removeEventListener('keydown', handleKeydown);
      camera.stop();
      hands.close();
      faceDetection.close();
    };
  }, [onClearRef]);

  const isEraserActive = activeKey === ERASER_KEY;

  return (
    <div className="relative w-full max-w-4xl aspect-video rounded-xl overflow-hidden bg-black/50" style={{ border: '1px solid #3A3733' }}>
      <video
        ref={videoRef}
        className="w-full h-full object-cover scale-x-[-1]"
        playsInline
        muted
        autoPlay
      />
      {/* 얼굴 마스크 레이어 */}
      <canvas
        ref={faceCanvasRef}
        className="absolute top-0 left-0 w-full h-full pointer-events-none"
      />
      {/* 손그림 레이어 (누적) */}
      <canvas
        ref={canvasRef}
        className="absolute top-0 left-0 w-full h-full pointer-events-none"
      />

      {/* 손 인식 상태 */}
      <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full text-white text-sm font-bold flex items-center gap-2">
        <span className={`w-3 h-3 rounded-full ${handDetected ? 'bg-green-400' : 'bg-gray-400'}`} />
        {handDetected ? '🖐️ 손 인식됨' : '🖐️ 손가락 탐색 중'}
      </div>

      {/* 현재 도구 표시 */}
      <div className="absolute top-4 right-4 bg-black/60 backdrop-blur-md px-3 py-2 rounded-full text-white text-xs font-bold flex items-center gap-2">
        {isEraserActive ? (
          <>🧹 지우개</>
        ) : (
          <>
            <span
              className="w-3 h-3 rounded-full border border-white/40"
              style={{ backgroundColor: COLOR_MAP[activeKey]?.hex }}
            />
            {COLOR_MAP[activeKey]?.name}
          </>
        )}
        <span className="text-white/50">[{activeKey}]</span>
      </div>

      {/* 얼굴 가리기 모드 선택 */}
      <div className="absolute top-16 right-4 flex flex-wrap justify-end gap-1 max-w-[160px]">
        {FACE_MODES.map((m) => (
          <button
            key={m.key}
            onClick={() => selectFaceMode(m.key)}
            className="px-2 py-1 rounded-full text-xs font-bold transition"
            style={{
              backgroundColor: faceMode === m.key ? '#E8483C' : 'rgba(0,0,0,0.6)',
              color: '#F6F4EF',
            }}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* 색상 팔레트 */}
      <div className="absolute bottom-16 left-1/2 -translate-x-1/2 flex items-center gap-1.5 bg-black/60 backdrop-blur-md px-3 py-2 rounded-full">
        {Object.entries(COLOR_MAP).map(([key, { hex }]) => (
          <button
            key={key}
            onClick={() => selectTool(key)}
            className="w-5 h-5 rounded-full transition"
            style={{
              backgroundColor: hex,
              border: activeKey === key ? '2px solid white' : '1px solid rgba(255,255,255,0.3)',
              transform: activeKey === key ? 'scale(1.2)' : 'scale(1)',
            }}
            aria-label={`${COLOR_MAP[key].name} (${key})`}
          />
        ))}
        <div className="w-px h-4 bg-white/30 mx-1" />
        <button
          onClick={() => selectTool(ERASER_KEY)}
          className="w-6 h-6 rounded-full flex items-center justify-center text-xs transition"
          style={{
            backgroundColor: isEraserActive ? '#F6F4EF' : 'transparent',
            border: '1px solid rgba(255,255,255,0.4)',
            transform: isEraserActive ? 'scale(1.15)' : 'scale(1)',
          }}
          aria-label="지우개 (0)"
        >
          🧹
        </button>
      </div>

      {/* 그리기 시작/멈춤 버튼 */}
      <button
        onClick={togglePen}
        className={`absolute bottom-4 left-1/2 -translate-x-1/2 px-6 py-3 rounded-full font-black text-sm shadow-lg transition ${
          isPenDown ? 'bg-red-500 text-white' : 'bg-white text-purple-950 hover:bg-yellow-300'
        }`}
      >
        {isPenDown ? '✏️ 그리는 중 (클릭해서 멈춤)' : '🖐️ 그리기 시작 (클릭)'}
      </button>

      {/* 단축키 안내 */}
      <div className="absolute bottom-4 right-4 bg-black/60 backdrop-blur-md px-3 py-2 rounded-lg text-white text-[11px] leading-relaxed">
        <p className="font-bold mb-0.5">단축키</p>
        <p><span className="font-mono">Space</span> 그리기 시작/멈춤</p>
        <p><span className="font-mono">1~9</span> 색상 변경 · <span className="font-mono">0</span> 지우개</p>
        <p><span className="font-mono">F</span> 얼굴 가리기 모드 순환</p>
      </div>
    </div>
  );
}