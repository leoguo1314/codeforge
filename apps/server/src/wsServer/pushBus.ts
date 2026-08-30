import {
  ORCHESTRATION_WS_CHANNELS,
  WS_CHANNELS,
  WsPush,
  type OrchestrationEvent,
  type WsPushChannel,
  type WsPushData,
  type WsPushEnvelopeBase,
} from "@codeforge/contracts";
import { Deferred, Effect, Queue, Ref, Schema } from "effect";
import type { Scope } from "effect";
import type { WebSocket } from "ws";

import { mobileNotificationFromEvent } from "./mobileNotifications.ts";

type PushTarget =
  | { readonly kind: "all" }
  | { readonly kind: "client"; readonly client: WebSocket };

interface PushJob<C extends WsPushChannel = WsPushChannel> {
  readonly channel: C;
  readonly data: WsPushData<C>;
  readonly target: PushTarget;
  readonly delivered: Deferred.Deferred<boolean> | null;
}

export interface ServerPushBus {
  readonly publishAll: <C extends WsPushChannel>(
    channel: C,
    data: WsPushData<C>,
  ) => Effect.Effect<void>;
  readonly publishClient: <C extends WsPushChannel>(
    client: WebSocket,
    channel: C,
    data: WsPushData<C>,
  ) => Effect.Effect<boolean>;
}

export const makeServerPushBus = (input: {
  readonly clients: Ref.Ref<Set<WebSocket>>;
  readonly logOutgoingPush: (push: WsPushEnvelopeBase, recipients: number) => void;
}): Effect.Effect<ServerPushBus, never, Scope.Scope> =>
  Effect.gen(function* () {
    const nextSequence = yield* Ref.make(0);
    const queue = yield* Queue.unbounded<PushJob>();
    const encodePush = Schema.encodeUnknownEffect(Schema.fromJsonString(WsPush));

    const settleDelivery = (job: PushJob, delivered: boolean) =>
      job.delivered === null
        ? Effect.void
        : Deferred.succeed(job.delivered, delivered).pipe(Effect.orDie);

    const send = Effect.fnUntraced(function* (job: PushJob) {
      const sequence = yield* Ref.updateAndGet(nextSequence, (current) => current + 1);
      const push: WsPushEnvelopeBase = {
        type: "push",
        sequence,
        channel: job.channel,
        data: job.data,
      };
      const recipients =
        job.target.kind === "all" ? yield* Ref.get(input.clients) : new Set([job.target.client]);

      return yield* encodePush(push).pipe(
        Effect.map((message) => {
          let recipientCount = 0;
          for (const client of recipients) {
            if (client.readyState !== client.OPEN) {
              continue;
            }
            client.send(message);
            recipientCount += 1;
          }

          input.logOutgoingPush(push, recipientCount);
          return recipientCount > 0;
        }),
      );
    });

    yield* Effect.forkScoped(
      Effect.forever(
        Queue.take(queue).pipe(
          Effect.flatMap((job) =>
            send(job).pipe(
              Effect.tap((delivered) => settleDelivery(job, delivered)),
              Effect.tapCause(() => settleDelivery(job, false)),
              Effect.ignoreCause({ log: true }),
            ),
          ),
        ),
      ),
    );

    const publish =
      (target: PushTarget) =>
      <C extends WsPushChannel>(channel: C, data: WsPushData<C>) =>
        Queue.offer(queue, {
          channel,
          data,
          target,
          delivered: null,
        }).pipe(Effect.asVoid);

    const publishAllBase = publish({ kind: "all" });

    const publishAll: ServerPushBus["publishAll"] = (channel, data) =>
      Effect.gen(function* () {
        yield* publishAllBase(channel, data);
        if (channel !== ORCHESTRATION_WS_CHANNELS.domainEvent) return;

        const notification = mobileNotificationFromEvent(data as OrchestrationEvent);
        if (notification) {
          yield* publishAllBase(WS_CHANNELS.mobileNotification, notification);
        }
      });

    return {
      publishAll,
      publishClient: (client, channel, data) =>
        Effect.gen(function* () {
          const delivered = yield* Deferred.make<boolean>();
          yield* Queue.offer(queue, {
            channel,
            data,
            target: { kind: "client", client },
            delivered,
          }).pipe(Effect.asVoid);
          return yield* Deferred.await(delivered);
        }),
    } satisfies ServerPushBus;
  });
