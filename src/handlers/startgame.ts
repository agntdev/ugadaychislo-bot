import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import {
  addPendingGame,
  displayName,
  hasActiveRound,
  pendingGames,
  removePendingGame,
  SECRET_NUMBER_LIMITS,
  setSecretNumber,
  startRound,
  submitGuess,
} from "../game-store.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, urlButton } from "../toolkit/index.js";

registerMainMenuItem({ label: "🎲 Начать раунд", data: "game:start", order: 10 });

const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("В меню", "menu:main")]]);
const restartMenu = inlineKeyboard([
  [inlineButton("Перезапустить раунд", "game:restart")],
  [inlineButton("В меню", "menu:main")],
]);

function inGroup(ctx: Ctx): boolean {
  return ctx.chat?.type === "group" || ctx.chat?.type === "supergroup";
}

function topic(ctx: Ctx): { message_thread_id?: number } {
  const thread = ctx.message?.message_thread_id;
  return thread === undefined ? {} : { message_thread_id: thread };
}

async function isChatAdmin(ctx: Ctx): Promise<boolean> {
  if (!ctx.from || !inGroup(ctx)) return false;
  try {
    const member = await ctx.getChatMember(ctx.from.id);
    return member.status === "creator" || member.status === "administrator";
  } catch {
    return false;
  }
}

async function isGroupAdmin(ctx: Ctx, groupId: number): Promise<boolean> {
  if (!ctx.from) return false;
  try {
    const member = await ctx.api.getChatMember(groupId, ctx.from.id);
    return member.status === "creator" || member.status === "administrator";
  } catch {
    return false;
  }
}

function setupPrompt(): string {
  return "Please send the secret number for the current game.";
}

function setupLink(ctx: Ctx): string | undefined {
  const username = ctx.me.username;
  return username && ctx.chat ? `https://t.me/${username}?start=game_${ctx.chat.id}` : undefined;
}

async function sendPrivateSetupPrompt(ctx: Ctx, adminId: number): Promise<void> {
  try {
    await ctx.api.sendMessage(adminId, setupPrompt());
  } catch {
    // A bot cannot initiate a cold DM. The public deep link below is the safe fallback.
  }
}

async function launch(ctx: Ctx, force: boolean, edit = false): Promise<void> {
  if (!inGroup(ctx)) {
    const text = "Играть лучше в группе — добавьте меня туда, и админ сможет открыть раунд.";
    if (edit) await ctx.editMessageText(text, { reply_markup: back });
    else await ctx.reply(text, { ...topic(ctx), reply_markup: back });
    return;
  }
  if (!(await isChatAdmin(ctx))) {
    const text = "Открывать и перезапускать раунд могут только администраторы группы.";
    if (edit) await ctx.editMessageText(text, { reply_markup: back });
    else await ctx.reply(text, topic(ctx));
    return;
  }
  const result = await startRound(ctx, ctx.from!.id, force, ctx.message?.message_thread_id);
  let text: string;
  if (result.kind === "waiting-for-secret") {
    const indexed = await addPendingGame(ctx, ctx.from!.id, ctx.chat!.id);
    if (!indexed) {
      text = "Игра пока недоступна. Попробуйте ещё раз через минуту.";
    } else {
      text = result.restarted
        ? "Старый раунд остановлен. Админ, откройте личный чат с ботом и пришлите секретное число."
        : "Админ, откройте личный чат с ботом и пришлите секретное число. Затем игроки смогут угадывать.";
      await sendPrivateSetupPrompt(ctx, ctx.from!.id);
    }
  } else if (result.kind === "already-active") {
    text = "Раунд уже идёт. Продолжайте угадывать или админ может перезапустить его.";
  } else {
    text = "Игра пока недоступна. Попробуйте ещё раз через минуту.";
  }
  const setupUrl = result.kind === "waiting-for-secret" ? setupLink(ctx) : undefined;
  const reply_markup = result.kind === "already-active"
    ? restartMenu
    : setupUrl
      ? inlineKeyboard([[urlButton("Открыть личный чат", setupUrl)], [inlineButton("В меню", "menu:main")]])
      : back;
  if (edit) await ctx.editMessageText(text, { reply_markup });
  else await ctx.reply(text, { ...topic(ctx), reply_markup });
}

async function acceptSecretNumber(ctx: Ctx, text: string): Promise<boolean> {
  if (ctx.chat?.type !== "private" || !ctx.from) return false;
  const selectedGroup = ctx.session.secretGroupId;
  const pending = selectedGroup === undefined ? await pendingGames(ctx) : [selectedGroup];
  const groupId = pending?.at(-1);
  if (groupId === undefined) return false;
  if (!/^-?\d+$/.test(text)) {
    await ctx.reply(`Пришлите целое число от ${SECRET_NUMBER_LIMITS.min} до ${SECRET_NUMBER_LIMITS.max}.`);
    return true;
  }
  const secretNumber = Number(text);
  if (!Number.isSafeInteger(secretNumber) || secretNumber < SECRET_NUMBER_LIMITS.min || secretNumber > SECRET_NUMBER_LIMITS.max) {
    await ctx.reply(`Пришлите целое число от ${SECRET_NUMBER_LIMITS.min} до ${SECRET_NUMBER_LIMITS.max}.`);
    return true;
  }
  if (!(await isGroupAdmin(ctx, groupId))) {
    await ctx.reply("Установить секретное число может только администратор этой группы.");
    return true;
  }
  const result = await setSecretNumber(ctx, groupId, ctx.from.id, secretNumber);
  if (!result) {
    await ctx.reply("Игра пока недоступна. Попробуйте ещё раз через минуту.");
    return true;
  }
  if (result.kind === "not-waiting") {
    await ctx.reply("Этот раунд уже начался или был остановлен.");
    return true;
  }
  await removePendingGame(ctx, groupId);
  ctx.session.secretGroupId = undefined;
  await ctx.reply("Секретное число сохранено. Раунд уже начался в группе!");
  try {
    await ctx.api.sendMessage(groupId, "Раунд начался! Присылайте целые числа — я подскажу, выше или ниже.", {
      ...(result.round.message_thread_id === undefined ? {} : { message_thread_id: result.round.message_thread_id }),
    });
  } catch {
    // The group may have removed the bot while the admin was choosing a number.
  }
  return true;
}

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();
  if (await acceptSecretNumber(ctx, text)) return;
  if (!inGroup(ctx)) return next();
  if (!/^-?\d+$/.test(text)) {
    if (await hasActiveRound(ctx)) {
      await ctx.reply(`Сейчас идёт раунд — пришлите целое число от ${SECRET_NUMBER_LIMITS.min} до ${SECRET_NUMBER_LIMITS.max}.`, topic(ctx));
      return;
    }
    return next();
  }
  const guess = Number(text);
  if (!Number.isSafeInteger(guess) || guess < SECRET_NUMBER_LIMITS.min || guess > SECRET_NUMBER_LIMITS.max) {
    await ctx.reply(`Берите целое число от ${SECRET_NUMBER_LIMITS.min} до ${SECRET_NUMBER_LIMITS.max}.`, topic(ctx));
    return;
  }
  if (!ctx.from) return;
  const result = await submitGuess(ctx, { user_id: ctx.from.id, username: displayName(ctx.from) }, guess);
  if (result.kind === "higher") await ctx.reply("Нужно число больше.", topic(ctx));
  if (result.kind === "lower") await ctx.reply("Нужно число меньше.", topic(ctx));
  if (result.kind === "won") {
    await ctx.reply(`${result.winner.username} угадал число ${guess}! Раунд завершён.`, topic(ctx));
  }
  if (result.kind === "waiting-for-secret") {
    await ctx.reply("Админ ещё выбирает секретное число. Скоро начнём!", topic(ctx));
  }
  if (result.kind === "unavailable") {
    await ctx.reply("Игра пока недоступна. Попробуйте ещё раз через минуту.", topic(ctx));
  }
});

composer.command("startgame", async (ctx) => {
  const argument = ctx.match.trim().toLowerCase();
  if (argument && argument !== "force") {
    await ctx.reply("Используйте /startgame или /startgame force для перезапуска.", topic(ctx));
    return;
  }
  await launch(ctx, argument === "force");
});

composer.callbackQuery("game:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  await launch(ctx, false, true);
});

composer.callbackQuery("game:restart", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!inGroup(ctx) || !(await isChatAdmin(ctx))) {
    await ctx.editMessageText("Перезапускать раунд могут только администраторы группы.", { reply_markup: back });
    return;
  }
  await ctx.editMessageText("Текущий раунд будет остановлен. Запустить новый?", {
    reply_markup: inlineKeyboard([
      [inlineButton("Запустить новый", "game:force")],
      [inlineButton("Отмена", "menu:main")],
    ]),
  });
});

composer.callbackQuery("game:force", async (ctx) => {
  await ctx.answerCallbackQuery();
  await launch(ctx, true, true);
});


export default composer;
