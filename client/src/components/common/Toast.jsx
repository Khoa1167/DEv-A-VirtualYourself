import { useState } from 'react';

// Toast/banner thông báo dùng chung — thay thế khối JSX toast/alert daisyUI
// đang bị viết tay lặp lại ở nhiều component. Dùng cùng với hook useTimedMessage().
//
// - variant="toast" (mặc định): nổi cố định góc màn hình, dạng card viền màu trái + tiêu đề +
//   nút đóng, tự ẩn theo state ở component gọi (hoặc đóng sớm bằng tay).
// - variant="banner": khối tĩnh, nằm trong luồng layout (không position:fixed) — dùng cho
//   danh sách dài (vd FriendList) nơi toast nổi che mất nội dung.
// - items: dùng khi cần hiện nhiều thông báo cùng lúc trong 1 toast (vd nhiều file upload lỗi).
const TYPE_META = {
  error:   { border: 'border-error',   title: 'Lỗi' },
  success: { border: 'border-success', title: 'Thành công' },
  warning: { border: 'border-warning', title: 'Cảnh báo' },
  info:    { border: 'border-info',    title: 'Thông báo' },
};

export default function Toast({
  message,
  type = 'error',
  items,
  position = 'toast-top toast-center',
  z = 'z-[100]',
  variant = 'toast',
  alertClassName,
  title,
}) {
  const list = items ?? (message ? [{ id: 'msg', text: message, type }] : []);

  // Đóng sớm bằng tay (nút ✕) — chỉ ẩn cục bộ ở đây, không cần component cha biết/expose thêm
  // state; message mới xuất hiện thì tự hiện lại bình thường. Reset ngay trong lúc render (mẫu
  // "adjusting state when a prop changes" của React) thay vì useEffect — tránh render thừa 1 lần.
  const [dismissedIds, setDismissedIds] = useState(() => new Set());
  const [prevMessage, setPrevMessage] = useState(message);
  if (message !== prevMessage) {
    setPrevMessage(message);
    setDismissedIds(new Set());
  }

  if (variant === 'banner') {
    if (!message) return null;
    return (
      <div className={`alert alert-${type} ${alertClassName || 'text-xs py-2 px-4 rounded-none'}`}>
        <span>{message}</span>
      </div>
    );
  }

  const visibleList = list.filter(item => !dismissedIds.has(item.id));
  if (visibleList.length === 0) return null;

  return (
    <div className={`toast ${position} ${z} gap-2`}>
      {visibleList.map(item => {
        const meta = TYPE_META[item.type || type] || TYPE_META.info;
        return (
          <div
            key={item.id}
            className={`flex items-start gap-3 min-w-[260px] max-w-sm bg-base-100 border-l-4 ${meta.border} rounded-md shadow-lg px-4 py-3 ${alertClassName || ''}`}
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold">{title || meta.title}</p>
              <p className="text-xs text-base-content/60 mt-0.5 break-words">{item.text}</p>
            </div>
            <button
              type="button"
              onClick={() => setDismissedIds(prev => new Set(prev).add(item.id))}
              className="text-base-content/40 hover:text-base-content/70 leading-none shrink-0"
              aria-label="Đóng thông báo"
            >
              ✕
            </button>
          </div>
        );
      })}
    </div>
  );
}
