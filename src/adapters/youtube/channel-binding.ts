import { ToonForgeError } from "../../core/errors.js";
import type { YoutubeAccountFile } from "./account.js";

/** YouTube channel ids are `UC` plus 22 URL-safe characters. */
export const YOUTUBE_CHANNEL_ID_PATTERN = /^UC[A-Za-z0-9_-]{22}$/;

export type ChannelBindingBlocker =
  | "target_channel_missing"
  | "target_channel_invalid"
  | "target_channel_ambiguous"
  | "authenticated_channel_missing"
  | "channel_mismatch";

export interface ChannelBindingInput {
  /** Value from the channel file. Not proof of authentication. */
  channelYoutubeId?: string;
  /** Value from YOUTUBE_CHANNEL_ID. Not proof of authentication. */
  envYoutubeId?: string;
  /** Stored result of channels.list. A raw id string with no record does not count. */
  accounts: YoutubeAccountFile;
}

export type ChannelBinding =
  | { ok: true; targetChannelId: string; authenticatedChannelId: string }
  | { ok: false; blocker: ChannelBindingBlocker; message: string };

export function authenticatedChannelId(accounts: YoutubeAccountFile): string | null {
  const selected = accounts.selectedChannelId;
  if (!selected) return null;
  const record = accounts.channels.find((item) => item.channelId === selected);
  return record?.channelId ?? null;
}

export function evaluateChannelBinding(input: ChannelBindingInput): ChannelBinding {
  const fromChannel = input.channelYoutubeId?.trim() || undefined;
  const fromEnv = input.envYoutubeId?.trim() || undefined;
  if (fromChannel && fromEnv && fromChannel !== fromEnv) {
    return {
      ok: false,
      blocker: "target_channel_ambiguous",
      message: "Channel file youtube_channel_id and YOUTUBE_CHANNEL_ID name different channels. Refusing to guess which one is the publish target.",
    };
  }
  const target = fromChannel ?? fromEnv;
  if (!target) {
    return {
      ok: false,
      blocker: "target_channel_missing",
      message: "Set youtube_channel_id on the channel file or YOUTUBE_CHANNEL_ID before publishing. A selected OAuth channel is not a target.",
    };
  }
  if (!YOUTUBE_CHANNEL_ID_PATTERN.test(target)) {
    return {
      ok: false,
      blocker: "target_channel_invalid",
      message: "The configured YouTube channel id is not a valid UC id.",
    };
  }
  const authenticated = authenticatedChannelId(input.accounts);
  if (!authenticated) {
    return {
      ok: false,
      blocker: "authenticated_channel_missing",
      message: `No authenticated YouTube channel is selected for target ${target}. Run youtube connect and let channels.list confirm the account.`,
    };
  }
  if (authenticated !== target) {
    return {
      ok: false,
      blocker: "channel_mismatch",
      message: `Authenticated YouTube channel ${authenticated} does not match configured target ${target}. Refusing to upload.`,
    };
  }
  return { ok: true, targetChannelId: target, authenticatedChannelId: authenticated };
}

export function assertChannelBinding(input: ChannelBindingInput): { targetChannelId: string; authenticatedChannelId: string } {
  const binding = evaluateChannelBinding(input);
  if (binding.ok) return binding;
  const invalidTarget = binding.blocker === "target_channel_missing"
    || binding.blocker === "target_channel_invalid"
    || binding.blocker === "target_channel_ambiguous";
  throw new ToonForgeError({
    code: invalidTarget ? "CONFIG_INVALID" : "POLICY_VIOLATION",
    message: binding.message,
    component: "adapters.youtube.channel-binding",
    context: { blocker: binding.blocker },
  });
}
