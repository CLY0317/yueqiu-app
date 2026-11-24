/**
 * 演示模式开关。
 *
 * 演示模式会暴露：硬编码的演示手机号、"切换演示账号"面板、以及登录页的提示文案。
 * 这些在生产环境必须消失，所以默认是**关**的，只有两种情况会开：
 *   - vite dev 开发服务器（import.meta.env.DEV）
 *   - 构建时显式传 VITE_DEMO_MODE=true
 *
 * 注意：验证码的自动回填不依赖这个开关——那是由服务端是否返回 devCode 决定的，
 * 真实短信渠道不会返回 devCode，所以生产环境自然不会回显验证码。
 */
export const DEMO_MODE = import.meta.env.VITE_DEMO_MODE === 'true' || import.meta.env.DEV
