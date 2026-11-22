// Biblioteca SIMULADA, só para testar a ponte sem rede: mesma forma de eventos da tiktok-live-connector 2.x.
// A ponte real (server.js) carrega esta pasta quando o teste define NODE_PATH para test/stub.
'use strict';
const { EventEmitter } = require('events');
const WebcastEvent = { CHAT: 'chat', GIFT: 'gift', LIKE: 'like', FOLLOW: 'follow', SHARE: 'share' };
const ControlEvent = { ERROR: 'error', DISCONNECTED: 'disconnected' };
let created = 0;

class TikTokLiveConnection extends EventEmitter {
  constructor(username, options) {
    super();
    this.username = username;
    this.options = options;
    this.n = ++created;
  }
  async connect() {
    setTimeout(() => this.script(), 300);
    return { roomId: 'sala-simulada' };
  }
  script() {
    const user = { uniqueId: 'ana', nickname: 'Ana', userId: '1', avatarThumb: { urlList: ['https://cdn.exemplo.test/ana.webp'] } };
    if (this.n === 1) {
      this.emit('chat', { user, comment: 'azul' });
      this.emit('gift', { user, giftId: 1, repeatCount: 2, repeatEnd: false, giftDetails: { giftType: 1, giftName: 'Rose', diamondCount: 1 } }); // sequência em andamento: deve ser ignorada
      this.emit('gift', { user, giftId: 1, repeatCount: 3, repeatEnd: true, giftDetails: { giftType: 1, giftName: 'Rose', diamondCount: 1 } });
      this.emit('like', { user, likeCount: 7, totalLikeCount: 100 });
      this.emit('follow', { user });
      this.emit('share', { user });
      this.emit('chat', { user: { uniqueId: 'semfoto', nickname: 'SemFoto', userId: '2' }, comment: 'vermelho' }); // sem avatar
      setTimeout(() => this.emit('disconnected'), 200);
    } else {
      this.emit('chat', { user: { uniqueId: 'voltou', nickname: 'Voltou', userId: '3' }, comment: 'vermelho' });
    }
  }
}
module.exports = { TikTokLiveConnection, WebcastEvent, ControlEvent };
