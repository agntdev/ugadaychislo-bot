import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { displayName, hasActiveRound, startRound, submitGuess } from "../game-store.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

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
  const result = await startRound(ctx, ctx.from!.id, force);
  let text: string;
  if (result.kind === "started") {
    text = result.restarted
      ? "Новый раунд уже начался! Старый раунд остановлен. Загадайте число от 1 до 100."
      : "Раунд начался! Я загадал число от 1 до 100. Присылайте целые числа.";
  } else if (result.kind === "already-active") {
    text = "Раунд уже идёт. Продолжайте угадывать или админ может перезапустить его.";
  } else {
    text = "Игра пока недоступна. Попробуйте ещё раз через минуту.";
  }
  const reply_markup = result.kind === "already-active" ? restartMenu : back;
  if (edit) await ctx.editMessageText(text, { reply_markup });
  else await ctx.reply(text, { ...topic(ctx), reply_markup });
}

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

composer.on("message:text", async (ctx, next) => {
  const text = ctx.message.text.trim();
  if (text.startsWith("/")) return next();
  if (!inGroup(ctx)) return next();
  if (!/^-?\d+$/.test(text)) {
    if (await hasActiveRound(ctx)) {
      await ctx.reply("Сейчас угадываем число — пришлите целое от 1 до 100.", topic(ctx));
      return;
    }
    return next();
  }
  const guess = Number(text);
  if (!Number.isSafeInteger(guess) || guess < 1 || guess > 100) {
    await ctx.reply("Берите целое число от 1 до 100.", topic(ctx));
    return;
  }
  if (!ctx.from) return;
  const result = await submitGuess(ctx, { user_id: ctx.from.id, username: displayName(ctx.from) }, guess);
  if (result.kind === "higher") await ctx.reply("Нужно число больше.", topic(ctx));
  if (result.kind === "lower") await ctx.reply("Нужно число меньше.", topic(ctx));
  if (result.kind === "won") {
    await ctx.reply(`${result.winner.username} угадал число ${guess}! Раунд завершён.`, topic(ctx));
  }
  if (result.kind === "unavailable") {
    await ctx.reply("Игра пока недоступна. Попробуйте ещё раз через минуту.", topic(ctx));
  }
});

export default composer;
