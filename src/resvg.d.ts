declare module '@resvg/resvg-wasm' {
  export type InitInput = RequestInfo | URL | Response | BufferSource | WebAssembly.Module;

  export type ResvgRenderOptions = {
    fitTo?: { mode: 'original' } | { mode: 'width'; value: number } | { mode: 'height'; value: number } | { mode: 'zoom'; value: number };
    background?: string;
    font?: {
      loadSystemFonts?: boolean;
      defaultFontFamily?: string;
      sansSerifFamily?: string;
      serifFamily?: string;
    };
  };

  export const initWasm: (moduleOrPath: Promise<InitInput> | InitInput) => Promise<void>;
  export const Resvg: {
    new (svg: Uint8Array | string, options?: ResvgRenderOptions): {
      render(): { asPng(): Uint8Array; free(): void };
      free(): void;
    };
  };
}

declare module '@resvg/resvg-wasm/index_bg.wasm' {
  const wasmModule: WebAssembly.Module;
  export default wasmModule;
}
