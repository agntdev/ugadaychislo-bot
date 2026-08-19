import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { lastRound, recentRounds } from "../game-store.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "📋 Итог раунда", data: "game:result", order: 30 });

const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("В меню", "menu:main")]]);

async function resultText(ctx: Ctx): Promise<string> {
  const round = await lastRound(ctx);
  if (round === undefined) return "Итог пока недоступен. Попробуйте ещё раз через минуту.";
  if (round === null || !round.winner) return "Завершённых раундов ещё нет — начните игру и угадайте число.";
  return `Последний раунд: ${round.winner.username} угадал число ${round.secret_number}.`;
}

async function historyText(ctx: Ctx): Promise<string> {
  const rounds = await recentRounds(ctx);
  if (rounds === undefined) return "История пока недоступна. Попробуйте ещё раз через минуту.";
  if (rounds.length === 0) return "История пуста — первый раунд уже ждёт вас.";
  return "📋 Последние раунды\n\n" + rounds.map((round, i) =>
    round.winner ? `${i + 1}. ${round.winner.username} угадал ${round.secret_number}` : `${i + 1}. Раунд остановлен`,
  ).join("\n");
}

composer.command("gameresult", async (ctx) => {
  await ctx.reply(await resultText(ctx));
});

composer.callbackQuery("game:result", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(await resultText(ctx), {
    reply_markup: inlineKeyboard([
      [inlineButton("Посмотреть историю", "game:history")],
      [inlineButton("В меню", "menu:main")],
    ]),
  });
});

composer.callbackQuery("game:history", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(await historyText(ctx), { reply_markup: back });
});

export default composer;
