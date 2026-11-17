import http from 'node:http';
import path from 'node:path';
import express from 'express';
import { Server as SocketIOServer } from 'socket.io';
import { getDictionary } from './server/dictionary.ts';
import { RoomManager, sanitizeDifficulty, sanitizeTopic } from './server/rooms.ts';
import type {
  HintResult,
  RoomStatePayload,
  SubmitWordResult,
} from './shared/types.ts';

const PORT = Number(process.env.PORT) || 3000;
const IS_PROD = process.env.NODE_ENV === 'production';

// Simple sliding-window rate limiter per socket
class SocketRateLimiter {
  private readonly hits = new Map<string, number[]>();

  public allow(key: string, maxRequests: number, windowMs: number): boolean {
    const now = Date.now();
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length >= maxRequests) {
      this.hits.set(key, list);
      return false;
    }
    list.push(now);
    this.hits.set(key, list);
    return true;
  }

  public clearPrefix(socketId: string): void {
    for (const k of this.hits.keys()) {
      if (k.startsWith(socketId)) {
        this.hits.delete(k);
      }
    }
  }
}

async function startServer(): Promise<void> {
  // Warm up dictionary at startup so first room creation is instant
  const dict = getDictionary();
  console.log(`[dictionary] Loaded ${dict.entries.length} Russian common nouns`);

  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '32kb' }));

  const roomManager = new RoomManager();
  const rateLimiter = new SocketRateLimiter();

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      rooms: roomManager.getRoomCount(),
      words: dict.entries.length,
    });
  });

  const server = http.createServer(app);
  const io = new SocketIOServer(server, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
    pingInterval: 20_000,
    pingTimeout: 25_000,
  });

  io.on('connection', (socket) => {
    const safeCallback = <T>(cb: unknown, data: T): void => {
      if (typeof cb === 'function') {
        try {
          (cb as (payload: T) => void)(data);
        } catch {
          // ignore callback errors
        }
      }
    };

    socket.on(
      'room:create',
      (
        payload: {
          playerId?: string;
          nickname?: string;
          personalScore?: number;
          difficulty?: string;
          topic?: string;
        },
        cb?: unknown
      ) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:create`, 5, 10_000)) {
            safeCallback(cb, { ok: false, error: 'Слишком часто. Подождите немного' });
            return;
          }
          const state = roomManager.createRoom({
            socketId: socket.id,
            playerId: payload?.playerId ?? '',
            nickname: payload?.nickname ?? 'Игрок',
            personalScore: payload?.personalScore ?? 0,
            difficulty: sanitizeDifficulty(payload?.difficulty),
            topic: sanitizeTopic(payload?.topic),
          });
          socket.join(state.code);
          safeCallback(cb, { ok: true, state });
        } catch (err) {
          console.error('[room:create] error:', err);
          safeCallback(cb, {
            ok: false,
            error: 'Не удалось создать комнату. Попробуйте ещё раз',
          });
        }
      }
    );

    socket.on(
      'room:join',
      (
        payload: {
          code?: string;
          playerId?: string;
          nickname?: string;
          personalScore?: number;
        },
        cb?: unknown
      ) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:join`, 10, 10_000)) {
            safeCallback(cb, { ok: false, error: 'Слишком много попыток входа' });
            return;
          }
          const res = roomManager.joinRoom({
            code: payload?.code ?? '',
            socketId: socket.id,
            playerId: payload?.playerId ?? '',
            nickname: payload?.nickname ?? 'Игрок',
            personalScore: payload?.personalScore ?? 0,
          });
          if (!res.ok) {
            safeCallback(cb, res);
            return;
          }
          socket.join(res.state.code);
          socket.to(res.state.code).emit('room:state', res.state);
          safeCallback(cb, { ok: true, state: res.state });
        } catch (err) {
          console.error('[room:join] error:', err);
          safeCallback(cb, { ok: false, error: 'Ошибка входа в комнату' });
        }
      }
    );

    socket.on('room:leave', (cb?: unknown) => {
      try {
        const res = roomManager.leaveRoomBySocket(socket.id);
        if (res) {
          socket.leave(res.roomCode);
          if (res.state) {
            io.to(res.roomCode).emit('room:state', res.state);
          }
        }
        safeCallback(cb, { ok: true });
      } catch (err) {
        console.error('[room:leave] error:', err);
        safeCallback(cb, { ok: false });
      }
    });

    socket.on(
      'room:rename',
      (payload: { nickname?: string } | undefined, cb?: unknown) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:rename`, 8, 10_000)) {
            safeCallback(cb, { ok: false, error: 'Слишком частая смена имени' });
            return;
          }
          const res = roomManager.renamePlayer(socket.id, payload?.nickname);
          if (!res.ok) {
            safeCallback(cb, res);
            return;
          }
          io.to(res.roomCode).emit('room:state', res.state);
          safeCallback(cb, { ok: true, nickname: res.nickname, state: res.state });
        } catch (err) {
          console.error('[room:rename] error:', err);
          safeCallback(cb, { ok: false, error: 'Ошибка смены имени' });
        }
      }
    );

    socket.on(
      'game:submit_word',
      (payload: { word?: string }, cb?: unknown) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:word`, 30, 10_000)) {
            safeCallback(cb, {
              status: 'invalid',
              word: '',
              pointsEarned: 0,
              personalScore: 0,
              message: 'Слишком частая отправка',
            } satisfies SubmitWordResult);
            return;
          }

          const out = roomManager.submitWord(socket.id, payload?.word);
          if (out.roomCode && out.state) {
            io.to(out.roomCode).emit('room:state', out.state);
            if (out.eventNotice) {
              io.to(out.roomCode).emit('game:word_notice', out.eventNotice);
            }
          }
          safeCallback(cb, out.result);
        } catch (err) {
          console.error('[game:submit_word] error:', err);
          safeCallback(cb, {
            status: 'invalid',
            word: '',
            pointsEarned: 0,
            personalScore: 0,
            message: 'Ошибка проверки слова',
          } satisfies SubmitWordResult);
        }
      }
    );

    socket.on(
      'game:use_hint',
      (
        payload: { type?: 'lightbulb' | 'hammer'; row?: number; col?: number },
        cb?: unknown
      ) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:hint`, 10, 10_000)) {
            safeCallback(cb, {
              ok: false,
              error: 'Подождите секунду',
            } satisfies HintResult);
            return;
          }
          const out = roomManager.useHint(socket.id, {
            type: payload?.type ?? 'lightbulb',
            row: payload?.row,
            col: payload?.col,
          });
          if (out.roomCode && out.state) {
            io.to(out.roomCode).emit('room:state', out.state);
            if (out.notice) {
              io.to(out.roomCode).emit('game:hint_notice', {
                text: out.notice,
                cell: out.result.revealedCell,
                newlySolvedWords: out.result.newlySolvedWords ?? [],
              });
            }
          }
          safeCallback(cb, out.result);
        } catch (err) {
          console.error('[game:use_hint] error:', err);
          safeCallback(cb, {
            ok: false,
            error: 'Ошибка применения подсказки',
          } satisfies HintResult);
        }
      }
    );

    socket.on(
      'game:next_level',
      (
        payload: { difficulty?: string; topic?: string } | undefined,
        cb?: unknown
      ) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:next`, 4, 10_000)) {
            safeCallback(cb, { ok: false, error: 'Подождите немного' });
            return;
          }
          const res = roomManager.nextLevel(
            socket.id,
            payload?.difficulty,
            payload?.topic
          );
          if (!res.ok) {
            safeCallback(cb, res);
            return;
          }
          io.to(res.roomCode).emit('room:state', res.state);
          safeCallback(cb, { ok: true, state: res.state });
        } catch (err) {
          console.error('[game:next_level] error:', err);
          safeCallback(cb, {
            ok: false,
            error: 'Не удалось сгенерировать новый кроссворд',
          });
        }
      }
    );

    socket.on(
      'game:recreate_level',
      (
        payload: { difficulty?: string; topic?: string } | undefined,
        cb?: unknown
      ) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:recreate`, 6, 10_000)) {
            safeCallback(cb, { ok: false, error: 'Подождите немного' });
            return;
          }
          const res = roomManager.recreateLevel(
            socket.id,
            payload?.difficulty,
            payload?.topic
          );
          if (!res.ok) {
            safeCallback(cb, res);
            return;
          }
          io.to(res.roomCode).emit('room:state', res.state);
          safeCallback(cb, { ok: true, state: res.state });
        } catch (err) {
          console.error('[game:recreate_level] error:', err);
          safeCallback(cb, {
            ok: false,
            error: 'Не удалось пересоздать уровень',
          });
        }
      }
    );

    socket.on(
      'chat:send',
      (payload: { text?: string }, cb?: unknown) => {
        try {
          if (!rateLimiter.allow(`${socket.id}:chat`, 12, 10_000)) {
            safeCallback(cb, { ok: false, error: 'Слишком много сообщений' });
            return;
          }
          const res = roomManager.addChatMessage(socket.id, payload?.text);
          if (!res.ok) {
            safeCallback(cb, res);
            return;
          }
          io.to(res.roomCode).emit('chat:message', res.message);
          safeCallback(cb, { ok: true });
        } catch (err) {
          console.error('[chat:send] error:', err);
          safeCallback(cb, { ok: false, error: 'Ошибка отправки сообщения' });
        }
      }
    );

    socket.on('disconnect', () => {
      try {
        rateLimiter.clearPrefix(socket.id);
        const res = roomManager.handleSocketDisconnect(
          socket.id,
          (roomCode: string, stateAfterGrace: RoomStatePayload | null) => {
            if (stateAfterGrace) {
              io.to(roomCode).emit('room:state', stateAfterGrace);
            }
          }
        );
        if (res) {
          io.to(res.roomCode).emit('room:state', res.state);
        }
      } catch (err) {
        console.error('[disconnect] error:', err);
      }
    });
  });

  if (IS_PROD) {
    const distDir = path.resolve(process.cwd(), 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  } else {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: {
        middlewareMode: true,
        ws: { server },
      },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[server] Listening on http://0.0.0.0:${PORT} (${IS_PROD ? 'production' : 'dev'})`);
  });
}

startServer().catch((err) => {
  console.error('[server] Fatal startup error:', err);
  process.exit(1);
});
