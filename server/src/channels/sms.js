import crypto from 'node:crypto'

/**
 * 短信渠道。
 * - dev：不接网关，验证码打在日志里并由接口回显（本地 / CI 用）
 * - aliyun：阿里云短信 dysmsapi（RPC 风格签名，HMAC-SHA1），需要四个环境变量
 *
 * 渠道在每次调用时按当前 process.env 构造，方便测试与灰度切换。
 */

/** 阿里云要求的百分号编码：空格 %20、* %2A、~ 不编码 */
export function aliyunEncode(value) {
  return encodeURIComponent(String(value))
    .replace(/\+/g, '%20')
    .replace(/\*/g, '%2A')
    .replace(/%7E/g, '~')
}

/**
 * 阿里云 RPC 签名：
 *   待签串 = GET&%2F&<按 key 排序并编码后的 k=v 用 & 连接>
 *   签名   = Base64(HMAC-SHA1(AccessKeySecret + '&', 待签串))
 */
export function aliyunSign(params, accessKeySecret) {
  const canonical = Object.keys(params)
    .sort()
    .map((k) => `${aliyunEncode(k)}=${aliyunEncode(params[k])}`)
    .join('&')
  const stringToSign = `GET&${aliyunEncode('/')}&${aliyunEncode(canonical)}`
  return crypto.createHmac('sha1', `${accessKeySecret}&`).update(stringToSign).digest('base64')
}

export function devSmsChannel() {
  return {
    name: 'dev',
    async send(phone, code) {
      console.log(`[sms:dev] ${phone} -> ${code}`)
      return { delivered: true, dev: true }
    },
  }
}

function need(env, key) {
  const v = env[key]
  if (!v) throw new Error(`缺少环境变量 ${key}（SMS_PROVIDER=aliyun 时必填）`)
  return v
}

export function aliyunSmsChannel(env = process.env) {
  const accessKeyId = need(env, 'ALIYUN_SMS_ACCESS_KEY_ID')
  const accessKeySecret = need(env, 'ALIYUN_SMS_ACCESS_KEY_SECRET')
  const signName = need(env, 'ALIYUN_SMS_SIGN_NAME')
  const templateCode = need(env, 'ALIYUN_SMS_TEMPLATE_CODE')
  const regionId = env.ALIYUN_SMS_REGION || 'cn-hangzhou'
  const endpoint = env.ALIYUN_SMS_ENDPOINT || 'https://dysmsapi.aliyuncs.com/'

  return {
    name: 'aliyun',
    async send(phone, code) {
      const params = {
        AccessKeyId: accessKeyId,
        Action: 'SendSms',
        Format: 'JSON',
        PhoneNumbers: phone,
        RegionId: regionId,
        SignName: signName,
        SignatureMethod: 'HMAC-SHA1',
        SignatureNonce: crypto.randomUUID(),
        SignatureVersion: '1.0',
        TemplateCode: templateCode,
        TemplateParam: JSON.stringify({ code }),
        Timestamp: new Date().toISOString().replace(/\.\d{3}Z$/, 'Z'),
        Version: '2017-05-25',
      }
      params.Signature = aliyunSign(params, accessKeySecret)

      // 注意：查询串必须用与签名相同的编码规则，不能交给 URLSearchParams
      const query = Object.keys(params)
        .map((k) => `${aliyunEncode(k)}=${aliyunEncode(params[k])}`)
        .join('&')

      const res = await fetch(`${endpoint}?${query}`, { method: 'GET' })
      const body = await res.json().catch(() => null)
      if (!res.ok || body?.Code !== 'OK') {
        throw new Error(
          `阿里云短信发送失败：HTTP ${res.status} ${body?.Code || ''} ${body?.Message || ''}`.trim(),
        )
      }
      return { delivered: true, bizId: body?.BizId }
    },
  }
}

export function createSmsChannel(env = process.env) {
  const provider = env.SMS_PROVIDER || 'dev'
  if (provider === 'dev') return devSmsChannel()
  if (provider === 'aliyun') return aliyunSmsChannel(env)
  throw new Error(`未知的 SMS_PROVIDER：${provider}（可选 dev / aliyun）`)
}
