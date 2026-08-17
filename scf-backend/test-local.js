'use strict';
// 本地模拟腾讯云 SCF 事件测试
process.env.SMTP_HOST = 'smtp.exmail.qq.com';
process.env.SMTP_PORT = '465';
process.env.SMTP_SECURE = 'true';
process.env.SMTP_USER = 'wujiangluo@hmbpo.cn';
process.env.SMTP_PASS = 'MH8cuYuryHB9h4oz';
process.env.SMTP_FROM = 'wujiangluo@hmbpo.cn';
process.env.NOTIFY_EMAIL = 'wujiangluo@hmbpo.cn';

const { main_handler } = require('./index.js');

const event = {
  httpMethod: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    submitter: '本地SCF测试',
    remark: '测试备注',
    items: [
      {
        brand: 'BSB', styleNo: 'BSB01062', category: 'T恤', categoryGroup: '上衣',
        dailyPrice: '29.90', influencerPrice: '19.90', commission: 0.3,
        material: '棉', color: '黑色', sellingPoint: '修身露脐显瘦',
        stock: 6, note: '测试', images: []
      }
    ]
  })
};

main_handler(event, {}).then(res => {
  console.log('STATUS:', res.statusCode);
  console.log('BODY:', res.body);
}).catch(e => {
  console.error('ERROR:', e.message);
  process.exit(1);
});
