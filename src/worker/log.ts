/**
 * worker 侧的日志出口。快照服务与环境检查服务共用同一个形状；
 * 写日志失败由实现兜底，不能影响 RPC 响应。
 */
import type { LogEvent } from '../protocol/log-events.ts'
import type { OrcaWorkerApi } from './orca-types.ts'

/** 记录一条结构化日志。 */
export type LogSink = (
  level: 'info' | 'warn' | 'error',
  event: LogEvent,
  fields: Readonly<Record<string, unknown>>,
) => void

/**
 * 把日志接到 Orca 的 worker 日志上。
 * @param orca - worker API。
 * @returns 日志出口。
 */
export function createLog(orca: OrcaWorkerApi): LogSink {
  return (level, event, fields) => {
    try {
      orca.log(`[mattwf] ${level} ${event} ${JSON.stringify(fields)}`)
    } catch {
      // 日志出口失败不能影响 RPC 响应，但不能静默吞掉：退回标准错误。
      console.error('[mattwf] 日志写入失败', event)
    }
  }
}
