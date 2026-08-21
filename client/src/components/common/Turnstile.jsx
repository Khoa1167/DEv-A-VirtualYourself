import { useEffect, useRef } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js';

// Nhúng script Cloudflare Turnstile 1 lần duy nhất, dùng chung cho mọi widget trên trang —
// tránh gọi document.createElement lặp lại nếu có nhiều form dùng Turnstile cùng lúc.
let scriptPromise = null;
const loadTurnstile = () => {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  if (!scriptPromise) {
    scriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = SCRIPT_SRC;
      script.async = true;
      script.onload = () => resolve(window.turnstile);
      script.onerror = () => reject(new Error('Không thể tải Cloudflare Turnstile'));
      document.head.appendChild(script);
    });
  }
  return scriptPromise;
};

// Widget CAPTCHA Cloudflare Turnstile — không hiện gì nếu chưa cấu hình VITE_CLOUDFLARE_TURNSTILE_SITE_KEY
// (cho phép chạy dev local không cần tài khoản Cloudflare, khớp fallback phía server).
export default function Turnstile({ onVerify }) {
  const containerRef = useRef(null);
  const widgetIdRef = useRef(null);
  const siteKey = import.meta.env.VITE_CLOUDFLARE_TURNSTILE_SITE_KEY;

  useEffect(() => {
    if (!siteKey) return;
    let mounted = true;

    loadTurnstile().then(turnstile => {
      if (!mounted || !containerRef.current) return;
      widgetIdRef.current = turnstile.render(containerRef.current, {
        sitekey: siteKey,
        callback: (token) => onVerify(token),
        'expired-callback': () => onVerify(''),
        'error-callback': () => onVerify(''),
      });
    }).catch(err => console.error('[Turnstile]', err.message));

    return () => {
      mounted = false;
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteKey]);

  if (!siteKey) return null;
  return <div ref={containerRef} className="flex justify-center" />;
}
