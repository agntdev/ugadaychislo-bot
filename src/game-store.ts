import type { Ctx } from "./bot.js";
import type { DOStub, WorkerEnv } from "./toolkit/session/durable.js";

export interface Winner {
  user_id: number;
  username: string;
}

export interface GameRound {
  secret_number: number;
  started_by: number;
  active: boolean;
  start_time: number;
  end_time?: number;
  winner?: Winner;
}

export interface LeaderboardEntry extends Winner {
  win_count: number;
  last_win_time: number;
}

export type StartResult =
  | { kind: "started"; round: GameRound; restarted: boolean }
  | { kind: "already-active" }
  | { kind: "unavailable" };

export type GuessResult =
  | { kind: "no-game" }
  | { kind: "higher" }
  | { kind: "lower" }
  | { kind: "won"; winner: Winner }
  | { kind: "unavailable" };

type WorkerGameCtx = Ctx & { env?: WorkerEnv };

function gameStub(ctx: WorkerGameCtx): DOStub | undefined {
  const env = ctx.env;
  if (!env?.CHAT_DO || ctx.chat?.id === undefined) return undefined;
  return env.CHAT_DO.get(env.CHAT_DO.idFromName("chat:" + ctx.chat.id));
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
): Promise<StartResult> {
  const result = await request<StartResult>(ctx as WorkerGameCtx, "/game/start", {
    method: "POST",
    body: JSON.stringify({ startedBy, force }),
  });
  return result ?? { kind: "unavailable" };
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
