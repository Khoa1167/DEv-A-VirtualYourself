import { useState, useEffect, useRef } from 'react';

// Debounce kiểm tra 1 giá trị (username/nickname...) còn dùng được không qua API, trả về
// 'checking' | 'available' | 'taken' | 'invalid' | ''. Gộp phần dễ viết sai khi copy tay ở
// nhiều nơi: debounce, dọn timeout cũ, và guard không setState sau khi component đã unmount.
// `value` do component gọi tự quản lý (kiểm soát từ ngoài) — hook chỉ phản ứng theo giá trị đó.
// `validate` (tùy chọn): kiểm tra định dạng phía client trước khi gọi checkFn — sai định dạng
// trả 'invalid' ngay, không lẫn với 'taken' (đã tồn tại).
export default function useAvailabilityCheck(value, { checkFn, validate, minLength = 2, debounceMs = 500, skipValue }) {
  const [status, setStatus] = useState('');
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => { isMountedRef.current = false; };
  }, []);

  // Bỏ qua hoặc sai định dạng là kết quả suy ra thẳng từ prop, tính ngay lúc render — không cần
  // effect + setState riêng cho 2 trường hợp này (tránh cascading render, và tránh lẫn 'invalid'
  // với 'taken' vì server trả available:false cho cả 2 trường hợp).
  const skip = value === skipValue || value.trim().length < minLength;
  const formatInvalid = !skip && validate && !validate(value);

  useEffect(() => {
    if (skip || formatInvalid) return;

    // Bật cờ loading ngay khi bắt đầu debounce/fetch — đúng mẫu "Fetching data" chuẩn của React
    // docs (setState đồng bộ trước khi gọi async), rule set-state-in-effect cố tình rất chặt.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
    // checkFn/validate cố tình không nằm trong deps — component gọi thường truyền hàm inline mỗi
    // render, đưa vào deps sẽ khiến debounce bị reset liên tục thay vì chỉ khi `value` đổi.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, minLength, debounceMs, skipValue, skip, formatInvalid]);

  if (skip) return '';
  if (formatInvalid) return 'invalid';
  return status;
}
