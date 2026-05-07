import { prisma } from '../config/db';
import { generatePlaybook, type Playbook } from './claude.service';
import { HttpError } from '../middleware/error';
import type { Bias, Impact, Playbook as DbPlaybook } from '@prisma/client';

interface CreateOpts {
  userId?: string;
  symbol: string;
  newsId?: string;
  newsContext?: string;
  currentPrice?: number;
}

/**
 * Generate a fresh AI playbook via Claude and persist to DB.
 */
export async function createPlaybook(opts: CreateOpts): Promise<DbPlaybook> {
  let context = opts.newsContext;

  // If newsId given, pull headline + reasoning as context
  if (opts.newsId && !context) {
    const news = await prisma.newsStory.findUnique({ where: { id: opts.newsId } });
    if (!news) throw new HttpError(404, 'News story not found', 'NEWS_NOT_FOUND');
    context = `${news.headline}${news.reasoning ? '. ' + news.reasoning : ''}`;
  }

  const ai: Playbook = await generatePlaybook({
    symbol: opts.symbol,
    newsContext: context,
    currentPrice: opts.currentPrice,
  });

  const bias: Bias = ai.bias;
  const confidence: Impact = ai.confidence;

  return prisma.playbook.create({
    data: {
      userId: opts.userId ?? null,
      symbol: opts.symbol,
      newsId: opts.newsId ?? null,
      bias,
      confidence,
      bullEntry: ai.bull_case.entry,
      bullTp: ai.bull_case.take_profit,
      bullSl: ai.bull_case.stop_loss,
      bearEntry: ai.bear_case.entry,
      bearTp: ai.bear_case.take_profit,
      bearSl: ai.bear_case.stop_loss,
      reasoning: ai.bias === 'bear' ? ai.bear_case.reasoning : ai.bull_case.reasoning,
      keyLevels: ai.key_levels,
    },
  });
}

export async function getPlaybooksForUser(userId: string, limit = 50) {
  return prisma.playbook.findMany({
    where: { OR: [{ userId }, { userId: null }] },
    orderBy: { generatedAt: 'desc' },
    take: limit,
  });
}

export async function getPlaybookById(id: string) {
  return prisma.playbook.findUnique({ where: { id } });
}
