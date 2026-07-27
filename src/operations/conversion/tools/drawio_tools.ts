export type RunDrawio = (executable: string, args: string[], signal?: AbortSignal) => Promise<void>;

export interface DrawioBackend {
  drawioPath: string;
  runDrawio?: RunDrawio;
}
