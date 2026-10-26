// Loaded before application modules, including independently loaded iframe entries.
// Web Crypto getRandomValues also works on HTTP LAN origins; randomUUID may not.
(function () {
  'use strict';
  var crypto = globalThis.crypto;
  if (!crypto || typeof crypto.randomUUID === 'function') return;
  if (typeof crypto.getRandomValues !== 'function') return;
  Object.defineProperty(crypto, 'randomUUID', {
    configurable: true,
    writable: true,
    value: function randomUUID() {
      var bytes = new Uint8Array(16);
      crypto.getRandomValues(bytes);
      bytes[6] = (bytes[6] & 15) | 64;
      bytes[8] = (bytes[8] & 63) | 128;
      var result = '';
      for (var i = 0; i < bytes.length; i++) {
        if (i === 4 || i === 6 || i === 8 || i === 10) result += '-';
        result += (bytes[i] + 256).toString(16).slice(1);
      }
      return result;
    },
  });
})();
