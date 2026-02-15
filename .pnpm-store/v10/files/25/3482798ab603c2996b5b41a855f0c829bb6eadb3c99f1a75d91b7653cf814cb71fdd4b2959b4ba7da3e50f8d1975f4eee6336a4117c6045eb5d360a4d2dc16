import { Store, PiniaPluginContext } from 'pinia';
import { MethodType } from 'broadcast-channel';

interface Serializer {
    serialize: (value: any) => string;
    deserialize: (value: string) => any;
}

interface Options {
    initialize?: boolean;
    type?: MethodType;
    serializer?: Serializer;
}
/**
 * Share state across browser tabs.
 *
 * @example
 *
 * ```ts
 * import useStore from './store'
 *
 * const counterStore = useStore()
 *
 * share('counter', counterStore, { initialize: true })
 * ```
 *
 * @param key - A property of a store state.
 * @param store - The store the plugin will augment.
 * @param options - Share state options.
 * @param options.initialize - Immediately recover the shared state from another tab.
 * @param options.type - 'native', 'idb', 'localstorage', 'node'.
 * @param options.serializer - Custom serializer to serialize state before broadcasting.
 */
declare function share<T extends Store, K extends keyof T['$state']>(key: K, store: T, { initialize, serializer, type }: Options): {
    sync: () => void;
    unshare: () => void;
};

/**
 * Adds a `share` option to your store to share state across browser tabs.
 *
 * @example
 *
 * ```ts
 * import { PiniaSharedState } from 'pinia-shared-state'
 *
 * // Pass the plugin to your application's pinia plugin
 * pinia.use(PiniaSharedState({ enable: true, initialize: false, type: 'localstorage' }))
 * ```
 *
 * @param options - Global plugin options.
 * @param options.enable - Enable/disable sharing of state for all stores.
 * @param options.initialize - Immediately recover the shared state from another tab.
 * @param options.type - 'native', 'idb', 'localstorage', 'node'.
 * @param options.serializer - Custom serializer to serialize store state before broadcasting.
 */
declare function PiniaSharedState({ enable, initialize, type, serializer, }: Options & {
    enable?: boolean;
}): ({ store, options }: PiniaPluginContext) => void;

declare module 'pinia' {
    interface DefineStoreOptionsBase<S, Store> {
        /**
         * Override global config.
         *
         * @example
         *
         * ```js
         * defineStore({
         *   id: 'counter',
         *   state: () => ({ count: 0, name: 'John Doe' })
         *   share: {
         *     // An array of fields that the plugin will ignore.
         *     omit: ['name'],
         *     // Enable/disable sharing of state for this store.
         *     enable: false
         *     // If set to true this tab tries to immediately recover the
         *     // shared state from another tab. Defaults to true.
         *     initialize: false
         *     // Serialize store state before broadcasting. Defaults to `JSON.stringify`/`JSON.parse`.
         *     serializer: {
         *      serialize: JSON.stringify
         *      deserialize: JSON.parse
         *     }
         *   }
         * })
         * ```
         */
        share?: {
            omit?: Array<keyof S>;
            enable?: boolean;
            initialize?: boolean;
        };
    }
}

export { PiniaSharedState, share };
