/**
 * Orca worker API 的最小本地声明。
 *
 * Orca 把 `orca` 对象传给 `activate(orca)`，运行时并不发布类型入口；
 * 这里只声明插件实际用到的成员，多写的成员不会带来任何约束。
 */

/** 宿主回收插件资源时调用的句柄。 */
export interface OrcaDisposable {
  dispose(): void
}

/** 发起请求的面板：右侧栏面板或自定义编辑器。 */
export interface OrcaPanelCaller {
  readonly id: string
  readonly surface: 'panel' | 'editor'
  readonly contributionId: string
}

/** 面板请求的上下文；signal 在面板关闭或请求超时时中止。 */
export interface OrcaPanelRequestContext {
  readonly panel: OrcaPanelCaller
  readonly signal: AbortSignal
}

/** 面板请求处理器的形状。 */
export type OrcaPanelRequestHandler = (
  input: unknown,
  context: OrcaPanelRequestContext,
) => unknown

/** 宿主方法调用；返回值由各方法自己定义。 */
export type OrcaHostCall = (
  method: string,
  params?: unknown,
  options?: { readonly signal?: AbortSignal },
) => Promise<unknown>

/** worker 拿到的 Orca API。 */
export interface OrcaWorkerApi {
  /** 宿主 API 版本；插件按它判断可用的能力。 */
  readonly api: { readonly major: number; readonly minor: number }
  commands: {
    register(
      commandId: string,
      handler: (args: unknown, context: { readonly signal: AbortSignal }) => unknown,
    ): OrcaDisposable
  }
  events: {
    on(event: string, handler: (payload: unknown) => void | Promise<void>): OrcaDisposable
  }
  host: {
    call: OrcaHostCall
    /** 宿主是否实现了这个方法；不实现时不要调用。 */
    has(method: string): boolean
  }
  panels: {
    handle(name: string, handler: OrcaPanelRequestHandler): OrcaDisposable
    post(event: string, payload?: unknown, options?: { readonly panel?: string }): void
  }
  readonly grantedCapabilities: readonly string[]
  log(message: string): void
}
