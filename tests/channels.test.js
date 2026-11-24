import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { aliyunEncode, aliyunSign, createSmsChannel } from '../server/src/channels/sms.js'
import {
  buildWechatAuthorization,
  createPaymentChannel,
  decryptWechatResource,
  verifyWechatNotify,
  wechatSignMessage,
} from '../server/src/channels/payment.js'

describe('短信渠道', () => {
  it('百分号编码符合阿里云 RPC 规范', () => {
    expect(aliyunEncode('a b')).toBe('a%20b')
    expect(aliyunEncode('a*b')).toBe('a%2Ab')
    expect(aliyunEncode('a~b')).toBe('a~b')
    expect(aliyunEncode('/')).toBe('%2F')
  })

  it('签名确定且随密钥变化', () => {
    const params = { Action: 'SendSms', PhoneNumbers: '13800000000', Timestamp: '2026-11-21T12:00:00Z' }
    const a = aliyunSign(params, 'secret')
    expect(aliyunSign({ ...params }, 'secret')).toBe(a)
    expect(a).toMatch(/^[A-Za-z0-9+/]+={0,2}$/)
    expect(aliyunSign(params, 'other')).not.toBe(a)
  })

  it('按 provider 选择渠道，未知取值直接报错', () => {
    // dev 通道默认关闭，必须显式开启（它会把验证码回显给前端）
    expect(() => createSmsChannel({ SMS_PROVIDER: 'dev' })).toThrow(/ALLOW_DEV_SMS/)
    expect(createSmsChannel({ SMS_PROVIDER: 'dev', ALLOW_DEV_SMS: 'true' }).name).toBe('dev')
    expect(() => createSmsChannel({ SMS_PROVIDER: 'nope' })).toThrow(/未知的 SMS_PROVIDER/)
    // 选了 aliyun 但没配密钥，要在启动时就炸，而不是发短信时静默失败
    expect(() => createSmsChannel({ SMS_PROVIDER: 'aliyun' })).toThrow(/ALIYUN_SMS_ACCESS_KEY_ID/)
  })
})

describe('微信支付渠道', () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 })

  it('下单签名可被对应公钥验证，且待签串格式正确', () => {
    const args = {
      method: 'POST',
      urlPath: '/v3/pay/transactions/native',
      body: '{"a":1}',
      mchid: '1900000001',
      serialNo: 'SERIAL',
      privateKey,
      timestamp: 1700000000,
      nonce: 'abc',
    }
    const { header, message } = buildWechatAuthorization(args)

    expect(header.startsWith('WECHATPAY2-SHA256-RSA2048 ')).toBe(true)
    expect(header).toContain('mchid="1900000001"')
    expect(header).toContain('serial_no="SERIAL"')

    expect(message).toBe(
      wechatSignMessage({ ...args }),
    )
    expect(message).toBe('POST\n/v3/pay/transactions/native\n1700000000\nabc\n{"a":1}\n')

    const signature = /signature="([^"]+)"/.exec(header)[1]
    const ok = crypto.verify('RSA-SHA256', Buffer.from(message), publicKey, Buffer.from(signature, 'base64'))
    expect(ok).toBe(true)
  })

  it('回调解密能还原业务字段（AES-256-GCM）', () => {
    const apiV3Key = crypto.randomBytes(32)
    const nonce = 'abcdefghijkl'
    const aad = 'transaction'
    const payload = {
      out_trade_no: 'order_1',
      transaction_id: 'wx_1',
      trade_state: 'SUCCESS',
      amount: { total: 3500 },
    }

    const cipher = crypto.createCipheriv('aes-256-gcm', apiV3Key, Buffer.from(nonce))
    cipher.setAAD(Buffer.from(aad))
    const enc = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final()])
    const tag = cipher.getAuthTag()
    const resource = {
      ciphertext: Buffer.concat([enc, tag]).toString('base64'),
      nonce,
      associated_data: aad,
    }

    expect(decryptWechatResource(resource, apiV3Key)).toEqual(payload)
  })

  it('回调验签：报文被改过就验不过', () => {
    const timestamp = '1700000000'
    const nonce = 'n1'
    const rawBody = '{"id":"evt_1"}'
    const signature = crypto
      .sign('RSA-SHA256', Buffer.from(`${timestamp}\n${nonce}\n${rawBody}\n`), privateKey)
      .toString('base64')

    expect(
      verifyWechatNotify({ timestamp, nonce, signature, rawBody, platformPublicKey: publicKey }),
    ).toBe(true)
    expect(
      verifyWechatNotify({
        timestamp,
        nonce,
        signature,
        rawBody: '{"id":"evt_2"}',
        platformPublicKey: publicKey,
      }),
    ).toBe(false)
  })

  it('provider 缺配置时明确报错', () => {
    expect(createPaymentChannel({ PAY_PROVIDER: 'dev' }).name).toBe('dev')
    expect(() => createPaymentChannel({ PAY_PROVIDER: 'wechat' })).toThrow(/WECHAT_APPID/)
    expect(() => createPaymentChannel({ PAY_PROVIDER: 'alipay' })).toThrow(/未知的 PAY_PROVIDER/)
  })
})
