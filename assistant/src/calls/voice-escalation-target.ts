export type VoiceEscalationProfileSource =
  | "conversation"
  | "turn_override"
  | "image_compatibility"
  | "call_site";

export interface VoiceEscalationTarget {
  profile: string;
  source: VoiceEscalationProfileSource;
}
