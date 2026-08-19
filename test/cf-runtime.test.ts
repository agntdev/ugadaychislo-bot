import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { Composer } from "grammy";
import { buildBot, type Ctx } from "../src/bot.js";
import { runSpecs, parseBotSpec } from "../src/toolkit/index.js";
import { ChatDO, type DOState, type WorkerEnv } from "../src/toolkit/session/durable.js";
import startGame from "../src/handlers/startgame.js";

// The Workers entry (src/worker.ts) builds the bot from a BUILD-TIME handler
// manifest instead of scanning the filesystem. Prove the option is honored:
// an injected handler answers, and the disk handlers (e.g. /start) are absent.
describe("buildBot({ handlers }) — the Workers manifest path", () => {
  it("uses the injected manifest and does NOT scan src/handlers", async () => {
    const probe = new Composer<Ctx>();
    probe.hears("ping", (ctx) => ctx.reply("pong"));

    const suite = await runSpecs(() => buildBot("test-token", { handlers: [probe] }), [
      parseBotSpec({
        name: "injected handler answers",
        steps: [{ send: { text: "ping" }, expect: [{ method: "sendMessage", payload: { text: "pong" } }] }],
      }),
      parseBotSpec({
        name: "disk handler /start is NOT loaded on the manifest path",
        steps: [
          {
            send: { text: "/start" },
            expect: [{ method: "sendMessage", payload: { text: "Sorry, I didn't understand that. Try /help." } }],
          },
        ],
      }),
    ]);
    expect(suite.failed).toBe(0);
    expect(suite.passed).toBe(2);
  });

  it("runs handlers in array order, so an env-first entry exposes ctx.env (worker.ts pattern)", async () => {
    // Mirrors src/worker.ts: [attachEnv, ...handlers]. The env middleware must
    // be FIRST so a later handler can read ctx.env (remindAt/env.DB seam).
    const attachEnv = new Composer<Ctx>();
    attachEnv.use((ctx, next) => {
      (ctx as Ctx & { env: { flag: string } }).env = { flag: "ok" };
      return next();
    });
    const probe = new Composer<Ctx>();
    probe.hears("whoami", (ctx) =>
      ctx.reply((ctx as Ctx & { env?: { flag: string } }).env?.flag ?? "NO-ENV"),
    );

    const suite = await runSpecs(() => buildBot("test-token", { handlers: [attachEnv, probe] }), [
      parseBotSpec({
        name: "env set by the first middleware is visible to a later handler",
        steps: [{ send: { text: "whoami" }, expect: [{ method: "sendMessage", payload: { text: "ok" } }] }],
      }),
    ]);
    expect(suite.failed).toBe(0);
  });
});

// A minimal in-memory DOState so ChatDO's alarm/session logic runs under Node.
function fakeState(): DOState {
  const map = new Map<string, unknown>();
  let alarm: number | null = null;
  return {
    storage: {
      async get<T = unknown>(k: string): Promise<T | undefined> {
        return map.get(k) as T | undefined;
      },
      async put(a: string | Record<string, unknown>, b?: unknown): Promise<void> {
        if (typeof a === "string") map.set(a, b);
        else for (const [k, v] of Object.entries(a)) map.set(k, v);
      },
      async delete(k: string): Promise<boolean> {
        return map.delete(k);
      },
      async setAlarm(t: number): Promise<void> {
        alarm = t;
      },
      async getAlarm(): Promise<number | null> {
        return alarm;
      },
    },
    blockConcurrencyWhile() {},
  };
}

function gameNamespace(): WorkerEnv["CHAT_DO"] {
  const instances = new Map<string, ChatDO>();
  return {
    idFromName(name: string): string {
      return name;
    },
    get(id: unknown) {
      const key = String(id);
      let instance = instances.get(key);
      if (!instance) {
        instance = new ChatDO(fakeState(), { BOT_TOKEN: "T" } as WorkerEnv);
        instances.set(key, instance);
      }
      return { fetch: (input: string, init?: { method?: string; body?: string }) => instance!.fetch(new Request(input, init)) };
    },
  };
}

function groupTextUpdate(id: number, text: string, chatId: number, userId: number) {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 0,
      chat: { id: chatId, type: "group", title: "Game" },
      from: { id: userId, is_bot: false, first_name: "Admin" },
      text,
      entities: text.startsWith("/") ? [{ type: "bot_command", offset: 0, length: text.split(" ")[0].length }] : undefined,
    },
  };
}

function privateTextUpdate(id: number, text: string, userId: number) {
  return {
    update_id: id,
    message: {
      message_id: id,
      date: 0,
      chat: { id: userId, type: "private", first_name: "Admin" },
      from: { id: userId, is_bot: false, first_name: "Admin" },
      text,
    },
  };
}

describe("admin-supplied game secrets", () => {
  it("prompts an admin privately, retries invalid input, and starts the group round without revealing the number", async () => {
    const env = { BOT_TOKEN: "T", CHAT_DO: gameNamespace() } as WorkerEnv;
    const attachEnv = new Composer<Ctx>();
    attachEnv.use((ctx, next) => {
      (ctx as Ctx & { env: WorkerEnv }).env = env;
      return next();
    });
    const bot = await buildBot("test-token", { handlers: [attachEnv, startGame] });
    bot.botInfo = {
      id: 42, is_bot: true, first_name: "TestBot", username: "test_bot",
      can_join_groups: true, can_read_all_group_messages: false,
      supports_inline_queries: false, can_connect_to_business: false,
    };
    const calls: Array<{ method: string; payload: Record<string, unknown> }> = [];
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      const result = method === "getChatMember"
        ? { status: "administrator" }
        : { message_id: calls.length, date: 0, chat: { id: 1, type: "private" } };
      return { ok: true, result } as never;
    });

    await bot.handleUpdate(groupTextUpdate(1, "/startgame", -100, 7) as never);
    expect(calls.some((call) => call.method === "sendMessage" && call.payload.text === "Please send the secret number for the current game.")).toBe(true);
    expect(calls.some((call) => call.method === "sendMessage" && String(call.payload.text).includes("секретное число"))).toBe(true);
    expect(calls.some((call) => call.method === "sendMessage" && String(JSON.stringify(call.payload.reply_markup)).includes("https://t.me/test_bot?start=game_-100"))).toBe(true);

    calls.length = 0;
    await bot.handleUpdate(privateTextUpdate(2, "oops", 7) as never);
    expect(calls.some((call) => call.payload.text === "Пришлите целое число от 1 до 1000000.")).toBe(true);

    calls.length = 0;
    await bot.handleUpdate(privateTextUpdate(3, "321", 7) as never);
    expect(calls.some((call) => call.payload.text === "Секретное число сохранено. Раунд уже начался в группе!")).toBe(true);
    expect(calls.some((call) => call.method === "sendMessage" && call.payload.chat_id === -100 && String(call.payload.text).includes("Раунд начался"))).toBe(true);
    expect(calls.every((call) => !String(call.payload.text).includes("321"))).toBe(true);
  });
});

describe("ChatDO — Durable Object reminders + session", () => {
  let sent: Array<{ method: string; body: { chat_id: number | string; text: string } }>;
  beforeEach(() => {
    sent = [];
    vi.stubGlobal("fetch", async (url: string, init: { body: string }) => {
      sent.push({ method: url.split("/").pop() ?? "", body: JSON.parse(init.body) });
      return new Response("{}");
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("fires due reminders on alarm, then drops them (no double-send)", async () => {
    const env = { BOT_TOKEN: "T" } as unknown as WorkerEnv;
    const doInstance = new ChatDO(fakeState(), env);

    // Schedule one in the past so the very next alarm() fires it.
    await doInstance.fetch(
      new Request("https://do/remind", {
        method: "POST",
        body: JSON.stringify({ at: Date.now() - 1000, chatId: 42, text: "drink water" }),
      }),
    );

    await doInstance.alarm();
    expect(sent).toHaveLength(1);
    expect(sent[0].method).toBe("sendMessage");
    expect(sent[0].body.chat_id).toBe(42);
    expect(sent[0].body.text).toBe("drink water");

    // A second alarm must NOT re-send the already-fired reminder.
    await doInstance.alarm();
    expect(sent).toHaveLength(1);
  });

  it("does not fire reminders scheduled in the future", async () => {
    const doInstance = new ChatDO(fakeState(), { BOT_TOKEN: "T" } as unknown as WorkerEnv);
    await doInstance.fetch(
      new Request("https://do/remind", {
        method: "POST",
        body: JSON.stringify({ at: Date.now() + 60_000, chatId: 7, text: "later" }),
      }),
    );
    await doInstance.alarm();
    expect(sent).toHaveLength(0);
  });

  it("stores and returns the session via /session", async () => {
    const doInstance = new ChatDO(fakeState(), { BOT_TOKEN: "T" } as unknown as WorkerEnv);
    // empty → 204 (grammy reads this as "no session yet")
    let r = await doInstance.fetch(new Request("https://do/session", { method: "GET" }));
    expect(r.status).toBe(204);
    // write, then read it back
    await doInstance.fetch(new Request("https://do/session", { method: "PUT", body: JSON.stringify({ step: "x" }) }));
    r = await doInstance.fetch(new Request("https://do/session", { method: "GET" }));
    expect(await r.json()).toEqual({ step: "x" });
    // delete clears it
    await doInstance.fetch(new Request("https://do/session", { method: "DELETE" }));
    r = await doInstance.fetch(new Request("https://do/session", { method: "GET" }));
    expect(r.status).toBe(204);
  });
});
