import { describe, expect, it } from 'vitest'

import { normalizeAvatarUrl, readAuthor, readAuthors } from './author.ts'

const FIELDS = { login: 'login', displayName: 'name', avatarUrl: 'avatarUrl' } as const

describe('创建人解析', () => {
  it('读出登录名、展示名与头像地址', () => {
    const author = readAuthor(
      {
        login: 'cnzgray',
        name: 'Cnzgray',
        avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
      },
      FIELDS,
    )

    expect(author).toEqual({
      login: 'cnzgray',
      displayName: 'Cnzgray',
      avatarUrl: 'https://avatars.githubusercontent.com/u/1?v=4',
    })
  })

  it('没有展示名或展示名为空时退回 null', () => {
    expect(readAuthor({ login: 'cnzgray', name: '   ' }, FIELDS)?.displayName).toBeNull()
    expect(readAuthor({ login: 'cnzgray' }, FIELDS)?.displayName).toBeNull()
  })

  it('用户对象缺失、不是对象或登录名为空时整体为 null', () => {
    expect(readAuthor(null, FIELDS)).toBeNull()
    expect(readAuthor(undefined, FIELDS)).toBeNull()
    expect(readAuthor('cnzgray', FIELDS)).toBeNull()
    expect(readAuthor({ name: 'Cnzgray' }, FIELDS)).toBeNull()
    expect(readAuthor({ login: '   ' }, FIELDS)).toBeNull()
  })

  it('头像地址是相对路径时按实例主机补成绝对地址', () => {
    const author = readAuthor(
      { login: 'cnzgray', avatarUrl: '/avatars/1' },
      FIELDS,
      'https://gitea.example.com',
    )

    expect(author?.avatarUrl).toBe('https://gitea.example.com/avatars/1')
  })

  it('用户数组按同一套规则解析，跳过识别不出来的元素', () => {
    const authors = readAuthors(
      [
        { login: 'alice', name: 'Alice', avatarUrl: '/avatars/alice' },
        null,
        { name: '没有登录名' },
        { login: 'bob', avatarUrl: 'javascript:alert(1)' },
      ],
      FIELDS,
      'https://gitea.example.com',
    )

    expect(authors).toEqual([
      { login: 'alice', displayName: 'Alice', avatarUrl: 'https://gitea.example.com/avatars/alice' },
      { login: 'bob', displayName: null, avatarUrl: null },
    ])
  })

  it('不是数组的用户集合按空列表处理', () => {
    expect(readAuthors(null, FIELDS)).toEqual([])
    expect(readAuthors({ login: 'alice' }, FIELDS)).toEqual([])
  })

  it('非 http(s) 地址按无头像处理', () => {
    expect(normalizeAvatarUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeAvatarUrl('data:image/png;base64,AAAA')).toBeNull()
    expect(normalizeAvatarUrl('/avatars/1')).toBeNull()
    expect(normalizeAvatarUrl('')).toBeNull()
    expect(normalizeAvatarUrl(null)).toBeNull()
    expect(normalizeAvatarUrl('http://example.com/a.png')).toBe('http://example.com/a.png')
  })
})
