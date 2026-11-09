import { describe, expect, it } from 'vitest'
import { DEFAULT_SIDEBAR_WIDTHS, fitSidebarWidths, MIN_SIDEBAR_WIDTHS, MIN_TIMELINE_WIDTH, parseSidebarWidths } from './sidebar-widths'

describe('侧栏宽度偏好', () => {
  it('读取有效偏好', () => {
    expect(parseSidebarWidths('{"left":320,"right":480}')).toEqual({ left: 320, right: 480 })
  })

  it.each([null, '', '{', 'null', '[]', '{}', '{"left":0,"right":480}', '{"left":-1,"right":480}', '{"left":"320","right":480}', '{"left":1e999,"right":480}'])(
    '缺失或无效偏好回退到默认值：%s', (raw) => {
      expect(parseSidebarWidths(raw)).toEqual(DEFAULT_SIDEBAR_WIDTHS)
    },
  )

  it('窗口足够宽时保留偏好', () => {
    expect(fitSidebarWidths({ left: 320, right: 480 }, 1440)).toEqual({ left: 320, right: 480 })
  })

  it('小于最小侧栏宽度的偏好被约束', () => {
    expect(fitSidebarWidths({ left: 1, right: 1 }, 1280)).toEqual(MIN_SIDEBAR_WIDTHS)
  })

  it.each([981, 1000, 1180, 1280, 1920])('在 %i px 窗口中为时间轴保留最小宽度', (viewport) => {
    const preferred = { left: 800, right: 1200 }
    const fitted = fitSidebarWidths(preferred, viewport)
    expect(fitted.left).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTHS.left)
    expect(fitted.right).toBeGreaterThanOrEqual(MIN_SIDEBAR_WIDTHS.right)
    expect(viewport - fitted.left - fitted.right).toBeGreaterThanOrEqual(MIN_TIMELINE_WIDTH)
    expect(preferred).toEqual({ left: 800, right: 1200 })
  })
})
