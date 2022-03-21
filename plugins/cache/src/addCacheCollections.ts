import {
  Bot,
  Channel,
  Collection,
  FinalHelpers,
  Guild,
  Member,
  Message,
  ModifyWebhook,
  PresenceUpdate,
  User,
  Webhook,
} from "../deps.ts";

export type BotWithCache<B extends Bot = Bot> = B & CacheProps & { helpers: BotHelpersWithCache };

export interface BotHelpersWithCache extends FinalHelpers {
  /** The added channelId argument at the end is used to validate permission checks */
  editWebhook: (webhookId: bigint, options: ModifyWebhook, channelId?: bigint) => Promise<Webhook>;
}

export interface CacheProps extends Bot {
  guilds: Collection<bigint, Guild>;
  users: Collection<bigint, User>;
  members: Collection<bigint, Member>;
  channels: Collection<bigint, Channel>;
  messages: Collection<bigint, Message>;
  presences: Collection<bigint, PresenceUpdate>;
  dispatchedGuildIds: Set<bigint>;
  dispatchedChannelIds: Set<bigint>;
  activeGuildIds: Set<bigint>;
}

export function addCacheCollections<B extends Bot>(bot: B): BotWithCache<B> {
  const cacheBot = bot as BotWithCache<B>;
  cacheBot.guilds = new Collection();
  cacheBot.users = new Collection();
  cacheBot.members = new Collection();
  cacheBot.channels = new Collection();
  cacheBot.messages = new Collection();
  cacheBot.presences = new Collection();
  cacheBot.dispatchedGuildIds = new Set();
  cacheBot.dispatchedChannelIds = new Set();
  cacheBot.activeGuildIds = new Set();

  return bot as BotWithCache<B>;
}
