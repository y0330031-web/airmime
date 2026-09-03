"use client";

import { useEffect, useRef, useCallback } from "react";
import {
  SelfieSegmentation,
  Results as SelfieResults,
} from "@mediapipe/selfie_segmentation";

interface UseBackgroundBlurOptions {
  /** 원본 비디오(<video>) ref — 로컬 캠 or 상대방 캠 둘 다 사용 가능 */
  videoRef: React.RefObject<HTMLVideoElement>;
  /** 결과를 그릴 출력용 <canvas> ref (이게 실제로 화면에 보여줄 레이어) */
  outputCanvasRef: React.RefObject<HTMLCanvasElement>;
  /** 배경 블러 on/off */
  enabled: boolean;
  /** 블러 강도(px). 기본 12 */
  blurAmount?: number;
  /** 매 프레임마다 돌리면 무거우니 몇 프레임에 한 번 처리할지 (기본 1 = 매 프레임) */
  frameSkip?: number;
}

/**
 * 비디오에서 인물만 선명하게 남기고 배경을 블러 처리해서
 * outputCanvasRef에 그려주는 훅.
 *
 * 손 그림(MediaPipe Hands)과 동시에 돌리면 부하가 크므로
 * frameSkip을 2~3 정도로 주는 걸 추천합니다.
 */
export function useBackgroundBlur({
  videoRef,
  outputCanvasRef,
  enabled,
  blurAmount = 12,
  frameSkip = 1,
}: UseBackgroundBlurOptions) {
  const rafRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  const segmentationRef = useRef<SelfieSegmentation | null>(null);

  const onResults = useCallback(
    (results: SelfieResults) => {
      const canvas = outputCanvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;

      ctx.save();
      ctx.clearRect(0, 0, w, h);

      // 1) 마스크를 그린 뒤 source-in으로 "사람 부분만" 원본 이미지를 합성
      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(results.segmentationMask, 0, 0, w, h);
      ctx.globalCompositeOperation = "source-in";
      ctx.drawImage(results.image, 0, 0, w, h);

      // 2) destination-over로 사람 레이어 "뒤에" 블러된 전체 프레임을 깔아줌
      ctx.globalCompositeOperation = "destination-over";
      ctx.filter = `blur(${blurAmount}px)`;
      ctx.drawImage(results.image, 0, 0, w, h);

      ctx.restore();
    },
    [outputCanvasRef, blurAmount]
  );

  useEffect(() => {
    if (!enabled) return;

    let isActive = true;

    const selfieSegmentation = new SelfieSegmentation({
      locateFile: (file) =>
        `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
    });

    selfieSegmentation.setOptions({
      // 0 = general(정확도 우선), 1 = landscape(속도 우선, 화상통화에 적합)
      modelSelection: 1,
    });

    selfieSegmentation.onResults(onResults);
    segmentationRef.current = selfieSegmentation;

    const processFrame = async () => {
      if (!isActive) return;

      frameCountRef.current += 1;
      const video = videoRef.current;

      if (
        video &&
        video.readyState >= 2 &&
        frameCountRef.current % frameSkip === 0
      ) {
        try {
          await selfieSegmentation.send({ image: video });
        } catch (err) {
          // 모델 초기화 직후 첫 프레임에서 종종 발생, 무시하고 계속 진행
          console.warn("selfie segmentation frame skipped:", err);
        }
      }

      rafRef.current = requestAnimationFrame(processFrame);
    };

    processFrame();

    return () => {
      isActive = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      selfieSegmentation.close();
      segmentationRef.current = null;
    };
  }, [enabled, onResults, videoRef, frameSkip]);
}