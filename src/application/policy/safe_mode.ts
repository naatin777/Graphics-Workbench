const SAFE_MODE_STATE_KEY = 'safeMode.enabled';

export interface StateStorage {
  get(key: 'safeMode.enabled', defaultValue?: boolean): boolean | undefined;
  update(key: 'safeMode.enabled', value: boolean): Thenable<void>;
}

export class SafeModeState {
  constructor(private readonly storage: StateStorage) {}

  isEnabled(): boolean {
    return this.storage.get(SAFE_MODE_STATE_KEY, true) ?? true;
  }

  async toggle(): Promise<boolean> {
    const enabled = !this.isEnabled();
    await this.storage.update(SAFE_MODE_STATE_KEY, enabled);
    return enabled;
  }
}
