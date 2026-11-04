import type { Config } from 'tailwindcss'
// @ts-expect-error -- shared preset is plain CJS, no types needed
import preset from '@chat-arena/tailwind-preset'

export default {
  presets: [preset],
  content: [
    './index.html',
    './src/**/*.{ts,tsx}',
    // UserMenu(头像菜单) 来自该包，需扫描以生成其样式类
    '../packages/auth-client-web/src/**/*.{ts,tsx}',
  ],
} satisfies Config
