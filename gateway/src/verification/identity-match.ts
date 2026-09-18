/**
 * Whether an actor may redeem a session's code.
 *
 * The precedence deciding WHICH identity binds a session lives in the shared
 * contract (`boundIdentity`), because the supersede scope in the session store
 * has to agree with this consume-side check. The two disagreeing is a silent
 * one-time-code bug in either direction: too loose and a stranger in a shared
 * chat spends someone else's code, too narrow and a mint supersedes nothing
 * and every earlier code stays spendable for its full TTL.
 */

import { boundIdentity } from "@vellumai/gateway-client";
import type {
  IdentityBindingStatus,
  IdentityBoundSession,
} from "@vellumai/gateway-client";

/**
 * The identity fields the match rules read, plus the binding state.
 *
 * The binding state keeps its union rather than widening to `string`. Only
 * `bound` makes the identity decide anything, so a value outside the union
 * reads as not-bound and admits any holder of the code; the type is what
 * stops a caller inventing one.
 */
export type IdentityMatchSession = IdentityBoundSession & {
  identityBindingStatus?: IdentityBindingStatus | null;
};

/**
 * The one identity a session's code was issued to, or null when any holder
 * of the code may redeem it: a session bound to no identity (an inbound
 * challenge, which relies on code secrecy alone), or one whose binding is not
 * yet final (`pending_bootstrap`, where the bootstrap path does the binding).
 */
export function boundRedeemer(
  session: IdentityMatchSession,
): ReturnType<typeof boundIdentity> {
  const identity = boundIdentity(session);
  return identity !== null && session.identityBindingStatus === "bound"
    ? identity
    : null;
}

/**
 * Check whether the actor submitting a code matches the session's bound
 * identity.
 *
 * True when the session is bound to no identity (an inbound challenge, which
 * relies on code secrecy alone), or when its binding is not yet final
 * (`pending_bootstrap`, where the bootstrap path does the binding).
 *
 * A caller holding a single identifier for the actor, such as voice, passes it
 * as both arguments.
 */
export function checkIdentityMatch(
  session: IdentityMatchSession,
  actorExternalUserId: string,
  actorChatId: string,
): boolean {
  const identity = boundRedeemer(session);
  if (identity === null) {
    return true;
  }
  return identity.field === "chatId"
    ? actorChatId === identity.value
    : actorExternalUserId === identity.value;
}
