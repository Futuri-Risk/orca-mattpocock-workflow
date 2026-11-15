import { describe, expect, it } from 'vitest'

import {
  avatarColor,
  avatarHint,
  avatarInitial,
  avatarLabel,
  usableAvatarUrl,
} from './avatar-display.ts'
import { AVATAR_COLORS } from './ticket-row-styles.ts'

describe('头像展示规则', () => {
  it('只加载 http(s) 的绝对地址', () => {
    expect(usableAvatarUrl('https://avatars.githubusercontent.com/u/1?v=4')).toBe(
      'https://avatars.githubusercontent.com/u/1?v=4',
    )
    expect(usableAvatarUrl('http://gitea.example.com/avatars/1')).toBe(
      'http://gitea.example.com/avatars/1',
    )
    expect(usableAvatarUrl('javascript:alert(1)')).toBeNull()
    expect(usableAvatarUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(usableAvatarUrl('/avatars/1')).toBeNull()
    expect(usableAvatarUrl(null)).toBeNull()
  })

  it('颜色只由登录名决定，同一登录名每次都一样', () => {
    expect(avatarColor('cnzgray')).toBe(avatarColor('cnzgray'))
    expect(AVATAR_COLORS).toContain(avatarColor('cnzgray'))
    expect(AVATAR_COLORS).toContain(avatarColor('alice'))
  })

  it('没有用户时用中性色块', () => {
    const neutral = avatarColor(null)

    expect(AVATAR_COLORS).toContain(neutral)
    expect(avatarInitial(null)).toBe('?')
    expect(avatarLabel('评论作者', null)).toBe('评论作者：未署名')
    expect(avatarHint(null)).toBe('未署名')
  })

  it('无障碍文本带角色与展示名，悬浮说明带展示名与登录名', () => {
    const user = {
      login: 'cnzgray',
      displayName: 'Cnzgray',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
    }

    expect(avatarLabel('创建人', user)).toBe('创建人：Cnzgray')
    expect(avatarHint(user)).toBe('Cnzgray（@cnzgray）')
    expect(avatarInitial(user)).toBe('C')
  })

  it('没有展示名时退回登录名', () => {
    const user = { login: 'cnzgray', displayName: null, avatarUrl: null }

    expect(avatarLabel('分配人', user)).toBe('分配人：cnzgray')
    expect(avatarHint(user)).toBe('@cnzgray')
    expect(avatarInitial(user)).toBe('C')
  })

  it('色块首字母只由登录名决定，展示名改了也不变', () => {
    expect(avatarInitial({ login: 'cnzgray', displayName: '张三', avatarUrl: null })).toBe('C')
    expect(avatarInitial({ login: 'zzz', displayName: null, avatarUrl: null })).toBe('Z')
  })
})
