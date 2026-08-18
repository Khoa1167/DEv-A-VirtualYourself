// Toast/banner thông báo dùng chung — thay thế khối JSX toast/alert daisyUI
// đang bị viết tay lặp lại ở nhiều component. Dùng cùng với hook useTimedMessage().
//
// - variant="toast" (mặc định): nổi cố định góc màn hình, tự ẩn theo state ở component gọi.
// - variant="banner": khối tĩnh, nằm trong luồng layout (không position:fixed) — dùng cho
//   danh sách dài (vd FriendList) nơi toast nổi che mất nội dung.
// - items: dùng khi cần hiện nhiều thông báo cùng lúc trong 1 toast (vd nhiều file upload lỗi).
export default function Toast({
  message,
  type = 'error',
  items,
  position = 'toast-top toast-center',
  z = 'z-[100]',
  variant = 'toast',
  alertClassName,
}) {
  if (variant === 'banner') {
    if (!message) return null;
    return (
      <div className={`alert alert-${type} ${alertClassName || 'text-xs py-2 px-4 rounded-none'}`}>
        <span>{message}</span>
      </div>
    );
  }

  const list = items ?? (message ? [{ id: 'msg', text: message, type }] : []);
  if (list.length === 0) return null;

  return (
    <div className={`toast ${position} ${z}`}>
      {list.map(item => (
        <div key={item.id} className={`alert alert-${item.type || type} ${alertClassName || 'text-sm'}`}>
          <span>{item.text}</span>
        </div>
      ))}
    </div>
  );
}
