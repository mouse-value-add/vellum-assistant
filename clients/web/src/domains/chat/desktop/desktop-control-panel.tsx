import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@vellumai/design-library";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import {
  desktopControlGetOptions,
  useDesktopControlPostMutation,
} from "@/generated/daemon/@tanstack/react-query.gen";
import { desktopControlGet } from "@/generated/daemon/sdk.gen";
import { useBusSubscription } from "@/hooks/use-bus-subscription";
import { useIsOrgReady } from "@/hooks/use-is-org-ready";
import { useTranslation } from "@/i18n";
import { SYNC_TAGS } from "@/lib/sync/types";
import { useAssistantFeatureFlagStore } from "@/stores/assistant-feature-flag-store";
import { toApiError } from "@/utils/api-errors";

type Props = {
  assistantId: string;
  controlsContainer?: HTMLElement | null;
  children: (viewOnly: boolean) => ReactNode;
};

export function DesktopControlPanel(props: Props) {
  const enabled = useAssistantFeatureFlagStore.use.assistantDesktop();
  return enabled === true ? (
    <EnabledDesktopControlPanel key={props.assistantId} {...props} />
  ) : (
    props.children(false)
  );
}

function EnabledDesktopControlPanel({
  assistantId,
  controlsContainer,
  children,
}: Props) {
  const { t } = useTranslation("chat");
  const client = useQueryClient();
  const orgReady = useIsOrgReady();
  const options = desktopControlGetOptions({
    path: { assistant_id: assistantId },
  });
  const query = useQuery({
    ...options,
    enabled: orgReady,
    staleTime: 0,
    refetchOnWindowFocus: false,
    retry: false,
    queryFn: async ({ signal }) => {
      const { data, error, response } = await desktopControlGet({
        path: { assistant_id: assistantId },
        signal,
        throwOnError: false,
      });
      if (response?.status === 404) {
        return { state: "idle" } as const;
      }
      if (!response?.ok || !data) {
        throw response ? toApiError(error, response) : error;
      }
      return data;
    },
  });
  const refresh = () =>
    client.invalidateQueries({ queryKey: options.queryKey });
  useBusSubscription("sse.event", ({ message }) => {
    if (
      message.type === "sync_changed" &&
      message.tags.includes(SYNC_TAGS.assistantDesktop)
    ) {
      void refresh();
    }
  });
  useBusSubscription("sse.opened", () => {
    void refresh();
  });
  const update = useDesktopControlPostMutation({ onSettled: refresh });
  const state = query.data?.state;
  const failed = query.isError || update.isError;
  const viewOnly =
    query.isPending || failed || update.isPending || state === "assistant";
  return (
    <>
      {controlsContainer &&
        (state !== "idle" || failed) &&
        createPortal(
          <div
            className="flex items-center gap-3"
            role="status"
            aria-live="polite"
          >
            <span className="max-w-[20vw] truncate text-body-small-lighter text-white/90 sm:max-w-xs">
              {failed
                ? t("assistantDesktop.controlFailed")
                : state === "assistant"
                  ? t("assistantDesktop.assistantControlling")
                  : state === "human"
                    ? t("assistantDesktop.userControlling")
                    : t("assistantDesktop.controlReady")}
            </span>
            {failed ? (
              <Button
                variant="outlined"
                expandOnMobile={false}
                className="h-11 shrink-0 border-white/20 text-white/90"
                tintColor="currentColor"
                onClick={() => {
                  update.reset();
                  void query.refetch();
                }}
              >
                {t("assistantDesktop.reconnectButton")}
              </Button>
            ) : state === "assistant" || state === "human" ? (
              <Button
                variant="outlined"
                expandOnMobile={false}
                className="h-11 shrink-0 border-white/20 text-white/90"
                tintColor="currentColor"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate({
                    path: { assistant_id: assistantId },
                    body: { action: state === "assistant" ? "take" : "allow" },
                  })
                }
              >
                {state === "assistant"
                  ? t("assistantDesktop.takeControl")
                  : t("assistantDesktop.allowAssistant")}
              </Button>
            ) : null}
          </div>,
          controlsContainer,
        )}
      {children(viewOnly)}
    </>
  );
}
