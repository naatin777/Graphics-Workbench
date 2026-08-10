function installMapGetOrInsertComputed(): void {
  type MapWithGetOrInsertComputed<K, V> = Map<K, V> & {
    getOrInsertComputed?: (key: K, callback: (key: K) => V) => V;
  };

  const mapPrototype = Map.prototype as MapWithGetOrInsertComputed<never, never>;

  if (!mapPrototype.getOrInsertComputed) {
    Object.defineProperty(mapPrototype, 'getOrInsertComputed', {
      configurable: true,
      writable: true,
      value<K, V>(this: MapWithGetOrInsertComputed<K, V>, key: K, callback: (key: K) => V) {
        if (this.has(key)) {
          return this.get(key) as V;
        }

        const value = callback(key);
        this.set(key, value);
        return value;
      },
    });
  }
}

installMapGetOrInsertComputed();
