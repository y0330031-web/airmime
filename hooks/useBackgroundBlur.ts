"use client";

import { useEffect, useRef, useCallback } from "react";

interface UseBackgroundBlurOptions {
  videoRef: React.RefObject<HTMLVideoElement>;
  outputCanvasRef: React.RefObject<HTMLCanvasElement>;
  enabled: boolean;
  blurAmount?: number;
  frameSkip?: number;
}

export function useBackgroundBlur({
  videoRef,
  outputCanvasRef,
  enabled,
  blurAmount = 12,
  frameSkip = 1,
}: UseBackgroundBlurOptions) {
  const rafRef = useRef<number | null>(null);
  const frameCountRef = useRef(0);
  const segmentationRef = useRef<any>(null);

  const onResults = useCallback(
    (results: any) => {
      const canvas = outputCanvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      const w = canvas.width;
      const h = canvas.height;

      ctx.save();
      ctx.clearRect(0, 0, w, h);

      ctx.filter = "none";
      ctx.globalCompositeOperation = "source-over";
      ctx.drawImage(results.segmentationMask, 0, 0, w, h);
      ctx.globalCompositeOperation = "source-in";
      ctx.drawImage(results.image, 0, 0, w, h);

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

    const setup = async () => {
      // 정적 import 대신 동적 import 사용 (Vercel 프로덕션 빌드 모듈 해석 오류 회피)
      const { SelfieSegmentation } = await import(
        "@mediapipe/selfie_segmentation"
      );

      if (!isActive) return;

      const selfieSegmentation = new SelfieSegmentation({
        locateFile: (file: string) =>
          `https://cdn.jsdelivr.net/npm/@mediapipe/selfie_segmentation/${file}`,
      });

      selfieSegmentation.setOptions({
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
            console.warn("selfie segmentation frame skipped:", err);
          }
        }

        rafRef.current = requestAnimationFrame(processFrame);
      };

      processFrame();
    };

    setup();

    return () => {
      isActive = false;
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      segmentationRef.current?.close?.();
      segmentationRef.current = null;
    };
  }, [enabled, onResults, videoRef, frameSkip]);
}