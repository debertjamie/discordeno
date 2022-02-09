import { GetGatewayBot } from "../types/gateway/getGatewayBot.ts";
import { GatewayManager, createGatewayManager } from "./gateway_manager.ts";

/** The handler to automatically reshard when necessary. */
export async function resharder(
  oldGateway: GatewayManager,
  results: GetGatewayBot,
) {
  oldGateway.debug("[Resharding] Starting the reshard process.");

  const gateway = createGatewayManager({
    ...oldGateway,
    // IGNORE EVENTS FOR NOW
    handleDiscordPayload: async function () {},
  });

  // Begin resharding
  gateway.maxShards = results.shards;
  // FOR MANUAL SHARD CONTROL, OVERRIDE THIS SHARD ID!
  gateway.lastShardId = oldGateway.lastShardId === oldGateway.maxShards
    ? gateway.maxShards
    : oldGateway.lastShardId;
  gateway.shardsRecommended = results.shards;
  gateway.sessionStartLimitTotal = results.sessionStartLimit.total;
  gateway.sessionStartLimitRemaining = results.sessionStartLimit.remaining;
  gateway.sessionStartLimitResetAfter = results.sessionStartLimit.resetAfter;
  gateway.maxConcurrency = results.sessionStartLimit.maxConcurrency;
  // If more than 100K servers, begin switching to 16x sharding
  if (gateway.maxShards && gateway.useOptimalLargeBotSharding) {
    gateway.debug("[Resharding] Using optimal large bot sharding solution.");
    gateway.maxShards = Math.ceil(
      gateway.maxShards /
        (results.sessionStartLimit.maxConcurrency === 1
          ? 16
          : results.sessionStartLimit.maxConcurrency),
    );
  }

  gateway.spawnShards(gateway, gateway.firstShardId);

  return new Promise((resolve) => {
    // TIMER TO KEEP CHECKING WHEN ALL SHARDS HAVE RESHARDED
    const timer = setInterval(async () => {
      const pending = await gateway.resharding.isPending(gateway, oldGateway);
      // STILL PENDING ON SOME SHARDS TO BE CREATED
      if (pending) return;

      // ENABLE EVENTS ON NEW SHARDS AND IGNORE EVENTS ON OLD
      const oldHandler = oldGateway.handleDiscordPayload;
      gateway.handleDiscordPayload = oldHandler;
      oldGateway.handleDiscordPayload = function (_, data, shardId) {
        // ALLOW EXCEPTION FOR CHUNKING TO PREVENT REQUESTS FREEZING
        if (data.t !== "GUILD_MEMBERS_CHUNK") return;
        oldHandler(_, data, shardId);
      };

      // STOP TIMER
      clearInterval(timer);
      await gateway.resharding.closeOldShards(oldGateway);
      gateway.debug("[Resharding] Complete.");
      resolve(gateway);
    }, 30000);
  }) as Promise<GatewayManager>;
}

/** Handler that by default will check all new shards are online in the new gateway. The handler can be overriden if you have multiple servers to communicate through redis pubsub or whatever you prefer. */
export async function resharderIsPending(
  gateway: GatewayManager,
  oldGateway: GatewayManager,
) {
  for (let i = gateway.firstShardId; i < gateway.maxShards; i++) {
    const shard = gateway.shards.get(i);
    if (!shard?.ready) {
      return true;
    }
  }

  return false;
}

/** Handler that by default closes all shards in the old gateway. Can be overriden if you have multiple servers and you want to communicate through redis pubsub or whatever you prefer. */
export async function resharderCloseOldShards(oldGateway: GatewayManager) {
  // SHUT DOWN ALL SHARDS IF NOTHING IN QUEUE
  oldGateway.shards.forEach((shard) => {
    // CLOSE THIS SHARD IT HAS NO QUEUE
    if (!shard.processingQueue && !shard.queue.length) {
      return oldGateway.closeWS(
        shard.ws,
        3066,
        "Shard has been resharded. Closing shard since it has no queue.",
      );
    }

    // IF QUEUE EXISTS GIVE IT 5 MINUTES TO COMPLETE
    setTimeout(() => {
      oldGateway.closeWS(
        shard.ws,
        3066,
        "Shard has been resharded. Delayed closing shard since it had a queue.",
      );
    }, 300000);
  });
}

/** Handler that by default will check to see if resharding should occur. Can be overriden if you have multiple servers and you want to communicate through redis pubsub or whatever you prefer. */
export async function startReshardingChecks(gateway: GatewayManager) {
  gateway.debug("[Resharding] Checking if resharding is needed.");

  // TODO: is it possible to route this to REST?
  const results = (await fetch(`https://discord.com/api/gateway/bot`, {
    headers: {
      Authorization: `${
        gateway.token.startsWith("Bot ") ? "" : "Bot "
      }${gateway.token}`,
    },
  }).then((res) => res.json())) as GetGatewayBot;

  const percentage =
    ((results.shards - gateway.maxShards) / gateway.maxShards) * 100;
  // Less than necessary% being used so do nothing
  if (percentage < gateway.reshardPercentage) return;

  // Don't have enough identify rate limits to reshard
  if (results.sessionStartLimit.remaining < results.shards) return;

  // MULTI-SERVER BOTS OVERRIDE THIS IF YOU NEED TO RESHARD SERVER BY SERVER
  return gateway.resharding.resharder(gateway, results);
}
