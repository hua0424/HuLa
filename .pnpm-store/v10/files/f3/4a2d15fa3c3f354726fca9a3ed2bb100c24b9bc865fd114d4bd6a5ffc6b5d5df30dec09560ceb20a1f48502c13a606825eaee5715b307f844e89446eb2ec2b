"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.ts
var index_exports = {};
__export(index_exports, {
  PiniaSharedState: () => PiniaSharedState,
  share: () => share
});
module.exports = __toCommonJS(index_exports);
var import_broadcast_channel2 = require("broadcast-channel");

// src/utils.ts
function serialize(obj, serializer = { serialize: JSON.stringify, deserialize: JSON.parse }) {
  return serializer.deserialize(serializer.serialize(obj));
}

// src/vanilla.ts
var import_broadcast_channel = require("broadcast-channel");
function share(key, store, { initialize, serializer, type }) {
  const channelName = `${store.$id}-${key.toString()}`;
  const channel = new import_broadcast_channel.BroadcastChannel(channelName, {
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
    const channel = new import_broadcast_channel2.BroadcastChannel(store.$id, {
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
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  PiniaSharedState,
  share
});
//# sourceMappingURL=index.cjs.map