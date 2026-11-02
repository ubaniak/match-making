// Design tokens: the Navy & Gold scheme Bhavek picked on 2026-11-02. Light pages, a glossy navy header,
// navy buttons, gold highlights. Sized for an older audience: 17px text, 44px controls, AA+ contrast.
// There is no dark palette and never a dark algorithm.
import { theme as antTheme } from 'antd'

export const colors = {
  // Brand
  navy: '#1e3a8a', // primary: buttons, links, active tabs (10.4:1 on white)
  navyHover: '#1d4ed8',
  navyDeep: '#14245a', // text on gold, page titles
  navyTop: '#3b5bcc', // top of the button gloss
  gold: '#f5b800', // header stripe, active nav pill (navyDeep on gold is 8.2:1)
  goldSoft: '#fde68a', // table headers, highlights
  // Surfaces
  bg: '#f3f5fa', // page background, a light navy tint
  bgElevated: '#ffffff', // cards, header buttons, modals
  bgSubtle: '#eef1f8', // forms inside a section
  // Text
  text: '#111111',
  textMuted: '#333333',
  textFaint: '#4a4a4a',
  // Lines
  border: '#9aa1ab',
  borderSubtle: '#dde1e7',
  // Status
  error: '#b00000',
  success: '#15803d',
  warning: '#b45309',
  // Boxing corners: only to mark the red and blue corner.
  cornerRed: '#b91c1c',
  cornerBlue: '#1d4ed8',
  shadowSm: '0 4px 16px rgba(30,58,138,0.18)',
  shadowMd: '0 8px 24px rgba(30,58,138,0.10), 0 2px 6px rgba(0,0,0,0.06)',
  shadowLg: '0 16px 40px rgba(30,58,138,0.18)',
  insetHighlight: 'rgba(255,255,255,0.9)',
}

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 }

export const radius = { sm: 10, md: 12, lg: 18, xl: 20, pill: 999 }

export const pageWidth = 1280

export const antdTheme = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: colors.navy,
    colorInfo: colors.navy,
    colorSuccess: colors.success,
    colorWarning: colors.warning,
    colorError: colors.error,
    colorLink: colors.navy,
    colorLinkHover: colors.navyHover,
    colorLinkActive: colors.navyDeep,
    colorText: colors.text,
    colorTextBase: colors.text,
    colorTextSecondary: colors.textMuted,
    colorTextTertiary: colors.textFaint,
    colorTextDescription: colors.textFaint,
    colorTextPlaceholder: '#6b7280', // 4.8:1 on white
    colorBgBase: colors.bgElevated,
    colorBgLayout: colors.bg,
    colorBorder: colors.border,
    colorBorderSecondary: colors.borderSubtle,
    fontSize: 17,
    fontSizeLG: 18,
    fontSizeSM: 15,
    controlHeight: 44,
    controlHeightLG: 52,
    controlHeightSM: 34,
    lineWidthFocus: 3,
    borderRadius: radius.sm,
    borderRadiusLG: radius.lg,
    boxShadow: colors.shadowSm,
    boxShadowSecondary: colors.shadowMd,
    fontSizeHeading1: 32,
    fontSizeHeading2: 26,
    fontSizeHeading3: 21,
    fontSizeHeading4: 18,
    fontFamily: "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  components: {
    Layout: { headerBg: colors.navy, bodyBg: colors.bg, headerColor: '#ffffff' },
    Button: { borderRadius: radius.md, fontWeight: 600, primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
    Card: { borderRadiusLG: radius.lg },
    Table: { borderRadiusLG: radius.md, headerBg: colors.goldSoft, headerColor: colors.navyDeep, cellPaddingBlock: 14 },
    Modal: { borderRadiusLG: radius.lg },
    Drawer: { borderRadiusLG: radius.lg },
    Select: { borderRadius: radius.sm },
    Input: { borderRadius: radius.sm },
    Tabs: { itemSelectedColor: colors.navy, inkBarColor: colors.navy, itemHoverColor: colors.navyHover, itemActiveColor: colors.navyDeep, titleFontSize: 17 },
  },
}
