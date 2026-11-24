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
      // 日志里不落手机号全量与验证码：这两个都是敏感信息，日志文件往往被广泛传阅
      console.log(`[sms:dev] ${maskPhone(phone)} -> ${maskCode(code)}`)
      return { delivered: true, dev: true }
    },
  }
}

export function maskPhone(phone) {
  const s = String(phone || '')
  return s.length >= 11 ? `${s.slice(0, 3)}****${s.slice(-4)}` : s
}

function maskCode(code) {
  const s = String(code || '')
  return s.length > 2 ? `${s.slice(0, 2)}****` : '****'
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
  if (provider === 'dev') {
    // dev 通道会把验证码回显给前端 = 等于没有登录。
    // 生产环境一律禁止；非生产也要显式打开（ALLOW_DEV_SMS=true），
    // 避免"忘了配 SMS_PROVIDER"就把验证码发到网上。
    const isProd = env.NODE_ENV === 'production'
    const allowed = env.ALLOW_DEV_SMS === 'true' || env.ALLOW_DEV_SMS === '1'
    if (isProd) {
      throw new Error('生产环境禁止使用 dev 短信通道：请配置 SMS_PROVIDER=aliyun')
    }
    if (!allowed) {
      throw new Error('dev 短信通道默认关闭，需要显式设置 ALLOW_DEV_SMS=true 才能启用')
    }
    return devSmsChannel()
  }
  if (provider === 'aliyun') return aliyunSmsChannel(env)
  throw new Error(`未知的 SMS_PROVIDER：${provider}（可选 dev / aliyun）`)
}
