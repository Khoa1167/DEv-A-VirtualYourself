import { useState, useRef, useCallback } from 'react';

// Hiển thị một thông báo tạm thời (toast/alert inline), tự ẩn sau `duration` ms.
// Gọi lại showMessage trong lúc đang hiện sẽ hủy timer cũ, tránh bị ẩn sớm.
export default function useTimedMessage(duration = 3500) {
  const [message, setMessage] = useState('');
  const timerRef = useRef(null);

  const showMessage = useCallback((text) => {
    setMessage(text);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setMessage(''), duration);
  }, [duration]);

  return [message, showMessage];
}
