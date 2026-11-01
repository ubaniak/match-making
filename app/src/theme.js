// Design tokens, after the scoreboard app's light palette (github.com/ubaniak/scoreboard, frontend/src/theme.ts),
// kept black on white. There is no dark palette and never a dark algorithm.
import { theme as antTheme } from 'antd'

export const colors = {
  bg: '#ffffff',
  bgElevated: '#ffffff',
  bgSubtle: '#fafafa',
  text: '#000000',
  textMuted: 'rgba(0,0,0,0.65)',
  textFaint: 'rgba(0,0,0,0.55)',
  border: 'rgba(0,0,0,0.18)',
  borderSubtle: 'rgba(0,0,0,0.10)',
  error: '#b00000',
  // Boxing corners. The only colours besides black, white and the error red.
  cornerRed: '#b91c1c',
  cornerBlue: '#1d4ed8',
  shadowSm: '0 2px 8px rgba(0,0,0,0.08)',
  shadowMd: '0 6px 20px rgba(0,0,0,0.12)',
  shadowLg: '0 16px 40px rgba(0,0,0,0.16)',
  insetHighlight: 'rgba(255,255,255,0.7)',
}

export const space = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 }

export const radius = { sm: 8, md: 12, lg: 16, xl: 20, pill: 999 }

export const pageWidth = 1280

export const antdTheme = {
  algorithm: antTheme.defaultAlgorithm,
  token: {
    colorPrimary: colors.text,
    colorInfo: colors.text,
    colorSuccess: colors.text,
    colorWarning: colors.text,
    colorError: colors.error,
    colorLink: colors.text,
    colorLinkHover: '#444444',
    colorLinkActive: colors.text,
    colorText: colors.text,
    colorTextBase: colors.text,
    colorBgBase: colors.bg,
    colorBgLayout: colors.bg,
    colorBorder: '#bfbfbf',
    colorBorderSecondary: '#e5e5e5',
    borderRadius: radius.sm,
    borderRadiusLG: radius.lg,
    boxShadow: colors.shadowSm,
    boxShadowSecondary: colors.shadowMd,
    fontSizeHeading1: 28,
    fontSizeHeading2: 22,
    fontSizeHeading3: 18,
    fontSizeHeading4: 16,
    fontFamily: "'Roboto', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  },
  components: {
    Layout: { headerBg: colors.bgElevated, bodyBg: colors.bg, headerColor: colors.text },
    Button: { borderRadius: radius.md, primaryShadow: 'none', defaultShadow: 'none', dangerShadow: 'none' },
    Card: { borderRadiusLG: radius.lg },
    Table: { borderRadiusLG: radius.md, headerBg: colors.bgSubtle, headerColor: colors.textMuted },
    Modal: { borderRadiusLG: radius.lg },
    Drawer: { borderRadiusLG: radius.lg },
    Select: { borderRadius: radius.sm },
    Input: { borderRadius: radius.sm },
    Tabs: { itemSelectedColor: colors.text, inkBarColor: colors.text, itemHoverColor: '#444444', itemActiveColor: colors.text },
    Alert: {
      colorInfoBg: colors.bgElevated, colorInfoBorder: colors.border,
      colorSuccessBg: colors.bgElevated, colorSuccessBorder: colors.border,
      colorWarningBg: colors.bgElevated, colorWarningBorder: colors.text,
    },
  },
}
