/** Shared WebSocket transport. Product message handling belongs to subclasses. */
(() => {
  class SocketClient {
    static ws = null;
    static connected = false;
    static messageQueue = [];
    static reconnectAttempts = 0;
    static maxReconnectAttempts = 5;
    static roomEnded = false;
    static sessionReplaced = false;

    static connect(url) {
      return new Promise((resolve, reject) => {
        let socket, timer, opened = false;
        try {
          socket = new WebSocket(url);
          this.ws = socket;
          this.connected = false;
          timer = setTimeout(() => {
            if (opened) return;
            reject(new Error('WebSocket connection timed out'));
            socket.close();
          }, 15000);
          socket.onopen = () => {
            clearTimeout(timer);
            if (socket !== this.ws || this.roomEnded || this.sessionReplaced) {
              socket.close();
              reject(new Error('WebSocket connection cancelled'));
              return;
            }
            opened = true;
            this.connected = true;
            this.reconnectAttempts = 0;
            window.RoomSeating?.connecting();
            this.flushMessageQueue();
            resolve();
          };
          socket.onmessage = event => {
            if (socket !== this.ws || this.roomEnded || this.sessionReplaced) return;
            let data;
            try { data = JSON.parse(event.data); }
            catch (_) { console.warn('[WebSocket] Invalid JSON message'); return; }
            if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string') {
              console.warn('[WebSocket] Invalid message envelope'); return;
            }
            this.handleMessage(data);
          };
          socket.onerror = () => {
            clearTimeout(timer);
            reject(new Error('WebSocket connection failed'));
          };
          socket.onclose = event => {
            clearTimeout(timer);
            if (!opened) reject(new Error('WebSocket closed before connection completed'));
            if (socket !== this.ws) return;
            this.connected = false;
            if (event.code === 4002) this.sessionReplaced = true;
            if (!this.roomEnded) window.RoomSeating?.disconnected();
            if (!this.roomEnded && !this.sessionReplaced) this.attemptReconnect();
          };
        } catch (error) { clearTimeout(timer); reject(error); }
      });
    }

    static send(message) {
      if (this.roomEnded || this.sessionReplaced) return;
      if (this.isConnected()) this.ws.send(JSON.stringify(message));
      else {
        if (this.messageQueue.length >= 300) this.messageQueue.shift();
        this.messageQueue.push(message);
      }
    }
    static flushMessageQueue() {
      if (!this.isConnected()) return;
      while (this.isConnected() && !this.roomEnded && !this.sessionReplaced && this.messageQueue.length) {
        this.send(this.messageQueue.shift());
      }
    }
    static isConnected() {
      return this.connected && this.ws?.readyState === WebSocket.OPEN;
    }
    static attemptReconnect() {
      if (this.roomEnded || this.sessionReplaced || this.reconnectAttempts >= this.maxReconnectAttempts) return;
      this.reconnectAttempts++;
      setTimeout(() => {
        if (this.roomEnded || this.sessionReplaced) return;
        this.connect(CONFIG.WS_URL).catch(() => this.attemptReconnect());
      }, Math.pow(2, this.reconnectAttempts) * 1000);
    }
  }
  window.SocketClient = SocketClient;
})();
