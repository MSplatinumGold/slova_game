import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import type {
  ChatMessage,
  Difficulty,
  HintResult,
  RoomStatePayload,
  SubmitWordResult,
  WordTopic,
} from '../shared/types';
import { Backdrop } from './components/Backdrop';
import { GameRoom } from './components/GameRoom';
import { LobbyScreen } from './components/LobbyScreen';
import { getSocket } from './utils/socket';
import { soundEngine } from './utils/sound';
import {
  getOrCreatePlayerId,
  getSavedNickname,
  getSavedPersonalScore,
  getSavedSoundEnabled,
  saveNickname,
  savePersonalScore,
  saveSoundEnabled,
} from './utils/storage';

function parseRoomCodeFromUrl(): string | null {
  const match = window.location.pathname.match(/^\/room\/([A-Za-z0-9]{4})\/?$/);
  return match ? match[1].toUpperCase() : null;
}

export default function App() {
  const [playerId] = useState<string>(() => getOrCreatePlayerId());
  const [nickname, setNickname] = useState<string>(() => getSavedNickname());
  const [personalScore, setPersonalScore] = useState<number>(() =>
    getSavedPersonalScore()
  );
  const [soundEnabled, setSoundEnabled] = useState<boolean>(() => {
    const val = getSavedSoundEnabled();
    soundEngine.setEnabled(val);
    return val;
  });

  const [pendingInviteCode, setPendingInviteCode] = useState<string | null>(() =>
    parseRoomCodeFromUrl()
  );
  const [lobbyTopic, setLobbyTopic] = useState<WordTopic>('all');
  const [room, setRoom] = useState<RoomStatePayload | null>(null);
  const [connected, setConnected] = useState<boolean>(false);
  const [showWakeupBanner, setShowWakeupBanner] = useState<boolean>(false);
  const [busy, setBusy] = useState<boolean>(false);
  const [lobbyError, setLobbyError] = useState<string | null>(null);
  const [gridNotice, setGridNotice] = useState<string | null>(null);
  const [toastMessages, setToastMessages] = useState<ChatMessage[]>([]);

  const roomRef = useRef<RoomStatePayload | null>(null);
  roomRef.current = room;
  const nicknameRef = useRef(nickname);
  nicknameRef.current = nickname;
  const personalScoreRef = useRef(personalScore);
  personalScoreRef.current = personalScore;
  const prevRoundCompleteRef = useRef<boolean>(false);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const syncScoreFromRoom = useCallback(
    (state: RoomStatePayload) => {
      const me = state.players.find((p) => p.playerId === playerId);
      if (me && Number.isFinite(me.personalScore)) {
        setPersonalScore(me.personalScore);
        savePersonalScore(me.personalScore);
      }
    },
    [playerId]
  );

  const showTempGridNotice = useCallback((text: string) => {
    if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
    setGridNotice(text);
    noticeTimerRef.current = setTimeout(() => setGridNotice(null), 2600);
  }, []);

  const joinRoomByCode = useCallback(
    (code: string, nickOverride?: string) => {
      const socket = getSocket();
      const nick = (nickOverride ?? nicknameRef.current).trim();
      if (!nick) return;

      setBusy(true);
      setLobbyError(null);

      socket.emit(
        'room:join',
        {
          code: code.toUpperCase(),
          playerId,
          nickname: nick,
          personalScore: personalScoreRef.current,
        },
        (res: { ok: boolean; state?: RoomStatePayload; error?: string; code?: string }) => {
          setBusy(false);
          if (res?.ok && res.state) {
            setRoom(res.state);
            setPendingInviteCode(null);
            syncScoreFromRoom(res.state);
            prevRoundCompleteRef.current = res.state.roundComplete;
            if (window.location.pathname !== `/room/${res.state.code}`) {
              window.history.replaceState(null, '', `/room/${res.state.code}`);
            }
          } else {
            setRoom(null);
            setPendingInviteCode(null);
            window.history.replaceState(null, '', '/');
            setLobbyError(
              res?.error ?? 'Комната не найдена или сервер был перезагружен'
            );
          }
        }
      );
    },
    [playerId, syncScoreFromRoom]
  );

  // Socket lifecycle & Render cold-start wakeup indicator
  useEffect(() => {
    const socket = getSocket();
    let wakeupTimer: ReturnType<typeof setTimeout> | null = null;

    const scheduleWakeupBanner = () => {
      if (wakeupTimer) clearTimeout(wakeupTimer);
      wakeupTimer = setTimeout(() => {
        if (!socket.connected) {
          setShowWakeupBanner(true);
        }
      }, 900);
    };

    if (!socket.connected) {
      scheduleWakeupBanner();
    } else {
      setConnected(true);
    }

    const onConnect = () => {
      if (wakeupTimer) clearTimeout(wakeupTimer);
      setConnected(true);
      setShowWakeupBanner(false);

      // Rejoin active room or URL invite room if nickname is set
      const activeCode = roomRef.current?.code ?? parseRoomCodeFromUrl();
      if (activeCode && nicknameRef.current.trim().length > 0) {
        joinRoomByCode(activeCode);
      }
    };

    const onDisconnect = () => {
      setConnected(false);
      scheduleWakeupBanner();
    };

    const onRoomState = (nextState: RoomStatePayload) => {
      setRoom(nextState);
      syncScoreFromRoom(nextState);
      if (nextState.roundComplete && !prevRoundCompleteRef.current) {
        soundEngine.playVictory();
      }
      prevRoundCompleteRef.current = nextState.roundComplete;
    };

    const onWordNotice = (payload: {
      word: string;
      nickname: string;
      points: number;
      isBonus: boolean;
    }) => {
      if (payload.isBonus) {
        showTempGridNotice(`${payload.nickname}: бонус ${payload.word} +${payload.points}`);
      } else {
        showTempGridNotice(`${payload.nickname} открыл(а): ${payload.word}`);
      }
    };

    const onHintNotice = (payload: { text: string }) => {
      showTempGridNotice(payload.text);
    };

    const onChatMessage = (msg: ChatMessage) => {
      setRoom((prev) => {
        if (!prev) return prev;
        if (prev.messages.some((m) => m.id === msg.id)) return prev;
        return {
          ...prev,
          messages: [...prev.messages.slice(-79), msg],
        };
      });

      if (!msg.isSystem && msg.playerId !== playerId) {
        setToastMessages((prev) => [...prev.slice(-1), msg]);
        setTimeout(() => {
          setToastMessages((prev) => prev.filter((m) => m.id !== msg.id));
        }, 4000);
      }
    };

    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    socket.on('room:state', onRoomState);
    socket.on('game:word_notice', onWordNotice);
    socket.on('game:hint_notice', onHintNotice);
    socket.on('chat:message', onChatMessage);

    return () => {
      if (wakeupTimer) clearTimeout(wakeupTimer);
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
      socket.off('room:state', onRoomState);
      socket.off('game:word_notice', onWordNotice);
      socket.off('game:hint_notice', onHintNotice);
      socket.off('chat:message', onChatMessage);
    };
  }, [joinRoomByCode, playerId, showTempGridNotice, syncScoreFromRoom]);

  const handleChangeNickname = (val: string) => {
    setNickname(val);
    saveNickname(val);
  };

  const handleToggleSound = () => {
    setSoundEnabled((prev) => {
      const next = !prev;
      soundEngine.setEnabled(next);
      saveSoundEnabled(next);
      return next;
    });
  };

  const handleCreateRoom = (difficulty: Difficulty, topic: WordTopic) => {
    const cleanNick = nickname.trim();
    if (!cleanNick) return;
    const socket = getSocket();
    setBusy(true);
    setLobbyError(null);

    socket.emit(
      'room:create',
      {
        playerId,
        nickname: cleanNick,
        personalScore,
        difficulty,
        topic,
      },
      (res: { ok: boolean; state?: RoomStatePayload; error?: string }) => {
        setBusy(false);
        if (res?.ok && res.state) {
          setRoom(res.state);
          setPendingInviteCode(null);
          prevRoundCompleteRef.current = res.state.roundComplete;
          window.history.replaceState(null, '', `/room/${res.state.code}`);
        } else {
          setLobbyError(res?.error ?? 'Не удалось создать комнату');
        }
      }
    );
  };

  const handleRenameNickname = (newNickname: string) => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const socket = getSocket();
      socket.emit(
        'room:rename',
        { nickname: newNickname },
        (res: {
          ok: boolean;
          nickname?: string;
          state?: RoomStatePayload;
          error?: string;
        } | undefined) => {
          if (res?.ok && res.state) {
            setRoom(res.state);
            if (res.nickname) {
              setNickname(res.nickname);
              saveNickname(res.nickname);
            }
          }
          resolve({ ok: Boolean(res?.ok), error: res?.error });
        }
      );
    });
  };

  const handleLeaveRoom = () => {
    const socket = getSocket();
    socket.emit('room:leave', () => {
      setRoom(null);
      setPendingInviteCode(null);
      setToastMessages([]);
      setGridNotice(null);
      window.history.replaceState(null, '', '/');
    });
  };

  const handleSubmitWord = (word: string) => {
    return new Promise<{
      ok: boolean;
      status: string;
      message?: string;
      pointsEarned?: number;
    }>((resolve) => {
      const socket = getSocket();
      socket.emit(
        'game:submit_word',
        { word },
        (res: SubmitWordResult | undefined) => {
          if (!res) {
            resolve({ ok: false, status: 'invalid', message: 'Нет ответа сервера' });
            return;
          }
          if (Number.isFinite(res.personalScore) && res.personalScore >= 0) {
            setPersonalScore(res.personalScore);
            savePersonalScore(res.personalScore);
          }
          resolve({
            ok: res.status === 'solved' || res.status === 'bonus',
            status: res.status,
            message: res.message,
            pointsEarned: res.pointsEarned,
          });
        }
      );
    });
  };

  const handleUseHint = (
    type: 'lightbulb' | 'hammer',
    row?: number,
    col?: number
  ) => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const socket = getSocket();
      socket.emit(
        'game:use_hint',
        { type, row, col },
        (res: HintResult | undefined) => {
          if (!res) {
            resolve({ ok: false, error: 'Нет ответа сервера' });
            return;
          }
          if (typeof res.personalScore === 'number') {
            setPersonalScore(res.personalScore);
            savePersonalScore(res.personalScore);
          }
          resolve({ ok: res.ok, error: res.error });
        }
      );
    });
  };

  const handleNextLevel = (difficulty: Difficulty, topic: WordTopic) => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const socket = getSocket();
      socket.emit(
        'game:next_level',
        { difficulty, topic },
        (res: { ok: boolean; error?: string } | undefined) => {
          resolve(res ?? { ok: false, error: 'Нет ответа сервера' });
        }
      );
    });
  };

  const handleRecreateLevel = (difficulty: Difficulty, topic: WordTopic) => {
    return new Promise<{ ok: boolean; error?: string }>((resolve) => {
      const socket = getSocket();
      socket.emit(
        'game:recreate_level',
        { difficulty, topic },
        (res: { ok: boolean; error?: string } | undefined) => {
          resolve(res ?? { ok: false, error: 'Нет ответа сервера' });
        }
      );
    });
  };

  const handleSendChat = (text: string) => {
    const socket = getSocket();
    socket.emit('chat:send', { text });
  };

  return (
    <div className="relative min-h-dvh w-full text-slate-50">
      <Backdrop topic={room ? room.topic : lobbyTopic} />

      {room ? (
        <GameRoom
          room={room}
          playerId={playerId}
          personalScore={personalScore}
          soundEnabled={soundEnabled}
          onToggleSound={handleToggleSound}
          onLeaveRoom={handleLeaveRoom}
          onRenameNickname={handleRenameNickname}
          onSubmitWord={handleSubmitWord}
          onUseHint={handleUseHint}
          onNextLevel={handleNextLevel}
          onRecreateLevel={handleRecreateLevel}
          onSendChat={handleSendChat}
          incomingToastMessages={toastMessages}
          gridNotice={gridNotice}
        />
      ) : (
        <LobbyScreen
          nickname={nickname}
          onChangeNickname={handleChangeNickname}
          personalScore={personalScore}
          soundEnabled={soundEnabled}
          onToggleSound={handleToggleSound}
          pendingInviteCode={pendingInviteCode}
          onClearInviteCode={() => {
            setPendingInviteCode(null);
            window.history.replaceState(null, '', '/');
          }}
          topic={lobbyTopic}
          onChangeTopic={setLobbyTopic}
          onCreateRoom={handleCreateRoom}
          onJoinRoom={(code) => joinRoomByCode(code)}
          busy={busy}
          errorMsg={lobbyError}
        />
      )}

      {/* Render Cold-Start / Reconnecting Friendly Loading Overlay */}
      {!connected && showWakeupBanner && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/75 p-6 backdrop-blur-md"
        >
          <div className="w-full max-w-sm rounded-3xl border border-white/15 bg-slate-900/95 p-6 text-center shadow-2xl">
            <Loader2 className="mx-auto h-9 w-9 animate-spin text-amber-300" />
            <h2 className="mt-4 font-display text-lg font-bold text-white">
              Подключение к серверу...
            </h2>
            <p className="mt-2 text-sm leading-relaxed text-slate-300">
              Сервер может просыпаться до 40 секунд. Пожалуйста, не закрывайте
              страницу.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
