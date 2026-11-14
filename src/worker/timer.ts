/**
 * worker 侧的计时服务。Orca 没有暴露 DSH 的 timer 服务，
 * 这里直接用 `setTimeout`，语义保持一致：注册超时回调，返回取消函数。
 */

/** 计时服务；worker 内部只需要「延时触发并可取消」这一件事。 */
export interface TimerLike {
  /** 延时触发回调；返回的函数取消这次触发。 */
  timeout(callback: () => void, delay: number): () => void
}

/**
 * 创建基于 `setTimeout` 的计时服务。
 * @returns 计时服务。
 */
export function createTimer(): TimerLike {
  return {
    timeout(callback, delay) {
      const handle = setTimeout(callback, delay)
      // 计时器不该拖住进程退出：worker 由宿主管理生命周期。
      handle.unref()
      return () => {
        clearTimeout(handle)
      }
    },
  }
}
