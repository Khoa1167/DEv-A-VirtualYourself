import { useState, useEffect, useRef } from 'react';

// Debounce kiểm tra 1 giá trị (username/nickname...) còn dùng được không qua API, trả về
// 'checking' | 'available' | 'taken' | ''. Gộp phần dễ viết sai khi copy tay ở nhiều nơi:
// debounce, dọn timeout cũ, và guard không setState sau khi component đã unmount.
// `value` do component gọi tự quản lý (kiểm soát từ ngoài) — hook chỉ phản ứng theo giá trị đó.
export default function useAvailabilityCheck(value, { checkFn, minLength = 2, debounceMs = 500, skipValue }) {
  const [status, setStatus] = useState('');
  const isMountedRef = useRef(true);

  useEffect(() => () => { isMountedRef.current = false; }, []);

  useEffect(() => {
    if (value === skipValue || value.trim().length < minLength) {
      setStatus('');
      return;
    }

    setStatus('checking');
    const timeout = setTimeout(async () => {
      try {
        const available = await checkFn(value);
        if (isMountedRef.current) setStatus(available ? 'available' : 'taken');
      } catch {
        if (isMountedRef.current) setStatus('');
      }
    }, debounceMs);

    return () => clearTimeout(timeout);
    // checkFn cố tình không nằm trong deps — component gọi thường truyền hàm inline mỗi render,
    // đưa vào deps sẽ khiến debounce bị reset liên tục thay vì chỉ khi `value` đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, minLength, debounceMs, skipValue]);

  return status;
}
