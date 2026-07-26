type RunMermaid = (sourcePath: string, outputPath: string, signal?: AbortSignal) => Promise<void>;

export interface MermaidBackend {
  browserChannel: string;
  executablePath?: string;
  theme: string;
  backgroundColor: string;
  run?: RunMermaid;
}
