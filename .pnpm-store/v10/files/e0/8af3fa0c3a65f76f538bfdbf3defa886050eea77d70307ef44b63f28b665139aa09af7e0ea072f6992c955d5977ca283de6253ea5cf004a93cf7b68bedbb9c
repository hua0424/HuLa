// src/index.ts
import { BroadcastChannel as BroadcastChannelImpl2 } from "broadcast-channel";

// src/utils.ts
function serialize(obj, serializer = { serialize: JSON.stringify, deserialize: JSON.parse }) {
  return serializer.deserialize(serializer.serialize(obj));
}

// src/vanilla.ts
import { BroadcastChannel as BroadcastChannelImpl } from "broadcast-channel";
function share(key, store, { initialize, serializer, type }) {
  const channelName = `${store.$id}-${key.toString()}`;
  const channel = new BroadcastChannelImpl(channelName, {
    type
  });
  let externalUpdate = false;
  let timestamp = 0;
  store.$subscribe((_, state) => {
    if (!externalUpdate) {
      timestamp = Date.now();
      channel.postMessage({
        timestamp,
        newValue: serialize(state, serializer)[key]
      });
    }
    externalUpdate = false;
  });
  channel.onmessage = (evt) => {
    if (evt === void 0) {
      channel.postMessage({
        timestamp,
        // @ts-expect-error: TODO
        newValue: serialize(store.$state, serializer)[key]
      });
      return;
    }
    if (evt.timestamp <= timestamp)
      return;
    externalUpdate = true;
    timestamp = evt.timestamp;
    store[key] = evt.newValue;
  };
  const sync = () => channel.postMessage(void 0);
  const unshare = () => {
    return channel.close();
  };
  if (initialize)
    sync();
  return { sync, unshare };
}

// src/index.ts
function stateHasKey(key, $state) {
  return Object.keys($state).includes(key);
}
function PiniaSharedState({
  enable = true,
  initialize = true,
  type,
  serializer
}) {
  return ({ store, options }) => {
    const isEnabled = options?.share?.enable ?? enable;
    const omittedKeys = options?.share?.omit ?? [];
    if (!isEnabled)
      return;
    const channel = new BroadcastChannelImpl2(store.$id, {
      type
    });
    let timestamp = 0;
    let externalUpdate = false;
    const keysToUpdate = Object.keys(store.$state).filter((key) => !omittedKeys.includes(key) && stateHasKey(key, store.$state));
    channel.onmessage = (newState) => {
      if (newState === void 0) {
        channel.postMessage({
          timestamp,
          state: serialize(store.$state, serializer)
        });
        return;
      }
      if (newState.timestamp <= timestamp)
        return;
      externalUpdate = true;
      timestamp = newState.timestamp;
      store.$patch((state) => {
        keysToUpdate.forEach((key) => {
          state[key] = newState.state[key];
        });
      });
    };
    const shouldInitialize = options?.share?.initialize ?? initialize;
    if (shouldInitialize)
      channel.postMessage(void 0);
    store.$subscribe((_, state) => {
      if (!externalUpdate) {
        timestamp = Date.now();
        channel.postMessage({
          timestamp,
          state: serialize(state, serializer)
        });
      }
      externalUpdate = false;
    });
  };
}
export {
  PiniaSharedState,
  share
};
//# sourceMappingURL=index.js.map