import { ChannexManager } from "./channex";
import { FakeChannelManager } from "./fake";
import type { ChannelManager } from "./provider";

export * from "./provider";
export { parseChannexRevision, type ChannelBookingRevision, type ChannelGuest, type ChannelRoom } from "./bookings";
export { ChannexManager } from "./channex";
export { FakeChannelManager } from "./fake";

/** The channel manager of this process: Channex with CHANNEX_API_KEY (CHANNEX_URL: staging by default), else the fake (refused in production). */
export function channelManager(env: NodeJS.ProcessEnv = process.env): ChannelManager {
  const g = globalThis as { __hsChannels?: ChannelManager };
  if (g.__hsChannels) return g.__hsChannels;
  if (!env.CHANNEX_API_KEY && env.NODE_ENV === "production") throw new Error("CHANNEX_API_KEY is not set");
  g.__hsChannels = env.CHANNEX_API_KEY ? new ChannexManager(env.CHANNEX_API_KEY, env.CHANNEX_URL ?? "https://staging.channex.io/api/v1") : new FakeChannelManager();
  return g.__hsChannels;
}
