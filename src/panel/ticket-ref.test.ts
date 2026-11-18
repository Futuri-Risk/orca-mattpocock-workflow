import { describe, expect, it } from 'vitest'

import { makeTicket } from './ticket-detail-test-support.ts'
import { blockerNumber, findSnapshotTicket } from './ticket-ref.ts'

describe('blockerNumber', () => {
  it('远端引用转成数字编号', () => {
    expect(blockerNumber('#15')).toBe(15)
  })

  it('本地 Markdown 路径没有编号', () => {
    expect(blockerNumber('.scratch/issues/demo/03-blocked.md')).toBeNull()
  })
})

describe('findSnapshotTicket', () => {
  it('按引用返回快照里的同一行', () => {
    const ticket = makeTicket({ ref: '#7' })
    expect(findSnapshotTicket([makeTicket({ ref: '#6' }), ticket], '#7')).toBe(ticket)
  })

  it('没有快照或引用不在窗口里时返回 null', () => {
    expect(findSnapshotTicket(undefined, '#7')).toBeNull()
    expect(findSnapshotTicket([makeTicket({ ref: '#6' })], '#7')).toBeNull()
  })
})
