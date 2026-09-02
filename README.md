\'use client';

import React, { useEffect, useRef, useState } from 'react';
import { initializeApp, getApps, getApp } from 'firebase/app';
import { getDatabase, ref, set, onValue, update } from 'firebase/database';
import DailyIframe, { DailyCall } from '@daily-co/daily-js';
import { Hands, Results } from '@mediapipe/hands';
import { Camera } from '@mediapipe/camera_utils';
import confetti from 'canvas-confetti';
import { Clock, Trophy, Trash2, Video, Sparkles, UserCheck, Play, Send } from 'lucide-react';

// 1. Firebase 설정
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY || "demo-key",
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN || "demo.firebaseapp.com",
  databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL || "https://demo.firebaseio.com",
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || "demo",
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET || "demo.appspot.com",
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || "123456",
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID || "1:123456:web:123456",
};

const app = !getApps().length ? initializeApp(firebaseConfig) : getApp();
const db = getDatabase(app);

// 2. 제시어 데이터
const WORDS_DATABASE: Record<string, string[]> = {
  동물: ['강아지', '고양이', '코끼리', '기린', '펭귄', '호랑이', '토끼', '돌고래'],
  음식: ['피자', '햄버거', '초밥', '떡볶이', '아이스크림', '바나나', '라면'],
  사물: ['안경', '시계', '자전거', '비행기', '스마트폰', '우산', '선풍기'],
  행동: ['수영하기', '춤추기', '축구하기', '양치하기', '요리하기', '노래하기']
};

const getRandomWord = () => {
  const categories = Object.keys(WORDS_DATABASE);
  const randomCategory = categories[Math.floor(Math.random() * categories.length)];
  const words = WORDS_DATABASE[randomCategory];
  const randomWord = words[Math.floor(Math.random() * words.length)];
  return { category: randomCategory, word: randomWord };
};

// 3. MediaPipe 캔버스 컴포넌트
function AirCanvas({ onClearRef }: { onClearRef?: (clearFn: () => void) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const lastCoords = useRef<{ x: number; y: number } | null>(null);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d');
      ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  };

  useEffect(() => {
    if (onClearRef) onClearRef(clearCanvas);

    const hands = new Hands({
      locateFile: (file) => `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`,
    });

    hands.setOptions({
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.7,
      minTrackingConfidence: 0.7,
    });

    hands.onResults((results: Results) => {
      const canvas = canvasRef.current;
      if (!canvas) return;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = videoRef.current?.videoWidth || 640;
      canvas.height = videoRef.current?.videoHeight || 480;

      if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];
        const thumbTip = landmarks[4];
        const indexTip = landmarks[8];

        const distance = Math.hypot(thumbTip.x - indexTip.x, thumbTip.y - indexTip.y);
        const x = (1 - indexTip.x) * canvas.width;
        const y = indexTip.y * canvas.height;

        if (distance < 0.06) {
          setIsDrawing(true);
          ctx.strokeStyle = '#FF3B30';
          ctx.lineWidth = 8;
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
          setIsDrawing(false);
          lastCoords.current = null;
        }
      } else {
        setIsDrawing(false);
        lastCoords.current = null;
      }
    });

    if (videoRef.current) {
      const camera = new Camera(videoRef.current, {
        onFrame: async () => {
          if (videoRef.current) {
            await hands.send({ image: videoRef.current });
          }
        },
        width: 640,
        height: 480,
      });
      camera.start();
    }
  }, []);

  return (
    <div className="relative w-full max-w-2xl aspect-video rounded-3xl overflow-hidden shadow-2xl border-4 border-yellow-300 bg-black/50">
      <video ref={videoRef} className="w-full h-full object-cover scale-x-[-1]" playsInline muted />
      <canvas ref={canvasRef} className="absolute top-0 left-0 w-full h-full pointer-events-none" />
      <div className="absolute top-4 left-4 bg-black/60 backdrop-blur-md px-4 py-2 rounded-full text-white text-sm font-bold flex items-center gap-2">
        <span className={`w-3 h-3 rounded-full ${isDrawing ? 'bg-green-400 animate-pulse' : 'bg-gray-400'}`} />
        {isDrawing ? '✏️ 그리는 중 (Pinch)' : '🖐️ 손가락 탐색 중'}
      </div>
    </div>
  );
}

// 4. 메인 게임 앱
export default function AirDrawingApp() {
  const [roomCode, setRoomCode] = useState('');
  const [joinedRoom, setJoinedRoom] = useState<string | null>(null);
  const [myRole, setMyRole] = useState<'drawer' | 'guesser'>('drawer');
  const [roomData, setRoomData] = useState<any>(null);
  const [guessInput, setGuessInput] = useState('');

  const videoContainerRef = useRef<HTMLDivElement>(null);
  const clearCanvasRef = useRef<(() => void) | null>(null);

  const handleCreateRoom = () => {
    const code = Math.floor(1000 + Math.random() * 9000).toString();
    const { category, word } = getRandomWord();

    const initialRoomData = {
      roomId: code,
      status: 'waiting',
      currentWord: word,
      category: category,
      timer: 60,
      score: 0,
      wrongAnswers: [],
    };

    set(ref(db, `rooms/${code}`), initialRoomData);
    setRoomCode(code);
    setJoinedRoom(code);
    setMyRole('drawer');
  };

  const handleJoinRoom = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCode.length !== 4) return alert('4자리 코드명을 입력해주세요.');
    setJoinedRoom(roomCode);
    setMyRole('guesser');
  };

  useEffect(() => {
    if (!joinedRoom) return;

    const roomRef = ref(db, `rooms/${joinedRoom}`);
    const unsubscribe = onValue(roomRef, (snapshot) => {
      const data = snapshot.val();
      if (data) setRoomData(data);
    });

    return () => unsubscribe();
  }, [joinedRoom]);

  const handleStartGame = () => {
    const { category, word } = getRandomWord();
    update(ref(db, `rooms/${joinedRoom}`), {
      status: 'playing',
      timer: 60,
      currentWord: word,
      category: category,
      wrongAnswers: [],
    });
  };

  const handleNextTurn = () => {
    setMyRole(myRole === 'drawer' ? 'guesser' : 'drawer');
    const { category, word } = getRandomWord();

    update(ref(db, `rooms/${joinedRoom}`), {
      status: 'playing',
      timer: 60,
      currentWord: word,
      category: category,
      wrongAnswers: [],
    });
    if (clearCanvasRef.current) clearCanvasRef.current();
  };

  const handleGuessSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!guessInput.trim() || !roomData) return;

    if (guessInput.trim() === roomData.currentWord) {
      confetti({ particleCount: 100, spread: 70, origin: { y: 0.6 } });
      update(ref(db, `rooms/${joinedRoom}`), {
        status: 'round_end',
        score: (roomData.score || 0) + 10,
      });
    } else {
      const updatedWrong = [...(roomData.wrongAnswers || []), guessInput.trim()];
      update(ref(db, `rooms/${joinedRoom}`), { wrongAnswers: updatedWrong });
    }
    setGuessInput('');
  };

  if (!joinedRoom) {
    return (
      <main className="min-h-screen bg-gradient-to-br from-indigo-500 via-purple-500 to-pink-500 flex items-center justify-center p-4">
        <div className="bg-white/20 backdrop-blur-xl p-8 rounded-3xl border border-white/30 shadow-2xl max-w-md w-full text-white text-center">
          <div className="flex justify-center mb-4">
            <Sparkles className="w-16 h-16 text-yellow-300 animate-bounce" />
          </div>
          <h1 className="text-3xl font-black mb-2">허공 그림 맞추기 🎨</h1>
          <p className="text-sm font-medium text-white/80 mb-8">
            카메라 앞에서 손가락 핀치 제스처로 허공에 그림을 그려보세요!
          </p>

          <button
            onClick={handleCreateRoom}
            className="w-full bg-yellow-400 hover:bg-yellow-300 text-purple-950 font-black py-4 rounded-2xl mb-6 shadow-lg transition flex items-center justify-center gap-2 text-lg"
          >
            <Play className="w-5 h-5 fill-current" /> 방 만들기 (그리는 사람)
          </button>

          <form onSubmit={handleJoinRoom} className="flex flex-col gap-3">
            <input
              type="text"
              maxLength={4}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value)}
              placeholder="4자리 코드 입력 (예: 1234)"
              className="w-full text-center tracking-widest text-xl font-bold px-4 py-3 rounded-2xl bg-white/20 border border-white/30 text-white placeholder-white/50 focus:outline-none focus:ring-2 focus:ring-yellow-300"
            />
            <button
              type="submit"
              className="w-full bg-white/20 hover:bg-white/30 font-bold py-3 rounded-2xl border border-white/30 transition flex items-center justify-center gap-2"
            >
              <UserCheck className="w-5 h-5" /> 방 참가하기 (맞히는 사람)
            </button>
          </form>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-gradient-to-br from-indigo-600 via-purple-600 to-pink-600 p-4 md:p-8 text-white font-sans">
      <header className="max-w-5xl mx-auto bg-white/20 backdrop-blur-md rounded-2xl p-4 flex flex-wrap justify-between items-center gap-4 mb-6 border border-white/30 shadow-lg">
        <div className="flex items-center gap-3">
          <span className="bg-yellow-400 text-purple-950 font-black px-4 py-1.5 rounded-full text-sm shadow">
            CODE: {joinedRoom}
          </span>
          <h1 className="text-xl font-black">허공 그림 맞추기 🎨</h1>
        </div>
        <div className="flex items-center gap-4 font-bold">
          <div className="flex items-center gap-1.5 bg-red-500/80 px-4 py-1.5 rounded-xl shadow">
            <Clock className="w-5 h-5" />
            <span>{roomData?.timer ?? 60}초</span>
          </div>
          <div className="flex items-center gap-1.5 bg-yellow-400 text-purple-950 px-4 py-1.5 rounded-xl shadow">
            <Trophy className="w-5 h-5" />
            <span>{roomData?.score ?? 0}점</span>
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 flex flex-col items-center gap-4">
          {myRole === 'drawer' ? (
            <div className="w-full flex flex-col items-center gap-3">
              <AirCanvas onClearRef={(fn) => (clearCanvasRef.current = fn)} />
              <button
                onClick={() => clearCanvasRef.current?.()}
                className="flex items-center gap-2 bg-red-500 hover:bg-red-600 text-white font-bold px-5 py-2.5 rounded-xl transition shadow-lg"
              >
                <Trash2 className="w-5 h-5" /> 캔버스 지우기
              </button>
            </div>
          ) : (
            <div className="w-full max-w-2xl aspect-video rounded-3xl overflow-hidden shadow-2xl border-4 border-white/40 bg-black/40 relative flex items-center justify-center">
              <p className="text-white/60 font-bold">비디오 수신 화면</p>
            </div>
          )}
        </div>

        <div className="flex flex-col gap-4">
          {roomData?.status === 'waiting' && (
            <div className="bg-white/10 backdrop-blur-md p-6 rounded-3xl border border-white/20 text-center shadow-xl">
              <p className="mb-4 font-bold text-lg">상대방이 입장하면 시작버튼을 누르세요!</p>
              <button
                onClick={handleStartGame}
                className="w-full bg-yellow-400 hover:bg-yellow-300 text-purple-950 font-black py-4 rounded-2xl shadow-lg transition text-lg"
              >
                🎮 게임 시작하기
              </button>
            </div>
          )}

          {myRole === 'drawer' && roomData?.status === 'playing' && (
            <div className="bg-gradient-to-br from-amber-300 to-yellow-400 text-purple-950 p-6 rounded-3xl shadow-xl text-center border-4 border-white">
              <span className="text-xs font-black uppercase tracking-wider bg-purple-900 text-yellow-300 px-3 py-1 rounded-full">
                카테고리: {roomData.category}
              </span>
              <h2 className="text-4xl font-black mt-3 animate-pulse">{roomData.currentWord}</h2>
              <p className="text-xs font-semibold mt-2 text-purple-900/80">
                손가락 엄지+검지를 붙여(Pinch) 그림을 그려주세요!
              </p>
            </div>
          )}

          {myRole === 'guesser' && roomData?.status === 'playing' && (
            <div className="bg-white/10 backdrop-blur-md p-6 rounded-3xl border border-white/20 shadow-xl">
              <form onSubmit={handleGuessSubmit} className="flex gap-2 mb-4">
                <input
                  type="text"
                  value={guessInput}
                  onChange={(e) => setGuessInput(e.target.value)}
                  placeholder="정답을 입력하세요!"
                  className="flex-1 px-4 py-3 rounded-2xl bg-white/20 border border-white/30 text-white placeholder-white/60 focus:outline-none focus:ring-2 focus:ring-yellow-300 font-bold"
                />
                <button
                  type="submit"
                  className="bg-yellow-400 hover:bg-yellow-300 text-purple-950 font-black px-5 py-3 rounded-2xl transition shadow-md flex items-center gap-1"
                >
                  <Send className="w-5 h-5" />
                </button>
              </form>

              <div>
                <p className="text-xs font-bold text-white/70 mb-2">오답 기록</p>
                <div className="flex flex-wrap gap-2 max-h-32 overflow-y-auto">
                  {roomData?.wrongAnswers?.map((ans: string, idx: number) => (
                    <span key={idx} className="bg-red-500/40 text-red-100 px-3 py-1 rounded-xl text-xs font-bold border border-red-400/30">
                      {ans}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          )}

          {roomData?.status === 'round_end' && (
            <div className="bg-white/20 backdrop-blur-md p-6 rounded-3xl border border-white/30 text-center shadow-xl">
              <h3 className="text-2xl font-black text-yellow-300 mb-1">🎉 정답입니다!</h3>
              <p className="text-sm font-semibold mb-4">정답: {roomData.currentWord}</p>
              <button
                onClick={handleNextTurn}
                className="w-full bg-yellow-400 hover:bg-yellow-300 text-purple-950 font-black py-3 rounded-2xl shadow-lg transition"
              >
                🔄 턴 교대 및 다음 라운드
              </button>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
