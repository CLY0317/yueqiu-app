import crypto from 'node:crypto'

/**
 * 支付渠道。
 * - dev：本地直接置为已支付（模拟网关）
 * - wechat：微信支付 APIv3 的 Native 下单 + 回调验签 / 解密
 *
 * 这里的函数都是纯的（不碰数据库），路由负责状态流转与幂等。
 */

/* -------------------------- 微信支付 APIv3 签名 -------------------------- */

/** 待签串：请求方法、路径、时间戳、随机串、请求体各占一行（末尾再加一个换行） */
export function wechatSignMessage({ method, urlPath, timestamp, nonce, body }) {
  return `${method}\n${urlPath}\n${timestamp}\n${nonce}\n${body}\n`
}

export function buildWechatAuthorization({
  method,
  urlPath,
  body = '',
  mchid,
  serialNo,
  privateKey,
  timestamp = Math.floor(Date.now() / 1000),
  nonce = crypto.randomBytes(16).toString('hex'),
}) {
  const message = wechatSignMessage({ method, urlPath, timestamp, nonce, body })
  const signature = crypto.sign('RSA-SHA256', Buffer.from(message), privateKey).toString('base64')
  const header =
    `WECHATPAY2-SHA256-RSA2048 mchid="${mchid}",nonce_str="${nonce}",` +
    `signature="${signature}",timestamp="${timestamp}",serial_no="${serialNo}"`
  return { header, message, signature, timestamp, nonce }
}

/** 回调验签：待签串 = 时间戳 \n 随机串 \n 原始报文 \n，用微信平台证书公钥验证 */
export function verifyWechatNotify({ timestamp, nonce, signature, rawBody, platformPublicKey }) {
  const message = `${timestamp}\n${nonce}\n${rawBody}\n`
  return crypto.verify(
    'RSA-SHA256',
    Buffer.from(message),
    platformPublicKey,
    Buffer.from(signature, 'base64'),
  )
}

/** 回调解密：AES-256-GCM，密文 base64，末 16 字节是 authTag */
export function decryptWechatResource(resource, apiV3Key) {
  const { ciphertext, nonce, associated_data: aad } = resource || {}
  if (!ciphertext || !nonce) throw new Error('回调资源缺少 ciphertext / nonce')
  const buf = Buffer.from(ciphertext, 'base64')
  const tag = buf.subarray(buf.length - 16)
  const data = buf.subarray(0, buf.length - 16)
  const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(apiV3Key), Buffer.from(nonce))
  decipher.setAuthTag(tag)
  if (aad) decipher.setAAD(Buffer.from(aad))
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  return JSON.parse(plain)
}

/* ------------------------------ 渠道实现 ------------------------------ */

export function devPaymentChannel() {
  return {
    name: 'dev',
    // 模拟网关：调用方拿到 paidImmediately 后自己把订单置为已支付
    async createOrder() {
      return { provider: 'dev', paidImmediately: true }
    },
    async parseNotify() {
      throw new Error('dev 渠道没有回调，请直接把订单标记为已支付')
    },
  }
}

function need(env, key) {
  const v = env[key]
  if (!v) throw new Error(`缺少环境变量 ${key}（PAY_PROVIDER=wechat 时必填）`)
  return v
}

export function wechatPaymentChannel(env = process.env) {
  const appid = need(env, 'WECHAT_APPID')
  const mchid = need(env, 'WECHAT_MCHID')
  const serialNo = need(env, 'WECHAT_CERT_SERIAL_NO')
  const privateKey = need(env, 'WECHAT_PRIVATE_KEY_PEM')
  const apiV3Key = need(env, 'WECHAT_API_V3_KEY')
  const platformPublicKey = need(env, 'WECHAT_PLATFORM_PUBLIC_KEY_PEM')
  const baseURL = env.WECHAT_BASE_URL || 'https://api.mch.weixin.qq.com'

  return {
    name: 'wechat',

    /** Native 下单，返回 code_url（前端渲染成二维码） */
    async createOrder({ orderId, description, amountFen, notifyUrl }) {
      const urlPath = '/v3/pay/transactions/native'
      const body = JSON.stringify({
        appid,
        mchid,
        description,
        out_trade_no: orderId,
        notify_url: notifyUrl,
        amount: { total: amountFen, currency: 'CNY' },
      })
      const { header } = buildWechatAuthorization({
        method: 'POST',
        urlPath,
        body,
        mchid,
        serialNo,
        privateKey,
      })

      const res = await fetch(baseURL + urlPath, {
        method: 'POST',
        headers: {
          Authorization: header,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body,
      })
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        throw new Error(`微信下单失败：HTTP ${res.status} ${data?.code || ''} ${data?.message || ''}`.trim())
      }
      return { provider: 'wechat', codeUrl: data?.code_url, raw: data }
    },

    /** 回调验签 + 解密，返回业务字段；验签失败直接抛错，由路由回 401 */
    async parseNotify({ headers, rawBody }) {
      const timestamp = headers['wechatpay-timestamp']
      const nonce = headers['wechatpay-nonce']
      const signature = headers['wechatpay-signature']
      if (!timestamp || !nonce || !signature) throw new Error('缺少微信支付签名头')

      if (!verifyWechatNotify({ timestamp, nonce, signature, rawBody, platformPublicKey })) {
        throw new Error('微信支付回调验签失败')
      }

      const envelope = JSON.parse(rawBody)
      const payload = decryptWechatResource(envelope.resource, apiV3Key)
      return {
        envelopeId: envelope.id,
        eventType: envelope.event_type,
        outTradeNo: payload.out_trade_no,
        transactionId: payload.transaction_id,
        tradeState: payload.trade_state,
        totalFen: payload.amount?.total,
      }
    },
  }
}

export function createPaymentChannel(env = process.env) {
  const provider = env.PAY_PROVIDER || 'dev'
  if (provider === 'dev') return devPaymentChannel()
  if (provider === 'wechat') return wechatPaymentChannel(env)
  throw new Error(`未知的 PAY_PROVIDER：${provider}（可选 dev / wechat）`)
}
