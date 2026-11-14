/**
 * Orca 注入到面板窗口的桥。Orca 没有把面板 API 的类型打进这个插件工程，
 * 这里只声明面板真正用到的那一部分，形状与 `orca/frame` 的公开类型一致。
 */

/** 插件请求的可选项。 */
export interface RequestOptions {
  /** 这次请求的截止时间；宿主上限 120 秒。 */
  readonly timeoutMs?: number
  readonly signal?: AbortSignal
}

/** 插件自己的 worker：面板唯一的业务入口。 */
export interface PluginBridge {
  /** 调用 worker 注册的 handler；worker 不在时会被拒绝。 */
  request(name: string, input?: unknown, options?: RequestOptions): Promise<unknown>
  /** 听 worker 用 `orca.panels.post` 推来的事件。 */
  on(event: string, handler: (payload: unknown) => void): Disposable
}

/** 插件私有存储。 */
export interface StorageBridge {
  get(key: string): Promise<unknown>
  set(key: string, value: unknown): Promise<void>
  delete(key: string): Promise<void>
  keys(): Promise<string[]>
}

/** 事件的退订句柄。 */
export interface Disposable {
  dispose(): void
}

/** 面板窗口里的 `window.orca`。 */
export interface OrcaFrame {
  readonly plugin: PluginBridge
  readonly storage: StorageBridge
  /** 订阅宿主事件；返回退订句柄。 */
  on(event: string, handler: (payload: unknown) => void): Disposable
}

declare global {
  interface Window {
    /** Orca 在插件脚本运行前注入；面板桥不可用时缺席。 */
    orca?: OrcaFrame
  }
}

/**
 * 取得面板桥。
 * @returns 注入的桥；没有注入时为 undefined。
 */
export function readFrame(): OrcaFrame | undefined {
  return typeof window === 'undefined' ? undefined : window.orca
}