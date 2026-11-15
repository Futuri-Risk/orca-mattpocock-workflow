/**
 * Orca 注入到面板窗口的桥。Orca 没有把面板 API 的类型打进这个插件工程，
 * 这里只声明面板真正用到的那一部分，形状与 `orca/frame` 的公开类型一致。
 */

/** 插件设置里的 JSON 值；语言设置只用到字符串。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue }

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

/** 插件设置（`settings:own`）：面板读自己的设置并在变更时重渲染。 */
export interface SettingsBridge {
  /** 读全部设置；面板语言只需要一个键，按 key 取。 */
  get(): Promise<Record<string, JsonValue>>
  /** 读一个设置；缺失时返回 undefined。 */
  get(key: string): Promise<JsonValue | undefined>
  /** 写一个设置；宿主按清单里的类型校验。 */
  set(key: string, value: JsonValue): Promise<void>
  /** 订阅设置变更；宿主设置面板与其它面板的写入都会通知到这里。 */
  onDidChange(listener: (change: { readonly key: string }) => void): Disposable
}

/** 面板窗口里的 `window.orca`。 */
export interface OrcaFrame {
  readonly plugin: PluginBridge
  readonly storage: StorageBridge
  /** 插件设置；旧宿主可能没有这个入口，语言切换器仍可在本次运行内生效。 */
  readonly settings?: SettingsBridge
  /** Orca 的界面语言（BCP-47）；旧宿主可能缺席。 */
  readonly locale?: string
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