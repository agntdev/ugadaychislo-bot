import type { Ctx } from "./bot.js";
import type { DOStub, WorkerEnv } from "./toolkit/session/durable.js";

export interface Winner {
  user_id: number;
  username: string;
}

export interface GameRound {
  secret_number?: number;
  started_by: number;
  active: boolean;
  waiting_for_secret?: boolean;
  message_thread_id?: number;
  start_time: number;
  end_time?: number;
  winner?: Winner;
}

export interface LeaderboardEntry extends Winner {
  win_count: number;
  last_win_time: number;
}

export const SECRET_NUMBER_LIMITS = { min: 1, max: 1_000_000 } as const;

export type StartResult =
  | { kind: "waiting-for-secret"; round: GameRound; restarted: boolean }
  | { kind: "already-active" }
  | { kind: "unavailable" };

export type GuessResult =
  | { kind: "no-game" }
  | { kind: "waiting-for-secret" }
  | { kind: "higher" }
  | { kind: "lower" }
  | { kind: "won"; winner: Winner }
  | { kind: "unavailable" };

type WorkerGameCtx = Ctx & { env?: WorkerEnv };

function gameStub(ctx: WorkerGameCtx): DOStub | undefined {
  return gameStubForChat(ctx, ctx.chat?.id);
}

function gameStubForChat(ctx: WorkerGameCtx, chatId: number | undefined): DOStub | undefined {
  const env = ctx.env;
  if (!env?.CHAT_DO || chatId === undefined) return undefined;
  return env.CHAT_DO.get(env.CHAT_DO.idFromName("chat:" + chatId));
}

async function request<T>(
  ctx: WorkerGameCtx,
  path: string,
  init?: { method?: string; body?: string },
): Promise<T | undefined> {
  const stub = gameStub(ctx);
  if (!stub) return undefined;
  try {
    const response = await stub.fetch("https://do" + path, init);
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

async function requestForChat<T>(
  ctx: WorkerGameCtx,
  chatId: number,
  path: string,
  init?: { method?: string; body?: string },
): Promise<T | undefined> {
  const stub = gameStubForChat(ctx, chatId);
  if (!stub) return undefined;
  try {
    const response = await stub.fetch("https://do" + path, init);
    if (!response.ok) return undefined;
    return (await response.json()) as T;
  } catch {
    return undefined;
  }
}

export function displayName(user: { username?: string; first_name?: string; last_name?: string; id: number }): string {
  const username = user.username?.trim();
  if (username) return "@" + username;
  const name = [user.first_name, user.last_name].filter(Boolean).join(" ").trim();
  return name || "Игрок " + user.id;
}

export async function startRound(
  ctx: Ctx,
  startedBy: number,
  force: boolean,
  threadId?: number,
): Promise<StartResult> {
  const result = await request<StartResult>(ctx as WorkerGameCtx, "/game/start", {
    method: "POST",
    body: JSON.stringify({ startedBy, force, threadId }),
  });
  return result ?? { kind: "unavailable" };
}

export async function addPendingGame(ctx: Ctx, adminId: number, groupId: number): Promise<boolean> {
  const result = await requestForChat<{ ok: boolean }>(ctx as WorkerGameCtx, adminId, "/game/pending", {
    method: "POST",
    body: JSON.stringify({ groupId }),
  });
  return result?.ok ?? false;
}

export async function pendingGames(ctx: Ctx): Promise<number[] | undefined> {
  return request(ctx as WorkerGameCtx, "/game/pending");
}

export async function setSecretNumber(
  ctx: Ctx,
  groupId: number,
  adminId: number,
  secretNumber: number,
): Promise<{ kind: "started"; round: GameRound } | { kind: "not-waiting" } | undefined> {
  return requestForChat(ctx as WorkerGameCtx, groupId, "/game/secret", {
    method: "POST",
    body: JSON.stringify({ adminId, secretNumber }),
  });
}

export async function removePendingGame(ctx: Ctx, groupId: number): Promise<void> {
  await request(ctx as WorkerGameCtx, "/game/pending/remove", {
    method: "POST",
    body: JSON.stringify({ groupId }),
  });
}

export async function submitGuess(
  ctx: Ctx,
  user: Winner,
  value: number,
): Promise<GuessResult> {
  const result = await request<GuessResult>(ctx as WorkerGameCtx, "/game/guess", {
    method: "POST",
    body: JSON.stringify({ user, value }),
  });
  return result ?? { kind: "unavailable" };
}

export async function leaderboard(ctx: Ctx): Promise<LeaderboardEntry[] | undefined> {
  return request<LeaderboardEntry[]>(ctx as WorkerGameCtx, "/game/leaderboard");
}

export async function lastRound(ctx: Ctx): Promise<GameRound | null | undefined> {
  return request<GameRound | null>(ctx as WorkerGameCtx, "/game/last");
}

export async function recentRounds(ctx: Ctx): Promise<GameRound[] | undefined> {
  return request<GameRound[]>(ctx as WorkerGameCtx, "/game/history");
}

export async function hasActiveRound(ctx: Ctx): Promise<boolean | undefined> {
  return request<boolean>(ctx as WorkerGameCtx, "/game/active");
}
