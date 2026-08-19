import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { leaderboard } from "../game-store.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";

registerMainMenuItem({ label: "🏆 Таблица побед", data: "game:scoreboard", order: 20 });

const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("В меню", "menu:main")]]);

async function scoreText(ctx: Ctx): Promise<string> {
  const entries = await leaderboard(ctx);
  if (entries === undefined) return "Таблица пока недоступна. Попробуйте ещё раз через минуту.";
  if (entries.length === 0) return "Побед пока нет — начните раунд и попробуйте угадать число.";
  return "🏆 Лучшие игроки\n\n" + entries.map((entry, index) => `${index + 1}. ${entry.username} — ${entry.win_count}`).join("\n");
}

composer.command("scoreboard", async (ctx) => {
  await ctx.reply(await scoreText(ctx));
});

composer.callbackQuery("game:scoreboard", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(await scoreText(ctx), { reply_markup: back });
});

export default composer;
